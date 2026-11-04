import { describe, it, expect, vi } from "vitest";

/**
 * La lista de «Asignación» de la bandeja (F35, tramo B), según el rol
 * (decidido por Marcos el 04/11/2026). Un Member ve «Todas», «Sin asignar» y
 * solo a sí mismo: la página no le pide el equipo a `miembrosDelEspacio`, que
 * usa la clave de servicio y se saltea la política de `workspace_members`
 * (00020), que a un Member le deja ver solo su fila.
 */

vi.mock("@/lib/miembros", () => ({ miembrosDelEspacio: vi.fn() }));
const { miembrosParaLaBandeja } = await import("./miembros-bandeja");

const YO = { id: "u-yo", email: "yo@ejemplo.test", user_metadata: { full_name: "Laura Member" } };
const EQUIPO = [
  { id: "u-owner", etiqueta: "Ale Owner" },
  { id: "u-yo", etiqueta: "Laura Member" },
];

describe("miembrosParaLaBandeja", () => {
  it("un Member: solo él mismo, sin pedirle el equipo a la clave de servicio", async () => {
    const leer = vi.fn(async () => EQUIPO);
    const r = await miembrosParaLaBandeja("member", YO as never, "ws-1", leer);
    expect(leer).not.toHaveBeenCalled();
    expect(r).toEqual([{ id: "u-yo", etiqueta: "Laura Member" }]);
  });

  it("Owner y Admin: todo el equipo", async () => {
    for (const rol of ["owner", "admin"]) {
      const leer = vi.fn(async () => EQUIPO);
      expect(await miembrosParaLaBandeja(rol, YO as never, "ws-1", leer)).toEqual(EQUIPO);
      expect(leer).toHaveBeenCalledWith("ws-1");
    }
  });

  it("si no se pudo leer el equipo, la bandeja no se cae: la lista queda con quien mira", async () => {
    const leer = vi.fn(async () => {
      throw new Error("workspace_members: caído");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await miembrosParaLaBandeja("owner", YO as never, "ws-1", leer)).toEqual([{ id: "u-yo", etiqueta: "Laura Member" }]);
    error.mockRestore();
  });
});
