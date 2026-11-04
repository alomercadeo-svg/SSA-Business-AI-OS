import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00046 (retrabajo de la búsqueda de F35, 04/11/2026): `bandeja_filtrada`
 * pasa a llamar a `bandeja_busca_con_acceso` (00045). Condiciones de Marcos:
 * solo las cuatro clases de sentencias, solo esa función, y la misma de la
 * 00044 con una sola línea distinta. Sigue `security invoker`: los filtros y
 * la lista siguen pasando por la seguridad por filas de quien mira.
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = join(DIR, "00046_bandeja_filtrada_acceso.sql");
const sql = () => readFileSync(ARCHIVO, "utf8");
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
const creacionDe = (texto: string) => {
  const i = texto.indexOf("create or replace function public.bandeja_filtrada(");
  return i < 0 ? "" : texto.slice(i, texto.indexOf("$$;", i) + 3);
};

describe("la migración 00046, bandeja_filtrada con bandeja_busca_con_acceso", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("solo tiene create or replace function, revoke, grant y comment", () => {
    expect(sentencias().filter((s) => !/^(create or replace function |revoke |grant |comment on function )/.test(s))).toEqual([]);
  });

  it("solo toca bandeja_filtrada", () => {
    expect(sentencias().filter((s) => !s.includes("function public.bandeja_filtrada("))).toEqual([]);
  });

  it("es la bandeja_filtrada de la 00044 con una sola línea distinta: la llamada a la búsqueda", () => {
    const antes = creacionDe(readFileSync(join(DIR, "00044_bandeja_filtros.sql"), "utf8")).split("\n");
    const despues = creacionDe(sql()).split("\n");
    expect(despues.length).toBe(antes.length);
    const distintas = antes.map((l, i) => [l, despues[i]]).filter(([a, d]) => a !== d);
    expect(distintas).toEqual([["    and (d.q is null or bandeja_busca(cv.id, cv.contact_id, d.q))", "    and (d.q is null or bandeja_busca_con_acceso(cv.id, d.q))"]]);
  });

  it("sigue security invoker", () => {
    expect(creacionDe(sql()).toLowerCase()).toContain("security invoker");
    expect(sql().toLowerCase()).not.toContain("security definer");
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 46: BANDEJA FILTRADA ACCESO\n-- ============================================================\n${sql().trim()}`);
  });
});
