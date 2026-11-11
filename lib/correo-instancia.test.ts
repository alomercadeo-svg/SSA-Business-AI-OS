import { describe, it, expect } from "vitest";
import { contenidoDeAlerta, destinatariosDeInstanciaDesconocida } from "./correo";

/**
 * Pendiente de decisión de §15 (ítem 7 de la sesión de cierre): «a quién se
 * avisa por correo la alerta de instancia desconocida». Se aplica la propuesta
 * escrita en §15: solo a los Owner de los espacios con un canal de Evolution
 * activo (un subconjunto de quienes la ven), con el texto que no afirma la causa.
 */
function servicioFalso() {
  const filas: Record<string, unknown[]> = {
    channels: [{ workspace_id: "ws-evo" }],
    workspace_members: [
      { user_id: "u-owner", workspace_id: "ws-evo", role: "owner" },
      { user_id: "u-admin", workspace_id: "ws-evo", role: "admin" },
      { user_id: "u-otro", workspace_id: "ws-sin-evo", role: "owner" },
    ],
  };
  const correos: Record<string, string> = { "u-owner": "Owner@Ejemplo.com", "u-admin": "admin@ejemplo.com", "u-otro": "otro@ejemplo.com" };
  return {
    from: (tabla: string) => {
      const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
      const c = {
        select: () => c,
        eq: (k: string, v: unknown) => (filtros.push((f) => f[k] === v || (k === "is_active" || k === "provider")), c),
        in: (k: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[k])), c),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: (filas[tabla] ?? []).filter((f) => filtros.every((p) => p(f as Record<string, unknown>))), error: null }).then(ok),
      };
      return c;
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: correos[id] } } }) } },
  };
}

describe("el correo de la instancia desconocida", () => {
  it("va solo a los Owner de los espacios con un canal de Evolution activo", async () => {
    expect(await destinatariosDeInstanciaDesconocida(servicioFalso() as never)).toEqual(["owner@ejemplo.com"]);
  });
  it("dice el texto de §15, sin afirmar la causa", () => {
    const c = contenidoDeAlerta("webhook_unknown_instance", 3);
    expect(c.parrafos.join(" ")).toContain("Llegó un aviso de WhatsApp de una instancia que no corresponde a ningún canal activo. Puede ser un nombre de instancia mal escrito o un canal apagado. WhatsApp lo reintenta durante unos 20 minutos: si se corrige antes, los mensajes se recuperan.");
  });
});
