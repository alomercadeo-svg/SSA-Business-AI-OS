import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cambiosDeEdicion, leerPedidoDeEdicion } from "@/lib/edicion-contacto";

/**
 * «Editar datos» de la ficha (F30), con la base simulada. Que la seguridad por
 * filas decida qué contacto puede editar cada uno lo prueba
 * `scripts/verify-ficha.mjs` con sesiones reales contra producción.
 */

const CONTACTO = "44444444-4444-4444-8444-444444444444";

const estado: {
  usuario: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
  contacto: Record<string, unknown> | null;
  updates: Array<Record<string, unknown>>;
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  respuestaRpc: Record<string, unknown>;
  tocoLaBase: boolean;
  /** Otro contacto visible con el mismo correo (F30, aviso del 20/10/2026). */
  mismoCorreo: Array<{ id: string; display_name: string }>;
  consultasDeCorreo: Array<Array<[string, unknown]>>;
} = { usuario: null, contacto: null, updates: [], rpcs: [], respuestaRpc: { resultado: "resuelto" }, tocoLaBase: false, mismoCorreo: [], consultasDeCorreo: [] };

function supabaseFalso() {
  return {
    auth: {
      getUser: async () => {
        estado.tocoLaBase = true;
        return { data: { user: estado.usuario } };
      },
    },
    from: () => ({
      select: () => {
        const filtros: Array<[string, unknown]> = [];
        const c: any = {
          eq: (k: string, v: unknown) => (filtros.push(["eq", k, v] as never), c),
          ilike: (k: string, v: unknown) => (filtros.push(["ilike", k, v] as never), c),
          neq: (k: string, v: unknown) => (filtros.push(["neq", k, v] as never), c),
          is: (k: string, v: unknown) => (filtros.push(["is", k, v] as never), c),
          maybeSingle: async () => ({ data: estado.contacto }),
          limit: async () => (estado.consultasDeCorreo.push(filtros), { data: estado.mismoCorreo, error: null }),
        };
        return c;
      },
      update: (campos: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              estado.updates.push(campos);
              return { data: { id: CONTACTO }, error: null };
            },
          }),
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ fn, args });
      return { data: estado.respuestaRpc, error: null };
    },
  };
}

const auditar = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabaseFalso() }));
vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: (...args: unknown[]) => auditar(...args),
}));

const { PATCH } = await import("./route");

