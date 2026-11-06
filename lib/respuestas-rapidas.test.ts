import { describe, it, expect } from "vitest";
import { interpolar, filtrarRespuestas, barraEn, aplicarRespuesta, validarRespuesta, type RespuestaRapida } from "./respuestas-rapidas";

/**
 * F36: las Respuestas rápidas en la bandeja. «/» abre el selector, que busca
 * por nombre o atajo; al elegir, se inserta el contenido con las variables del
 * contacto y del espacio, y lo que falta queda vacío.
 */
const R = (nombre: string, atajo: string, contenido = "x"): RespuestaRapida => ({ id: atajo, nombre, atajo, contenido });

describe("interpolar (criterios 3 y 4)", () => {
  const datos = { contacto: { display_name: "Ana Pérez", email: "ana@x.com", phone: "+50688881234" }, espacio: { name: "Alo Mercadeo" } };

  it("reemplaza las cuatro variables", () => {
    expect(interpolar("Hola {{contact.display_name}} ({{contact.email}}, {{contact.phone}}), te escribe {{workspace.name}}", datos)).toBe(
      "Hola Ana Pérez (ana@x.com, +50688881234), te escribe Alo Mercadeo",
    );
  });

  it("si un dato falta, queda vacío", () => {
    expect(interpolar("Hola {{contact.display_name}}, {{contact.email}}.", { contacto: { display_name: null, email: undefined }, espacio: null })).toBe("Hola , .");
  });

  it("acepta espacios dentro de las llaves; lo que no es una de las cuatro, queda como está", () => {
    expect(interpolar("{{ contact.display_name }} {{contact.otra}}", datos)).toBe("Ana Pérez {{contact.otra}}");
  });
});

describe("filtrar (criterio 2: por nombre o atajo)", () => {
  const lista = [R("Saludo inicial", "hola"), R("Precios del curso", "precios"), R("Ubicación", "donde")];

  it("sin texto, todas", () => {
    expect(filtrarRespuestas(lista, "").map((r) => r.atajo)).toEqual(["hola", "precios", "donde"]);
  });

  it("por atajo o por nombre, sin mayúsculas ni tildes", () => {
    expect(filtrarRespuestas(lista, "prec").map((r) => r.atajo)).toEqual(["precios"]);
    expect(filtrarRespuestas(lista, "UBICACION").map((r) => r.atajo)).toEqual(["donde"]);
    expect(filtrarRespuestas(lista, "nada")).toEqual([]);
  });
});

describe("la barra mientras se escribe", () => {
  it("«/» al principio o después de un espacio abre el selector, con lo escrito después", () => {
    expect(barraEn("/", 1)).toEqual({ desde: 0, consulta: "" });
    expect(barraEn("Hola /pre", 9)).toEqual({ desde: 5, consulta: "pre" });
  });

  it("una barra en medio de una palabra, o con un espacio después, no", () => {
    expect(barraEn("http://x", 8)).toBeNull();
    expect(barraEn("a/b", 3)).toBeNull();
    expect(barraEn("/pre cios", 9)).toBeNull();
    expect(barraEn("sin barra", 9)).toBeNull();
  });

  it("al elegir, reemplaza «/consulta» por el contenido y deja el cursor al final de lo insertado", () => {
    expect(aplicarRespuesta("Hola /pre y chau", { desde: 5, consulta: "pre" }, "Los precios son…")).toEqual({ texto: "Hola Los precios son… y chau", cursor: 21 });
  });
});

describe("validar una respuesta rápida", () => {
  it("nombre, atajo y contenido; el atajo en minúsculas, sin espacios ni «/»", () => {
    expect(validarRespuesta({ nombre: "Saludo", atajo: "hola", contenido: "Hola!" })).toEqual({ ok: true, valor: { nombre: "Saludo", atajo: "hola", contenido: "Hola!" } });
    expect(validarRespuesta({ nombre: " Saludo ", atajo: "/Hola", contenido: " Hola! " })).toEqual({ ok: true, valor: { nombre: "Saludo", atajo: "hola", contenido: "Hola!" } });
    expect(validarRespuesta({ nombre: "", atajo: "hola", contenido: "x" }).ok).toBe(false);
    expect(validarRespuesta({ nombre: "a", atajo: "ho la", contenido: "x" }).ok).toBe(false);
    expect(validarRespuesta({ nombre: "a", atajo: "hola", contenido: "  " }).ok).toBe(false);
    expect(validarRespuesta({ nombre: "a".repeat(81), atajo: "hola", contenido: "x" }).ok).toBe(false);
  });
});

describe("moverse en el selector con el teclado", () => {
  it("las flechas dan la vuelta; con la lista vacía, nada", async () => {
    const { moverEleccion } = await import("./respuestas-rapidas");
    expect(moverEleccion(0, 3, "ArrowDown")).toBe(1);
    expect(moverEleccion(2, 3, "ArrowDown")).toBe(0);
    expect(moverEleccion(0, 3, "ArrowUp")).toBe(2);
    expect(moverEleccion(0, 0, "ArrowDown")).toBe(0);
  });
});
