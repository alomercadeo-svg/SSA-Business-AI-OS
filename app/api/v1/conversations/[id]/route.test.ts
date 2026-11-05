import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Cerrar y reabrir (F35, tramo D de S8), con la base simulada. Que la seguridad
 * por filas decida qué conversación puede tocar cada uno lo prueba
 * `scripts/verify-estados-bandeja.mjs` con sesiones reales contra producción.
 */

const CONV = "55555555-5555-4555-8555-555555555555";

const estado: {
  usuario: { id: string } | null;
  conversacion: Record<string, unknown> | null;
  contacto: { next_followup_date: string | null } | null;
  espacio: { zona_horaria: string | null } | null;
  escrito: Record<string, unknown> | null;
  updates: Array<Record<string, unknown>>;
} = { usuario: null, conversacion: null, contacto: null, espacio: null, escrito: null, updates: [] };

function supabaseFalso() {
  return {
    auth: { getUser: async () => ({ data: { user: estado.usuario } }) },
    from: (tabla: string) => ({
      select: () => {
        const c: any = {
          eq: () => c,
          maybeSingle: async () => ({
            data: tabla === "conversations" ? estado.conversacion : tabla === "contacts" ? estado.contacto : estado.espacio,
            error: null,
          }),
        };
        return c;
      },
      update: (campos: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              estado.updates.push(campos);
              return { data: estado.escrito, error: null };
            },
          }),
        }),
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabaseFalso() }));
const { PATCH } = await import("./route");

const APP = "https://app.ejemplo.test";
const pedir = (cuerpo: unknown, origen: string | null = APP) =>
  PATCH(
    new NextRequest(`${APP}/api/v1/conversations/${CONV}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(origen ? { Origin: origen } : {}) },
      body: JSON.stringify(cuerpo),
    }),
    { params: Promise.resolve({ id: CONV }) },
  );

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP;
  // 18:30 de Costa Rica del 04/11/2026: en UTC ya es el 05.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T00:30:00Z"));
  estado.usuario = { id: "u1" };
  estado.conversacion = { id: CONV, status: "open", contact_id: "ct1", workspace_id: "ws1" };
  estado.contacto = { next_followup_date: null };
  estado.espacio = { zona_horaria: "America/Costa_Rica" };
  estado.escrito = { id: CONV, status: "closed" };
  estado.updates = [];
});
afterEach(() => vi.useRealTimers());

describe("PATCH /api/v1/conversations/[id]", () => {
  it("sin sesión, 401 y no escribe", async () => {
    estado.usuario = null;
    expect((await pedir({ estado: "closed" })).status).toBe(401);
    expect(estado.updates).toEqual([]);
  });

  it("desde otro origen, 403 y no escribe", async () => {
    expect((await pedir({ estado: "closed" }, "https://otro.ejemplo")).status).toBe(403);
    expect(estado.updates).toEqual([]);
  });

  it("un estado que no es closed ni open, 400", async () => {
    expect((await pedir({ estado: "snoozed" })).status).toBe(400);
    expect((await pedir({})).status).toBe(400);
    expect(estado.updates).toEqual([]);
  });

  it("una conversación que no ve, 404", async () => {
    estado.conversacion = null;
    expect((await pedir({ estado: "closed" })).status).toBe(404);
    expect(estado.updates).toEqual([]);
  });

  it("sin seguimiento, cierra", async () => {
    const r = await pedir({ estado: "closed" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "closed" });
    expect(estado.updates).toEqual([{ status: "closed" }]);
  });

  it("con el seguimiento de hoy en la zona del espacio, 409 y no cierra (a las 18:30 de Costa Rica, en UTC ya es mañana)", async () => {
    estado.contacto = { next_followup_date: "2026-11-04" };
    const r = await pedir({ estado: "closed" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "pide_seguimiento", fecha: "2026-11-04" });
    expect(estado.updates).toEqual([]);
  });

  it("con el seguimiento vencido, 409", async () => {
    estado.contacto = { next_followup_date: "2026-11-01" };
    expect((await pedir({ estado: "closed" })).status).toBe(409);
    expect(estado.updates).toEqual([]);
  });

  it("con el seguimiento de mañana en la zona del espacio, cierra (el 05/11 ya es hoy en UTC: el control de la zona)", async () => {
    estado.contacto = { next_followup_date: "2026-11-05" };
    expect((await pedir({ estado: "closed" })).status).toBe(200);
    expect(estado.updates).toEqual([{ status: "closed" }]);
  });

  it("reabrir no mira el seguimiento", async () => {
    estado.conversacion = { ...estado.conversacion!, status: "closed" };
    estado.contacto = { next_followup_date: "2026-11-01" };
    estado.escrito = { id: CONV, status: "open" };
    const r = await pedir({ estado: "open" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "open" });
    expect(estado.updates).toEqual([{ status: "open" }]);
  });

  it("si el update no toca ninguna fila, 404 (no un 200 sin cambios)", async () => {
    estado.escrito = null;
    expect((await pedir({ estado: "closed" })).status).toBe(404);
  });
});
