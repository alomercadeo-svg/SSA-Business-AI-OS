import { describe, it, expect } from "vitest";
import { ELIMINADO, importarFilas, valorDeCampo, type AlmacenDeContactos, type Catalogos, type DatosDeContacto } from "./importacion-contactos";
import { prepararFila, type Campo } from "./importacion-csv";

/** Un almacén en memoria con la misma regla de búsqueda que el de Supabase. */
function almacenEnMemoria(iniciales: Array<DatosDeContacto & { id: string; eliminado?: boolean }> = []) {
  const contactos = iniciales.map((c) => ({ ...c }));
  const etiquetas: Array<[string, string]> = [];
  const campos: Array<[string, string, string]> = [];
  let n = 0;
  const almacen: AlmacenDeContactos = {
    async buscarPor(campo, valor) {
      const c = contactos.find((x) => (x as Record<string, unknown>)[campo] === valor);
      return c ? { id: c.id, eliminado: Boolean(c.eliminado) } : null;
    },
    async crear(datos) {
      const id = `nuevo-${++n}`;
      contactos.push({ id, ...datos });
      return id;
    },
    async actualizar(id, datos) {
      Object.assign(contactos.find((c) => c.id === id)!, datos);
    },
    async ponerEtiquetas(id, ids) {
      ids.forEach((t) => etiquetas.push([id, t]));
    },
    async ponerCampos(id, valores) {
      valores.forEach((v) => campos.push([id, v.fieldId, v.value]));
    },
  };
  return { almacen, contactos, etiquetas, campos };
}

const catalogos: Catalogos = {
  etiquetas: new Map([["vip", "tag-vip"]]),
  campos: new Map([["ciudad", { id: "cf-ciudad", tipo: "text" }], ["presupuesto", { id: "cf-presu", tipo: "number" }]]),
  miembros: new Map([["ana setter", "u-ana"]]),
};
const mapeo: Campo[] = ["nombre", "correo", "telefono", "pipedrive", "setter", "etiquetas", "campo:ciudad", "campo:presupuesto"];
const fila = (valores: string[], numero = 2) => prepararFila(valores, mapeo, { codigoPais: "+506", numero });

