#!/usr/bin/env node
/**
 * ¿El identificador de mensaje del webhook es el mismo que el del listado?
 *
 * ── LA PREGUNTA, Y POR QUÉ ES CARA ──────────────────────────────────────────
 *
 * F27 va a guardar los mensajes entrantes en `messages` con
 * `platform_message_id` como clave única, y esa restricción es lo único que
 * impide duplicados. Pero los mensajes entran por dos caminos: el webhook, que
 * empuja cada mensaje nuevo, y la importación inicial, que lee el historial del
 * endpoint de listado. Si el proveedor le pone identificadores distintos al
 * mismo mensaje en cada camino, la restricción única nunca se dispara y la
 * importación duplica el historial entero **sin un solo error a la vista**.
 *
 * La pregunta no es de dos vías, es de tres. El webhook trae DOS
 * identificadores y el listado trae UNO:
 *
 *   webhook  message.id                → "Internal message ID"
 *   webhook  message.platformMessageId → "Platform's message ID"
 *   listado  id                        → el SDK no lo documenta
 *
 * Así que lo que hay que establecer es a CUÁL de los dos equivale el del
 * listado. Los cuatro veredictos posibles están abajo, en `VEREDICTOS`.
 *
 * ── POR QUÉ NO ALCANZA CON LEER LA DOCUMENTACIÓN ────────────────────────────
 *
 * Porque ya se equivocó sobre este campo exacto. El SDK afirma que
 * `platformMessageId` está disponible "from webhooks or the list-messages
 * endpoint", y en el listado no viene: ver `lib/zernio-message-map.ts`. Un
 * documento que ya mintió sobre este campo no puede ser la última palabra sobre
 * este campo. Hace falta mirar un payload real.
 *
 * ── DE DÓNDE SALE EL PAYLOAD REAL, SIN DESPLEGAR NADA ───────────────────────
 *
 * De `GET /v1/webhooks/logs`. Zernio guarda cada intento de entrega por 30 días
 * con `requestPayload`, el cuerpo JSON entero que mandó. Así que no hace falta
 * instrumentar el receptor, ni desplegar, ni mandar un DM de prueba: el mensaje
 * ya pasó y Zernio lo tiene guardado.
 *
 * ── QUÉ SE LEE DEL CUERPO, Y QUÉ NO ─────────────────────────────────────────
 *
 * Hay conversaciones con personas reales en ese canal. Del `requestPayload` se
 * extraen SOLO los identificadores y la marca de tiempo. El texto del mensaje y
 * las direcciones de los adjuntos no se leen, no se guardan y no se imprimen,
 * aunque el cuerpo lo tenga Zernio y no nosotros.
 *
 * La única excepción, y es deliberada: para cubrir un mensaje de texto y uno
 * con adjunto hace falta saber de qué tipo es cada uno. Eso se resuelve con
 * `attachments.length` (un número) y con si el texto está vacío (un booleano).
 * Ni el contenido ni las URLs tocan una variable. Un conteo y un booleano no
 * filtran una conversación; el texto sí.
 *
 * ── EL CONTROL POSITIVO ─────────────────────────────────────────────────────
 *
 * Comparar identificadores sin establecer primero que son el MISMO mensaje no
 * prueba nada: dos cadenas distintas de dos mensajes distintos es el resultado
 * esperado, no un hallazgo. Así que primero se ubica el mensaje en el listado
 * por marca de tiempo normalizada a epoch en milisegundos, y recién si aparece,
 * y aparece uno solo, se comparan los identificadores. Si no aparece, o si hay
 * más de un candidato en la ventana, el veredicto de ese mensaje es NO
 * CONCLUYENTE, nunca verde y nunca rojo.
 *
 * Uso:
 *   node scripts/verify-id-mensaje-zernio.mjs
 *
 * Solo lectura. No escribe en la base, no despliega y no manda mensajes.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { protegerSalida, redactar } from "./redaccion.mjs";

// ── Entorno ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

/** Igual que `lib/zernio-client.ts`: el SDK apunta acá. */
const ZERNIO = "https://zernio.com/api";

/** Cuántas entregas del log se piden. Alcanza para muestrear sin paginar. */
const MAX_ENTREGAS = 50;

/**
 * Cuántos mensajes distintos se comparan.
 *
 * El tope existe para no castigar al proveedor con una llamada por conversación
 * cuando el log tiene decenas de entregas. Los que quedan afuera **se nombran**
 * en el reporte, con el motivo. Un mensaje que no se comparó y no se menciona
 * es indistinguible de uno que se comparó y salió inconcluso, y esos dos son
 * resultados muy distintos.
 */
const MAX_MENSAJES = 10;

/**
 * Cuántos mensajes se piden del listado.
 *
 * No uno. Pedir el más reciente y nada más es frágil: si después del mensaje
 * que estamos buscando llegó otro, o el negocio contestó, el más reciente no es
 * el que buscamos y el veredicto saldría NO CONCLUYENTE por una razón trivial.
 * Con diez, el mensaje se busca adentro de la página.
 */
const MENSAJES_DEL_LISTADO = 10;

/**
 * Tolerancia al comparar marcas de tiempo, en milisegundos.
 *
 * No es para tapar una diferencia: es porque un camino puede entregar segundos
 * y el otro milisegundos, y eso es una conversión, no una discrepancia. Un
 * segundo entero es el redondeo más grosero que puede aparecer. Si en esa
 * ventana cae más de un mensaje, el resultado es ambiguo y se dice.
 */
const VENTANA_MS = 1000;

/**
 * Qué evento del log se mira.
 *
 * Los entrantes llegan como `message.received` y los salientes como
 * `message.sent`. **El filtro del log es lo único que los separa**, así que
 * correr esto sobre un solo evento y concluir "no hay datos sobre la otra
 * dirección" sería confundir un hueco de consulta con un hueco de
 * disponibilidad. Los dos caminos escriben en `platform_message_id` y los dos
 * tienen que dar la misma cadena que el listado, que devuelve las dos
 * direcciones mezcladas.
 */
const EVENTO =
  process.argv.find((a) => a.startsWith("--evento="))?.slice("--evento=".length) ??
  "message.received";

