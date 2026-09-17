import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";
import type { NextRequest } from "next/server";

/**
 * Tests del receptor de webhooks de Evolution (F22).
 *
 * LA REGLA QUE ORDENA ESTE ARCHIVO: toda comprobación negativa necesita su
 * control positivo al lado. Una batería de "esto se rechaza" no distingue entre
 * *se rechazó porque está bien protegido* y *se rechazó porque nada llegó a
 * ejecutarse*. Por eso el primer test de cada bloque es el afirmativo, y si ese
 * falla el veredicto del resto es "no concluyente", no verde.
 *
 * Cubren cuatro cosas distintas:
 *
 *   1. **La autenticación.** El token es un JWT HS256 que Evolution firma en
 *      cada entrega con el secreto compartido. Se verifica fijando el
 *      algoritmo, y eso tiene sus dos tests propios: `alg: none` y otro
 *      algoritmo.
 *
 *   2. **La rotación del secreto.** Durante la ventana valen el nuevo y el
 *      viejo. Importa porque un 401 cancela los reintentos de Evolution: una
 *      rotación mal hecha no da errores, pierde mensajes.
 *
 *   3. **Las alertas.** Que la condición se registre, que se agrupe en vez de
 *      multiplicarse, y que no guarde credenciales. Y que se cierren con los
 *      criterios correctos, que NO son el mismo para las dos: la de
 *      autenticación se cierra sola, la de instancia desconocida no. Ver el
 *      bloque de tests de alertas.
 *
 *   4. **El orden del acuse.** Que el 200 salga ANTES de que corra el
 *      procesamiento. Es la afirmación central de F22.
 *
 * `after()` se intercepta en vez de ejecutarse, igual que en el test de Zernio:
 * el handler responde primero y procesa después, así que los tests que miran el
 * procesamiento corren los pendientes a mano.
 */

const { pendientes, estado } = vi.hoisted(() => ({
  pendientes: [] as Array<() => unknown | Promise<unknown>>,
  estado: {
    canal: null as Record<string, unknown> | null,
    secretoActual: null as string | null,
    secretoAnterior: null as string | null,
    eventosReclamados: [] as string[],
    rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  },
}));

vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void pendientes.push(fn) };
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => crearSupabaseFalso(),
}));

vi.mock("@/lib/vault", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vault")>();
  return {
    ...real,
    getWorkspaceSecret: async (_c: unknown, _ws: string, nombre: string) => {
      if (nombre === real.SECRET_NAMES.evolutionWebhookSecret) return estado.secretoActual;
      if (nombre === real.SECRET_NAMES.evolutionWebhookSecretPrevious) return estado.secretoAnterior;
      return null;
    },
  };
});

const procesarEventoEvolution = vi.fn();
vi.mock("@/lib/evolution-processor", () => ({
  procesarEventoEvolution: (...args: unknown[]) => procesarEventoEvolution(...args),
}));

/**
 * Supabase de mentira. Solo enruta lo que el handler consulta: el canal por
 * nombre de instancia, el ledger de idempotencia, y las dos RPC de alertas, que
 * se guardan enteras para poder afirmar sobre sus argumentos.
 */
function crearSupabaseFalso() {
  const constructor = (tabla: string) => {
    const cadena = {
      select: () => cadena,
      eq: () => cadena,
      is: () => cadena,
      order: () => cadena,
      returns: () => cadena,
      maybeSingle: async () => ({ data: tabla === "channels" ? estado.canal : null, error: null }),
      single: async () => ({ data: tabla === "channels" ? estado.canal : null, error: null }),
      insert: async (fila: Record<string, unknown>) => {
        if (tabla === "webhook_events") {
          const id = String(fila.event_id);
          if (estado.eventosReclamados.includes(id)) return { error: { code: "23505" } };
          estado.eventosReclamados.push(id);
          return { error: null };
        }
        return { error: null };
      },
    };
    return cadena;
  };

  return {
    from: constructor,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ fn, args });
      return { data: null, error: null };
    },
  };
}

const { POST } = await import("./route");

const SECRETO = "secreto-de-evolution-0123456789abcdef";
const OTRO_SECRETO = "otro-secreto-completamente-distinto-xyz";
const INSTANCIA = "ssa-whatsapp";

// ── Armado de tokens ────────────────────────────────────────────────────────

/** Los claims que Evolution 2.3.7 pone en cada entrega, verificados en su código. */
function claims() {
  return { app: "evolution", action: "webhook" };
}

