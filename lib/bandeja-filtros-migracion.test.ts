import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00044 (F35, tramo B de S8): los filtros de la bandeja en el servidor.
 *
 * Se aplica antes de subir el código que la usa, con las condiciones que fijó
 * Marcos el 04/11/2026: el archivo solo crea funciones y les da permisos, y
 * **no redefine ninguna de las tres de la 00043**. El código que corre en
 * producción entre el push y el despliegue las sigue llamando con su firma; si
 * la 00044 cambiara sus parámetros, `create or replace` no las reemplazaría:
 * crearía otra con el mismo nombre (documentación de PostgreSQL, `CREATE
 * FUNCTION`), y PostgREST podría no saber cuál elegir. Por eso las nuevas
 * tienen nombre nuevo.
 *
 * Las cuatro son `security invoker`: la seguridad por filas de
 * `conversations`, `contacts`, `contact_tags` y `messages` decide qué ve cada
 * uno. Con `security definer`, un Member filtraría sobre todo el espacio.
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = join(DIR, "00044_bandeja_filtros.sql");
const FUNCIONES = ["bandeja_busca", "bandeja_filtrada", "bandeja_pagina_filtros", "bandeja_cantidades_filtros"];
const DE_LA_00043 = ["bandeja_coincide", "bandeja_pagina", "bandeja_cantidades"];

const sql = () => readFileSync(ARCHIVO, "utf8");
/** Las sentencias de primer nivel: sin los cuerpos `$$…$$` ni los comentarios. */
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);

describe("la migración 00044 de los filtros de la bandeja", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("solo tiene create or replace function, revoke, grant y comment", () => {
    const otras = sentencias().filter(
      (s) => !/^(create or replace function |revoke |grant |comment on function )/.test(s),
    );
    expect(otras).toEqual([]);
  });

  it("no redefine, no revoca ni comenta ninguna de las tres funciones de la 00043", () => {
    const tocan = sentencias().filter((s) => DE_LA_00043.some((f) => s.includes(`function public.${f}(`)));
    expect(tocan).toEqual([]);
  });

  it("las cuatro funciones son security invoker, ninguna definer", () => {
    const texto = sql().toLowerCase();
    expect(texto).not.toContain("security definer");
    for (const f of FUNCIONES) {
      const creacion = sentencias().find((s) => s.startsWith(`create or replace function public.${f}(`));
      expect(creacion, f).toBeDefined();
      expect(creacion, f).toContain("security invoker");
    }
  });

  it("cada una se le quita a public y anon y se le da a authenticated", () => {
    const todas = sentencias();
    for (const f of FUNCIONES) {
      expect(todas.some((s) => s.startsWith(`revoke all on function public.${f}(`) && s.endsWith("from public, anon")), f).toBe(true);
      expect(todas.some((s) => s.startsWith(`grant execute on function public.${f}(`) && s.endsWith("to authenticated")), f).toBe(true);
    }
  });

  it("«hoy» sale de workspaces.zona_horaria, no de la hora de UTC", () => {
    const texto = sql().toLowerCase();
    expect(texto).toContain("zona_horaria");
    expect(texto).toMatch(/at time zone/);
    expect(texto).not.toMatch(/current_date/);
  });

  it("va al final de ALL_MIGRATIONS.sql, con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8").trimEnd();
    expect(bundle.endsWith(sql().trim())).toBe(true);
    expect(bundle).toContain("-- MIGRATION 44: BANDEJA FILTROS");
  });
});
