import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `GET /api/v1/contacts` (F43, tramo B de S9): reemplaza el GET del fork, que
 * nadie llamaba, tomaba la primera membresía en vez del espacio elegido y
 * filtraba la etiqueta en memoria. La lectura (`lib/contactos.ts`) está
 * simulada: acá se prueba qué le pide la ruta y qué devuelve.
 */

const h = vi.hoisted(() => ({
  contexto: null as null | { workspace: { id: string }; supabase: unknown; role: string; user: { id: string } },
  leer: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({ getWorkspaceOrNull: async () => h.contexto, esManager: (r: string) => r === "owner" || r === "admin" }));
vi.mock("@/lib/contactos", async (original) => ({ ...(await original<typeof import("@/lib/contactos")>()), leerContactos: h.leer }));

const { GET } = await import("./route");
const { SIN_FILTROS_DE_CONTACTOS } = await import("@/lib/contactos");
const pedir = (q = "") => GET(new NextRequest(`http://localhost/api/v1/contacts${q}`));
const CLIENTE = { soy: "el cliente del usuario" };
const YO = "11111111-2222-4333-8444-555555555555";
const OTRO = "99999999-8888-4777-8666-555555555555";

beforeEach(() => {
  h.contexto = { workspace: { id: "ws-1" }, supabase: CLIENTE, role: "owner", user: { id: YO } };
  h.leer.mockReset();
  h.leer.mockResolvedValue({ contactos: [{ id: "a" }], cantidad: 12, total: 743, pagina: 1, paginas: 1, error: null });
});

describe("GET /api/v1/contacts", () => {
  it("sin sesión, 401", async () => {
    h.contexto = null;
    expect((await pedir()).status).toBe(401);
    expect(h.leer).not.toHaveBeenCalled();
  });

  it("lee con el cliente del usuario y el espacio elegido, y devuelve la página, la cantidad y el total", async () => {
    const res = await pedir("?q=ana&pagina=2");
    expect(res.status).toBe(200);
    // Cambiado el 09/11/2026 (F43, criterio 7): el quinto argumento son los setters en orden, vacío si no se ordena por setter.
    expect(h.leer).toHaveBeenCalledWith(CLIENTE, "ws-1", { ...SIN_FILTROS_DE_CONTACTOS, q: "ana" }, 2, []);
    expect(await res.json()).toEqual({ contactos: [{ id: "a" }], cantidad: 12, total: 743, pagina: 1, paginas: 1 });
  });

  it("trae Server-Timing con la sesión, la lista y el total", async () => {
    const t = (await pedir()).headers.get("Server-Timing") ?? "";
    expect(t).toMatch(/sesion_y_espacio;dur=[\d.]+/);
    expect(t).toMatch(/lista;dur=[\d.]+/);
    expect(t).toMatch(/total;dur=[\d.]+/);
  });

  it("un Member con el id de otro en setter: se ignora", async () => {
    h.contexto!.role = "member";
    await pedir(`?setter=${OTRO}`);
    expect(h.leer).toHaveBeenCalledWith(CLIENTE, "ws-1", SIN_FILTROS_DE_CONTACTOS, 1, []);
  });

  it("un error de la base: 500, sin el detalle", async () => {
    h.leer.mockResolvedValue({ contactos: [], cantidad: 0, total: 0, pagina: 1, paginas: 1, error: "permission denied for x" });
    const res = await pedir();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("permission");
  });
});
