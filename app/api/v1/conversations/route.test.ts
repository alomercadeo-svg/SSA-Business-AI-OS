import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `GET /api/v1/conversations` (F35, tramo A de S8): las páginas de la lista,
 * la búsqueda, las cantidades y la conversación sola que pide Realtime. La
 * lectura en sí (`lib/bandeja.ts`) está simulada: acá se prueba qué le pide la
 * ruta y qué devuelve. La seguridad por filas la aplican las funciones de la
 * 00043, con el cliente del usuario que la ruta les pasa.
 */

const h = vi.hoisted(() => ({
  contexto: null as null | { workspace: { id: string }; supabase: unknown; role: string; user: { id: string } },
  pagina: vi.fn(),
  cantidades: vi.fn(),
}));

// `esManager` igual que en lib/workspace.ts (Owner y Admin): el módulo real importa cookies de Next.
vi.mock("@/lib/workspace", () => ({ getWorkspaceOrNull: async () => h.contexto, esManager: (r: string) => r === "owner" || r === "admin" }));
vi.mock("@/lib/bandeja", async (original) => ({
  ...(await original<typeof import("@/lib/bandeja")>()),
  leerPaginaDeBandeja: h.pagina,
  leerCantidades: h.cantidades,
}));

const { GET } = await import("./route");
const { SIN_FILTROS } = await import("@/lib/filtros-bandeja");
const pedir = (q = "") => GET(new NextRequest(`http://localhost/api/v1/conversations${q}`));
const CLIENTE = { soy: "el cliente del usuario" };
const UUID = "6f1c3d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const YO = "11111111-2222-4333-8444-555555555555";
const OTRO = "99999999-8888-4777-8666-555555555555";
const T1 = "7a2b3c4d-5e6f-4a1b-9c8d-1e2f3a4b5c6d";

beforeEach(() => {
  h.contexto = { workspace: { id: "ws-1" }, supabase: CLIENTE, role: "owner", user: { id: YO } };
  h.pagina.mockReset();
  h.pagina.mockResolvedValue({ conversaciones: [{ id: "c1" }], hayMas: true, error: null });
  h.cantidades.mockReset();
  h.cantidades.mockResolvedValue({ abiertas: 57, cerradas: 2, todas: 59 });
});

