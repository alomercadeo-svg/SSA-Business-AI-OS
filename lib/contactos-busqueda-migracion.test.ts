import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00050 (F43, tramo B de S9): la búsqueda de contactos_filtrados con los
 * datos vacíos bien contados. En la 00049, `not (a ilike p or b ilike p …)`
 * daba NULL con un dato nulo y ninguno que coincidiera, y el contacto pasaba
 * (la medición del 05/11/2026: «tania robles» contaba 800 de 800).
 *
 * Solo reemplaza esa función, con la misma firma y `security invoker`
 * (`create or replace` conserva los permisos que le dio la 00049).
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = process.env.MIGRACION_00050 ?? join(DIR, "00050_contactos_busqueda_nulos.sql");

const sql = () => readFileSync(ARCHIVO, "utf8");
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
const cuerpo = () => (sql().match(/\$\$([\s\S]*?)\$\$/)?.[1] ?? "").toLowerCase();

describe("la migración 00050 de la búsqueda de contactos", () => {
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

  it("una palabra sin coincidencia cuenta como faltante aunque haya datos nulos", () => {
    expect(cuerpo()).toMatch(/where not coalesce\(/);
    expect(cuerpo()).not.toMatch(/where not \(/);
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 50: CONTACTOS BUSQUEDA NULOS\n-- ============================================================\n${sql().trim()}`);
  });
});
