import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00047 (F35, tramo D de S8): `reabrir_por_seguimiento`, la reapertura el
 * día del próximo seguimiento. Las condiciones del plan aprobado por Marcos el
 * 04/11/2026: solo las cuatro clases de sentencias, solo esa función, sin
 * tocar ninguna política (la guardia de políticas, lib/guardia-politicas.test.ts),
 * ejecutable solo por `service_role`, y «hoy» con la misma cuenta que los
 * filtros (00046:50-53).
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = join(DIR, "00047_reapertura_seguimiento.sql");
const sql = () => readFileSync(ARCHIVO, "utf8");
const sentencias = () =>
  sql()
    .replace(/\$\$[\s\S]*?\$\$/g, "$$$$")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);

describe("la migración 00047, reabrir_por_seguimiento", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("solo tiene create or replace function, revoke, grant y comment", () => {
    expect(sentencias().filter((s) => !/^(create or replace function |revoke |grant |comment on function )/.test(s))).toEqual([]);
  });

  it("solo toca reabrir_por_seguimiento", () => {
    expect(sentencias().filter((s) => !s.includes("function public.reabrir_por_seguimiento("))).toEqual([]);
  });

  it("es security invoker, con search_path vacío", () => {
    const t = sql().toLowerCase();
    expect(t).toContain("security invoker");
    expect(t).not.toContain("security definer");
    expect(t).toMatch(/set search_path = ''/);
  });

  it("la ejecuta solo service_role: se le quita a public, anon y authenticated", () => {
    const s = sentencias();
    expect(s).toContain("revoke all on function public.reabrir_por_seguimiento(uuid, timestamptz) from public, anon, authenticated");
    expect(s).toContain("grant execute on function public.reabrir_por_seguimiento(uuid, timestamptz) to service_role");
    expect(s.filter((x) => x.startsWith("grant ")).join(" ")).not.toMatch(/\b(anon|authenticated)\b/);
  });

  it("«hoy» es el de la zona del espacio, con el mismo coalesce que los filtros, y reabre con <=", () => {
    const t = sql();
    expect(t).toContain("coalesce((select w.zona_horaria from public.workspaces w where w.id = p_workspace), 'America/Costa_Rica')");
    expect(t).toMatch(/next_followup_date <= \(p_ahora at time zone/);
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 47: REAPERTURA SEGUIMIENTO\n-- ============================================================\n${sql().trim()}`);
  });
});
