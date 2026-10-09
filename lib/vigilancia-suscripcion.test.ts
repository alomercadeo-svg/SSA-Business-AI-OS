import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { revisarSuscripcion, eventosFaltantes, textoDeSuscripcion, CONDICION_SUSCRIPCION } from "./vigilancia-suscripcion";
import { revisarSilencio } from "./vigilancia-canales";
import { resumenWebhook } from "./integraciones";
import { HORARIO_POR_DEFECTO } from "./horas-habiles";

/**
 * La suscripción de F39, con la respuesta de Zernio SIMULADA. Nunca se saca un
 * evento de la suscripción real: es una sola para las dos cuentas (decidido por
 * Marcos el 08/10/2026). La base es la misma falsa de la revisión de silencio:
 * una condición abierta por espacio, fuente y tipo, con contador.
 */

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/zernio-webhooks-settings.json"), "utf8"));

function baseFalsa(canales: Array<Record<string, unknown>> = []) {
  const alertas: Array<Record<string, any>> = [];
  let n = 0;
  const servicio = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      const cadena: any = {
        select: () => cadena,
        eq: (c: string, v: unknown) => ((filtros[c] = v), cadena),
        maybeSingle: async () => ({ data: tabla === "webhook_alerts" ? alertas.find((a) => a.id === filtros.id) ?? null : null, error: null }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: tabla === "channels" ? canales : null, error: null }).then(ok),
      };
      return cadena;
    },
    rpc: vi.fn(async (fn: string, a: Record<string, any>) => {
      const abierta = alertas.find((x) => !x.resolved_at && x.workspace_id === a.p_workspace_id && x.source === a.p_source && x.alert_condition === a.p_condition);
      if (fn === "record_webhook_alert") {
        if (abierta) return (abierta.occurrences++, (abierta.detail = a.p_detail), { data: abierta.id, error: null });
        const nueva = { id: `al-${++n}`, workspace_id: a.p_workspace_id, source: a.p_source, alert_condition: a.p_condition, detail: a.p_detail, occurrences: 1, resolved_at: null };
        alertas.push(nueva);
        return { data: nueva.id, error: null };
      }
      if (fn === "resolve_webhook_alert") {
        if (!abierta) return { data: 0, error: null };
        abierta.resolved_at = "cerrada";
        return { data: 1, error: null };
      }
      return { data: null, error: { message: fn } };
    }),
  };
  return { servicio, alertas };
}

/** La lectura de la suscripción, como la devuelve `leerWebhook`. */
const leida = (cuerpo: unknown) => async () => ({ ...resumenWebhook(cuerpo), verificado_el: "2026-10-09T19:00:00.000Z", error: null });
const sinEvento = (evento: string) => ({
  webhooks: fixture.cuerpo.webhooks.map((w: Record<string, unknown>) => ({ ...w, events: (w.events as string[]).filter((e) => e !== evento) })),
});

let notificar: ReturnType<typeof vi.fn>;
let auditar: ReturnType<typeof vi.fn>;
beforeEach(() => {
  notificar = vi.fn(async () => null);
  auditar = vi.fn(async () => {});
});

