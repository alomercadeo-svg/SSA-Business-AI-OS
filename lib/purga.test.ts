import { describe, it, expect } from "vitest";
import { corteDePurga, purgarEspacio, tocaPurgar, type AlmacenParaPurgar } from "./purga";

/**
 * La purga de F30 contra una base falsa que registra cada pedido en orden. Lo
 * que importa acá es el orden (los archivos antes que las filas, §9) y que un
 * fallo de Storage no borre ninguna fila. Que la cascada de la base se lleve
 * mensajes, canales y notas lo prueba la tarea real en un espacio fantasma
 * (`scripts/verify-purga.mjs`).
 */

type Pedido = { tabla: string; op: string; filtros: Array<[string, string, unknown]> };

function baseFalsa(datos: { contactos: string[]; convDeContactos: string[]; convSueltas: string[]; rutas: string[] }) {
  const pedidos: Pedido[] = [];
  const servicio = {
    from(tabla: string) {
      const p: Pedido = { tabla, op: "select", filtros: [] };
      let rango: [number, number] | null = null;
      const cadena: any = {
        order: () => cadena,
        range: (a: number, b: number) => ((rango = [a, b]), cadena),
        select: () => cadena,
        delete: () => ((p.op = "delete"), cadena),
        eq: (c: string, v: unknown) => (p.filtros.push(["eq", c, v]), cadena),
        lt: (c: string, v: unknown) => (p.filtros.push(["lt", c, v]), cadena),
        in: (c: string, v: unknown) => (p.filtros.push(["in", c, v]), cadena),
        not: (c: string, o: string, v: unknown) => (p.filtros.push(["not", c, v]), cadena),
        then: (ok: (r: unknown) => unknown) => {
          pedidos.push(p);
          let data: unknown = [];
          if (p.op === "select" && tabla === "contacts") data = datos.contactos.map((id) => ({ id }));
          if (p.op === "select" && tabla === "conversations")
            data = (p.filtros.some(([, c]) => c === "contact_id") ? datos.convDeContactos : datos.convSueltas).map((id) => ({ id }));
          if (p.op === "select" && tabla === "messages") data = datos.rutas.map((media_path) => ({ media_path }));
          // Como PostgREST: nunca más de 1000 filas por pedido (max_rows), y el rango pedido.
          if (Array.isArray(data)) data = rango ? data.slice(rango[0], rango[1] + 1).slice(0, 1000) : data.slice(0, 1000);
          return Promise.resolve({ data, error: null }).then(ok);
        },
      };
      return cadena;
    },
  };
  return { servicio, pedidos };
}

const AHORA = new Date("2026-10-20T12:00:00Z");

describe("la purga de F30", () => {
  it("el corte es 30 días antes de ahora", () => {
    expect(corteDePurga(AHORA)).toBe("2026-09-20T12:00:00.000Z");
  });

  it("borra los archivos primero y después las filas: conversaciones, contactos y notas", async () => {
    const { servicio, pedidos } = baseFalsa({ contactos: ["c1"], convDeContactos: ["v1"], convSueltas: ["v2"], rutas: ["ws/v1/m1/archivo.jpg"] });
    const orden: string[] = [];
    const borradas: string[][] = [];
    const almacen: AlmacenParaPurgar = {
      borrar: async (rutas) => {
        orden.push(`storage:${pedidos.filter((p) => p.op === "delete").length}`);
        borradas.push(rutas);
      },
    };
    const r = await purgarEspacio({ servicio: servicio as never, workspaceId: "ws", ahora: AHORA, almacen });
    expect(r).toEqual({ contactos: 1, conversaciones: 2, notas: 0, archivos: 1 });
    expect(borradas).toEqual([["ws/v1/m1/archivo.jpg"]]);
    expect(orden).toEqual(["storage:0"]); // cuando se borró Storage, todavía no había ningún DELETE
    expect(pedidos.filter((p) => p.op === "delete").map((p) => p.tabla)).toEqual(["conversations", "contacts", "contact_notes"]);
    // Siempre dentro del espacio y con el corte de 30 días.
    const contactos = pedidos.find((p) => p.tabla === "contacts" && p.op === "select")!;
    expect(contactos.filtros).toEqual([["eq", "workspace_id", "ws"], ["lt", "deleted_at", "2026-09-20T12:00:00.000Z"]]);
    const notas = pedidos.find((p) => p.tabla === "contact_notes")!;
    expect(notas.filtros).toEqual([["eq", "workspace_id", "ws"], ["lt", "deleted_at", "2026-09-20T12:00:00.000Z"]]);
  });

  it("si Storage falla, no borra ninguna fila: la purga del otro día lo vuelve a intentar", async () => {
    const { servicio, pedidos } = baseFalsa({ contactos: ["c1"], convDeContactos: ["v1"], convSueltas: [], rutas: ["ws/v1/m1/archivo.jpg"] });
    const almacen: AlmacenParaPurgar = { borrar: async () => { throw new Error("message-media: se cayó"); } };
    await expect(purgarEspacio({ servicio: servicio as never, workspaceId: "ws", ahora: AHORA, almacen })).rejects.toThrow("se cayó");
    expect(pedidos.some((p) => p.op === "delete")).toBe(false);
  });

  it("sin nada eliminado hace más de 30 días, no borra nada ni llama a Storage", async () => {
    const { servicio, pedidos } = baseFalsa({ contactos: [], convDeContactos: [], convSueltas: [], rutas: [] });
    let llamadas = 0;
    const r = await purgarEspacio({ servicio: servicio as never, workspaceId: "ws", ahora: AHORA, almacen: { borrar: async () => void llamadas++ } });
    expect(r).toEqual({ contactos: 0, conversaciones: 0, notas: 0, archivos: 0 });
    expect(llamadas).toBe(0);
    expect(pedidos.filter((p) => p.op === "delete").map((p) => p.tabla)).toEqual(["contact_notes"]);
  });

  it("con más de 1000 archivos, los borra todos: pagina en vez de quedarse con las primeras 1000 filas", async () => {
    const rutas = Array.from({ length: 1500 }, (_, i) => `ws/v1/m${i}/archivo.jpg`);
    const { servicio } = baseFalsa({ contactos: ["c1"], convDeContactos: ["v1"], convSueltas: [], rutas });
    const borradas: string[] = [];
    await purgarEspacio({ servicio: servicio as never, workspaceId: "ws", ahora: AHORA, almacen: { borrar: async (l) => void borradas.push(...l) } });
    expect(new Set(borradas).size).toBe(1500);
  });

  it("el borrado repite la condición: solo lo que sigue eliminado hace más de 30 días (un lead que escribió en el medio se salva)", async () => {
    const { servicio, pedidos } = baseFalsa({ contactos: ["c1"], convDeContactos: ["v1"], convSueltas: [], rutas: [] });
    await purgarEspacio({ servicio: servicio as never, workspaceId: "ws", ahora: AHORA, almacen: { borrar: async () => {} } });
    for (const tabla of ["conversations", "contacts"]) {
      const d = pedidos.find((p) => p.op === "delete" && p.tabla === tabla)!;
      expect(d.filtros).toContainEqual(["lt", "deleted_at", "2026-09-20T12:00:00.000Z"]);
    }
  });

  it("toca purgar si nunca terminó bien, o si la última buena tiene 24 horas o más", () => {
    expect(tocaPurgar(null, AHORA)).toBe(true);
    expect(tocaPurgar("2026-10-19T13:00:00Z", AHORA)).toBe(false);
    expect(tocaPurgar("2026-10-19T12:00:00Z", AHORA)).toBe(true);
  });
});
