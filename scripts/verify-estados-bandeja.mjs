#!/usr/bin/env node
/**
 * F35, tramo D de S8: los estados de la conversación y los no leídos, contra
 * PRODUCCIÓN, en espacios fantasma que este script crea y borra. Nunca en el
 * espacio real. Ninguna llamada a Zernio ni a Evolution: los canales son filas
 * de la base y los avisos los firma este script con los secretos del espacio
 * fantasma, como `verify-entre-canales.mjs` (Zernio: HMAC-SHA256 de
 * `workspaces.webhook_secret`, desde los fixtures reales anonimizados de
 * `lib/fixtures/`; Evolution: JWT HS256, con la forma 2.3.7 de `prepareMessage`).
 *
 * LO QUE PRUEBA (los criterios del tramo D):
 *   Z1-Z5 Instagram: una conversación que nace de un mensaje del negocio nace
 *         cerrada y con 0 no leídos; lo que escribe el negocio no la abre; el
 *         lead la abre y cada mensaje suyo suma uno (1, 2, 3); el mismo mensaje
 *         con otro id de evento no suma.
 *   Z6    El lead escribe por Instagram y se abren TODAS sus conversaciones
 *         cerradas del espacio (también la de WhatsApp).
 *   E1-E4 Lo mismo por Evolution, más `send.message` y `messages.set` sobre una
 *         cerrada, que no la abren.
 *   R     Realtime, con el token del Owner y canario primero: la que nace
 *         cerrada llega como INSERT con `status=closed`, y la reapertura por un
 *         mensaje del lead llega como UPDATE con `status=open`.
 *   P     La ruta de estado (`PATCH /api/v1/conversations/[id]`): cierra y
 *         reabre; con el seguimiento de hoy o vencido responde 409 y no cierra;
 *         con el de mañana cierra; el Member cierra la suya y no la ajena.
 *   F     `reabrir_por_seguimiento` con el reloj fijo, 30 días adelante para
 *         que la tarea real no pueda tocar esas fechas: «mañana aparece mañana
 *         en Abiertas»; no toca la del seguimiento nulo, la eliminada, la abierta
 *         ni la de otro espacio; Kiritimati como control de la zona.
 *   T     (fase aparte, `--tarea`) la tarea REAL de producción: una cerrada con
 *         seguimiento de hoy se reabre sola, y la de mañana no.
 *
 * QUÉ CAMBIA CADA PASO. Cada aviso escribe; se lee enseguida, antes del
 * siguiente. Lo que se comprueba por ausencia («sigue cerrada», «no sumó») va
 * después de leer la presencia (la conversación existe, el mensaje se guardó).
 * Las fechas de F están 30 días adelante: la tarea real, con el reloj de verdad,
 * no las reabre en el medio. En F se compara lo que DEVOLVIÓ la función.
 *
 * Uso: node scripts/verify-estados-bandeja.mjs           (todo menos T)
 *      node scripts/verify-estados-bandeja.mjs --tarea   (solo T; espera hasta 12 min)
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { admin, catalogo, check, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcAdmin, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const SOLO_TAREA = process.argv.includes("--tarea");
const INSTANCIA = `d-estados-${sufijo}`;
const SECRETO_WA = randomBytes(32).toString("hex");
const SECRETO_IG = randomBytes(32).toString("hex");
const CUENTA = `destados${randomUUID().replace(/-/g, "").slice(0, 14)}`;
const base = String(Date.now()).slice(-6);
const eventosZernio = [];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarHasta(condicion, limiteMs, pasoMs = 300) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    if (await condicion()) return true;
    await esperar(pasoMs);
  }
  return Boolean(await condicion());
}
const filas = async (path) => (await admin(path)).data ?? [];
let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

/** Hoy, como AAAA-MM-DD, en una zona. */
const hoyEn = (zona, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
function masDias(fecha, n) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Un instante: esa fecha a esa hora de Costa Rica (UTC-6, sin horario de verano). */
const enCostaRica = (fecha, hora) => new Date(`${fecha}T${hora}:00-06:00`).toISOString();

// ── Avisos firmados ─────────────────────────────────────────────────────────

const FIXTURE_RECIBIDO = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-received.json", import.meta.url), "utf8")).payload;
const FIXTURE_ENVIADO = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-sent.json", import.meta.url), "utf8")).payload;

/**
 * Un aviso de Zernio desde el fixture real. Se cambia solo lo necesario: el id
 * del evento (único, o el que se pase para repetir uno), la cuenta del canal
 * fantasma, el lead (los dos campos iguales, como en el original) y el id del
 * mensaje (único, o el que se pase para repetir el mismo mensaje).
 */
async function avisoIg(tipo, { lead, mensaje, evento } = {}) {
  const id = evento ?? `d-estados-evt-${randomUUID()}`;
  eventosZernio.push(id);
  const aviso = structuredClone(tipo === "recibido" ? FIXTURE_RECIBIDO : FIXTURE_ENVIADO);
  aviso.id = id;
  aviso.account.id = CUENTA;
  aviso.conversation.participantId = lead;
  aviso.conversation.platformConversationId = lead;
  aviso.conversation.participantUsername = `lead.${lead}`;
  if (tipo === "recibido") {
    aviso.message.sender.id = lead;
    aviso.message.sender.username = `lead.${lead}`;
  }
  aviso.message.platformMessageId = mensaje ?? `mid-${randomUUID()}`;
  const cuerpo = JSON.stringify(aviso);
  const res = await fetch(`${APP_URL}/api/webhooks/late`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-late-signature": createHmac("sha256", SECRETO_IG).update(cuerpo).digest("hex") },
    body: cuerpo,
  });
  return res.status;
}

