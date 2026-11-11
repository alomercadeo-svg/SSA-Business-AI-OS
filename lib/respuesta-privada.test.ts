import { describe, it, expect, vi } from "vitest";
import { decidirRespuestaPrivada, enviarRespuestaPrivada, diasParaResponder, type RegistroDeComentario } from "./respuesta-privada";

/**
 * F40, criterio de la respuesta privada (ítem 6 de la sesión de cierre): hasta
 * 7 días desde el comentario, una sola vez, controlado con `comment_logs`
 * (00061: `comentado_at` y `respuesta_privada_at`). Si no corresponde, 409 sin
 * llamar a Zernio. El endpoint de Zernio, verificado el 06/11/2026 en
 * `@zernio/node` 0.2.519: `POST /v1/inbox/comments/{postId}/{commentId}/private-reply`.
 */
const ahora = new Date("2026-11-10T23:00:00.000Z");
const base: RegistroDeComentario = {
  id: "cl-1",
  workspaceId: "ws-1",
  postId: "post-1",
  commentId: "com-1",
  lateAccountId: "acc-1",
  comentadoAt: "2026-11-09T01:52:00.000Z",
  creadoAt: "2026-11-09T01:52:05.000Z",
  respuestaPrivadaAt: null,
};

describe("decidirRespuestaPrivada", () => {
  it("dentro de los 7 días y sin respuesta: se puede, con los días que quedan", () => {
    expect(decidirRespuestaPrivada(base, ahora)).toEqual({ ok: true });
    expect(diasParaResponder(base, ahora)).toBe(6);
  });
  it("ya respondido: no", () => {
    expect(decidirRespuestaPrivada({ ...base, respuestaPrivadaAt: "2026-11-10T00:00:00.000Z" }, ahora)).toEqual({ ok: false, motivo: "ya_respondido" });
  });
  it("pasados 7 días desde el comentario: no; sin la hora del comentario, cuenta la de proceso", () => {
    expect(decidirRespuestaPrivada({ ...base, comentadoAt: "2026-11-03T22:59:00.000Z" }, ahora)).toEqual({ ok: false, motivo: "vencido" });
    expect(decidirRespuestaPrivada({ ...base, comentadoAt: null, creadoAt: "2026-11-03T22:59:00.000Z" }, ahora)).toEqual({ ok: false, motivo: "vencido" });
  });
});

describe("enviarRespuestaPrivada", () => {
  const deps = (reg: RegistroDeComentario | null, reclamo = true) => {
    const enviar = vi.fn(async () => ({ messageId: "m-1" }));
    const soltar = vi.fn(async () => {});
    return {
      enviar,
      soltar,
      d: {
        leer: async () => reg,
        reclamar: vi.fn(async () => reclamo),
        soltar,
        enviar,
        ahora: () => ahora,
      },
    };
  };

  it("control positivo: dentro de la regla, llama a Zernio una vez con el comentario y la cuenta, y queda respondido", async () => {
    const x = deps(base);
    const r = await enviarRespuestaPrivada("cl-1", "ws-1", "¡Gracias!", x.d);
    expect(r).toMatchObject({ status: 200 });
    expect(x.enviar).toHaveBeenCalledWith({ postId: "post-1", commentId: "com-1", accountId: "acc-1", mensaje: "¡Gracias!" });
  });

  it("ya respondido o vencido: 409 y Zernio no se llama", async () => {
    for (const reg of [{ ...base, respuestaPrivadaAt: "2026-11-10T00:00:00.000Z" }, { ...base, comentadoAt: "2026-11-01T00:00:00.000Z" }]) {
      const x = deps(reg);
      const r = await enviarRespuestaPrivada("cl-1", "ws-1", "hola", x.d);
      expect(r.status).toBe(409);
      expect(x.enviar).not.toHaveBeenCalled();
    }
  });

  it("si otro pedido la reclamó primero (dos clics a la vez), 409 sin llamar a Zernio", async () => {
    const x = deps(base, false);
    const r = await enviarRespuestaPrivada("cl-1", "ws-1", "hola", x.d);
    expect(r).toMatchObject({ status: 409, motivo: "ya_respondido" });
    expect(x.enviar).not.toHaveBeenCalled();
  });

  it("si Zernio la rechaza, se suelta el reclamo (se puede reintentar) y el error es claro", async () => {
    const x = deps(base);
    x.d.enviar = vi.fn(async () => {
      throw new Error("PLATFORM_LIMITATION");
    });
    const r = await enviarRespuestaPrivada("cl-1", "ws-1", "hola", x.d);
    expect(r.status).toBe(502);
    expect(x.soltar).toHaveBeenCalledTimes(1);
    expect(r.error).toBe("Instagram no aceptó la respuesta privada. No quedó enviada; podés probar de nuevo.");
  });

  it("de otro espacio o inexistente: 404; un mensaje vacío: 400", async () => {
    expect((await enviarRespuestaPrivada("cl-1", "ws-1", "hola", deps(null).d)).status).toBe(404);
    expect((await enviarRespuestaPrivada("cl-1", "ws-1", "  ", deps(base).d)).status).toBe(400);
  });
});
