import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F23: la función única de correo, sus reintentos, el techo y el aviso de las
 * alertas. Resend y la base simulados: **ningún correo real sale de acá**. Los
 * correos reales los manda `scripts/verify-correo-alertas.mjs`, a un solo
 * destinatario y con su confirmación.
 *
 * Cada negativa lleva su control positivo en el mismo bloque: "no se mandó"
 * solo significa algo si, en las mismas condiciones salvo una, sí se manda.
 */

type FilaCorreo = Record<string, unknown> & { id: string };

const h = vi.hoisted(() => ({
  correos: [] as Array<Record<string, unknown> & { id: string }>,
  integraciones: [] as Array<Record<string, unknown>>,
  alertas: [] as Array<Record<string, unknown>>,
  miembros: [] as Array<{ workspace_id: string; user_id: string; role: string }>,
  usuarios: {} as Record<string, string>,
  clave: "re_clave_de_prueba_123456789" as string | null,
  rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  siguienteId: 0,
}));

vi.mock("@/lib/vault", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vault")>();
  return { ...real, getWorkspaceSecret: async () => h.clave };
});

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => servicioFalso() }));

/** Lo mínimo de PostgREST que usa el módulo, sobre arreglos en memoria. */
function servicioFalso() {
  const tablas: Record<string, Array<Record<string, unknown>>> = {
    email_log: h.correos,
    integration_configs: h.integraciones,
    webhook_alerts: h.alertas,
    workspace_members: h.miembros,
  };
  return {
    from(tabla: string) {
      const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
      let cambios: Record<string, unknown> | null = null;
      let insertada: Record<string, unknown> | null = null;
      const filas = () => (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
      const cadena = {
        select: () => cadena,
        eq: (c: string, v: unknown) => {
          filtros.push((f) => f[c] === v);
          if (cambios) for (const f of filas()) Object.assign(f, cambios);
          return cadena;
        },
        in: (c: string, vs: unknown[]) => {
          filtros.push((f) => vs.includes(f[c]));
          return cadena;
        },
        insert: (fila: Record<string, unknown>) => {
          insertada = { id: `correo-${++h.siguienteId}`, intentos: 0, ...fila };
          tablas[tabla].push(insertada);
          return cadena;
        },
        update: (c: Record<string, unknown>) => {
          cambios = c;
          return cadena;
        },
        single: async () => ({ data: insertada ?? filas()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
        then: (ok: (r: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: filas(), error: null }).then(ok),
      };
      return cadena;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      if (fn !== "reservar_correo_aviso") return { data: null, error: null };
      // La misma regla que la función de la 00027.
      const yaSalio = h.correos.some(
        (c) =>
          c.workspace_id === args.p_workspace_id &&
          c.tipo === args.p_tipo &&
          c.clave_techo === args.p_clave &&
          ["pendiente", "enviado", "fallido"].includes(String(c.estado))
      );
      const id = `correo-${++h.siguienteId}`;
      h.correos.push({
        id,
        workspace_id: args.p_workspace_id,
        tipo: args.p_tipo,
        clave_techo: args.p_clave,
        alerta_id: args.p_alerta_id,
        para: args.p_para,
        para_etiqueta: args.p_para_etiqueta,
        asunto: args.p_asunto,
        estado: yaSalio ? "omitido_techo" : "pendiente",
        intentos: 0,
      });
      return { data: [{ id, reservado: !yaSalio }], error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: h.usuarios[id] ? { email: h.usuarios[id] } : null } }),
      },
    },
  };
}

const { enviarCorreo, notificarAlerta, esDireccionDePrueba, ESPERAS_REINTENTO_MS } = await import("./correo");
const { validarRemitente, dominioDeRemitente } = await import("./integraciones");

// ── Resend simulado ─────────────────────────────────────────────────────────

type Respuesta = { status: number; cuerpo?: unknown } | "red";
let respuestas: Respuesta[] = [];
const llamadas: Array<{ url: string; headers: Record<string, string>; cuerpo: Record<string, unknown> }> = [];

function respuestaResend(): Response {
  const r = respuestas.length > 1 ? respuestas.shift()! : respuestas[0];
  if (r === "red") throw new TypeError("fetch failed");
  return new Response(JSON.stringify(r.cuerpo ?? {}), { status: r.status });
}

const OK = { status: 200, cuerpo: { id: "resend-abc" } };
const esperas: number[] = [];
const sinEsperar = async (ms: number) => void esperas.push(ms);

const base = {
  workspaceId: "ws-1",
  tipo: "invitacion" as const,
  para: ["alguien@correo.com"],
  paraEtiqueta: "alguien@correo.com",
  asunto: "Te invitaron",
  texto: "hola",
  html: "<p>hola</p>",
};

