import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("./webhook-alerts-actions", () => ({ resolverAlertaDeWebhook: async () => {} }));

const { WebhookAlertsBanner } = await import("./webhook-alerts-banner");

/**
 * El aviso de Canales para las alertas del receptor (F22). Un rechazo de
 * autenticación es cualquier entrega cuyo JWT no verifica: un mensaje real de
 * un lead, o una entrega que no viene de nuestro número, por ejemplo una prueba
 * (decidido por Marcos el 03/11/2026). La pantalla no afirma que cada uno sea
 * un mensaje perdido.
 */

const AHORA = "2026-11-03T12:00:00.000Z";

/** El cliente del usuario con lo justo: `from…select…eq…is…order…returns`. */
function supabaseCon(alertas: Array<Record<string, unknown>>) {
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    order: () => q,
    returns: async () => ({ data: alertas, error: null }),
  };
  return { from: () => q } as never;
}

async function aviso(condicion: string, ocurrencias: number): Promise<string> {
  const alerta = {
    id: "al-1",
    workspace_id: "ws-1",
    source: "evolution",
    alert_condition: condicion,
    detail: condicion === "webhook_unknown_instance" ? "instancia-x" : null,
    occurrences: ocurrencias,
    first_seen_at: AHORA,
    last_seen_at: AHORA,
  };
  const elemento = await WebhookAlertsBanner({ supabase: supabaseCon([alerta]), workspaceId: "ws-1", esOwner: false });
  return renderToStaticMarkup(elemento!);
}

describe("el aviso del rechazo de autenticación", () => {
  it("cuenta avisos rechazados, no mensajes perdidos", async () => {
    const uno = await aviso("webhook_auth_failed", 1);
    expect(uno).toContain("1 aviso rechazado");
    const tres = await aviso("webhook_auth_failed", 3);
    expect(tres).toContain("3 avisos rechazados");
    expect(uno + tres).not.toMatch(/perdid/);
  });

  it("explica que un aviso rechazado puede no venir de nuestro número", async () => {
    const html = await aviso("webhook_auth_failed", 2);
    expect(html).toContain("Cada aviso rechazado que venía de tu WhatsApp es un mensaje de un lead que no entró a la bandeja");
    expect(html).toContain("Un aviso rechazado también puede ser una entrega que no viene de tu número, por ejemplo una prueba.");
  });

  it("no dice que cada mensaje nuevo se pierde", async () => {
    expect(await aviso("webhook_auth_failed", 2)).not.toContain("cada mensaje nuevo se pierde");
  });

  /** Control: la instancia desconocida no cambia. */
  it("la instancia desconocida sigue contando intentos de entrega y diciendo que todavía no se perdió ninguno", async () => {
    const html = await aviso("webhook_unknown_instance", 4);
    expect(html).toContain("4 intentos de entrega rechazados");
    expect(html).toContain("Todavía no se perdió ningún mensaje");
  });
});
