#!/usr/bin/env node
/**
 * Control positivo de F27 para WhatsApp, contra el receptor de PRODUCCIÓN y la
 * base real, con avisos de prueba firmados. Y lo de F25 y F26 que cuelga de
 * guardar mensajes: el identificador crudo, el teléfono o la marca de sin
 * resolver, el contador, la reconciliación por mensaje y el toque de
 * click-to-WhatsApp. Más la restricción única de `messages` probada por
 * PostgREST, que es por donde la usa la app.
 *
 * LOS AVISOS ESTÁN ARMADOS desde el código de Evolution 2.3.7 (la forma de
 * `prepareMessage`, `whatsapp.baileys.service.ts:4652-4704`; el objeto de
 * `messages.upsert`, `:1483`; la lista de `messages.set`, `:1049-1052`;
 * `send.message`, `:2545`) y de Baileys 7.0.0-rc.9 (`remoteJidAlt`). No hay un
 * aviso real: el número no se vincula hasta el Bloque 4. Llegada real: se
 * comprueba en la puesta en marcha.
 *
 * DÓNDE TRABAJA. Nunca en el espacio real ni en su canal de WhatsApp. Crea un
 * usuario de prueba, que trae su espacio fantasma (`lib-verificador.mjs`); en
 * ese espacio guarda un secreto de webhook GENERADO ACÁ (no lee ninguno que ya
 * exista) y un canal de Evolution que es solo una fila, con un nombre de
 * instancia inventado: no crea ni toca ninguna instancia del servidor de
 * Evolution. No manda correo: el espacio fantasma no tiene clave de Resend.
 *
 * Se corre ANTES del despliegue de F27 y tiene que fallar (el receptor
 * acusaba 200 y descartaba el contenido), y después tiene que pasar.
 *
 * Al final borra el secreto y el espacio, que se lleva en cascada el canal,
 * los contactos, las conversaciones y los mensajes. Lo que quede en
 * `audit_log` («contacto creado», «reconciliado») queda huérfano e invisible:
 * esa tabla no se borra (F31).
 *
 * Uso: node scripts/verify-guardado-whatsapp.mjs
 */
import { randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { admin, check, correr, crearUsuario, noConcluyente, rpcAdmin, sufijo } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}

const INSTANCIA = `b3-guardado-${sufijo}`;
const SECRETO = randomBytes(32).toString("hex");
const TEL = `5067${String(Date.now()).slice(-7)}`; // inventado, +506 con 8 dígitos
const LID = `${String(Date.now())}${randomUUID().replace(/\D/g, "").slice(0, 5)}@lid`;
const ahoraSeg = () => Math.floor(Date.now() / 1000);

async function firmar() {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 600)
    .sign(new TextEncoder().encode(SECRETO));
}

/** `prepareMessage` (4652-4704). */
function mensaje({ id, remoteJid = `${TEL}@s.whatsapp.net`, fromMe = false, remoteJidAlt, addressingMode = "pn", texto = "hola, prueba", contextInfo = null, ts = ahoraSeg() }) {
  return {
    key: { remoteJid, fromMe, id, ...(remoteJidAlt ? { remoteJidAlt } : {}), addressingMode },
    pushName: fromMe ? "Você" : "Lead de prueba",
    message: { conversation: texto },
    messageType: "conversation",
    messageTimestamp: ts,
    contextInfo,
    source: "android",
  };
}

