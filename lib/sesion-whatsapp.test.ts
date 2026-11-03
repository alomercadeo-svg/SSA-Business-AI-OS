import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decidirEstado, lecturaDeAviso, registrarLectura, type LecturaDeSesion, type SesionGuardada } from "./sesion-whatsapp";
import type { SesionEstado } from "@/lib/types/database";

/**
 * Las reglas del estado de sesión de F32 y su escritura.
 *
 * Lo que NO prueba este archivo: que la base acepte los cinco estados (eso es
 * el `check` de la 00041, comparado en `sesion-whatsapp-migracion.test.ts`), ni
 * que Evolution mande lo que dice su código: eso se comprueba al vincular.
 */

const CANAL = "c-1";

interface Fila extends SesionGuardada {
  id: string;
  workspace_id: string;
  session_checked_at: string | null;
  session_changed_at: string | null;
}

/**
 * Un `channels` en memoria con lo justo: `select…eq…maybeSingle` y
 * `update…eq[…is][…or…select]`. `antesDelCambioDeEstado` corre justo antes del
 * `update` condicionado del estado, para simular a otro escritor en el medio.
 */
function canalFalso(inicial: Partial<Fila> = {}, opts: { antesDelCambioDeEstado?: (f: Fila) => void } = {}) {
  const fila: Fila = {
    id: CANAL,
    workspace_id: "ws-1",
    session_state: null,
    session_detail: null,
    session_linked_at: null,
    session_checked_at: null,
    session_changed_at: null,
    ...inicial,
  };

  function update(cambios: Partial<Fila>) {
    const filtros: Array<(f: Fila) => boolean> = [];
    let conEstado = false;
    const aplicar = () => {
      if (conEstado) opts.antesDelCambioDeEstado?.(fila);
      const pasa = filtros.every((p) => p(fila));
      if (pasa) Object.assign(fila, cambios);
      return pasa ? [{ id: fila.id }] : [];
    };
    const q = {
      eq(col: keyof Fila, v: unknown) {
        filtros.push((f) => f[col] === v);
        return q;
      },
      is(col: keyof Fila, v: null) {
        filtros.push((f) => f[col] === v);
        return q;
      },
      or(expr: string) {
        conEstado = true;
        // Solo la forma que usa el módulo: "session_state.is.null,session_state.neq.X".
        const distinto = expr.split(",")[1].split(".neq.")[1];
        filtros.push((f) => f.session_state === null || f.session_state !== distinto);
        return q;
      },
      select() {
        return Promise.resolve({ data: aplicar(), error: null });
      },
      then(res: (v: { error: null }) => void) {
        aplicar();
        res({ error: null });
      },
    };
    return q;
  }

  const servicio = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: { ...fila }, error: null }) };
            },
          };
        },
        update,
      };
    },
  };
  return { servicio: servicio as unknown as SupabaseClient, fila };
}

const leer = (estado: "open" | "connecting" | "close" | "refused"): LecturaDeSesion => ({ tipo: "estado", estado });
const sinRespuesta: LecturaDeSesion = { tipo: "sin_verificar", motivo: "sin_respuesta" };
const AHORA = new Date("2026-11-02T18:40:00-06:00");
const MARCA = "2026-11-01T10:00:00.000Z";

function guardada(estado: SesionEstado | null, detalle: string | null = null, marca: string | null = MARCA): SesionGuardada {
  return { session_state: estado, session_detail: detalle, session_linked_at: marca };
}

describe("decidirEstado", () => {
  it("open es conectado y pone la marca", () => {
    expect(decidirEstado(guardada(null, null, null), leer("open"))).toEqual({ estado: "conectado", detalle: "open", marcar: true });
  });

  it("refused es «se agotaron los intentos»", () => {
    expect(decidirEstado(guardada("conectado"), leer("refused")).estado).toBe("agotado");
  });

  it("un close después de agotado sigue siendo agotado (Evolution deja la instancia en close)", () => {
    expect(decidirEstado(guardada("agotado", "refused"), leer("close")).estado).toBe("agotado");
  });

  it("una lectura sin respuesta es «no se pudo verificar», nunca caído", () => {
    expect(decidirEstado(guardada("conectado"), sinRespuesta)).toEqual({ estado: "sin_verificar", detalle: "sin_respuesta", marcar: false });
  });

  it("un ownerJid no vacío pone la marca aunque la sesión no esté abierta", () => {
    expect(decidirEstado(guardada(null, null, null), leer("close"), true)).toEqual({ estado: "caido", detalle: "close", marcar: true });
  });

  describe("el mismo close, con y sin marca (control positivo 4 de Marcos)", () => {
    it("sin marca es «sin vincular»", () => {
      expect(decidirEstado(guardada(null, null, null), leer("close")).estado).toBe("sin_vincular");
    });
    it("con marca es caído", () => {
      expect(decidirEstado(guardada("conectado"), leer("close")).estado).toBe("caido");
    });
  });

  describe("connecting", () => {
    it("la primera vez, con marca y conectado, no cambia el estado y deja el detalle", () => {
      expect(decidirEstado(guardada("conectado", "open"), leer("connecting"))).toEqual({ estado: null, detalle: "connecting", marcar: false });
    });
    it("la segunda seguida, desde conectado, es caído", () => {
      expect(decidirEstado(guardada("conectado", "connecting"), leer("connecting")).estado).toBe("caido");
    });
    it("la segunda seguida, desde «no se pudo verificar», es caído", () => {
      expect(decidirEstado(guardada("sin_verificar", "connecting"), leer("connecting")).estado).toBe("caido");
    });
    it("sin marca no cambia: es una vinculación en curso", () => {
      expect(decidirEstado(guardada("sin_vincular", "connecting", null), leer("connecting")).estado).toBeNull();
    });
    it("con el estado en agotado no cambia: es una vinculación en curso", () => {
      expect(decidirEstado(guardada("agotado", "connecting"), leer("connecting")).estado).toBeNull();
    });
  });
});

