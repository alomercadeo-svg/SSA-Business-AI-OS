import { describe, it, expect, vi, beforeEach } from "vitest";
import { revisarSilencio, detalleDeSilencio, CONDICION_SILENCIO, FUENTE_SILENCIO } from "./vigilancia-canales";
import { HORARIO_POR_DEFECTO } from "./horas-habiles";

/**
 * La revisión de silencio de F39, contra una base falsa que imita lo que hacen
 * `record_webhook_alert` y `resolve_webhook_alert` (00022/00023): una sola
 * condición abierta por espacio, fuente y tipo, con contador.
 *
 * El correo es un doble (`notificar`), así que acá no existe el techo de una
 * hora de F23: si la segunda corrida no lo llama, es por el control de la
 * revisión, no por el techo.
 */

type Canal = {
  id: string;
  platform: string;
  username: string | null;
  display_name: string | null;
  instance_name: string | null;
  is_active: boolean;
  last_inbound_at: string | null;
  umbral_silencio_horas: number | null;
};
type Alerta = { id: string; workspace_id: string; source: string; alert_condition: string; detail: string | null; occurrences: number; resolved_at: string | null };

const WS = { id: "ws-1", zona_horaria: "America/Costa_Rica", horario_atencion: HORARIO_POR_DEFECTO };

function baseFalsa(canales: Canal[]) {
  const alertas: Alerta[] = [];
  let n = 0;
  const servicio = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      const cadena: any = {
        select: () => cadena,
        eq: (c: string, v: unknown) => ((filtros[c] = v), cadena),
        maybeSingle: async () => {
          if (tabla === "webhook_alerts") return { data: alertas.find((a) => a.id === filtros.id) ?? null, error: null };
          return { data: null, error: null };
        },
        then: (ok: (r: unknown) => unknown) => {
          if (tabla === "channels") return Promise.resolve({ data: canales.map((c) => ({ ...c })), error: null }).then(ok);
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      };
      return cadena;
    },
    rpc: vi.fn(async (fn: string, a: Record<string, any>) => {
      const abierta = alertas.find(
        (x) => !x.resolved_at && x.workspace_id === a.p_workspace_id && x.source === a.p_source && x.alert_condition === a.p_condition,
      );
      if (fn === "record_webhook_alert") {
        if (abierta) {
          abierta.occurrences += 1;
          abierta.detail = String(a.p_detail).slice(0, 200);
          return { data: abierta.id, error: null };
        }
        const nueva = { id: `al-${++n}`, workspace_id: a.p_workspace_id, source: a.p_source, alert_condition: a.p_condition, detail: String(a.p_detail).slice(0, 200), occurrences: 1, resolved_at: null };
        alertas.push(nueva);
        return { data: nueva.id, error: null };
      }
      if (fn === "resolve_webhook_alert") {
        if (!abierta) return { data: 0, error: null };
        abierta.resolved_at = "cerrada";
        return { data: 1, error: null };
      }
      return { data: null, error: { message: `rpc desconocida ${fn}` } };
    }),
  };
  return { servicio, alertas };
}

const canal = (id: string, ultimo: string | null, umbral: number | null = 8, extra: Partial<Canal> = {}): Canal => ({
  id,
  platform: "instagram",
  username: id,
  display_name: null,
  instance_name: null,
  is_active: true,
  last_inbound_at: ultimo,
  umbral_silencio_horas: umbral,
  ...extra,
});

// El lunes 12/10/2026 a las 12:30 de Costa Rica. Desde el viernes 17:00 son
// 8,5 horas hábiles (1 + 3 + 4,5).
const AHORA = new Date("2026-10-12T12:30:00-06:00");
const VIERNES_17 = "2026-10-09T17:00:00-06:00";
const LUNES_12 = "2026-10-12T12:00:00-06:00";

let notificar: ReturnType<typeof vi.fn>;
let auditar: ReturnType<typeof vi.fn>;
beforeEach(() => {
  notificar = vi.fn(async () => null);
  auditar = vi.fn(async () => {});
});

const correr = (servicio: unknown, ahora = AHORA) =>
  revisarSilencio({ servicio: servicio as never, workspace: WS, ahora, notificar, auditar });