describe("la suscripción de Zernio (F39)", () => {
  it("el fixture real trae los tres eventos (control positivo de la base del test)", () => {
    expect(eventosFaltantes(resumenWebhook(fixture.cuerpo).eventos)).toEqual([]);
  });

  it("completa: no abre nada, y cierra una condición que estuviera abierta", async () => {
    const { servicio, alertas } = baseFalsa();
    await revisarSuscripcion({ servicio: servicio as never, workspaceId: "ws-1", leer: leida(sinEvento("message.sent")), notificar, auditar });
    expect(alertas).toHaveLength(1);
    const r = await revisarSuscripcion({ servicio: servicio as never, workspaceId: "ws-1", leer: leida(fixture.cuerpo), notificar, auditar });
    expect(r).toMatchObject({ faltan: [], alerta: "cerrada", error: null });
    expect(alertas[0].resolved_at).not.toBeNull();
  });

  it("con un evento sacado abre la condición, nombra cuál falta y manda un correo", async () => {
    const { servicio, alertas } = baseFalsa();
    const r = await revisarSuscripcion({ servicio: servicio as never, workspaceId: "ws-1", leer: leida(sinEvento("message.sent")), notificar, auditar });
    expect(r).toMatchObject({ faltan: ["message.sent"], alerta: "abierta" });
    expect(alertas[0]).toMatchObject({ source: "zernio", alert_condition: CONDICION_SUSCRIPCION, detail: "Falta: message.sent" });
    expect(notificar).toHaveBeenCalledTimes(1);
    // La segunda corrida suma, no vuelve a avisar.
    await revisarSuscripcion({ servicio: servicio as never, workspaceId: "ws-1", leer: leida(sinEvento("message.sent")), notificar, auditar });
    expect(notificar).toHaveBeenCalledTimes(1);
  });

  it("con un evento sacado, la condición se abre aunque el canal esté recibiendo mensajes", async () => {
    // El canal recibió hace 5 minutos: la revisión de silencio no ve nada.
    const ahora = new Date("2026-10-12T10:00:00-06:00");
    const canales = [{ id: "ig", platform: "instagram", username: "cuenta", is_active: true, umbral_silencio_horas: 8, last_inbound_at: "2026-10-12T09:55:00-06:00" }];
    const { servicio, alertas } = baseFalsa(canales);
    const silencio = await revisarSilencio({
      servicio: servicio as never,
      workspace: { id: "ws-1", zona_horaria: "America/Costa_Rica", horario_atencion: HORARIO_POR_DEFECTO },
      ahora,
      notificar,
      auditar,
    });
    expect(silencio.pasados).toEqual([]);
    await revisarSuscripcion({ servicio: servicio as never, workspaceId: "ws-1", leer: leida(sinEvento("message.sent")), notificar, auditar });
    expect(alertas.filter((a) => !a.resolved_at).map((a) => a.alert_condition)).toEqual([CONDICION_SUSCRIPCION]);
  });

  it("sin el webhook registrado, faltan los tres", async () => {
    const { servicio } = baseFalsa();
    const r = await revisarSuscripcion({ servicio: servicio as never, workspaceId: "ws-1", leer: leida({ webhooks: [] }), notificar, auditar });
    expect(r.faltan).toEqual(["message.received", "comment.received", "message.sent"]);
  });

  it("si la lectura falla, no abre ni cierra nada, y guarda el error", async () => {
    const { servicio, alertas } = baseFalsa();
    const r = await revisarSuscripcion({
      servicio: servicio as never,
      workspaceId: "ws-1",
      leer: async () => ({ registrado: false, url: null, activo: null, eventos: [], secreto: null, otros: 0, verificado_el: "2026-10-09T19:00:00.000Z", error: "El proveedor rechazó la clave (HTTP 401)." }),
      notificar,
      auditar,
    });
    expect(r).toMatchObject({ alerta: "sin_leer", error: "El proveedor rechazó la clave (HTTP 401)." });
    expect(alertas).toHaveLength(0);
    expect(servicio.rpc).not.toHaveBeenCalled();
  });

  it("no guarda el secreto ni su máscara en el resultado", async () => {
    const { servicio } = baseFalsa();
    const r = await revisarSuscripcion({ servicio: servicio as never, workspaceId: "ws-1", leer: leida(fixture.cuerpo), notificar, auditar });
    expect(Object.keys(r).sort()).toEqual(["activo", "alerta", "error", "eventos", "faltan", "leida_el", "registrado"]);
    expect(JSON.stringify(r)).not.toMatch(/secret|ultimos4|largo/);
  });
});

describe("qué dice la pantalla de la suscripción", () => {
  const base = { leida_el: "2026-10-09T19:00:00.000Z", registrado: true, activo: true, eventos: ["message.received", "comment.received", "message.sent"], faltan: [], error: null, alerta: "ninguna" as const };

  it("completa", () => {
    expect(textoDeSuscripcion(base)).toMatchObject({ titulo: "Avisos de Instagram suscritos: completos", tono: "ok" });
  });

  it("si la lectura falló, muestra el error y NUNCA «completos»", () => {
    const t = textoDeSuscripcion({ ...base, eventos: [], registrado: false, error: "El proveedor no respondió a tiempo.", alerta: "sin_leer" });
    expect(t.titulo).toBe("No se pudo leer la suscripción: El proveedor no respondió a tiempo.");
    expect(t.titulo).not.toContain("completos");
    expect(t.tono).toBe("error");
  });

  it("si falta un evento, dice cuál", () => {
    expect(textoDeSuscripcion({ ...base, faltan: ["message.sent"] })).toMatchObject({ titulo: "Avisos de Instagram suscritos: falta message.sent", tono: "error" });
  });

  it("sin lectura (nunca corrió o el espacio no tiene clave de Zernio), no afirma nada", () => {
    expect(textoDeSuscripcion(null).titulo).toBe("La suscripción todavía no se leyó.");
    expect(textoDeSuscripcion("sin_clave").titulo).toBe("Este espacio no tiene clave de Zernio: no hay suscripción que vigilar.");
  });
});