const fila = (id: string | null) => h.correos.find((c) => c.id === id) as FilaCorreo;

beforeEach(() => {
  h.correos.length = 0;
  h.integraciones.length = 0;
  h.integraciones.push({
    workspace_id: "ws-1",
    proveedor: "resend",
    estado: "conectado",
    config: { remitente: "ALO Mercadeo <avisos@notificaciones.alomercadeo.com>" },
  });
  h.alertas.length = 0;
  h.miembros.length = 0;
  h.usuarios = {};
  h.clave = "re_clave_de_prueba_123456789";
  h.rpcs.length = 0;
  respuestas = [OK];
  llamadas.length = 0;
  esperas.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    llamadas.push({
      url,
      headers: init.headers as Record<string, string>,
      cuerpo: JSON.parse(String(init.body)),
    });
    return respuestaResend();
  });
});

afterEach(() => vi.unstubAllGlobals());

// ── enviarCorreo ────────────────────────────────────────────────────────────

describe("enviarCorreo", () => {
  it("manda en el primer intento y lo deja registrado (control positivo)", async () => {
    const r = await enviarCorreo(base, { esperar: sinEsperar });

    expect(r.estado).toBe("enviado");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://api.resend.com/emails");
    expect(llamadas[0].headers.Authorization).toBe("Bearer re_clave_de_prueba_123456789");
    expect(llamadas[0].headers["Idempotency-Key"]).toBe(`correo-${r.id}`);
    expect(llamadas[0].cuerpo).toMatchObject({
      from: "ALO Mercadeo <avisos@notificaciones.alomercadeo.com>",
      to: ["alguien@correo.com"],
      subject: "Te invitaron",
    });
    expect(fila(r.id)).toMatchObject({ estado: "enviado", intentos: 1, resend_id: "resend-abc", ultimo_error: null });
  });

  it("reintenta un 429 por velocidad y sale en el segundo intento", async () => {
    respuestas = [{ status: 429, cuerpo: { name: "rate_limit_exceeded", message: "Too many requests." } }, OK];
    const r = await enviarCorreo(base, { esperar: sinEsperar });

    expect(r.estado).toBe("enviado");
    expect(fila(r.id)).toMatchObject({ estado: "enviado", intentos: 2 });
    expect(esperas).toEqual([ESPERAS_REINTENTO_MS[0]]);
  });

  it("reintenta hasta 3 veces, siempre con la misma clave de idempotencia, y queda fallido", async () => {
    respuestas = [{ status: 503, cuerpo: { name: "service_unavailable", message: "API is temporarily unavailable" } }];
    const r = await enviarCorreo(base, { esperar: sinEsperar });

    expect(r.estado).toBe("fallido");
    expect(llamadas).toHaveLength(4); // el primero y tres reintentos
    expect(new Set(llamadas.map((l) => l.headers["Idempotency-Key"]))).toEqual(new Set([`correo-${r.id}`]));
    expect(esperas).toEqual(ESPERAS_REINTENTO_MS);
    expect(fila(r.id)).toMatchObject({ estado: "fallido", intentos: 4 });
    expect(String(fila(r.id).ultimo_error)).toContain("HTTP 503");
  });

  it("una red caída se reintenta", async () => {
    respuestas = ["red", OK];
    const r = await enviarCorreo(base, { esperar: sinEsperar });
    expect(r.estado).toBe("enviado");
    expect(llamadas).toHaveLength(2);
  });

  it("un error que no es pasajero no se reintenta", async () => {
    respuestas = [{ status: 403, cuerpo: { name: "validation_error", message: "The domain is not verified." } }];
    const r = await enviarCorreo(base, { esperar: sinEsperar });

    expect(r.estado).toBe("fallido");
    expect(llamadas).toHaveLength(1);
    expect(fila(r.id).ultimo_error).toBe("Resend respondió HTTP 403 (validation_error): The domain is not verified.");
  });

  it("una cuota diaria agotada no se reintenta: no se resuelve en segundos", async () => {
    respuestas = [{ status: 429, cuerpo: { name: "daily_quota_exceeded" } }];
    await enviarCorreo(base, { esperar: sinEsperar });
    expect(llamadas).toHaveLength(1);
  });

  it("los reintentos pueden ir en segundo plano: el primero corre ya", async () => {
    respuestas = [{ status: 500, cuerpo: { name: "application_error" } }, OK];
    const enCola: Array<() => Promise<void>> = [];
    const r = await enviarCorreo(base, { esperar: sinEsperar, reintentarEnSegundoPlano: (fn) => void enCola.push(fn) });

    expect(r.estado).toBe("pendiente");
    expect(llamadas).toHaveLength(1);
    expect(enCola).toHaveLength(1);
    await enCola[0]();
    expect(fila(r.id)).toMatchObject({ estado: "enviado", intentos: 2 });
  });

  it("no manda a direcciones de prueba, y sí a las reales del mismo correo", async () => {
    const soloPrueba = await enviarCorreo({ ...base, para: ["ic-owner@ssa-test.local"] }, { esperar: sinEsperar });
    expect(soloPrueba.estado).toBe("omitido_prueba");
    expect(llamadas).toHaveLength(0);

    const mezcla = await enviarCorreo({ ...base, para: ["ic-owner@ssa-test.local", "Real@Correo.com"] }, { esperar: sinEsperar });
    expect(mezcla.estado).toBe("enviado");
    expect(llamadas[0].cuerpo.to).toEqual(["real@correo.com"]);
  });

  it("sin clave no intenta, y lo dice", async () => {
    h.clave = null;
    const r = await enviarCorreo(base, { esperar: sinEsperar });
    expect(r.estado).toBe("fallido");
    expect(llamadas).toHaveLength(0);
    expect(fila(r.id).ultimo_error).toBe("Resend no está configurado: falta la clave en Integraciones.");
  });

  it("sin remitente no intenta, y lo dice", async () => {
    h.integraciones[0].config = {};
    const r = await enviarCorreo(base, { esperar: sinEsperar });
    expect(r.estado).toBe("fallido");
    expect(llamadas).toHaveLength(0);
    expect(fila(r.id).ultimo_error).toBe("Falta el remitente de Resend en Integraciones.");
  });

  it("una clave inválida al mandar deja la tarjeta de Resend en desconectado", async () => {
    respuestas = [{ status: 400, cuerpo: { name: "validation_error", message: "API key is invalid" } }];
    await enviarCorreo(base, { esperar: sinEsperar });
    expect(h.integraciones[0].estado).toBe("desconectado");
  });

  it("un remitente sin verificar NO toca la tarjeta: es del correo, no de la integración", async () => {
    respuestas = [{ status: 403, cuerpo: { name: "validation_error", message: "The domain is not verified." } }];
    await enviarCorreo(base, { esperar: sinEsperar });
    expect(h.integraciones[0].estado).toBe("conectado");
  });

  it("la clave no aparece en ninguna fila, en ningún camino", async () => {
    for (const r of [
      [OK],
      [{ status: 400, cuerpo: { name: "validation_error", message: "API key is invalid" } }],
      [{ status: 503, cuerpo: {} }],
      ["red" as const],
    ] as Respuesta[][]) {
      respuestas = r;
      await enviarCorreo(base, { esperar: sinEsperar });
    }
    expect(JSON.stringify(h.correos)).not.toContain("re_clave_de_prueba");
    expect(JSON.stringify(h.integraciones)).not.toContain("re_clave_de_prueba");
  });
});

