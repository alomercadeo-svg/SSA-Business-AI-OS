import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F42 en el hilo. Por la fuente: **no prueba el diseño en la pantalla** (eso lo
 * mira Marcos). El primero se escribió en rojo, antes de tocar el hilo.
 */
const hilo = readFileSync(resolve(__dirname, "message-thread.tsx"), "utf8");

describe("F42: el campo de una conversación de WhatsApp", () => {
  it("lee la sesión del canal y, caída, agotada o sin vincular, muestra el aviso del criterio en lugar del campo", () => {
    expect(hilo).toContain('.from("channels")');
    expect(hilo).toContain("session_state");
    expect(hilo).toMatch(/sesionImpideEnviar\(sesionWhatsapp\)\s*\?\s*\(/);
    expect(hilo).toContain("{AVISO_WHATSAPP_DESCONECTADO}");
  });

  it("un envío que falla no queda como enviado: se marca «No se envió» (criterio 7, control)", () => {
    expect(hilo).toContain('m.id === optimisticId ? { ...m, status: "failed" as const } : m');
    expect(hilo).toMatch(/message\.status === "failed"\s*\?\s*"No se envió"/);
    expect(hilo).toContain('setAvisoDeEnvio(errorData?.error || "No se envió.")');
  });
});
