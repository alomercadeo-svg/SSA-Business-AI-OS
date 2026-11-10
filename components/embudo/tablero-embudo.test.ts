import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** El Embudo (10/11/2026), por la fuente: los textos y la lectura con la sesión. La pantalla la mira Marcos. */
const ruta = (p: string) => join(process.cwd(), p);
const leer = (p: string) => (existsSync(ruta(p)) ? readFileSync(ruta(p), "utf8") : "");

describe("la pantalla del Embudo", () => {
  const pagina = leer("app/(dashboard)/dashboard/embudo/page.tsx");
  const tablero = leer("components/embudo/tablero-embudo.tsx");
  it("lee con la sesión del usuario, nunca con la clave de servicio, hasta 1000 y lo dice", () => {
    expect(pagina).toContain("getWorkspace()");
    expect(pagina).not.toContain("createServiceClient");
    expect(pagina).toContain(".limit(LIMITE)");
    expect(tablero).toContain("Se muestran los primeros {limite}");
  });
  it("los textos de vacío y la tarjeta que abre la ficha", () => {
    expect(tablero).toContain("Todavía no hay contactos con etapa. Las etapas llegan con la importación desde Pipedrive.");
    expect(tablero).toContain("Sin contactos");
    expect(tablero).toContain("href={`/dashboard/contacts/${contacto.id}`}");
  });
  it("el filtro va en la dirección, con Todos, Abiertos, Ganados y Perdidos", () => {
    for (const t of ["Todos", "Abiertos", "Ganados", "Perdidos"]) expect(tablero).toContain(`"${t}"`);
    expect(tablero).toContain("/dashboard/embudo?estado=");
  });
});
