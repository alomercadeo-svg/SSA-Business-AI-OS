import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00043 (F35, tramo A de S8): las funciones de la bandeja en el servidor.
 *
 * Se aplica antes de subir el código que las usa (decidido por Marcos el
 * 03/11/2026), con una condición: el archivo solo crea funciones y les da
 * permisos. Nada que cree o cambie tablas, políticas ni filas. Este test la
 * hace cumplir, y también que las tres sean `security invoker`: así la
 * seguridad por filas de `conversations` y `contacts` decide qué ve cada uno,
 * igual que una lectura directa. Con `security definer`, un Member vería las
 * conversaciones de todo el espacio.
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = join(DIR, "00043_bandeja_servidor.sql");
const FUNCIONES = ["bandeja_coincide", "bandeja_pagina", "bandeja_cantidades"];

const sql = () => readFileSync(ARCHIVO, "utf8");
/** Las sentencias de primer nivel: sin los cuerpos `$$…$$` ni los comentarios. */
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);

describe("la migración 00043 de la bandeja", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("solo tiene create or replace function, revoke, grant y comment", () => {
    const otras = sentencias().filter(
      (s) => !/^(create or replace function |revoke |grant |comment on function )/.test(s),
    );
    expect(otras).toEqual([]);
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

  // Hasta el 04/11/2026 exigía que el bundle *terminara* con la 00043, y la
  // 00044 lo dejaba en rojo. Ahora exige que esté entera, con su encabezado
  // justo antes; que esté en orden lo controla `lib/platforms.test.ts`.
  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    const encabezado = "-- MIGRATION 43: BANDEJA SERVIDOR\n-- ============================================================\n";
    expect(bundle).toContain(`${encabezado}${sql().trim()}`);
  });
});
