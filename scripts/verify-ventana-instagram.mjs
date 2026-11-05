#!/usr/bin/env node
/**
 * F40 (S9, tramo A): la ventana de conversación de Instagram, contra
 * PRODUCCIÓN, en un espacio fantasma que este script crea y borra. Nunca en el
 * espacio real: cada id lo crea el script y las funciones reciben el id del
 * espacio fantasma. Ninguna llamada a Zernio, Evolution, Resend ni Meta: los
 * avisos van a nuestros receptores, firmados con los secretos del espacio
 * fantasma, desde los fixtures reales anonimizados de `lib/fixtures/`; y el
 * espacio fantasma no tiene clave de Zernio en Vault (`getZernioApiKey` no
 * tiene respaldo en el entorno, lib/vault.ts:193-198), así que el envío se
 * corta antes de llamar al proveedor.
 *
 * LO QUE PRUEBA:
 *   C  Los campos `window_expires_at` y `window_source` existen en `conversations`.
 *   R  El receptor de Zernio la recalcula con cada mensaje del lead: 24 horas
 *      desde la hora de Meta (`sentAt`), no desde la recepción. Un echo no la
 *      mueve; un mensaje del lead más viejo que llega después no la atrasa; uno
 *      más nuevo la adelanta; un `sentAt` en el futuro no la alarga.
 *   W  WhatsApp por Evolution: los campos existen y quedan en null.
 *   F  El filtro `ventana` de `bandeja_filtrada` (abierta, por vencer,
 *      cerrada), con el reloj fijo, como el Owner y como el Member, más las
 *      cantidades, la ruta de la lista y la página («Filtros · 1»). WhatsApp no
 *      aparece en ninguna opción.
 *   E  El envío (`POST /api/v1/messages`): con la ventana cerrada, 409
 *      `ventana_cerrada` sin llegar al proveedor; control positivo: con la
 *      ventana abierta pasa la comprobación y se corta en la clave que falta
 *      (400 «API key not configured»). El Member: 409 en la suya, 403 en la
 *      ajena.
 *
 * QUÉ CAMBIA CADA PASO. En R cada aviso escribe y se lee enseguida, antes del
 * siguiente. Lo que se comprueba por ausencia («no la movió») va después de
 * probar la presencia (la ventana quedó en T + 24 h); si la presencia falló,
 * es no concluyente. En F y E la preparación escribe primero (las ventanas, con
 * la clave de servicio) y después solo se lee; el envío rechazado no guarda
 * nada, y se comprueba.
 *
 * LOS ROJOS (antes de construir): las columnas no existen, así que la fila no
 * las trae (C, por su motivo) y lo que depende de ellas es no concluyente o
 * falla por valor; la clave `ventana` se ignora, así que cada filtro trae lo
 * que no tendría que traer; y el envío con la ventana cerrada pasa de largo
 * hasta la clave (400), en vez de 409.
 *
 * Uso: node scripts/verify-ventana-instagram.mjs
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { admin, catalogo, check, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcAdmin, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const INSTANCIA = `v-ventana-${sufijo}`;
const SECRETO_WA = randomBytes(32).toString("hex");
const SECRETO_IG = randomBytes(32).toString("hex");
const CUENTA = `vventana${randomUUID().replace(/-/g, "").slice(0, 14)}`;
const base = String(Date.now()).slice(-6);
const eventosZernio = [];
const H = 60 * 60 * 1000;

const filas = async (path) => (await admin(path)).data ?? [];
let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);
const ms = (v) => (v == null ? null : new Date(v).getTime());
const iso = (n) => new Date(n).toISOString();

// ── Avisos firmados ─────────────────────────────────────────────────────────

const FIXTURE_RECIBIDO = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-received.json", import.meta.url), "utf8")).payload;
const FIXTURE_ENVIADO = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-sent.json", import.meta.url), "utf8")).payload;

/** Un aviso de Zernio desde el fixture real, con el `sentAt` que se pida. */
async function avisoIg(tipo, { lead, sentAt }) {
  const id = `v-ventana-evt-${randomUUID()}`;
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
  aviso.message.platformMessageId = `mid-${randomUUID()}`;
  aviso.message.sentAt = sentAt;
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

/** Un mensaje del lead con la forma de `prepareMessage` (whatsapp.baileys.service.ts:4652-4704 de 2.3.7). */
async function avisoWa(tel) {
  const data = {
    key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe: false, id: `V${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`, addressingMode: "pn" },
    pushName: "Lead de prueba",
    message: { conversation: "mensaje del lead" },
    messageType: "conversation",
    messageTimestamp: Math.floor(Date.now() / 1000),
    contextInfo: null,
    source: "android",
  };
  const res = await fetch(`${APP_URL}/api/webhooks/evolution`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await firmaEvolution()}` },
    body: JSON.stringify({ event: "messages.upsert", instance: INSTANCIA, data, date_time: new Date().toISOString() }),
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
async function enviar(u, espacio, conversationId) {
  const res = await fetch(`${APP_URL}/api/v1/messages`, {
    method: "POST",
    headers: { Cookie: cookieDe(u, espacio), "Content-Type": "application/json", Origin: APP_URL },
    body: JSON.stringify({ conversationId, text: `v-ventana ${sufijo}` }),
    redirect: "manual",
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}
async function pagina(u, espacio, ruta) {
  const res = await fetch(`${APP_URL}${ruta}`, { headers: { Cookie: cookieDe(u, espacio) }, redirect: "manual" });
  return { status: res.status, html: (await res.text()).replace(/<!-- -->/g, "") };
}
async function rutaLista(u, espacio, params) {
  const res = await fetch(`${APP_URL}/api/v1/conversations?estado=all&${params}`, { headers: { Cookie: cookieDe(u, espacio) }, redirect: "manual" });
  const cuerpo = await res.json().catch(() => null);
  return { ok: res.status === 200 && Array.isArray(cuerpo?.conversaciones), status: res.status, ids: (cuerpo?.conversaciones ?? []).map((c) => c.id) };
}

// ── Lecturas ────────────────────────────────────────────────────────────────

async function conversacionDe(canal, senderId) {
  const cc = (await filas(`contact_channels?select=contact_id&channel_id=eq.${canal}&platform_sender_id=eq.${encodeURIComponent(senderId)}`))[0];
  if (!cc) return null;
  return (await filas(`conversations?select=*&channel_id=eq.${canal}&contact_id=eq.${cc.contact_id}`))[0] ?? null;
}

const FUNCION = "bandeja_pagina_filtros?order=last_message_at.desc.nullslast,id.desc";
async function laBase(token, espacio, filtros) {
  const r = await rpcComo(token, FUNCION, { p_workspace: espacio, p_estado: "all", p_filtros: filtros, p_antes_orden: null, p_antes_id: null, p_limite: 200, p_id: null });
  return { ok: r.status === 200 && Array.isArray(r.data), status: r.status, ids: Array.isArray(r.data) ? r.data.map((c) => c.id) : [], detalle: JSON.stringify(r.data).slice(0, 200) };
}
const det = (r) => `HTTP ${r.status} · ${r.ids.length} ids ${r.detalle ?? ""}`;

/** Presencia y después ausencia: «no está» solo significa algo si antes llegó lo que tiene que estar. */
function presenciaYAusencia(r, quien, presentes, ausentes) {
  const ok = check(r.ok && presentes.every(([id]) => r.ids.includes(id)), `${quien}: llegan ${presentes.map((p) => p[1]).join(", ")} (presencia)`, det(r));
  for (const [id, nombre] of ausentes) {
    if (!ok) noConcluyente(`${quien}: no llega ${nombre}`, "falló la presencia");
    else check(!r.ids.includes(id), `${quien}: no llega ${nombre}`, det(r));
  }
  return ok;
}

let espacioFantasma = null;
let usuariosFantasma = [];

async function principal() {
  const owner = await crearUsuario("ventana-owner");
  const member = await crearUsuario("ventana-member");
  usuariosFantasma = [owner.id, member.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, member, "member");
  await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ webhook_secret: SECRETO_IG, zona_horaria: "America/Costa_Rica", name: `V ventana ${sufijo}` }) });
  console.log(`Espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  try {
    const g = await rpcAdmin("store_secret", { secret_name: "evolution_webhook_secret", secret_value: SECRETO_WA, workspace_id: espacio });
    if (g.status >= 300) throw new Error(`no se pudo guardar el secreto de Evolution: HTTP ${g.status}`);
    const canal = async (c) => (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...c }) })).data?.[0]?.id;
    const canalIg = await canal({ platform: "instagram", provider: "zernio", late_account_id: CUENTA, username: `cuentav${sufijo}` });
    const canalWa = await canal({ platform: "whatsapp", provider: "evolution", instance_name: INSTANCIA });
    if (!canalIg || !canalWa) throw new Error("no se pudieron crear los canales fantasma");
    const claveZernio = catalogo(`select count(*)::int as n from vault.secrets where name like '%${espacio}%' and name like '%zernio%'`)[0]?.n;
    check(claveZernio === 0, "el espacio fantasma no tiene clave de Zernio en Vault (el envío no puede llegar al proveedor)", `hay ${claveZernio}`);

    // ── C y R: el receptor de Zernio ────────────────────────────────────────
    const A = `vA${base}${sufijo}`;
    const T = Date.now() - 1 * H;
    titulo("Instagram: un mensaje del lead con sentAt = hace 1 hora");
    const s1 = await avisoIg("recibido", { lead: A, sentAt: iso(T) });
    const c1 = await conversacionDe(canalIg, A);
    check(s1 === 200 && c1 !== null, "el aviso creó la conversación (presencia)", `HTTP ${s1}`);
    const hayCampos = check(c1 !== null && "window_expires_at" in c1 && "window_source" in c1, "la fila tiene window_expires_at y window_source", c1 ? Object.keys(c1).join(",") : "sin fila");
    const r1 = check(ms(c1?.window_expires_at) === T + 24 * H, "window_expires_at = sentAt + 24 h (la hora de Meta, no la de recepción)", `vino ${c1?.window_expires_at}, se esperaba ${iso(T + 24 * H)}`);
    check(c1?.window_source === "mensaje", "window_source = 'mensaje'", `vino ${c1?.window_source}`);

    titulo("Instagram: un echo del negocio, ahora, no la mueve");
    const s2 = await avisoIg("enviado", { lead: A, sentAt: iso(Date.now()) });
    const c2 = await conversacionDe(canalIg, A);
    if (!r1) noConcluyente("el echo no movió la ventana", "falló la presencia (paso 1)");
    else check(s2 === 200 && ms(c2?.window_expires_at) === T + 24 * H, "el echo no movió la ventana", `HTTP ${s2} · ${c2?.window_expires_at}`);

    titulo("Instagram: un mensaje del lead más viejo (hace 3 horas), que llega después, no la atrasa");
    const s3 = await avisoIg("recibido", { lead: A, sentAt: iso(T - 2 * H) });
    const c3 = await conversacionDe(canalIg, A);
    if (!r1) noConcluyente("el mensaje viejo no la atrasó", "falló la presencia (paso 1)");
    else check(s3 === 200 && ms(c3?.window_expires_at) === T + 24 * H, "el mensaje viejo no la atrasó", `HTTP ${s3} · ${c3?.window_expires_at}`);

    titulo("Instagram: un mensaje del lead más nuevo (hace 10 minutos) la adelanta");
    const T2 = Date.now() - 10 * 60 * 1000;
    const s4 = await avisoIg("recibido", { lead: A, sentAt: iso(T2) });
    const c4 = await conversacionDe(canalIg, A);
    check(s4 === 200 && ms(c4?.window_expires_at) === T2 + 24 * H, "window_expires_at = el nuevo sentAt + 24 h", `HTTP ${s4} · vino ${c4?.window_expires_at}, se esperaba ${iso(T2 + 24 * H)}`);

    titulo("Instagram: un sentAt en el futuro (dentro de 2 horas) no la alarga");
    const B = `vB${base}${sufijo}`;
    const antes = Date.now();
    const s5 = await avisoIg("recibido", { lead: B, sentAt: iso(antes + 2 * H) });
    const despues = Date.now();
    const c5 = await conversacionDe(canalIg, B);
    const v5 = ms(c5?.window_expires_at);
    check(s5 === 200 && v5 !== null && v5 >= antes + 24 * H - 5000 && v5 <= despues + 24 * H + 5000, "vence a las 24 h de la recepción, no a las 26", `HTTP ${s5} · vino ${c5?.window_expires_at}`);

    // ── W: WhatsApp ─────────────────────────────────────────────────────────
    titulo("WhatsApp por Evolution: un mensaje del lead deja los campos en null");
    const tel = `50685${base}`;
    const s6 = await avisoWa(tel);
    const c6 = await conversacionDe(canalWa, `${tel}@s.whatsapp.net`);
    check(s6 === 200 && c6 !== null, "el aviso creó la conversación de WhatsApp (presencia)", `HTTP ${s6}`);
    if (!hayCampos) noConcluyente("WhatsApp: window_expires_at y window_source en null", "las columnas no existen (paso 1)");
    else check(c6 !== null && "window_expires_at" in c6 && c6.window_expires_at === null && c6.window_source === null, "WhatsApp: los campos existen y quedan en null", JSON.stringify({ v: c6?.window_expires_at, s: c6?.window_source }));

    // ── F: el filtro ────────────────────────────────────────────────────────
    titulo("Preparación del filtro y del envío: cinco conversaciones, con el reloj fijo");
    const AHORA = Date.now();
    const nueva = async (nombre, canalId, plataforma, setter, ventana) => {
      const c = (await crearContacto(espacio, { display_name: `v-ventana-${nombre}-${sufijo}`, setter_id: setter })).id;
      const conv = (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canalId, contact_id: c, platform: plataforma, historial_estado: "completo", status: "open", late_conversation_id: plataforma === "instagram" ? `vlate-${nombre}-${sufijo}` : null, last_message_at: iso(AHORA - 60000) }) })).data?.[0]?.id;
      if (!conv) throw new Error(`no se pudo crear la conversación ${nombre}`);
      let fijada = false;
      if (ventana !== undefined) {
        const p = await admin(`conversations?id=eq.${conv}`, { method: "PATCH", body: JSON.stringify({ window_expires_at: ventana === null ? null : iso(ventana), window_source: ventana === null ? null : "mensaje" }) });
        fijada = p.status < 300;
      }
      return { id: conv, contacto: c, fijada };
    };
    const ABIERTA = await nueva("abierta", canalIg, "instagram", member.id, AHORA + 10 * H);
    const POR_VENCER = await nueva("porvencer", canalIg, "instagram", null, AHORA + 1 * H);
    const CERRADA = await nueva("cerrada", canalIg, "instagram", member.id, AHORA - 1 * H);
    const NULA = await nueva("nula", canalIg, "instagram", null, null);
    const WA = await nueva("wa", canalWa, "whatsapp", null, AHORA + 10 * H);
    check([ABIERTA, POR_VENCER, CERRADA, NULA, WA].every((x) => x.fijada), "las ventanas quedaron fijadas (preparación, con la clave de servicio)");

    const f = (ventana) => ({ ventana, ahora: iso(AHORA) });
    const nombres = { [ABIERTA.id]: "ABIERTA", [POR_VENCER.id]: "POR_VENCER", [CERRADA.id]: "CERRADA", [NULA.id]: "NULA", [WA.id]: "WA" };
    const par = (x) => [x.id, nombres[x.id]];

    titulo("bandeja_filtrada, como el Owner, con el reloj fijo");
    presenciaYAusencia(await laBase(owner.token, espacio, f("abierta")), "«abierta», Owner", [par(ABIERTA), par(POR_VENCER)], [par(CERRADA), par(NULA), par(WA)]);
    presenciaYAusencia(await laBase(owner.token, espacio, f("por_vencer")), "«por vencer», Owner", [par(POR_VENCER)], [par(ABIERTA), par(CERRADA), par(NULA), par(WA)]);
    presenciaYAusencia(await laBase(owner.token, espacio, f("cerrada")), "«cerrada», Owner", [par(CERRADA), par(NULA)], [par(ABIERTA), par(POR_VENCER), par(WA)]);
    const cant = await rpcComo(owner.token, "bandeja_cantidades_filtros", { p_workspace: espacio, p_filtros: f("cerrada") });
    const fila = Array.isArray(cant.data) ? cant.data[0] : null;
    check(cant.status === 200 && fila !== null && Number(fila.todas) === 2, "las cantidades con «cerrada» cuentan 2 en «Todas» (CERRADA y NULA)", `HTTP ${cant.status} · ${JSON.stringify(cant.data)}`);

    titulo("bandeja_filtrada, como el Member: solo lo suyo");
    presenciaYAusencia(await laBase(member.token, espacio, f("abierta")), "«abierta», Member", [par(ABIERTA)], [par(POR_VENCER), par(CERRADA), par(WA)]);
    presenciaYAusencia(await laBase(member.token, espacio, f("cerrada")), "«cerrada», Member", [par(CERRADA)], [par(NULA), par(ABIERTA)]);

    titulo("La ruta de la lista y la página, con ?ventana= en la dirección");
    presenciaYAusencia(await rutaLista(owner, espacio, "ventana=por-vencer"), "ruta, «por vencer», Owner", [par(POR_VENCER)], [par(ABIERTA), par(CERRADA), par(NULA), par(WA)]);
    const pg = await pagina(owner, espacio, "/dashboard/inbox?estado=all&ventana=cerrada");
    check(pg.status === 200 && pg.html.includes("Filtros · 1"), "con ?ventana=cerrada, el botón dice «Filtros · 1»", `HTTP ${pg.status}`);
    check(pg.html.includes("Ventana de Instagram"), "el panel tiene el grupo «Ventana de Instagram»");

    // ── E: el envío ─────────────────────────────────────────────────────────
    titulo("El envío desde la bandeja, como el Owner");
    const e1 = await enviar(owner, espacio, CERRADA.id);
    check(e1.status === 409 && e1.cuerpo?.code === "ventana_cerrada", "ventana cerrada: 409 ventana_cerrada", `HTTP ${e1.status} · ${JSON.stringify(e1.cuerpo)}`);
    const e2 = await enviar(owner, espacio, NULA.id);
    check(e2.status === 409 && e2.cuerpo?.code === "ventana_cerrada", "sin ningún mensaje del lead (ventana en null): 409 ventana_cerrada", `HTTP ${e2.status} · ${JSON.stringify(e2.cuerpo)}`);
    const e3 = await enviar(owner, espacio, ABIERTA.id);
    check(e3.status === 400 && e3.cuerpo?.error === "API key not configured", "control positivo: con la ventana abierta pasa la comprobación y se corta en la clave que falta", `HTTP ${e3.status} · ${JSON.stringify(e3.cuerpo)}`);
    const e4 = await enviar(owner, espacio, WA.id);
    check(e4.status !== 409, "WhatsApp no se corta por ventana", `HTTP ${e4.status} · ${JSON.stringify(e4.cuerpo)}`);
    const guardados = await filas(`messages?select=id&conversation_id=in.(${CERRADA.id},${NULA.id})`);
    if (e1.status === 409 && e2.status === 409) check(guardados.length === 0, "el envío rechazado no guardó ningún mensaje", `hay ${guardados.length}`);
    else noConcluyente("el envío rechazado no guardó ningún mensaje", "no hubo rechazo");

    titulo("El envío, como el Member");
    const m1 = await enviar(member, espacio, CERRADA.id);
    check(m1.status === 409 && m1.cuerpo?.code === "ventana_cerrada", "la suya, cerrada: 409 ventana_cerrada", `HTTP ${m1.status} · ${JSON.stringify(m1.cuerpo)}`);
    const m2 = await enviar(member, espacio, POR_VENCER.id);
    check(m2.status === 403 && m2.cuerpo?.code === "fuera_de_scope", "una ajena: 403 fuera_de_scope (el alcance va antes que la ventana)", `HTTP ${m2.status} · ${JSON.stringify(m2.cuerpo)}`);
    const m3 = await enviar(member, espacio, ABIERTA.id);
    check(m3.status === 400 && m3.cuerpo?.error === "API key not configured", "control positivo: la suya, abierta, pasa la comprobación", `HTTP ${m3.status} · ${JSON.stringify(m3.cuerpo)}`);
  } finally {
    await rpcAdmin("delete_secret", { secret_name: "evolution_webhook_secret", workspace_id: espacio });
    for (const id of eventosZernio) await admin(`webhook_events?event_id=eq.${id}`, { method: "DELETE" });
    await admin(`webhook_events?event_id=like.evolution:${INSTANCIA}:*`, { method: "DELETE" });
    const r = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(r.status < 300, "se borran los contactos del espacio fantasma", `HTTP ${r.status}`);
    limpiar.contactos.length = 0;
  }
}

await correr(principal, async () => {
  if (!espacioFantasma) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => (await filas(path)).length;
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`conversations?select=id&workspace_id=in.(${ids})`)) === 0, "conversations: 0");
  check((await cuenta(`channels?select=id&workspace_id=in.(${ids})`)) === 0, "channels: 0");
  check((await cuenta(`webhook_events?select=event_id&event_id=like.v-ventana-evt-*`)) === 0, "webhook_events de Zernio: 0");
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
