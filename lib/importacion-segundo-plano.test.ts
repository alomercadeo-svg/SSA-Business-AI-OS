import { describe, it, expect } from "vitest";
import { procesarImportacion, type ColaDeImportacion, type ImportacionGuardada, type DependenciasDeProceso } from "./importacion-segundo-plano";
import type { AlmacenDeContactos, DatosDeContacto } from "./importacion-contactos";

/**
 * F37, parte 2 (ítem 2 de la sesión de cierre): el proceso que corre las
 * tandas de una importación después de responder. Cola y almacén en memoria.
 */
function escenario(opciones: { tandas: string[][][]; enSegundoPlano?: boolean; reclamadaPorOtro?: boolean; procesadas?: number[]; fallarEnTanda?: number; intentos?: number }) {
  const imp: ImportacionGuardada & { estado: string; intentos: number; avisada: boolean; error: string | null } = {
    id: "imp-1",
    workspaceId: "ws-1",
    creadoPor: "u-1",
    nombreArchivo: "planilla.csv",
    filas: opciones.tandas.reduce((n, t) => n + t.length, 0),
    enSegundoPlano: opciones.enSegundoPlano ?? true,
    opciones: { mapeo: ["nombre", "correo"], codigoPais: "+506", asignarA: null, etiquetaOrigenId: null, actor: { id: "u-1", etiqueta: "Ana" } },
    estado: "en_cola",
    intentos: opciones.intentos ?? 0,
    avisada: false,
    error: null,
  };
  const procesadas = new Set(opciones.procesadas ?? []);
  const totales = { creados: 0, actualizados: 0, conError: 0, usaronCodigo: 0, procesadas: 0, lineas: [] as import("./importacion-contactos").LineaDelResumen[] };
  const avances: number[] = [];
  const terminadas: unknown[] = [];
  const cola: ColaDeImportacion = {
    async reclamar() {
      return opciones.reclamadaPorOtro ? null : imp;
    },
    async siguienteTanda() {
      const n = opciones.tandas.findIndex((_, i) => !procesadas.has(i));
      return n < 0 ? null : { numero: n, filas: opciones.tandas[n] };
    },
    async avanzar(_id, procesadasAhora) {
      avances.push(procesadasAhora);
    },
    async cerrarTanda(_id, numero, parcial) {
      procesadas.add(numero);
      totales.creados += parcial.creados;
      totales.actualizados += parcial.actualizados;
      totales.conError += parcial.conError;
      totales.procesadas += parcial.procesadas;
      totales.lineas.push(...parcial.lineas);
      return { ...totales };
    },
    async todasLasFilas() {
      return opciones.tandas.flat();
    },
    async terminar(_id, datos) {
      imp.estado = "terminada";
      terminadas.push(datos);
    },
    async fallar(_id, mensaje, definitiva) {
      imp.intentos++;
      imp.error = mensaje;
      if (definitiva) imp.estado = "fallida";
    },
    async marcarAviso() {
      if (imp.avisada) return false;
      imp.avisada = true;
      return true;
    },
  };
  const contactos: Array<DatosDeContacto & { id: string }> = [];
  const almacen: AlmacenDeContactos = {
    async buscarPor(campo, valor) {
      const c = contactos.find((x) => (x as unknown as Record<string, unknown>)[campo] === valor);
      return c ? { id: c.id, eliminado: false } : null;
    },
    async crear(datos) {
      if (opciones.fallarEnTanda !== undefined && datos.display_name?.startsWith(`T${opciones.fallarEnTanda}`)) throw new Error("la base no responde");
      const id = `c-${contactos.length + 1}`;
      contactos.push({ id, ...datos });
      return id;
    },
    async actualizar(id, datos) {
      Object.assign(contactos.find((c) => c.id === id)!, datos);
    },
    async ponerEtiquetas() {},
    async ponerCampos() {},
    async crearEtiqueta(n) {
      return n;
    },
  };
  const avisos: unknown[] = [];
  const auditados: string[] = [];
  const deps: DependenciasDeProceso = {
    cola,
    ahora: () => new Date("2026-11-10T23:00:00Z"),
    almacenPara: () => almacen,
    catalogosPara: async () => ({ etiquetas: new Map(), campos: new Map(), miembros: new Map() }),
    auditar: async (eventos) => {
      auditados.push(...eventos.map((e) => e.accion));
    },
    medirControl: async () => null,
    avisar: async (_imp, resumen) => {
      avisos.push(resumen);
    },
  };
  return { imp, deps, contactos, avances, terminadas, avisos, auditados, totales };
}