async function firmar(
  secreto = SECRETO,
  { alg = "HS256", expEnSegundos = 600 }: { alg?: string; expEnSegundos?: number } = {},
): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT(claims())
    .setProtectedHeader({ alg })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + expEnSegundos)
    .sign(new TextEncoder().encode(secreto));
}

/**
 * Token con `alg: none`, que `jose` no puede firmar porque no lo permite.
 * Se arma a mano: dos segmentos codificados y una firma vacía. Es exactamente
 * la forma del ataque, que consiste en declarar que no hay nada que verificar.
 */
function tokenAlgNone(): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const ahora = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "none", typ: "JWT" });
  const payload = b64({ ...claims(), iat: ahora, exp: ahora + 600 });
  return `${header}.${payload}.`;
}

// ── Armado de pedidos ───────────────────────────────────────────────────────

function cuerpo({
  instancia = INSTANCIA,
  evento = "messages.upsert",
  id = "3A7F2C9E1B4D8A6F0E2C",
  remoteJid = "5491122334455@s.whatsapp.net",
  fromMe = false,
}: {
  instancia?: string;
  evento?: string;
  id?: string;
  remoteJid?: string;
  fromMe?: boolean;
} = {}): string {
  return JSON.stringify({
    event: evento,
    instance: instancia,
    data: {
      key: { remoteJid, fromMe, id, participant: null },
      pushName: "Quien Escribe",
      message: { conversation: "hola" },
      messageType: "conversation",
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
    date_time: new Date().toISOString(),
    sender: "5491199887766@s.whatsapp.net",
    server_url: "https://evolution.ejemplo",
    // Evolution mete la API key de la instancia en CADA webhook. Está acá
    // porque viene de verdad, y hay un test que exige que nunca llegue a una
    // alerta ni a un log.
    apikey: "APIKEY-DE-LA-INSTANCIA-NO-DEBE-FILTRARSE",
  });
}

function pedido(body: string, token?: string | null): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/webhooks/evolution", {
    method: "POST",
    body,
    headers,
  }) as unknown as NextRequest;
}

async function correrPendientes() {
  const cola = pendientes.splice(0, pendientes.length);
  for (const fn of cola) await fn();
}

const alertasRegistradas = () => estado.rpcs.filter((r) => r.fn === "record_webhook_alert");
const alertasCerradas = () => estado.rpcs.filter((r) => r.fn === "resolve_webhook_alert");

beforeEach(() => {
  pendientes.length = 0;
  procesarEventoEvolution.mockClear();
  estado.canal = {
    id: "ch-evo-1",
    workspace_id: "ws-1",
    platform: "whatsapp",
    provider: "evolution",
    instance_name: INSTANCIA,
  };
  estado.secretoActual = SECRETO;
  estado.secretoAnterior = null;
  estado.eventosReclamados = [];
  estado.rpcs = [];
});

// ── 1. Autenticación ────────────────────────────────────────────────────────