describe("revisión de silencio (F39)", () => {
  it("un canal pasado de su límite abre la condición y manda UN correo", async () => {
    const { servicio, alertas } = baseFalsa([canal("pasado", VIERNES_17)]);
    const r = await correr(servicio);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ source: FUENTE_SILENCIO, alert_condition: CONDICION_SILENCIO, workspace_id: "ws-1", resolved_at: null });
    expect(notificar).toHaveBeenCalledTimes(1);
    expect(notificar).toHaveBeenCalledWith(alertas[0].id, expect.anything());
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ alerta: "abierta", pasados: [expect.objectContaining({ id: "pasado", horas: 8.5, umbral: 8 })] });
  });

  it("la corrida siguiente, con la condición abierta, no llama al correo (aunque el techo de una hora estuviera libre)", async () => {
    const { servicio, alertas } = baseFalsa([canal("pasado", VIERNES_17)]);
    await correr(servicio);
    const r = await correr(servicio, new Date(AHORA.getTime() + 10 * 60_000));
    expect(alertas).toHaveLength(1);
    expect(alertas[0].occurrences).toBe(2);
    expect(notificar).toHaveBeenCalledTimes(1);
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(r.alerta).toBe("sigue");
  });

  it("con dos canales pasados, recuperar uno no la cierra", async () => {
    const canales = [canal("uno", VIERNES_17), canal("dos", VIERNES_17)];
    const { servicio, alertas } = baseFalsa(canales);
    await correr(servicio);
    canales[0].last_inbound_at = LUNES_12;
    const r = await correr(servicio);
    expect(alertas[0].resolved_at).toBeNull();
    expect(alertas[0].detail).toContain("@dos");
    expect(alertas[0].detail).not.toContain("@uno");
    expect(servicio.rpc).not.toHaveBeenCalledWith("resolve_webhook_alert", expect.anything());
    expect(r.alerta).toBe("sigue");
  });

  it("con todos los canales vigilados dentro de su límite, se cierra", async () => {
    const canales = [canal("uno", VIERNES_17), canal("dos", VIERNES_17)];
    const { servicio, alertas } = baseFalsa(canales);
    await correr(servicio);
    canales[0].last_inbound_at = LUNES_12;
    canales[1].last_inbound_at = LUNES_12;
    const r = await correr(servicio);
    expect(alertas[0].resolved_at).not.toBeNull();
    expect(r.alerta).toBe("cerrada");
    expect(notificar).toHaveBeenCalledTimes(1);
  });

  it("un canal que nunca recibió nada no alerta", async () => {
    const { servicio, alertas } = baseFalsa([canal("nuevo", null, 1)]);
    const r = await correr(servicio);
    expect(alertas).toHaveLength(0);
    expect(notificar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ alerta: "ninguna", sinMarca: 1 });
  });

  it("fuera del horario las horas no avanzan: del sábado 12:00 al domingo 23:00 son 0", async () => {
    // 35 horas de reloj, ninguna hábil (el sábado cierra a las 12:00 y el
    // domingo no tiene franja). Con un umbral de 1 hora no alerta.
    const { servicio, alertas } = baseFalsa([canal("finde", "2026-10-10T12:00:00-06:00", 1)]);
    const r = await correr(servicio, new Date("2026-10-11T23:00:00-06:00"));
    expect(alertas).toHaveLength(0);
    expect(r.pasados).toEqual([]);
    expect(r.vigilados).toEqual([expect.objectContaining({ id: "finde", horas: 0 })]);
  });

  it("control positivo del anterior: el lunes a las 9:30 la misma marca ya pasó su límite de 1 hora", async () => {
    const { servicio, alertas } = baseFalsa([canal("finde", "2026-10-10T12:00:00-06:00", 1)]);
    await correr(servicio, new Date("2026-10-12T09:30:00-06:00"));
    expect(alertas).toHaveLength(1);
  });

  it("no vigila los canales sin umbral ni los inactivos", async () => {
    const { servicio, alertas } = baseFalsa([
      canal("sin-umbral", VIERNES_17, null),
      canal("inactivo", VIERNES_17, 8, { is_active: false }),
    ]);
    const r = await correr(servicio);
    expect(alertas).toHaveLength(0);
    expect(r.vigilados).toEqual([]);
  });

  it("estar justo en el límite no alerta; pasarlo, sí", async () => {
    const { servicio, alertas } = baseFalsa([canal("justo", VIERNES_17)]);
    await correr(servicio, new Date("2026-10-12T12:00:00-06:00")); // 8 de 8
    expect(alertas).toHaveLength(0);
    await correr(servicio, new Date("2026-10-12T12:01:00-06:00"));
    expect(alertas).toHaveLength(1);
  });

  it("un horario inválido hace fallar la revisión, en vez de no vigilar en silencio", async () => {
    const { servicio } = baseFalsa([canal("pasado", VIERNES_17)]);
    await expect(
      revisarSilencio({ servicio: servicio as never, workspace: { ...WS, horario_atencion: { lun: [] } }, ahora: AHORA, notificar, auditar }),
    ).rejects.toThrow(/horario/i);
  });
});

describe("el detalle de la alerta de silencio", () => {
  it("nombra los canales con sus horas", () => {
    const d = detalleDeSilencio([{ id: "a", nombre: "Instagram @uno", horas: 9.25, umbral: 8 }]);
    expect(d).toBe("Instagram @uno: 9,3 de 8 horas hábiles");
  });

  it("si no entran en 200 caracteres, dice cuántos son y nombra los primeros", () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, nombre: `Instagram @cuenta_con_nombre_largo_${i}`, horas: 20, umbral: 8 }));
    const d = detalleDeSilencio(muchos);
    expect(d.length).toBeLessThanOrEqual(200);
    expect(d).toMatch(/^12 canales: Instagram @cuenta_con_nombre_largo_0, /);
    expect(d).toMatch(/ y \d+ más$/);
  });
});
