import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ORDEN_POR_DEFECTO, SIN_FILTROS_DE_CONTACTOS, direccionDeContactos, filtrosDeContactos, hayFiltrosDeContactos, ordenParaLaBase, paraLaBaseDeContactos } from "./contactos";

/** F43, criterio 7 (09/11/2026): el orden de Contactos en la dirección y hacia la base (00056). Escritos en rojo antes del cambio. */
describe("el orden de Contactos", () => {
  it("se lee de la dirección; lo inválido vuelve al de siempre", () => {
    expect(filtrosDeContactos(new URLSearchParams("orden=nombre&dir=asc")).orden).toEqual({ campo: "nombre", dir: "asc" });
    expect(filtrosDeContactos(new URLSearchParams("orden=setter&dir=desc")).orden).toEqual({ campo: "setter", dir: "desc" });
    expect(filtrosDeContactos(new URLSearchParams("orden=telefono&dir=asc")).orden).toEqual(ORDEN_POR_DEFECTO);
    expect(filtrosDeContactos(new URLSearchParams("orden=nombre&dir=x")).orden).toEqual({ campo: "nombre", dir: "asc" });
  });

  it("queda en la dirección, junto con la búsqueda y los filtros; el de siempre no se escribe", () => {
    const f = { ...SIN_FILTROS_DE_CONTACTOS, q: "ana", orden: { campo: "nombre" as const, dir: "desc" as const } };
    expect(direccionDeContactos(f, 2)).toBe("/dashboard/contacts?q=ana&orden=nombre&dir=desc&pagina=2");
    expect(direccionDeContactos(SIN_FILTROS_DE_CONTACTOS, 1)).toBe("/dashboard/contacts");
  });

  it("no es un filtro: no va en el jsonb de los filtros ni cuenta como filtro puesto (control)", () => {
    const f = { ...SIN_FILTROS_DE_CONTACTOS, orden: { campo: "correo" as const, dir: "asc" as const } };
    expect(paraLaBaseDeContactos(f)).toEqual({});
    expect(hayFiltrosDeContactos(f)).toBe(false);
  });

  it("hacia la base: orden, dir y los setters en orden", () => {
    const f = { ...SIN_FILTROS_DE_CONTACTOS, orden: { campo: "setter" as const, dir: "asc" as const } };
    expect(ordenParaLaBase(f, ["u-ana", "u-beto"])).toEqual({ orden: "setter", dir: "asc", setters: ["u-ana", "u-beto"] });
  });

  it("la página no vuelve a ordenar con PostgREST encima de la función (pisaría el orden)", () => {
    const fuente = readFileSync(resolve(__dirname, "contactos.ts"), "utf8");
    const pagina = fuente.slice(fuente.indexOf("async function pagina("), fuente.indexOf("export async function leerContactos"));
    expect(pagina).not.toContain(".order(");
    expect(pagina).toContain("ordenParaLaBase(");
  });
});

describe("la pantalla del orden", () => {
  const vista = readFileSync(resolve(__dirname, "../app/(dashboard)/dashboard/contacts/contacts-view.tsx"), "utf8");
  it("los encabezados Nombre, Correo, Última interacción y Setter ordenan, con aria-sort", () => {
    for (const campo of ["nombre", "correo", "interaccion", "setter"]) expect(vista, campo).toContain(`ordenarPor("${campo}")`);
    expect(vista).toContain("aria-sort=");
  });
  it("en el teléfono, un selector «Ordenar por»", () => {
    expect(vista).toContain('aria-label="Ordenar por"');
  });
});
