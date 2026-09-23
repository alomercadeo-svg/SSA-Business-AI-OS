import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La migración de `integration_configs` (F24), leída como texto.
 *
 * Esto NO prueba la RLS: eso solo lo prueba una consulta contra la base con el
 * token de un Member, y está en `scripts/verify-integration-configs.mjs`. Lo que
 * sí atrapa este test, sin base y en cada `npm test`, es la clase de error que
 * rompe la RLS en silencio al escribir la migración: una política que usa
 * `is_workspace_member` en vez de `is_workspace_manager` (cualquier Member
 * leería las integraciones), una operación sin política, o la tabla fuera de
 * la publicación de Realtime (la pantalla no se enteraría de nada).
 *
 * Se vio en rojo antes de escribir la migración: el archivo no existía.
 */

const ARCHIVO = join(__dirname, "..", "supabase", "migrations", "00024_integration_configs.sql");
const sql = () => readFileSync(ARCHIVO, "utf8");

/** Las políticas de la tabla, cada una con su operación y su condición. */
function politicas(texto: string) {
  const re = /create policy "([^"]+)"\s+on (?:public\.)?integration_configs\s+for (\w+)[^;]*?(using|with check)\s*\(([\s\S]*?)\);/gi;
  return [...texto.matchAll(re)].map((m) => ({ nombre: m[1], operacion: m[2].toLowerCase(), cuerpo: m[0] }));
}

describe("la migración de integration_configs", () => {
  it("existe como migración numerada", () => {
    expect(existsSync(ARCHIVO), `falta ${ARCHIVO}`).toBe(true);
  });

  it("crea la tabla de forma idempotente, con estado, verificado_el y ultimo_error", () => {
    const t = sql();
    expect(t).toMatch(/create table if not exists (public\.)?integration_configs/i);
    expect(t).toMatch(/\bestado\b[^,]*check \(estado in \('conectado', 'desconectado', 'sin_verificar', 'sin_configurar'\)\)/i);
    expect(t).toMatch(/\bverificado_el\s+timestamptz/i);
    expect(t).toMatch(/\bultimo_error\s+text/i);
  });

  it("activa la RLS", () => {
    expect(sql()).toMatch(/alter table (public\.)?integration_configs enable row level security/i);
  });

  it("tiene una política por operación, y todas exigen manager", () => {
    const ps = politicas(sql());
    expect(ps.map((p) => p.operacion).sort()).toEqual(["delete", "insert", "select", "update"]);
    for (const p of ps) {
      expect(p.cuerpo, `la política "${p.nombre}" no exige manager`).toMatch(/is_workspace_manager\(workspace_id\)/);
      expect(p.cuerpo, `la política "${p.nombre}" deja pasar a un Member`).not.toMatch(/is_workspace_member/);
    }
  });

  it("cada create policy va precedido de su drop policy if exists", () => {
    const t = sql();
    for (const p of politicas(t)) {
      expect(t).toContain(`drop policy if exists "${p.nombre}" on integration_configs;`);
    }
  });

  it("suma la tabla a la publicación de Realtime sin fallar si ya está", () => {
    const t = sql();
    expect(t).toMatch(/pg_publication_tables/);
    expect(t).toMatch(/alter publication supabase_realtime add table (public\.)?integration_configs/i);
  });

  it("ninguna columna tiene nombre de secreto: las claves van a Vault", () => {
    const bloque = sql().match(/create table if not exists (?:public\.)?integration_configs \(([\s\S]*?)\n\);/i);
    expect(bloque).not.toBeNull();
    const columnas = bloque![1].split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c));
    for (const c of columnas) {
      expect(c.split("_").some((s) => ["secret", "token", "key", "password"].includes(s)), c).toBe(false);
    }
  });
});