async function firmaEvolution() {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 600)
    .sign(new TextEncoder().encode(SECRETO_WA));
}

/** Un mensaje con la forma de `prepareMessage` (whatsapp.baileys.service.ts:4652-4704 de 2.3.7). */
const mensajeWa = ({ tel, id, fromMe }) => ({
  key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe, id, addressingMode: "pn" },
  pushName: fromMe ? "Negocio" : "Lead de prueba",
  message: { conversation: fromMe ? "mensaje del negocio" : "mensaje del lead" },
  messageType: "conversation",
  messageTimestamp: Math.floor(Date.now() / 1000),
  contextInfo: null,
  source: "android",
});
async function avisoWa(evento, data) {
  const res = await fetch(`${APP_URL}/api/webhooks/evolution`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await firmaEvolution()}` },
    body: JSON.stringify({ event: evento, instance: INSTANCIA, data, date_time: new Date().toISOString() }),
  });
  return res.status;
}

// ── Sesión de la app ────────────────────────────────────────────────────────

/** La cookie como la arma `@supabase/ssr` 0.8.0, más la del espacio elegido. */
function cookieDe(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacio}`);
  return partes.join("; ");
}
async function cambiarEstado(u, espacio, conversacion, estado) {
  const res = await fetch(`${APP_URL}/api/v1/conversations/${conversacion}`, {
    method: "PATCH",
    headers: { Cookie: cookieDe(u, espacio), "Content-Type": "application/json", Origin: APP_URL },
    body: JSON.stringify({ estado }),
    redirect: "manual",
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}
async function abiertasDeLaLista(u, espacio) {
  const res = await fetch(`${APP_URL}/api/v1/conversations?estado=open&q=`, { headers: { Cookie: cookieDe(u, espacio) }, redirect: "manual" });
  const cuerpo = await res.json().catch(() => null);
  return res.status === 200 && Array.isArray(cuerpo?.conversaciones) ? cuerpo.conversaciones.map((c) => c.id) : null;
}

// ── Lecturas ────────────────────────────────────────────────────────────────

const conversacion = async (id) => (await filas(`conversations?select=id,status,unread_count&id=eq.${id}`))[0] ?? null;
async function conversacionDe(canal, senderId) {
  const cc = (await filas(`contact_channels?select=contact_id&channel_id=eq.${canal}&platform_sender_id=eq.${encodeURIComponent(senderId)}`))[0];
  if (!cc) return null;
  return (await filas(`conversations?select=id,status,unread_count,contact_id&channel_id=eq.${canal}&contact_id=eq.${cc.contact_id}`))[0] ?? null;
}
const entrantes = async (conv) => (await filas(`messages?select=id&conversation_id=eq.${conv}&direction=eq.inbound`)).length;
const cerrar = (id) => admin(`conversations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });

let espacioFantasma = null;
let usuariosFantasma = [];

async function principal() {
  const owner = await crearUsuario("estados-owner");
  const member = await crearUsuario("estados-member");
  const otro = await crearUsuario("estados-k");
  usuariosFantasma = [owner.id, member.id, otro.id];
  const espacio = owner.espacio;
  const espacioK = otro.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, member, "member");
  await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ webhook_secret: SECRETO_IG, zona_horaria: "America/Costa_Rica", name: `D estados ${sufijo}` }) });
  await admin(`workspaces?id=eq.${espacioK}`, { method: "PATCH", body: JSON.stringify({ zona_horaria: "Pacific/Kiritimati", name: `D estados K ${sufijo}` }) });
  console.log(`Espacio ${espacio.slice(0, 8)} (Costa Rica), espacio K ${espacioK.slice(0, 8)} (Kiritimati), Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  try {
    const g = await rpcAdmin("store_secret", { secret_name: "evolution_webhook_secret", secret_value: SECRETO_WA, workspace_id: espacio });
    if (g.status >= 300) throw new Error(`no se pudo guardar el secreto de Evolution: HTTP ${g.status}`);
    const canal = async (c) => (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...c }) })).data?.[0]?.id;
    const canalIg = await canal({ platform: "instagram", provider: "zernio", late_account_id: CUENTA, username: `cuentad${sufijo}` });
    const canalWa = await canal({ platform: "whatsapp", provider: "evolution", instance_name: INSTANCIA });
    if (!canalIg || !canalWa) throw new Error("no se pudieron crear los canales fantasma");

    // ── Instagram ───────────────────────────────────────────────────────────
    const A = `igA${base}${sufijo}`;
    titulo("Instagram: un mensaje del negocio a alguien nuevo crea la conversación cerrada");
    const s1 = await avisoIg("enviado", { lead: A });
    let cA = await conversacionDe(canalIg, A);
    check(s1 === 200 && cA !== null, "el aviso del negocio creó el contacto y la conversación (presencia)", `HTTP ${s1}`);
    check(cA?.status === "closed", "nace cerrada", `status=${cA?.status}`);
    check(cA?.unread_count === 0, "con 0 no leídos", `unread=${cA?.unread_count}`);

    titulo("Instagram: otro mensaje del negocio no la abre");
    const s2 = await avisoIg("enviado", { lead: A });
    cA = await conversacionDe(canalIg, A);
    const salientesA = (await filas(`messages?select=id&conversation_id=eq.${cA?.id}&direction=eq.outbound`)).length;
    check(s2 === 200 && salientesA === 2, "el segundo mensaje del negocio se guardó (presencia)", `HTTP ${s2}, salientes=${salientesA}`);
    check(cA?.status === "closed", "sigue cerrada", `status=${cA?.status}`);
    check(cA?.unread_count === 0, "sigue con 0 no leídos", `unread=${cA?.unread_count}`);

    titulo("Instagram: el lead escribe tres veces; la abre y cada mensaje suma uno");
    let ultimoMid = null;
    for (const esperado of [1, 2, 3]) {
      ultimoMid = `mid-${randomUUID()}`;
      const s = await avisoIg("recibido", { lead: A, mensaje: ultimoMid });
      const c = await conversacion(cA.id);
      const n = await entrantes(cA.id);
      check(s === 200 && n === esperado, `mensaje del lead ${esperado} guardado (presencia)`, `HTTP ${s}, entrantes=${n}`);
      check(c?.status === "open", `después del mensaje ${esperado}, abierta`, `status=${c?.status}`);
      check(c?.unread_count === esperado, `después del mensaje ${esperado}, ${esperado} no leído(s)`, `unread=${c?.unread_count}`);
    }

    titulo("Instagram: el mismo mensaje con otro id de evento no suma");
    const s4 = await avisoIg("recibido", { lead: A, mensaje: ultimoMid });
    const c4 = await conversacion(cA.id);
    const n4 = await entrantes(cA.id);
    check(s4 === 200 && n4 === 3, "el receptor lo aceptó y no guardó otro mensaje", `HTTP ${s4}, entrantes=${n4}`);
    check(c4?.unread_count === 3, "los no leídos siguen en 3", `unread=${c4?.unread_count}`);

    titulo("Instagram: cerrada, un mensaje del negocio no la abre");
    await cerrar(cA.id);
    check((await conversacion(cA.id))?.status === "closed", "quedó cerrada (preparación, leída)");
    const s5 = await avisoIg("enviado", { lead: A });
    const salientes5 = (await filas(`messages?select=id&conversation_id=eq.${cA.id}&direction=eq.outbound`)).length;
    check(s5 === 200 && salientes5 === 3, "el mensaje del negocio se guardó (presencia)", `HTTP ${s5}, salientes=${salientes5}`);
    check((await conversacion(cA.id))?.status === "closed", "sigue cerrada");

    titulo("Un contacto con conversación por Instagram y por WhatsApp: escribe por Instagram y se abren las dos");
    const B = `igB${base}${sufijo}`;
    const telB = `50681${base}`;
    const cB = (await crearContacto(espacio, { display_name: `d-estados-B-${sufijo}` })).id;
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: cB, channel_id: canalIg, platform_sender_id: B, raw_jid: B }) });
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: cB, channel_id: canalWa, platform_sender_id: `${telB}@s.whatsapp.net`, raw_jid: `${telB}@s.whatsapp.net` }) });
    const convNueva = async (canalId, plataforma, contacto, campos = {}) =>
      (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canalId, contact_id: contacto, platform: plataforma, historial_estado: "completo", status: "closed", ...campos }) })).data?.[0]?.id;
    const bIg = await convNueva(canalIg, "instagram", cB);
    const bWa = await convNueva(canalWa, "whatsapp", cB);
    const antesB = [await conversacion(bIg), await conversacion(bWa)];
    check(antesB.every((c) => c?.status === "closed"), "las dos están cerradas (preparación, leída)");
    const s6 = await avisoIg("recibido", { lead: B });
    check(s6 === 200 && (await entrantes(bIg)) === 1, "el mensaje del lead se guardó en la de Instagram (presencia)", `HTTP ${s6}`);
    check((await conversacion(bIg))?.status === "open", "la de Instagram se abrió");
    check((await conversacion(bWa))?.status === "open", "la de WhatsApp también se abrió (todas las del contacto)");

    // ── WhatsApp ────────────────────────────────────────────────────────────
    const telC = `50682${base}`;
    const jidC = `${telC}@s.whatsapp.net`;
    titulo("WhatsApp: un mensaje del negocio desde el teléfono (fromMe) crea la conversación cerrada");
    const e1 = await avisoWa("messages.upsert", mensajeWa({ tel: telC, id: `DEST1${sufijo}`, fromMe: true }));
    let cC = await conversacionDe(canalWa, jidC);
    check(e1 === 200 && cC !== null, "el aviso creó el contacto y la conversación (presencia)", `HTTP ${e1}`);
    check(cC?.status === "closed", "nace cerrada", `status=${cC?.status}`);
    check(cC?.unread_count === 0, "con 0 no leídos", `unread=${cC?.unread_count}`);

    titulo("WhatsApp: el lead escribe tres veces; la abre y cada mensaje suma uno");
    for (const esperado of [1, 2, 3]) {
      const s = await avisoWa("messages.upsert", mensajeWa({ tel: telC, id: `DESTL${esperado}${sufijo}`, fromMe: false }));
      const c = await conversacion(cC.id);
      const n = await entrantes(cC.id);
      check(s === 200 && n === esperado, `mensaje del lead ${esperado} guardado (presencia)`, `HTTP ${s}, entrantes=${n}`);
      check(c?.status === "open", `después del mensaje ${esperado}, abierta`, `status=${c?.status}`);
      check(c?.unread_count === esperado, `después del mensaje ${esperado}, ${esperado} no leído(s)`, `unread=${c?.unread_count}`);
    }

    titulo("WhatsApp: cerrada, ni fromMe, ni send.message, ni el historial la abren");
    await cerrar(cC.id);
    check((await conversacion(cC.id))?.status === "closed", "quedó cerrada (preparación, leída)");
    const salientesC = async () => (await filas(`messages?select=id&conversation_id=eq.${cC.id}&direction=eq.outbound`)).length;
    const antesSal = await salientesC();
    const e4a = await avisoWa("messages.upsert", mensajeWa({ tel: telC, id: `DESTF${sufijo}`, fromMe: true }));
    check(e4a === 200 && (await salientesC()) === antesSal + 1, "el fromMe se guardó (presencia)", `HTTP ${e4a}`);
    check((await conversacion(cC.id))?.status === "closed", "después del fromMe, sigue cerrada");
    const e4b = await avisoWa("send.message", mensajeWa({ tel: telC, id: `DESTS${sufijo}`, fromMe: true }));
    check(e4b === 200 && (await salientesC()) === antesSal + 2, "el send.message se guardó (presencia)", `HTTP ${e4b}`);
    check((await conversacion(cC.id))?.status === "closed", "después del send.message, sigue cerrada");
    const e4c = await avisoWa("messages.set", [mensajeWa({ tel: telC, id: `DESTH${sufijo}`, fromMe: false })]);
    const cH = await conversacion(cC.id);
    check(e4c === 200 && (await entrantes(cC.id)) === 4, "el mensaje del historial se guardó (presencia)", `HTTP ${e4c}`);
    check(cH?.status === "closed", "después del historial, sigue cerrada", `status=${cH?.status}`);
    check(cH?.unread_count === 3, "el historial no suma no leídos", `unread=${cH?.unread_count}`);

    // ── Realtime ────────────────────────────────────────────────────────────
    titulo("Realtime, con el token del Owner: la que nace cerrada y la que el lead reabre");
    const cliente = createClient(URL_BASE, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    await cliente.realtime.setAuth(owner.token);
    const eventos = [];
    let canalRt;
    try {
      await new Promise((resolver, rechazar) => {
        canalRt = cliente
          .channel(`estados-${sufijo}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${espacio}` }, (p) =>
            eventos.push({ tipo: p.eventType, id: p.new?.id, status: p.new?.status, preview: p.new?.last_message_preview }))
          .subscribe((estado, err) => {
            if (estado === "SUBSCRIBED") resolver(true);
            if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") rechazar(err ?? new Error(estado));
          });
        setTimeout(() => rechazar(new Error("la suscripción no llegó a SUBSCRIBED")), 15000);
      });
      // El canal puede tardar en entregar después de SUBSCRIBED: el canario se
      // repite cada 3 s, hasta 30 s, cada vez con un texto nuevo.
      let vivo = false;
      for (let i = 0; i < 10 && !vivo; i++) {
        const canario = `canario ${sufijo} ${i}`;
        await admin(`conversations?id=eq.${bWa}`, { method: "PATCH", body: JSON.stringify({ last_message_preview: canario }) });
        vivo = await esperarHasta(() => eventos.some((e) => e.preview?.startsWith(`canario ${sufijo}`)), 3000);
      }
      check(vivo, "el canal de Realtime entrega eventos (canario)");
      if (!vivo) {
        noConcluyente("la que nace cerrada llega por Realtime", "el canario no llegó");
        noConcluyente("la reapertura llega por Realtime", "el canario no llegó");
      } else {
        const D = `igD${base}${sufijo}`;
        const sD = await avisoIg("enviado", { lead: D });
        const cD = await conversacionDe(canalIg, D);
        check(sD === 200 && cD !== null, "el mensaje del negocio a D creó la conversación (presencia)", `HTTP ${sD}`);
        const llegoInsert = await esperarHasta(() => eventos.some((e) => e.tipo === "INSERT" && e.id === cD?.id), 15000);
        const ins = eventos.find((e) => e.tipo === "INSERT" && e.id === cD?.id);
        check(llegoInsert && ins?.status === "closed", "llegó el INSERT de la de D, con status=closed", `llegó=${llegoInsert}, status=${ins?.status}`);
        await cerrar(cA.id);
        const cerradaA = await esperarHasta(() => eventos.some((e) => e.id === cA.id && e.status === "closed"), 15000);
        check(cerradaA, "llegó el cierre de A (preparación)");
        const desde = eventos.length;
        const sR = await avisoIg("recibido", { lead: A });
        check(sR === 200, "el lead de A volvió a escribir", `HTTP ${sR}`);
        const llegoApertura = await esperarHasta(() => eventos.slice(desde).some((e) => e.tipo === "UPDATE" && e.id === cA.id && e.status === "open"), 15000);
        check(llegoApertura, "llegó el UPDATE de A con status=open, sin recargar");
      }
    } catch (err) {
      noConcluyente("Realtime", err instanceof Error ? err.message : String(err));
    } finally {
      if (canalRt) await cliente.removeChannel(canalRt);
    }

    // ── La ruta de estado ───────────────────────────────────────────────────
    titulo("La ruta de estado: el Owner cierra y reabre");
    const hoy = hoyEn("America/Costa_Rica");
    const contactoA = (await filas(`conversations?select=contact_id&id=eq.${cA.id}`))[0]?.contact_id;
    const fijarSeguimiento = (contacto, fecha) => admin(`contacts?id=eq.${contacto}`, { method: "PATCH", body: JSON.stringify({ next_followup_date: fecha }) });
    await fijarSeguimiento(contactoA, null);
    check((await conversacion(cA.id))?.status === "open", "A está abierta (preparación, leída)");
    const p1 = await cambiarEstado(owner, espacio, cA.id, "closed");
    check(p1.status === 200 && (await conversacion(cA.id))?.status === "closed", "sin seguimiento, «Cerrar» la cierra", `HTTP ${p1.status}`);
    const p2 = await cambiarEstado(owner, espacio, cA.id, "open");
    check(p2.status === 200 && (await conversacion(cA.id))?.status === "open", "«Reabrir» la abre", `HTTP ${p2.status}`);

    titulo("La ruta de estado: con el seguimiento de hoy o vencido, pide el próximo y no cierra");
    for (const [nombre, fecha] of [["hoy", hoy], ["ayer", masDias(hoy, -1)]]) {
      await fijarSeguimiento(contactoA, fecha);
      const p = await cambiarEstado(owner, espacio, cA.id, "closed");
      check(p.status === 409 && p.cuerpo?.code === "pide_seguimiento", `con el seguimiento de ${nombre}, 409 «pide_seguimiento»`, `HTTP ${p.status} ${JSON.stringify(p.cuerpo)}`);
      check((await conversacion(cA.id))?.status === "open", `con el seguimiento de ${nombre}, sigue abierta`);
    }
    await fijarSeguimiento(contactoA, masDias(hoy, 1));
    const p3 = await cambiarEstado(owner, espacio, cA.id, "closed");
    check(p3.status === 200 && (await conversacion(cA.id))?.status === "closed", "con el seguimiento de mañana, cierra (control)", `HTTP ${p3.status}`);
    const pMal = await cambiarEstado(owner, espacio, cA.id, "snoozed");
    check(pMal.status === 400 && (await conversacion(cA.id))?.status === "closed", "un estado que no es «closed» ni «open» da 400 y no cambia nada", `HTTP ${pMal.status}`);

    titulo("La ruta de estado: el Member cierra la suya y no la ajena");
    const cM = (await crearContacto(espacio, { display_name: `d-estados-M-${sufijo}`, setter_id: member.id })).id;
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: cM, channel_id: canalIg, platform_sender_id: `igM${sufijo}`, raw_jid: `igM${sufijo}` }) });
    const mIg = await convNueva(canalIg, "instagram", cM, { status: "open" });
    const pM = await cambiarEstado(member, espacio, mIg, "closed");
    check(pM.status === 200 && (await conversacion(mIg))?.status === "closed", "el Member cierra una conversación de su alcance", `HTTP ${pM.status}`);
    await cambiarEstado(owner, espacio, cA.id, "open");
    check((await conversacion(cA.id))?.status === "open", "A está abierta (preparación, leída)");
    const pAj = await cambiarEstado(member, espacio, cA.id, "closed");
    check(pAj.status === 404 && (await conversacion(cA.id))?.status === "open", "el Member no cierra una ajena: 404, y sigue abierta", `HTTP ${pAj.status}`);

    // ── La función con el reloj fijo ────────────────────────────────────────
    titulo("reabrir_por_seguimiento con el reloj fijo: «mañana aparece mañana en Abiertas»");
    const D = masDias(hoy, 30);
    const D1 = masDias(D, 1);
    const conSeguimiento = async (nombre, fecha, enEspacio = espacio, campos = {}) => {
      const c = (await crearContacto(enEspacio, { display_name: `d-estados-${nombre}-${sufijo}`, next_followup_date: fecha })).id;
      const canalDe = enEspacio === espacio ? canalIg : null;
      let canalId = canalDe;
      if (!canalId) {
        canalId = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: enEspacio, platform: "instagram", provider: "zernio", late_account_id: `${CUENTA}k${nombre}`, username: `k${nombre}${sufijo}`, is_active: true, umbral_silencio_horas: null }) })).data?.[0]?.id;
      }
      await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: c, channel_id: canalId, platform_sender_id: `ig${nombre}${sufijo}`, raw_jid: `ig${nombre}${sufijo}` }) });
      return (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: enEspacio, channel_id: canalId, contact_id: c, platform: "instagram", historial_estado: "completo", status: "closed", ...campos }) })).data?.[0]?.id;
    };
    const f1 = await conSeguimiento("F1", D1);
    const fNulo = await conSeguimiento("FN", null);
    const fBorrada = await conSeguimiento("FB", D1, espacio, { deleted_at: new Date().toISOString() });
    const fAbierta = await conSeguimiento("FA", D1, espacio, { status: "open" });
    const fOtro = await conSeguimiento("FK", D1, espacioK);
    const preparadas = await Promise.all([f1, fNulo, fBorrada, fAbierta, fOtro].map(conversacion));
    check(preparadas.every(Boolean) && preparadas.filter((c) => c.status === "closed").length === 4, "las cinco existen, cuatro cerradas y una abierta (preparación, leída)");
    const r1 = await rpcAdmin("reabrir_por_seguimiento", { p_workspace: espacio, p_ahora: enCostaRica(D, "10:00") });
    const idsDe = (r) => (Array.isArray(r.data) ? r.data.map((x) => x?.id ?? x) : []);
    const ids1 = idsDe(r1);
    check(r1.status === 200 && Array.isArray(r1.data), "la función responde", `HTTP ${r1.status}`);
    check(r1.status === 200 && !ids1.includes(f1), "el día anterior (D a las 10:00), la de D+1 no se reabre", JSON.stringify(ids1));
    check((await conversacion(f1))?.status === "closed", "el día anterior, sigue cerrada");
    const r2 = await rpcAdmin("reabrir_por_seguimiento", { p_workspace: espacio, p_ahora: enCostaRica(D1, "08:00") });
    const ids2 = idsDe(r2);
    check(r2.status === 200 && ids2.length === 1 && ids2[0] === f1, "el día D+1 a las 08:00, devuelve solo la de D+1", JSON.stringify(ids2));
    check((await conversacion(f1))?.status === "open", "la de D+1 quedó abierta");
    const lista = await abiertasDeLaLista(owner, espacio);
    check(Array.isArray(lista) && lista.includes(f1), "y aparece en «Abiertas» por la ruta de la lista del Owner");
    check((await conversacion(fNulo))?.status === "closed", "la del seguimiento nulo sigue cerrada");
    check((await conversacion(fBorrada))?.status === "closed", "la eliminada sigue cerrada");
    check(!ids2.includes(fAbierta), "la que ya estaba abierta no se cuenta como reabierta");
    check((await conversacion(fOtro))?.status === "closed", "la del otro espacio sigue cerrada");
    const comoOwner = await rpcComo(owner.token, "reabrir_por_seguimiento", { p_workspace: espacio, p_ahora: enCostaRica(D1, "08:00") });
    check(comoOwner.status >= 400, "un usuario no la puede llamar: es solo del servidor", `HTTP ${comoOwner.status}`);

    // Va antes de Kiritimati a propósito: acá no queda en el espacio ninguna
    // cerrada con seguimiento <= D+2 (f1 ya se abrió; la del seguimiento nulo y
    // la eliminada no cuentan; A quedó abierta en la ruta), así que lo devuelto
    // tiene que ser exactamente lo de este paso. fE2 se crea después.
    titulo("reabrir_por_seguimiento: un contacto con dos conversaciones las reabre las dos");
    const D2 = masDias(D, 2);
    const D3 = masDias(D, 3);
    const dosConversaciones = async (nombre, fecha, tel) => {
      const c = (await crearContacto(espacio, { display_name: `d-estados-${nombre}-${sufijo}`, next_followup_date: fecha })).id;
      await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: c, channel_id: canalIg, platform_sender_id: `ig${nombre}${sufijo}`, raw_jid: `ig${nombre}${sufijo}` }) });
      await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: c, channel_id: canalWa, platform_sender_id: `${tel}@s.whatsapp.net`, raw_jid: `${tel}@s.whatsapp.net` }) });
      return { ig: await convNueva(canalIg, "instagram", c), wa: await convNueva(canalWa, "whatsapp", c) };
    };
    const h2 = await dosConversaciones("H2", D2, `50683${base}`);
    const m2 = await dosConversaciones("M2", D3, `50684${base}`);
    const prepDos = await Promise.all([h2.ig, h2.wa, m2.ig, m2.wa].map(conversacion));
    check(prepDos.every((c) => c?.status === "closed"), "las cuatro existen y están cerradas (preparación, leída)");
    const rDos = await rpcAdmin("reabrir_por_seguimiento", { p_workspace: espacio, p_ahora: enCostaRica(D2, "08:00") });
    const idsDos = idsDe(rDos);
    check(rDos.status === 200 && Array.isArray(rDos.data), "la función responde", `HTTP ${rDos.status}`);
    check(rDos.status === 200 && idsDos.length === 2 && idsDos.includes(h2.ig) && idsDos.includes(h2.wa), "el día D+2 a las 08:00, devuelve exactamente las dos del contacto de D+2", JSON.stringify(idsDos));
    check((await conversacion(h2.ig))?.status === "open", "la de Instagram del contacto de D+2 quedó abierta");
    check((await conversacion(h2.wa))?.status === "open", "la de WhatsApp del contacto de D+2 también quedó abierta (todas las del contacto)");
    check(!idsDos.includes(m2.ig) && !idsDos.includes(m2.wa), "ninguna del contacto de D+3 está en lo devuelto", JSON.stringify(idsDos));
    check((await Promise.all([m2.ig, m2.wa].map(conversacion))).every((c) => c?.status === "closed"), "las dos del contacto de D+3 siguen cerradas");

    titulo("reabrir_por_seguimiento: la zona del espacio (Kiritimati, 20 horas adelante)");
    const fE2 = await conSeguimiento("FE2", D1);
    check((await conversacion(fE2))?.status === "closed" && (await conversacion(fOtro))?.status === "closed", "la de Costa Rica y la de Kiritimati, cerradas (preparación, leída)");
    const ahoraK = enCostaRica(D, "18:30");
    const rK = await rpcAdmin("reabrir_por_seguimiento", { p_workspace: espacioK, p_ahora: ahoraK });
    const idsK = idsDe(rK);
    check(rK.status === 200 && idsK.length === 1 && idsK[0] === fOtro, "a las 18:30 de Costa Rica del día D, en Kiritimati ya es D+1: la reabre", JSON.stringify(idsK));
    const rE = await rpcAdmin("reabrir_por_seguimiento", { p_workspace: espacio, p_ahora: ahoraK });
    const idsE = idsDe(rE);
    check(rE.status === 200 && !idsE.includes(fE2), "a la misma hora, en Costa Rica sigue siendo D: no la reabre", JSON.stringify(idsE));
    check((await conversacion(fE2))?.status === "closed", "la de Costa Rica sigue cerrada");
  } finally {
    await rpcAdmin("delete_secret", { secret_name: "evolution_webhook_secret", workspace_id: espacio });
    for (const id of eventosZernio) await admin(`webhook_events?event_id=eq.${id}`, { method: "DELETE" });
    await admin(`webhook_events?event_id=like.evolution:${INSTANCIA}:*`, { method: "DELETE" });
    for (const w of [espacio, espacioK]) {
      const r = await admin(`contacts?workspace_id=eq.${w}`, { method: "DELETE" });
      check(r.status < 300, `se borran los contactos del espacio fantasma ${w.slice(0, 8)}`, `HTTP ${r.status}`);
    }
    limpiar.contactos.length = 0;
  }
}