describe("lecturaDeAviso", () => {
  it("lee el estado de connection.update, con puntos o con guiones bajos", () => {
    expect(lecturaDeAviso("connection.update", { instance: "x", state: "refused" })).toEqual({ tipo: "estado", estado: "refused" });
    expect(lecturaDeAviso("CONNECTION_UPDATE", { state: "open" })).toEqual({ tipo: "estado", estado: "open" });
  });
  it("otro evento no es una lectura, aunque traiga state", () => {
    expect(lecturaDeAviso("messages.upsert", { state: "open" })).toBeNull();
  });
  it("un state desconocido o ausente no se adivina", () => {
    expect(lecturaDeAviso("connection.update", { state: "pairing" })).toBeNull();
    expect(lecturaDeAviso("connection.update", {})).toBeNull();
    expect(lecturaDeAviso("connection.update", null)).toBeNull();
  });
});

describe("registrarLectura", () => {
  it("el close sin marca da «sin vincular» sin aviso; con marca, caído con aviso", async () => {
    const sin = canalFalso();
    const t1 = await registrarLectura(sin.servicio, CANAL, leer("close"), AHORA);
    expect(t1).toMatchObject({ de: null, a: "sin_vincular", avisar: false });

    const con = canalFalso({ session_state: "conectado", session_detail: "open", session_linked_at: MARCA });
    const t2 = await registrarLectura(con.servicio, CANAL, leer("close"), AHORA);
    expect(t2).toMatchObject({ de: "conectado", a: "caido", avisar: true, workspaceId: "ws-1" });
  });

  it("conectado → sin verificar → connecting → connecting termina en caído, con su aviso", async () => {
    const c = canalFalso({ session_state: "conectado", session_detail: "open", session_linked_at: MARCA });
    expect(await registrarLectura(c.servicio, CANAL, sinRespuesta, AHORA)).toMatchObject({ a: "sin_verificar", avisar: false });
    expect(await registrarLectura(c.servicio, CANAL, leer("connecting"), AHORA)).toBeNull();
    expect(c.fila.session_state).toBe("sin_verificar");
    expect(c.fila.session_detail).toBe("connecting");
    expect(await registrarLectura(c.servicio, CANAL, leer("connecting"), AHORA)).toMatchObject({ de: "sin_verificar", a: "caido", avisar: true });
  });

  it("ya caído, más connecting no es una transición nueva (sin segundo correo)", async () => {
    const c = canalFalso({ session_state: "caido", session_detail: "connecting", session_linked_at: MARCA });
    expect(await registrarLectura(c.servicio, CANAL, leer("connecting"), AHORA)).toBeNull();
    expect(c.fila.session_state).toBe("caido");
  });

  it("un open limpia la cuenta de connecting", async () => {
    const c = canalFalso({ session_state: "conectado", session_detail: "connecting", session_linked_at: MARCA });
    await registrarLectura(c.servicio, CANAL, leer("open"), AHORA);
    expect(c.fila.session_detail).toBe("open");
    expect(await registrarLectura(c.servicio, CANAL, leer("connecting"), AHORA)).toBeNull();
    expect(c.fila.session_state).toBe("conectado");
  });

  it("siempre guarda la hora y el detalle, aunque el estado no cambie", async () => {
    const c = canalFalso({ session_state: "conectado", session_detail: "open", session_linked_at: MARCA });
    expect(await registrarLectura(c.servicio, CANAL, leer("open"), AHORA)).toBeNull();
    expect(c.fila.session_checked_at).toBe(AHORA.toISOString());
  });

  it("la marca se pone una vez y no se pisa ni se borra", async () => {
    const c = canalFalso();
    await registrarLectura(c.servicio, CANAL, leer("open"), AHORA);
    expect(c.fila.session_linked_at).toBe(AHORA.toISOString());
    await registrarLectura(c.servicio, CANAL, leer("close"), new Date("2026-11-03T00:00:00Z"));
    await registrarLectura(c.servicio, CANAL, leer("open"), new Date("2026-11-04T00:00:00Z"));
    expect(c.fila.session_linked_at).toBe(AHORA.toISOString());
  });

  it("si otro escritor ya pasó el estado, esta lectura no es una transición (un solo correo)", async () => {
    const c = canalFalso(
      { session_state: "conectado", session_detail: "open", session_linked_at: MARCA },
      { antesDelCambioDeEstado: (f) => { f.session_state = "caido"; } },
    );
    expect(await registrarLectura(c.servicio, CANAL, leer("close"), AHORA)).toBeNull();
  });

  it("control positivo del anterior: sin otro escritor, la misma lectura sí es transición", async () => {
    const c = canalFalso({ session_state: "conectado", session_detail: "open", session_linked_at: MARCA });
    expect(await registrarLectura(c.servicio, CANAL, leer("close"), AHORA)).toMatchObject({ a: "caido", avisar: true });
  });

  it("refused manda aviso; el close que lee el chequeo después no es otra transición", async () => {
    const c = canalFalso({ session_state: "conectado", session_detail: "open", session_linked_at: MARCA });
    expect(await registrarLectura(c.servicio, CANAL, leer("refused"), AHORA)).toMatchObject({ a: "agotado", avisar: true });
    expect(await registrarLectura(c.servicio, CANAL, leer("close"), AHORA)).toBeNull();
    expect(c.fila.session_state).toBe("agotado");
  });
});
