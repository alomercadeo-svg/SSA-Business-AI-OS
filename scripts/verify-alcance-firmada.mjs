#!/usr/bin/env node
/**
 * F28, 5f con usuarios reales: la dirección firmada de un adjunto la recibe
 * solo quien puede ver el lead. Contra `GET /api/v1/messages` de PRODUCCIÓN,
 * con la sesión real de un Owner y de un Member, en un espacio fantasma que
 * este script crea y borra en la misma corrida. Nunca en «Ale Admin's
 * Workspace».
 *
 * EL ESCENARIO. Un Owner (que trae su espacio fantasma por `handle_new_user`)
 * y un Member sumado a ese espacio. Dos leads con un mensaje `descargado` cada
 * uno y un PNG chico subido a `message-media` en la ruta del espacio fantasma:
 *   - el lead A, asignado al Owner (setter y conversación): fuera del alcance
 *     del Member por la RLS de la 00019, aunque el espacio deje ver los leads
 *     sin asignar;
 *   - el lead B, asignado al Member: dentro de su alcance.
 *
 * LOS CONTROLES (las reglas de verificación del CLAUDE.md):
 *   - el Owner recibe la dirección firmada de A, y la dirección sirve el
 *     archivo (control positivo del camino entero);
 *   - el Member recibe la de B: su sesión funciona, así que un 403 en A no es
 *     una cookie mal armada (si B falla, lo de A es «no concluyente»);
 *   - el Member pide A y recibe 403, sin ninguna dirección ni la ruta.
 *
 * LA SESIÓN va como la arma `@supabase/ssr` 0.8.0: la cookie
 * `sb-<ref>-auth-token`, con el prefijo `base64-` y la sesión en base64url
 * (`dist/main/cookies.js:7` y `:311`), en partes de 3180 caracteres
 * (`dist/main/utils/chunker.js:8`).
 *
 * Al final borra los objetos de Storage, los contactos (que se llevan
 * conversaciones y mensajes), el canal, los dos usuarios y los dos espacios
 * fantasma, y lo recuenta.
 *
 * Uso: node scripts/verify-alcance-firmada.mjs
 */
import { randomUUID } from "node:crypto";
import { admin, catalogo, check, correr, crearContacto, limpiar, noConcluyente, sumarAlEspacio, sufijo, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

/** Alta con contraseña al azar que solo vive en memoria, y la sesión entera. */
async function usuario(nombre) {
  const email = `b3-${nombre}-${sufijo}@ssa-test.local`;
  const password = `Probe-${randomUUID()}`;
  const alta = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `B3 ${nombre}` } }),
  }).then((r) => r.json());
  if (!alta?.id) throw new Error(`no se pudo crear al usuario ${nombre}`);
  limpiar.usuarios.push(alta.id);
  let espacio = null;
  for (let i = 0; i < 10 && !espacio; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const { data } = await admin(`workspace_members?select=workspace_id&user_id=eq.${alta.id}`);
    espacio = data?.[0]?.workspace_id ?? null;
  }
  if (!espacio) throw new Error(`el alta de ${nombre} no creó su espacio`);
  limpiar.workspaces.push(espacio);
  const sesion = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (!sesion?.access_token) throw new Error(`no se pudo autenticar a ${nombre}`);
  return { id: alta.id, email, espacio, sesion };
}

