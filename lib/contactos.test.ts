import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  CONTACTOS_POR_PAGINA,
  ETAPAS,
  SIN_FILTROS_DE_CONTACTOS,
  direccionDeContactos,
  filtrosDeContactos,
  filtrosDeContactosParaElRol,
  hayFiltrosDeContactos,
  leerContactos,
  numerosDePagina,
  paginaDeContactos,
  paraLaBaseDeContactos,
} from "./contactos";

/**
 * La lista de Contactos en el servidor (F43, tramo B de S9). La lectura se
 * prueba con el cliente REAL de supabase-js y un `fetch` que registra cada
 * pedido, como `lib/bandeja.test.ts`: la forma del pedido a PostgREST. Que la
 * base lo acepta lo prueba `scripts/verify-contactos.mjs`.
 */

const pedidos: Array<{ url: URL; cuerpo: Record<string, unknown> | null }> = [];
let responder: (url: URL, cuerpo: Record<string, unknown> | null) => unknown = () => [];

const cliente = createClient("https://proyecto.ejemplo.invalid", "anon", {
  global: {
    fetch: async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
      const cuerpo = init?.body ? JSON.parse(String(init.body)) : null;
      pedidos.push({ url, cuerpo });
      return new Response(JSON.stringify(responder(url, cuerpo)), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  },
  auth: { persistSession: false, autoRefreshToken: false },
});

const ID = "11111111-2222-4333-8444-555555555555";
const OTRO = "99999999-8888-4777-8666-555555555555";

beforeEach(() => {
  pedidos.length = 0;
  responder = () => [];
});

describe("filtrosDeContactos: la dirección", () => {
  it("lee la búsqueda, los cinco filtros y la página", () => {
    const p = new URLSearchParams({ q: "  ana  ", seguimiento: "semana", etapa: "3. Respondió", setter: "sin", vendedor: ID, etiqueta: OTRO });
    expect(filtrosDeContactos(p)).toEqual({ q: "ana", seguimiento: "semana", etapa: "3. Respondió", setter: { tipo: "sin" }, vendedor: { tipo: "persona", id: ID }, etiqueta: OTRO });
  });

  it("descarta lo que no entiende", () => {
    const p = { seguimiento: "rango", etapa: "10. No existe", setter: "x", etiqueta: "no-es-un-id" };
    expect(filtrosDeContactos(p)).toEqual(SIN_FILTROS_DE_CONTACTOS);
  });

  it("corta la búsqueda a 100 caracteres", () => {
    expect(filtrosDeContactos({ q: "a".repeat(150) }).q).toHaveLength(100);
  });

  it("la página: un entero desde 1; lo demás, 1", () => {
    expect(paginaDeContactos("3")).toBe(3);
    expect(paginaDeContactos(["2", "5"])).toBe(2);
    expect(paginaDeContactos("0")).toBe(1);
    expect(paginaDeContactos("-4")).toBe(1);
    expect(paginaDeContactos("2.5")).toBe(1);
    expect(paginaDeContactos(undefined)).toBe(1);
  });

  it("las etapas son las trece del check de la 00030, en su orden", () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "00030_contacto_estado_comercial.sql"), "utf8");
    const bloque = sql.slice(sql.indexOf("contacts_pipeline_stage_check check"));
    const enLaBase = [...bloque.slice(0, bloque.indexOf("))")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(ETAPAS).toEqual(enLaBase);
    expect(ETAPAS).toHaveLength(13);
  });
});

describe("filtrosDeContactosParaElRol", () => {
  const conOtro = { ...SIN_FILTROS_DE_CONTACTOS, setter: { tipo: "persona" as const, id: OTRO }, vendedor: { tipo: "persona" as const, id: OTRO } };
  it("un Member con el id de otro: se ignora", () => {
    expect(filtrosDeContactosParaElRol(conOtro, false, ID)).toEqual(SIN_FILTROS_DE_CONTACTOS);
  });
  it("un Member con su propio id o «sin»: queda", () => {
    const propio = { ...SIN_FILTROS_DE_CONTACTOS, setter: { tipo: "persona" as const, id: ID }, vendedor: { tipo: "sin" as const } };
    expect(filtrosDeContactosParaElRol(propio, false, ID)).toEqual(propio);
  });
  it("Owner y Admin: queda", () => {
    expect(filtrosDeContactosParaElRol(conOtro, true, ID)).toEqual(conOtro);
  });
});

