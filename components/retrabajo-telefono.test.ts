import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Retrabajo del ítem 4 del plan maestro (06/11/2026), lo que Marcos vio en el
 * iPhone de 15:07 a 15:42. Por la fuente, como los tramos 7 a 9 de S8: el
 * acomodo real en un teléfono lo prueba Marcos, y estos tests no lo prueban.
 */
const leer = (r: string) => readFileSync(resolve(__dirname, "..", r), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Lo que queda fuera de todo `@layer { … }` de la hoja global. */
function fueraDeLasCapas(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const j = css.indexOf("@layer", i);
    if (j === -1) { out += css.slice(i); break; }
    out += css.slice(i, j);
    const llave = css.indexOf("{", j);
    const puntoYComa = css.indexOf(";", j);
    if (llave === -1 || (puntoYComa !== -1 && puntoYComa < llave)) { i = puntoYComa + 1; continue; }
    let prof = 0;
    let k = llave;
    for (; k < css.length; k++) {
      if (css[k] === "{") prof++;
      else if (css[k] === "}" && --prof === 0) break;
    }
    i = k + 1;
  }
  return out;
}

describe("a. los campos no hacen agrandar la página en el iPhone", () => {
  const css = sinComentarios(leer("app/globals.css"));
  const libre = fueraDeLasCapas(css);
  const regla = libre.match(/@media\s*\(max-width:\s*767\.98px\)\s*\{([\s\S]*?)\}\s*\}/);

  it("en el ancho del teléfono, input, textarea y select van a 16px", () => {
    expect(regla, "falta la regla del teléfono fuera de las capas").toBeTruthy();
    const cuerpo = regla![1];
    for (const campo of ["input", "textarea", "select"]) expect(cuerpo).toMatch(new RegExp(`\\b${campo}\\b`));
    expect(cuerpo).toMatch(/font-size:\s*16px/);
  });

  it("la regla está fuera de @layer: si no, `text-sm` de cada campo le gana", () => {
    // Las utilidades de Tailwind 4 viven en `@layer utilities`; lo que no está
    // en ninguna capa les gana en la cascada.
    expect(libre).toMatch(/font-size:\s*16px/);
  });

  it("control: no se bloquea el agrandado de la página (accesibilidad)", () => {
    const layout = leer("app/layout.tsx");
    expect(layout).not.toMatch(/maximum-?[sS]cale|user-?[sS]calable|maximumScale|userScalable/);
  });
});

describe("b. el hilo abre en el último mensaje", () => {
  const hilo = sinComentarios(leer("components/inbox/message-thread.tsx"));
  it("no usa scrollIntoView: mueve la página entera además del hilo", () => {
    expect(hilo).not.toMatch(/scrollIntoView/);
  });
  it("se queda abajo mientras cargan las fotos, si estaba abajo", () => {
    expect(hilo).toMatch(/new ResizeObserver/);
    expect(hilo).toMatch(/estaAlFinal\(/);
  });
  it("al cambiar de conversación baja al final de una, sin animación", () => {
    expect(hilo).toMatch(/conversation\?\.id/);
    expect(hilo).toMatch(/scrollTop\s*=\s*\w+\.scrollHeight/);
  });
});

describe("c. el encabezado sigue a la vista con el teclado", () => {
  it("el marco de la app es el componente que sigue a la parte visible", () => {
    const layout = sinComentarios(leer("app/(dashboard)/layout.tsx"));
    expect(layout).toMatch(/<MarcoDeLaApp/);
    const marco = sinComentarios(leer("components/marco-de-la-app.tsx"));
    expect(marco).toMatch(/visualViewport/);
    expect(marco).toMatch(/ajusteAlTeclado\(/);
    expect(marco).toMatch(/\(max-width: 767\.98px\)/);
  });
});

describe("e. la foto entra en la pantalla y la «X» siempre se ve", () => {
  const visor = sinComentarios(leer("components/inbox/visor-foto.tsx"));
  it("el fondo deja lugar arriba para la «X», y la «X» va encima de la foto", () => {
    expect(visor).toMatch(/aria-label="Foto a pantalla completa"[\s\S]*?className="[^"]*\bpt-16\b/);
    expect(visor).toMatch(/aria-label="Cerrar"[\s\S]*?className="[^"]*\bz-10\b/);
  });
});

describe("g. Contactos en el teléfono: nada más ancho que la pantalla", () => {
  const vista = sinComentarios(leer("app/(dashboard)/dashboard/contacts/contacts-view.tsx"));
  it("los selectores de los filtros pueden achicarse dentro de su columna", () => {
    expect(vista).toMatch(/const claseDelSelector =\s*"[^"]*\bmin-w-0\b[^"]*\bw-full\b/);
  });
  it("el marco principal no se ensancha con lo que tiene adentro", () => {
    const layout = sinComentarios(leer("app/(dashboard)/layout.tsx"));
    expect(layout).toMatch(/<main className="[^"]*\bmin-w-0\b/);
  });
});

describe("f. la ficha: nada afuera de la pantalla", () => {
  it("la columna del valor puede achicarse, y un texto largo se parte en cualquier punto", () => {
    const ficha = sinComentarios(leer("app/(dashboard)/dashboard/contacts/[contactId]/page.tsx"));
    expect(ficha).toMatch(/grid-cols-\[7\.5rem_minmax\(0,1fr\)\]/);
    expect(ficha).toMatch(/\[overflow-wrap:anywhere\]/);
  });
});

describe("segundo retrabajo del ítem 4 (06/11/2026, lo que vio Marcos de 16:56 a 17:05)", () => {
  const hilo = sinComentarios(leer("components/inbox/message-thread.tsx"));
  const bandeja = sinComentarios(leer("app/(dashboard)/dashboard/inbox/inbox-view.tsx"));

  it("a. el encabezado del chat, en el teléfono, en dos filas; desde md, una", () => {
    expect(hilo).toMatch(/className="flex flex-col gap-1\.5 border-b border-border px-4 py-2 md:h-14 md:flex-row md:items-center md:justify-between md:gap-3 md:py-0"/);
  });

  it("b. el hilo guarda su lugar al abrir el panel y lo repone al volver", () => {
    expect(bandeja).toMatch(/panelAbierto=\{panelEnTelefono\}/);
    expect(hilo).toMatch(/panelAbierto\?: boolean/);
    expect(hilo).toMatch(/lugarDelHilo\(/);
    expect(hilo).toMatch(/scrollParaVolver\(/);
  });
});
