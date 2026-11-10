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

/**
 * Ítem 1 de la sesión de cierre (decisión de Marcos del 10/11/2026): las
 * personas que comparten correo o teléfono quedan en una sola fila, con el ID
 * de la primera (el más bajo). El teléfono se compara ya limpio y normalizado,
 * con el mismo código de país por defecto que usa la importación.
 */
const PERSONAS_F = escribirCsv(
  ["ID", "Nombre", "Teléfono - Móvil", "Teléfono - Trabajo", "Correo electrónico - Trabajo"],
  [
    ["10", "Diez", "", "", "uno@ejemplo.com"],
    ["9", "Nueve", "", "", "UNO@ejemplo.com "],
    ["11", "Once", "'+506 8800-0011", "", ""],
    ["13", "Trece", "", "8800 0011", ""],
    ["14", "Catorce", "", "", "dos@ejemplo.com"],
    ["15", "Quince", "+50688000015", "", "tres@ejemplo.com"],
    ["16", "Dieciséis", "+506 8800 0015", "", "dos@ejemplo.com"],
    ["17", "Diecisiete", "", "", ""],
    ["18", "Dieciocho", "", "", ""],
  ],
);
const TRATOS_F = escribirCsv(COLS, [
  ["T10", "Viejo", "10", "3. Respondió", "Perdido", "", "", "2024-01-01 09:00:00", "2024-02-01 10:00:00", "Precio"],
  ["T9", "Nuevo", "9", "5. Le ofrecí una cita", "Abierto", "", "", "2025-01-01 09:00:00", "", ""],
  ["T13", "Uno", "13", "13. ¡Cerrada!", "Ganado", "500", "USD", "2025-01-01 09:00:00", "2025-03-01 10:00:00", ""],
  ["T17", "Solo", "17", "1. Nuevo contacto", "Abierto", "", "", "2025-01-01 09:00:00", "", ""],
]);

describe("pipedrive-unir: personas que comparten correo o teléfono (ítem 1, decisión del 10/11)", () => {
  const r = () => unir(PERSONAS_F, TRATOS_F);
  const todas = () => [...r().a, ...r().b] as string[][];
  const filaF = (id: string) => todas().find((f) => f[3] === id) as string[];
  const notasF = (id: string) => r().columnas.map((c: string, i: number) => (c.startsWith("Nota del contacto") ? filaF(id)[i] : "")).filter(Boolean);

  it("el correo se compara sin mayúsculas: 9 y 10 quedan en una fila con el ID más bajo (9, no «10» por orden de texto)", () => {
    expect(filaF("9")).toBeTruthy();
    expect(filaF("10")).toBeUndefined();
    expect(filaF("9")[0]).toBe("Nueve");
  });

  it("el teléfono se compara limpio y normalizado con el código por defecto: 11 y 13 quedan en una fila", () => {
    expect(filaF("11")).toBeTruthy();
    expect(filaF("13")).toBeUndefined();
  });

  it("la unión es transitiva: 14 (correo de 16) y 15 (teléfono de 16) quedan con 14", () => {
    expect(filaF("14")).toBeTruthy();
    expect(filaF("15")).toBeUndefined();
    expect(filaF("16")).toBeUndefined();
    expect(notasF("14")).toEqual([
      "Otra persona de Pipedrive con el mismo correo o teléfono: Quince, ID 15",
      "Otra persona de Pipedrive con el mismo correo o teléfono: Dieciséis, ID 16",
    ]);
  });

  it("el trato de la ficha sale con la regla de la parte A entre los del grupo, y los demás son notas", () => {
    expect(filaF("9")[9]).toBe("T9");
    expect(notasF("9")).toEqual([
      "Trato anterior en Pipedrive: perdido, 3. Respondió, cerrado el 01/02/2024. Motivo de pérdida: Precio",
      "Otra persona de Pipedrive con el mismo correo o teléfono: Diez, ID 10",
    ]);
    expect(filaF("11")[9]).toBe("T13");
    expect(notasF("11")).toEqual(["Otra persona de Pipedrive con el mismo correo o teléfono: Trece, ID 13"]);
  });

  it("control: dos personas sin correo ni teléfono no se unen; una persona sin conflicto queda igual", () => {
    expect(filaF("17")[9]).toBe("T17");
    expect(filaF("18")).toBeTruthy();
    expect(notasF("17")).toEqual([]);
  });

  it("la cuenta sigue cerrando, y cuenta los grupos y las personas fusionadas", () => {
    const k = r().conteos;
    expect(k.aplanados + k.comoNota + k.sinPersona + k.personaInexistente).toBe(k.noIgdm);
    expect(k).toMatchObject({ aplanados: 3, comoNota: 1, noIgdm: 4 });
    expect(k.fusion).toEqual({ grupos: 3, personasFusionadas: 4 });
    expect(todas()).toHaveLength(5);
  });
});

describe("pipedrive-unir: el teléfono se normaliza igual que en la importación", () => {
  it("telefonoParaComparar da lo mismo que prepararFila con +506, en cada forma de planilla", async () => {
    const { telefonoParaComparar } = await import("./pipedrive-unir.mjs");
    const { prepararFila } = await import("../lib/importacion-csv");
    const casos = ["+506 8800-0011", "'+50688000011", "‪8800 0011‬", "0050688000011", "8856-12", "88a00011", "(506) 8800 0011", "+1 (415) 555-0100", "", "  ", "+0123", "4155550100"];
    for (const crudo of casos) {
      const esperado = prepararFila([crudo], ["telefono"], { codigoPais: "+506", numero: 2 }).telefono;
      expect([crudo, telefonoParaComparar(crudo, "+506")]).toEqual([crudo, esperado]);
    }
  });
});