describe("paraLaBaseDeContactos y la dirección", () => {
  const f = { q: "ana", seguimiento: "hoy" as const, etapa: "3. Respondió", setter: { tipo: "sin" as const }, vendedor: { tipo: "persona" as const, id: ID }, etiqueta: OTRO };
  it("arma el jsonb, sin `ahora`", () => {
    expect(paraLaBaseDeContactos(f)).toEqual({ q: "ana", seguimiento: "hoy", etapa: "3. Respondió", setter: "sin", vendedor: ID, etiqueta: OTRO });
    expect(paraLaBaseDeContactos(SIN_FILTROS_DE_CONTACTOS)).toEqual({});
  });
  it("la dirección: solo lo elegido, y la página desde la 2", () => {
    expect(direccionDeContactos(SIN_FILTROS_DE_CONTACTOS, 1)).toBe("/dashboard/contacts");
    expect(direccionDeContactos(f, 3)).toBe(`/dashboard/contacts?q=ana&seguimiento=hoy&etapa=3.+Respondi%C3%B3&setter=sin&vendedor=${ID}&etiqueta=${OTRO}&pagina=3`);
  });
  it("ida y vuelta: la dirección se lee igual", () => {
    const url = new URL(direccionDeContactos(f, 2), "https://x.invalid");
    expect(filtrosDeContactos(url.searchParams)).toEqual(f);
    expect(paginaDeContactos(url.searchParams.get("pagina") ?? undefined)).toBe(2);
  });
  it("hay filtros: con búsqueda o con uno de los cinco", () => {
    expect(hayFiltrosDeContactos(SIN_FILTROS_DE_CONTACTOS)).toBe(false);
    expect(hayFiltrosDeContactos({ ...SIN_FILTROS_DE_CONTACTOS, q: "a" })).toBe(true);
    expect(hayFiltrosDeContactos({ ...SIN_FILTROS_DE_CONTACTOS, etiqueta: OTRO })).toBe(true);
  });
});

describe("numerosDePagina", () => {
  it("pocas páginas: todas", () => {
    expect(numerosDePagina(1, 1)).toEqual([1]);
    expect(numerosDePagina(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("muchas: la primera, la última y dos a cada lado de la actual, con «…»", () => {
    expect(numerosDePagina(8, 16)).toEqual([1, "…", 6, 7, 8, 9, 10, "…", 16]);
    expect(numerosDePagina(1, 16)).toEqual([1, 2, 3, "…", 16]);
    expect(numerosDePagina(16, 16)).toEqual([1, "…", 14, 15, 16]);
  });
});

describe("leerContactos: los pedidos a la base", () => {
  it("pide la página con sus etiquetas y canales, en orden, y la cantidad, sin filtros una sola vez", async () => {
    responder = (url) => (url.pathname.endsWith("contactos_cantidad") ? 130 : [{ id: "a" }]);
    const r = await leerContactos(cliente as never, "ws-1", SIN_FILTROS_DE_CONTACTOS, 2);
    const pagina = pedidos.find((p) => p.url.pathname === "/rest/v1/rpc/contactos_pagina");
    expect(pagina?.cuerpo).toEqual({ p_workspace: "ws-1", p_filtros: {}, p_pagina: 2, p_por_pagina: CONTACTOS_POR_PAGINA });
    expect(pagina?.url.searchParams.get("select")).toBe("*,contact_tags(tag_id,tags(*)),contact_channels(platform_sender_id,platform_username)");
    expect(pagina?.url.searchParams.get("order")).toBe("last_interaction_at.desc.nullslast,id.desc");
    expect(pedidos.filter((p) => p.url.pathname === "/rest/v1/rpc/contactos_cantidad")).toHaveLength(1);
    expect(r).toMatchObject({ cantidad: 130, total: 130, pagina: 2, paginas: 3, error: null });
    expect(r.contactos).toEqual([{ id: "a" }]);
  });

  it("con filtros, cuenta los filtrados y el total del alcance", async () => {
    responder = (url, cuerpo) => (url.pathname.endsWith("contactos_cantidad") ? (Object.keys((cuerpo?.p_filtros as object) ?? {}).length ? 12 : 743) : []);
    const r = await leerContactos(cliente as never, "ws-1", { ...SIN_FILTROS_DE_CONTACTOS, q: "ana" }, 1);
    expect(r).toMatchObject({ cantidad: 12, total: 743, paginas: 1 });
  });

  it("una página más allá de la última muestra la última", async () => {
    responder = (url, cuerpo) => (url.pathname.endsWith("contactos_cantidad") ? 60 : [{ id: `p${cuerpo?.p_pagina}` }]);
    const r = await leerContactos(cliente as never, "ws-1", SIN_FILTROS_DE_CONTACTOS, 9);
    expect(r.pagina).toBe(2);
    expect(r.contactos).toEqual([{ id: "p2" }]);
  });
});
