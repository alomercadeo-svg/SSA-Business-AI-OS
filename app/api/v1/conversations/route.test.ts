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
  contexto: null as null | { workspace: { id: string }; supabase: unknown },
  pagina: vi.fn(),
  cantidades: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({ getWorkspaceOrNull: async () => h.contexto }));
vi.mock("@/lib/bandeja", async (original) => ({
  ...(await original<typeof import("@/lib/bandeja")>()),
  leerPaginaDeBandeja: h.pagina,
  leerCantidades: h.cantidades,
}));

const { GET } = await import("./route");
const pedir = (q = "") => GET(new NextRequest(`http://localhost/api/v1/conversations${q}`));
const CLIENTE = { soy: "el cliente del usuario" };
const UUID = "6f1c3d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

beforeEach(() => {
  h.contexto = { workspace: { id: "ws-1" }, supabase: CLIENTE };
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
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", { estado: "open", busqueda: "", cursor: null, id: undefined });
    expect(h.cantidades).toHaveBeenCalledWith(CLIENTE, "ws-1", "");
    expect(await res.json()).toEqual({ conversaciones: [{ id: "c1" }], hayMas: true, cantidades: { abiertas: 57, cerradas: 2, todas: 59 } });
  });

  it("la búsqueda y la pestaña viajan a la lectura y a las cantidades", async () => {
    await pedir("?estado=closed&q=%20ana%20");
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", expect.objectContaining({ estado: "closed", busqueda: "ana" }));
    expect(h.cantidades).toHaveBeenCalledWith(CLIENTE, "ws-1", "ana");
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
    expect(h.pagina).toHaveBeenCalledWith(CLIENTE, "ws-1", { estado: "open", busqueda: "ana", cursor: null, id: UUID });
    expect(h.cantidades).not.toHaveBeenCalled();
  });

  it("solo las cantidades", async () => {
    const res = await pedir("?soloCantidades=1&q=ana");
    expect(h.pagina).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ cantidades: { abiertas: 57, cerradas: 2, todas: 59 } });
  });

  it("si la base falla, 500 sin el detalle", async () => {
    h.pagina.mockResolvedValue({ conversaciones: [], hayMas: false, error: "permission denied for function bandeja_pagina" });
    const res = await pedir();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("permission denied");
  });
});
