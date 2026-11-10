import { describe, it, expect } from "vitest";
import { contenidoDeFinDeImportacion, destinatarioDeImportacion } from "./correo";

/** F37, criterio 8 (ítem 2 de la sesión de cierre): el aviso de fin de una importación en segundo plano, vía F23. */
describe("el correo de fin de importación", () => {
  it("dice el archivo, los números y dónde ver el detalle", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.ejemplo.com";
    const c = contenidoDeFinDeImportacion({ id: "imp-1", nombreArchivo: "leads.csv", filas: 1200, creados: 1000, actualizados: 150, conError: 50, estado: "terminada", control: null });
    expect(c.asunto).toBe("Terminó la importación de «leads.csv»");
    expect(c.parrafos.join("\n")).toContain("1200 filas: 1000 creados, 150 actualizados y 50 con error");
    expect(c.parrafos.join("\n")).toContain("https://app.ejemplo.com/dashboard/contacts/importar?importacion=imp-1");
  });

  it("con el control de la migración, lo dice; si no se pudo terminar, lo dice sin inventar números", () => {
    const c = contenidoDeFinDeImportacion({ id: "i", nombreArchivo: "a.csv", filas: 10, creados: 1, actualizados: 0, conError: 0, estado: "terminada", control: { medido: true, enArchivo: 380, encontrados: 379, enEspacio: 380 } });
    expect(c.parrafos.join("\n")).toContain("Control de la migración: 379 de 380 tratos. Faltan 1.");
    const f = contenidoDeFinDeImportacion({ id: "i", nombreArchivo: "a.csv", filas: 10, creados: 3, actualizados: 0, conError: 0, estado: "fallida", control: null });
    expect(f.asunto).toBe("No se pudo terminar la importación de «a.csv»");
  });

  it("va a quien importó, y solo a esa persona", async () => {
    const servicio = { auth: { admin: { getUserById: async (id: string) => ({ data: { user: id === "u-1" ? { email: "Ana@Ejemplo.com" } : null } }) } } };
    expect(await destinatarioDeImportacion(servicio as never, "u-1")).toEqual(["ana@ejemplo.com"]);
    expect(await destinatarioDeImportacion(servicio as never, null)).toEqual([]);
  });
});
