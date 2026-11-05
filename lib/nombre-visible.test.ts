import { describe, it, expect } from "vitest";
import { SIN_NOMBRE, inicialDe, nombreVisible } from "./nombre-visible";

/**
 * F43, criterio 5: el nombre que se muestra de un contacto, igual en la
 * bandeja, en Contactos y en la ficha. No escribe en ningún contacto ni
 * deduce nada de la forma del nombre (requerimientos-fase1.md:620): compara
 * con el identificador de remitente guardado del propio contacto.
 */
describe("nombreVisible", () => {
  it("un nombre de verdad se muestra tal cual", () => {
    expect(nombreVisible({ display_name: "Tania Robles" }, [{ platform_sender_id: "1784", platform_username: null }])).toBe("Tania Robles");
  });

  it("el nombre igual a su identificador, sin usuario: «Sin nombre»", () => {
    expect(nombreVisible({ display_name: "17841400000000" }, [{ platform_sender_id: "17841400000000", platform_username: null }])).toBe("Sin nombre");
  });

  it("el nombre igual a su identificador, con usuario: «@usuario»", () => {
    expect(nombreVisible({ display_name: "1785" }, [{ platform_sender_id: "1785", platform_username: "tania_roblesc" }])).toBe("@tania_roblesc");
  });

  it("sin nombre: el usuario, y si no hay, «Sin nombre»", () => {
    expect(nombreVisible({ display_name: null }, [{ platform_sender_id: "x", platform_username: "ana" }])).toBe("@ana");
    expect(nombreVisible({ display_name: "   " }, [])).toBe("Sin nombre");
    expect(nombreVisible({ display_name: null }, undefined)).toBe("Sin nombre");
  });

  it("un nombre con forma de número que no es su identificador queda (no se deduce de la forma)", () => {
    expect(nombreVisible({ display_name: "50688881234" }, [{ platform_sender_id: "50688881234@s.whatsapp.net", platform_username: null }])).toBe("50688881234");
  });

  it("el identificador de otro canal del mismo contacto también cuenta", () => {
    expect(nombreVisible({ display_name: "abc@lid" }, [{ platform_sender_id: "1784", platform_username: null }, { platform_sender_id: "abc@lid", platform_username: null }])).toBe(SIN_NOMBRE);
  });
});

describe("inicialDe", () => {
  it("la primera letra, sin la @; «Sin nombre» lleva «?»", () => {
    expect(inicialDe("tania")).toBe("T");
    expect(inicialDe("@ana")).toBe("A");
    expect(inicialDe(SIN_NOMBRE)).toBe("?");
  });
});
