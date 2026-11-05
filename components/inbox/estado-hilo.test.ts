import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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
