import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PipelineStage } from "@/lib/types/database";

/**
 * Las migraciones de F25 (00029) y de §7.1 (00030), leídas como texto.
 *
 * Esto no prueba que las restricciones funcionen: eso lo prueba
 * `scripts/verify-contacto-extendido.mjs` contra la base real, con las dos
 * mitades de cada una. Lo que atrapa acá, en cada `npm test`, es que alguien
 * edite la lista de etapas en un solo lado, o que la migración pierda una
 * columna o su idempotencia.
 */

const raiz = join(__dirname, "..");
const leer = (r: string) => readFileSync(join(raiz, r), "utf8");
const m29 = leer("supabase/migrations/00029_contacto_extendido.sql");
const m30 = leer("supabase/migrations/00030_contacto_estado_comercial.sql");

const etapasDelPlano = leer("docs/requerimientos-fase1.md")
  .split("**Los trece valores de `pipeline_stage`**")[1]
  .split("```")[1]
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

describe("00029, F25", () => {
  it("agrega las 13 columnas de F25 más phone_resolved, de forma idempotente", () => {
    for (const c of [
      "phone", "phone_resolved", "secondary_email", "country", "whatsapp_phone", "next_followup_date",
      "do_not_contact", "do_not_contact_reason", "do_not_contact_at", "ai_conversation_summary",
      "lead_temperature", "attribution", "deleted_at", "display_name_source",
    ]) {
      expect(m29, c).toMatch(new RegExp(`add column if not exists ${c}\\b`));
    }
  });

  it("no agrega instagram_username: el handle es por canal (22/09/2026)", () => {
    expect(m29).not.toMatch(/add column[^\n]*instagram_username/);
  });

  it("next_followup_date es date, sin hora (§7.1)", () => {
    expect(m29).toMatch(/next_followup_date date,/);
  });

  it("el check del teléfono es el de §14: +, primer dígito 1-9, hasta 15, sin mínimo", () => {
    expect(m29).toContain("phone ~ '^\\+[1-9][0-9]{0,14}$'");
  });

  it("no toca los campos personalizados ni las policies de contacts", () => {
    expect(m29).not.toMatch(/alter table (public\.)?(custom_fields|contact_custom_fields)/);
    expect(m29).not.toMatch(/create policy/i);
  });
});

describe("00030, §7.1", () => {
  it("las 13 etapas del check son las de §7.1, carácter por carácter y en orden", () => {
    const bloque = m30.match(/pipeline_stage in \(([\s\S]*?)\)\);/)![1];
    const enLaMigracion = [...bloque.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    expect(etapasDelPlano).toHaveLength(13);
    expect(enLaMigracion).toEqual(etapasDelPlano);
  });

  it("el tipo PipelineStage lista las mismas 13", () => {
    const tipos = leer("lib/types/database.ts").match(/export type PipelineStage =([\s\S]*?);/)![1];
    const enElTipo = [...tipos.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(enElTipo).toEqual(etapasDelPlano);
    // Que compile también es la prueba: si una etapa del plano no está en el
    // tipo, esta asignación falla en `tsc`.
    const una: PipelineStage = "13. ¡Cerrada!";
    expect(etapasDelPlano).toContain(una);
  });

  it("deal_currency no tiene restricción de valores (§7.1)", () => {
    expect(m30).not.toMatch(/deal_currency[^;]*check/i);
  });
});
