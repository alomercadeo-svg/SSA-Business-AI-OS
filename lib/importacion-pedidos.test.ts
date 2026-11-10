import { describe, it, expect } from "vitest";
import { leerInicio, leerTanda, tandasCompletas } from "./importacion-pedidos";

/** F37, parte 2: los pedidos de la subida por tandas (ítem 2 de la sesión de cierre). */
const inicio = { accion: "empezar", nombreArchivo: "a.csv", codigoPais: "+506", asignarA: null, etiquetaOrigen: "Importado", mapeo: ["nombre", "correo"], total: 1200 };

describe("leerInicio", () => {
  it("acepta hasta 10.000 filas y calcula las tandas de 500", () => {
    expect(leerInicio(inicio)).toMatchObject({ total: 1200, tandas: 3, enSegundoPlano: true });
    expect(leerInicio({ ...inicio, total: 10_000 })).toMatchObject({ tandas: 20 });
    expect(leerInicio({ ...inicio, total: 500 })).toMatchObject({ tandas: 1, enSegundoPlano: false });
  });
  it("más de 10.000 filas, cero filas, un mapeo raro o un código mal escrito: el motivo", () => {
    expect(leerInicio({ ...inicio, total: 10_001 })).toBe("Hasta 10.000 filas por importación.");
    expect(leerInicio({ ...inicio, total: 0 })).toBe("La planilla no tiene filas.");
    expect(leerInicio({ ...inicio, mapeo: ["inventado"] })).toBe("Pedido inválido.");
    expect(leerInicio({ ...inicio, codigoPais: "506" })).toBe("El código de país tiene que ser como +506.");
  });
});

describe("leerTanda", () => {
  const filas = Array.from({ length: 500 }, () => ["Ana", "a@x.com"]);
  it("una tanda de hasta 500 filas, con tantas celdas como columnas mapeadas", () => {
    expect(leerTanda({ accion: "tanda", importacion: "i", numero: 0, filas }, { tandas: 3, columnas: 2 })).toMatchObject({ numero: 0 });
  });
  it("rechaza más de 500 filas, un número fuera de rango o celdas que no son texto", () => {
    expect(leerTanda({ accion: "tanda", importacion: "i", numero: 0, filas: [...filas, ["x", "y"]] }, { tandas: 3, columnas: 2 })).toBe("Hasta 500 filas por tanda.");
    expect(leerTanda({ accion: "tanda", importacion: "i", numero: 3, filas }, { tandas: 3, columnas: 2 })).toBe("Pedido inválido.");
    expect(leerTanda({ accion: "tanda", importacion: "i", numero: 0, filas: [[1, 2]] }, { tandas: 3, columnas: 2 })).toBe("Pedido inválido.");
  });
});

describe("tandasCompletas", () => {
  it("todas las tandas y la cuenta de filas tienen que cerrar antes de procesar", () => {
    expect(tandasCompletas({ total: 1200, tandas: 3 }, [{ numero: 0, filas: 500 }, { numero: 1, filas: 500 }, { numero: 2, filas: 200 }])).toBe(true);
    expect(tandasCompletas({ total: 1200, tandas: 3 }, [{ numero: 0, filas: 500 }, { numero: 2, filas: 200 }])).toBe(false);
    expect(tandasCompletas({ total: 1200, tandas: 3 }, [{ numero: 0, filas: 500 }, { numero: 1, filas: 500 }, { numero: 2, filas: 199 }])).toBe(false);
  });
});
