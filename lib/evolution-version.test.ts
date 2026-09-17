import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVOLUTION_IMAGEN, EVOLUTION_VERSION_ESPERADA } from "./evolution-version.mjs";

/**
 * El disparador que no depende de que nadie se acuerde de nada.
 *
 * El procedimiento de re-verificar `jwt_key` antes de subir de versión estaba
 * escrito en `docs/despliegue-evolution.md`, y eso no es un control: depende de
 * que alguien lea un documento antes de cambiar un tag en la interfaz de
 * Railway. Ahora la versión esperada vive en el repo, el procedimiento está en
 * el comentario de al lado, y tocarla hace fallar algo.
 *
 * Este archivo es la mitad que corre SIEMPRE, sin red y sin despliegue. La otra
 * mitad es `scripts/verify-evolution-deploy.mjs`, que compara contra el servidor
 * real y va en `npm run verify:security`.
 *
 * Cada uno atrapa una cosa distinta:
 *
 *   * Este: que alguien cambie el tag de la imagen y se olvide de la otra
 *     constante, que es el error más probable de los dos.
 *   * El otro: que lo desplegado no sea lo que el repo dice.
 */
describe("la versión fijada de Evolution", () => {
  it("la imagen y la versión esperada no se desincronizan", () => {
    // El tag de Docker lleva `v`, el package.json de Evolution no. Si alguien
    // sube la imagen a v2.4.0 y deja la versión esperada en 2.3.7, el
    // verificador del despliegue fallaría siempre contra un servidor correcto, y
    // el ruido terminaría con alguien apagando el control.
    expect(EVOLUTION_IMAGEN).toBe(`evoapicloud/evolution-api:v${EVOLUTION_VERSION_ESPERADA}`);
  });

  it("la imagen nunca apunta a latest", () => {
    // `latest` apunta a un build que no corresponde a ninguna release
    // etiquetada, comprobado contra Docker Hub. La plantilla oficial de Railway
    // lo usa, así que la tentación de "simplificar" a latest es real.
    expect(EVOLUTION_IMAGEN).not.toContain("latest");
    expect(EVOLUTION_IMAGEN).toMatch(/:v\d+\.\d+\.\d+$/);
  });

  it("el procedimiento de re-verificación sigue escrito al lado de la constante", () => {
    // El valor de estas constantes es que alguien lea el comentario cuando las
    // toque. Si el comentario se borra en una limpieza, el disparador queda pero
    // deja de decir qué hacer, que es la mitad que importa.
    const fuente = readFileSync(join(__dirname, "evolution-version.mjs"), "utf8");

    expect(fuente).toContain("webhook.controller.ts");
    expect(fuente).toContain("jwt_key");
    expect(fuente).toContain("ANTES DE CAMBIAR ESTOS VALORES");
  });
});
