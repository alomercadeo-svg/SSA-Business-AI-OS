#!/usr/bin/env node
/**
 * F44 (S9, tramo C): los compartidos y los reels en el hilo, contra
 * PRODUCCIÓN, en un espacio fantasma que este script crea y borra. Nunca en el
 * espacio real. Ninguna llamada a Zernio, Evolution, Resend ni Meta: los avisos
 * van a nuestro receptor, firmados con el secreto del espacio fantasma, con el
 * sobre de `lib/fixtures/zernio-webhook-message-received.json` y los adjuntos
 * de `lib/fixtures/zernio-adjuntos-f44.json` (las claves reales del 05/11/2026).
 *
 * NINGUNA DESCARGA LLEGA A META. Lo que el receptor podría intentar bajar (el
 * reel, antes del arreglo, y el video de la cámara, siempre) lleva la dirección
 * cambiada a una ruta inexistente de nuestra app: el intento recibe un 404 de
 * nosotros. La publicación conserva su host (`lookaside.fbsbx.com`) porque un
 * `share` no se baja nunca, ni antes ni después (`TIPOS_CON_ARCHIVO`,
 * lib/adjuntos.ts:77). La regla del host del reel se prueba solo en Vitest.
 *
 * LO QUE PRUEBA:
 *   V  Control positivo: el video de la cámara se marca para bajar
 *      (`media_intentos` no nulo) y el hilo no lo trata como compartido.
 *   R  El reel no se marca (`media_intentos` nulo), no tiene archivo, y el
 *      hilo lo trae como `compartido: "reel"`.
 *   S  La publicación no se marca, no tiene archivo, y el hilo la trae como
 *      `compartido: "publicacion"`, con su enlace de un host de la lista.
 *
 * QUÉ CAMBIA CADA PASO. Cada aviso escribe una fila y se lee enseguida, antes
 * del siguiente. V va primero: si V falla, «R no se marcó» no significa nada
 * (puede ser que no se marque ninguno) y es no concluyente.
 *
 * LOS ROJOS (antes de construir): R, porque el reel se marca para bajar y el
 * hilo no trae `compartido`; S, porque el hilo no trae `compartido`. V, en
 * verde antes y después.
 *
 * Uso: node --env-file=.env scripts/verify-contenido-hilo.mjs
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { admin, check, correr, crearUsuario, limpiar, noConcluyente, sufijo, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const SECRETO_IG = randomBytes(32).toString("hex");
const CUENTA = `vhilo${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const NO_EXISTE = `${APP_URL}/v-contenido-hilo-no-existe/${sufijo}`;
const eventosZernio = [];

const filas = async (path) => (await admin(path)).data ?? [];
let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

const SOBRE = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-received.json", import.meta.url), "utf8")).payload;
const ADJ = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-adjuntos-f44.json", import.meta.url), "utf8"));

async function avisoConAdjunto(lead, adjunto) {
  const id = `v-hilo-evt-${randomUUID()}`;
  eventosZernio.push(id);
  const aviso = structuredClone(SOBRE);
  aviso.id = id;
  aviso.account.id = CUENTA;
  aviso.conversation.participantId = lead;
  aviso.conversation.platformConversationId = lead;
  aviso.conversation.participantUsername = `lead.${lead}`;
  aviso.message.sender.id = lead;
  aviso.message.sender.username = `lead.${lead}`;
  aviso.message.platformMessageId = `mid-${randomUUID()}`;
  aviso.message.sentAt = new Date().toISOString();
  aviso.message.text = null;
  aviso.message.attachments = [adjunto];
  const cuerpo = JSON.stringify(aviso);
  const res = await fetch(`${APP_URL}/api/webhooks/late`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-late-signature": createHmac("sha256", SECRETO_IG).update(cuerpo).digest("hex") },
    body: cuerpo,
  });
  return { status: res.status, mid: aviso.message.platformMessageId };
}

function cookieDe(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacio}`);
  return partes.join("; ");
}

async function hilo(u, espacio, conversationId) {
  const res = await fetch(`${APP_URL}/api/v1/messages?conversationId=${conversationId}`, { headers: { Cookie: cookieDe(u, espacio) }, redirect: "manual" });
  const cuerpo = await res.json().catch(() => null);
  return { status: res.status, mensajes: Array.isArray(cuerpo?.messages) ? cuerpo.messages : [] };
}

const fila = async (mid) =>
  (await filas(`messages?select=id,conversation_id,media_intentos,media_path,media_status&platform_message_id=eq.${encodeURIComponent(mid)}`))[0] ?? null;

let espacioFantasma = null;
let usuariosFantasma = [];

async function principal() {
  const owner = await crearUsuario("hilo-owner");
  usuariosFantasma = [owner.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ webhook_secret: SECRETO_IG, name: `V hilo ${sufijo}` }) });
  console.log(`Espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}`);

  try {
    const canal = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, platform: "instagram", provider: "zernio", late_account_id: CUENTA, username: `cuentah${sufijo}` }) })).data?.[0]?.id;
    if (!canal) throw new Error("no se pudo crear el canal fantasma");
    const lead = `vH${String(Date.now()).slice(-6)}${sufijo}`;

    // ── V: control positivo ─────────────────────────────────────────────────
    titulo("Un video grabado con la cámara (control positivo): se marca para bajar");
    const video = structuredClone(ADJ.videoDeCamara);
    video.url = NO_EXISTE;
    video.payload.url = NO_EXISTE;
    const v = await avisoConAdjunto(lead, video);
    const fv = await fila(v.mid);
    const okV = check(v.status === 200 && fv !== null && fv.media_intentos !== null, "el video de la cámara se marcó para bajar (media_intentos no nulo)", `HTTP ${v.status} · ${JSON.stringify(fv)}`);

    // ── R: el reel ──────────────────────────────────────────────────────────
    titulo("Un reel compartido: no se marca para bajar");
    const reel = structuredClone(ADJ.reel);
    reel.url = NO_EXISTE;
    reel.payload.url = NO_EXISTE;
    const r = await avisoConAdjunto(lead, reel);
    const fr = await fila(r.mid);
    check(r.status === 200 && fr !== null, "el aviso del reel se guardó (presencia)", `HTTP ${r.status}`);
    if (!okV) noConcluyente("el reel no se marcó para bajar", "falló el control positivo (V)");
    else check(fr !== null && fr.media_intentos === null, "el reel no se marcó para bajar (media_intentos nulo)", JSON.stringify(fr));
    check(fr !== null && fr.media_path === null, "el reel no tiene archivo guardado", JSON.stringify(fr));

    // ── S: la publicación ───────────────────────────────────────────────────
    titulo("Una publicación compartida: no se marca y no se baja");
    const s = await avisoConAdjunto(lead, structuredClone(ADJ.publicacion));
    const fs = await fila(s.mid);
    check(s.status === 200 && fs !== null, "el aviso de la publicación se guardó (presencia)", `HTTP ${s.status}`);
    if (!okV) noConcluyente("la publicación no se marcó para bajar", "falló el control positivo (V)");
    else check(fs !== null && fs.media_intentos === null && fs.media_path === null, "la publicación no se marcó ni tiene archivo", JSON.stringify(fs));

    // ── El hilo, como el Owner ──────────────────────────────────────────────
    titulo("El hilo, como el Owner (GET /api/v1/messages)");
    const conv = fv?.conversation_id ?? fr?.conversation_id ?? fs?.conversation_id;
    const h = conv ? await hilo(owner, espacio, conv) : { status: 0, mensajes: [] };
    const porId = new Map(h.mensajes.map((m) => [m.id, m]));
    const okHilo = check(h.status === 200 && [fv, fr, fs].every((f) => f && porId.has(f.id)), "el hilo trae los tres mensajes (presencia)", `HTTP ${h.status} · ${h.mensajes.length} mensajes`);
    const adj = (f) => porId.get(f?.id)?.attachments?.[0] ?? null;
    if (!okHilo) {
      noConcluyente("el reel viene como compartido: reel", "el hilo no trajo los mensajes");
      noConcluyente("la publicación viene como compartido: publicacion, con enlace", "el hilo no trajo los mensajes");
      noConcluyente("el video de la cámara no viene como compartido", "el hilo no trajo los mensajes");
    } else {
      check(adj(fr)?.compartido === "reel", "el reel viene como compartido: reel", JSON.stringify(adj(fr)));
      const ap = adj(fs);
      check(ap?.compartido === "publicacion" && typeof ap?.enlace === "string" && new URL(ap.enlace).hostname === "lookaside.fbsbx.com", "la publicación viene como compartido: publicacion, con su enlace de la lista", JSON.stringify(ap));
      check(adj(fv) !== null && !adj(fv)?.compartido && !adj(fv)?.enlace, "el video de la cámara no viene como compartido ni con enlace", JSON.stringify(adj(fv)));
    }
  } finally {
    for (const id of eventosZernio) await admin(`webhook_events?event_id=eq.${id}`, { method: "DELETE" });
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
  check((await cuenta(`webhook_events?select=event_id&event_id=like.v-hilo-evt-*`)) === 0, "webhook_events de Zernio: 0");
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log de los espacios fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
