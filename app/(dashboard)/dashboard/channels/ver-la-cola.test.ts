import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContadorSinTelefono } from "./contador-sin-telefono";

/**
 * «Ver la cola» (§11, «Pantalla: Canales», y F35, tramo B): la línea del
 * contador termina en «· Ver la cola», que lleva a la bandeja con el filtro
 * «Teléfono sin resolver» activo. Hasta el 04/11/2026 no había enlace: el
 * filtro no existía. Que el contador sea solo del Owner lo prueba
 * `contador-solo-owner.test.ts`.
 */

const base = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) });

describe("«Ver la cola» en el contador de Canales", () => {
  it("lleva a la bandeja con «Teléfono sin resolver» activo", async () => {
    const html = renderToStaticMarkup(await ContadorSinTelefono({ supabase: base([{ sin_telefono: 3, total: 40 }]) as never, workspaceId: "ws-1" }));
    expect(html).toContain("3 de 40");
    expect(html).toMatch(/<a[^>]*href="\/dashboard\/inbox\?telefono=sin-resolver"[^>]*>Ver la cola<\/a>/);
  });

  it("si no se pudo calcular, no ofrece la cola (control)", async () => {
    const html = renderToStaticMarkup(await ContadorSinTelefono({ supabase: base(null, { message: "x" }) as never, workspaceId: "ws-1" }));
    expect(html).not.toContain("Ver la cola");
  });
});
