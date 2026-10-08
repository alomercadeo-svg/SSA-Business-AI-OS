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

  /**
   * Desde el 05/10/2026 la pantalla de Canales no tiene botón de borrar ni el
   * deshabilitado que lo reemplazó: manda a Integraciones para desconectar.
   */
  it("la pantalla de Canales no tiene botón de borrar y manda a Integraciones", () => {
    const vista = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/channels/channels-view.tsx"), "utf8");
    expect(vista).not.toContain("Desconectar no está disponible todavía");
    expect(vista).not.toMatch(/Trash2/);
    expect(vista).toContain('href="/dashboard/settings/integrations"');
  });
});

/**
 * El botón "Desconectar" de F24, en la pantalla de integraciones. Estuvo
 * deshabilitado del 23/09/2026 al 08/10/2026, hasta probarlo contra Zernio real
 * con una cuenta de prueba y la aprobación de Marcos: desconecta un canal vivo.
 * Desde el 08/10/2026 está habilitado, y el único camino a la acción es el
 * diálogo que pide escribir el nombre de la cuenta. Este bloque se invirtió ese
 * día y se vio en rojo antes de habilitar el botón.
 */
describe("el botón Desconectar de la pantalla de integraciones", () => {
  const archivos = [...archivosDeInterfaz(join(RAIZ, "app")), ...archivosDeInterfaz(join(RAIZ, "components"))];
  const VISTA = "app/(dashboard)/dashboard/settings/integrations/integrations-view.tsx";
  const DIALOGO = "app/(dashboard)/dashboard/settings/integrations/confirmar-desconexion.tsx";

  it("hay archivos de interfaz que revisar, incluida la pantalla de integraciones", () => {
    expect(archivos.map((a) => relative(RAIZ, a).split(/[\\/]/).join("/"))).toContain(VISTA);
  });

  it("la acción de desconectar se llama solo desde el diálogo que pide escribir el nombre", () => {
    const quienes = archivos
      .filter((a) => readFileSync(a, "utf8").includes("desconectarCuentaInstagram"))
      .map((a) => relative(RAIZ, a).split(/[\\/]/).join("/"));
    expect(quienes, "Solo el diálogo de confirmación puede llamar a la acción (criterio de F24).").toEqual([DIALOGO]);
  });

  it("la pantalla usa el diálogo y ya no dice que desconectar no está disponible", () => {
    const vista = readFileSync(join(RAIZ, VISTA), "utf8");
    expect(vista).toContain("ConfirmarDesconexion");
    expect(vista).not.toContain("Desconectar no está disponible todavía");
  });
});

/**
 * Apagar un canal es una desconexión de hecho: el receptor de Zernio responde
 * 404 a un canal inactivo y el de Evolution 503 (después de unos 20 minutos de
 * reintentos, el mensaje se pierde). Desde el 05/10/2026 ninguna pantalla
 * escribe is_active = false ni lo invierte; queda solo "Activar", y el único
 * camino que apaga es la acción de desconectar de F24, en el servidor.
 */
describe("el interruptor de la pantalla de Canales", () => {
  const archivos = [...archivosDeInterfaz(join(RAIZ, "app")), ...archivosDeInterfaz(join(RAIZ, "components"))];

  /**
   * La regla mira escrituras sobre `channels`, no cualquier `is_active`: la
   * pantalla de Growth activa y desactiva disparadores de flujos (`triggers`),
   * que es otra cosa. La primera versión de la regla la marcaba; se angostó
   * comprobando antes que siga atrapando la versión vieja de la pantalla de
   * Canales (`.from("channels").update({ is_active: !channel.is_active })`).
   */
  it("ningún archivo de interfaz escribe is_active = false en channels ni lo invierte", () => {
    const re = /from\(\s*["']channels["']\s*\)[\s\S]{0,300}?is_active:\s*(false|!)/;
    const infractores = archivos.filter((a) => re.test(readFileSync(a, "utf8"))).map((a) => relative(RAIZ, a));
    expect(infractores).toEqual([]);
  });

  it("la pantalla de Canales activa a través de la acción de servidor", () => {
    const vista = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/channels/channels-view.tsx"), "utf8");
    expect(vista).toContain("activarCanal");
    expect(vista).not.toContain("handleToggleActive");
  });
});
