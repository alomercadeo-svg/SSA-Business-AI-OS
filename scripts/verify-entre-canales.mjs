#!/usr/bin/env node
/**
 * F29, la detección de contacto entre canales, contra PRODUCCIÓN, en un
 * espacio fantasma que este script crea y borra. Nunca en «Ale Admin's
 * Workspace». Ninguna llamada a Zernio ni a Evolution: los canales son filas
 * de la base, los avisos los firma este script con los secretos del espacio
 * fantasma (Evolution: JWT HS256, igual que `verify-guardado-whatsapp.mjs`;
 * Zernio: HMAC-SHA256 de `workspaces.webhook_secret`), y sin clave de Zernio
 * en Vault el relleno de perfil no llama (`lib/relleno-perfil.ts:76-78`).
 *
 * LO QUE PRUEBA (los criterios de F29):
 *   1. WhatsApp, teléfono exacto: P es un lead de Instagram con teléfono; un
 *      aviso firmado de Evolution 2.3.7 desde ese número lo VINCULA: sin
 *      contacto nuevo, con su registro de canal de WhatsApp, una conversación
 *      aparte (los hilos no se mezclan) y «contacto.vinculado» del Sistema.
 *      Control: desde otro número, entra un contacto nuevo.
 *   2. Instagram, solo el usuario: Q escribió por la cuenta 1; un aviso firmado
 *      de Zernio por la cuenta 2 con el mismo usuario crea R aparte y deja la
 *      SUGERENCIA (nunca une solo). El Owner la lee; un Member sin esos leads,
 *      no. «No es la misma» la descarta y no vuelve.
 *   3. WhatsApp, conflicto de `reconciliar_telefono`: un @lid sin teléfono
 *      recibe un mensaje con el teléfono de otro contacto: queda la sugerencia
 *      «teléfono», y no se unen solos.
 *   4. La unión manual: el Owner une por la función (la misma que «Unir
 *      contactos»), las sugerencias del absorbido se van, y queda «contactos
 *      unidos» en el historial.
 *   5. El correo, SIMULADO: ningún canal trae correo al llegar. La búsqueda
 *      (`buscar_contacto_entre_canales`) se llama directo en el espacio
 *      fantasma con un correo exacto. Sus datos reales llegan con F37.
 *
 * QUÉ CAMBIA CADA PASO. Cada aviso escribe; se lee enseguida, antes del
 * siguiente. Los recuentos de contactos se toman inmediatamente antes de cada
 * aviso.
 *
 * Uso: node scripts/verify-entre-canales.mjs
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { admin, catalogo, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcAdmin, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INSTANCIA = `b3-entre-${sufijo}`;
const SECRETO_WA = randomBytes(32).toString("hex");
const SECRETO_IG = randomBytes(32).toString("hex");
const CUENTA_1 = `b3entre1${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const CUENTA_2 = `b3entre2${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const base = String(Date.now()).slice(-6);
const TEL_P = `50671${base}`; // inventados, +506 con 8 dígitos
const TEL_OTRO = `50672${base}`;
const TEL_M = `50673${base}`;
const TEL_W = `50674${base}`; // el de whatsapp_phone
const TEL_E = `50675${base}`; // el del eliminado
const LID = `${Date.now()}${randomUUID().replace(/\D/g, "").slice(0, 5)}@lid`;
const USUARIO = `b3.entre.${sufijo}`;
const eventosZernio = [];

let espacioFantasma = null;
let usuariosFantasma = [];

async function firmaEvolution() {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 600)
    .sign(new TextEncoder().encode(SECRETO_WA));
}

/** `messages.upsert` con la forma de `prepareMessage` (whatsapp.baileys.service.ts:4652-4704 de 2.3.7). */
async function avisoWa({ id, remoteJid, remoteJidAlt, addressingMode = "pn", texto }) {
  const data = {
    key: { remoteJid, fromMe: false, id, ...(remoteJidAlt ? { remoteJidAlt } : {}), addressingMode },
    pushName: "Lead de prueba",
    message: { conversation: texto },
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

/**
 * `message.received` de Zernio armado desde el fixture REAL anonimizado
 * (`lib/fixtures/zernio-webhook-message-received.json`: una entrega del log de
 * Zernio del 08/10/2026, con los valores reemplazados y las igualdades del
 * original), firmado como `lib/zernio-webhook.ts:190`. Se cambia solo lo que
 * hace falta para el espacio fantasma, y nada más:
 *   - `id`: único por entrega (el receptor descarta un id repetido por
 *     `webhook_events`, y la limpieza los busca por prefijo);
 *   - `account.id`: el `late_account_id` del canal fantasma, para que el
 *     receptor lo enrute ahí y no a un canal real;
 *   - `message.sender.id` y `conversation.participantId`: el remitente nuevo del
 *     espacio fantasma, los dos iguales, como en el original;
 *   - `message.sender.username` y `conversation.participantUsername`: el usuario
 *     que coincide con Q, los dos iguales, como en el original;
 *   - `message.platformMessageId`: único, para que un segundo mensaje no se
 *     tome por el mismo (clave única de `messages`).
 */
const FIXTURE_IG = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-received.json", import.meta.url), "utf8")).payload;
async function avisoIg({ cuenta, senderId, usuario }) {
  const id = `b3-entre-evt-${randomUUID()}`;
  eventosZernio.push(id);
  const aviso = structuredClone(FIXTURE_IG);
  aviso.id = id;
  aviso.account.id = cuenta;
  aviso.message.sender.id = senderId;
  aviso.conversation.participantId = senderId;
  aviso.message.sender.username = usuario;
  aviso.conversation.participantUsername = usuario;
  aviso.message.platformMessageId = `mid-${randomUUID()}`;
  const cuerpo = JSON.stringify(aviso);
  const res = await fetch(`${APP_URL}/api/webhooks/late`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-late-signature": createHmac("sha256", SECRETO_IG).update(cuerpo).digest("hex") },
    body: cuerpo,
  });
  return res.status;
}

const filas = async (path) => (await admin(path)).data ?? [];
let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

await correr(async () => {
  const owner = await crearUsuario("entre-owner");
  const member = await crearUsuario("entre-member");
  usuariosFantasma = [owner.id, member.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, member, "member");
  console.log(`Espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);
  const contactosDelEspacio = async () => (await filas(`contacts?select=id&workspace_id=eq.${espacio}`)).length;

  try {
    const g = await rpcAdmin("store_secret", { secret_name: "evolution_webhook_secret", secret_value: SECRETO_WA, workspace_id: espacio });
    if (g.status >= 300) throw new Error(`no se pudo guardar el secreto de Evolution: HTTP ${g.status}`);
    await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ webhook_secret: SECRETO_IG }) });
    const canal = async (c) => (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...c }) })).data?.[0]?.id;
    const canalWa = await canal({ platform: "whatsapp", provider: "evolution", instance_name: INSTANCIA });
    const canalIg1 = await canal({ platform: "instagram", provider: "zernio", late_account_id: CUENTA_1, username: `cuenta1${sufijo}` });
    const canalIg2 = await canal({ platform: "instagram", provider: "zernio", late_account_id: CUENTA_2, username: `cuenta2${sufijo}` });
    if (!canalWa || !canalIg1 || !canalIg2) throw new Error("no se pudieron crear los canales fantasma");

    // P: lead de Instagram (cuenta 1), con teléfono. Q: lead de Instagram (cuenta 1) con usuario. L: un @lid sin teléfono. M: tiene el teléfono que va a llegar con L.
    const P = (await crearContacto(espacio, { display_name: `b3-entre-P-${sufijo}`, phone: `+${TEL_P}`, phone_resolved: true })).id;
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: P, channel_id: canalIg1, platform_sender_id: `igP-${sufijo}`, raw_jid: `igP-${sufijo}` }) });
    const convPIg = (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canalIg1, contact_id: P, platform: "instagram", historial_estado: "completo" }) })).data?.[0]?.id;
    const Q = (await crearContacto(espacio, { display_name: `b3-entre-Q-${sufijo}` })).id;
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: Q, channel_id: canalIg1, platform_sender_id: `igQ-${sufijo}`, raw_jid: `igQ-${sufijo}`, platform_username: USUARIO }) });
    const L = (await crearContacto(espacio, { display_name: `b3-entre-L-${sufijo}`, phone_resolved: false })).id;
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: L, channel_id: canalWa, platform_sender_id: LID, raw_jid: LID, addressing_mode: "lid" }) });
    const M = (await crearContacto(espacio, { display_name: `b3-entre-M-${sufijo}`, phone: `+${TEL_M}`, phone_resolved: true, email: `entre-${sufijo}@ssa-test.local` })).id;
    // W: lead con el número solo en whatsapp_phone. E: lead de Instagram con teléfono, eliminado.
    const W = (await crearContacto(espacio, { display_name: `b3-entre-W-${sufijo}`, whatsapp_phone: `+${TEL_W}`, secondary_email: `segundo-${sufijo}@ssa-test.local` })).id;
    const E = (await crearContacto(espacio, { display_name: `b3-entre-E-${sufijo}`, phone: `+${TEL_E}`, phone_resolved: true })).id;
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: E, channel_id: canalIg1, platform_sender_id: `igE-${sufijo}`, raw_jid: `igE-${sufijo}` }) });
    const eE = await rpcComo(owner.token, "eliminar_contacto", { p_contacto: E });
    if (eE.status !== 200) throw new Error(`no se pudo eliminar E: HTTP ${eE.status}`);
    console.log(`  P ${P.slice(0, 8)}, Q ${Q.slice(0, 8)}, L ${L.slice(0, 8)}, M ${M.slice(0, 8)}, W ${W.slice(0, 8)}, E ${E.slice(0, 8)} (eliminado)`);

    titulo("WhatsApp, teléfono exacto: el aviso de P lo vincula, sin contacto nuevo");
    const antes1 = await contactosDelEspacio();
    const st1 = await avisoWa({ id: `B3ENTRE1${sufijo}`, remoteJid: `${TEL_P}@s.whatsapp.net`, texto: "hola, soy P por WhatsApp" });
    check(st1 === 200, "el receptor de Evolution acepta el aviso firmado", `HTTP ${st1}`);
    check((await contactosDelEspacio()) === antes1, "no se creó ningún contacto");
    const ccWa = await filas(`contact_channels?select=contact_id,raw_jid&channel_id=eq.${canalWa}&platform_sender_id=eq.${TEL_P}@s.whatsapp.net`);
    check(ccWa.length === 1 && ccWa[0].contact_id === P, "se creó el registro del canal de WhatsApp sobre P", JSON.stringify(ccWa));
    const convsP = await filas(`conversations?select=id,channel_id&contact_id=eq.${P}`);
    const convPWa = convsP.find((c) => c.channel_id === canalWa)?.id;
    check(convsP.length === 2 && convPWa && convsP.some((c) => c.id === convPIg), "P tiene dos conversaciones, una por canal: los hilos no se mezclan");
    check((await filas(`messages?select=id&conversation_id=eq.${convPWa}&platform_message_id=eq.B3ENTRE1${sufijo}`)).length === 1, "el mensaje quedó en la de WhatsApp");
    check((await filas(`messages?select=id&conversation_id=eq.${convPIg}`)).length === 0, "y no en la de Instagram");
    const audV = await filas(`audit_log?select=actor_id,actor_label,detail&entity_id=eq.${P}&action=eq.contacto.vinculado`);
    check(audV.length === 1 && audV[0].actor_label === "Sistema" && audV[0].detail?.por === "telefono" && audV[0].detail?.canal_id === canalWa, "«contacto.vinculado» del Sistema, por teléfono y con el canal", JSON.stringify(audV));

    titulo("Control: desde otro número, entra un contacto nuevo");
    const antes2 = await contactosDelEspacio();
    const st2 = await avisoWa({ id: `B3ENTRE2${sufijo}`, remoteJid: `${TEL_OTRO}@s.whatsapp.net`, texto: "soy otra persona" });
    check(st2 === 200 && (await contactosDelEspacio()) === antes2 + 1, "un contacto nuevo, sin vincular", `HTTP ${st2}`);

    titulo("WhatsApp, el número guardado en «WhatsApp» (whatsapp_phone) también vincula");
    const antesW = await contactosDelEspacio();
    const stW = await avisoWa({ id: `B3ENTREW${sufijo}`, remoteJid: `${TEL_W}@s.whatsapp.net`, texto: "soy W" });
    check(stW === 200 && (await contactosDelEspacio()) === antesW, "sin contacto nuevo", `HTTP ${stW}`);
    check((await filas(`contact_channels?select=contact_id&channel_id=eq.${canalWa}&platform_sender_id=eq.${TEL_W}@s.whatsapp.net`))[0]?.contact_id === W, "vinculado a W");

    titulo("Un lead eliminado que escribe por otro canal se restaura y se vincula (respuesta de Marcos)");
    const eliminadoAntes = Boolean((await filas(`contacts?select=deleted_at&id=eq.${E}`))[0]?.deleted_at);
    check(eliminadoAntes, "E está eliminado inmediatamente antes del aviso");
    const antesE = await contactosDelEspacio();
    const stE = await avisoWa({ id: `B3ENTREE${sufijo}`, remoteJid: `${TEL_E}@s.whatsapp.net`, texto: "volví, ahora por WhatsApp" });
    check(stE === 200 && (await contactosDelEspacio()) === antesE, "sin contacto nuevo", `HTTP ${stE}`);
    if (!eliminadoAntes) noConcluyente("E se restauró", "no estaba eliminado antes");
    else check((await filas(`contacts?select=deleted_at&id=eq.${E}`))[0]?.deleted_at === null, "E se restauró");
    check((await filas(`contact_channels?select=contact_id&channel_id=eq.${canalWa}&platform_sender_id=eq.${TEL_E}@s.whatsapp.net`))[0]?.contact_id === E, "y quedó vinculado por WhatsApp");
    const audE = await filas(`audit_log?select=action,actor_label&entity_id=eq.${E}&action=in.(contacto.restaurado,contacto.vinculado)&order=created_at`);
    check(audE.map((f) => f.action).join(",") === "contacto.restaurado,contacto.vinculado" && audE.every((f) => f.actor_label === "Sistema"), "«restaurado» y después «vinculado», del Sistema", JSON.stringify(audE));

    titulo("Instagram, solo el usuario: R se crea aparte y queda la sugerencia");
    const antes3 = await contactosDelEspacio();
    const st3 = await avisoIg({ cuenta: CUENTA_2, senderId: `igR-${sufijo}`, usuario: USUARIO });
    check(st3 === 200, "el receptor de Zernio acepta el aviso firmado", `HTTP ${st3}`);
    check((await contactosDelEspacio()) === antes3 + 1, "se creó R: por usuario no se une solo");
    const R = (await filas(`contact_channels?select=contact_id&channel_id=eq.${canalIg2}&platform_sender_id=eq.igR-${sufijo}`))[0]?.contact_id;
    const sugU = await filas(`sugerencias_union?select=id,contacto_id,otro_id,motivo,estado&contacto_id=eq.${R}`);
    check(R && sugU.length === 1 && sugU[0].otro_id === Q && sugU[0].motivo === "usuario" && sugU[0].estado === "pendiente", "la sugerencia R ↔ Q, «usuario», pendiente", JSON.stringify(sugU));
    check((await filas(`audit_log?select=id&entity_id=eq.${Q}&action=eq.contacto.vinculado`)).length === 0, "y ningún «vinculado»");
    const leeOwner = await comoUsuario(owner.token, `sugerencias_union?select=id&id=eq.${sugU[0]?.id}`);
    const ownerLa = check(leeOwner.data?.length === 1, "el Owner la lee con su token");
    const leeMember = await comoUsuario(member.token, `sugerencias_union?select=id&id=eq.${sugU[0]?.id}`);
    if (!ownerLa) noConcluyente("el Member no la lee", "el Owner tampoco la leyó");
    else check(leeMember.status === 200 && leeMember.data?.length === 0, "el Member, sin esos leads, no la lee", `HTTP ${leeMember.status}`);

    const alReves = await admin("sugerencias_union", { method: "POST", body: JSON.stringify({ workspace_id: espacio, contacto_id: Q, otro_id: R, motivo: "usuario" }) });
    check(alReves.status === 409 && (await filas(`sugerencias_union?select=id&or=(contacto_id.eq.${R},otro_id.eq.${R})`)).length === 1, "el mismo par al revés (Q,R) lo rechaza la base: una sola sugerencia por par", `HTTP ${alReves.status}`);

    titulo("«No es la misma»: se descarta y no vuelve");
    const desMember = await rpcComo(member.token, "descartar_sugerencia", { p_sugerencia: sugU[0]?.id });
    check(desMember.status >= 400 && (await filas(`sugerencias_union?select=estado&id=eq.${sugU[0]?.id}`))[0]?.estado === "pendiente", "el Member, que no ve los dos, no la descarta (releída: pendiente)", `HTTP ${desMember.status}`);
    const des = await rpcComo(owner.token, "descartar_sugerencia", { p_sugerencia: sugU[0]?.id });
    check(des.status < 300 && (await filas(`sugerencias_union?select=estado&id=eq.${sugU[0]?.id}`))[0]?.estado === "descartada", "el Owner la descarta", `HTTP ${des.status}`);
    const st4 = await avisoIg({ cuenta: CUENTA_2, senderId: `igR-${sufijo}`, usuario: USUARIO });
    check(st4 === 200 && (await filas(`sugerencias_union?select=id&or=(contacto_id.eq.${R},otro_id.eq.${R})`)).length === 1, "otro mensaje de R no la vuelve a crear");

    titulo("WhatsApp, conflicto de reconciliar_telefono: queda la sugerencia «teléfono»");
    const antes5 = await contactosDelEspacio();
    const st5 = await avisoWa({ id: `B3ENTRE5${sufijo}`, remoteJid: `${TEL_M}@s.whatsapp.net`, remoteJidAlt: LID, texto: "soy L con el teléfono de M" });
    check(st5 === 200 && (await contactosDelEspacio()) === antes5, "el aviso entra sin crear contactos", `HTTP ${st5}`);
    const sugT = await filas(`sugerencias_union?select=otro_id,motivo&contacto_id=eq.${L}`);
    check(sugT.length === 1 && sugT[0].otro_id === M && sugT[0].motivo === "telefono", "la sugerencia L ↔ M, «teléfono»", JSON.stringify(sugT));
    check((await filas(`contacts?select=phone_resolved&id=eq.${L}`))[0]?.phone_resolved === false, "L sigue sin resolver: no se unen solos");

    titulo("La unión manual: el Owner une L en M por la función de «Unir contactos»");
    const fus = await rpcComo(owner.token, "fusionar_contactos", { p_conservar: M, p_absorber: L });
    check(fus.status === 200 && fus.data?.resultado === "fusionado", "el Owner une L en M", `HTTP ${fus.status} ${JSON.stringify(fus.data).slice(0, 300)}`);
    check((await filas(`sugerencias_union?select=id&or=(contacto_id.eq.${L},otro_id.eq.${L})`)).length === 0, "las sugerencias de L se fueron con él (si no, la guarda de la fusión cortaba)");
    check((await filas(`audit_log?select=id&entity_id=eq.${M}&action=eq.contacto.fusionado`)).length === 1, "«contactos unidos» en el historial");
    limpiar.contactos = limpiar.contactos.filter((c) => c !== L);

    titulo("El correo, simulado: la búsqueda directo en la base");
    const porCorreo = await rpcAdmin("buscar_contacto_entre_canales", { p_workspace: espacio, p_correo: `ENTRE-${sufijo}@ssa-test.local` });
    check(porCorreo.data?.tipo === "exacto" && porCorreo.data?.por === "correo" && porCorreo.data?.contact_id === M, "un correo exacto (sin importar mayúsculas) encuentra a M para vincular", JSON.stringify(porCorreo.data));
    const sinCorreo = await rpcAdmin("buscar_contacto_entre_canales", { p_workspace: espacio, p_correo: `nadie-${sufijo}@ssa-test.local` });
    check(sinCorreo.status === 200 && sinCorreo.data === null, "un correo que no está no encuentra nada (control)");
    const porSecundario = await rpcAdmin("buscar_contacto_entre_canales", { p_workspace: espacio, p_correo: `segundo-${sufijo}@ssa-test.local` });
    check(porSecundario.data?.tipo === "exacto" && porSecundario.data?.contact_id === W, "el correo secundario también encuentra (a W)", JSON.stringify(porSecundario.data));
    const enOtro = await rpcAdmin("buscar_contacto_entre_canales", { p_workspace: member.espacio, p_correo: `entre-${sufijo}@ssa-test.local` });
    check(enOtro.data === null, "en otro espacio no encuentra a M");
    const comoUsuarioRpc = await rpcComo(owner.token, "buscar_contacto_entre_canales", { p_workspace: espacio, p_correo: `entre-${sufijo}@ssa-test.local` });
    check(comoUsuarioRpc.status >= 400, "la búsqueda es solo del servidor: un usuario no la llama", `HTTP ${comoUsuarioRpc.status}`);
  } finally {
    await rpcAdmin("delete_secret", { secret_name: "evolution_webhook_secret", workspace_id: espacio });
    for (const id of eventosZernio) await admin(`webhook_events?event_id=eq.${id}`, { method: "DELETE" });
    const r = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(r.status < 300, "se borran los contactos del espacio fantasma", `HTTP ${r.status}`);
    limpiar.contactos.length = 0;
  }
}, async () => {
  if (!espacioFantasma) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => (await filas(path)).length;
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`channels?select=id&workspace_id=in.(${ids})`)) === 0, "channels: 0");
  check((await cuenta(`webhook_events?select=event_id&event_id=like.b3-entre-evt-*`)) === 0, "webhook_events de los avisos de Zernio: 0");
  const secretos = catalogo(`select count(*)::int as n from vault.secrets where ${limpiar.workspaces.map((w) => `name like '%${w}%'`).join(" or ") || "false"}`)[0]?.n;
  check(secretos === 0, "secretos de Vault del espacio fantasma: 0", `quedan ${secretos}`);
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log del espacio fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
