import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00049 (F43, tramo B de S9): la lista de contactos en el servidor.
 *
 * Se aplica antes de subir el código que la usa, con las condiciones del OK
 * de Marcos del 05/11/2026: el archivo solo crea funciones y les da permisos,
 * no toca políticas ni tablas, y no redefine ninguna función de la bandeja
 * (la huella de esas funciones se compara antes y después del push).
 *
 * Las tres son `security invoker`: la seguridad por filas de `contacts` y
 * `contact_channels` decide qué ve cada uno. Con `security definer`, un Member
 * buscaría sobre todo el espacio.
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = join(process.env.MIGRACION_00049 ?? join(DIR, "00049_contactos_lista.sql"));
const FUNCIONES = ["contactos_filtrados", "contactos_pagina", "contactos_cantidad"];
const DE_LA_BANDEJA = [
  "bandeja_coincide",
  "bandeja_pagina",
  "bandeja_cantidades",
  "bandeja_busca",
  "bandeja_filtrada",
  "bandeja_pagina_filtros",
  "bandeja_cantidades_filtros",
  "bandeja_busca_con_acceso",
];

const sql = () => readFileSync(ARCHIVO, "utf8");
/** Las sentencias de primer nivel: sin los cuerpos `$$…$$` ni los comentarios. */
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);

describe("la migración 00049 de la lista de contactos", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("solo tiene create or replace function, revoke, grant y comment", () => {
    const otras = sentencias().filter(
      (s) => !/^(create or replace function |revoke |grant |comment on function )/.test(s),
    );
    expect(otras).toEqual([]);
  });

  it("no redefine, no revoca ni comenta ninguna función de la bandeja", () => {
    const tocan = sentencias().filter((s) => DE_LA_BANDEJA.some((f) => s.includes(`function public.${f}(`)));
    expect(tocan).toEqual([]);
  });

  it("las tres funciones son security invoker, ninguna definer", () => {
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

  it("no escribe: ni insert, ni update, ni delete, ni políticas", () => {
    const sinComentarios = sql().replace(/--.*$/gm, "").toLowerCase();
    expect(sinComentarios).not.toMatch(/\b(insert into|update \w|delete from|create policy|alter policy|drop policy|alter table)\b/);
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 49: CONTACTOS LISTA\n-- ============================================================\n${sql().trim()}`);
  });
});