describe("autenticación del token", () => {
  // EL CONTROL POSITIVO. Si este falla, los seis rechazos de abajo no prueban
  // nada: podrían estar rechazando porque el handler nunca llega a verificar.
  it("acepta un token válido y responde 200", async () => {
    const res = await POST(pedido(cuerpo(), await firmar()));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, queued: true });
    expect(alertasRegistradas()).toHaveLength(0);
  });

  it("rechaza con 401 cuando no viene el header Authorization", async () => {
    const res = await POST(pedido(cuerpo(), null));
    expect(res.status).toBe(401);
  });

  it("rechaza con 401 un token firmado con otro secreto", async () => {
    const res = await POST(pedido(cuerpo(), await firmar(OTRO_SECRETO)));
    expect(res.status).toBe(401);
  });

  /**
   * ESTE TEST NO PRUEBA NUESTRA FIJACIÓN DEL ALGORITMO, y conviene decirlo para
   * que nadie se apoye en él creyendo que sí.
   *
   * Comprobado sacando `algorithms: ['HS256']` del verificador y volviendo a
   * correr: este test sigue en verde. `jose` no soporta JWT sin firma en
   * ningún caso, así que el rechazo viene de la librería, no de nuestra
   * configuración.
   *
   * Se conserva igual, porque lo que fija es el comportamiento del endpoint
   * ante la forma del ataque, y ese comportamiento tiene que seguir siendo el
   * mismo el día que se cambie de librería. El que guarda nuestra fijación es
   * el test de abajo.
   */
  it("rechaza con 401 un token con alg: none", async () => {
    const res = await POST(pedido(cuerpo(), tokenAlgNone()));
    expect(res.status).toBe(401);
  });

  /**
   * ESTE ES EL QUE GUARDA LA FIJACIÓN DEL ALGORITMO. Comprobado por mutación:
   * sacando `algorithms: ['HS256']` del verificador, este test —y solo este—
   * pasa a fallar.
   *
   * El token está firmado con el secreto correcto, así que sin la lista
   * explícita `jose` lo acepta: usa el algoritmo que el propio token declara en
   * su header. Ahí es donde vive la confusión de algoritmo.
   */
  it("rechaza con 401 un token firmado con otro algoritmo", async () => {
    const res = await POST(pedido(cuerpo(), await firmar(SECRETO, { alg: "HS512" })));
    expect(res.status).toBe(401);
  });

  it("rechaza con 401 un token vencido", async () => {
    const res = await POST(pedido(cuerpo(), await firmar(SECRETO, { expEnSegundos: -3600 })));
    expect(res.status).toBe(401);
  });

  it("rechaza con 401 un token con segmentos mal formados, sin reventar", async () => {
    const res = await POST(pedido(cuerpo(), "esto.no.es-un-jwt"));
    expect(res.status).toBe(401);
  });

  it("rechaza con 401 cuando no hay ningún secreto configurado en Vault", async () => {
    estado.secretoActual = null;
    const res = await POST(pedido(cuerpo(), await firmar()));
    expect(res.status).toBe(401);
  });

  it("nunca procesa nada cuando rechaza", async () => {
    await POST(pedido(cuerpo(), null));
    expect(pendientes).toHaveLength(0);
    await correrPendientes();
    expect(procesarEventoEvolution).not.toHaveBeenCalled();
  });
});

// ── 2. Rotación del secreto ─────────────────────────────────────────────────

describe("rotación del secreto", () => {
  it("acepta el secreto anterior durante la ventana de rotación", async () => {
    estado.secretoActual = OTRO_SECRETO; // el nuevo, que Evolution todavía no tomó
    estado.secretoAnterior = SECRETO;

    const res = await POST(pedido(cuerpo(), await firmar(SECRETO)));

    // Sin esto, cada mensaje firmado con el viejo daría 401, y un 401 cancela
    // los reintentos de Evolution: no se recuperan.
    expect(res.status).toBe(200);
  });

  it("sigue aceptando el secreto nuevo durante la ventana", async () => {
    estado.secretoActual = OTRO_SECRETO;
    estado.secretoAnterior = SECRETO;

    const res = await POST(pedido(cuerpo(), await firmar(OTRO_SECRETO)));
    expect(res.status).toBe(200);
  });

  it("rechaza un secreto que no es ni el nuevo ni el anterior", async () => {
    estado.secretoActual = OTRO_SECRETO;
    estado.secretoAnterior = SECRETO;

    const res = await POST(pedido(cuerpo(), await firmar("un-tercer-secreto-cualquiera")));
    expect(res.status).toBe(401);
  });
});

// ── 3. Idempotencia ─────────────────────────────────────────────────────────

describe("idempotencia", () => {
  it("no vuelve a procesar el mismo mensaje", async () => {
    const body = cuerpo({ id: "MSG-REPETIDO" });

    const primera = await POST(pedido(body, await firmar()));
    await expect(primera.json()).resolves.toEqual({ ok: true, queued: true });

    const reintento = await POST(pedido(body, await firmar()));
    await expect(reintento.json()).resolves.toMatchObject({
      skipped: true,
      reason: "duplicate_event",
    });

    expect(pendientes).toHaveLength(1);
    await correrPendientes();
    expect(procesarEventoEvolution).toHaveBeenCalledTimes(1);
  });

  // El id lo genera el teléfono que envía, así que es único por conversación y
  // no globalmente. Si la clave fuera `key.id` pelado, este segundo mensaje se
  // descartaría como duplicado siendo de otra persona.
  it("el mismo id en otra conversación no es un duplicado", async () => {
    const id = "ID-QUE-SE-REPITE";
    await POST(pedido(cuerpo({ id, remoteJid: "111@s.whatsapp.net" }), await firmar()));
    const segunda = await POST(
      pedido(cuerpo({ id, remoteJid: "222@s.whatsapp.net" }), await firmar()),
    );

    await expect(segunda.json()).resolves.toEqual({ ok: true, queued: true });
  });

  it("la clave lleva el prefijo del proveedor, para no pisar el ledger de Zernio", async () => {
    await POST(pedido(cuerpo({ id: "ABC" }), await firmar()));
    expect(estado.eventosReclamados).toEqual([
      "evolution:ssa-whatsapp:5491122334455@s.whatsapp.net:ABC:0",
    ]);
  });

  it("un lote de historial reclama una clave por mensaje", async () => {
    const body = JSON.stringify({
      event: "messages.set",
      instance: INSTANCIA,
      data: [
        { key: { remoteJid: "111@s.whatsapp.net", id: "A", fromMe: false }, messageType: "conversation" },
        { key: { remoteJid: "111@s.whatsapp.net", id: "B", fromMe: false }, messageType: "conversation" },
      ],
    });

    const res = await POST(pedido(body, await firmar()));

    expect(res.status).toBe(200);
    expect(estado.eventosReclamados).toHaveLength(2);
  });
});

