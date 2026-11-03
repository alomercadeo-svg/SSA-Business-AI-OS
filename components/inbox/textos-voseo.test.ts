import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Los textos de la lista y del hilo de la bandeja, en voseo (tramo A de S8,
 * la regla de voseo del plano). Los de cerrar y reabrir, la etiqueta del
 * estado y su alerta son del tramo D; el panel del contacto, del tramo C.
 * «Sin nombre» es el mismo texto que pide F43, sin tildar nada de F43.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { ConversationList } = await import("./conversation-list");
const { MessageThread, MessageBubble } = await import("./message-thread");
const { InboxView } = await import("@/app/(dashboard)/dashboard/inbox/inbox-view");

const sinSeparadores = (html: string) => html.replace(/<!-- -->/g, "");
const fuente = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

const conversacion = {
  id: "c1", workspace_id: "ws-1", contact_id: "ct1", channel_id: "ch-1", platform: "instagram", status: "open",
  last_message_at: "2026-11-03T12:00:00Z", last_message_preview: null, unread_count: 0, created_at: "2026-11-01T12:00:00Z",
  is_automation_paused: true, contacts: { id: "ct1", display_name: null, avatar_url: null },
};

describe("la lista", () => {
  const html = (conversaciones: unknown[]) =>
    sinSeparadores(
      renderToStaticMarkup(
        createElement(ConversationList, {
          inicial: { conversaciones, hayMas: false, cantidades: { abiertas: 1, cerradas: 0, todas: 1 } },
          workspaceId: "ws-1",
          selectedId: null,
          onSelect: () => {},
        } as never),
      ),
    );

  it("se llama «Bandeja»", () => {
    expect(html([conversacion])).toContain(">Bandeja</h2>");
  });

  it("un contacto sin nombre dice «Sin nombre», y sin mensajes, «Sin mensajes»", () => {
    const h = html([conversacion]);
    expect(h).toContain("Sin nombre");
    expect(h).toContain("Sin mensajes");
    expect(h).not.toContain("Unknown");
    expect(h).not.toContain("No messages yet");
  });

  it("vacía, «No hay conversaciones»", () => {
    expect(html([])).toContain("No hay conversaciones");
  });
});

describe("el hilo", () => {
  it("sin conversación elegida", () => {
    const h = renderToStaticMarkup(createElement(MessageThread, { conversation: null, messages: [] }));
    expect(h).toContain("Elegí una conversación");
    expect(h).toContain("Elegí una de la lista para ver sus mensajes");
  });

  it("el encabezado, la automatización en pausa y el compositor", () => {
    const h = renderToStaticMarkup(createElement(MessageThread, { conversation: conversacion as never, messages: [] }));
    expect(h).toContain("Sin nombre");
    expect(h).toContain("Automatización en pausa");
    expect(h).toContain('placeholder="Escribí un mensaje..."');
    expect(h).toContain('aria-label="Enviar mensaje"');
    for (const viejo of ["Unknown", "Bot paused", "Type a message", "Send message"]) expect(h).not.toContain(viejo);
  });

  it("el estado de un mensaje enviado: «Entregado» o «No se envió»", () => {
    const base = { id: "m1", conversation_id: "c1", direction: "outbound", text: "hola", attachments: null, sent_by_flow_id: null, created_at: "2026-11-03T12:00:00Z" };
    expect(renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, status: "delivered" } as never }))).toContain("Entregado");
    expect(renderToStaticMarkup(createElement(MessageBubble, { message: { ...base, status: "failed" } as never }))).toContain("No se envió");
  });
});

describe("la vista de la bandeja", () => {
  it("el estado vacío, sin nombrar a Zernio", () => {
    const h = renderToStaticMarkup(
      createElement(InboxView, { inicial: { conversaciones: [], hayMas: false, cantidades: { abiertas: 0, cerradas: 0, todas: 0 } }, workspaceId: "ws-1" } as never),
    );
    expect(h).toContain("Todavía no hay conversaciones");
    expect(h).toContain("Si ya tenés conversaciones en Instagram, sincronizalas para traerlas a la bandeja.");
    expect(h).toContain("Sincronizar conversaciones");
    expect(h).not.toContain("Zernio");
  });

  it("los textos que solo aparecen en el navegador: el botón del panel y la sincronización", () => {
    // Sin los comentarios: lo que se mira es el texto de pantalla.
    const f = fuente("app/(dashboard)/dashboard/inbox/inbox-view.tsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const nuevo of ["Datos del contacto", 'aria-label="Mostrar los datos del contacto"', "Sincronizando...", "No se pudo sincronizar", "No se pudo sincronizar. Revisá la conexión."]) {
      expect(f).toContain(nuevo);
    }
    for (const viejo of ["Contact info", "Show contact info", "Syncing...", "Sync failed", "Failed to sync"]) expect(f).not.toContain(viejo);
  });
});