// ── notificarAlerta ─────────────────────────────────────────────────────────

describe("notificarAlerta", () => {
  beforeEach(() => {
    h.miembros.push(
      { workspace_id: "ws-1", user_id: "u-owner", role: "owner" },
      { workspace_id: "ws-1", user_id: "u-admin", role: "admin" },
      { workspace_id: "ws-1", user_id: "u-member", role: "member" }
    );
    h.usuarios = { "u-owner": "owner@correo.com", "u-admin": "admin@correo.com", "u-member": "member@correo.com" };
    h.alertas.push({
      id: "al-1",
      workspace_id: "ws-1",
      source: "evolution",
      alert_condition: "webhook_auth_failed",
      occurrences: 1,
      resolved_at: null,
    });
  });

  it("manda a Owner y Admin, no al Member (control positivo)", async () => {
    const r = await notificarAlerta("al-1", { esperar: sinEsperar });

    expect(r?.estado).toBe("enviado");
    expect(llamadas).toHaveLength(1);
    expect([...(llamadas[0].cuerpo.to as string[])].sort()).toEqual(["admin@correo.com", "owner@correo.com"]);
    expect(llamadas[0].cuerpo.subject).toBe("WhatsApp está rechazando mensajes entrantes");
    expect(fila(r!.id)).toMatchObject({ tipo: "alerta_webhook", alerta_id: "al-1", para_etiqueta: "Owner y Admin" });
  });

  it("el segundo aviso de la hora queda omitido por el techo, con el primero enviado", async () => {
    const primero = await notificarAlerta("al-1", { esperar: sinEsperar });
    expect(primero?.estado).toBe("enviado");

    h.alertas[0].occurrences = 2;
    const segundo = await notificarAlerta("al-1", { esperar: sinEsperar });

    expect(segundo?.estado).toBe("omitido_techo");
    expect(llamadas).toHaveLength(1);
    expect(h.correos.map((c) => c.estado)).toEqual(["enviado", "omitido_techo"]);
  });

  it("el techo es por tipo: otra condición del mismo workspace sí sale", async () => {
    await notificarAlerta("al-1", { esperar: sinEsperar });
    h.alertas.push({ id: "al-2", workspace_id: "ws-1", source: "zernio", alert_condition: "zernio_sync_cero_cuentas", occurrences: 1, resolved_at: null });
    const otra = await notificarAlerta("al-2", { esperar: sinEsperar });
    expect(otra?.estado).toBe("enviado");
    expect(llamadas).toHaveLength(2);
  });

  it("el silencio de un canal (F39) tiene su propio asunto y nombra los canales del detalle", async () => {
    h.alertas.push({ id: "al-sil", workspace_id: "ws-1", source: "vigilancia", alert_condition: "canal_silencioso", detail: "Instagram @cuenta: 9 de 8 horas hábiles", occurrences: 1, resolved_at: null });
    const r = await notificarAlerta("al-sil", { esperar: sinEsperar });
    expect(r?.estado).toBe("enviado");
    const cuerpo = llamadas[0].cuerpo;
    expect(cuerpo.subject).toBe("Un canal pasó su límite de horas sin recibir mensajes");
    expect(String(cuerpo.html)).toContain("Instagram @cuenta: 9 de 8 horas hábiles");
  });

  it("la suscripción incompleta (F39) tiene su propio asunto y nombra el evento que falta", async () => {
    h.alertas.push({ id: "al-sus", workspace_id: "ws-1", source: "zernio", alert_condition: "suscripcion_incompleta", detail: "Falta: message.sent", occurrences: 1, resolved_at: null });
    const r = await notificarAlerta("al-sus", { esperar: sinEsperar });
    expect(r?.estado).toBe("enviado");
    expect(llamadas[0].cuerpo.subject).toBe("A la suscripción de avisos de Instagram le falta un evento");
    expect(String(llamadas[0].cuerpo.html)).toContain("Falta: message.sent");
  });

  it("una alerta sin workspace no manda correo ni reserva nada", async () => {
    h.alertas.push({ id: "al-sis", workspace_id: null, source: "evolution", alert_condition: "webhook_unknown_instance", occurrences: 1, resolved_at: null });
    const r = await notificarAlerta("al-sis", { esperar: sinEsperar });

    expect(r).toBeNull();
    expect(llamadas).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
    expect(h.correos).toHaveLength(0);
  });

  it("una alerta ya cerrada no manda correo", async () => {
    h.alertas[0].resolved_at = new Date().toISOString();
    expect(await notificarAlerta("al-1", { esperar: sinEsperar })).toBeNull();
    expect(llamadas).toHaveLength(0);
  });

  it("un workspace de verificador, con correos de prueba, queda omitido y no consume el techo", async () => {
    h.usuarios = { "u-owner": "ic-owner@ssa-test.local", "u-admin": "ic-admin@ssa-test.local" };
    const r = await notificarAlerta("al-1", { esperar: sinEsperar });

    expect(r?.estado).toBe("omitido_prueba");
    expect(llamadas).toHaveLength(0);
    expect(h.rpcs).toHaveLength(0);
  });
});

