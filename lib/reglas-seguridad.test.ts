import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REGLAS_POR_DEFECTO,
  avisoDeTextoIdentico,
  decidirEnvio,
  demoraEspaciada,
  elegirVariante,
  leerConfiguracion,
  proporcionDeRespuesta,
  validarConfiguracion,
} from "./reglas-seguridad";

/**
 * F33 con el reloj fijado. Costa Rica es UTC−6 sin horario de verano. El
 * domingo 08/11/2026 a las 21:00 de Costa Rica es 2026-11-09T03:00:00Z.
 */
const CR = "America/Costa_Rica";
const base = { reglas: REGLAS_POR_DEFECTO, noContactar: false, seguimientosSinRespuesta: 0, zona: CR };

describe("decidirEnvio (F33)", () => {
  it("dentro del horario, envía (lunes 10:00 de Costa Rica)", () => {
    expect(decidirEnvio({ ...base, ahora: new Date("2026-11-09T16:00:00Z") })).toEqual({ tipo: "enviar" });
  });

  it("domingo a la noche se pospone al lunes 08:00 de Costa Rica, no se cancela", () => {
    expect(decidirEnvio({ ...base, ahora: new Date("2026-11-09T03:00:00Z") })).toEqual({
      tipo: "posponer",
      hasta: new Date("2026-11-09T14:00:00Z"),
      motivo: "fuera_de_horario",
    });
  });

  it("el sábado a las 20:00 ya es fuera de horario: pasa al lunes (el domingo no está)", () => {
    expect(decidirEnvio({ ...base, ahora: new Date("2026-11-15T02:00:00Z") })).toMatchObject({ tipo: "posponer", hasta: new Date("2026-11-16T14:00:00Z") });
  });

  it("de madrugada se pospone a las 08:00 del mismo día", () => {
    expect(decidirEnvio({ ...base, ahora: new Date("2026-11-10T09:30:00Z") })).toMatchObject({ tipo: "posponer", hasta: new Date("2026-11-10T14:00:00Z") });
  });

  it("con el horario apagado, envía a cualquier hora (control)", () => {
    const reglas = { ...REGLAS_POR_DEFECTO, horario: { ...REGLAS_POR_DEFECTO.horario, activo: false } };
    expect(decidirEnvio({ ...base, reglas, ahora: new Date("2026-11-09T03:00:00Z") })).toEqual({ tipo: "enviar" });
  });

  it("después de 3 seguimientos sin respuesta, corta", () => {
    expect(decidirEnvio({ ...base, seguimientosSinRespuesta: 3, ahora: new Date("2026-11-09T16:00:00Z") })).toEqual({ tipo: "cortar", motivo: "silencio" });
    expect(decidirEnvio({ ...base, seguimientosSinRespuesta: 2, ahora: new Date("2026-11-09T16:00:00Z") })).toEqual({ tipo: "enviar" });
  });

  it("el opt-out corta siempre, aunque todo lo demás esté apagado", () => {
    const todoApagado = {
      ...REGLAS_POR_DEFECTO,
      corte_silencio: { activo: false, seguimientos: 3 },
      horario: { ...REGLAS_POR_DEFECTO.horario, activo: false },
    };
    expect(decidirEnvio({ ...base, reglas: todoApagado, noContactar: true, ahora: new Date("2026-11-09T16:00:00Z") })).toEqual({ tipo: "cortar", motivo: "no_contactar" });
  });
});

