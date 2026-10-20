import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Las columnas que pide la ficha (F30) existen de verdad. Contra las
 * migraciones, que son la fuente de verdad, no contra `lib/types/database.ts`
 * (se mantiene a mano). Existe porque la ficha pedía
 * `custom_field_definitions(name, slug, field_type)`, una columna que no
 * existe (es `type`, 00001:100): la consulta fallaba entera y la ficha no
 * mostraba ningún campo propio. Ni la suite ni `tsc` lo vieron; lo vio
 * `scripts/verify-ficha.mjs` contra producción el 20/10/2026.
 */
const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

function columnasDeLaTabla(sql: string, tabla: string): string[] {
  const m = sql.match(new RegExp(`create table (?:if not exists )?${tabla} \\(([\\s\\S]*?)\\n\\);`, "i"));
  if (!m) throw new Error(`no encontré la tabla ${tabla}`);
  return m[1]
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((c) => c && !/^(unique|primary|constraint|check|--)/i.test(c));
}

describe("la consulta de campos propios de la ficha", () => {
  it("pide solo columnas que existen en custom_field_definitions (00001)", () => {
    const pagina = leer("app/(dashboard)/dashboard/contacts/[contactId]/page.tsx");
    const sel = pagina.match(/custom_field_definitions\(([^)]*)\)/);
    expect(sel, "la ficha no pide custom_field_definitions").not.toBeNull();
    const pedidas = sel![1].split(",").map((c) => c.trim());
    const existentes = columnasDeLaTabla(leer("supabase/migrations/00001_initial_schema.sql"), "custom_field_definitions");
    expect(existentes).toContain("type");
    for (const c of pedidas) expect(existentes, `la columna «${c}» no existe`).toContain(c);
  });
});
