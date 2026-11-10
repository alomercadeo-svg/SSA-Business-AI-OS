import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F37, parte 1: «Importar CSV» en Contactos, solo para Owner y Admin esta
 * noche. Por la fuente: no prueba la pantalla (eso lo mira Marcos). Escrito
 * en rojo antes de sumar el botón.
 */
const vista = readFileSync(resolve(__dirname, "../../app/(dashboard)/dashboard/contacts/contacts-view.tsx"), "utf8");
const pagina = readFileSync(resolve(__dirname, "../../app/(dashboard)/dashboard/contacts/importar/page.tsx"), "utf8");

describe("F37: la entrada a la importación", () => {
  it("Contactos tiene «Importar CSV» hacia /dashboard/contacts/importar, solo con el equipo completo (Owner y Admin)", () => {
    expect(vista).toMatch(/equipoCompleto\s*&&\s*\(\s*<Link\s+href="\/dashboard\/contacts\/importar"/);
    expect(vista).toContain("Importar CSV");
  });
  it("la página exige Owner o Admin en el servidor (control)", () => {
    expect(pagina).toContain("getWorkspaceAsManager()");
  });
});

describe("la etiqueta de origen viaja aparte (retrabajo del 09/11, a)", () => {
  const pantalla = readFileSync(resolve(__dirname, "importar-contactos.tsx"), "utf8");
  it("la pantalla la manda como etiquetaOrigen, no como una columna más de etiquetas", () => {
    expect(pantalla).toMatch(/etiquetaOrigen: etiquetaOrigen\.trim\(\) \|\| null/);
    expect(pantalla).not.toContain("[...mapeo, \"etiquetas\"]");
  });
});

describe("el resumen dice qué etiquetas se crearon (decisión del 09/11, b)", () => {
  const pantalla = readFileSync(resolve(__dirname, "importar-contactos.tsx"), "utf8");
  it("muestra «Etiquetas creadas: …» cuando hubo", () => {
    expect(pantalla).toMatch(/Etiquetas creadas: \{resultado\.etiquetasCreadas\.join\(", "\)\}/);
  });
});

describe("F38: la migración desde Pipedrive en la pantalla", () => {
  const pantalla = readFileSync(resolve(__dirname, "importar-contactos.tsx"), "utf8");
  it("el selector de columnas ofrece las siete columnas comerciales y la nota", () => {
    for (const [valor, texto] of [
      ["etapa", "Etapa"],
      ["estado_trato", "Estado del trato"],
      ["valor", "Valor del trato"],
      ["moneda", "Moneda"],
      ["fecha_cierre", "Fecha de cierre"],
      ["pipedrive_trato", "Id de trato de Pipedrive"],
      ["nota", "Nota del contacto"],
    ]) {
      expect(pantalla).toContain(`{ valor: "${valor}", texto: "${texto}" }`);
    }
  });
  it("el resumen muestra el control de §11, con lo que falta, y dice cuando no se pudo medir", () => {
    expect(pantalla).toContain("Control de la migración: {resultado.control.encontrados} de {resultado.control.enArchivo} tratos");
    expect(pantalla).toContain("Faltan {resultado.control.enArchivo - resultado.control.encontrados}");
    expect(pantalla).toContain("No se pudo contar el control de la migración");
  });
});
