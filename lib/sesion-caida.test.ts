import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F31 (ítem 3 de la sesión de cierre): «canal con error» también cuando se cae
 * la sesión de WhatsApp (F32). Hasta hoy quedaba solo el correo; el historial
 * tenía «canal con error» únicamente para las alertas de `webhook_alerts`.
 */
const registrarAuditoria = vi.fn(async () => true);
const notificarSesionWhatsapp = vi.fn(async () => null);
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria }));
vi.mock("@/lib/correo", () => ({ notificarSesionWhatsapp }));

beforeEach(() => {
  registrarAuditoria.mockClear();
  notificarSesionWhatsapp.mockClear();
});

describe("alCambiarLaSesion", () => {
  it("caída o intentos agotados: una entrada «canal con error» con el estado, y el correo", async () => {
    const { alCambiarLaSesion } = await import("./sesion-caida");
    await alCambiarLaSesion({ canalId: "ch-1", workspaceId: "ws-1", de: "conectado", a: "caido", avisar: true }, { servicio: {} as never });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", accion: "canal.error", entidad: expect.objectContaining({ tipo: "canal", id: "ch-1" }), detalle: expect.objectContaining({ sesion: "caido", antes: "conectado" }) }),
    );
    expect(notificarSesionWhatsapp).toHaveBeenCalledTimes(1);
  });
  it("control: una transición que no avisa (vuelve a conectarse) no deja error ni correo", async () => {
    const { alCambiarLaSesion } = await import("./sesion-caida");
    await alCambiarLaSesion({ canalId: "ch-1", workspaceId: "ws-1", de: "caido", a: "conectado", avisar: false }, { servicio: {} as never });
    expect(registrarAuditoria).not.toHaveBeenCalled();
    expect(notificarSesionWhatsapp).not.toHaveBeenCalled();
  });
});