function pedido(cuerpo: unknown, origen: string | null = "https://app.alomercadeo.com") {
  const headers: Record<string, string> = { "content-type": "application/json", host: "app.alomercadeo.com" };
  if (origen) headers.origin = origen;
  return new NextRequest(`https://app.alomercadeo.com/api/v1/contacts/${CONTACTO}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(cuerpo),
  });
}
const llamar = (cuerpo: unknown, origen?: string | null) =>
  PATCH(pedido(cuerpo, origen), { params: Promise.resolve({ contactId: CONTACTO }) });

beforeEach(() => {
  estado.usuario = { id: "u-1", email: "ale@example.com", user_metadata: { full_name: "Ale" } };
  estado.contacto = {
    id: CONTACTO, workspace_id: "ws-1", display_name: "fio.ig", email: null, secondary_email: null,
    phone: null, country: null, lead_temperature: null, next_followup_date: null,
  };
  estado.updates = [];
  estado.rpcs = [];
  estado.respuestaRpc = { resultado: "resuelto" };
  estado.tocoLaBase = false;
  estado.mismoCorreo = [];
  estado.consultasDeCorreo = [];
  auditar.mockClear();
});

describe("leer el pedido", () => {
  it("normaliza correo, teléfono y país, y convierte lo vacío en nulo", () => {
    expect(leerPedidoDeEdicion({ email: " Fio@Mail.COM ", phone: "+506 7034-9182", country: " ", next_followup_date: "" })).toEqual({
      ok: true,
      pedido: { email: "fio@mail.com", phone: "+50670349182", country: null, next_followup_date: null },
    });
  });
  it("rechaza claves que no se editan desde la ficha (setter, deleted_at, do_not_contact…)", () => {
    for (const clave of ["setter_id", "deleted_at", "do_not_contact", "display_name_source", "workspace_id"]) {
      expect(leerPedidoDeEdicion({ [clave]: null }).ok).toBe(false);
    }
  });
  it("rechaza un nombre vacío, un correo roto, una temperatura inventada, una fecha mala y un teléfono sin código de país", () => {
    expect(leerPedidoDeEdicion({ display_name: "  " }).ok).toBe(false);
    expect(leerPedidoDeEdicion({ email: "no-es-correo" }).ok).toBe(false);
    expect(leerPedidoDeEdicion({ lead_temperature: "templado" }).ok).toBe(false);
    expect(leerPedidoDeEdicion({ next_followup_date: "2026-13-45" }).ok).toBe(false);
    expect(leerPedidoDeEdicion({ phone: "70349182" }).ok).toBe(false);
  });
  it("los cambios dejan afuera lo que no cambió y el teléfono", () => {
    expect(cambiosDeEdicion({ country: "CR", email: null }, { country: "CR", email: "a@b.co", phone: "+50670349182" })).toEqual({
      email: { antes: null, despues: "a@b.co" },
    });
  });
});

describe("PATCH /api/v1/contacts/[id]", () => {
  it("sin un origen de la aplicación, 403 sin tocar la base", async () => {
    const r = await llamar({ country: "CR" }, "https://otro-sitio.com");
    expect(r.status).toBe(403);
    expect(estado.tocoLaBase).toBe(false);
  });

  it("guarda, marca el nombre como manual y deja «contacto editado» con antes y después", async () => {
    const r = await llamar({ display_name: "Fiorella Mora", country: "CR", lead_temperature: "tibio", next_followup_date: "2026-10-27" });
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([
      { display_name: "Fiorella Mora", country: "CR", lead_temperature: "tibio", next_followup_date: "2026-10-27", display_name_source: "manual" },
    ]);
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0]).toMatchObject({
      accion: "contacto.editado",
      entidad: { tipo: "contacto", id: CONTACTO, etiqueta: "Fiorella Mora" },
      cambios: {
        display_name: { antes: "fio.ig", despues: "Fiorella Mora" },
        country: { antes: null, despues: "CR" },
        lead_temperature: { antes: null, despues: "tibio" },
        next_followup_date: { antes: null, despues: "2026-10-27" },
      },
    });
  });

  it("sin cambios reales, no escribe ni deja historial", async () => {
    const r = await llamar({ country: null });
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([]);
    expect(auditar).not.toHaveBeenCalled();
  });

  it("el teléfono va por reconciliar_telefono en la vía manual, no por un update", async () => {
    const r = await llamar({ phone: "+506 7034 9182" });
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([]);
    expect(estado.rpcs).toEqual([{ fn: "reconciliar_telefono", args: { p_contacto: CONTACTO, p_telefono: "+50670349182", p_via: "manual" } }]);
  });

  it("si el teléfono ya es de otro contacto, 409 y lo demás queda guardado", async () => {
    estado.respuestaRpc = { resultado: "conflicto", visible: true, otro_id: "otro" };
    const r = await llamar({ country: "CR", phone: "+50670349182" });
    expect(r.status).toBe(409);
    const cuerpo = await r.json();
    expect(cuerpo.guardado).toEqual(["country"]);
    expect(cuerpo.conflicto).toEqual({ otro_id: "otro" });
  });

  it("un contacto que la base no le deja ver (otro alcance, o eliminado): 404", async () => {
    estado.contacto = null;
    const r = await llamar({ country: "CR" });
    expect(r.status).toBe(404);
    expect(estado.updates).toEqual([]);
  });

  it("avisa si el correo ya lo tiene otro contacto, y guarda igual (decisión de Marcos del 20/10/2026)", async () => {
    estado.mismoCorreo = [{ id: "otro", display_name: "Fiorella Mora" }];
    const r = await llamar({ email: "Fio@Mail.com" });
    expect(r.status).toBe(200);
    expect((await r.json()).aviso).toBe("Ojo: «Fiorella Mora» ya tiene ese correo. Se guardó igual; si son la misma persona, conviene unirlos.");
    expect(estado.updates).toEqual([{ email: "fio@mail.com" }]);
    // Busca sin importar mayúsculas, sin contarse a sí mismo y solo entre los vivos.
    expect(estado.consultasDeCorreo[0]).toEqual(
      expect.arrayContaining([["ilike", "email", "fio@mail.com"], ["neq", "id", CONTACTO], ["is", "deleted_at", null]]),
    );
  });

  it("sin otro contacto con ese correo, no hay aviso (control)", async () => {
    const r = await llamar({ email: "fio@mail.com" });
    expect((await r.json()).aviso).toBeUndefined();
  });

  it("si el correo no cambia, ni lo busca", async () => {
    estado.contacto = { ...estado.contacto, email: "fio@mail.com" };
    await llamar({ email: "fio@mail.com" });
    expect(estado.consultasDeCorreo).toEqual([]);
  });
});