// ── Lo puro ─────────────────────────────────────────────────────────────────

describe("direcciones y remitente", () => {
  it("reconoce los dominios reservados para pruebas, y no los reales", () => {
    for (const d of ["a@ssa-test.local", "a@x.test", "a@x.invalid", "a@example.com", "a@foo.example"]) {
      expect(esDireccionDePrueba(d), d).toBe(true);
    }
    for (const d of ["alomercadeo@gmail.com", "a@notificaciones.alomercadeo.com", "a@examples.com"]) {
      expect(esDireccionDePrueba(d), d).toBe(false);
    }
  });

  it("valida el remitente con nombre o sin nombre", () => {
    expect(validarRemitente("ALO Mercadeo <avisos@notificaciones.alomercadeo.com>")).toBeNull();
    expect(validarRemitente("avisos@notificaciones.alomercadeo.com")).toBeNull();
    expect(validarRemitente("")).toBe("Falta el remitente.");
    expect(validarRemitente("ALO Mercadeo")).not.toBeNull();
    expect(validarRemitente("<avisos@x>")).not.toBeNull();
  });

  it("saca el dominio del remitente para mostrarlo", () => {
    expect(dominioDeRemitente("ALO Mercadeo <avisos@notificaciones.alomercadeo.com>")).toBe("notificaciones.alomercadeo.com");
    expect(dominioDeRemitente("avisos@notificaciones.alomercadeo.com")).toBe("notificaciones.alomercadeo.com");
    expect(dominioDeRemitente(null)).toBeNull();
  });
});
