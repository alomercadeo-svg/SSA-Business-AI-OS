import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La 00052 (F36, Respuestas rápidas; ítem 6 del plan maestro, 06/11/2026), y
 * el `deleted_at` de respuestas rápidas del criterio de F30.
 *
 * Sigue el antecedente de la 00038 (decisión de la revisión del plan):
 * - leer: cualquier miembro del espacio, solo las no eliminadas (el Member las
 *   usa con «/» en la bandeja);
 * - crear y editar: solo Owner y Admin (§11.1: la sección es de managers), y
 *   nunca con `deleted_at` puesto: con `deleted_at is null` en el `using` y el
 *   `with check`, nadie elimina con un UPDATE directo;
 * - eliminar: solo por `eliminar_respuesta_rapida`, `security definer`, que
 *   exige `is_workspace_manager`;
 * - sin política de DELETE: la API no borra; borra solo la purga de F30.
 */
const DIR = join(__dirname, "..", "supabase", "migrations");
const ARCHIVO = process.env.MIGRACION_00052 ?? join(DIR, "00052_respuestas_rapidas.sql");

const sql = () => readFileSync(ARCHIVO, "utf8");
const sinComentarios = () => sql().replace(/--.*$/gm, "");
const plano = () => sinComentarios().replace(/\s+/g, " ").toLowerCase();
const cuerpo = () => (sinComentarios().match(/\$\$([\s\S]*?)\$\$/)?.[1] ?? "").replace(/\s+/g, " ").toLowerCase();

describe("la migración 00052, Respuestas rápidas", () => {
  it("existe", () => {
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("crea response_templates si no existe, con deleted_at y las columnas del atajo", () => {
    const p = plano();
    expect(p).toMatch(/create table if not exists public\.response_templates \(/);
    for (const col of ["workspace_id uuid not null references public.workspaces", "nombre text not null", "atajo text not null", "contenido text not null", "deleted_at timestamptz"]) {
      expect(p).toContain(col);
    }
  });

  it("el atajo es único entre las no eliminadas del espacio", () => {
    expect(plano()).toMatch(/create unique index if not exists \w+ on public\.response_templates \(workspace_id, atajo\) where deleted_at is null/);
  });

  it("activa la seguridad por filas", () => {
    expect(plano()).toContain("alter table public.response_templates enable row level security");
  });

  it("leer: miembros, solo las no eliminadas", () => {
    expect(plano()).toMatch(/create policy "[^"]+" on public\.response_templates for select to authenticated using \(deleted_at is null and public\.is_workspace_member\(workspace_id\)\)/);
  });

  it("crear: solo managers, nunca eliminada", () => {
    expect(plano()).toMatch(/create policy "[^"]+" on public\.response_templates for insert to authenticated with check \(deleted_at is null and public\.is_workspace_manager\(workspace_id\)\)/);
  });

  it("editar: solo managers, y no se elimina con un update directo", () => {
    expect(plano()).toMatch(
      /create policy "[^"]+" on public\.response_templates for update to authenticated using \(deleted_at is null and public\.is_workspace_manager\(workspace_id\)\) with check \(deleted_at is null and public\.is_workspace_manager\(workspace_id\)\)/,
    );
  });

  it("sin política de delete ni para anon", () => {
    expect(plano()).not.toMatch(/for delete/);
    expect(plano()).not.toMatch(/to anon/);
  });

  it("eliminar: una función security definer, con search_path fijo, que exige manager y marca la fecha", () => {
    const p = plano();
    expect(p).toMatch(/create or replace function public\.eliminar_respuesta_rapida\(p_id uuid\)/);
    expect(p).toContain("security definer");
    expect(p).toMatch(/set search_path = ''/);
    expect(cuerpo()).toContain("public.is_workspace_manager(");
    expect(cuerpo()).toMatch(/set deleted_at = now\(\)/);
    expect(p).toMatch(/revoke all on function public\.eliminar_respuesta_rapida\(uuid\) from public, anon/);
    expect(p).toMatch(/grant execute on function public\.eliminar_respuesta_rapida\(uuid\) to authenticated/);
  });

  it("updated_at con el disparador del fork, idempotente", () => {
    const p = plano();
    expect(p).toMatch(/drop trigger if exists set_updated_at on public\.response_templates/);
    expect(p).toMatch(/create trigger set_updated_at before update on public\.response_templates for each row execute function (public\.)?update_updated_at\(\)/);
  });

  it("está en ALL_MIGRATIONS.sql, entera y con su encabezado", () => {
    const bundle = readFileSync(join(DIR, "ALL_MIGRATIONS.sql"), "utf8");
    expect(bundle).toContain(`-- MIGRATION 52: RESPUESTAS RAPIDAS\n-- ============================================================\n${sql().trim()}`);
  });
});
