import { describe, it, expect } from "vitest";
import {
  descargarAdjunto,
  reintentarAdjuntos,
  seDescarga,
  tamanoMaximoEnBytes,
  ESPERA_DEL_REINTENTO_MS,
  TECHO_DE_INTENTOS,
  TIEMPO_MAXIMO_DE_DESCARGA_MS,
  type Almacen,
  type Cierre,
  type FilaDeAdjunto,
} from "./adjuntos";

/**
 * La descarga de F28 contra un almacén en memoria. `tomar` y `cerrar` imitan
 * las condiciones de `almacenDeSupabase` (`lib/adjuntos.ts`): los intentos
 * tienen que seguir en el valor esperado y el estado en pendiente o fallido.
 * Que el SQL real se comporte igual se comprueba en la prueba real.
 *
 * Las direcciones de los adjuntos son INVENTADAS, con la forma de
 * `WebhookPayloadMessage.message.attachments` (`@zernio/node` 0.2.519,
 * `dist/index.d.ts:7480-7505`): no hay un aviso real con adjunto guardado.
 */

type Fila = FilaDeAdjunto & {
  media_reclamado_at?: string | null;
  media_path?: string | null;
  media_mime?: string | null;
  media_bytes?: number | null;
  media_error?: string | null;
  created_at: string;
};

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const HTML = new TextEncoder().encode("<!doctype html><html></html>");

function fila(p: Partial<Fila> = {}): Fila {
  return {
    id: "m1",
    conversation_id: "c1",
    workspace_id: "w1",
    direction: "inbound",
    attachments: [{ type: "image", url: "https://cdn.ejemplo.invalid/a.jpg" }],
    media_status: "pendiente",
    media_intentos: 0,
    media_reclamado_at: null,
    created_at: "2026-10-09T10:00:00.000Z",
    ...p,
  };
}

function almacenEnMemoria(filas: Fila[]) {
  const porId = new Map(filas.map((f) => [f.id, f]));
  const subidas: Array<{ ruta: string; mime: string; bytes: number }> = [];
  const abierto = (f: Fila) => f.media_status === "pendiente" || f.media_status === "fallido";
  const almacen: Almacen = {
    async leer(id) {
      const f = porId.get(id);
      return f ? { ...f } : null;
    },
    async tomar(id, desde, ahora) {
      const f = porId.get(id);
      if (!f || f.media_intentos !== desde || !abierto(f)) return false;
      f.media_intentos = desde + 1;
      f.media_reclamado_at = ahora.toISOString();
      return true;
    },
    async cerrar(id, tomado, cierre: Cierre) {
      const f = porId.get(id);
      if (!f || f.media_intentos !== tomado || !abierto(f)) return false;
      Object.assign(f, cierre);
      return true;
    },
    async subir(ruta, datos, mime) {
      subidas.push({ ruta, mime, bytes: datos.byteLength });
      return { error: null };
    },
    async porReintentar(ahora, limite) {
      const antesDe = ahora.getTime() - ESPERA_DEL_REINTENTO_MS;
      return [...porId.values()]
        .filter(
          (f) =>
            f.media_intentos !== null &&
            f.media_intentos < TECHO_DE_INTENTOS &&
            abierto(f) &&
            f.direction === "inbound" &&
            (!f.media_reclamado_at || new Date(f.media_reclamado_at).getTime() < antesDe),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limite)
        .map((f) => f.id);
    },
  };
  return { almacen, porId, subidas };
}

function responde(cuerpo: Uint8Array, init: ResponseInit = {}): typeof fetch {
  return (async () => new Response(cuerpo as unknown as BodyInit, init)) as typeof fetch;
}