describe("GET /api/v1/conversations", () => {
  it("sin sesión, 401", async () => {
    h.contexto = null;
    expect((await pedir()).status).toBe(401);
    expect(h.pagina).not.toHaveBeenCalled();
  });

  it("la primera página: Abiertas por defecto, con las cantidades, con el cliente del usuario", async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", { estado: "open", busqueda: "", cursor: null, id: undefined, filtros: SIN_FILTROS });
    expect(h.cantidades).toHaveBeenCalledWith(CLIENTE, "ws-1", "", SIN_FILTROS);
    expect(await res.json()).toEqual({ conversaciones: [{ id: "c1" }], hayMas: true, cantidades: { abiertas: 57, cerradas: 2, todas: 59 } });
  });

  it("la búsqueda y la pestaña viajan a la lectura y a las cantidades", async () => {
    await pedir("?estado=closed&q=%20ana%20");
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", expect.objectContaining({ estado: "closed", busqueda: "ana" }));
    expect(h.cantidades).toHaveBeenCalledWith(CLIENTE, "ws-1", "ana", SIN_FILTROS);
  });

  it("con cursor es una página siguiente: sin cantidades", async () => {
    const res = await pedir(`?estado=all&antesOrden=2026-11-01T10%3A00%3A00.123456%2B00%3A00&antesId=${UUID}`);
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", expect.objectContaining({ cursor: { orden: "2026-11-01T10:00:00.123456+00:00", id: UUID } }));
    expect(h.cantidades).not.toHaveBeenCalled();
    expect((await res.json()).cantidades).toBeUndefined();
  });

  it("un cursor sin id, o con un id que no es uuid, es 400", async () => {
    expect((await pedir("?antesOrden=2026-11-01T10:00:00Z")).status).toBe(400);
    expect((await pedir("?antesOrden=2026-11-01T10:00:00Z&antesId=x")).status).toBe(400);
    expect(h.pagina).not.toHaveBeenCalled();
  });

  it("una sola por id, con los filtros de la pestaña y la búsqueda (Realtime)", async () => {
    await pedir(`?id=${UUID}&estado=open&q=ana`);
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", { estado: "open", busqueda: "ana", cursor: null, id: UUID, filtros: SIN_FILTROS });
    expect(h.cantidades).not.toHaveBeenCalled();
  });

  it("solo las cantidades", async () => {
    const res = await pedir("?soloCantidades=1&q=ana");
    expect(h.pagina).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ cantidades: { abiertas: 57, cerradas: 2, todas: 59 } });
  });

  it("los filtros de la dirección viajan a la lectura y a las cantidades (tramo B)", async () => {
    await pedir(`?estado=all&etiquetas=${T1}&canal=whatsapp&seguimiento=vencido&telefono=sin-resolver`);
    const filtros = { ...SIN_FILTROS, etiquetas: [T1], canal: ["whatsapp"], seguimiento: "vencido", telefonoSinResolver: true };
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", expect.objectContaining({ filtros }));
    expect(h.cantidades).toHaveBeenCalledWith(CLIENTE, "ws-1", "", filtros);
  });

  it("una sola por id, con los filtros (Realtime con filtros)", async () => {
    await pedir(`?id=${UUID}&estado=open&canal=instagram`);
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", expect.objectContaining({ id: UUID, filtros: { ...SIN_FILTROS, canal: ["instagram"] } }));
  });

  it("solo las cantidades, con los filtros", async () => {
    await pedir("?soloCantidades=1&ultimo=hoy");
    expect(h.cantidades).toHaveBeenCalledWith(CLIENTE, "ws-1", "", { ...SIN_FILTROS, ultimo: "hoy" });
  });

  it("`ahora` en la dirección no llega a la lectura: el reloj fijo es solo del verificador", async () => {
    await pedir("?seguimiento=hoy&ahora=2026-11-05T00%3A30%3A00Z");
    expect(JSON.stringify(h.pagina.mock.calls)).not.toContain("2026-11-05");
    expect(JSON.stringify(h.cantidades.mock.calls)).not.toContain("2026-11-05");
  });

  it("un Member con el id de otro miembro en `asignacion`: se ignora, 200 y sin ese filtro", async () => {
    h.contexto = { workspace: { id: "ws-1" }, supabase: CLIENTE, role: "member", user: { id: YO } };
    const res = await pedir(`?asignacion=${OTRO}&canal=whatsapp`);
    expect(res.status).toBe(200);
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", expect.objectContaining({ filtros: { ...SIN_FILTROS, canal: ["whatsapp"] } }));
  });

  it("un Member puede filtrarse a sí mismo; un Owner, por cualquiera", async () => {
    h.contexto = { workspace: { id: "ws-1" }, supabase: CLIENTE, role: "member", user: { id: YO } };
    await pedir(`?asignacion=${YO}`);
    expect(h.pagina).toHaveBeenLastCalledWith(CLIENTE, "ws-1", expect.objectContaining({ filtros: { ...SIN_FILTROS, asignacion: YO } }));
    h.contexto = { workspace: { id: "ws-1" }, supabase: CLIENTE, role: "owner", user: { id: YO } };
    await pedir(`?asignacion=${OTRO}`);
    expect(h.pagina).toHaveBeenLastCalledWith(CLIENTE, "ws-1", expect.objectContaining({ filtros: { ...SIN_FILTROS, asignacion: OTRO } }));
  });

  it("si la base falla, 500 sin el detalle", async () => {
    h.pagina.mockResolvedValue({ conversaciones: [], hayMas: false, error: "permission denied for function bandeja_pagina" });
    const res = await pedir();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("permission denied");
  });
});
