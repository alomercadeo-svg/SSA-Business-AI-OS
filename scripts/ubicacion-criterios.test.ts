import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { PLANO, extraerCriterios, compararCriterios } from "./foto-criterios.mjs";
import { compararUbicaciones, lineasDeCommit, fueraDeFase1 } from "./ubicacion-criterios.mjs";

/**
 * La comparación por ubicación ve lo que la comparación por conjunto de textos
 * no veía: una copia de un texto duplicado que se borra, y una línea que se
 * muda de sección. Escrito el 23/09/2026 para verificar la lista de 128 de
 * `docs/auditoria-conciliacion.md`. Ese mismo día `compararCriterios` pasó a
 * comparar igual; sus casos trampa están en `docs/plano-criterios.test.ts`.
 *
 * Se vio en rojo antes del verde, con dos mutaciones: `agrupar` deduplicando
 * (como hacía el `Set` de `compararCriterios` hasta el 23/09/2026) y `clave` comparando solo el
 * nombre de la sección en vez de la ruta. Con cualquiera de las dos fallan el
 * caso sintético y el histórico.
 */

const VIEJO = [
  "#### F1: Uno",
  "",
  "- [ ] Duplicada",
  "- [ ] Se muda",
  "- [ ] Se queda",
  "",
  "#### F2: Dos",
  "",
  "- [ ] Duplicada",
  "",
  "### Bloque 1",
  "",
  "#### F6b: Algo",
  "",
  "- [ ] Cambia de padre",
].join("\n");

const NUEVO = [
  "#### F1: Uno",
  "",
  "- [ ] Duplicada",
  "- [ ] Se queda",
  "",
  "#### F2: Dos",
  "",
  "### Apéndice: plan B, escrito y sin construir",
  "",
  "#### F6b: Algo",
  "",
  "- [ ] Se muda",
  "- [ ] Cambia de padre",
].join("\n");

describe("control positivo del método, sobre un caso sintético", () => {
  /** Hasta el 23/09/2026 daba cero en las tres; ahora la guardia y el informe coinciden. */
  it("compararCriterios ve lo mismo que el informe", () => {
    const r = compararCriterios(extraerCriterios(VIEJO), NUEVO);
    expect(r.faltantes.map((c) => c.texto)).toEqual(["- [ ] Duplicada"]);
    expect(r.mudanzas.map((c) => c.texto).sort()).toEqual(["- [ ] Cambia de padre", "- [ ] Se muda"]);
  });

  it("la comparación por ubicación encuentra las dos", () => {
    const { menosCopias, mudanzas } = compararUbicaciones(extraerCriterios(VIEJO), extraerCriterios(NUEVO));
    expect(menosCopias.map((m) => [m.texto, m.antes.length, m.despues.length])).toEqual([["- [ ] Duplicada", 2, 1]]);
    expect(menosCopias[0].despues.map((x: { seccion: string }) => x.seccion)).toEqual(["F1: Uno"]);

    const muda = mudanzas.find((m) => m.texto === "- [ ] Se muda");
    expect(muda, "no encontró la línea mudada").toBeDefined();
    expect(muda!.cambiaFuncionalidad).toBe(true);
    expect(muda!.terminaFueraDeFase1).toBe(true);
    expect(mudanzas.find((m) => m.texto === "- [ ] Se queda")).toBeUndefined();

    // Misma sección, otro padre: lo que pasó con F6b y F6c en 584226f.
    const padre = mudanzas.find((m) => m.texto === "- [ ] Cambia de padre");
    expect(padre, "no encontró la línea que cambió de padre").toBeDefined();
    expect(padre!.cambiaFuncionalidad).toBe(false);
    expect(padre!.terminaFueraDeFase1).toBe(true);
  });

  it("un plano contra sí mismo no da copias perdidas ni mudanzas", () => {
    expect(compararUbicaciones(extraerCriterios(VIEJO), extraerCriterios(VIEJO))).toEqual({ menosCopias: [], mudanzas: [] });
  });

  it("reconoce el apéndice por la ruta, no por el nombre de la sección", () => {
    const [c] = extraerCriterios(NUEVO).filter((x) => x.texto === "- [ ] Se muda");
    expect(c.seccion).toBe("F6b: Algo");
    expect(fueraDeFase1(c.ruta)).toBe(true);
    expect(fueraDeFase1(["5. Funcionalidades", "Bloque 1: Fork", "F6b: Algo"])).toBe(false);
  });
});

describe("el caso histórico: ebc9702 contra 584226f", () => {
  let hayHistoria = true;
  try {
    execFileSync("git", ["cat-file", "-e", "584226f^{commit}"], { stdio: "ignore" });
  } catch {
    hayHistoria = false;
  }

  /** Sin líneas del plano de bloques, "ninguna de las 128 viene de ahí" no concluye nada. */
  it.skipIf(!hayHistoria)("lee los dos planos originales, no solo uno", () => {
    const viejas = lineasDeCommit("ebc9702");
    expect(viejas.filter((x) => x.archivo === "docs/requerimientos-fase1.md").length).toBeGreaterThan(100);
    expect(viejas.filter((x) => x.archivo === "docs/requerimientos-bloques-2-3-4.md").length).toBeGreaterThan(100);
  });

  it.skipIf(!hayHistoria)("encuentra la copia de F6 que el conjunto de textos no veía, y las mudanzas al apéndice", () => {
    const { menosCopias, mudanzas } = compararUbicaciones(lineasDeCommit("ebc9702"), lineasDeCommit("584226f", [PLANO]));
    expect(menosCopias.filter((m) => !m.despues.length)).toHaveLength(128);
    const parciales = menosCopias.filter((m) => m.despues.length);
    expect(parciales.map((m) => m.texto)).toEqual(["- [ ] El estado de la conexión es visible en `/settings/integrations`"]);
    expect(mudanzas.filter((m) => m.terminaFueraDeFase1)).toHaveLength(15);
  });
});