describe("qué marca el receptor para bajar", () => {
  it("solo entrantes con archivo; share, template y ephemeral (tipo otro) y salientes no", () => {
    const adj = [{ type: "image" }];
    expect(seDescarga({ direction: "inbound", messageType: "imagen", attachments: adj })).toBe(true);
    for (const t of ["audio", "video", "documento", "sticker"]) {
      expect(seDescarga({ direction: "inbound", messageType: t, attachments: adj })).toBe(true);
    }
    expect(seDescarga({ direction: "inbound", messageType: "otro", attachments: [{ type: "share" }] })).toBe(false);
    expect(seDescarga({ direction: "outbound", messageType: "imagen", attachments: adj })).toBe(false);
    expect(seDescarga({ direction: "inbound", messageType: "imagen", attachments: null })).toBe(false);
  });

  it("el tamaño máximo es 25 MB por defecto y se configura con ADJUNTOS_TAMANO_MAXIMO_MB", () => {
    expect(tamanoMaximoEnBytes({})).toBe(25 * 1024 * 1024);
    expect(tamanoMaximoEnBytes({ ADJUNTOS_TAMANO_MAXIMO_MB: "10" })).toBe(10 * 1024 * 1024);
    expect(tamanoMaximoEnBytes({ ADJUNTOS_TAMANO_MAXIMO_MB: "nada" })).toBe(25 * 1024 * 1024);
  });

  it("el tiempo máximo de una descarga es menor que la espera del reintento", () => {
    expect(TIEMPO_MAXIMO_DE_DESCARGA_MS).toBeLessThan(ESPERA_DEL_REINTENTO_MS);
  });
});

describe("la descarga", () => {
  it("guarda en espacio/conversación/mensaje con el tipo de los bytes, no el del proveedor", async () => {
    const { almacen, porId, subidas } = almacenEnMemoria([fila({ attachments: [{ type: "video", url: "https://cdn.ejemplo.invalid/v.mp4" }] })]);
    const r = await descargarAdjunto("m1", { almacen, bajar: responde(PNG) });
    expect(r).toBe("descargado");
    expect(subidas).toEqual([{ ruta: "w1/c1/m1/archivo.png", mime: "image/png", bytes: PNG.byteLength }]);
    expect(porId.get("m1")).toMatchObject({
      media_status: "descargado",
      media_path: "w1/c1/m1/archivo.png",
      media_mime: "image/png",
      media_bytes: PNG.byteLength,
      media_intentos: 1,
    });
  });

  it("un tipo que no está en la lista queda no_disponible y no se sube", async () => {
    const { almacen, porId, subidas } = almacenEnMemoria([fila()]);
    expect(await descargarAdjunto("m1", { almacen, bajar: responde(HTML) })).toBe("no_disponible");
    expect(subidas).toHaveLength(0);
    expect(porId.get("m1")).toMatchObject({ media_status: "no_disponible", media_error: "tipo_no_permitido" });
  });

  it("pasado el tamaño máximo corta y queda no_disponible, aunque no declare Content-Length", async () => {
    const { almacen, porId, subidas } = almacenEnMemoria([fila()]);
    const grande = new Uint8Array(2048);
    grande.set(PNG);
    expect(await descargarAdjunto("m1", { almacen, bajar: responde(grande), tamanoMaximo: 1024 })).toBe("no_disponible");
    expect(subidas).toHaveLength(0);
    expect(porId.get("m1")!.media_error).toBe("excede_tamano");
  });

  it("si falla, el mensaje queda guardado y el adjunto fallido; en el intento del techo, no_disponible", async () => {
    const { almacen, porId } = almacenEnMemoria([fila()]);
    const falla = responde(new Uint8Array(0), { status: 403 });
    for (let i = 1; i < TECHO_DE_INTENTOS; i++) {
      expect(await descargarAdjunto("m1", { almacen, bajar: falla })).toBe("fallido");
      expect(porId.get("m1")).toMatchObject({ media_status: "fallido", media_error: "http_403", media_intentos: i });
    }
    expect(await descargarAdjunto("m1", { almacen, bajar: falla })).toBe("no_disponible");
    expect(porId.get("m1")!.media_intentos).toBe(TECHO_DE_INTENTOS);
    expect(await descargarAdjunto("m1", { almacen, bajar: falla })).toBe("omitido");
  });

  it("un histórico (intentos nulo) no se toca, aunque esté pendiente", async () => {
    const { almacen, porId, subidas } = almacenEnMemoria([fila({ media_intentos: null })]);
    expect(await descargarAdjunto("m1", { almacen, bajar: responde(PNG) })).toBe("omitido");
    expect(subidas).toHaveLength(0);
    expect(porId.get("m1")).toMatchObject({ media_status: "pendiente", media_intentos: null, media_reclamado_at: null });
  });
});