describe("las demás reglas (F33)", () => {
  it("la variante es estable por contacto y se reparte entre todas", () => {
    const v = ["A", "B", "C"];
    expect(elegirVariante(v, "contacto-1:paso-1", true)).toBe(elegirVariante(v, "contacto-1:paso-1", true));
    const usadas = new Set(Array.from({ length: 60 }, (_, i) => elegirVariante(v, `contacto-${i}:paso-1`, true)));
    expect(usadas).toEqual(new Set(["A", "B", "C"]));
    expect(elegirVariante(v, "contacto-7:paso-1", false)).toBe("A");
  });

  it("avisa si el mismo texto va a muchas personas", () => {
    expect(avisoDeTextoIdentico(["Hola"], 25, 20)).toBe("El mismo texto va a 25 personas. Sumá variantes: un texto idéntico a muchos es la huella de un envío masivo.");
    expect(avisoDeTextoIdentico(["Hola"], 5, 20)).toBeNull();
    expect(avisoDeTextoIdentico(["Hola", "Buenas", "Qué tal"], 25, 20)).toBeNull();
  });

  it("la demora queda entre el mínimo y el máximo; apagado, 0", () => {
    expect(demoraEspaciada(REGLAS_POR_DEFECTO, () => 0)).toBe(45);
    expect(demoraEspaciada(REGLAS_POR_DEFECTO, () => 0.999999)).toBe(180);
    expect(demoraEspaciada({ ...REGLAS_POR_DEFECTO, espaciado: { activo: false, min_segundos: 45, max_segundos: 180 } }, () => 0.5)).toBe(0);
  });

  it("la proporción de respuesta, sobre los últimos 50, con el aviso bajo el 15 %", () => {
    const veces = (n: number, r: boolean) => Array.from({ length: n }, () => ({ respondido: r }));
    expect(proporcionDeRespuesta([], REGLAS_POR_DEFECTO)).toEqual({ porcentaje: null, aviso: false });
    expect(proporcionDeRespuesta([...veces(5, true), ...veces(45, false)], REGLAS_POR_DEFECTO)).toEqual({ porcentaje: 10, aviso: true });
    expect(proporcionDeRespuesta([...veces(10, true), ...veces(40, false)], REGLAS_POR_DEFECTO)).toEqual({ porcentaje: 20, aviso: false });
    // Solo cuentan los últimos 50 (los más nuevos van al final).
    expect(proporcionDeRespuesta([...veces(50, true), ...veces(50, false)], REGLAS_POR_DEFECTO).porcentaje).toBe(0);
  });
});

describe("la configuración guardada (F33, criterio 7)", () => {
  it("completa lo que falta con los valores por defecto", () => {
    expect(leerConfiguracion({ corte_silencio: { activo: true, seguimientos: 5 } })).toEqual({ ...REGLAS_POR_DEFECTO, corte_silencio: { activo: true, seguimientos: 5 } });
    expect(leerConfiguracion(null)).toEqual(REGLAS_POR_DEFECTO);
  });

  it("valida lo que se guarda, con el motivo en lenguaje claro", () => {
    expect(validarConfiguracion({ ...REGLAS_POR_DEFECTO, corte_silencio: { activo: true, seguimientos: 0 } })).toEqual({ ok: false, error: "El corte con el silencio va de 1 a 10 seguimientos." });
    expect(validarConfiguracion({ ...REGLAS_POR_DEFECTO, espaciado: { activo: true, min_segundos: 200, max_segundos: 100 } })).toEqual({ ok: false, error: "En el espaciado, el mínimo no puede ser mayor que el máximo." });
    expect(validarConfiguracion({ ...REGLAS_POR_DEFECTO, horario: { activo: true, desde: "20:00", hasta: "08:00", dias: [1] } })).toEqual({ ok: false, error: "El horario tiene que empezar antes de terminar." });
    expect(validarConfiguracion({ ...REGLAS_POR_DEFECTO, horario: { activo: true, desde: "08:00", hasta: "20:00", dias: [] } })).toEqual({ ok: false, error: "Elegí al menos un día del horario." });
    expect(validarConfiguracion({ ...REGLAS_POR_DEFECTO, proporcion: { umbral_porcentaje: 0, muestra: 50 } })).toEqual({ ok: false, error: "El umbral de la proporción de respuesta va de 1 % a 100 %." });
    expect(validarConfiguracion(REGLAS_POR_DEFECTO)).toEqual({ ok: true, reglas: REGLAS_POR_DEFECTO });
  });
});

describe("la 00055 y el código dicen lo mismo", () => {
  it("el valor por defecto de la columna es REGLAS_POR_DEFECTO", () => {
    const sql = readFileSync(resolve(__dirname, "../supabase/migrations/00055_reglas_de_seguridad.sql"), "utf8");
    const json = /default '(\{.*\})'::jsonb/.exec(sql)?.[1];
    expect(json && JSON.parse(json)).toEqual(REGLAS_POR_DEFECTO);
  });
});
