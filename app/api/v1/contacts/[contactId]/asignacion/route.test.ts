import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const AJENO = "33333333-3333-4333-8333-333333333333";
const CONTACTO = "44444444-4444-4444-8444-444444444444";

const estado: {
  usuario: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
  contacto: Record<string, unknown> | null;
  errorDeUpdate: { code: string; message: string } | null;
  updates: Array<Record<string, unknown>>;
  tocoLaBase: boolean;
} = { usuario: null, contacto: null, errorDeUpdate: null, updates: [], tocoLaBase: false };

function supabaseFalso() {
  return {
    auth: {
      getUser: async () => {
        estado.tocoLaBase = true;
        return { data: { user: estado.usuario } };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: estado.contacto }) }) }),
      update: (campos: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              if (estado.errorDeUpdate) return { data: null, error: estado.errorDeUpdate };
              estado.updates.push(campos);
              return { data: { ...estado.contacto, ...campos }, error: null };
            },
          }),
        }),
      }),
    }),
  };
}

const auditar = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabaseFalso() }));
vi.mock("@/lib/miembros", () => ({
  miembrosDelEspacio: async () => [
    { id: OWNER, etiqueta: "Ale" },
    { id: MEMBER, etiqueta: "Laura" },
  ],
}));
vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: (...args: unknown[]) => auditar(...args),
}));

const { PATCH } = await import("./route");

function pedido(cuerpo: unknown, origen: string | null = "https://app.alomercadeo.com") {
  const headers: Record<string, string> = { "content-type": "application/json", host: "app.alomercadeo.com" };
  if (origen) headers.origin = origen;
  return new NextRequest(`https://app.alomercadeo.com/api/v1/contacts/${CONTACTO}/asignacion`, {
    method: "PATCH",
    headers,
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}
const params = { params: Promise.resolve({ contactId: CONTACTO }) };

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.alomercadeo.com";
  estado.usuario = { id: OWNER, email: "ale@x.com", user_metadata: { full_name: "Ale" } };
  estado.contacto = { id: CONTACTO, workspace_id: "ws", display_name: "Lead", setter_id: null, vendedor_id: null };
  estado.errorDeUpdate = null;
  estado.updates = [];
  estado.tocoLaBase = false;
  auditar.mockClear();
});

describe("PATCH asignación (F41)", () => {
  it("rechaza otro origen antes de mirar la sesión o la base", async () => {
    const r = await PATCH(pedido({ setter_id: MEMBER }, "https://malicioso.example"), params);
    expect(r.status).toBe(403);
    expect(estado.tocoLaBase).toBe(false);
    expect(estado.updates).toEqual([]);
  });

  it("sin sesión, 401", async () => {
    estado.usuario = null;
    expect((await PATCH(pedido({ setter_id: MEMBER }), params)).status).toBe(401);
  });

  it("un pedido con otros campos, 400, y no escribe", async () => {
    expect((await PATCH(pedido({ setter_id: MEMBER, display_name: "x" }), params)).status).toBe(400);
    expect((await PATCH(pedido("no es json"), params)).status).toBe(400);
    expect(estado.updates).toEqual([]);
  });

  it("un contacto que la RLS no deja ver, 404", async () => {
    estado.contacto = null;
    expect((await PATCH(pedido({ setter_id: MEMBER }), params)).status).toBe(404);
  });

  it("asignar a alguien que no es del equipo, 400, y no escribe", async () => {
    expect((await PATCH(pedido({ setter_id: AJENO }), params)).status).toBe(400);
    expect(estado.updates).toEqual([]);
  });

  it("asigna el setter sin tocar al vendedor, y registra «asignado» con el antes y el después", async () => {
    const r = await PATCH(pedido({ setter_id: MEMBER }), params);
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([{ setter_id: MEMBER }]);
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0]).toMatchObject({
      workspaceId: "ws",
      actor: { id: OWNER, etiqueta: "Ale" },
      accion: "contacto.asignado",
      entidad: { tipo: "contacto", id: CONTACTO, etiqueta: "Lead" },
      cambios: { setter_id: { antes: null, despues: MEMBER } },
      detalle: { nombres: { setter_id: { antes: null, despues: "Laura" } } },
    });
  });

  it("quitar la asignación es un cambio a null", async () => {
    estado.contacto = { ...estado.contacto, vendedor_id: MEMBER };
    const r = await PATCH(pedido({ vendedor_id: null }), params);
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([{ vendedor_id: null }]);
    expect(auditar.mock.calls[0][0]).toMatchObject({
      detalle: { nombres: { vendedor_id: { antes: "Laura", despues: null } } },
    });
  });

  it("pedir lo que ya está no escribe ni registra", async () => {
    estado.contacto = { ...estado.contacto, setter_id: MEMBER };
    const r = await PATCH(pedido({ setter_id: MEMBER }), params);
    expect(r.status).toBe(200);
    expect(estado.updates).toEqual([]);
    expect(auditar).not.toHaveBeenCalled();
  });

  it("si la RLS rechaza el cambio (un Member que se quitaría el lead), 403 con un mensaje claro y sin historial", async () => {
    estado.usuario = { id: MEMBER, email: "laura@x.com", user_metadata: {} };
    estado.contacto = { ...estado.contacto, setter_id: MEMBER };
    estado.errorDeUpdate = { code: "42501", message: "new row violates row-level security policy" };
    const r = await PATCH(pedido({ setter_id: null }), params);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/dejarías de verlo/);
    expect(auditar).not.toHaveBeenCalled();
  });
});
