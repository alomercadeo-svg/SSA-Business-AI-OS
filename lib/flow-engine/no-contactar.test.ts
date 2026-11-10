import { describe, it, expect, vi } from "vitest";

/**
 * F34, criterio 6 (ítem 3 de la sesión de cierre): el motor de flujos no le
 * escribe a un contacto marcado «no contactar». Hasta hoy la marca se
 * respetaba en la bandeja (409 en `app/api/v1/messages/route.ts`) y en las
 * secuencias (00053), pero el motor, que corre con cada mensaje de Instagram,
 * no la miraba (`engine.ts`, envíos en `executeSendMessage`,
 * `executePrivateReply` y `ai-response`).
 */
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({}) }));
vi.mock("@/lib/vault", () => ({ getZernioApiKey: async () => "k" }));
vi.mock("@/lib/integraciones-estado", () => ({ registrarFalloDeZernio: async () => {} }));

function base(noContactar: boolean) {
  const tablas: string[] = [];
  const cadena = (tabla: string) => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const m of ["select", "eq", "neq", "in", "is", "order", "limit", "update", "insert", "upsert", "delete"]) c[m] = self;
    const fila = tabla === "contacts" ? { id: "ct-1", do_not_contact: noContactar } : null;
    c.single = async () => ({ data: fila, error: fila ? null : { code: "PGRST116", message: "0 filas" } });
    c.maybeSingle = async () => ({ data: fila, error: null });
    c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: fila ? [fila] : [], error: null }).then(ok);
    return c;
  };
  return { tablas, supabase: { from: (t: string) => (tablas.push(t), cadena(t)) } };
}

const contexto = { flowId: "f-1", contactId: "ct-1", channelId: "ch-1", workspaceId: "ws-1", conversationId: "cv-1", platform: "instagram", incomingMessage: { text: "hola" } };

describe("el motor de flujos y la marca de no contactar", () => {
  it("con el contacto marcado, el flujo no arranca: no lee el flujo ni crea sesión", async () => {
    const { executeFlow } = await import("./engine");
    const b = base(true);
    await executeFlow(b.supabase as never, structuredClone(contexto) as never);
    expect(b.tablas).not.toContain("flows");
    expect(b.tablas).not.toContain("flow_sessions");
  });

  it("control positivo: sin la marca, el motor sigue (lee las sesiones y el flujo)", async () => {
    const { executeFlow } = await import("./engine");
    const b = base(false);
    await executeFlow(b.supabase as never, structuredClone(contexto) as never).catch(() => {});
    expect(b.tablas).toContain("flows");
  });
});