const VEREDICTOS = {
  COINCIDEN: "COINCIDEN",
  NO_COINCIDEN: "NO COINCIDEN",
  HALLAZGO_ABIERTO: "HALLAZGO ABIERTO",
  NO_CONCLUYENTE: "NO CONCLUYENTE",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function supa(path, opts = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  const texto = await res.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = texto;
  }
  return { ok: res.ok, status: res.status, cuerpo };
}

async function zernio(clave, path) {
  const res = await fetch(`${ZERNIO}${path}`, {
    headers: { Authorization: `Bearer ${clave}` },
  });
  const texto = await res.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = null;
  }
  return { ok: res.ok, status: res.status, cuerpo };
}

/**
 * Normaliza una marca de tiempo a epoch en milisegundos.
 *
 * Acepta ISO, epoch en segundos y epoch en milisegundos, porque los tres
 * aparecen en este proveedor según el endpoint. El corte en 1e12 separa
 * segundos de milisegundos: 1e12 milisegundos es 2001, y 1e12 segundos es el
 * año 33658. Cualquier fecha real de este sistema cae del lado correcto.
 */
function aEpocaMs(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    if (/^\d+$/.test(s)) return aEpocaMs(Number(s));
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function iso(ms) {
  return ms === null ? "(sin fecha)" : new Date(ms).toISOString();
}

/** Recorta un identificador largo para la tabla, conservando las dos puntas. */
function corto(s) {
  if (typeof s !== "string") return String(s);
  return s.length <= 28 ? s : `${s.slice(0, 14)}…${s.slice(-10)}`;
}

/**
 * Extrae del cuerpo de una entrega SOLO lo que este script puede mirar.
 *
 * Esta función es la frontera de privacidad: después de que devuelve, nadie más
 * toca el payload crudo. El texto y los adjuntos no salen de acá.
 */
function extraer(entrega) {
  const p = entrega?.requestPayload;
  const m = p?.message;
  if (!m) return null;

  const adjuntos = Array.isArray(m.attachments) ? m.attachments.length : 0;
  const hayTexto = typeof m.text === "string" && m.text.length > 0;

  return {
    eventId: entrega.eventId ?? p.id ?? null,
    entregaEn: entrega.createdAt ?? null,
    intento: entrega.attemptNumber ?? null,
    idInterno: m.id ?? null,
    idDePlataforma: m.platformMessageId ?? null,
    conversationId: m.conversationId ?? null,
    // `conversation.id` debería ser el mismo. Si no lo es, hay que saberlo.
    conversationIdDelSobre: p.conversation?.id ?? null,
    accountId: p.account?.id ?? null,
    plataforma: m.platform ?? null,
    direccion: m.direction ?? null,
    sentAtMs: aEpocaMs(m.sentAt),
    // Derivados, no contenido: un conteo y un booleano.
    tipo: adjuntos > 0 ? (hayTexto ? "texto+adjunto" : "adjunto") : hayTexto ? "texto" : "sin contenido",
    adjuntos,
  };
}

/**
 * El dictamen de un mensaje, aislado y sin red.
 *
 * Está separado del recorrido para que `--autoprueba` pueda ejercitarlo con
 * casos fabricados. Si esto viviera adentro del bucle, la única forma de ver un
 * veredicto rojo sería que el proveedor se rompiera, y un verificador que nunca
 * dio rojo no prueba nada: no distingue "coinciden" de "la comparación siempre
 * da verdadero".
 */
function dictaminar(m, lista) {
  if (m.conversationIdDelSobre && m.conversationIdDelSobre !== m.conversationId) {
    return {
      veredicto: VEREDICTOS.NO_CONCLUYENTE,
      motivo:
        `el sobre y el mensaje traen conversaciones distintas ` +
        `(${corto(m.conversationIdDelSobre)} vs ${corto(m.conversationId)})`,
    };
  }
  if (!Array.isArray(lista)) {
    return { veredicto: VEREDICTOS.NO_CONCLUYENTE, motivo: `el listado respondió ${lista.error}` };
  }

  // ── Control positivo: ¿estamos mirando el mismo mensaje? ──────────────────
  if (m.sentAtMs === null) {
    return {
      veredicto: VEREDICTOS.NO_CONCLUYENTE,
      motivo: "la entrega no trae marca de tiempo utilizable",
    };
  }

  const cerca = lista
    .map((x) => {
      const porCreated = x.createdAtMs === null ? null : Math.abs(x.createdAtMs - m.sentAtMs);
      const porSent = x.sentAtMs === null ? null : Math.abs(x.sentAtMs - m.sentAtMs);
      const deltas = [porCreated, porSent].filter((d) => d !== null);
      return { x, delta: deltas.length ? Math.min(...deltas) : null };
    })
    .filter((c) => c.delta !== null && c.delta <= VENTANA_MS);

  if (cerca.length === 0) {
    return {
      veredicto: VEREDICTOS.NO_CONCLUYENTE,
      motivo: `no aparece en los ${lista.length} más recientes del listado`,
    };
  }
  if (cerca.length > 1) {
    return {
      veredicto: VEREDICTOS.NO_CONCLUYENTE,
      motivo: `${cerca.length} mensajes del listado caen dentro de ${VENTANA_MS} ms: ambiguo`,
    };
  }

  // ── Recién ahora, los identificadores ────────────────────────────────────
  const encontrado = { ...cerca[0].x, delta: cerca[0].delta };
  if (encontrado.id && encontrado.id === m.idDePlataforma) {
    return { veredicto: VEREDICTOS.COINCIDEN, encontrado };
  }
  if (encontrado.id && encontrado.id === m.idInterno) {
    return { veredicto: VEREDICTOS.NO_COINCIDEN, encontrado };
  }
  return { veredicto: VEREDICTOS.HALLAZGO_ABIERTO, encontrado };
}

// ── Salientes ───────────────────────────────────────────────────────────────

/**
 * ── POR QUÉ LOS SALIENTES VAN POR OTRA PUERTA ───────────────────────────────
 *
 * El log de webhooks no sirve para los salientes, y no porque no haya datos:
 * **la suscripción no incluye `message.sent`**. Verificado contra
 * `GET /v1/webhooks/settings` el 21/09/2026: la suscripción "Zernflow" escucha
 * `message.received` y `comment.received`, nada más. Así que pedir
 * `?event=message.sent` devuelve cero filas para siempre, y leer ese cero como
 * "no hay salientes" sería confundir un hueco de consulta con uno de
 * disponibilidad. Es la misma trampa de siempre, con otro disfraz.
 *
 * Pero para los salientes el webhook tampoco es la fuente que importa. Lo que
 * escribe `platform_message_id` en un saliente no es un aviso entrante: es la
 * **respuesta del propio envío**. `lib/flow-engine/engine.ts:541`,
 * `lib/sequence-processor.ts:197` y `lib/flow-engine/nodes/ai-response.ts:132`
 * guardan `response.data.data.messageId`, y el SDK solo lo documenta como "ID
 * of the sent message", sin decir de qué familia es.
 *
 * Ese valor sí se puede leer sin mandar nada: el log unificado de actividad
 * (`GET /v1/logs`, retención de 90 días) guarda cada envío con su
 * `metadata.messageId`, que es el identificador que Zernio registró para esa
 * operación.
 *
 * ── EL CONTROL POSITIVO ACÁ ES DISTINTO, Y MÁS DÉBIL ────────────────────────
 *
 * En los entrantes las dos marcas de tiempo describen el mismo hecho y el delta
 * dio 0 ms. Acá no: el log de actividad marca **cuándo se llamó a la API** y el
 * listado marca **cuándo se envió el mensaje**, así que hay una diferencia real
 * de hasta unos segundos que no es una conversión. Por eso la ventana es más
 * ancha, y por eso se exige además que el mensaje del listado sea saliente y que
 * sea el único en esa ventana. Si hay más de uno, el resultado es ambiguo y se
 * dice.
 *
 * Y falta una pata: sin el webhook no tenemos el id interno del saliente, así
 * que la comparación es de dos vías y no de tres. Para no perder la distinción
 * se clasifica la FAMILIA del identificador por su forma, que en este proveedor
 * son inconfundibles: el interno es un ObjectId de 24 hex y el de plataforma es
 * un blob base64 de Meta. Es una heurística sobre la forma, no una lectura de
 * un campo declarado, y por eso está dicho acá y en el reporte.
 */
/**
 * ── SOBRE ESTE NÚMERO, QUE SE CAMBIÓ DESPUÉS DE VER LOS DATOS ───────────────
 *
 * Arrancó en 60 s, elegido antes de medir por el razonamiento de arriba: el log
 * marca la llamada y el listado marca el envío, así que podían separarse varios
 * segundos. Con esa ventana, dos envíos hechos con 22 s de diferencia caían los
 * dos adentro y los dos salieron NO CONCLUYENTE por ambigüedad.
 *
 * Medido: los deltas reales fueron 92, 142, 424 y 733 ms. La diferencia entre
 * las dos marcas es de menos de un segundo, no de varios. 5 s es siete veces el
 * mayor delta observado y sigue siendo holgado.
 *
 * **Por qué afinar acá no es acomodar el resultado, que es la objeción obvia.**
 * Una ventana más angosta solo puede hacer dos cosas: dejar afuera el mensaje
 * correcto, que da NO CONCLUYENTE, o agarrar uno equivocado, que da identificadores
 * distintos y por lo tanto NO COINCIDEN. Las dos son rojas o grises. Para
 * fabricar un verde falso haría falta que un mensaje distinto tuviera el mismo
 * identificador, y si eso pasara no habría nada que verificar. El error que
 * introduce este número corre en la dirección segura.
 */
const VENTANA_SALIENTE_MS = 5_000;

/** Heurística de forma, no campo declarado. Ver el comentario de arriba. */
function familia(id) {
  if (typeof id !== "string" || id === "") return "ausente";
  return /^[0-9a-f]{24}$/.test(id) ? "interno" : "plataforma";
}

function dictaminarSaliente(envio, lista) {
  if (!Array.isArray(lista)) {
    return { veredicto: VEREDICTOS.NO_CONCLUYENTE, motivo: `el listado respondió ${lista.error}` };
  }
  if (envio.llamadaMs === null) {
    return { veredicto: VEREDICTOS.NO_CONCLUYENTE, motivo: "el envío no trae marca de tiempo" };
  }

  // Control positivo: un saliente, y uno solo, cerca de la llamada.
  const cerca = lista
    .filter((x) => x.direction === "outgoing")
    .map((x) => {
      const deltas = [x.createdAtMs, x.sentAtMs]
        .filter((t) => t !== null)
        .map((t) => Math.abs(t - envio.llamadaMs));
      return { x, delta: deltas.length ? Math.min(...deltas) : null };
    })
    .filter((c) => c.delta !== null && c.delta <= VENTANA_SALIENTE_MS);

  if (cerca.length === 0) {
    return {
      veredicto: VEREDICTOS.NO_CONCLUYENTE,
      motivo: `ningún saliente del listado cae dentro de ${VENTANA_SALIENTE_MS / 1000} s de la llamada`,
    };
  }
  if (cerca.length > 1) {
    return {
      veredicto: VEREDICTOS.NO_CONCLUYENTE,
      motivo: `${cerca.length} salientes caen dentro de ${VENTANA_SALIENTE_MS / 1000} s: ambiguo`,
    };
  }

  const encontrado = { ...cerca[0].x, delta: cerca[0].delta };
  if (encontrado.id && encontrado.id === envio.messageId) {
    return { veredicto: VEREDICTOS.COINCIDEN, encontrado };
  }
  // Distintos. Qué tan distintos importa: si uno es de cada familia, el
  // diagnóstico está hecho; si no, no hay explicación que inventar.
  const fEnvio = familia(envio.messageId);
  const fListado = familia(encontrado.id);
  if (fEnvio !== fListado) {
    return { veredicto: VEREDICTOS.NO_COINCIDEN, encontrado, motivo: `envío ${fEnvio}, listado ${fListado}` };
  }
  return { veredicto: VEREDICTOS.HALLAZGO_ABIERTO, encontrado, motivo: `las dos de familia ${fEnvio}` };
}

// ── Autoprueba ──────────────────────────────────────────────────────────────

/**
 * Demuestra que las cuatro ramas son alcanzables, sin tocar la red.
 *
 * Esto no valida al proveedor: valida al verificador. El resultado real de este
 * script fue COINCIDEN en todos los mensajes, y ese es exactamente el escenario
 * donde conviene desconfiar, porque un verde uniforme se ve igual venga de una
 * comparación que discrimina o de una que siempre da verdadero.
 */
function autoprueba() {
  const T = Date.parse("2026-09-17T19:10:19.793Z");
  const base = {
    idInterno: "INTERNO",
    idDePlataforma: "PLATAFORMA",
    conversationId: "conv",
    conversationIdDelSobre: "conv",
    sentAtMs: T,
  };
  const item = (id, ms) => ({ id, platformMessageId: null, createdAtMs: ms, sentAtMs: ms });

  const casos = [
    ["el listado trae el id de plataforma", base, [item("PLATAFORMA", T)], VEREDICTOS.COINCIDEN],
    ["el listado trae el id interno", base, [item("INTERNO", T)], VEREDICTOS.NO_COINCIDEN],
    ["el listado trae un tercer id", base, [item("OTRO", T)], VEREDICTOS.HALLAZGO_ABIERTO],
    ["el mensaje no está en la página", base, [item("PLATAFORMA", T + 99999)], VEREDICTOS.NO_CONCLUYENTE],
    [
      "dos mensajes en la misma ventana",
      base,
      [item("PLATAFORMA", T), item("OTRO", T + 200)],
      VEREDICTOS.NO_CONCLUYENTE,
    ],
    ["la entrega no trae fecha", { ...base, sentAtMs: null }, [item("PLATAFORMA", T)], VEREDICTOS.NO_CONCLUYENTE],
    ["el listado falló", base, { error: 500 }, VEREDICTOS.NO_CONCLUYENTE],
    [
      "segundos contra ISO es conversión, no discrepancia",
      { ...base, sentAtMs: aEpocaMs(Math.floor(T / 1000)) },
      [item("PLATAFORMA", T)],
      VEREDICTOS.COINCIDEN,
    ],
  ];

  // El camino saliente tiene su propio dictamen, así que necesita sus propios
  // casos: que las ramas del entrante discriminen no dice nada del otro.
  const PLAT = "aWdfZAG1faXRlbToxOklHTWVzc2FnZ";
  const INT = "6aab357e42ee880196d6e6bd";
  const envio = { conversationId: "conv", messageId: PLAT, llamadaMs: T };
  const sal = (id, ms, direction = "outgoing") => ({
    id,
    platformMessageId: null,
    direction,
    createdAtMs: ms,
    sentAtMs: ms,
  });

  const casosSalientes = [
    ["el listado devuelve el mismo id del envío", envio, [sal(PLAT, T + 3000)], VEREDICTOS.COINCIDEN],
    [
      "el envío guarda plataforma y el listado devuelve interno",
      envio,
      [sal(INT, T + 3000)],
      VEREDICTOS.NO_COINCIDEN,
    ],
    [
      "distintos y de la misma familia",
      envio,
      [sal(`${PLAT}OTRO`, T + 3000)],
      VEREDICTOS.HALLAZGO_ABIERTO,
    ],
    ["no hay ningún saliente cerca", envio, [sal(PLAT, T + 600000)], VEREDICTOS.NO_CONCLUYENTE],
    [
      "el único cerca es entrante, no saliente",
      envio,
      [sal(PLAT, T + 3000, "incoming")],
      VEREDICTOS.NO_CONCLUYENTE,
    ],
    [
      "dos salientes en la ventana",
      envio,
      [sal(PLAT, T + 1000), sal(`${PLAT}X`, T + 2000)],
      VEREDICTOS.NO_CONCLUYENTE,
    ],
  ];

  console.log("\nAutoprueba del verificador. No toca la red ni el proveedor.\n");
  let fallos = 0;
  console.log("  entrantes:");
  for (const [desc, m, lista, esperado] of casos) {
    const { veredicto } = dictaminar(m, lista);
    const ok = veredicto === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? "ok   " : "FALLA"} ${desc}  →  ${veredicto}${ok ? "" : ` (esperaba ${esperado})`}`);
  }
  console.log("\n  salientes:");
  for (const [desc, e, lista, esperado] of casosSalientes) {
    const { veredicto } = dictaminarSaliente(e, lista);
    const ok = veredicto === esperado;
    if (!ok) fallos++;
    console.log(`  ${ok ? "ok   " : "FALLA"} ${desc}  →  ${veredicto}${ok ? "" : ` (esperaba ${esperado})`}`);
  }
  console.log(
    fallos === 0
      ? "\nLas cuatro ramas son alcanzables y discriminan. El verde del recorrido real significa algo."
      : `\n${fallos} caso(s) de autoprueba fallaron: el veredicto del recorrido real NO es interpretable.`
  );
  return fallos === 0 ? 0 : 1;
}

// ── Main ────────────────────────────────────────────────────────────────────

/** El canal y la clave. Lo comparten los dos recorridos. */
async function preparar() {
  const canales = await supa(
    "/rest/v1/channels?select=id,workspace_id,platform,late_account_id,username&is_active=eq.true"
  );
  if (!canales.ok) {
    console.error(`No se pudieron leer los canales: ${canales.status}`);
    return null;
  }

  const instagram = (canales.cuerpo ?? []).filter((c) => c.platform === "instagram");
  if (instagram.length === 0) {
    console.error("No hay ningún canal de Instagram activo. Sin canal no hay nada que mirar.");
    return null;
  }
  const canal = instagram[0];
  console.log(`Canal: ${canal.platform} @${canal.username ?? "?"}  cuenta ${canal.late_account_id}`);
  if (instagram.length > 1) {
    console.log(`Aviso: hay ${instagram.length} canales de Instagram activos. Se usa el primero.`);
  }

  const secreto = await supa("/rest/v1/rpc/read_secret", {
    method: "POST",
    body: JSON.stringify({ secret_name: "zernio_api_key", workspace_id: canal.workspace_id }),
  });
  const clave = typeof secreto.cuerpo === "string" ? secreto.cuerpo : null;
  if (!secreto.ok || !clave) {
    console.error(`No se pudo leer la clave de Zernio de Vault: ${secreto.status}`);
    return null;
  }
  // Desde acá, nada que contenga la clave puede salir por pantalla, ni siquiera
  // por accidente adentro de un volcado de respuesta.
  const sumarSecreto = protegerSalida([clave]);
  console.log(`Clave de Zernio leída de Vault: ${redactar(clave)}\n`);
  return { canal, clave, sumarSecreto };
}

/** Un listador con caché: una llamada por conversación, no una por mensaje. */
function hacerListador(clave) {
  const listados = new Map();
  return async function listar(conversationId, accountId) {
    if (listados.has(conversationId)) return listados.get(conversationId);
    const res = await zernio(
      clave,
      `/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages` +
        `?accountId=${encodeURIComponent(accountId)}&sortOrder=desc&limit=${MENSAJES_DEL_LISTADO}`
    );
    const valor = res.ok
      ? (res.cuerpo?.data?.messages ?? res.cuerpo?.messages ?? []).map((m) => ({
          id: m.id ?? null,
          platformMessageId: m.platformMessageId ?? null,
          direction: m.direction ?? null,
          createdAtMs: aEpocaMs(m.createdAt),
          sentAtMs: aEpocaMs(m.sentAt),
        }))
      : { error: res.status };
    listados.set(conversationId, valor);
    return valor;
  };
}

/**
 * Recorrido de los SALIENTES.
 *
 * Fuente: el log unificado de actividad, no el de webhooks. El porqué está en
 * el bloque grande de la sección "Salientes".
 */
async function mainSalientes() {
  console.log("\n¿El id que guardamos al enviar es el mismo que devuelve el listado?");
  console.log("Fuente: el log de actividad de Zernio. Solo lectura.\n");

  const prep = await preparar();
  if (!prep) return 3;
  const { canal, clave, sumarSecreto } = prep;
  const listar = hacerListador(clave);

  // Control del hueco de consulta: si la suscripción no escucha message.sent,
  // el log de webhooks va a dar cero para siempre y hay que decir por qué.
  //
  // OJO CON ESTA RESPUESTA: `GET /v1/webhooks/settings` devuelve el secreto de
  // firma de cada webhook **en texto plano**, junto con el resto de la
  // configuración. Se suma al filtro de salida apenas se lee, antes de tocar
  // nada más, y de acá abajo solo se leen `events`. El filtro está para que un
  // volcado accidental tampoco lo exponga.
  const sub = await zernio(clave, "/v1/webhooks/settings");
  if (sub.ok) {
    for (const w of sub.cuerpo?.webhooks ?? []) sumarSecreto(w?.secret);

    const eventos = (sub.cuerpo?.webhooks ?? []).flatMap((w) => w.events ?? []);
    const escucha = eventos.includes("message.sent");
    console.log(
      `Suscripción de webhook: ${escucha ? "incluye" : "NO incluye"} message.sent` +
        `${escucha ? "" : " → por eso el log de webhooks da cero, no porque no haya salientes"}`
    );
  }

  const log = await zernio(clave, `/v1/logs?type=messaging&days=90&limit=${MAX_ENTREGAS}`);
  if (!log.ok) {
    console.error(`El log de actividad respondió ${log.status}.`);
    return 3;
  }

  const envios = (log.cuerpo?.logs ?? [])
    .filter((L) => L.action === "message.sent")
    .map((L) => {
      // Frontera de privacidad, igual que `extraer`: de metadata salen dos
      // identificadores y nada más. `messagePreview` y `request_body` traen el
      // texto del mensaje y no se tocan.
      let md = null;
      try {
        md = JSON.parse(L.metadata ?? "null");
      } catch {
        md = null;
      }
      return {
        conversationId: md?.conversationId ?? null,
        messageId: md?.messageId ?? null,
        llamadaMs: aEpocaMs(L.created_at?.replace(" ", "T") + "Z"),
        endpoint: L.endpoint ?? null,
        estado: L.status ?? null,
        /** `api` = lo mandó nuestro código. `platform` = lo mandaron desde la app. */
        origen: md?.source ?? null,
        adjunto: md?.hasAttachment === true,
      };
    })
    .filter((e) => e.conversationId && e.messageId && e.estado === "success");

  // ── LA POBLACIÓN CORRECTA, Y POR QUÉ SE RECORTA ───────────────────────────
  //
  // La pregunta es qué guarda NUESTRO camino de envío en `platform_message_id`.
  // El log mezcla dos orígenes y hay que separarlos, porque no responden lo
  // mismo:
  //
  //   source=api       lo mandó nuestro código, por
  //                    POST /api/v1/inbox/conversations/{id}/messages.
  //                    Es el único que termina en `messages`.
  //   source=platform  lo escribió alguien desde la app de Instagram. Nuestro
  //                    código nunca lo ve ni lo guarda.
  //
  // Medido el 21/09/2026: los de `api` registran el identificador de PLATAFORMA
  // y los de `platform` registran el INTERNO. O sea que `metadata.messageId` del
  // log de actividad no es un campo de familia uniforme: depende del origen.
  //
  // Recortar acá no es acomodar el resultado para que dé verde, y la diferencia
  // importa: los de `source=platform` **no se descartan, se reportan aparte**,
  // con su veredicto y su motivo. Lo que cambia es de qué población sale el
  // veredicto global, porque un mensaje que nuestro código nunca escribe no
  // puede decir nada sobre lo que nuestro código escribe.
  const nuestros = envios.filter((e) => e.origen === "api");
  const ajenos = envios.filter((e) => e.origen !== "api");

  console.log(`\nEnvíos con identificador en el log: ${envios.length}`);
  console.log(`  nuestros (source=api): ${nuestros.length}   desde la app (source=platform): ${ajenos.length}`);
  if (nuestros.some((e) => e.adjunto) === false) {
    console.log("  ninguno de los nuestros llevaba adjunto: el resultado no dice nada sobre adjuntos salientes");
  }
  if (nuestros.length === 0) {
    console.log("\nVEREDICTO GLOBAL: NO CONCLUYENTE");
    console.log("No hay ningún envío hecho por nuestro código. Mandá un mensaje desde la");
    console.log("bandeja y repetí. Los envíos desde la app de Instagram no responden esto.");
    return 3;
  }

  const muestra = nuestros.slice(0, MAX_MENSAJES);
  if (nuestros.length > muestra.length) {
    console.log(`Se comparan ${muestra.length}; ${nuestros.length - muestra.length} quedan afuera por el tope.`);
  }

  const resultados = [];
  for (const e of muestra) {
    const lista = await listar(e.conversationId, canal.late_account_id);
    const fila = { e, ...dictaminarSaliente(e, lista) };
    resultados.push(fila);
    if (fila.veredicto === VEREDICTOS.HALLAZGO_ABIERTO) break;
  }

  // Los ajenos se miden igual y se muestran aparte. No entran en el veredicto,
  // pero callarlos sería esconder la única evidencia de que el campo cambia de
  // familia según el origen.
  const resultadosAjenos = [];
  for (const e of ajenos.slice(0, MAX_MENSAJES)) {
    const lista = await listar(e.conversationId, canal.late_account_id);
    resultadosAjenos.push({ e, ...dictaminarSaliente(e, lista) });
  }

  console.log("─".repeat(78));
  for (const r of resultados) {
    console.log(`\nEnvío a ${r.e.conversationId}   ${iso(r.e.llamadaMs)}`);
    if (r.encontrado) {
      console.log(`  control positivo  ok, un solo saliente en la ventana (delta ${r.encontrado.delta} ms)`);
      console.log(`  guardado al enviar  ${r.e.messageId}   familia ${familia(r.e.messageId)}`);
      console.log(`  listado id          ${r.encontrado.id}   familia ${familia(r.encontrado.id)}`);
    } else {
      console.log(`  control positivo  FALLA: ${r.motivo}`);
    }
    console.log(`  VEREDICTO         ${r.veredicto}${r.motivo && r.encontrado ? `  (${r.motivo})` : ""}`);
  }

  if (resultadosAjenos.length > 0) {
    console.log(`\n${"·".repeat(78)}`);
    console.log("FUERA DE LA PREGUNTA: mensajes escritos desde la app de Instagram.");
    console.log("Nuestro código no los manda ni los guarda. Se muestran porque son la");
    console.log("evidencia de que el campo cambia de familia según el origen.\n");
    for (const r of resultadosAjenos) {
      console.log(`  ${iso(r.e.llamadaMs)}  log ${familia(r.e.messageId)}  vs  listado ${
        r.encontrado ? familia(r.encontrado.id) : "(sin control positivo)"
      }  → ${r.veredicto}`);
    }
  }

  const cuenta = {};
  for (const r of resultados) cuenta[r.veredicto] = (cuenta[r.veredicto] ?? 0) + 1;
  console.log(`\n${"─".repeat(78)}`);
  console.log("Resumen de los envíos nuestros: " + Object.entries(cuenta).map(([k, v]) => `${k} ${v}`).join("   "));

  if (cuenta[VEREDICTOS.HALLAZGO_ABIERTO]) {
    console.log("\nVEREDICTO GLOBAL: HALLAZGO ABIERTO");
    return 2;
  }
  if (cuenta[VEREDICTOS.NO_COINCIDEN]) {
    console.log("\nVEREDICTO GLOBAL: NO COINCIDEN");
    console.log("El camino de envío guarda una familia de identificador y el listado devuelve");
    console.log("otra. La importación de F27 duplicaría todos los salientes.");
    return 1;
  }
  if (cuenta[VEREDICTOS.NO_CONCLUYENTE] || !cuenta[VEREDICTOS.COINCIDEN]) {
    console.log("\nVEREDICTO GLOBAL: NO CONCLUYENTE");
    return 3;
  }
  console.log("\nVEREDICTO GLOBAL: COINCIDEN");
  console.log(`Los ${cuenta[VEREDICTOS.COINCIDEN]} envíos comparados guardan la misma cadena que devuelve`);
  console.log("el listado. Del lado saliente, la importación tampoco duplica.");
  return 0;
}

/**
 * Estado del registro del webhook.
 *
 * Es el paso 3.2 de `docs/purga-y-reconexion-instagram.md`: después de rotar el
 * secreto hay que confirmar que el valor nuevo llegó a Zernio.
 *
 * **Lo que esto prueba y lo que no.** Prueba que el webhook figura registrado,
 * contra qué URL, con qué eventos, y que el secreto guardado en `workspaces` es
 * el mismo que tiene Zernio. **No prueba que las entregas lleguen ni que la
 * firma verifique**: eso solo lo prueba un mensaje real, que es el paso 4 de ese
 * documento. Un secreto que coincide y un webhook apuntando a una URL que no
 * responde se ven igual desde acá.
 *
 * Ninguno de los dos secretos se imprime. Se comparan en memoria y sale un sí o
 * un no, más longitud y últimos cuatro para poder distinguir cuál es cuál.
 */
/**
 * Qué cuentas hay conectadas en Zernio.
 *
 * Es el paso 0 de `docs/purga-y-reconexion-instagram.md`. La pregunta que
 * contesta es una sola y muy concreta: **¿queda más de una cuenta de Instagram
 * conectada?**
 *
 * Importa porque conectar una cuenta no desconecta la anterior, y porque del
 * lado nuestro nada lo impide: `channels` es único por `(workspace_id,
 * late_account_id)`, así que dos cuentas conviven como dos canales activos, y
 * `debeDesactivarseCanal` solo desactiva un canal cuando su cuenta **ya no
 * existe** en Zernio. O sea que el estado de acá es el que manda.
 */
async function mainCuentas() {
  console.log("\nCuentas conectadas en Zernio.\n");

  const prep = await preparar();
  if (!prep) return 3;
  const { clave } = prep;

  const res = await zernio(clave, "/v1/accounts");
  if (!res.ok) {
    console.error(`La lista de cuentas respondió ${res.status}.`);
    return 3;
  }

  const cuentas = Array.isArray(res.cuerpo)
    ? res.cuerpo
    : (res.cuerpo?.accounts ?? res.cuerpo?.data ?? []);

  for (const a of cuentas) {
    console.log(`  ${String(a.platform).padEnd(10)} @${a.username ?? "?"}   id=${a._id ?? a.id}`);
  }

  const instagram = cuentas.filter((a) => a.platform === "instagram");
  console.log(`\nTotal: ${cuentas.length}   de Instagram: ${instagram.length}`);

  // El canal local, para contrastar. Dos canales activos de Instagram significa
  // que hay dos cuentas recibiendo, y el webhook entrega a las dos.
  const canales = await supa(
    "/rest/v1/channels?select=username,late_account_id,is_active&platform=eq.instagram&is_active=eq.true"
  );
  const activos = canales.ok ? (canales.cuerpo ?? []) : [];
  console.log(`Canales locales de Instagram activos: ${activos.length}`);
  for (const c of activos) console.log(`  @${c.username ?? "?"}  ${c.late_account_id}`);

  if (instagram.length > 1 || activos.length > 1) {
    console.log("\nHAY MÁS DE UNA CUENTA DE INSTAGRAM. Las dos reciben mensajes.");
    console.log("Si esto es a mitad del procedimiento de purga, la ventana está abierta.");
    return 1;
  }
  if (instagram.length === 0) {
    console.log("\nNo hay ninguna cuenta de Instagram conectada.");
    console.log("Correcto si acabás de ejecutar el paso 0; no, en cualquier otro momento.");
    return 0;
  }
  console.log("\nUna sola cuenta de Instagram. Sin ventana abierta.");
  return 0;
}

async function mainRegistro() {
  console.log("\nEstado del registro del webhook en Zernio.");
  console.log("Solo lectura. Ningún secreto se imprime.\n");

  const prep = await preparar();
  if (!prep) return 3;
  const { canal, clave, sumarSecreto } = prep;

  const res = await zernio(clave, "/v1/webhooks/settings");
  if (!res.ok) {
    console.error(`La configuración respondió ${res.status}.`);
    return 3;
  }

  const webhooks = res.cuerpo?.webhooks ?? [];
  for (const w of webhooks) sumarSecreto(w?.secret);

  if (webhooks.length === 0) {
    console.log("NO HAY NINGÚN WEBHOOK REGISTRADO.");
    console.log("La bandeja no va a recibir nada. Re-registrar desde la aplicación.");
    return 1;
  }

  const guardado = await supa(
    `/rest/v1/workspaces?select=webhook_secret&id=eq.${encodeURIComponent(canal.workspace_id)}`
  );
  const secretoLocal = guardado.ok ? (guardado.cuerpo?.[0]?.webhook_secret ?? null) : null;
  if (secretoLocal) sumarSecreto(secretoLocal);

  let fallos = 0;
  for (const w of webhooks) {
    console.log(`Webhook "${w.name ?? "(sin nombre)"}"`);
    console.log(`  url             ${w.url ?? "(ausente)"}`);
    console.log(`  activo          ${w.isActive === true ? "sí" : "NO"}`);
    console.log(`  eventos         ${(w.events ?? []).join(", ") || "(ninguno)"}`);
    console.log(`  fallos seguidos ${w.failureCount ?? 0}`);
    console.log(`  última entrega  ${w.lastFiredAt ?? "(nunca)"}`);
    console.log(`  secreto en Zernio ${redactar(w.secret)}`);

    if (secretoLocal === null) {
      console.log("  COINCIDENCIA    no concluyente: no se pudo leer el secreto guardado");
      fallos++;
    } else if (w.secret === secretoLocal) {
      console.log(`  COINCIDENCIA    sí, con el guardado ${redactar(secretoLocal)}`);
    } else {
      console.log(`  COINCIDENCIA    NO. El guardado es ${redactar(secretoLocal)}`);
      console.log("                  Toda entrega va a fallar la verificación de firma.");
      fallos++;
    }
    if (w.isActive !== true) fallos++;
    console.log("");
  }

  console.log("─".repeat(78));
  if (fallos > 0) {
    console.log("HAY PROBLEMAS EN EL REGISTRO. Ver arriba.");
    return 1;
  }
  console.log("El registro está bien según Zernio.");
  console.log("Falta el paso 4: un mensaje real, de ida y de vuelta. Esto no lo reemplaza.");
  return 0;
}

async function main() {
  console.log("\n¿El id del listado es el id interno o el de plataforma?");
  console.log("Fuente: el log de entregas de Zernio. Solo lectura.\n");

  const prep = await preparar();
  if (!prep) return 3;
  const { canal, clave } = prep;

  // 3. El log de entregas.
  const log = await zernio(
    clave,
    `/v1/webhooks/logs?event=${encodeURIComponent(EVENTO)}&limit=${MAX_ENTREGAS}`
  );
  if (!log.ok) {
    console.error(`El log de entregas respondió ${log.status}.`);
    if (log.status === 403) {
      console.error("403: la clave no tiene el grupo de recursos 'webhooks'.");
    }
    return 3;
  }

  const entregas = log.cuerpo?.logs ?? [];
  console.log(`Entregas de ${EVENTO} en el log: ${entregas.length}`);
  if (entregas.length === 0) {
    console.log("\nVEREDICTO GLOBAL: NO CONCLUYENTE");
    console.log("El log está vacío. Mandá un DM de prueba a la cuenta conectada y");
    console.log("volvé a correr esto. Se sigue leyendo el log de Zernio, no uno nuestro.");
    return 3;
  }

  // 4. Una fila por mensaje: los reintentos repiten el mismo evento.
  const porMensaje = new Map();
  for (const entrega of entregas) {
    const e = extraer(entrega);
    if (!e || !e.idInterno || !e.conversationId) continue;
    const previo = porMensaje.get(e.idInterno);
    if (!previo || (e.intento ?? 0) < (previo.intento ?? 0)) porMensaje.set(e.idInterno, e);
  }

  const candidatos = [...porMensaje.values()].sort((a, b) => (b.sentAtMs ?? 0) - (a.sentAtMs ?? 0));
  if (candidatos.length === 0) {
    console.log("\nVEREDICTO GLOBAL: NO CONCLUYENTE");
    console.log("Hay entregas en el log pero ninguna trae un mensaje con id y conversación.");
    return 3;
  }

  // 5. La muestra: no el promedio, la variedad.
  //
  // Un solo mensaje no alcanza. Este proveedor ya se comporta distinto según el
  // tipo: devuelve `message: ""` para los adjuntos viejos del listado. Que los
  // identificadores coincidan en un texto no prueba que coincidan en un adjunto.
  const conAdjunto = candidatos.filter((c) => c.adjuntos > 0);
  const soloTexto = candidatos.filter((c) => c.adjuntos === 0);
  const muestra = [];
  if (conAdjunto[0]) muestra.push(conAdjunto[0]);
  if (soloTexto[0]) muestra.push(soloTexto[0]);
  for (const c of candidatos) {
    if (muestra.length >= MAX_MENSAJES) break;
    if (!muestra.includes(c)) muestra.push(c);
  }
  muestra.sort((a, b) => (b.sentAtMs ?? 0) - (a.sentAtMs ?? 0));

  const afuera = candidatos.filter((c) => !muestra.includes(c));

  console.log(`Mensajes distintos en el log: ${candidatos.length}`);
  console.log(`  con adjunto: ${conAdjunto.length}   solo texto: ${soloTexto.length}`);
  console.log(`Se comparan ${muestra.length}.`);
  if (afuera.length > 0) {
    // Nombrarlos, no solo contarlos: "quedó afuera por el tope" y "se comparó y
    // salió inconcluso" son resultados distintos y no se pueden ver iguales.
    console.log(`Quedan afuera ${afuera.length} por el tope de ${MAX_MENSAJES}, no por su resultado:`);
    for (const c of afuera) {
      console.log(`  ${corto(c.idInterno)}  ${c.tipo}  ${c.direccion ?? "?"}  ${iso(c.sentAtMs)}`);
    }
  }
  if (conAdjunto.length === 0) {
    console.log("Aviso: el log no tiene ningún mensaje con adjunto, así que este");
    console.log("resultado no dice nada sobre los adjuntos.");
  }
  console.log("");

  // 6. El listado, una llamada por conversación.
  const listar = hacerListador(clave);

  // 7. La comparación, mensaje por mensaje.
  const resultados = [];
  let corteAbierto = false;

  for (const m of muestra) {
    const lista = await listar(m.conversationId, m.accountId ?? canal.late_account_id);
    const fila = { m, ...dictaminar(m, lista) };
    resultados.push(fila);

    // El corte es deliberado: ante un id que no es ninguno de los dos no hay
    // explicación que inventar, hay tres valores que reportar y parar.
    if (fila.veredicto === VEREDICTOS.HALLAZGO_ABIERTO) {
      corteAbierto = true;
      break;
    }
  }

  // 8. El reporte.
  console.log("─".repeat(78));
  for (const r of resultados) {
    const m = r.m;
    console.log(`\nMensaje ${corto(m.idInterno)}   ${m.tipo}   ${m.direccion ?? "?"}`);
    console.log(`  conversación      ${m.conversationId}`);
    console.log(`  webhook sentAt    ${iso(m.sentAtMs)}`);
    if (r.encontrado) {
      const e = r.encontrado;
      console.log(`  listado createdAt ${iso(e.createdAtMs)}   sentAt ${iso(e.sentAtMs)}`);
      console.log(`  control positivo  ok, mismo mensaje (delta ${e.delta} ms)`);
      console.log(`  webhook id            ${m.idInterno}`);
      console.log(`  webhook platformMsgId ${m.idDePlataforma ?? "(ausente)"}`);
      console.log(`  listado id            ${e.id ?? "(ausente)"}`);
      if (e.platformMessageId) {
        console.log(`  listado platformMsgId ${e.platformMessageId}  ← apareció, el SDK decía que no`);
      }
    } else {
      console.log(`  control positivo  FALLA: ${r.motivo}`);
    }
    console.log(`  VEREDICTO         ${r.veredicto}`);
    if (r.veredicto === VEREDICTOS.NO_COINCIDEN) {
      console.log("                    el listado entrega el id INTERNO y el webhook el de PLATAFORMA");
    }
  }

  // 9. El veredicto global. Un solo mensaje distinto es el hallazgo, no el promedio.
  console.log(`\n${"─".repeat(78)}`);
  const cuenta = {};
  for (const r of resultados) cuenta[r.veredicto] = (cuenta[r.veredicto] ?? 0) + 1;
  console.log("Resumen: " + Object.entries(cuenta).map(([k, v]) => `${k} ${v}`).join("   "));

  if (corteAbierto) {
    console.log("\nVEREDICTO GLOBAL: HALLAZGO ABIERTO");
    console.log("El id del listado no equivale a ninguno de los dos del webhook.");
    console.log("Los tres valores están arriba. El recorrido se cortó acá a propósito:");
    console.log("no hay explicación que inventar, hay que mirarlo con Zernio.");
    return 2;
  }
  if (cuenta[VEREDICTOS.NO_COINCIDEN]) {
    console.log("\nVEREDICTO GLOBAL: NO COINCIDEN");
    console.log("Estaríamos guardando el identificador INTERNO desde el listado y el de");
    console.log("PLATAFORMA desde el webhook. La restricción única de F27 no se dispararía");
    console.log("y la importación duplicaría el historial entero sin un solo error a la vista.");
    return 1;
  }
  if (cuenta[VEREDICTOS.NO_CONCLUYENTE] || !cuenta[VEREDICTOS.COINCIDEN]) {
    console.log("\nVEREDICTO GLOBAL: NO CONCLUYENTE");
    console.log("El control positivo no se pudo establecer en todos los mensajes.");
    console.log("Ni verde ni rojo: los motivos están arriba, mensaje por mensaje.");
    return 3;
  }
  console.log("\nVEREDICTO GLOBAL: COINCIDEN");
  console.log(`Los ${cuenta[VEREDICTOS.COINCIDEN]} mensajes comparados dan la misma cadena, con el`);
  console.log("control positivo establecido en cada uno. F27 se puede construir con la");
  console.log("importación y el webhook corriendo a la vez.");
  return 0;
}

const soloAutoprueba = process.argv.includes("--autoprueba");
const salientes = process.argv.includes("--salientes");
const registro = process.argv.includes("--registro");
const cuentas = process.argv.includes("--cuentas");

(soloAutoprueba
  ? Promise.resolve(autoprueba())
  : cuentas
    ? mainCuentas()
    : registro
      ? mainRegistro()
      : salientes
        ? mainSalientes()
        : main())
  .then((codigo) => process.exit(codigo))
  .catch((err) => {
    console.error("\nError inesperado:", err);
    process.exit(3);
  });