// ── 4. Alertas ──────────────────────────────────────────────────────────────

describe("alertas", () => {
  // Control positivo: sin rechazo no hay condición abierta. Sin esto, un
  // registrador que disparara siempre pasaría los tests de abajo.
  it("un evento válido no registra ninguna alerta", async () => {
    await POST(pedido(cuerpo(), await firmar()));
    expect(alertasRegistradas()).toHaveLength(0);
  });

  it("un 401 registra la condición de autenticación", async () => {
    await POST(pedido(cuerpo(), await firmar(OTRO_SECRETO)));

    const alertas = alertasRegistradas();
    expect(alertas).toHaveLength(1);
    expect(alertas[0].args).toMatchObject({
      p_source: "evolution",
      p_condition: "webhook_auth_failed",
      p_workspace_id: "ws-1",
      p_channel_id: "ch-evo-1",
    });
  });

  it("un evento válido cierra la condición de autenticación", async () => {
    await POST(pedido(cuerpo(), await firmar()));

    const cerradas = alertasCerradas();
    expect(cerradas.some((c) => c.args.p_condition === "webhook_auth_failed")).toBe(true);
  });

  it("una instancia desconocida responde 503 y registra su propia condición", async () => {
    estado.canal = null;

    const res = await POST(pedido(cuerpo({ instancia: "instancia-que-no-existe" })));

    // 503 Y NO 404, y la diferencia son los mensajes de una ventana de ~20
    // minutos. 404 está en la lista de códigos que cancelan los reintentos
    // ([400, 401, 403, 404, 422]); 503 no, así que Evolution reintenta y
    // corregir `instance_name` dentro de esa ventana recupera todo.
    expect(res.status).toBe(503);
    const alertas = alertasRegistradas();
    expect(alertas).toHaveLength(1);
    expect(alertas[0].args).toMatchObject({
      p_condition: "webhook_unknown_instance",
      p_workspace_id: null,
      p_detail: "instancia-que-no-existe",
    });
  });

  // LA PROTECCIÓN CONTRA EL DESBORDE. El nombre de la instancia lo controla
  // quien llama, así que si entrara en la clave de agrupación cualquiera
  // llenaría la tabla mandando nombres al azar. Las tres van a la MISMA
  // condición, con el nombre solo en el detalle.
  it("tres instancias desconocidas distintas van a una sola condición", async () => {
    estado.canal = null;

    for (const nombre of ["fantasma-a", "fantasma-b", "fantasma-c"]) {
      await POST(pedido(cuerpo({ instancia: nombre })));
    }

    const alertas = alertasRegistradas();
    expect(alertas).toHaveLength(3);

    // La clave de agrupación es idéntica en las tres: mismo source, misma
    // condición, mismo workspace nulo. Es lo que hace que el índice único de la
    // 00022 las colapse en una fila con contador en 3.
    const claves = alertas.map((a) => `${a.args.p_source}|${a.args.p_condition}|${a.args.p_workspace_id}`);
    expect(new Set(claves).size).toBe(1);

    // Y lo único que varía es el detalle.
    expect(alertas.map((a) => a.args.p_detail)).toEqual([
      "fantasma-a",
      "fantasma-b",
      "fantasma-c",
    ]);
  });

  /**
   * LA AFIRMACIÓN INVERTIDA, Y ESTÁ ESCRITA ASÍ A PROPÓSITO.
   *
   * La versión anterior de este test afirmaba lo contrario: que un evento
   * válido de esa instancia cerraba la condición. Ese cierre automático se
   * eliminó en la 00023, porque se contradecía con la decisión de agrupación.
   *
   * La condición junta TODAS las instancias desconocidas en una fila, y el
   * `detail` guarda el nombre de la ÚLTIMA, no el de la que causó el problema.
   * Con tres nombres desconocidos, arreglar el `instance_name` que rompía de
   * verdad no cerraba nada; y peor, cualquier nombre basura posterior pisaba el
   * `detail` y desactivaba el cierre para siempre. Como ese nombre lo elige
   * quien llama al webhook, desactivar el cierre quedaba al alcance de
   * cualquiera que conociera la URL.
   *
   * El test va en esta dirección para SOSTENER la decisión en vez de empujar
   * contra ella: si quedara afirmando el cierre automático, quien tocara este
   * código se encontraría con un test rojo cuya salida fácil es volver a
   * ponerlo, reintroduciendo justo el problema que lo motivó.
   */
  it("un evento válido NO cierra la condición de instancia desconocida", async () => {
    await POST(pedido(cuerpo(), await firmar()));

    const cierres = alertasCerradas();
    expect(cierres.some((c) => c.args.p_condition === "webhook_unknown_instance")).toBe(false);
  });

  it("y sí cierra la de autenticación, que es la que está atada a un workspace", async () => {
    // El control positivo del anterior: sin esto, un receptor que no cerrara
    // NINGUNA alerta pasaría el test de arriba.
    await POST(pedido(cuerpo(), await firmar()));

    const cierres = alertasCerradas();
    expect(cierres).toHaveLength(1);
    expect(cierres[0].args).toMatchObject({
      p_condition: "webhook_auth_failed",
      p_workspace_id: "ws-1",
    });
  });

  it("ninguna alerta guarda el cuerpo del aviso ni credenciales", async () => {
    estado.canal = null;
    await POST(pedido(cuerpo({ instancia: "fantasma" })));
    estado.canal = {
      id: "ch-evo-1",
      workspace_id: "ws-1",
      platform: "whatsapp",
      provider: "evolution",
      instance_name: INSTANCIA,
    };
    await POST(pedido(cuerpo(), await firmar(OTRO_SECRETO)));

    const serializado = JSON.stringify(alertasRegistradas());
    expect(serializado).not.toContain("APIKEY-DE-LA-INSTANCIA-NO-DEBE-FILTRARSE");
    expect(serializado).not.toContain("5491122334455");
    expect(serializado).not.toContain(SECRETO);
    expect(serializado).not.toContain("conversation");
  });
});

