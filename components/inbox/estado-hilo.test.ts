import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { clasesDelHilo } from "@/lib/columnas-bandeja";
import { join } from "node:path";

/**
 * El estado de la conversación en el encabezado del hilo (F35, tramo D de S8):
 * «Abierta» o «Cerrada», un solo botón («Cerrar» o «Reabrir», como el prototipo)
 * y los avisos con `role="status"`, sin `alert` (la app no tiene avisos
 * flotantes).
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/dashboard/inbox", useSearchParams: () => new URLSearchParams() }));
const { MessageThread } = await import("./message-thread");

const sinSeparadores = (html: string) => html.replace(/<!-- -->/g, "");
const conversacion = (status: string) => ({
  id: "c1", workspace_id: "ws-1", contact_id: "ct1", channel_id: "ch-1", platform: "instagram", status,
  last_message_at: "2026-11-03T12:00:00Z", last_message_preview: null, unread_count: 0, created_at: "2026-11-01T12:00:00Z",
  is_automation_paused: false, contacts: { id: "ct1", display_name: "Ana", avatar_url: null },
});
const hilo = (status: string) => sinSeparadores(renderToStaticMarkup(createElement(MessageThread, { conversation: conversacion(status) as never, messages: [] })));

describe("el estado en el encabezado del hilo", () => {
  it("abierta: dice «Abierta» y ofrece un solo botón, «Cerrar»", () => {
    const h = hilo("open");
    expect(h).toContain(">Abierta<");
    expect(h).toMatch(/<button[^>]*>[^<]*Cerrar<\/button>/);
    expect(h).not.toMatch(/>Reabrir</);
  });

  it("cerrada: dice «Cerrada» y ofrece un solo botón, «Reabrir»", () => {
    const h = hilo("closed");
    expect(h).toContain(">Cerrada<");
    expect(h).toMatch(/<button[^>]*>[^<]*Reabrir<\/button>/);
    expect(h).not.toMatch(/>Cerrar</);
  });

  it("no quedan los textos del fork", () => {
    for (const s of ["open", "closed"]) {
      const h = hilo(s);
      expect(h).not.toMatch(/>(open|closed)</);
      expect(h).not.toContain("Close conversation");
      expect(h).not.toContain("Reopen conversation");
    }
    const fuente = readFileSync(join(process.cwd(), "components/inbox/message-thread.tsx"), "utf8");
    expect(fuente).not.toContain("alert(");
    expect(fuente).not.toContain("Failed to update conversation status");
  });
});

const modulo = await import("@/lib/estado-conversacion");

describe("cerrar y reabrir: los avisos y lo que se hace con la respuesta", () => {
  it("los avisos del plano", () => {
    expect(modulo.avisoDeCambio("closed")).toBe("Conversación cerrada");
    expect(modulo.avisoDeCambio("open")).toBe("Conversación reabierta");
    expect(modulo.AVISO_DE_FALLA_DE_ESTADO).toBe("No se pudo cambiar el estado de la conversación.");
  });

  it("200 es un cambio, con el estado que devolvió el servidor", () => {
    expect(modulo.resultadoDelCambio(200, { status: "closed" })).toEqual({ tipo: "cambiado", estado: "closed" });
  });

  it("409 con pide_seguimiento pide el próximo, con la fecha", () => {
    expect(modulo.resultadoDelCambio(409, { code: "pide_seguimiento", fecha: "2026-11-04" })).toEqual({ tipo: "pide_seguimiento", fecha: "2026-11-04" });
  });

  it("cualquier otra cosa es una falla, y el estado queda como estaba", () => {
    expect(modulo.resultadoDelCambio(500, null)).toEqual({ tipo: "fallo" });
    expect(modulo.resultadoDelCambio(404, { error: "x" })).toEqual({ tipo: "fallo" });
    expect(modulo.resultadoDelCambio(200, { status: "snoozed" })).toEqual({ tipo: "fallo" });
    expect(modulo.resultadoDelCambio(409, { code: "otra" })).toEqual({ tipo: "fallo" });
  });

  it("el hilo cambia el estado por la ruta, no desde el navegador, y sigue el estado que llega por Realtime", () => {
    const fuente = readFileSync(join(process.cwd(), "components/inbox/message-thread.tsx"), "utf8");
    expect(fuente).toContain("cambiarEstadoDeConversacion(");
    expect(fuente).not.toMatch(/\.update\(\{\s*status\s*\}\)/);
    expect(fuente).toMatch(/payload\.new[^;]*status/);
  });
});

/**
 * S8, tramo 7: el estado se lee como texto, sin el recuadro que lo hacía
 * parecer un botón, y el único botón es «Cerrar» o «Reabrir». Decidido el
 * 05/11/2026 (texto sin recuadro, aunque el prototipo no muestra el estado).
 */
const { VistaDelEstado } = await import("./estado-conversacion");
const vista = (estado: string) => sinSeparadores(renderToStaticMarkup(createElement(VistaDelEstado, { estado })));
const casos = [
  { estado: "open", texto: "Abierta", boton: "Cerrar" },
  { estado: "closed", texto: "Cerrada", boton: "Reabrir" },
];

