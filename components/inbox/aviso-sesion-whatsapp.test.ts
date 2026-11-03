import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { AvisoSesionWhatsapp, canalesCaidos } = await import("./aviso-sesion-whatsapp");

/**
 * F32, criterio 6: si la sesión de WhatsApp está caída, la bandeja lo indica de
 * forma visible. Una bandeja silenciosa no puede parecer un día tranquilo.
 * Solo caído y «se agotaron los intentos»: «sin vincular» no (decisión de
 * Marcos del 02/11/2026), y «no se pudo verificar» tampoco (no es una caída).
 */

const canal = (estado: string | null, extra: Record<string, unknown> = {}) => ({
  id: `c-${estado}`,
  display_name: null,
  instance_name: "alomercadeo-ventas",
  session_state: estado as never,
  session_changed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...extra,
});
const aviso = (canales: ReturnType<typeof canal>[], esManager = true) =>
  renderToStaticMarkup(createElement(AvisoSesionWhatsapp, { inicial: canales, esManager }));

describe("el aviso de WhatsApp caído en la bandeja", () => {
  it("con la sesión caída, aparece con lo que pasa (control positivo)", () => {
    const html = aviso([canal("caido")]);
    expect(html).toContain("WhatsApp no está recibiendo mensajes");
    expect(html).toContain("lo que le escriban no llega a la bandeja");
  });

  it("con «se agotaron los intentos», aparece con su propio texto", () => {
    expect(aviso([canal("agotado")])).toContain("WhatsApp quedó desvinculado");
  });

  it("conectado, sin vincular, no se pudo verificar o sin lectura: no aparece", () => {
    for (const e of ["conectado", "sin_vincular", "sin_verificar", null]) {
      expect(aviso([canal(e)]), String(e)).toBe("");
    }
  });

  it("el botón a Canales lo ve Owner y Admin; un Member ve el texto sin botón", () => {
    expect(aviso([canal("caido")], true)).toContain('href="/dashboard/channels"');
    const member = aviso([canal("caido")], false);
    expect(member).toContain("WhatsApp no está recibiendo mensajes");
    expect(member).not.toContain('href="/dashboard/channels"');
  });

  it("canalesCaidos elige solo caído y agotado", () => {
    expect(canalesCaidos([canal("caido"), canal("conectado"), canal("agotado")]).map((c) => c.session_state)).toEqual(["caido", "agotado"]);
  });

  it("está montado arriba de la bandeja", () => {
    const pagina = readFileSync(join(process.cwd(), "app/(dashboard)/dashboard/inbox/page.tsx"), "utf8");
    expect(pagina).toMatch(/<AvisoSesionWhatsapp[\s\S]*?<InboxView/);
  });
});