describe("la carrera entre dos intentos de la misma fila", () => {
  it("el que tomó primero y termina después no pisa al segundo; un descargado nunca pasa a fallido", async () => {
    const { almacen, porId } = almacenEnMemoria([fila()]);
    let soltarPrimero!: () => void;
    const primeroEspera = new Promise<void>((ok) => (soltarPrimero = ok));
    const lento: typeof fetch = (async () => {
      await primeroEspera;
      return new Response(new Uint8Array(0) as unknown as BodyInit, { status: 500 });
    }) as typeof fetch;

    const primero = descargarAdjunto("m1", { almacen, bajar: lento });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(porId.get("m1")!.media_intentos).toBe(1);

    // El reintento la toma (como si hubieran pasado los 2 minutos) y baja bien.
    expect(await descargarAdjunto("m1", { almacen, bajar: responde(PNG) })).toBe("descargado");
    expect(porId.get("m1")).toMatchObject({ media_status: "descargado", media_intentos: 2 });

    soltarPrimero();
    expect(await primero).toBe("pisado");
    expect(porId.get("m1")).toMatchObject({ media_status: "descargado", media_intentos: 2, media_error: null });
  });

  it("si el segundo falla primero, el primero tampoco escribe sobre él", async () => {
    const { almacen, porId } = almacenEnMemoria([fila()]);
    let soltar!: () => void;
    const espera = new Promise<void>((ok) => (soltar = ok));
    const lento: typeof fetch = (async () => {
      await espera;
      return new Response(PNG as unknown as BodyInit);
    }) as typeof fetch;
    const primero = descargarAdjunto("m1", { almacen, bajar: lento });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(await descargarAdjunto("m1", { almacen, bajar: responde(new Uint8Array(0), { status: 500 }) })).toBe("fallido");
    soltar();
    expect(await primero).toBe("pisado");
    expect(porId.get("m1")).toMatchObject({ media_status: "fallido", media_intentos: 2, media_error: "http_500" });
  });
});

describe("el reintento", () => {
  const AHORA = new Date("2026-10-09T20:00:00.000Z");
  const hace = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();

  it("no toca un histórico pendiente (intentos nulo)", async () => {
    const { almacen, porId, subidas } = almacenEnMemoria([fila({ id: "h1", media_intentos: null })]);
    const r = await reintentarAdjuntos({ almacen, bajar: responde(PNG), ahoraFijo: AHORA });
    expect(r.revisados).toBe(0);
    expect(subidas).toHaveLength(0);
    expect(porId.get("h1")).toMatchObject({ media_status: "pendiente", media_intentos: null });
  });

  it("toma lo que el receptor guardó y no llegó a bajar (el after() cortado por un redespliegue)", async () => {
    const { almacen, porId } = almacenEnMemoria([
      fila({ id: "nuevo", media_intentos: 0, media_reclamado_at: null }),
      fila({ id: "h1", media_intentos: null }),
    ]);
    const r = await reintentarAdjuntos({ almacen, bajar: responde(PNG), ahoraFijo: AHORA });
    expect(r).toMatchObject({ revisados: 1, descargados: 1 });
    expect(porId.get("nuevo")!.media_status).toBe("descargado");
    expect(porId.get("h1")!.media_status).toBe("pendiente");
  });

  it("espera 2 minutos desde el último reclamo, no desde la fecha del mensaje", async () => {
    const { almacen, porId } = almacenEnMemoria([
      // Mensaje viejo (fecha del proveedor de hace horas) que se está bajando ahora.
      fila({ id: "en_curso", media_intentos: 1, media_reclamado_at: hace(30_000), created_at: hace(5 * 3600_000) }),
      fila({ id: "colgado", media_intentos: 1, media_status: "fallido", media_reclamado_at: hace(ESPERA_DEL_REINTENTO_MS + 1000) }),
    ]);
    const r = await reintentarAdjuntos({ almacen, bajar: responde(PNG), ahoraFijo: AHORA });
    expect(r.revisados).toBe(1);
    expect(porId.get("en_curso")).toMatchObject({ media_status: "pendiente", media_intentos: 1 });
    expect(porId.get("colgado")!.media_status).toBe("descargado");
  });

  it("no toca salientes ni descargados ni no_disponible", async () => {
    const { almacen, subidas } = almacenEnMemoria([
      fila({ id: "s", direction: "outbound" }),
      fila({ id: "d", media_status: "descargado", media_intentos: 1 }),
      fila({ id: "n", media_status: "no_disponible", media_intentos: 5 }),
    ]);
    const r = await reintentarAdjuntos({ almacen, bajar: responde(PNG), ahoraFijo: AHORA });
    expect(r.revisados).toBe(0);
    expect(subidas).toHaveLength(0);
  });

  it("un error en un adjunto no corta a los demás", async () => {
    const { almacen, porId } = almacenEnMemoria([
      fila({ id: "a", created_at: "2026-10-09T01:00:00.000Z" }),
      fila({ id: "b", created_at: "2026-10-09T02:00:00.000Z" }),
    ]);
    const original = almacen.leer;
    almacen.leer = async (id) => {
      if (id === "a") throw new Error("se cayó la base");
      return original(id);
    };
    const r = await reintentarAdjuntos({ almacen, bajar: responde(PNG), ahoraFijo: AHORA });
    expect(r).toMatchObject({ revisados: 2, errores: 1, descargados: 1 });
    expect(porId.get("b")!.media_status).toBe("descargado");
  });
});

