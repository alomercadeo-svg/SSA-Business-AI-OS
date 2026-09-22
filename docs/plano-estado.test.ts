import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cada funcionalidad del plano declara su estado, con fecha.
 *
 * ── QUÉ PROBLEMA RESUELVE, QUE NO ES EL QUE PARECE ──────────────────────────
 *
 * Una auditoría del 22/09/2026 encontró que F21 decía "Estado: pendiente… el de
 * Evolution todavía no se desplegó" **cinco días después de haberlo desplegado y
 * verificado**. El tramo sobrevivió a una conciliación de documentos porque el
 * empalme fue verbatim, y verbatim también conserva lo vencido.
 *
 * Lo que hizo cara esa auditoría no fue corregir la frase: fue **encontrarla**.
 * Había que leer 1600 líneas de prosa buscando afirmaciones sobre el presente,
 * sin saber cuántas eran ni dónde estaban. De veintisiete funcionalidades, dos
 * declaraban su estado y veinticinco no decían nada, y "no dice nada" se lee
 * como "no hay nada que decir".
 *
 * Este test no comprueba que los estados sean **verdaderos**. Comprueba que
 * **existan y estén fechados**, que es lo que convierte la revisión de una
 * búsqueda en prosa en una lista de veintisiete líneas que alguien recorre al
 * cerrar cada bloque.
 *
 * ── LOS TRES LÍMITES, ESCRITOS PARA QUE NO SE REINTENTEN ────────────────────
 *
 * **Límite 1: no verifica veracidad, y no puede.** La veracidad de una
 * afirmación en prosa no la puede verificar un test sin adivinar. Comparar "no
 * se desplegó" en un documento contra "ejecutado y verificado" en otro exige
 * entender dos textos y decidir que hablan de la misma cosa. Un test así o pide
 * una lista de pares escrita a mano —que se desactualiza igual que lo que
 * vigila— o infiere, y ahí inventa. **No se intentó, y no es un pendiente.**
 * Los conteos son la excepción y por eso tienen el suyo, en
 * `docs/plano-conteos.test.ts`: un número no hay que interpretarlo.
 *
 * **Límite 2: la fecha puede mentir.** Nada impide escribir una fecha vieja, ni
 * dejar una de hace un año. Lo que la fecha da es una señal barata de
 * antigüedad para el que revisa, no una garantía.
 *
 * **Límite 3: "no verificado" es una respuesta legítima y a propósito.** El test
 * la acepta igual que "construido". Eso es deliberado: obligar a elegir entre
 * "construido" y "pendiente" empuja a inventar un "pendiente", **y un pendiente
 * inventado se lee exactamente igual que uno verificado**, que es justo lo que
 * este test existe para evitar. Un "no verificado" es información; un
 * "pendiente" adivinado es ruido con forma de dato.
 */

const PLANO = resolve(process.cwd(), "docs/requerimientos-fase1.md");
const plano = readFileSync(PLANO, "utf8");

interface Bloque {
  f: string;
  cabecera: string;
  estado: string | null;
}

/** Cada `#### F<N>: …` con la línea de estado que le sigue, si la tiene. */
export function bloquesDeFuncionalidad(fuente: string): Bloque[] {
  const partes = fuente.split(/(?=^#### F\d+[a-z]?:)/m).filter((p) => /^#### F/.test(p));
  return partes.map((p) => {
    const cabecera = p.split("\n")[0];
    const f = cabecera.match(/^#### (F\d+[a-z]?):/)![1];
    // Solo el arranque del bloque: un "**Estado" a mitad de camino es prosa.
    const m = p.slice(0, 900).match(/\*\*Estado[^\n]*/);
    return { f, cabecera, estado: m ? m[0] : null };
  });
}

/** Una fecha reconocible: "16 de septiembre de 2026" o "16/09/2026". */
export function tieneFecha(estado: string): boolean {
  return /\b\d{1,2}\s+de\s+\p{L}+\s+de\s+\d{4}/u.test(estado) || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(estado);
}

describe("la línea de estado de cada funcionalidad", () => {
  const bloques = bloquesDeFuncionalidad(plano);

  /**
   * El control positivo: si el formato de los encabezados cambiara, la lista
   * saldría vacía y los dos tests de abajo pasarían sin haber mirado nada.
   */
  it("el plano tiene funcionalidades que revisar", () => {
    expect(bloques.length).toBeGreaterThan(20);
    expect(bloques.map((b) => b.f)).toContain("F21");
  });

  it("todas declaran su estado", () => {
    const mudas = bloques.filter((b) => b.estado === null).map((b) => b.f);
    expect(
      mudas,
      `Estas funcionalidades no dicen nada sobre su estado, y "no dice nada" se lee ` +
        `como "no hay nada que decir". Agregá una línea **Estado: …** con fecha al ` +
        `principio del bloque. Si no sabés en qué estado está, **no verificado** es ` +
        `una respuesta válida y es mejor que un "pendiente" adivinado.`
    ).toEqual([]);
  });

  it("todas fechan su estado", () => {
    const sinFecha = bloques.filter((b) => b.estado && !tieneFecha(b.estado)).map((b) => b.f);
    expect(
      sinFecha,
      `Estas declaran estado sin fecha. Sin fecha no se puede saber si envejeció, ` +
        `que es exactamente cómo F21 dijo "todavía no se desplegó" durante cinco días ` +
        `después de haberse desplegado.`
    ).toEqual([]);
  });
});

describe("la regla que detecta una fecha", () => {
  it("acepta las dos formas que usa el proyecto", () => {
    expect(tieneFecha("**Estado: construido** (16 de septiembre de 2026)")).toBe(true);
    expect(tieneFecha("**Estado: construido** (17/09/2026)")).toBe(true);
  });

  it("rechaza un estado sin fecha", () => {
    expect(tieneFecha("**Estado: pendiente.** Todavía no se desplegó.")).toBe(false);
    expect(tieneFecha("**Estado: construido y probado**")).toBe(false);
  });
});