const tanda = (prefijo: string, n: number) => Array.from({ length: n }, (_, i) => [`${prefijo}-${i}`, `${prefijo.toLowerCase()}-${i}@x.com`]);

describe("procesarImportacion (F37, parte 2)", () => {
  it("procesa todas las tandas, termina y avisa una sola vez por correo a quien importó", async () => {
    const e = escenario({ tandas: [tanda("T0", 3), tanda("T1", 2)] });
    const r = await procesarImportacion("imp-1", e.deps);
    expect(r).toBe("terminada");
    expect(e.contactos).toHaveLength(5);
    expect(e.imp.estado).toBe("terminada");
    expect(e.avisos).toHaveLength(1);
    expect(e.avisos[0]).toMatchObject({ creados: 5, actualizados: 0, conError: 0 });
    expect(e.auditados.filter((a) => a === "contacto.creado")).toHaveLength(5);
    expect(e.auditados.filter((a) => a === "importacion.completada")).toHaveLength(1);
    // Una segunda corrida no vuelve a avisar.
    await procesarImportacion("imp-1", e.deps);
    expect(e.avisos).toHaveLength(1);
  });

  it("los números de fila siguen al archivo a través de las tandas (la primera de datos es la 2)", async () => {
    const e = escenario({ tandas: [tanda("T0", 2), [["", ""]]] });
    await procesarImportacion("imp-1", e.deps);
    expect(e.totales.lineas.map((l) => l.numero)).toEqual([2 + 500]);
  });

  it("si otro proceso la tiene reclamada, no hace nada", async () => {
    const e = escenario({ tandas: [tanda("T0", 2)], reclamadaPorOtro: true });
    expect(await procesarImportacion("imp-1", e.deps)).toBe("ocupada");
    expect(e.contactos).toHaveLength(0);
  });

  it("retoma desde la primera tanda sin procesar", async () => {
    const e = escenario({ tandas: [tanda("T0", 2), tanda("T1", 3)], procesadas: [0] });
    await procesarImportacion("imp-1", e.deps);
    expect(e.contactos.map((c) => c.display_name)).toEqual(["T1-0", "T1-1", "T1-2"]);
  });

  it("si falla, lo registra y queda para reintentar; al tercer fallo queda fallida y avisa igual", async () => {
    const e = escenario({ tandas: [tanda("T0", 1)], fallarEnTanda: 0 });
    expect(await procesarImportacion("imp-1", e.deps)).toBe("fallo");
    expect(e.imp).toMatchObject({ estado: "en_cola", intentos: 1, error: "la base no responde" });
    const e3 = escenario({ tandas: [tanda("T0", 1)], fallarEnTanda: 0, intentos: 2 });
    expect(await procesarImportacion("imp-1", e3.deps)).toBe("fallo");
    expect(e3.imp.estado).toBe("fallida");
    expect(e3.avisos).toHaveLength(1);
  });

  it("en el momento (500 filas o menos) no manda correo", async () => {
    const e = escenario({ tandas: [tanda("T0", 2)], enSegundoPlano: false });
    await procesarImportacion("imp-1", e.deps);
    expect(e.avisos).toHaveLength(0);
  });

  it("informa el avance para la barra", async () => {
    const e = escenario({ tandas: [tanda("T0", 30)] });
    await procesarImportacion("imp-1", e.deps);
    expect(e.avances.at(-1)).toBe(30);
  });
});
