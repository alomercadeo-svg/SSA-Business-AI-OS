import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 1b (ítem 4 de la sesión de cierre), §11.1: «Si igual entra a una, la pantalla
 * dice "Esa sección es solo para Owner y Admin. Te llevamos a la bandeja.", y el
 * control está en el servidor». Por la fuente: la pantalla la mira Marcos.
 */
const leer = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("el Member que entra a una sección de managers", () => {
  it("la guarda del servidor lo manda a la bandeja con el aviso, no a /dashboard (que llevaba a Flujos)", () => {
    expect(leer("lib/workspace.ts")).toMatch(/if \(!esManager\(contexto\.role\)\) redirect\("\/dashboard\/inbox\?aviso=solo-managers"\)/);
  });
  it("la bandeja muestra el texto de §11.1", () => {
    expect(leer("app/(dashboard)/dashboard/inbox/page.tsx")).toContain("Esa sección es solo para Owner y Admin. Te llevamos a la bandeja.");
  });
  it("las pantallas del fork (Flujos, Secuencias, Difusiones, Analíticas y Growth) piden Owner o Admin en el servidor", () => {
    for (const s of ["flows", "sequences", "broadcasts", "analytics", "growth"]) {
      expect([s, leer(`app/(dashboard)/dashboard/${s}/page.tsx`).includes("getWorkspaceAsManager()")]).toEqual([s, true]);
    }
  });
  it("entrar a /dashboard lleva a la bandeja, que es para todos", () => {
    expect(leer("app/(dashboard)/dashboard/page.tsx")).toContain('redirect("/dashboard/inbox")');
  });
});
