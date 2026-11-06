import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Configuración › Respuestas rápidas (F36, criterio 1; §11.1: solo Owner y
 * Admin, con el control en el servidor). Un Member que entra por la dirección
 * vuelve a /dashboard sin que se lea `response_templates`. La contraparte: un
 * Owner y un Admin sí la leen.
 *
 * Y la regla de nomenclatura del CLAUDE.md: en la interfaz, «Respuestas
 * rápidas», nunca «plantilla» a secas (criterio 5).
 */
const h = vi.hoisted(() => ({ rol: "member", tablas: [] as string[] }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => {} }),
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
        is: () => cadena,
        order: () => cadena,
        limit: () => cadena,
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

beforeEach(() => {
  h.tablas.length = 0;
  vi.resetModules();
});

async function abrir() {
  const { default: Pagina } = await import("./page");
  return Pagina();
}

describe("quién abre Configuración › Respuestas rápidas", () => {
  it("un Member vuelve a /dashboard sin que se lea response_templates", async () => {
    h.rol = "member";
    await expect(abrir()).rejects.toThrow("REDIRECT:/dashboard");
    expect(h.tablas).not.toContain("response_templates");
  });

  it("control positivo: un Owner y un Admin la leen", async () => {
    for (const rol of ["owner", "admin"]) {
      h.rol = rol;
      h.tablas.length = 0;
      vi.resetModules();
      await abrir().catch(() => {});
      expect(h.tablas).toContain("response_templates");
    }
  });
});

describe("la pantalla de Respuestas rápidas", () => {
  async function vista(respuestas: { id: string; nombre: string; atajo: string; contenido: string }[]) {
    const { RespuestasRapidasView } = await import("./respuestas-view");
    return renderToStaticMarkup(createElement(RespuestasRapidasView, { respuestas }));
  }

  it("vacía: lo explica y ofrece crear la primera", async () => {
    const h = await vista([]);
    expect(h).toContain("Todavía no hay respuestas rápidas");
    expect(h).toContain("Escribí una vez los textos que repetís seguido. Después los insertás en la bandeja escribiendo /.");
    expect(h).toContain("Nueva respuesta rápida");
  });

  it("con respuestas: el título, la ayuda, las columnas y cada una con Editar y Eliminar", async () => {
    const h = await vista([{ id: "r-1", nombre: "Precios", atajo: "precios", contenido: "Los precios son…" }]);
    expect(h).toContain(">Respuestas rápidas</h1>");
    expect(h).toContain("Textos que se insertan en la bandeja escribiendo /. No son plantillas de WhatsApp.");
    for (const t of [">Nombre<", ">Atajo<", ">Texto<", ">/precios<", ">Precios<", "Los precios son…", ">Editar<", ">Eliminar<"]) expect(h).toContain(t);
  });

  it("nunca «plantilla» a secas, en la pantalla ni en sus archivos (salvo «plantillas de WhatsApp»)", async () => {
    const h = await vista([{ id: "r-1", nombre: "a", atajo: "a", contenido: "a" }]);
    const aSecas = /\bplantillas?\b(?! de WhatsApp)/i;
    // Control: la expresión sí agarra «plantilla» a secas, y no «plantillas de WhatsApp».
    expect("Elegí una plantilla").toMatch(aSecas);
    expect("No son plantillas de WhatsApp.").not.toMatch(aSecas);
    expect(h).not.toMatch(aSecas);
    const dir = join(process.cwd(), "app/(dashboard)/dashboard/settings/response-templates");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const fuente = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(fuente, f).not.toMatch(aSecas);
    }
  });
});
