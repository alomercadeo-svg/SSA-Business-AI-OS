import { describe, it, expect } from "vitest";
import { escribirCsv, unir } from "./pipedrive-unir.mjs";

/**
 * F38, parte A (decisión de Marcos del 10/11/2026): una persona con más de un
 * trato que no es «IG DM». A la ficha va uno (el abierto; entre varios
 * abiertos, el creado más reciente; sin abiertos, el cerrado más reciente
 * según «Trato cerrado el», o la creación si falta), y los demás van como
 * notas. La cuenta cierra. Datos sintéticos, con los encabezados reales.
 */
const PERSONAS = escribirCsv(
  ["ID", "Nombre", "Teléfono - Móvil", "Teléfono - Trabajo", "Correo electrónico - Trabajo"],
  [
    ["1", "P1", "+50688000001", "", ""],
    ["2", "P2", "+50688000002", "", ""],
    ["3", "P3", "+50688000003", "", ""],
    ["4", "P4", "+50688000004", "", ""],
  ],
);
const COLS = ["ID", "Título", "ID de la persona de contacto", "Etapa", "Estado", "Valor", "Moneda de Valor", "Trato creado", "Trato cerrado el", "Motivo de la pérdida"];
const TRATOS = escribirCsv(COLS, [
  ["T1", "Viejo", "1", "3. Respondió", "Perdido", "1500", "USD", "2024-12-01 09:00:00", "2025-01-10 10:00:00", "Precio"],
  ["T2", "Nuevo", "1", "5. Le ofrecí una cita", "Abierto", "", "", "2025-02-01 09:00:00", "", ""],
  ["T3", "A", "2", "1. Nuevo contacto", "Abierto", "", "", "2025-01-01 09:00:00", "", ""],
  ["T4", "B", "2", "2. Le escribí", "Abierto", "", "", "2025-03-01 09:00:00", "", ""],
  ["T5", "C", "3", "13. ¡Cerrada!", "Ganado", "900", "USD", "2025-01-01 09:00:00", "2025-05-01 10:00:00", ""],
  ["T6", "D", "3", "14. Repesca", "Perdido", "", "", "2025-02-01 09:00:00", "2025-06-01 10:00:00", "No respondió"],
  ["T7", "E", "4", "14. Repesca", "Perdido", "", "", "2025-07-01 09:00:00", "", ""],
  ["T8", "F", "4", "8. No llegó", "Perdido", "", "", "2025-01-01 09:00:00", "2025-04-01 10:00:00", ""],
  ["T9", "Sin persona", "", "1. Nuevo contacto", "Abierto", "", "", "2025-01-01 09:00:00", "", ""],
  ["T10", "IG DM - Fulano", "", "1. Nuevo contacto", "Abierto", "", "", "2025-01-01 09:00:00", "", ""],
]);

let cache: ReturnType<typeof unir> | null = null;
const resultado = () => (cache ??= unir(PERSONAS, TRATOS));
const fila = (id: string) => resultado().a.find((f: string[]) => f[3] === id) as string[];
const notas = (id: string) => resultado().columnas.map((c: string, i: number) => (c.startsWith("Nota del contacto") ? fila(id)[i] : "")).filter(Boolean);

describe("pipedrive-unir: varios tratos por persona (decisión del 10/11)", () => {
  it("con un abierto entre cerrados, a la ficha va el abierto; el cerrado, como nota con su motivo", () => {
    expect(fila("1")[9]).toBe("T2");
    expect(notas("1")).toEqual(["Trato anterior en Pipedrive: perdido, 3. Respondió, 1500 USD, cerrado el 10/01/2025. Motivo de pérdida: Precio"]);
  });

  it("desempate: entre varios abiertos, el creado más recientemente", () => {
    expect(fila("2")[9]).toBe("T4");
    expect(notas("2")).toEqual(["Trato anterior en Pipedrive: abierto, 1. Nuevo contacto"]);
  });

  it("desempate: sin abiertos, el cerrado más reciente según «Trato cerrado el»; el motivo del de la ficha también es nota", () => {
    expect(fila("3")[9]).toBe("T6");
    expect(notas("3")).toEqual(["Motivo de pérdida en Pipedrive: No respondió", "Trato anterior en Pipedrive: ganado, 13. ¡Cerrada!, 900 USD, cerrado el 01/05/2025"]);
  });

  it("desempate: si falta «Trato cerrado el», se usa la fecha de creación", () => {
    expect(fila("4")[9]).toBe("T7");
    expect(notas("4")).toEqual(["Trato anterior en Pipedrive: perdido, 8. No llegó, cerrado el 01/04/2025"]);
  });

  it("la cuenta cierra: ficha + notas + sin persona = tratos que no son «IG DM»; y cada desempate se cuenta", () => {
    const r = resultado();
    expect(r.conteos).toMatchObject({ igdm: 1, aplanados: 4, comoNota: 4, sinPersona: 1, personaInexistente: 0, noIgdm: 9 });
    expect(r.conteos.aplanados + r.conteos.comoNota + r.conteos.sinPersona + r.conteos.personaInexistente).toBe(r.conteos.noIgdm);
    expect(r.conteos.desempates).toEqual({ unAbiertoEntreVarios: 1, variosAbiertosPorCreacion: 1, cerradoMasReciente: 2, cierreFaltanteUsoCreacion: 1 });
  });
});