// ── 5. El orden del acuse ───────────────────────────────────────────────────

describe("el acuse sale antes del procesamiento", () => {
  /**
   * LA AFIRMACIÓN CENTRAL DE F22, y hasta acá no había nada que la demostrara.
   *
   * El bucle de reintentos de Evolution bloquea mientras espera la respuesta,
   * con un timeout de 30 segundos por defecto. Si el procesamiento corriera
   * antes del 200 —resolver contactos, bajar adjuntos, ejecutar flujos—, una
   * demora convertiría entregas buenas en timeouts, y los reintentos que
   * siguen multiplicarían el trabajo que ya estaba tardando.
   */
  it("responde 200 con el procesamiento todavía sin correr", async () => {
    const res = await POST(pedido(cuerpo(), await firmar()));

    // La respuesta ya está...
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, queued: true });

    // ...y el procesamiento no arrancó: quedó encolado en after().
    expect(procesarEventoEvolution).not.toHaveBeenCalled();
    expect(pendientes).toHaveLength(1);

    // Recién cuando corre la cola, se procesa.
    await correrPendientes();
    expect(procesarEventoEvolution).toHaveBeenCalledTimes(1);
  });

  it("le pasa al procesamiento el canal y los mensajes ya verificados", async () => {
    await POST(pedido(cuerpo(), await firmar()));
    await correrPendientes();

    const [arg] = procesarEventoEvolution.mock.calls[0] as [Record<string, unknown>];
    expect(arg).toMatchObject({ evento: "messages.upsert", instancia: INSTANCIA });
    expect((arg.canal as Record<string, unknown>).id).toBe("ch-evo-1");
    expect(arg.mensajes).toHaveLength(1);
  });
});

// ── 6. Cuerpo inválido ──────────────────────────────────────────────────────

describe("cuerpo inválido", () => {
  it("responde 400 ante un cuerpo que no es JSON", async () => {
    const res = await POST(pedido("esto no es json", await firmar()));
    expect(res.status).toBe(400);
  });

  it("responde 400 cuando el aviso no dice de qué instancia viene", async () => {
    const res = await POST(pedido(JSON.stringify({ event: "messages.upsert" }), await firmar()));
    expect(res.status).toBe(400);
  });
});