describe("almacenDeSupabase arma las condiciones de las escrituras", () => {
  function grabador(respuesta: unknown) {
    const llamadas: Array<[string, ...unknown[]]> = [];
    const cadena: any = new Proxy(
      {},
      {
        get(_t, metodo: string) {
          if (metodo === "then") return (ok: (r: unknown) => unknown) => Promise.resolve(respuesta).then(ok);
          return (...args: unknown[]) => (llamadas.push([metodo, ...args]), cadena);
        },
      },
    );
    const servicio = { from: (t: string) => (llamadas.push(["from", t]), cadena) };
    return { servicio, llamadas };
  }

  it("tomar: solo si los intentos siguen en el valor leído y el estado está abierto", async () => {
    const { almacenDeSupabase } = await import("./adjuntos");
    const { servicio, llamadas } = grabador({ data: [{ id: "m1" }], error: null });
    const ok = await almacenDeSupabase(servicio as never).tomar("m1", 2, new Date("2026-10-09T20:00:00.000Z"));
    expect(ok).toBe(true);
    expect(llamadas).toContainEqual(["update", { media_intentos: 3, media_reclamado_at: "2026-10-09T20:00:00.000Z" }]);
    expect(llamadas).toContainEqual(["eq", "media_intentos", 2]);
    expect(llamadas).toContainEqual(["in", "media_status", ["pendiente", "fallido"]]);
  });

  it("cerrar: solo si los intentos siguen en el tomado, así un descargado no se pisa", async () => {
    const { almacenDeSupabase } = await import("./adjuntos");
    const { servicio, llamadas } = grabador({ data: [], error: null });
    const ok = await almacenDeSupabase(servicio as never).cerrar("m1", 3, { media_status: "fallido", media_error: "http_500" });
    expect(ok).toBe(false);
    expect(llamadas).toContainEqual(["eq", "media_intentos", 3]);
    expect(llamadas).toContainEqual(["in", "media_status", ["pendiente", "fallido"]]);
  });

  it("porReintentar: intentos no nulos, entrantes, y la espera desde media_reclamado_at", async () => {
    const { almacenDeSupabase } = await import("./adjuntos");
    const { servicio, llamadas } = grabador({ data: [{ id: "x" }], error: null });
    const ids = await almacenDeSupabase(servicio as never).porReintentar(new Date("2026-10-09T20:00:00.000Z"), 20);
    expect(ids).toEqual(["x"]);
    expect(llamadas).toContainEqual(["not", "media_intentos", "is", null]);
    expect(llamadas).toContainEqual(["eq", "direction", "inbound"]);
    expect(llamadas).toContainEqual(["or", "media_reclamado_at.is.null,media_reclamado_at.lt.2026-10-09T19:58:00.000Z"]);
    expect(llamadas.some((l) => JSON.stringify(l).includes("created_at") && l[0] !== "order")).toBe(false);
  });
});
