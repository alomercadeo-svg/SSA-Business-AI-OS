import { describe, it, expect } from "vitest";
import {
  PROVEEDORES,
  definicionDe,
  validarFormatoClave,
  mascaraDeClave,
  filasPorDefecto,
  agruparPorTipo,
  aTarjeta,
} from "./integraciones";

/**
 * Las reglas puras de la pantalla de integraciones (F24): qué proveedores hay,
 * cómo se valida una clave, y qué se le muestra al navegador de una clave.
 * Se vieron en rojo antes de escribir `lib/integraciones.ts`: no existía.
 */

describe("el catálogo de proveedores", () => {
  it("trae Instagram, WhatsApp, correo y los tres de IA, y ni Facebook ni X", () => {
    expect(Object.keys(PROVEEDORES).sort()).toEqual(["anthropic", "evolution", "google", "openai", "resend", "zernio"]);
  });

  it("la clave de Evolution no se carga ni se muestra desde la pantalla", () => {
    expect(definicionDe("evolution").editable).toBe(false);
    expect(definicionDe("evolution").mostrarMascara).toBe(false);
  });

  it("un proveedor que no está en el catálogo igual tiene definición: aparece sin tocar código", () => {
    const d = definicionDe("telegram");
    expect(d.editable).toBe(true);
    expect(d.secreto).toBe("integracion_telegram");
  });

  it("las filas por defecto son una por proveedor del catálogo, sin clave adentro", () => {
    const filas = filasPorDefecto("ws-1");
    expect(filas.map((f) => f.proveedor).sort()).toEqual(Object.keys(PROVEEDORES).sort());
    for (const f of filas) expect(JSON.stringify(f)).not.toMatch(/api_key/);
  });

  it("agrupa por tipo en el orden canales, correo, IA", () => {
    const g = agruparPorTipo([
      { tipo: "ia", orden: 1 },
      { tipo: "canal", orden: 2 },
      { tipo: "correo", orden: 3 },
      { tipo: "canal", orden: 1 },
    ]);
    expect(g.map((s) => s.tipo)).toEqual(["canal", "correo", "ia"]);
    expect(g[0].filas.map((f) => f.orden)).toEqual([1, 2]);
  });
});

describe("la validación del formato de una clave", () => {
  it("Resend exige el prefijo re_, que es el único documentado", () => {
    expect(validarFormatoClave(definicionDe("resend"), "abcdefghijklmnopqrstuvwxyz")).toMatch(/re_/);
    expect(validarFormatoClave(definicionDe("resend"), "re_abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });

  it("rechaza una clave corta, vacía o con espacios adentro", () => {
    expect(validarFormatoClave(definicionDe("openai"), "corta")).not.toBeNull();
    expect(validarFormatoClave(definicionDe("openai"), "   ")).not.toBeNull();
    expect(validarFormatoClave(definicionDe("openai"), "una clave con espacios adentro")).not.toBeNull();
  });

  it("acepta una clave larga sin prefijo donde no hay prefijo documentado", () => {
    expect(validarFormatoClave(definicionDe("anthropic"), "x".repeat(40))).toBeNull();
  });
});

describe("la máscara de una clave: a lo sumo largo y últimos cuatro", () => {
  it("nunca devuelve la clave ni un pedazo mayor a cuatro caracteres", () => {
    const valor = "re_ESTOESUNSECRETOQUENOSEVE1234";
    const m = mascaraDeClave(valor);
    expect(m).toEqual({ largo: valor.length, ultimos4: "1234" });
    expect(JSON.stringify(m)).not.toContain("SECRETO");
  });

  it("con una clave corta no muestra ni los últimos cuatro", () => {
    expect(mascaraDeClave("abcdefgh")).toEqual({ largo: 8, ultimos4: null });
  });

  it("sin clave no hay máscara", () => {
    expect(mascaraDeClave(null)).toBeNull();
  });
});

describe("la tarjeta que viaja al navegador", () => {
  const fila = {
    id: "i-1", tipo: "correo" as const, proveedor: "resend", nombre: "Correo (Resend)", orden: 30,
    config: { modelo: null }, estado: "conectado" as const, verificado_el: null, ultimo_error: null,
  };

  it("lleva si hay clave y la máscara, nunca la clave", () => {
    const valor = "re_ESTOESUNSECRETOQUENOSEVE5555";
    const t = aTarjeta(fila, valor);
    expect(t.configurada).toBe(true);
    expect(t.mascara).toEqual({ largo: valor.length, ultimos4: "5555" });
    expect(JSON.stringify(t)).not.toContain("SECRETO");
  });

  it("de Evolution no lleva ni la máscara: solo si está configurada", () => {
    const t = aTarjeta({ ...fila, tipo: "canal", proveedor: "evolution", nombre: "WhatsApp" }, "x".repeat(40));
    expect(t.configurada).toBe(true);
    expect(t.mascara).toBeNull();
    expect(t.editable).toBe(false);
  });

  it("toma el modelo de config y nada más de ahí", () => {
    const t = aTarjeta({ ...fila, tipo: "ia", proveedor: "openai", config: { modelo: "gpt-x", otra: "cosa" } }, null);
    expect(t.modelo).toBe("gpt-x");
    expect(t.configurada).toBe(false);
    expect(JSON.stringify(t)).not.toContain("cosa");
  });
});
