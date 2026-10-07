import { describe, it, expect } from "vitest";
import { estadoDeCorreo, cuandoSeEnvio } from "./correos-enviados";

describe("pastilla de estado de la pestaña Correos enviados", () => {
  it("enviado en el primer intento es «Enviado», en verde", () => {
    expect(estadoDeCorreo("enviado", 1)).toEqual({ texto: "Enviado", tono: "ok" });
  });

  it("enviado en un reintento lo dice, como el prototipo", () => {
    expect(estadoDeCorreo("enviado", 2)).toEqual({ texto: "Enviado al segundo intento", tono: "warn" });
    expect(estadoDeCorreo("enviado", 4)).toEqual({ texto: "Enviado al cuarto intento", tono: "warn" });
  });

  it("pendiente y fallido", () => {
    expect(estadoDeCorreo("pendiente", 0).texto).toBe("Enviando");
    expect(estadoDeCorreo("pendiente", 2).texto).toBe("Reintentando");
    expect(estadoDeCorreo("fallido", 4)).toEqual({ texto: "Falló", tono: "danger" });
  });

  it("una omisión nunca se muestra como enviada", () => {
    expect(estadoDeCorreo("omitido_techo", 0).tono).toBe("danger");
  });
});

describe("cuándo", () => {
  it("se muestra en la zona del negocio", () => {
    // 21:20 UTC son las 15:20 en Costa Rica (UTC-6, sin horario de verano).
    expect(cuandoSeEnvio("2026-10-06T21:20:00Z")).toBe("6 oct 15:20");
  });
});
