import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El menú (§11.1, tal como lo pide el plano; decisión de la revisión del
 * 06/11/2026 para el ítem 4 del plan maestro): en voseo; Bandeja y Contactos
 * para todos; Canales, Integraciones y Configuración solo para Owner y Admin
 * (Respuestas rápidas se suma con F36); un grupo «Llegan más adelante» con
 * Flujos, Secuencias y Difusiones («Fase 2») y Analíticas («Fase 3»), que no
 * llevan a las pantallas del fork; y sin Growth.
 *
 * Esconder entradas es comodidad: el control real es la guarda del servidor en
 * cada página (`getWorkspaceAsManager`).
 *
 * Historia: el 08/10/2026 este archivo probaba solo «Integraciones», sobre el
 * menú en inglés del fork; se vio en rojo sacando la marca `soloManagers`. El
 * 06/11/2026 se reescribió con el menú nuevo.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({}) }));

const { entradasVisibles, LLEGAN_MAS_ADELANTE } = await import("./sidebar");
const nombres = (rol: string | undefined) => entradasVisibles(rol).map((e) => e.name);
const fuente = readFileSync(join(process.cwd(), "components/sidebar.tsx"), "utf8");

describe("quién ve qué en el menú", () => {
  it("un Member ve Bandeja y Contactos, y nada de managers; sin rol, igual", () => {
    expect(nombres("member")).toEqual(["Bandeja", "Contactos"]);
    expect(nombres(undefined)).toEqual(["Bandeja", "Contactos"]);
  });

  it("control positivo: Owner y Admin ven también Canales, Integraciones y Configuración", () => {
    for (const rol of ["owner", "admin"]) {
      expect(nombres(rol)).toEqual(["Bandeja", "Contactos", "Canales", "Integraciones", "Configuración"]);
    }
  });

  it("«Llegan más adelante»: Flujos, Secuencias y Difusiones con «Fase 2», Analíticas con «Fase 3», sin dirección", () => {
    expect(LLEGAN_MAS_ADELANTE.map((e) => [e.name, e.fase])).toEqual([
      ["Flujos", "Fase 2"],
      ["Secuencias", "Fase 2"],
      ["Difusiones", "Fase 2"],
      ["Analíticas", "Fase 3"],
    ]);
    for (const e of LLEGAN_MAS_ADELANTE) expect("href" in e).toBe(false);
    expect(fuente).toContain("Llegan más adelante");
  });

  it("sin Growth y sin los nombres del fork en inglés", () => {
    const todos = [...nombres("owner"), ...LLEGAN_MAS_ADELANTE.map((e) => e.name)];
    for (const n of ["Growth", "Flows", "Inbox", "Contacts", "Broadcasts", "Sequences", "Analytics", "Channels", "Settings"]) {
      expect(todos).not.toContain(n);
    }
    expect(fuente).not.toContain("/dashboard/growth");
    expect(fuente).not.toContain("Sign out");
    expect(fuente).toContain("Cerrar sesión");
    expect(fuente).toContain("Modo oscuro");
  });
});

describe("el menú en el teléfono (F35, criterio del teléfono)", () => {
  it("en el teléfono el menú lateral se oculta y hay un botón para abrirlo", () => {
    expect(fuente).toMatch(/<aside[^>]*className="[^"]*\bhidden\b[^"]*\bmd:flex\b/);
    expect(fuente).toMatch(/aria-label="Abrir el menú"/);
  });

  it("el menú abierto en el teléfono se cierra con Escape, tocando afuera o eligiendo una sección", () => {
    expect(fuente).toMatch(/"Escape"/);
    expect(fuente).toMatch(/aria-label="Cerrar el menú"/);
    expect(fuente).toMatch(/onClick=\{\(\) => setAbierto\(false\)\}/);
  });
});
