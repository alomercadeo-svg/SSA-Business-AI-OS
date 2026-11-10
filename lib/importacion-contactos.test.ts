import { describe, it, expect } from "vitest";
import { ELIMINADO, MARCA_MIGRACION, RechazoDeLaBase, controlDeMigracion, importarFilas, valorDeCampo, type AlmacenDeContactos, type Catalogos, type DatosDeContacto } from "./importacion-contactos";
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
      return c ? { id: c.id, eliminado: Boolean(c.eliminado), pipedrivePersonId: c.pipedrive_person_id ?? null } : null;
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
    async crearEtiqueta(nombre) {
      return `creada-${nombre}`;
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
    // Desde el 09/11 a las 22:0x (decisión de Marcos), una etiqueta de la
    // planilla que no existe se crea: antes decía ««inventada» no existe».
    expect(m.etiquetas).toEqual([
      ["nuevo-1", "tag-vip"],
      ["nuevo-1", "creada-inventada"],
    ]);
    expect(r.etiquetasCreadas).toEqual(["inventada"]);
    expect(m.campos).toEqual([["nuevo-1", "cf-ciudad", "San José"]]);
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

describe("las etiquetas de la planilla se crean si no existen (decisión del 09/11, b)", () => {
  it("«VIP» y «Promoción» usan las existentes sin distinguir mayúsculas ni tildes; una nueva se crea una sola vez", async () => {
    const m = almacenEnMemoria();
    const conPromo: Catalogos = { ...catalogos, etiquetas: new Map([["vip", "tag-vip"], ["promocion", "tag-promo"]]) };
    const r = await importarFilas(
      [fila(["Ana", "ana@x.com", "", "", "", "VIP, Promoción, Pauta", "", ""], 2), fila(["Luis", "luis@x.com", "", "", "", "pauta", "", ""], 3)],
      conPromo,
      m.almacen,
      { asignarA: null },
    );
    expect(m.etiquetas).toEqual([
      ["nuevo-1", "tag-vip"],
      ["nuevo-1", "tag-promo"],
      ["nuevo-1", "creada-Pauta"],
      ["nuevo-2", "creada-Pauta"],
    ]);
    expect(r.etiquetasCreadas).toEqual(["Pauta"]);
  });
});

describe("F38: la migración desde Pipedrive", () => {
  const mapeoPd: Campo[] = ["nombre", "pipedrive", "etapa", "estado_trato", "valor", "moneda", "fecha_cierre", "pipedrive_trato", "nota"];
  const filaPd = (valores: string[], numero = 2) => prepararFila(valores, mapeoPd, { codigoPais: "+506", numero });

  function conNotas(iniciales: Array<DatosDeContacto & { id: string }> = []) {
    const m = almacenEnMemoria(iniciales);
    const notas: Array<{ contacto: string; marca: string; texto: string }> = [];
    const almacen = m.almacen as AlmacenDeContactos;
    almacen.ponerNota = async (contacto, marca, texto) => {
      if (notas.some((n) => n.contacto === contacto && n.marca === marca && n.texto === texto)) return false;
      notas.push({ contacto, marca, texto });
      return true;
    };
    return { ...m, notas };
  }

  it("los datos del trato se guardan al crear y al actualizar", async () => {
    const m = conNotas([{ id: "c-77", pipedrive_person_id: "77" }]);
    await importarFilas(
      [
        filaPd(["Ana", "77", "3. Respondió", "abierto", "1500", "USD", "2025-03-14", "901", ""], 2),
        filaPd(["Luis", "78", "14. Repesca", "perdido", "", "", "", "902", ""], 3),
      ],
      catalogos,
      m.almacen,
      { asignarA: null },
    );
    expect(m.contactos.find((c) => c.id === "c-77")).toMatchObject({
      pipeline_stage: "3. Respondió",
      deal_status: "abierto",
      deal_value: 1500,
      deal_currency: "USD",
      deal_closed_at: "2025-03-14",
      pipedrive_deal_id: "901",
    });
    const luis = m.contactos.find((c) => c.pipedrive_person_id === "78");
    expect(luis).toMatchObject({ pipeline_stage: "14. Repesca", deal_status: "perdido", pipedrive_deal_id: "902" });
    expect(luis).not.toHaveProperty("deal_value");
  });

  it("un valor o una fecha que no se leen no se inventan: la fila entra sin ese dato y lo dice", async () => {
    const m = conNotas();
    const r = await importarFilas([filaPd(["Ana", "77", "", "", "mil", "", "30/02/2025", "901", ""])], catalogos, m.almacen, { asignarA: null });
    expect(r.creados).toBe(1);
    expect(m.contactos[0]).not.toHaveProperty("deal_value");
    expect(m.contactos[0]).not.toHaveProperty("deal_closed_at");
    expect(r.lineas[0].que).toContain("«mil»");
    expect(r.lineas[0].que).toContain("«30/02/2025»");
  });

  it("la nota entra una sola vez aunque se importe dos veces, con la marca de la migración", async () => {
    const m = conNotas();
    const f = () => [filaPd(["Ana", "77", "", "perdido", "", "", "", "901", "Motivo de pérdida en Pipedrive: precio"])];
    await importarFilas(f(), catalogos, m.almacen, { asignarA: null });
    await importarFilas(f(), catalogos, m.almacen, { asignarA: null });
    expect(m.notas).toEqual([{ contacto: m.contactos[0].id, marca: MARCA_MIGRACION, texto: "Motivo de pérdida en Pipedrive: precio" }]);
  });

  it("si la base rechaza la fila (una etapa fuera de la lista), esa fila lo dice y las demás siguen", async () => {
    const m = conNotas();
    const crear = m.almacen.crear;
    m.almacen.crear = async (datos) => {
      if (datos.pipeline_stage === "99. Inventada") throw new RechazoDeLaBase("pipeline_stage");
      return crear(datos);
    };
    const r = await importarFilas(
      [filaPd(["Mala", "70", "99. Inventada", "", "", "", "", "900", ""], 2), filaPd(["Buena", "71", "1. Nuevo contacto", "", "", "", "", "901", ""], 3)],
      catalogos,
      m.almacen,
      { asignarA: null },
    );
    expect(r).toMatchObject({ creados: 1, conError: 1 });
    expect(r.lineas.find((l) => l.numero === 2)?.que).toContain("«99. Inventada»");
  });

  it("el control cuenta ids de trato distintos encontrados en el espacio, no contactos", () => {
    expect(controlDeMigracion(["901", "902", "902", "903"], ["901", "901", "902", "950"])).toEqual({ enArchivo: 3, encontrados: 2, enEspacio: 3 });
    expect(controlDeMigracion([], ["901"])).toEqual({ enArchivo: 0, encontrados: 0, enEspacio: 1 });
  });
});

describe("F38, parte A: varias notas por fila (los tratos anteriores)", () => {
  it("cada columna «Nota del contacto» es una nota, y la segunda importación no duplica ninguna", async () => {
    const m = almacenEnMemoria();
    const notas: Array<[string, string, string]> = [];
    m.almacen.ponerNota = async (c, marca, texto) => {
      if (notas.some((n) => n[0] === c && n[1] === marca && n[2] === texto)) return false;
      notas.push([c, marca, texto]);
      return true;
    };
    const mapeoN: Campo[] = ["nombre", "pipedrive", "nota", "nota"];
    const f = () => [prepararFila(["Ana", "77", "Motivo de pérdida en Pipedrive: precio", "Trato anterior en Pipedrive: ganado"], mapeoN, { codigoPais: "+506", numero: 2 })];
    await importarFilas(f(), catalogos, m.almacen, { asignarA: null });
    await importarFilas(f(), catalogos, m.almacen, { asignarA: null });
    expect(notas.map((n) => n[2])).toEqual(["Motivo de pérdida en Pipedrive: precio", "Trato anterior en Pipedrive: ganado"]);
    expect(notas.every((n) => n[1] === MARCA_MIGRACION)).toBe(true);
  });
});

describe("ítem 1: nunca se reemplaza un pipedrive_person_id guardado (decisión de Marcos del 10/11/2026)", () => {
  const mapeoP: Campo[] = ["nombre", "correo", "telefono", "pipedrive", "nota"];
  const conNotas = (iniciales: Array<DatosDeContacto & { id: string }>) => {
    const m = almacenEnMemoria(iniciales);
    const notas: Array<[string, string, string]> = [];
    m.almacen.ponerNota = async (c, marca, texto) => {
      if (notas.some((n) => n[0] === c && n[1] === marca && n[2] === texto)) return false;
      notas.push([c, marca, texto]);
      return true;
    };
    return { ...m, notas };
  };
  const filaP = (v: string[], n = 2) => prepararFila(v, mapeoP, { codigoPais: "+506", numero: n });

  it("una fila con otro ID para un contacto que ya tiene uno: se conserva el guardado y el de la fila entra como nota, una sola vez", async () => {
    const m = conNotas([{ id: "c-1", pipedrive_person_id: "9", email: "uno@x.com", display_name: "Nueve" }]);
    const f = () => [filaP(["Diez", "uno@x.com", "", "10", ""])];
    const r1 = await importarFilas(f(), catalogos, m.almacen, { asignarA: null });
    const r2 = await importarFilas(f(), catalogos, m.almacen, { asignarA: null });
    expect(m.contactos.find((c) => c.id === "c-1")?.pipedrive_person_id).toBe("9");
    expect(m.notas).toEqual([["c-1", MARCA_MIGRACION, "Otra persona de Pipedrive con el mismo correo o teléfono: Diez, ID 10"]]);
    expect(r1).toMatchObject({ creados: 0, actualizados: 1, conError: 0 });
    expect(r2).toMatchObject({ creados: 0, actualizados: 1, conError: 0 });
    expect(m.contactos).toHaveLength(1);
  });

  it("control positivo: un contacto sin ID guardado, o con el mismo, se actualiza normalmente", async () => {
    const m = conNotas([
      { id: "c-sin", email: "dos@x.com", display_name: "Viejo" },
      { id: "c-igual", pipedrive_person_id: "20", display_name: "Veinte viejo" },
    ]);
    await importarFilas([filaP(["Dos", "dos@x.com", "", "12", ""], 2), filaP(["Veinte", "", "", "20", ""], 3)], catalogos, m.almacen, { asignarA: null });
    expect(m.contactos.find((c) => c.id === "c-sin")).toMatchObject({ pipedrive_person_id: "12", display_name: "Dos" });
    expect(m.contactos.find((c) => c.id === "c-igual")).toMatchObject({ pipedrive_person_id: "20", display_name: "Veinte" });
    expect(m.notas).toEqual([]);
  });
});