async function entregar(evento, data) {
  const res = await fetch(`${APP_URL}/api/webhooks/evolution`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await firmar()}` },
    body: JSON.stringify({ event: evento, instance: INSTANCIA, data, date_time: new Date().toISOString() }),
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}

const mensajesCon = async (id) =>
  (await admin(`messages?select=id,direction,remote_jid,created_at,conversation_id&platform_message_id=eq.${encodeURIComponent(id)}`)).data ?? [];

async function esperarMensaje(id, cuantos = 1) {
  for (let i = 0; i < 20; i++) {
    const filas = await mensajesCon(id);
    if (filas.length >= cuantos) return filas;
    await new Promise((r) => setTimeout(r, 500));
  }
  return mensajesCon(id);
}

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

await correr(async () => {
  console.log(`Receptor: ${APP_URL}/api/webhooks/evolution · instancia de prueba ${INSTANCIA}`);
  const u = await crearUsuario("guardado-wa");
  const espacio = u.espacio;

  const guardar = await rpcAdmin("store_secret", { secret_name: "evolution_webhook_secret", secret_value: SECRETO, workspace_id: espacio });
  if (guardar.status >= 300) throw new Error(`no se pudo guardar el secreto de prueba: HTTP ${guardar.status}`);

  const canal = await admin("channels", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, platform: "whatsapp", provider: "evolution", instance_name: INSTANCIA, is_active: true }),
  });
  const canalId = canal.data?.[0]?.id;
  if (!canalId) throw new Error(`no se pudo crear el canal de prueba: ${JSON.stringify(canal.data).slice(0, 200)}`);

  try {
    // ── 1. Entrante ──────────────────────────────────────────────────────────
    titulo("Un entrante (messages.upsert, objeto) se guarda con su identificador crudo y la fecha convertida");
    const ts = ahoraSeg() - 120;
    const r1 = await entregar("messages.upsert", mensaje({ id: `IN-${sufijo}`, ts }));
    const acuse = check(r1.status === 200, "el receptor acusa 200 (control positivo de la cañería)", `HTTP ${r1.status}`);
    const [m1] = await esperarMensaje(`IN-${sufijo}`);
    if (!acuse) noConcluyente("lo que sigue", "el receptor no aceptó un aviso válido");
    const guardo = check(Boolean(m1), "el mensaje está en messages", "no se guardó: es lo que hacía el receptor antes de F27");
    if (guardo) {
      check(m1.direction === "inbound", "como entrante");
      check(m1.remote_jid === `${TEL}@s.whatsapp.net`, "con el remoteJid tal como llegó (F26)", m1.remote_jid);
      check(Math.abs(new Date(m1.created_at).getTime() - ts * 1000) < 1000, "con la fecha del proveedor, de segundos a fecha", m1.created_at);
      const { data: conv } = await admin(`conversations?select=contact_id,historial_estado&id=eq.${m1.conversation_id}`);
      const contactId = conv?.[0]?.contact_id;
      const { data: ct } = await admin(`contacts?select=phone,phone_resolved&id=eq.${contactId}`);
      check(ct?.[0]?.phone === `+${TEL}` && ct?.[0]?.phone_resolved === true, "el contacto quedó con el teléfono en E.164", JSON.stringify(ct?.[0]));
      const { data: cc } = await admin(`contact_channels?select=raw_jid,addressing_mode&contact_id=eq.${contactId}`);
      check(cc?.[0]?.raw_jid === `${TEL}@s.whatsapp.net` && cc?.[0]?.addressing_mode === "pn", "contact_channels con raw_jid y addressing_mode (F26)", JSON.stringify(cc?.[0]));
      check(conv?.[0]?.historial_estado === "completo", "la conversación de WhatsApp no espera una importación");
      const { data: ch } = await admin(`channels?select=last_inbound_at&id=eq.${canalId}`);
      check(Boolean(ch?.[0]?.last_inbound_at), "el canal registró su último entrante (F39)");
    }

    // ── 2. Propio desde el teléfono ─────────────────────────────────────────
    titulo("Un mensaje propio escrito desde el teléfono (fromMe) se guarda como del negocio");
    await entregar("messages.upsert", mensaje({ id: `OUT-${sufijo}`, fromMe: true, texto: "respuesta desde el teléfono" }));
    const [m2] = await esperarMensaje(`OUT-${sufijo}`);
    check(m2?.direction === "outbound", "guardado como saliente", JSON.stringify(m2));

    // ── 3. El mismo como send.message ───────────────────────────────────────
    titulo("El mismo mensaje como send.message (2545, mismo key.id) no se guarda dos veces");
    const r3 = await entregar("send.message", mensaje({ id: `OUT-${sufijo}`, fromMe: true, texto: "respuesta desde el teléfono" }));
    check(r3.status === 200, "acusa 200", `HTTP ${r3.status}`);
    await new Promise((r) => setTimeout(r, 1500));
    const repetidos = await mensajesCon(`OUT-${sufijo}`);
    if (m2) check(repetidos.length === 1, "sigue habiendo una sola fila", `filas: ${repetidos.length}`);
    else noConcluyente("una sola fila", "el paso 2 no guardó el original");

    // ── 4. Lista ─────────────────────────────────────────────────────────────
    titulo("messages.set trae una lista y se guarda entera");
    await entregar("messages.set", [mensaje({ id: `H1-${sufijo}`, ts: ahoraSeg() - 86400 }), mensaje({ id: `H2-${sufijo}`, ts: ahoraSeg() - 86000 })]);
    const h1 = await esperarMensaje(`H1-${sufijo}`);
    const h2 = await esperarMensaje(`H2-${sufijo}`);
    check(h1.length === 1 && h2.length === 1, "los dos mensajes de la lista están");

    // ── 5. @lid sin teléfono y el contador ──────────────────────────────────
    titulo("Un @lid sin teléfono: contacto nuevo sin resolver, y el contador lo cuenta (F26)");
    const desde = new Date(Date.now() - 3600_000).toISOString();
    await entregar("messages.upsert", mensaje({ id: `LID-${sufijo}`, remoteJid: LID, addressingMode: "lid" }));
    const [m5] = await esperarMensaje(`LID-${sufijo}`);
    let contactoLid = null;
    if (check(Boolean(m5), "el mensaje del @lid está guardado")) {
      const { data: conv } = await admin(`conversations?select=contact_id&id=eq.${m5.conversation_id}`);
      contactoLid = conv?.[0]?.contact_id;
      const { data: ct } = await admin(`contacts?select=phone,phone_resolved&id=eq.${contactoLid}`);
      check(ct?.[0]?.phone === null && ct?.[0]?.phone_resolved === false, "el contacto queda sin teléfono y marcado sin resolver", JSON.stringify(ct?.[0]));
      const cont = await rpcAdmin("contar_mensajes_sin_telefono", { p_workspace: espacio, p_desde: desde });
      const fila = Array.isArray(cont.data) ? cont.data[0] : cont.data;
      check(Number(fila?.sin_telefono) >= 1 && Number(fila?.total) >= 2, "el contador ve al menos 1 sin teléfono entre los entrantes", JSON.stringify(fila));
    }

    // ── 6. Vía 1 de reconciliación ──────────────────────────────────────────
    titulo("Vía 1: un mensaje en modo pn con el @lid en remoteJidAlt reconcilia ese contacto");
    const TEL2 = `5068${String(Date.now()).slice(-7)}`;
    await entregar("messages.upsert", mensaje({ id: `PN-${sufijo}`, remoteJid: `${TEL2}@s.whatsapp.net`, remoteJidAlt: LID, addressingMode: "pn" }));
    const [m6] = await esperarMensaje(`PN-${sufijo}`);
    if (contactoLid && m6) {
      const { data: ct } = await admin(`contacts?select=phone,phone_resolved&id=eq.${contactoLid}`);
      check(ct?.[0]?.phone === `+${TEL2}` && ct?.[0]?.phone_resolved === true, "el contacto del @lid recibió el teléfono", JSON.stringify(ct?.[0]));
      const { data: conv } = await admin(`conversations?select=contact_id&id=eq.${m6.conversation_id}`);
      check(conv?.[0]?.contact_id === contactoLid, "el mensaje quedó en el mismo contacto, sin crear otro");
      const { data: au } = await admin(`audit_log?select=action&entity_id=eq.${contactoLid}&action=eq.contacto.reconciliado`);
      check((au ?? []).length >= 1, "quedó en el historial de auditoría");
    } else noConcluyente("la reconciliación", "faltó el mensaje del @lid o el del paso 6");

    // ── 7. Click-to-WhatsApp ────────────────────────────────────────────────
    titulo("Un entrante con externalAdReply registra el origen del anuncio (F25)");
    const TEL3 = `5069${String(Date.now()).slice(-7)}`;
    await entregar(
      "messages.upsert",
      mensaje({
        id: `AD-${sufijo}`,
        remoteJid: `${TEL3}@s.whatsapp.net`,
        contextInfo: { externalAdReply: { sourceId: `AD-${sufijo}`, ctwaClid: `CLID-${sufijo}`, sourceType: "ad", sourceUrl: "https://fb.me/prueba?utm_source=meta&utm_campaign=b3" } },
      }),
    );
    const [m7] = await esperarMensaje(`AD-${sufijo}`);
    if (m7) {
      const { data: conv } = await admin(`conversations?select=contact_id&id=eq.${m7.conversation_id}`);
      const { data: ct } = await admin(`contacts?select=attribution&id=eq.${conv?.[0]?.contact_id}`);
      const a = ct?.[0]?.attribution ?? {};
      check(a.first_click?.ad_id === `AD-${sufijo}` && a.last_click?.ctwa_clid === `CLID-${sufijo}`, "first_click y last_click con el anuncio", JSON.stringify(a));
    } else check(false, "el mensaje del anuncio está guardado");

    // ── 8. La restricción, por PostgREST ────────────────────────────────────
    titulo("La restricción única de messages, por PostgREST (on_conflict con las tres columnas)");
    if (m1) {
      const fila = { conversation_id: m1.conversation_id, direction: "inbound", platform_message_id: `IN-${sufijo}`, text: "duplicado" };
      const dup = await admin("messages?on_conflict=conversation_id,platform_message_id,direction", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(fila),
      });
      check(dup.status < 300, "el upsert con on_conflict no da error (la restricción existe y PostgREST la encuentra)", `HTTP ${dup.status} ${JSON.stringify(dup.data).slice(0, 160)}`);
      check((await mensajesCon(`IN-${sufijo}`)).length === 1, "el repetido no entró");
      const nulos = await admin("messages", {
        method: "POST",
        body: JSON.stringify([
          { conversation_id: m1.conversation_id, direction: "outbound", platform_message_id: null, text: "fallido 1", status: "failed" },
          { conversation_id: m1.conversation_id, direction: "outbound", platform_message_id: null, text: "fallido 2", status: "failed" },
        ]),
      });
      check(nulos.status < 300 && (nulos.data ?? []).length === 2, "dos envíos fallidos sin identificador entran los dos (los nulos no chocan)", `HTTP ${nulos.status}`);
    } else noConcluyente("la restricción", "no hay conversación del paso 1 para probarla");
  } finally {
    const borrar = await rpcAdmin("delete_secret", { secret_name: "evolution_webhook_secret", workspace_id: espacio });
    check(borrar.status < 300, "se borró el secreto de prueba", `HTTP ${borrar.status}`);
    // Los contactos ANTES que el espacio: desde la 00025 la clave de
    // contact_channels hacia channels es NO ACTION, y borrar el espacio entero
    // con contact_channels adentro falla (encontrado el 08/10/2026 en la
    // primera corrida en verde). Borrar los contactos se lleva en cascada sus
    // canales de contacto, conversaciones y mensajes.
    const sinContactos = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(sinContactos.status < 300, "se borraron los contactos de prueba", `HTTP ${sinContactos.status}`);
  }
});
