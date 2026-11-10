import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * F37, parte 1: la guarda de rol y los límites de `POST /api/v1/contacts/importar`.
 * La base simulada solo para lo que la ruta toca antes de importar. Lo demás
 * (duplicados, etiquetas, campos) está en `lib/importacion-contactos.test.ts`,
 * y contra la base real en `scripts/verify-importacion.mjs`.
 */
const h = vi.hoisted(() => ({
  rol: "owner" as string,
  inserts: [] as Array<{ tabla: string; valores: unknown }>,
}));

function cadena(tabla: string) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  Object.assign(c, {
    select: self,
    eq: self,
    ilike: self,
    order: self,
    update: () => ({ eq: async () => ({ error: null }) }),
    limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (valores: unknown) => {
      h.inserts.push({ tabla, valores });
      return { select: () => ({ single: async () => ({ data: { id: `${tabla}-1` }, error: null }) }) };
    },
    upsert: async () => ({ error: null }),
    then: (ok: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  });
  return c;
}
const supabaseFalso = { from: (t: string) => cadena(t) };

vi.mock("@/lib/workspace", () => ({
  getWorkspaceOrNull: async () => ({ user: { id: "u-1", email: "a@x.com", user_metadata: {} }, workspace: { id: "ws-1" }, role: h.rol, supabase: supabaseFalso }),
  esManager: (r: string) => r === "owner" || r === "admin",
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => supabaseFalso }));
vi.mock("@/lib/miembros", () => ({ miembrosDelEspacio: async () => [{ id: "u-1", etiqueta: "Ana" }] }));
vi.mock("@/lib/auditoria", () => ({ actorDe: () => ({ id: "u-1", etiqueta: "Ana" }), registrarAuditoria: async () => true }));

const { POST } = await import("./route");

const pedido = (cuerpo: unknown) =>
  new Request("https://app.ejemplo.invalid/api/v1/contacts/importar", {
    method: "POST",
    body: JSON.stringify(cuerpo),
    headers: { "Content-Type": "application/json", origin: "https://app.ejemplo.invalid" },
  }) as unknown as NextRequest;

const valido = { nombreArchivo: "x.csv", codigoPais: "+506", asignarA: null, mapeo: ["nombre", "correo"], filas: [["Ana", "ana@x.com"]] };

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.ejemplo.invalid";
  h.rol = "owner";
  h.inserts.length = 0;
});

describe("POST /api/v1/contacts/importar: solo Owner y Admin esta noche", () => {
  it("un Member recibe 403 y no se escribe nada", async () => {
    h.rol = "member";
    const res = await POST(pedido(valido));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "solo_managers" });
    expect(h.inserts).toEqual([]);
  });

  it("control: el Owner importa (crea el registro y el contacto)", async () => {
    const res = await POST(pedido(valido));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ creados: 1, conError: 0 });
    expect(h.inserts.map((i) => i.tabla)).toEqual(["csv_imports", "contacts"]);
  });

  it("más de 500 filas se rechaza con el texto de la parte 1", async () => {
    const res = await POST(pedido({ ...valido, filas: Array.from({ length: 501 }, (_, i) => ["N", `n${i}@x.com`]) }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Por ahora, hasta 500 filas por importación." });
  });

  it("un código de país mal escrito se rechaza", async () => {
    const res = await POST(pedido({ ...valido, codigoPais: "506" }));
    expect(res.status).toBe(400);
  });
});
