import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00045 (retrabajo de la búsqueda de F35, 04/11/2026): la función nueva
 * `bandeja_busca_con_acceso`, que nada usa todavía (la conecta la 00046).
 *
 * Es `security definer`: se saltea la seguridad por filas de `messages`,
 * `contacts` y `contact_channels`, que hacía pagar el control de acceso por
 * cada mensaje (medido ese día: 2,7 s para contar 4650 mensajes como el
 * Owner, contra 3 ms sin la regla). A cambio, comprueba el acceso una vez por
 * conversación **llamando** a `can_see_conversation` y `can_see_contact`, sin
 * reescribirlas, y repite las condiciones de `deleted_at` de las políticas.
 * No recibe el contacto: lo lee de la conversación, así nadie la apunta a un
 * contacto ajeno. Condiciones de Marcos para el push: solo las cuatro clases
 * de sentencias, y nada de la 00043 ni de la 00044.
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = join(DIR, "00045_bandeja_busca_acceso.sql");
const ANTERIORES = ["bandeja_coincide", "bandeja_pagina", "bandeja_cantidades", "bandeja_busca", "bandeja_filtrada", "bandeja_pagina_filtros", "bandeja_cantidades_filtros"];

const sql = () => readFileSync(ARCHIVO, "utf8");
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
const cuerpo = () => (sql().match(/\$\$([\s\S]*?)\$\$/) ?? ["", ""])[1].toLowerCase();

describe("la migración 00045, bandeja_busca_con_acceso", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("solo tiene create or replace function, revoke, grant y comment", () => {
    expect(sentencias().filter((s) => !/^(create or replace function |revoke |grant |comment on function )/.test(s))).toEqual([]);
  });

  it("no toca ninguna función de la 00043 ni de la 00044", () => {
    expect(sentencias().filter((s) => ANTERIORES.some((f) => s.includes(`function public.${f}(`)))).toEqual([]);
  });

  it("recibe la conversación y lo buscado, no el contacto", () => {
    const creacion = sentencias().find((s) => s.startsWith("create or replace function public.bandeja_busca_con_acceso("));
    expect(creacion).toBeDefined();
    expect(creacion).toContain("bandeja_busca_con_acceso(p_conversacion uuid, p_busqueda text)");
  });

  it("es security definer, con search_path vacío", () => {
    const creacion = sentencias().find((s) => s.startsWith("create or replace function public.bandeja_busca_con_acceso("));
    expect(creacion).toContain("security definer");
    expect(creacion).toContain("set search_path = ''");
  });

  it("llama a can_see_conversation y a can_see_contact, y pide deleted_at nulo a la conversación y al contacto", () => {
    const c = cuerpo();
    expect(c).toMatch(/public\.can_see_conversation\(c\.workspace_id, c\.assigned_to, c\.contact_id\)/);
    expect(c).toMatch(/public\.can_see_contact\(k\.workspace_id, k\.setter_id, k\.vendedor_id\)/);
    expect(c).toMatch(/c\.deleted_at is null/);
    expect(c).toMatch(/k\.deleted_at is null/);
  });

  it("el comentario dice de qué línea de cada política sale cada deleted_at", () => {
    const texto = sql();
    for (const linea of ["00038:70-71", "00038:59-60", "00019:231-238", "00019:263-271"]) expect(texto).toContain(linea);
  });

  it("se le quita a public y anon y se le da a authenticated", () => {
    const todas = sentencias();
    expect(todas.some((s) => s.startsWith("revoke all on function public.bandeja_busca_con_acceso(") && s.endsWith("from public, anon"))).toBe(true);
    expect(todas.some((s) => s.startsWith("grant execute on function public.bandeja_busca_con_acceso(") && s.endsWith("to authenticated"))).toBe(true);
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 45: BANDEJA BUSCA ACCESO\n-- ============================================================\n${sql().trim()}`);
  });
});
