import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { politicasSinMencionar } from "./guardia-politicas";

/**
 * La 00048 (F40, S9 tramo A): las columnas de la ventana de Instagram en
 * `conversations` y el filtro de ventana en `bandeja_filtrada`. Las condiciones
 * del plan aprobado por Marcos el 05/11/2026: idempotente (`if not exists`, el
 * `check` con su control previo, `create or replace`); solo esas sentencias;
 * `bandeja_filtrada` es la de la 00046 más la clave `ventana` y su condición,
 * con la misma firma y `security invoker`; sin el relleno (va aparte); sin
 * tocar políticas (la guardia de b067da0).
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = join(DIR, "00048_ventana_instagram.sql");
const sql = () => readFileSync(ARCHIVO, "utf8");
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
const funcion = (texto: string) => {
  const m = texto.match(/create or replace function public\.bandeja_filtrada[\s\S]*?\n\$\$;/);
  return m ? m[0].split("\n") : [];
};

describe("la migración 00048, la ventana de Instagram", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("agrega las dos columnas con if not exists", () => {
    const s = sentencias();
    expect(s).toContain("alter table public.conversations add column if not exists window_expires_at timestamptz");
    expect(s).toContain("alter table public.conversations add column if not exists window_source text");
  });

  it("el check de window_source va en un bloque do con su control previo, con 'mensaje' y 'ctwa'", () => {
    const t = sql();
    expect(t).toMatch(/do \$\$[\s\S]*if not exists \([\s\S]*conversations_window_source_check[\s\S]*check \(window_source in \('mensaje', 'ctwa'\)\)[\s\S]*end\s*\$\$;/);
  });

  it("solo tiene add column, el bloque do, create or replace function, comment, revoke y grant", () => {
    const permitidas = /^(alter table public\.conversations add column if not exists |do \$\$|create or replace function public\.bandeja_filtrada\(|comment on (function|column) |revoke |grant )/;
    expect(sentencias().filter((s) => !permitidas.test(s))).toEqual([]);
  });

  it("no rellena ni borra filas: sin update, insert ni delete", () => {
    const sinCuerpos = sql().replace(/--.*$/gm, "").toLowerCase();
    expect(sinCuerpos).not.toMatch(/\b(update|insert into|delete from)\b/);
  });

  it("bandeja_filtrada es la de la 00046 más las líneas de la ventana, nada más", () => {
    const antes = funcion(readFileSync(join(DIR, "00046_bandeja_filtrada_acceso.sql"), "utf8"));
    const ahora = funcion(sql());
    expect(antes.length).toBeGreaterThan(0);
    // Cada línea de la 00046 sigue, en el mismo orden.
    let i = 0;
    const agregadas: string[] = [];
    for (const l of ahora) {
      if (i < antes.length && l === antes[i]) i++;
      else agregadas.push(l.trim());
    }
    expect(i).toBe(antes.length);
    // Lo agregado: la clave del jsonb y la condición, solo Instagram.
    expect(agregadas[0]).toBe("nullif(p_filtros->>'ventana', '') as ventana,");
    const condicion = agregadas.slice(1).join(" ");
    expect(condicion).toContain("cv.platform = 'instagram'");
    expect(condicion).toContain("when 'abierta' then cv.window_expires_at > d.ahora");
    expect(condicion).toContain("when 'por_vencer' then cv.window_expires_at > d.ahora and cv.window_expires_at <= d.ahora + interval '2 hours'");
    expect(condicion).toContain("when 'cerrada' then cv.window_expires_at is null or cv.window_expires_at <= d.ahora");
    expect(condicion).toContain("d.ventana is null");
  });

  it("sigue con la misma firma y security invoker", () => {
    const t = sql().toLowerCase();
    expect(t).toContain("create or replace function public.bandeja_filtrada(p_workspace uuid, p_filtros jsonb)\nreturns setof public.conversations");
    expect(t).toContain("security invoker");
    expect(t).not.toContain("security definer");
  });

  it("no dispara la guardia de políticas", () => {
    expect(politicasSinMencionar(DIR, 46)).toEqual([]);
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 48: VENTANA INSTAGRAM\n-- ============================================================\n${sql().trim()}`);
  });
});
