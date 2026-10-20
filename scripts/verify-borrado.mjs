#!/usr/bin/env node
/**
 * F30, el borrado suave, con sesiones reales contra PRODUCCIÓN, en un espacio
 * fantasma que este script crea y borra en la misma corrida. Nunca en «Ale
 * Admin's Workspace».
 *
 * LO QUE PRUEBA:
 *   - Los listados y la seguridad por filas excluyen lo eliminado (00038): el
 *     contacto, su conversación, sus mensajes y su canal dejan de leerse.
 *   - Eliminar y restaurar, solo Owner y Admin, en la base (decisión de Marcos
 *     del 20/10/2026): un Member, con su token y pidiéndolo directo, no puede
 *     ni por PATCH de `deleted_at` ni por las funciones; el Admin sí. Y el
 *     Member sigue editando los otros datos de su lead.
 *   - «Eliminados»: el Member ve su lead y no el ajeno; el Owner ve los dos.
 *   - El historial: «contacto.eliminado» y «contacto.restaurado».
 *   - La restauración automática (decisiones de Marcos del 19/10/2026, el lead
 *     escribe, y del 20/10/2026, el negocio le escribe desde la app o el
 *     teléfono), con
 *     avisos firmados contra los receptores de producción: uno de Evolution
 *     2.3.7 (WhatsApp) y uno de Zernio (Instagram), firmado con el secreto del
 *     espacio fantasma. Sin ninguna llamada a Zernio ni a Evolution: el espacio
 *     fantasma no tiene clave de Zernio en Vault, así que el relleno de perfil
 *     no llama (`lib/relleno-perfil.ts:76-78`), y no tiene flujos.
 *
 * LOS CONTROLES (las reglas de verificación del CLAUDE.md):
 *   - el Member lee su lead, la conversación y los mensajes antes de que se
 *     elimine: la ausencia de después vale porque la presencia se probó;
 *   - cada rechazo se relee con la clave de servicio, no con el token que
 *     acaba de fallar;
 *   - la restauración automática: el contacto estaba eliminado (releído)
 *     inmediatamente antes de entregar el aviso, y nada en el medio lo toca.
 *
 * QUÉ CAMBIA CADA PASO. Los rechazos no escriben (se relee). La edición del
 * Member cambia solo `country`. Los avisos firmados escriben un mensaje y
 * restauran: se entregan cada uno después de volver a eliminar, y se leen
 * enseguida.
 *
 * ANTES DE LA 00038 tiene que fallar (las funciones no existen y el Member
 * puede marcar `deleted_at`), con el control del principio en verde.
 *
 * AL FINAL borra contactos, canales, secretos, la fila de `webhook_events` del
 * aviso de Zernio, los tres usuarios y los espacios, y lo recuenta. Las filas
 * de `audit_log` NO se borran (F31): se informan.
 *
 * Uso: node scripts/verify-borrado.mjs
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { admin, catalogo, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcAdmin, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const INSTANCIA = `b3-borrado-${sufijo}`;
const SECRETO_WA = randomBytes(32).toString("hex");
const SECRETO_IG = randomBytes(32).toString("hex");
const CUENTA_IG = `b3borrado${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const TEL = `5068${String(Date.now()).slice(-7)}`; // inventado, +506 con 8 dígitos
const JID = `${TEL}@s.whatsapp.net`;
const IG_SENDER = `b3-ig-${sufijo}`;
const eventosZernio = [];

let espacioFantasma = null;
let usuariosFantasma = [];

const lee = async (u, path) => {
  const r = await comoUsuario(u.token, path);
  return Array.isArray(r.data) ? r.data : null;
};
const deServicio = async (path) => (await admin(path)).data ?? [];
const fechaDe = async (tabla, id) => (await deServicio(`${tabla}?select=deleted_at&id=eq.${id}`))[0]?.deleted_at;

async function firmaEvolution() {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 600)
    .sign(new TextEncoder().encode(SECRETO_WA));
}

/** `prepareMessage` de Evolution 2.3.7 (whatsapp.baileys.service.ts:4652-4704), igual que `verify-guardado-whatsapp.mjs`. */
async function avisoDeWhatsApp(id, texto, fromMe = false) {
  const data = {
    key: { remoteJid: JID, fromMe, id, addressingMode: "pn" },
    pushName: fromMe ? "Você" : "Lead de prueba",
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

/** `message.received` de Zernio (`AvisoDeMensajeZernio`, lib/zernio-aviso.ts), con el HMAC-SHA256 hexadecimal del secreto del espacio (lib/zernio-webhook.ts:190). */
/**
 * Con `saliente`, el echo de lo que el negocio escribe desde la app: `message.sent`,
 * dirección `outgoing`, el remitente es la cuenta del negocio y el lead va en
 * `conversation.participantId` (`contactoDelAviso`, lib/zernio-aviso.ts:96-104).
 */
async function avisoDeInstagram(texto, saliente = false) {
  const id = `b3-borrado-evt-${randomUUID()}`;
  eventosZernio.push(id);
  const cuerpo = JSON.stringify({
    id,
    event: saliente ? "message.sent" : "message.received",
    message: {
      id: `zm-${randomUUID()}`,
      conversationId: `zc-${sufijo}`,
      platform: "instagram",
      platformMessageId: `ig-mid-${randomUUID()}`,
      direction: saliente ? "outgoing" : "incoming",
      text: texto,
      attachments: [],
      sender: saliente ? { id: `cuenta-${sufijo}`, name: "La cuenta del negocio", username: `b3cuenta${sufijo}` } : { id: IG_SENDER, name: "Lead IG de prueba", username: `b3.ig.${sufijo}` },
      sentAt: new Date().toISOString(),
    },
    conversation: { id: `zc-${sufijo}`, platformConversationId: `pc-${sufijo}`, participantId: IG_SENDER },
    account: { id: CUENTA_IG, platform: "instagram", username: `b3cuenta${sufijo}` },
  });
  const res = await fetch(`${APP_URL}/api/webhooks/late`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-late-signature": createHmac("sha256", SECRETO_IG).update(cuerpo).digest("hex") },
    body: cuerpo,
  });
  return res.status;
}

async function esperar(cond, intentos = 20) {
  for (let i = 0; i < intentos; i++) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return cond();
}

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

await correr(async () => {
  const owner = await crearUsuario("borrado-owner");
  const adminU = await crearUsuario("borrado-admin");
  const member = await crearUsuario("borrado-member");
  usuariosFantasma = [owner.id, adminU.id, member.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, adminU, "admin");
  await sumarAlEspacio(espacio, member, "member");
  console.log(`Espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Admin ${adminU.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  try {
  // Los canales fantasma: filas en la base, sin instancia de Evolution ni cuenta de Zernio detrás.
  const g = await rpcAdmin("store_secret", { secret_name: "evolution_webhook_secret", secret_value: SECRETO_WA, workspace_id: espacio });
  if (g.status >= 300) throw new Error(`no se pudo guardar el secreto de Evolution: HTTP ${g.status}`);
  const ws = await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ webhook_secret: SECRETO_IG }) });
  if (ws.status >= 300) throw new Error(`no se pudo guardar el secreto de Zernio del espacio fantasma: HTTP ${ws.status}`);
  const cWa = await admin("channels", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, platform: "whatsapp", provider: "evolution", instance_name: INSTANCIA, is_active: true, umbral_silencio_horas: null }),
  });
  const cIg = await admin("channels", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, platform: "instagram", provider: "zernio", late_account_id: CUENTA_IG, username: `b3cuenta${sufijo}`, is_active: true, umbral_silencio_horas: null }),
  });
  const canalWa = cWa.data?.[0]?.id;
  const canalIg = cIg.data?.[0]?.id;
  if (!canalWa || !canalIg) throw new Error(`no se pudieron crear los canales: ${JSON.stringify([cWa.data, cIg.data]).slice(0, 300)}`);

  // L: el lead del Member, de WhatsApp. J: ajeno. I: de Instagram.
  const L = (await crearContacto(espacio, { display_name: `b3-borrado-L-${sufijo}`, setter_id: member.id, phone: `+${TEL}`, phone_resolved: true })).id;
  const J = (await crearContacto(espacio, { display_name: `b3-borrado-J-${sufijo}` })).id;
  const I = (await crearContacto(espacio, { display_name: `b3-borrado-I-${sufijo}` })).id;
  const ccL = await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: L, channel_id: canalWa, platform_sender_id: JID, raw_jid: JID, addressing_mode: "pn" }) });
  const ccI = await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: I, channel_id: canalIg, platform_sender_id: IG_SENDER, raw_jid: IG_SENDER }) });
  const convL = await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canalWa, contact_id: L, platform: "whatsapp", historial_estado: "completo" }) });
  const convI = await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canalIg, contact_id: I, platform: "instagram", historial_estado: "completo" }) });
  const C = convL.data?.[0]?.id;
  const CI = convI.data?.[0]?.id;
  if (ccL.status >= 300 || ccI.status >= 300 || !C || !CI) throw new Error(`no se armó el escenario: ${JSON.stringify([ccL.data, ccI.data, convL.data, convI.data]).slice(0, 400)}`);
  const msg = await admin("messages", {
    method: "POST",
    body: JSON.stringify({ conversation_id: C, direction: "inbound", text: "mensaje previo", platform_message_id: `b3-borrado-prev-${sufijo}`, remote_jid: JID }),
  });
  if (msg.status >= 300) throw new Error(`no se creó el mensaje previo: ${JSON.stringify(msg.data).slice(0, 200)}`);
  console.log(`  L ${L.slice(0, 8)} (conversación ${C.slice(0, 8)}), J ${J.slice(0, 8)}, I ${I.slice(0, 8)} (conversación ${CI.slice(0, 8)})`);

  titulo("Control: el Member lee su lead, la conversación, el mensaje y el canal");
  const sesionOk = check((await lee(member, `contacts?select=id&id=eq.${L}`))?.length === 1, "el Member lee L con su token");
  const presente = {
    conv: (await lee(member, `conversations?select=id&id=eq.${C}`))?.length === 1,
    msgs: (await lee(member, `messages?select=id&conversation_id=eq.${C}`))?.length === 1,
    canal: (await lee(member, `contact_channels?select=id&contact_id=eq.${L}`))?.length === 1,
  };
  check(presente.conv && presente.msgs && presente.canal, "y su conversación, su mensaje y su fila de canal", JSON.stringify(presente));

  titulo("El Member, con su token y pidiendo directo, no elimina su propio lead");
  const m1 = await comoUsuario(member.token, `contacts?id=eq.${L}`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
  check((await fechaDe("contacts", L)) === null, "PATCH de contacts.deleted_at: rechazado (releído: sin fecha)", `HTTP ${m1.status}`);
  const m2 = await rpcComo(member.token, "eliminar_contacto", { p_contacto: L });
  check(m2.status >= 400 && (await fechaDe("contacts", L)) === null, "eliminar_contacto: rechazado (releído: sin fecha)", `HTTP ${m2.status}`);
  const m3 = await comoUsuario(member.token, `conversations?id=eq.${C}`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
  check((await fechaDe("conversations", C)) === null, "PATCH de conversations.deleted_at: rechazado (releído: sin fecha)", `HTTP ${m3.status}`);

  titulo("Control de que no se rompió la edición: el Member edita otro dato de su lead");
  const ed = await comoUsuario(member.token, `contacts?id=eq.${L}`, { method: "PATCH", body: JSON.stringify({ country: "CR" }) });
  check(ed.status === 200 && ed.data?.length === 1, "el Member cambia el país de L", `HTTP ${ed.status}`);
  check((await deServicio(`contacts?select=country&id=eq.${L}`))[0]?.country === "CR", "y quedó escrito (releído con la clave de servicio)");

  titulo("El Admin elimina L por la función (contraparte)");
  const e1 = await rpcComo(adminU.token, "eliminar_contacto", { p_contacto: L });
  const fechaL = await fechaDe("contacts", L);
  check(e1.status === 200 && fechaL, "el Admin elimina L", `HTTP ${e1.status} ${JSON.stringify(e1.data).slice(0, 200)}`);
  check(fechaL && (await fechaDe("conversations", C)) === fechaL, "su conversación queda marcada con la misma fecha");
  check((await deServicio(`contacts?select=id&id=eq.${L}`)).length === 1, "la fila sigue en la base: eliminar marca la fecha, no borra");

  titulo("Los listados y la seguridad por filas excluyen lo eliminado");
  if (!sesionOk) noConcluyente("el Member deja de leer L", "falló el control de su sesión");
  else {
    check((await lee(member, `contacts?select=id&id=eq.${L}`))?.length === 0, "el Member ya no lee L");
    check(presente.conv && (await lee(member, `conversations?select=id&id=eq.${C}`))?.length === 0, "ni su conversación");
    check(presente.msgs && (await lee(member, `messages?select=id&conversation_id=eq.${C}`))?.length === 0, "ni sus mensajes");
    check(presente.canal && (await lee(member, `contact_channels?select=id&contact_id=eq.${L}`))?.length === 0, "ni su fila de canal");
  }
  check((await lee(owner, `contacts?select=id&id=eq.${L}`))?.length === 0, "el Owner tampoco lo lista: lo eliminado se ve solo en «Eliminados»");
  check((await lee(owner, `contacts?select=id&id=eq.${J}`))?.length === 1, "el Owner sigue leyendo J (control de su sesión)");

  titulo("«Eliminados»: cada uno ve lo de su alcance");
  const e2 = await rpcComo(owner.token, "eliminar_contacto", { p_contacto: J });
  check(e2.status === 200, "el Owner elimina J (ajeno al Member)", `HTTP ${e2.status}`);
  const lista = async (u) => {
    const r = await rpcComo(u.token, "contactos_eliminados", { p_workspace: espacio });
    return Array.isArray(r.data) ? r.data : [];
  };
  const delOwner = await lista(owner);
  check(delOwner.some((f) => f.id === L) && delOwner.some((f) => f.id === J), "el Owner ve L y J en «Eliminados»", `${delOwner.length} filas`);
  const delMember = await lista(member);
  check(delMember.some((f) => f.id === L), "el Member ve su lead L en «Eliminados»");
  check(!delMember.some((f) => f.id === J), "y no ve J, que no es suyo (la presencia de J la probó el Owner)");

  titulo("El Member, con su token y pidiendo directo, no restaura");
  const r1 = await rpcComo(member.token, "restaurar_contacto", { p_contacto: L });
  check(r1.status >= 400 && (await fechaDe("contacts", L)) === fechaL, "restaurar_contacto: rechazado (releído: sigue eliminado)", `HTTP ${r1.status}`);
  const r2 = await comoUsuario(member.token, `contacts?id=eq.${L}`, { method: "PATCH", body: JSON.stringify({ deleted_at: null }) });
  check((await fechaDe("contacts", L)) === fechaL, "PATCH de deleted_at a nulo: no toca nada (releído)", `HTTP ${r2.status}, filas ${r2.data?.length}`);
  const r3 = await rpcComo(member.token, "restaurar_contacto", { p_contacto: L, p_via: "mensaje_entrante" });
  check(r3.status >= 400 && (await fechaDe("contacts", L)) === fechaL, "la vía automática tampoco: es solo del servidor", `HTTP ${r3.status}`);

  titulo("El Admin restaura L (contraparte)");
  const r4 = await rpcComo(adminU.token, "restaurar_contacto", { p_contacto: L });
  check(r4.status === 200 && (await fechaDe("contacts", L)) === null, "el Admin restaura L", `HTTP ${r4.status} ${JSON.stringify(r4.data).slice(0, 200)}`);
  check((await fechaDe("conversations", C)) === null, "y vuelve su conversación");
  check((await lee(member, `messages?select=id&conversation_id=eq.${C}`))?.length === 1, "el Member vuelve a leer el mensaje");

  titulo("La restauración automática por WhatsApp: aviso firmado de Evolution 2.3.7 contra producción");
  await rpcComo(adminU.token, "eliminar_contacto", { p_contacto: L });
  const contactosAntes = (await deServicio(`contacts?select=id&workspace_id=eq.${espacio}`)).length;
  const eliminadoAntesWa = Boolean(await fechaDe("contacts", L));
  check(eliminadoAntesWa, "L está eliminado inmediatamente antes del aviso (presencia de la condición)");
  const stWa = await avisoDeWhatsApp(`B3BORRADO${sufijo}`, "volví a escribir");
  check(stWa === 200, "el receptor de Evolution acepta el aviso", `HTTP ${stWa}`);
  const restWa = await esperar(async () => (await fechaDe("contacts", L)) === null);
  if (!eliminadoAntesWa) noConcluyente("L se restauró solo", "no estaba eliminado antes del aviso");
  else check(restWa, "L se restauró solo");
  check((await fechaDe("conversations", C)) === null, "y su conversación");
  const enC = await deServicio(`messages?select=id&conversation_id=eq.${C}&platform_message_id=eq.B3BORRADO${sufijo}`);
  check(enC.length === 1, "el mensaje quedó en su conversación de siempre");
  check((await deServicio(`contacts?select=id&workspace_id=eq.${espacio}`)).length === contactosAntes, "sin un contacto nuevo");
  const audWa = await deServicio(`audit_log?select=actor_id,actor_label,detail&entity_id=eq.${L}&action=eq.contacto.restaurado&order=created_at.desc&limit=1`);
  check(audWa[0]?.actor_label === "Sistema" && audWa[0]?.actor_id === null, "«contacto restaurado» con el Sistema de autor", JSON.stringify(audWa[0]?.actor_label));
  check(audWa[0]?.detail?.via === "mensaje_entrante" && audWa[0]?.detail?.canal_id === canalWa, "con la vía y el canal de WhatsApp");

  titulo("La restauración automática por Instagram: aviso firmado de Zernio contra producción");
  const eI = await rpcComo(owner.token, "eliminar_contacto", { p_contacto: I });
  const eliminadoAntesIg = eI.status === 200 && Boolean(await fechaDe("contacts", I));
  check(eliminadoAntesIg, "I está eliminado inmediatamente antes del aviso (presencia de la condición)");
  const stIg = await avisoDeInstagram("volví a escribir por Instagram");
  check(stIg === 200, "el receptor de Zernio acepta el aviso firmado", `HTTP ${stIg}`);
  const restIg = await esperar(async () => (await fechaDe("contacts", I)) === null);
  if (!eliminadoAntesIg) noConcluyente("I se restauró solo", "no estaba eliminado antes del aviso");
  else check(restIg, "I se restauró solo");
  check((await fechaDe("conversations", CI)) === null, "y su conversación");
  check((await deServicio(`messages?select=id&conversation_id=eq.${CI}`)).length === 1, "el mensaje quedó en su conversación de siempre");
  const audIg = await deServicio(`audit_log?select=actor_label,detail&entity_id=eq.${I}&action=eq.contacto.restaurado`);
  check(audIg.length === 1 && audIg[0]?.actor_label === "Sistema" && audIg[0]?.detail?.canal_id === canalIg, "«contacto restaurado» del Sistema, por el canal de Instagram");

  titulo("Un saliente del negocio también restaura (decisión de Marcos del 20/10/2026)");
  await rpcComo(adminU.token, "eliminar_contacto", { p_contacto: L });
  const eliminadoAntesSal = Boolean(await fechaDe("contacts", L));
  check(eliminadoAntesSal, "L está eliminado inmediatamente antes del saliente");
  const stSal = await avisoDeWhatsApp(`B3BORRADOSAL${sufijo}`, "te escribo desde el teléfono", true);
  check(stSal === 200, "el receptor de Evolution acepta el saliente firmado (fromMe)", `HTTP ${stSal}`);
  const restSal = await esperar(async () => (await fechaDe("contacts", L)) === null);
  if (!eliminadoAntesSal) noConcluyente("el saliente restauró a L", "no estaba eliminado antes");
  else check(restSal, "el saliente de WhatsApp restauró a L");
  check((await deServicio(`messages?select=direction&conversation_id=eq.${C}&platform_message_id=eq.B3BORRADOSAL${sufijo}`))[0]?.direction === "outbound", "el saliente quedó en su conversación de siempre, como del negocio");
  const audSal = await deServicio(`audit_log?select=actor_label,detail&entity_id=eq.${L}&action=eq.contacto.restaurado&order=created_at.desc&limit=1`);
  check(audSal[0]?.actor_label === "Sistema" && audSal[0]?.detail?.via === "mensaje_saliente" && audSal[0]?.detail?.canal_id === canalWa, "«contacto restaurado» del Sistema, con la vía del saliente y el canal");

  await rpcComo(owner.token, "eliminar_contacto", { p_contacto: I });
  const eliminadoAntesEcho = Boolean(await fechaDe("contacts", I));
  check(eliminadoAntesEcho, "I está eliminado inmediatamente antes del echo");
  const stEcho = await avisoDeInstagram("te escribo desde la app", true);
  check(stEcho === 200, "el receptor de Zernio acepta el echo firmado (message.sent)", `HTTP ${stEcho}`);
  const restEcho = await esperar(async () => (await fechaDe("contacts", I)) === null);
  if (!eliminadoAntesEcho) noConcluyente("el echo restauró a I", "no estaba eliminado antes");
  else check(restEcho, "el echo de Instagram restauró a I");
  check((await deServicio(`messages?select=direction&conversation_id=eq.${CI}&direction=eq.outbound`)).length === 1, "el echo quedó en su conversación de siempre, como del negocio");
  const audEcho = await deServicio(`audit_log?select=actor_label,detail&entity_id=eq.${I}&action=eq.contacto.restaurado&order=created_at.desc&limit=1`);
  check(audEcho[0]?.actor_label === "Sistema" && audEcho[0]?.detail?.via === "mensaje_saliente" && audEcho[0]?.detail?.canal_id === canalIg, "«contacto restaurado» del Sistema, con la vía del saliente y el canal de Instagram");

  titulo("El historial");
  const aud = await deServicio(`audit_log?select=action,actor_id,entity_id&workspace_id=eq.${espacio}&action=in.(contacto.eliminado,contacto.restaurado)&order=created_at`);
  const de = (accion, entidad) => aud.filter((f) => f.action === accion && f.entity_id === entidad);
  check(de("contacto.eliminado", L).length === 3 && de("contacto.eliminado", L).every((f) => f.actor_id === adminU.id), "L: tres «eliminado», todos del Admin");
  check(de("contacto.restaurado", L).length === 3, "L: tres «restaurado» (el del Admin y dos del Sistema: entrante y saliente)");
  check(de("contacto.eliminado", I).length === 2 && de("contacto.restaurado", I).length === 2, "I: dos «eliminado» y dos «restaurado» (entrante y echo)");
  check(de("contacto.restaurado", L).some((f) => f.actor_id === adminU.id), "uno con el Admin de autor");
  check(de("contacto.eliminado", J).length === 1 && de("contacto.eliminado", J)[0].actor_id === owner.id, "J: «eliminado», del Owner");
  check(!aud.some((f) => f.actor_id === member.id), "ninguna fila del Member: sus intentos no escribieron nada");

  } finally {
    // Siempre, aunque el escenario se corte: el secreto de Vault no se va con
    // el espacio, y los contactos se borran antes que el espacio (la NO ACTION
    // de la 00025).
    await rpcAdmin("delete_secret", { secret_name: "evolution_webhook_secret", workspace_id: espacio });
    for (const id of eventosZernio) await admin(`webhook_events?event_id=eq.${id}`, { method: "DELETE" });
    const borrar = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(borrar.status < 300, "se borran los contactos del espacio fantasma", `HTTP ${borrar.status}`);
    limpiar.contactos.length = 0;
  }
}, async () => {
  if (!espacioFantasma) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => {
    const r = await admin(path);
    return Array.isArray(r.data) ? r.data.length : -1;
  };
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`workspace_members?select=user_id&workspace_id=in.(${ids})`)) === 0, "workspace_members: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`conversations?select=id&workspace_id=in.(${ids})`)) === 0, "conversations: 0");
  check((await cuenta(`channels?select=id&workspace_id=in.(${ids})`)) === 0, "channels: 0");
  check((await cuenta(`webhook_events?select=event_id&event_id=like.b3-borrado-evt-*`)) === 0, "webhook_events del aviso de Zernio: 0");
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const secretos = catalogo(`select count(*)::int as n from vault.secrets where ${limpiar.workspaces.map((w) => `name like '%${w}%'`).join(" or ") || "false"}`)[0]?.n;
  check(secretos === 0, "secretos de Vault del espacio fantasma: 0", `quedan ${secretos}`);
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log del espacio fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
