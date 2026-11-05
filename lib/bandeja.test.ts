import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  CONVERSACIONES_POR_PAGINA,
  busquedaDeBandeja,
  compararDeBandeja,
  cursorDe,
  fusionarDeBandeja,
  estadoDeBandeja,
  leerCantidades,
  leerPaginaDeBandeja,
} from "./bandeja";
import { SIN_FILTROS } from "./filtros-bandeja";

/**
 * La lectura de la bandeja (F35, tramo A de S8) con el cliente REAL de
 * supabase-js y un `fetch` que registra el pedido y devuelve lo que se le
 * diga. Comprueba la forma exacta del pedido a PostgREST: que `.rpc(...)`
 * seguido de `.select("*, contacts(*)")` viaja como POST a la función con el
 * anidado en `select=`, y el orden explícito. Que PostgREST lo acepta lo
 * comprueba `scripts/verify-bandeja.mjs` contra la base real.
 */

const pedidos: Array<{ url: URL; metodo: string; cuerpo: unknown }> = [];
let respuestas: unknown[] = [];

const cliente = createClient("https://proyecto.ejemplo.invalid", "anon", {
  global: {
    fetch: async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
      pedidos.push({ url, metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
      const datos = respuestas.length ? respuestas.shift() : [];
      return new Response(JSON.stringify(datos), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  },
  auth: { persistSession: false, autoRefreshToken: false },
});

const fila = (id: string, last: string | null = "2026-11-03T12:00:00Z", extra: Record<string, unknown> = {}) => ({
  id, workspace_id: "ws-1", last_message_at: last, status: "open", contact_id: `ct-${id}`, contacts: { id: `ct-${id}` }, ...extra,
});

beforeEach(() => {
  pedidos.length = 0;
  respuestas = [];
});

describe("leerPaginaDeBandeja: el pedido a la base", () => {
  // Desde el tramo B (04/11/2026) va a bandeja_pagina_filtros (00044), con los
  // filtros en un jsonb. Antes iba a bandeja_pagina (00043), que sigue en la
  // base sin uso de la app.
  it("llama a bandeja_pagina_filtros por POST, con contacts anidado y el orden explícito", async () => {
    await leerPaginaDeBandeja(cliente as never, "ws-1", { estado: "open", busqueda: "", cursor: null });
    expect(pedidos).toHaveLength(1);
    const [p] = pedidos;
    expect(p.metodo).toBe("POST");
    expect(p.url.pathname).toBe("/rest/v1/rpc/bandeja_pagina_filtros");
    expect(p.url.searchParams.get("select")).toBe("*,contacts(*,contact_channels(platform_sender_id,platform_username))");
    expect(p.url.searchParams.get("order")).toBe("last_message_at.desc.nullslast,id.desc");
    expect(p.cuerpo).toEqual({
      p_workspace: "ws-1",
      p_estado: "open",
      p_filtros: { q: "" },
      p_antes_orden: null,
      p_antes_id: null,
      p_limite: CONVERSACIONES_POR_PAGINA + 1,
      p_id: null,
    });
  });

  it("pide una de más para saber si hay más, y devuelve 50", async () => {
    respuestas = [Array.from({ length: CONVERSACIONES_POR_PAGINA + 1 }, (_, i) => fila(`c${i}`))];
    const r = await leerPaginaDeBandeja(cliente as never, "ws-1", { estado: "all", busqueda: "", cursor: null });
    expect(r.conversaciones).toHaveLength(CONVERSACIONES_POR_PAGINA);
    expect(r.hayMas).toBe(true);
  });

  it("con 50 o menos, no hay más", async () => {
    respuestas = [Array.from({ length: CONVERSACIONES_POR_PAGINA }, (_, i) => fila(`c${i}`))];
    const r = await leerPaginaDeBandeja(cliente as never, "ws-1", { estado: "all", busqueda: "", cursor: null });
    expect(r.conversaciones).toHaveLength(CONVERSACIONES_POR_PAGINA);
    expect(r.hayMas).toBe(false);
  });

  it("el cursor, la búsqueda y los filtros viajan como argumentos de la función", async () => {
    await leerPaginaDeBandeja(cliente as never, "ws-1", {
      estado: "closed",
      busqueda: "ana",
      cursor: { orden: "2026-11-01T10:00:00Z", id: "c9" },
      filtros: { ...SIN_FILTROS, canal: ["whatsapp"], seguimiento: "hoy" },
    });
    expect(pedidos[0].cuerpo).toMatchObject({
      p_estado: "closed",
      p_filtros: { q: "ana", canal: ["whatsapp"], seguimiento: "hoy" },
      p_antes_orden: "2026-11-01T10:00:00Z",
      p_antes_id: "c9",
    });
  });

  it("una sola por id (Realtime): la misma función, con p_id y los mismos filtros, que filtra por id antes del límite", async () => {
    respuestas = [[fila("c7")]];
    const r = await leerPaginaDeBandeja(cliente as never, "ws-1", { estado: "open", busqueda: "ana", cursor: null, id: "c7", filtros: { ...SIN_FILTROS, telefonoSinResolver: true } });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url.pathname).toBe("/rest/v1/rpc/bandeja_pagina_filtros");
    expect(pedidos[0].cuerpo).toMatchObject({ p_id: "c7", p_estado: "open", p_filtros: { q: "ana", sin_telefono: true } });
    expect(r.conversaciones.map((c) => c.id)).toEqual(["c7"]);
    expect(r.hayMas).toBe(false);
  });

  it("por id, si la base no la devuelve (no cumple los filtros), no vuelve nada", async () => {
    respuestas = [[]];
    const r = await leerPaginaDeBandeja(cliente as never, "ws-1", { estado: "open", busqueda: "", cursor: null, id: "c7" });
    expect(r.conversaciones).toEqual([]);
  });
});

describe("leerCantidades", () => {
  it("llama a bandeja_cantidades_filtros, con los filtros, y devuelve números", async () => {
    respuestas = [[{ abiertas: 57, cerradas: 2, todas: 59 }]];
    const c = await leerCantidades(cliente as never, "ws-1", "ana", { ...SIN_FILTROS, etiquetas: ["t1"] });
    expect(pedidos[0].url.pathname).toBe("/rest/v1/rpc/bandeja_cantidades_filtros");
    expect(pedidos[0].cuerpo).toEqual({ p_workspace: "ws-1", p_filtros: { q: "ana", etiquetas: ["t1"] } });
    expect(c).toEqual({ abiertas: 57, cerradas: 2, todas: 59 });
  });
});

describe("los parámetros", () => {
  it("el estado es open por defecto, y solo open, closed o all", () => {
    expect(estadoDeBandeja(undefined)).toBe("open");
    expect(estadoDeBandeja("closed")).toBe("closed");
    expect(estadoDeBandeja("all")).toBe("all");
    expect(estadoDeBandeja("snoozed")).toBe("open");
  });

  it("la búsqueda se recorta, y una lista de valores toma el primero", () => {
    expect(busquedaDeBandeja("  ana  ")).toBe("ana");
    expect(busquedaDeBandeja(undefined)).toBe("");
    expect(busquedaDeBandeja(["ana", "x"])).toBe("ana");
    expect(busquedaDeBandeja("a".repeat(300))).toHaveLength(100);
  });

  it("el cursor de una fila sin último mensaje es -infinity, como la orden de la base", () => {
    expect(cursorDe({ id: "c1", last_message_at: null })).toEqual({ orden: "-infinity", id: "c1" });
    expect(cursorDe({ id: "c2", last_message_at: "2026-11-03T12:00:00Z" })).toEqual({ orden: "2026-11-03T12:00:00Z", id: "c2" });
  });
});

describe("ordenar y fusionar en el navegador (Cargar más y Realtime)", () => {
  it("ordena como la base: último mensaje, las que no tienen al final, y el id para desempatar", () => {
    const filas = [
      { id: "a", last_message_at: null },
      { id: "b", last_message_at: "2026-11-03T10:00:00Z" },
      { id: "d", last_message_at: "2026-11-03T12:00:00Z" },
      { id: "c", last_message_at: "2026-11-03T12:00:00Z" },
    ];
    expect([...filas].sort(compararDeBandeja).map((f) => f.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("fusiona sin repetir: la nueva versión de una fila reemplaza a la vieja, y queda en orden", () => {
    const previas = [
      { id: "c", last_message_at: "2026-11-03T12:00:00Z", status: "open" },
      { id: "b", last_message_at: "2026-11-03T10:00:00Z", status: "open" },
    ];
    const nuevas = [
      { id: "b", last_message_at: "2026-11-03T13:00:00Z", status: "open" },
      { id: "a", last_message_at: "2026-11-03T09:00:00Z", status: "open" },
    ];
    expect(fusionarDeBandeja(previas, nuevas).map((f) => [f.id, f.last_message_at])).toEqual([
      ["b", "2026-11-03T13:00:00Z"],
      ["c", "2026-11-03T12:00:00Z"],
      ["a", "2026-11-03T09:00:00Z"],
    ]);
  });
});
