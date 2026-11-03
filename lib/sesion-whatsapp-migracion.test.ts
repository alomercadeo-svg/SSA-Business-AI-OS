import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_TIPOS, SESION_ESTADOS } from "@/lib/types/database";

/**
 * Las dos listas cerradas que toca F32 (00041) viven dos veces: en un `check`
 * de la base y en un tipo de TypeScript. Este archivo hace que no se separen,
 * igual que el de las acciones del historial (`lib/auditoria.test.ts`).
 */

/** Los valores del `check` en la migración más nueva que lo define. */
function valoresDelCheck(patron: RegExp): string[] {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const conCheck = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((sql) => patron.test(sql));
  expect(conCheck.length).toBeGreaterThan(0);
  const bloque = conCheck[conCheck.length - 1].match(patron)![1];
  return [...bloque.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("las listas cerradas de F32", () => {
  it("los tipos de correo son los del check más nuevo de email_log", () => {
    // La 00027 lo creó en línea; desde la 00041 se redefine con nombre.
    expect(valoresDelCheck(/email_log_tipo_check check \(tipo in \(([\s\S]*?)\)\);/)).toEqual([...EMAIL_TIPOS]);
  });

  it("los estados de sesión son los del check más nuevo de channels", () => {
    expect(valoresDelCheck(/channels_session_state_check check \(session_state in \(([\s\S]*?)\)\);/)).toEqual([
      ...SESION_ESTADOS,
    ]);
  });
});
