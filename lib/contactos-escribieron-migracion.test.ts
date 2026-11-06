import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00051 (F43, el criterio del 05/11/2026; ítem 5 del plan maestro): el
 * filtro que deja afuera a los contactos que nunca escribieron. Con la clave
 * `escribieron` en `'si'`, contactos_filtrados devuelve solo los que tienen al
 * menos un mensaje del lead (`direction = 'inbound'`: así los guardan
 * lib/zernio-aviso.ts:124 y lib/evolution-guardado.ts:147; lo que escribe el
 * negocio, y sus ecos, entran como `outbound`).
 *
 * Solo reemplaza esa función, con la misma firma y `security invoker`
 * (`create or replace` conserva los permisos de la 00049), y conserva el
 * arreglo de la 00050.
 */
const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = process.env.MIGRACION_00051 ?? join(DIR, "00051_contactos_escribieron.sql");

const sql = () => readFileSync(ARCHIVO, "utf8");
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
const cuerpo = () => (sql().match(/\$\$([\s\S]*?)\$\$/)?.[1] ?? "").toLowerCase().replace(/\s+/g, " ");

describe("la migración 00051, el filtro de los que escribieron", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("solo reemplaza contactos_filtrados y la comenta", () => {
    const s = sentencias();
    expect(s).toHaveLength(2);
    expect(s[0].startsWith("create or replace function public.contactos_filtrados(p_workspace uuid, p_filtros jsonb)")).toBe(true);
    expect(s[1].startsWith("comment on function public.contactos_filtrados(uuid, jsonb)")).toBe(true);
  });

  it("sigue security invoker, sin definer", () => {
    expect(sql().toLowerCase()).not.toContain("security definer");
    expect(sentencias()[0]).toContain("security invoker");
  });

  it("lee la clave escribieron y, con 'si', exige un mensaje inbound en alguna conversación del contacto", () => {
    const c = cuerpo();
    expect(c).toContain("p_filtros->>'escribieron'");
    expect(c).toMatch(/exists \( select 1 from conversations \w+ join messages \w+ on \w+\.conversation_id = \w+\.id where \w+\.contact_id = c\.id and \w+\.direction = 'inbound' \)/);
  });

  it("conserva el arreglo de la 00050 (una palabra sin coincidencia cuenta como faltante)", () => {
    expect(cuerpo()).toMatch(/where not coalesce\(/);
    expect(cuerpo()).not.toMatch(/where not \(/);
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 51: CONTACTOS ESCRIBIERON\n-- ============================================================\n${sql().trim()}`);
  });
});
