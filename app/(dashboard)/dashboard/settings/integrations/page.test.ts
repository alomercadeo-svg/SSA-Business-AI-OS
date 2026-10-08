import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * La guarda de la pantalla de integraciones (F24, primer criterio): solo Owner y
 * Admin, con el control hecho en el servidor. Un Member que entra por la
 * dirección vuelve a /dashboard **sin que se lea nada** de `integration_configs`
 * ni de Vault. La contraparte: un Owner y un Admin sí llegan a leerla; sin eso,
 * "el Member no lee" pasaría también con la página rota.
 *
 * Escrito el 08/10/2026 sobre una guarda que ya existía, así que no se vio en
 * rojo solo: se vio en rojo cambiando un momento la guarda de la página por
 * `getWorkspace`, que no mira el rol, y volviéndola atrás.
 */

const h = vi.hoisted(() => ({
  rol: "member",
  tablas: [] as string[],
  secretosLeidos: 0,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from(tabla: string) {
      h.tablas.push(tabla);
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        order: () => cadena,
        limit: () => cadena,
        in: () => cadena,
        upsert: () => cadena,
        maybeSingle: async () =>
          tabla === "workspace_members"
            ? { data: { workspace_id: "ws-1", role: h.rol, workspaces: { id: "ws-1", name: "Espacio" } }, error: null }
            : { data: null, error: null },
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return cadena;
    },
  }),
}));

vi.mock("@/lib/vault", async (original) => ({
  ...(await original<typeof import("@/lib/vault")>()),
  getWorkspaceSecret: async () => {
    h.secretosLeidos++;
    return null;
  },
}));

beforeEach(() => {
  h.tablas.length = 0;
  h.secretosLeidos = 0;
  vi.resetModules();
});

async function abrir() {
  const { default: IntegrationsPage } = await import("./page");
  return IntegrationsPage();
}

describe("quién puede abrir la pantalla de integraciones", () => {
  it("un Member vuelve a /dashboard sin que se lea integration_configs ni Vault", async () => {
    h.rol = "member";
    await expect(abrir()).rejects.toThrow("REDIRECT:/dashboard");
    expect(h.tablas).not.toContain("integration_configs");
    expect(h.tablas).not.toContain("channels");
    expect(h.secretosLeidos).toBe(0);
  });

  it("control positivo: un Owner llega a leer integration_configs", async () => {
    h.rol = "owner";
    await abrir().catch(() => {});
    expect(h.tablas).toContain("integration_configs");
  });

  it("control positivo: un Admin también", async () => {
    h.rol = "admin";
    await abrir().catch(() => {});
    expect(h.tablas).toContain("integration_configs");
  });
});
