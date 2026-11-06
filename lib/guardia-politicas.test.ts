import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FUNCION_DE_BUSQUEDA, politicasSinMencionar } from "./guardia-politicas";

/**
 * La guardia de la búsqueda de la bandeja (retrabajo de F35, 04/11/2026,
 * pedida por Marcos). `bandeja_busca_con_acceso` (00045) se saltea la
 * seguridad por filas de `messages`, `conversations`, `contacts` y
 * `contact_channels` y repite a mano sus condiciones de `deleted_at`. Si una
 * migración posterior a la 00046 cambia una política de esas tablas sin
 * nombrar la función, la función puede quedar comprobando otra cosa que la
 * regla. Este test lo frena: quien cambie la política tiene que mirar la
 * función y decirlo en la migración.
 */

const MIGRACIONES = join(__dirname, "..", "supabase", "migrations");
const temporales: string[] = [];
function carpeta(archivos: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "guardia-politicas-"));
  temporales.push(dir);
  for (const [nombre, sql] of Object.entries(archivos)) writeFileSync(join(dir, nombre), sql);
  return dir;
}
afterAll(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

describe("la guardia de las políticas que repite bandeja_busca_con_acceso", () => {
  it("ninguna migración posterior a la 00046 toca esas políticas sin nombrar la función", () => {
    expect(politicasSinMencionar(MIGRACIONES, 46)).toEqual([]);
  });

  it("control: detecta create, alter y drop policy sobre las cuatro tablas, con o sin public.", () => {
    const dir = carpeta({
      "00047_a.sql": 'drop policy if exists "x" on messages;',
      "00048_b.sql": 'create policy "y"\n  on public.conversations for select to authenticated using (true);',
      "00049_c.sql": 'alter policy "z" on contacts using (true);',
      "00050_d.sql": 'create policy "w" on public.contact_channels for select using (true);',
    });
    expect(politicasSinMencionar(dir, 46)).toEqual(["00047_a.sql", "00048_b.sql", "00049_c.sql", "00050_d.sql"]);
  });

  it("control: si la migración nombra la función, pasa", () => {
    const dir = carpeta({ "00047_a.sql": `-- revisado contra ${FUNCION_DE_BUSQUEDA}\ndrop policy if exists "x" on messages;` });
    expect(politicasSinMencionar(dir, 46)).toEqual([]);
  });

  // Pendiente (d) del 05/11/2026, arreglado el 06/11 (ítem 6 del plan maestro):
  // nombrar la función de paso, por ejemplo en un comentario copiado de otra
  // migración, satisfacía la guardia. Ahora hace falta la línea explícita.
  it("una mención de paso de la función no alcanza: hace falta «revisado contra …»", () => {
    const dir = carpeta({
      "00047_a.sql": `-- La búsqueda vive en ${FUNCION_DE_BUSQUEDA} (00045), copiado de la 00046.\ndrop policy if exists "x" on messages;`,
      "00048_b.sql": `select '${FUNCION_DE_BUSQUEDA}';\ncreate policy "y" on conversations for select using (true);`,
    });
    expect(politicasSinMencionar(dir, 46)).toEqual(["00047_a.sql", "00048_b.sql"]);
  });

  it("control: otras tablas, migraciones hasta la 00046 y comentarios no cuentan", () => {
    const dir = carpeta({
      "00047_a.sql": 'create policy "t" on public.tags for select using (true);',
      "00046_b.sql": 'drop policy if exists "x" on messages;',
      "00048_c.sql": '-- drop policy "x" on messages;\nselect 1;',
      "ALL_MIGRATIONS.sql": 'drop policy if exists "x" on messages;',
    });
    expect(politicasSinMencionar(dir, 46)).toEqual([]);
  });
});
