import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectorDeRespuestas } from "./selector-respuestas";

/**
 * F36, criterio 2: el selector que abre «/» en el campo de escritura de la
 * bandeja. Muestra el atajo, el nombre y el comienzo del texto de cada una; la
 * elegida con el teclado se marca. Sin coincidencias, lo dice.
 */
const OPCIONES = [
  { id: "r-1", nombre: "Saludo", atajo: "hola", contenido: "Hola {{contact.display_name}}, ¿cómo estás?" },
  { id: "r-2", nombre: "Precios del curso", atajo: "precios", contenido: "Los precios son…" },
];
const html = (opciones = OPCIONES, elegida = 0) => renderToStaticMarkup(createElement(SelectorDeRespuestas, { opciones, elegida, alElegir: () => {} }));

describe("el selector de Respuestas rápidas (F36)", () => {
  it("una lista con cada respuesta: atajo, nombre y texto", () => {
    const h = html();
    expect(h).toMatch(/role="listbox"/);
    expect(h).toMatch(/aria-label="Respuestas rápidas"/);
    for (const t of [">/hola<", ">Saludo<", ">/precios<", ">Precios del curso<", "Los precios son…"]) expect(h).toContain(t);
  });

  it("la elegida con el teclado queda marcada, y solo esa", () => {
    const h = html(OPCIONES, 1);
    expect(h.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(h).toMatch(/aria-selected="true"[^>]*>[\s\S]*?\/precios/);
  });

  it("sin coincidencias: «Ninguna respuesta rápida coincide»", () => {
    expect(html([])).toContain("Ninguna respuesta rápida coincide");
  });

  it("en el teléfono va encima del campo, a todo el ancho, con la lista desplazable", () => {
    const clases = (html().match(/<div[^>]*role="listbox"[^>]*class="([^"]*)"|<div class="([^"]*)"[^>]*role="listbox"/) ?? []).slice(1).join(" ").split(/\s+/);
    expect(clases).toEqual(expect.arrayContaining(["absolute", "bottom-full", "left-0", "right-0", "overflow-y-auto"]));
  });
});