/** T: la tarea real. Espera a que la corrida de producción pase por el espacio fantasma. */
async function tareaReal() {
  const owner = await crearUsuario("estados-tarea");
  usuariosFantasma = [owner.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ zona_horaria: "America/Costa_Rica", name: `D tarea ${sufijo}` }) });
  try {
    const canalIg = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, platform: "instagram", provider: "zernio", late_account_id: `${CUENTA}t`, username: `t${sufijo}`, is_active: true, umbral_silencio_horas: null }) })).data?.[0]?.id;
    const hoy = hoyEn("America/Costa_Rica");
    const nueva = async (nombre, fecha) => {
      const c = (await crearContacto(espacio, { display_name: `d-tarea-${nombre}-${sufijo}`, next_followup_date: fecha })).id;
      await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: c, channel_id: canalIg, platform_sender_id: `t${nombre}${sufijo}`, raw_jid: `t${nombre}${sufijo}` }) });
      return (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canalIg, contact_id: c, platform: "instagram", historial_estado: "completo", status: "closed" }) })).data?.[0]?.id;
    };
    titulo(`La tarea real: una cerrada con seguimiento de hoy (${hoy}) y otra de mañana`);
    const tHoy = await nueva("hoy", hoy);
    const tManana = await nueva("manana", masDias(hoy, 1));
    const preparada = new Date().toISOString();
    check((await conversacion(tHoy))?.status === "closed" && (await conversacion(tManana))?.status === "closed", "las dos existen y están cerradas (preparación, leída)");
    console.log(`  Preparado a las ${preparada}. Esperando a la tarea de producción, hasta 12 minutos…`);
    const clave = `reapertura_seguimiento:${espacio}`;
    const corrio = await esperarHasta(async () => {
      const m = (await filas(`tareas_estado?select=ultimo_ok_at&clave=eq.${clave}`))[0];
      return Boolean(m?.ultimo_ok_at && m.ultimo_ok_at > preparada);
    }, 12 * 60 * 1000, 15000);
    check(corrio, "la tarea de producción pasó por el espacio fantasma (su marca avanzó)");
    check((await conversacion(tHoy))?.status === "open", "la de hoy se reabrió sola");
    if (corrio) check((await conversacion(tManana))?.status === "closed", "la de mañana sigue cerrada");
    else noConcluyente("la de mañana sigue cerrada", "la tarea no corrió: la ausencia no prueba nada");
  } finally {
    const r = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(r.status < 300, "se borran los contactos del espacio fantasma", `HTTP ${r.status}`);
    limpiar.contactos.length = 0;
  }
}

await correr(SOLO_TAREA ? tareaReal : principal, async () => {
  if (!espacioFantasma) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => (await filas(path)).length;
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`conversations?select=id&workspace_id=in.(${ids})`)) === 0, "conversations: 0");
  check((await cuenta(`channels?select=id&workspace_id=in.(${ids})`)) === 0, "channels: 0");
  check((await cuenta(`tareas_estado?select=clave&workspace_id=in.(${ids})`)) === 0, "tareas_estado: 0");
  check((await cuenta(`webhook_events?select=event_id&event_id=like.d-estados-evt-*`)) === 0, "webhook_events de Zernio: 0");
  check((await cuenta(`webhook_events?select=event_id&event_id=like.evolution:${INSTANCIA}:*`)) === 0, "webhook_events de Evolution: 0");
  const secretos = catalogo(`select count(*)::int as n from vault.secrets where ${limpiar.workspaces.map((w) => `name like '%${w}%'`).join(" or ") || "false"}`)[0]?.n;
  check(secretos === 0, "secretos de Vault de los espacios fantasma: 0", `quedan ${secretos}`);
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log de los espacios fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
