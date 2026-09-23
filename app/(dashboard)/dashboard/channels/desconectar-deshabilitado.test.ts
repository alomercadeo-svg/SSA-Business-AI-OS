import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Ninguna pantalla puede llegar a `DELETE /api/v1/channels/[channelId]`.
 *
 * Esa ruta, heredada del fork, desconecta la cuenta en Zernio y después BORRA
 * la fila del canal, que arrastra en cascada sus conversaciones y mensajes. El
 * historial vive en la base local por decisión cerrada del proyecto, así que la
 * ruta no se puede usar hasta que se reemplace por una que marque el canal
 * inactivo (criterio de F24, 23/09/2026). Mientras tanto, el botón de la
 * pantalla de Canales dice "Desconectar no está disponible todavía".
 *
 * La ruta en sí no se tocó, a propósito: este test cuida que la interfaz no la
 * vuelva a alcanzar. Se vio en rojo antes de deshabilitar el botón, con
 * `channels-view.tsx` como único infractor.
 */

const RAIZ = join(__dirname, "..", "..", "..", "..");

function archivosDeInterfaz(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      // Las rutas de API no son interfaz: la propia ruta vive ahí.
      if (relative(RAIZ, ruta).split(/[\\/]/).join("/") === "app/api") continue;
      archivosDeInterfaz(ruta, salida);
    } else if (/\.(tsx?|jsx?)$/.test(nombre) && !/\.test\./.test(nombre)) {
      salida.push(ruta);
    }
  }
  return salida;
}

describe("la ruta que borra un canal con su historial", () => {
  const archivos = [...archivosDeInterfaz(join(RAIZ, "app")), ...archivosDeInterfaz(join(RAIZ, "components"))];

  /** Control positivo: si la búsqueda no encontrara archivos, el test no miraría nada. */
  it("hay archivos de interfaz que revisar, incluida la pantalla de Canales", () => {
    const rel = archivos.map((a) => relative(RAIZ, a).split(/[\\/]/).join("/"));
    expect(rel).toContain("app/(dashboard)/dashboard/channels/channels-view.tsx");
  });

  it("ningún archivo de interfaz que llama a /api/v1/channels hace un pedido DELETE", () => {
    const infractores = archivos
      .filter((a) => {
        const t = readFileSync(a, "utf8");
        // DELETE como método de un pedido. Un "DELETE" suelto puede ser otra
        // cosa: la pantalla de integraciones compara el tipo de un evento de
        // Realtime con ese texto.
        return t.includes("/api/v1/channels") && /method:\s*["'`]DELETE["'`]/.test(t);
      })
      .map((a) => relative(RAIZ, a));
    expect(
      infractores,
      "Estos archivos llaman a DELETE sobre /api/v1/channels, que borra el canal y su historial en cascada. " +
        "No se habilita desde la interfaz hasta reemplazar la ruta (criterio de F24)."
    ).toEqual([]);
  });

  it("el botón dice que desconectar no está disponible", () => {
    const vista = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/channels/channels-view.tsx"), "utf8");
    expect(vista).toContain("Desconectar no está disponible todavía");
  });
});
