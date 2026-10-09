import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * La ruta de las tareas programadas: el secreto va SOLO en el encabezado
 * `Authorization: Bearer`. Nunca en la dirección (`?key=`), que es lo que usan
 * las rutas del fork (`app/api/cron/jobs/route.ts:34-38`). Sin `CRON_SECRET`
 * en el servidor, falla cerrada.
 */

const correrTareas = vi.fn(async () => ({ espacios: 1, fallidas: 0, ocupadas: 0 }));
vi.mock("@/lib/tareas-programadas", () => ({ correrTareas }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));

const { POST } = await import("./route");

const SECRETO = "secreto-de-cron-de-prueba-0123456789";
const pedido = (headers: Record<string, string> = {}, url = "https://app.ejemplo/api/cron/tareas") =>
  new NextRequest(url, { method: "POST", headers });

beforeEach(() => {
  correrTareas.mockClear();
  vi.stubEnv("CRON_SECRET", SECRETO);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/cron/tareas", () => {
  it("sin secreto: 401 y no corre nada", async () => {
    const res = await POST(pedido());
    expect(res.status).toBe(401);
    expect(correrTareas).not.toHaveBeenCalled();
  });

  it("con el secreto en la dirección (?key=): 401", async () => {
    const res = await POST(pedido({}, `https://app.ejemplo/api/cron/tareas?key=${SECRETO}`));
    expect(res.status).toBe(401);
    expect(correrTareas).not.toHaveBeenCalled();
  });

  it("con un secreto equivocado: 401", async () => {
    expect((await POST(pedido({ authorization: `Bearer ${SECRETO}x` }))).status).toBe(401);
    expect((await POST(pedido({ authorization: `Bearer ${SECRETO.slice(0, -1)}` }))).status).toBe(401);
    expect((await POST(pedido({ authorization: SECRETO }))).status).toBe(401);
    expect(correrTareas).not.toHaveBeenCalled();
  });

  it("sin CRON_SECRET en el servidor falla cerrada, aunque venga un Bearer vacío", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(pedido({ authorization: "Bearer " }))).status).toBe(401);
    expect((await POST(pedido({ authorization: `Bearer ${SECRETO}` }))).status).toBe(401);
    expect(correrTareas).not.toHaveBeenCalled();
  });

  it("control positivo: con el secreto en el encabezado corre las tareas y responde 200", async () => {
    const res = await POST(pedido({ authorization: `Bearer ${SECRETO}` }));
    expect(res.status).toBe(200);
    expect(correrTareas).toHaveBeenCalledTimes(1);
  });

  it("si algún espacio falló, responde 500 para que el servicio de Railway lo marque", async () => {
    correrTareas.mockResolvedValueOnce({ espacios: 2, fallidas: 1, ocupadas: 0 });
    const res = await POST(pedido({ authorization: `Bearer ${SECRETO}` }));
    expect(res.status).toBe(500);
  });
});
