import { describe, it, expect, vi } from "vitest";

/**
 * La entrada «Integraciones» del menú, solo para Owner y Admin (F24, criterio
 * devuelto el 23/09/2026, auditoría #20a). Esconderla es comodidad: el control
 * real es la guarda del servidor, que prueba `settings/integrations/page.test.ts`.
 *
 * Escrito el 08/10/2026 sobre un filtro que ya existía. Se vio en rojo sacando
 * un momento la marca `soloManagers` de la entrada, y volviéndola a poner.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({}) }));

const { entradasVisibles } = await import("./sidebar");
const nombres = (rol: string | undefined) => entradasVisibles(rol).map((e) => e.name);

describe("quién ve Integraciones en el menú", () => {
  it("un Member no la ve, y sin rol tampoco", () => {
    expect(nombres("member")).not.toContain("Integraciones");
    expect(nombres(undefined)).not.toContain("Integraciones");
  });

  it("control positivo: Owner y Admin la ven", () => {
    expect(nombres("owner")).toContain("Integraciones");
    expect(nombres("admin")).toContain("Integraciones");
  });

  it("el Member igual ve el resto del menú: el filtro no esconde de más", () => {
    expect(nombres("member")).toContain("Inbox");
    expect(nombres("member").length).toBe(nombres("owner").length - 1);
  });
});
