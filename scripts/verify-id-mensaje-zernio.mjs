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

/** Cuántos mensajes distintos se comparan. */
const MAX_MENSAJES = 6;

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

  console.log("\nAutoprueba del verificador. No toca la red ni el proveedor.\n");
  let fallos = 0;
  for (const [desc, m, lista, esperado] of casos) {
    const { veredicto } = dictaminar(m, lista);
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

async function main() {
  console.log("\n¿El id del listado es el id interno o el de plataforma?");
  console.log("Fuente: el log de entregas de Zernio. Solo lectura.\n");

  // 1. El canal, y con él el workspace y la cuenta.
  const canales = await supa(
    "/rest/v1/channels?select=id,workspace_id,platform,late_account_id,username&is_active=eq.true"
  );
  if (!canales.ok) {
    console.error(`No se pudieron leer los canales: ${canales.status}`);
    console.error(JSON.stringify(canales.cuerpo));
    return 3;
  }

  const instagram = (canales.cuerpo ?? []).filter((c) => c.platform === "instagram");
  if (instagram.length === 0) {
    console.error("No hay ningún canal de Instagram activo. Sin canal no hay entregas que mirar.");
    return 3;
  }
  const canal = instagram[0];
  console.log(`Canal: ${canal.platform} @${canal.username ?? "?"}  cuenta ${canal.late_account_id}`);
  if (instagram.length > 1) {
    console.log(`Aviso: hay ${instagram.length} canales de Instagram activos. Se usa el primero.`);
  }

  // 2. La clave, de Vault.
  const secreto = await supa("/rest/v1/rpc/read_secret", {
    method: "POST",
    body: JSON.stringify({ secret_name: "zernio_api_key", workspace_id: canal.workspace_id }),
  });
  const clave = typeof secreto.cuerpo === "string" ? secreto.cuerpo : null;
  if (!secreto.ok || !clave) {
    console.error(`No se pudo leer la clave de Zernio de Vault: ${secreto.status}`);
    return 3;
  }
  console.log("Clave de Zernio leída de Vault.\n");

  // 3. El log de entregas.
  const log = await zernio(
    clave,
    `/v1/webhooks/logs?event=message.received&limit=${MAX_ENTREGAS}`
  );
  if (!log.ok) {
    console.error(`El log de entregas respondió ${log.status}.`);
    if (log.status === 403) {
      console.error("403: la clave no tiene el grupo de recursos 'webhooks'.");
    }
    return 3;
  }

  const entregas = log.cuerpo?.logs ?? [];
  console.log(`Entregas de message.received en el log: ${entregas.length}`);
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

  console.log(`Mensajes distintos en el log: ${candidatos.length}`);
  console.log(`  con adjunto: ${conAdjunto.length}   solo texto: ${soloTexto.length}`);
  console.log(`Se comparan ${muestra.length}.`);
  if (conAdjunto.length === 0) {
    console.log("Aviso: el log no tiene ningún mensaje con adjunto, así que este");
    console.log("resultado no dice nada sobre los adjuntos.");
  }
  console.log("");

  // 6. El listado, una llamada por conversación.
  const listados = new Map();
  async function listar(conversationId, accountId) {
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
          createdAtMs: aEpocaMs(m.createdAt),
          sentAtMs: aEpocaMs(m.sentAt),
        }))
      : { error: res.status };
    listados.set(conversationId, valor);
    return valor;
  }

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

(soloAutoprueba ? Promise.resolve(autoprueba()) : main())
  .then((codigo) => process.exit(codigo))
  .catch((err) => {
    console.error("\nError inesperado:", err);
    process.exit(3);
  });
