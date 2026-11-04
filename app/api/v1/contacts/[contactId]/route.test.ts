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
  /** La fila de `workspaces` que lee la ruta para «En N días» (tramo C de S8), y cómo la pidió. */
  espacio: { zona_horaria: string | null } | null;
  lecturasDelEspacio: Array<Array<[string, unknown]>>;
} = { usuario: null, contacto: null, updates: [], rpcs: [], respuestaRpc: { resultado: "resuelto" }, tocoLaBase: false, mismoCorreo: [], consultasDeCorreo: [], espacio: null, lecturasDelEspacio: [] };

function supabaseFalso() {
  return {
    auth: {
      getUser: async () => {
        estado.tocoLaBase = true;
        return { data: { user: estado.usuario } };
      },
    },
    from: (tabla: string) => ({
      select: () => {
        const filtros: Array<[string, unknown]> = [];
        const c: any = {
          eq: (k: string, v: unknown) => (filtros.push(["eq", k, v] as never), c),
          ilike: (k: string, v: unknown) => (filtros.push(["ilike", k, v] as never), c),
          neq: (k: string, v: unknown) => (filtros.push(["neq", k, v] as never), c),
          is: (k: string, v: unknown) => (filtros.push(["is", k, v] as never), c),
          maybeSingle: async () =>
            tabla === "workspaces" ? (estado.lecturasDelEspacio.push(filtros), { data: estado.espacio, error: null }) : { data: estado.contacto },
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
  estado.espacio = { zona_horaria: "America/Costa_Rica" };
  estado.lecturasDelEspacio = [];
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

/**
 * «En 3 días», «En 7 días» y «En 14 días» del panel de la bandeja (F35, tramo C
 * de S8): el navegador manda el número y el servidor cuenta desde hoy en la
 * zona del espacio. Reloj fijo a las 18:30 del 04/11/2026 de Costa Rica (00:30
 * del 05 en UTC), con el proceso en UTC.
 */
describe("el próximo seguimiento en días, desde la bandeja", () => {
  const zonaOriginal = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T00:30:00Z"));
    return () => {
      vi.useRealTimers();
      process.env.TZ = zonaOriginal;
    };
  });

  it("acepta 3, 7 y 14", () => {
    for (const dias of [3, 7, 14]) expect(leerPedidoDeEdicion({ seguimiento_en_dias: dias })).toEqual({ ok: true, pedido: { seguimiento_en_dias: dias } });
  });

  it("rechaza otro número, un texto, y los días junto con una fecha", () => {
    for (const v of [5, 0, -3, "3", null, 3.5]) expect(leerPedidoDeEdicion({ seguimiento_en_dias: v }).ok).toBe(false);
    expect(leerPedidoDeEdicion({ seguimiento_en_dias: 3, next_followup_date: "2030-01-01" }).ok).toBe(false);
  });

  it("«En 3 días» escribe hoy en la zona del espacio más 3, con «contacto editado», y devuelve la fecha", async () => {
    const r = await llamar({ seguimiento_en_dias: 3 });
    expect(r.status).toBe(200);
    expect(estado.lecturasDelEspacio).toEqual([[["eq", "id", "ws-1"]]]);
    expect(estado.updates).toEqual([{ next_followup_date: "2026-11-07" }]);
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0]).toMatchObject({ accion: "contacto.editado", cambios: { next_followup_date: { antes: null, despues: "2026-11-07" } } });
    expect(await r.json()).toMatchObject({ next_followup_date: "2026-11-07" });
  });

  it("con el espacio en UTC, la misma hora ya es el 05: «En 3 días» escribe el 08", async () => {
    estado.espacio = { zona_horaria: "UTC" };
    const r = await llamar({ seguimiento_en_dias: 3 });
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([{ next_followup_date: "2026-11-08" }]);
  });

  it("sin zona guardada, Costa Rica, como la base", async () => {
    estado.espacio = { zona_horaria: null };
    const r = await llamar({ seguimiento_en_dias: 14 });
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([{ next_followup_date: "2026-11-18" }]);
  });

  it("con una zona que no existe, no escribe nada", async () => {
    estado.espacio = { zona_horaria: "Marte/Olympus" };
    const r = await llamar({ seguimiento_en_dias: 3 });
    expect(r.status).toBe(500);
    expect(estado.updates).toEqual([]);
    expect(auditar).not.toHaveBeenCalled();
  });

  it("«Quitar» y «Otra fecha» devuelven la fecha que quedó", async () => {
    estado.contacto = { ...estado.contacto, next_followup_date: "2026-11-07" };
    const quitar = await llamar({ next_followup_date: null });
    expect(await quitar.json()).toMatchObject({ next_followup_date: null });
    const otra = await llamar({ next_followup_date: "2026-11-20" });
    expect(await otra.json()).toMatchObject({ next_followup_date: "2026-11-20" });
  });
});
