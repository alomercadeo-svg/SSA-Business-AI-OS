import { describe, it, expect } from "vitest";
import { resumenDeImportacion, porcentaje } from "./importacion-progreso";

/** F37, criterio 9: la barra de progreso real y el resumen (ítem 2 de la sesión de cierre). */
const fila = { id: "i", nombre_archivo: "a.csv", filas: 1200, procesadas: 600, creados: 500, actualizados: 90, con_error: 10, usaron_codigo: 3, estado: "en_curso", en_segundo_plano: true, lineas: [{ numero: 4, nombre: "x", que: "y" }], control: null, error: null, created_at: "2026-11-10T23:00:00Z", terminada_at: null };

describe("la barra y el resumen", () => {
  it("el porcentaje sale de lo procesado, sin pasar de 100 ni bajar de 0", () => {
    expect(porcentaje(600, 1200)).toBe(50);
    expect(porcentaje(0, 1200)).toBe(0);
    expect(porcentaje(1300, 1200)).toBe(100);
    expect(porcentaje(5, 0)).toBe(0);
  });
  it("mientras corre, el avance; las líneas del detalle solo al terminar", () => {
    expect(resumenDeImportacion(fila)).toMatchObject({ estado: "en_curso", porcentaje: 50, procesadas: 600, filas: 1200, terminada: false, lineas: [] });
    expect(resumenDeImportacion({ ...fila, estado: "terminada", procesadas: 1200 })).toMatchObject({ terminada: true, porcentaje: 100, creados: 500, actualizados: 90, conError: 10, usaronCodigo: 3, lineas: [{ numero: 4 }] });
  });
});
