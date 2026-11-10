import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 1b (ítem 4 de la sesión de cierre; §15 del plano, «El Member puede crear y
 * publicar flujos del fork»): crear, cambiar, borrar, publicar y restaurar un
 * flujo es de Owner y Admin, controlado en el servidor. Un flujo publicado
 * corre con la clave de servicio ante cualquier contacto, así que un Member
 * podría hacer que el sistema le escriba a leads fuera de su alcance.
 */
const h = vi.hoisted(() => ({ rol: "member", escrituras: [] as string[] }));

function cadena(tabla: string) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of ["select", "eq", "order", "limit", "in", "is", "neq", "not", "or", "match"]) c[m] = self;
  for (const m of ["insert", "update", "delete", "upsert"]) c[m] = () => (h.escrituras.push(`${m}:${tabla}`), c);
  const fila = tabla === "workspace_members" ? { workspace_id: "ws-1", role: h.rol } : { id: "f-1", workspace_id: "ws-1", version: 1, nodes: [], edges: [], viewport: null, name: "F", status: "draft", trigger_type: null };
  c.single = async () => ({ data: fila, error: null });
  c.maybeSingle = async () => ({ data: fila, error: null });
  c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: [fila], error: null }).then(ok);
  return c;
}
const supabaseFalso = { auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) }, from: (t: string) => cadena(t) };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabaseFalso, createServiceClient: async () => supabaseFalso }));
vi.mock("@/lib/workspace", async () => {
  const { NextResponse } = await import("next/server");
  const ctx = () => ({ user: { id: "u-1" }, workspace: { id: "ws-1" }, role: h.rol, supabase: supabaseFalso });
  return {
    esManager: (r: string) => r === "owner" || r === "admin",
    requireManager: async () =>
      h.rol === "owner" || h.rol === "admin"
        ? { contexto: ctx(), error: null }
        : { contexto: null, error: NextResponse.json({ error: "Requiere rol de Owner o Admin" }, { status: 403 }) },
    getWorkspaceOrNull: async () => ctx(),
  };
});

const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ flowId: "f-1", versionId: "v-1", ...extra }) });
const pedido = (cuerpo: unknown = {}) => new NextRequest("https://app.ejemplo/api", { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });

beforeEach(() => {
  h.escrituras = [];
});

describe("los flujos del fork, solo para Owner y Admin", () => {
  it("un Member recibe 403 al crear, cambiar, borrar, publicar o restaurar, y no se escribe nada", async () => {
    h.rol = "member";
    const crear = await (await import("./route")).POST(pedido({ name: "x" }));
    const uno = await import("./[flowId]/route");
    const cambiar = await uno.PUT(pedido({ name: "y" }), params());
    const borrar = await uno.DELETE(pedido(), params());
    const publicar = await (await import("./[flowId]/publish/route")).POST(pedido(), params());
    const restaurar = await (await import("./[flowId]/versions/[versionId]/restore/route")).POST(pedido(), params());
    expect([crear.status, cambiar.status, borrar.status, publicar.status, restaurar.status]).toEqual([403, 403, 403, 403, 403]);
    expect(h.escrituras).toEqual([]);
  });

  it("control: un Admin sí crea y publica", async () => {
    h.rol = "admin";
    const crear = await (await import("./route")).POST(pedido({ name: "x" }));
    const publicar = await (await import("./[flowId]/publish/route")).POST(pedido(), params());
    expect(crear.status).toBeLessThan(300);
    expect(publicar.status).toBeLessThan(300);
    expect(h.escrituras).toContain("insert:flows");
    expect(h.escrituras).toContain("update:flows");
  });
});
