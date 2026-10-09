import { describe, it, expect, vi } from "vitest";
import { correrTareas, claveDeVigilancia } from "./tareas-programadas";
import { marcaVisible, marcaVencida } from "./tareas-estado";
import { HORARIO_POR_DEFECTO } from "./horas-habiles";

/**
 * La tarea de vigilancia de F39 y su marca de última ejecución, contra una base
 * falsa. `reservar_tarea` imita la 00032: escribe `ultima_ejecucion_at` al
 * TOMAR la tarea, así que también se mueve en una corrida que después falla.
 * Lo que se muestra es `ultimo_ok_at` (`lib/tareas-estado.ts`).
 */

type Fila = { clave: string; workspace_id: string; ultima_ejecucion_at?: string | null; ultimo_ok_at?: string | null; ocupada_hasta?: string | null; resultado?: unknown; ultimo_error?: string | null };

function baseFalsa(espacios: Array<Record<string, unknown>>) {
  const tareas = new Map<string, Fila>();
  const servicio = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      let cambio: Record<string, unknown> | null = null;
      const cadena: any = {
        select: () => cadena,
        eq: (c: string, v: unknown) => ((filtros[c] = v), cadena),
        update: (v: Record<string, unknown>) => ((cambio = v), cadena),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (ok: (r: unknown) => unknown) => {
          if (tabla === "workspaces") return Promise.resolve({ data: espacios, error: null }).then(ok);
          if (tabla === "channels") return Promise.resolve({ data: [], error: null }).then(ok);
          if (tabla === "tareas_estado" && cambio) {
            const f = tareas.get(String(filtros.clave));
            if (f) Object.assign(f, cambio);
            return Promise.resolve({ error: null }).then(ok);
          }
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      };
      return cadena;
    },
    rpc: vi.fn(async (fn: string, a: Record<string, any>) => {
      if (fn === "reservar_tarea") {
        const f = tareas.get(a.p_clave);
        if (f?.ocupada_hasta) return { data: false, error: null };
        // Modifica la MISMA fila, como la base: el test guarda la referencia.
        const fila = f ?? { clave: a.p_clave, workspace_id: a.p_workspace_id };
        Object.assign(fila, { ocupada_hasta: "ocupada", ultima_ejecucion_at: new Date().toISOString() });
        tareas.set(a.p_clave, fila);
        return { data: true, error: null };
      }
      if (fn === "resolve_webhook_alert") return { data: 0, error: null };
      return { data: null, error: { message: fn } };
    }),
  };
  return { servicio, tareas };
}

const sinZernio = { leerSecreto: async () => null };
const deps = { notificar: vi.fn(async () => null), auditar: vi.fn(async () => {}), ...sinZernio };
const ESPACIO = { id: "ws-1", zona_horaria: "America/Costa_Rica", horario_atencion: HORARIO_POR_DEFECTO };

describe("la tarea de vigilancia y su marca (F39)", () => {
  it("una corrida buena mueve la marca visible y libera la tarea", async () => {
    const { servicio, tareas } = baseFalsa([ESPACIO]);
    const r = await correrTareas({ servicio: servicio as never, ahora: new Date(), deps });
    const fila = tareas.get(claveDeVigilancia("ws-1"))!;
    expect(r.fallidas).toBe(0);
    expect(marcaVisible(fila)).not.toBeNull();
    expect(marcaVencida(fila)).toBe(false);
    expect(fila.ocupada_hasta).toBeNull();
    expect(fila.ultimo_error).toBeNull();
    expect(fila.resultado).toMatchObject({ silencio: { alerta: "ninguna" }, suscripcion: "sin_clave" });
  });

  it("una corrida que falla NO mueve la marca visible, aunque reservar_tarea mueva ultima_ejecucion_at", async () => {
    const espacio = { ...ESPACIO };
    const { servicio, tareas } = baseFalsa([espacio]);
    await correrTareas({ servicio: servicio as never, ahora: new Date(), deps });
    const fila = tareas.get(claveDeVigilancia("ws-1"))!;
    const marcaAntes = marcaVisible(fila);
    const ejecucionAntes = fila.ultima_ejecucion_at;
    await new Promise((ok) => setTimeout(ok, 5));

    espacio.horario_atencion = { lun: [] } as never; // la revisión tira
    const r = await correrTareas({ servicio: servicio as never, ahora: new Date(), deps });

    expect(r.fallidas).toBe(1);
    expect(fila.ultima_ejecucion_at).not.toBe(ejecucionAntes);
    expect(marcaVisible(fila)).toBe(marcaAntes);
    expect(fila.ultimo_error).toMatch(/horario/i);
    expect(fila.ocupada_hasta).toBeNull();
  });

  it("si otra corrida tiene la tarea tomada, no corre y no toca la marca", async () => {
    const { servicio, tareas } = baseFalsa([ESPACIO]);
    tareas.set(claveDeVigilancia("ws-1"), { clave: claveDeVigilancia("ws-1"), workspace_id: "ws-1", ocupada_hasta: "otra", ultimo_ok_at: null });
    const r = await correrTareas({ servicio: servicio as never, ahora: new Date(), deps });
    expect(r.ocupadas).toBe(1);
    expect(marcaVisible(tareas.get(claveDeVigilancia("ws-1")))).toBeNull();
  });

  it("con clave de Zernio, lee la suscripción y guarda lo leído sin el secreto", async () => {
    const { servicio, tareas } = baseFalsa([ESPACIO]);
    const leer = vi.fn(async () => ({
      registrado: true,
      url: "https://app.alomercadeo.com/api/webhooks/late",
      activo: true,
      eventos: ["message.received", "comment.received", "message.sent"],
      secreto: { largo: 64, ultimos4: "abcd" },
      otros: 0,
      verificado_el: "2026-10-09T19:00:00.000Z",
      error: null,
    }));
    await correrTareas({ servicio: servicio as never, ahora: new Date(), deps: { ...deps, leerSecreto: async () => "zk", leerSuscripcion: leer } });
    const fila = tareas.get(claveDeVigilancia("ws-1"))!;
    expect(leer).toHaveBeenCalledWith("zk");
    expect(fila.resultado).toMatchObject({ suscripcion: { faltan: [], alerta: "ninguna", leida_el: "2026-10-09T19:00:00.000Z" } });
    expect(JSON.stringify(fila.resultado)).not.toMatch(/abcd|ultimos4|secreto/);
  });

  it("una lectura fallida de la suscripción no frena la marca: el vigilante corrió", async () => {
    const { servicio, tareas } = baseFalsa([ESPACIO]);
    const leer = vi.fn(async () => ({ registrado: false, url: null, activo: null, eventos: [], secreto: null, otros: 0, verificado_el: "2026-10-09T19:00:00.000Z", error: "El proveedor no respondió a tiempo." }));
    const r = await correrTareas({ servicio: servicio as never, ahora: new Date(), deps: { ...deps, leerSecreto: async () => "zk", leerSuscripcion: leer } });
    const fila = tareas.get(claveDeVigilancia("ws-1"))!;
    expect(r.fallidas).toBe(0);
    expect(marcaVisible(fila)).not.toBeNull();
    expect(fila.resultado).toMatchObject({ suscripcion: { error: "El proveedor no respondió a tiempo.", alerta: "sin_leer" } });
  });
});