describe("importarFilas (F37, parte 1)", () => {
  it("crea la nueva, actualiza por correo y por teléfono, y rechaza la que no tiene identificador", async () => {
    const m = almacenEnMemoria([
      { id: "c-correo", email: "ana@x.com", display_name: "Ana vieja" },
      { id: "c-tel", phone: "+50670001111", display_name: "Luis" },
    ]);
    const r = await importarFilas(
      [
        fila(["Nueva", "nueva@x.com", "", "", "", "", "", ""], 2),
        fila(["Ana", "ana@x.com", "", "", "", "", "", ""], 3),
        fila(["", "", "7000 1111", "", "", "", "", ""], 4),
        fila(["Sin datos", "", "", "", "", "", "", ""], 5),
      ],
      catalogos,
      m.almacen,
      { asignarA: null },
    );
    expect(r).toMatchObject({ creados: 1, actualizados: 2, conError: 1, usaronCodigo: 1 });
    expect(m.contactos.find((c) => c.id === "c-correo")?.display_name).toBe("Ana");
    expect(m.contactos.find((c) => c.id === "c-tel")?.display_name).toBe("Luis");
    expect(m.contactos).toHaveLength(3);
  });

  it("el id de Pipedrive gana sobre el correo (§14, orden de confianza)", async () => {
    const m = almacenEnMemoria([
      { id: "c-pd", pipedrive_person_id: "77" },
      { id: "c-correo", email: "ana@x.com" },
    ]);
    await importarFilas([fila(["Ana", "ana@x.com", "", "77", "", "", "", ""])], catalogos, m.almacen, { asignarA: null });
    expect(m.contactos.find((c) => c.id === "c-pd")?.email).toBe("ana@x.com");
  });

  it("una celda vacía no borra un dato que ya estaba", async () => {
    const m = almacenEnMemoria([{ id: "c1", email: "ana@x.com", display_name: "Ana", phone: "+50670002222" }]);
    await importarFilas([fila(["", "ana@x.com", "", "", "", "", "", ""])], catalogos, m.almacen, { asignarA: null });
    expect(m.contactos[0]).toMatchObject({ display_name: "Ana", phone: "+50670002222" });
  });

  it("si el que coincide está en Eliminados, no se restaura ni se duplica", async () => {
    const m = almacenEnMemoria([{ id: "c-borrado", email: "ana@x.com", eliminado: true }]);
    const r = await importarFilas([fila(["Ana", "ana@x.com", "", "", "", "", "", ""])], catalogos, m.almacen, { asignarA: null });
    expect(r.conError).toBe(1);
    expect(r.lineas[0].que).toBe(ELIMINADO);
    expect(m.contactos).toHaveLength(1);
  });

  it("importar el mismo archivo dos veces no duplica", async () => {
    const m = almacenEnMemoria();
    const filas = [fila(["Ana", "ana@x.com", "", "", "", "", "", ""])];
    await importarFilas(filas, catalogos, m.almacen, { asignarA: null });
    const r2 = await importarFilas(filas, catalogos, m.almacen, { asignarA: null });
    expect(r2).toMatchObject({ creados: 0, actualizados: 1 });
    expect(m.contactos).toHaveLength(1);
  });

  it("setter del equipo, etiqueta y campos propios que existen; lo que no existe se informa y no se crea", async () => {
    const m = almacenEnMemoria();
    const r = await importarFilas(
      [fila(["Ana", "ana@x.com", "", "", "Ana Setter", "vip, inventada", "San José", "mil"])],
      catalogos,
      m.almacen,
      { asignarA: "u-owner" },
    );
    expect(m.contactos[0].setter_id).toBe("u-ana");
    expect(m.etiquetas).toEqual([["nuevo-1", "tag-vip"]]);
    expect(m.campos).toEqual([["nuevo-1", "cf-ciudad", "San José"]]);
    expect(r.lineas[0].que).toContain("«inventada» no existe");
    expect(r.lineas[0].que).toContain("«mil» no es un número");
  });

  it("sin columna de setter, se asigna a quien eligió la opción; un setter que no es del equipo queda sin asignar", async () => {
    const m = almacenEnMemoria();
    await importarFilas([fila(["Ana", "ana@x.com", "", "", "", "", "", ""])], catalogos, m.almacen, { asignarA: "u-owner" });
    expect(m.contactos[0].setter_id).toBe("u-owner");
    const r = await importarFilas([fila(["Luis", "luis@x.com", "", "", "Nadie", "", "", ""])], catalogos, m.almacen, { asignarA: null });
    expect(m.contactos[1].setter_id ?? null).toBeNull();
    expect(r.lineas[0].que).toContain("«Nadie» no es del equipo");
  });
});

describe("valorDeCampo: los seis tipos del fork", () => {
  it("valida y normaliza", () => {
    expect(valorDeCampo("number", "1.500,50")).toBeNull();
    expect(valorDeCampo("number", "1500.5")).toBe("1500.5");
    expect(valorDeCampo("boolean", "Sí")).toBe("true");
    expect(valorDeCampo("boolean", "no")).toBe("false");
    expect(valorDeCampo("date", "25/12/2026")).toBe("2026-12-25");
    expect(valorDeCampo("date", "2026-12-25")).toBe("2026-12-25");
    expect(valorDeCampo("date", "mañana")).toBeNull();
    expect(valorDeCampo("url", "https://x.com")).toBe("https://x.com");
    expect(valorDeCampo("url", "x.com")).toBeNull();
    expect(valorDeCampo("email", "a@b.co")).toBe("a@b.co");
    expect(valorDeCampo("text", "lo que sea")).toBe("lo que sea");
  });
});

describe("la etiqueta de origen (retrabajo del 09/11, a)", () => {
  it("va en cada contacto creado o actualizado, no en las filas con error", async () => {
    const m = almacenEnMemoria([{ id: "c1", email: "ana@x.com" }]);
    await importarFilas(
      [fila(["Nueva", "nueva@x.com", "", "", "", "", "", ""], 2), fila(["Ana", "ana@x.com", "", "", "", "", "", ""], 3), fila(["Sin datos", "", "", "", "", "", "", ""], 4)],
      catalogos,
      m.almacen,
      { asignarA: null, etiquetaOrigenId: "tag-origen" },
    );
    expect(m.etiquetas).toEqual([
      ["nuevo-1", "tag-origen"],
      ["c1", "tag-origen"],
    ]);
  });
});