describe("el estado del encabezado es texto y hay un solo botón", () => {
  it("el estado no tiene recuadro: ni redondeo, ni fondo, ni relleno", () => {
    for (const c of casos) {
      const m = vista(c.estado).match(new RegExp(`<(\\w+)([^>]*)>${c.texto}<`));
      expect(m, c.texto).not.toBeNull();
      const clases = m![2].match(/class="([^"]*)"/)?.[1] ?? "";
      expect(clases, c.texto).not.toMatch(/(^|\s)(rounded|bg-|px-|py-|border)/);
    }
  });

  it("el estado no es un botón", () => {
    for (const c of casos) {
      const h = vista(c.estado);
      expect(h).toContain(`>${c.texto}<`);
      expect(h).not.toMatch(new RegExp(`<button[^>]*>[^<]*${c.texto}`));
    }
  });

  it("hay un solo botón, «Cerrar» o «Reabrir», según corresponda", () => {
    for (const c of casos) {
      const botones = vista(c.estado).match(/<button[^>]*>.*?<\/button>/g) ?? [];
      expect(botones).toHaveLength(1);
      expect(botones[0]).toMatch(new RegExp(`>${c.boton}</button>$`));
    }
  });
});

/**
 * S8, tramo 8: con un nombre largo, el encabezado (alto fijo, h-14) no se
 * desborda. El nombre se corta en una línea con «…» y queda completo en el
 * `title`; el grupo del nombre puede achicarse y el del estado no. Miran las
 * clases, no el dibujo: que el corte se vea bien lo confirma la pantalla.
 */
const NOMBRE_LARGO = "The Consultour ® Consultorías turísticas de prueba con un nombre muy largo";
const hiloLargo = () =>
  sinSeparadores(
    renderToStaticMarkup(
      createElement(MessageThread, {
        conversation: { ...conversacion("open"), contacts: { id: "ct1", display_name: NOMBRE_LARGO, avatar_url: null } } as never,
        messages: [],
      }),
    ),
  );
const clasesDe = (m: RegExpMatchArray | null) => (m ? m[1].split(/\s+/) : []);

describe("el encabezado con un nombre largo no se desborda", () => {
  // Reescrito en el tramo 9: antes exigía el corte en una sola línea
  // («truncate»); Marcos pidió dos filas (05/11/2026).
  it("el nombre ocupa hasta dos filas y queda completo en el title", () => {
    const h = hiloLargo();
    const m = h.match(new RegExp(`<a [^>]*class="([^"]*)"[^>]*>${NOMBRE_LARGO}</a>`));
    expect(m, "el enlace del nombre").not.toBeNull();
    expect(clasesDe(m)).toContain("line-clamp-2");
    expect(clasesDe(m)).not.toContain("truncate");
    expect(m![0]).toContain(`title="${NOMBRE_LARGO}"`);
  });

  it("el grupo del nombre puede achicarse", () => {
    const h = hiloLargo();
    const grupo = h.match(/<div class="flex h-14[^"]*"><div class="([^"]*)">/);
    expect(grupo, "el grupo de la izquierda").not.toBeNull();
    expect(clasesDe(grupo)).toContain("min-w-0");
    const contenedor = h.match(new RegExp(`<div class="([^"]*)"><a [^>]*>${NOMBRE_LARGO}</a>`));
    expect(contenedor, "el contenedor del nombre").not.toBeNull();
    expect(clasesDe(contenedor)).toContain("min-w-0");
  });

  it("el grupo del estado no se achica", () => {
    const h = hiloLargo();
    // F40: delante del estado puede ir la marca de la ventana de Instagram (prototipo-fase1.html:667).
    const grupo = h.match(/<div class="([^"]*)">(?:<span[^>]*>[^<]*<\/span>)?<div class="flex items-center gap-2"><span[^>]*>Abierta</);
    expect(grupo, "el grupo de la derecha").not.toBeNull();
    expect(clasesDe(grupo)).toContain("shrink-0");
  });
});

/**
 * S8, tramo 9: el nombre largo no puede ensanchar la columna del chat ni
 * achicar «Datos del contacto». Una columna flexible sin `min-w-0` no queda más
 * angosta que su contenido, y el panel, sin `shrink-0`, era el que cedía. Se
 * mira la fuente: las columnas están en componentes con datos y efectos.
 */
const clasesDelBloque = (archivo: string, despuesDe: string) => {
  const fuente = readFileSync(join(process.cwd(), archivo), "utf8");
  const i = fuente.indexOf(despuesDe);
  expect(i, despuesDe).toBeGreaterThanOrEqual(0);
  const m = fuente.slice(i).match(/<div className="([^"]*)"/);
  return m ? m[1].split(/\s+/) : [];
};

// Cambiado el 06/11/2026 (F35, teléfono): la columna del chat toma sus clases
// de `clasesDelHilo` (lib/columnas-bandeja.ts) y el panel es de 80 desde `md`.
// Lo que exige no cambia: en la computadora el chat puede achicarse y el panel no.
describe("las columnas de la bandeja con un nombre largo", () => {
  it("la columna del chat puede achicarse", () => {
    const fuente = readFileSync(join(process.cwd(), "app/(dashboard)/dashboard/inbox/inbox-view.tsx"), "utf8");
    expect(fuente).toMatch(/\{\/\* Center panel: Message thread \*\/\}[\s\S]{0,300}<div className=\{clasesDelHilo\(/);
    for (const hay of [true, false]) {
      const clases = clasesDelHilo(hay).split(/\s+/);
      expect(clases).toContain("flex-1");
      expect(clases).toContain("min-w-0");
    }
  });

  it("el panel «Datos del contacto» no se achica", () => {
    const clases = clasesDelBloque("components/inbox/contact-panel.tsx", "const loading = cargando;");
    expect(clases).toContain("md:w-80");
    expect(clases).toContain("shrink-0");
  });
});