function cookieDe(sesion) {
  const valor = `base64-${Buffer.from(JSON.stringify(sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  if (valor.length <= 3180) return `${nombre}=${valor}`;
  const partes = [];
  for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  return partes.join("; ");
}

async function leer(u, conversacion) {
  const res = await fetch(`${APP_URL}/api/v1/messages?conversationId=${conversacion}`, {
    headers: { Cookie: cookieDe(u.sesion) },
    redirect: "manual",
  });
  const texto = await res.text();
  let cuerpo = null;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = null;
  }
  return { status: res.status, texto, cuerpo };
}

const rutas = [];

async function leadConArchivo(espacio, canalId, asignadoA, etiqueta) {
  const contacto = await crearContacto(espacio, { setter_id: asignadoA });
  const conv = await admin("conversations", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, channel_id: canalId, contact_id: contacto.id, platform: "whatsapp", status: "open", assigned_to: asignadoA, historial_estado: "completo" }),
  });
  const convId = conv.data?.[0]?.id;
  if (!convId) throw new Error(`no se pudo crear la conversación ${etiqueta}: HTTP ${conv.status}`);
  const msg = await admin("messages", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: convId,
      direction: "inbound",
      platform_message_id: `FIRMA-${etiqueta}-${sufijo}`,
      remote_jid: `firma-${sufijo}`,
      attachments: [{ type: "image" }],
      message_type: "imagen",
      media_status: "descargado",
      media_intentos: 1,
      status: "sent",
      created_at: new Date().toISOString(),
    }),
  });
  const msgId = msg.data?.[0]?.id;
  if (!msgId) throw new Error(`no se pudo crear el mensaje ${etiqueta}: HTTP ${msg.status}`);
  const ruta = `${espacio}/${convId}/${msgId}/archivo.png`;
  const subida = await fetch(`${URL_BASE}/storage/v1/object/message-media/${ruta}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/png" },
    body: PNG,
  });
  if (subida.status >= 300) throw new Error(`no se pudo subir el archivo ${etiqueta}: HTTP ${subida.status}`);
  rutas.push(ruta);
  await admin(`messages?id=eq.${msgId}`, {
    method: "PATCH",
    body: JSON.stringify({ media_path: ruta, media_mime: "image/png", media_bytes: PNG.byteLength }),
  });
  return { convId, msgId, ruta };
}

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo`);
  const owner = await usuario("firma-owner");
  const member = await usuario("firma-member");
  const espacio = owner.espacio;
  await sumarAlEspacio(espacio, member, "member");

  const canal = await admin("channels", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, platform: "whatsapp", provider: "evolution", instance_name: `b3-firma-${sufijo}`, is_active: false, umbral_silencio_horas: null }),
  });
  const canalId = canal.data?.[0]?.id;
  if (!canalId) throw new Error(`no se pudo crear el canal: HTTP ${canal.status}`);
  limpiar.canales.push(canalId);

  try {
    const A = await leadConArchivo(espacio, canalId, owner.id, "A");
    const B = await leadConArchivo(espacio, canalId, member.id, "B");

    console.log("\n1. El Owner recibe la dirección firmada del lead A, y sirve el archivo (control positivo)");
    const o = await leer(owner, A.convId);
    const urlOwner = o.cuerpo?.messages?.[0]?.archivo?.url ?? null;
    const okOwner = check(o.status === 200 && typeof urlOwner === "string", "200 con la dirección firmada", `HTTP ${o.status}`);
    if (okOwner) {
      check(urlOwner.includes("/storage/v1/object/sign/message-media/"), "es una dirección firmada del bucket privado");
      const archivo = await fetch(urlOwner);
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      check(archivo.status === 200 && bytes.byteLength === PNG.byteLength && bytes[1] === 0x50, "la dirección firmada sirve el archivo", `HTTP ${archivo.status}, ${bytes.byteLength} bytes`);
      check(!Object.prototype.hasOwnProperty.call(o.cuerpo.messages[0], "media_path"), "media_path no viaja como campo");
    }

    console.log("\n2. El Member recibe la de su lead B: su sesión funciona (control positivo del rol)");
    const mb = await leer(member, B.convId);
    const okMember = check(mb.status === 200 && typeof mb.cuerpo?.messages?.[0]?.archivo?.url === "string", "200 con la dirección firmada de su propio lead", `HTTP ${mb.status}`);

    console.log("\n3. El Member pide el lead A, que es del Owner: 403 y ninguna dirección");
    if (!okOwner || !okMember) {
      noConcluyente("el Member no recibe la dirección del lead A", "falló un control positivo: un 403 no distinguiría alcance de una sesión rota");
    } else {
      const ma = await leer(member, A.convId);
      check(ma.status === 403, "403 para el lead de otro", `HTTP ${ma.status}`);
      check(!ma.texto.includes("/storage/v1/object/sign/") && !ma.texto.includes(A.ruta) && !ma.texto.includes(A.msgId), "la respuesta no trae la dirección, la ruta ni el id del mensaje");
    }
  } finally {
    if (rutas.length > 0) {
      const borrar = await fetch(`${URL_BASE}/storage/v1/object/message-media`, {
        method: "DELETE",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: rutas }),
      });
      check(borrar.status < 300, `se borran los ${rutas.length} archivos de prueba de Storage`, `HTTP ${borrar.status}`);
      const quedan = catalogo(`select count(*)::int as n from storage.objects where bucket_id = 'message-media' and name like '${espacio}/%'`)[0].n;
      check(quedan === 0, `no quedan objetos del espacio fantasma en message-media (${quedan})`);
    }
    const sinContactos = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(sinContactos.status < 300, "se borran los contactos (y en cascada conversaciones y mensajes)", `HTTP ${sinContactos.status}`);
    limpiar.contactos.length = 0;
  }
});
