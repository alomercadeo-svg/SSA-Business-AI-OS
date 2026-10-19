#!/usr/bin/env node
/**
 * Prueba de F28 para WhatsApp contra el receptor de PRODUCCIÓN, con un aviso
 * firmado de `messages.upsert` que trae una foto. La app le pide el archivo a
 * nuestro Evolution; como la instancia de prueba no existe allá, Evolution
 * responde un error, y la fila tiene que pasar por `fallido`, reintentarse
 * cada 10 minutos (el reintento de `vigilancia-cron`) y quedar `no_disponible`
 * en el quinto intento. Aprobada por Marcos el 19/10/2026, solo para esta
 * prueba.
 *
 * QUÉ PRUEBA Y QUÉ NO. Prueba el camino real: el aviso firmado entra, el
 * receptor marca el intento y guarda el mensaje aparte, el pedido sale hacia
 * Evolution, vuelve un error, la fila queda marcada y el reintento la lleva al
 * quinto intento. NO prueba que Evolution acepte la forma de nuestro pedido:
 * el guard de existencia de la instancia corre antes que el de la clave y
 * antes de leer el cuerpo (`src/api/routes/index.router.ts:41`,
 * `src/api/guards/instance.guard.ts:36` de 2.3.7), así que responde 404 sin
 * mirar nada. Eso queda verificado contra el código de 2.3.7 y con el test
 * simulado (`lib/adjuntos.test.ts`), y se comprueba en la puesta en marcha.
 *
 * EL AVISO está armado desde el código de Evolution 2.3.7: el objeto de
 * `messages.upsert` (`whatsapp.baileys.service.ts:1483`), la forma de
 * `prepareMessage` (4652-4704) y el `mediaKey` como objeto indexado, que es
 * como sale un Uint8Array serializado (`deserializeMessageBuffers`). La clave
 * de descifrado es INVENTADA: no descifra nada.
 *
 * DÓNDE TRABAJA. Nunca en el espacio real. Crea un usuario de prueba
 * (`@ssa-test.local`), que trae su espacio fantasma; en ese espacio guarda un
 * secreto de webhook y un token de instancia GENERADOS ACÁ (no lee ninguno que
 * ya exista), y un canal de Evolution que es solo una fila, con un nombre de
 * instancia inventado y `umbral_silencio_horas` en nulo, para que la
 * vigilancia de F39 no lo mire. No toca ninguna instancia de Evolution.
 *
 * TRES PASOS, porque el reintento tarda unos 50 minutos y el espacio no se
 * puede borrar antes:
 *   preparar  crea el escenario, manda el aviso, comprueba el primer intento y
 *             que la clave de descifrado no la lee el usuario. NO BORRA NADA.
 *   leer      lee las filas sin contenido. Con --seguir, cada minuto, y anota
 *             cada cambio, hasta `no_disponible` (o 70 minutos).
 *   borrar    borra todo lo que el escenario dejó y lo recuenta. Lo de
 *             `audit_log` no se borra (esa tabla nunca se borra): se cuenta y
 *             se informa.
 * El estado (ids, sin secretos ni contraseñas) va al archivo de --estado.
 *
 * Uso:
 *   node scripts/verify-adjuntos-whatsapp.mjs preparar --estado <archivo>
 *   node scripts/verify-adjuntos-whatsapp.mjs leer --estado <archivo> [--seguir]
 *   node scripts/verify-adjuntos-whatsapp.mjs borrar --estado <archivo>
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SignJWT } from "jose";
import { admin, catalogo, check, comoUsuario, crearUsuario, noConcluyente, rpcAdmin, sufijo, URL_BASE } from "./lib-verificador.mjs";

const [modo] = process.argv.slice(2);
const iEstado = process.argv.indexOf("--estado");
const ARCHIVO = iEstado > 0 ? process.argv[iEstado + 1] : null;
const SEGUIR = process.argv.includes("--seguir");
if (!["preparar", "leer", "borrar"].includes(modo) || !ARCHIVO) {
  console.error("Uso: node scripts/verify-adjuntos-whatsapp.mjs preparar|leer|borrar --estado <archivo> [--seguir]");
  process.exit(1);
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
const hora = (iso) => (iso ? new Date(iso).toLocaleString("es-CR", { timeZone: "America/Costa_Rica", hour12: false }) : "—");
const indexado = (n) => Object.fromEntries([...randomBytes(n)].map((b, i) => [i, b]));

async function fila(estado) {
  const { data } = await admin(
    `messages?select=id,media_intentos,media_status,media_error,media_reclamado_at,created_at&conversation_id=not.is.null&platform_message_id=eq.${encodeURIComponent(estado.platformMessageId)}`,
  );
  return data?.[0] ?? null;
}

async function pendienteDe(messageId) {
  const { data } = await admin(`whatsapp_adjuntos_por_bajar?select=message_id&message_id=eq.${messageId}`);
  return (data ?? []).length;
}

function linea(f, pend) {
  return `${f.id.slice(0, 8)} intentos=${f.media_intentos} estado=${f.media_status} error=${f.media_error ?? "-"} reclamo=${hora(f.media_reclamado_at)} mensaje_guardado=${pend}`;
}

// ── preparar ───────────────────────────────────────────────────────────────
async function preparar() {
  if (!APP_URL.startsWith("https://")) throw new Error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  if (existsSync(ARCHIVO)) throw new Error(`ya hay un estado en ${ARCHIVO}: borrá el escenario anterior primero`);

  const INSTANCIA = `b3-adjuntos-${sufijo}`;
  const SECRETO = randomBytes(32).toString("hex");
  const TOKEN = randomBytes(24).toString("hex");
  const TEL = `5067${String(Date.now()).slice(-7)}`;
  const ID = `IMG-${sufijo}`;

  console.log(`Receptor: ${APP_URL}/api/webhooks/evolution · instancia de prueba ${INSTANCIA}`);
  const u = await crearUsuario("adjuntos-wa");
  const estado = { creado: new Date().toISOString(), usuarioId: u.id, email: u.email, espacio: u.espacio, instancia: INSTANCIA, platformMessageId: ID };
  writeFileSync(ARCHIVO, JSON.stringify(estado, null, 2));

  const canal = await admin("channels", {
    method: "POST",
    body: JSON.stringify({ workspace_id: u.espacio, platform: "whatsapp", provider: "evolution", instance_name: INSTANCIA, is_active: true, umbral_silencio_horas: null }),
  });
  const canalId = canal.data?.[0]?.id;
  if (!canalId) throw new Error(`no se pudo crear el canal de prueba: HTTP ${canal.status}`);
  estado.canalId = canalId;
  writeFileSync(ARCHIVO, JSON.stringify(estado, null, 2));

  for (const [nombre, valor] of [["evolution_webhook_secret", SECRETO], [`evolution_instance_token:${canalId}`, TOKEN]]) {
    const r = await rpcAdmin("store_secret", { secret_name: nombre, secret_value: valor, workspace_id: u.espacio });
    if (r.status >= 300) throw new Error(`no se pudo guardar ${nombre.split(":")[0]}: HTTP ${r.status}`);
  }

  const ahora = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 600)
    .sign(new TextEncoder().encode(SECRETO));
  const data = {
    key: { remoteJid: `${TEL}@s.whatsapp.net`, fromMe: false, id: ID, addressingMode: "pn" },
    pushName: "Lead de prueba",
    message: {
      imageMessage: {
        url: "https://mmg.whatsapp.net/prueba-b3-adjuntos",
        mimetype: "image/jpeg",
        fileLength: 1000,
        height: 10,
        width: 10,
        mediaKey: indexado(32),
        fileSha256: indexado(32),
        fileEncSha256: indexado(32),
        directPath: "/v/t62.7118-24/prueba-b3-adjuntos",
      },
    },
    messageType: "imageMessage",
    messageTimestamp: ahora,
    contextInfo: null,
    source: "android",
  };

  console.log("\n1. El aviso firmado con una foto entra y se acusa");
  const antes = Date.now();
  const res = await fetch(`${APP_URL}/api/webhooks/evolution`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ event: "messages.upsert", instance: INSTANCIA, data, date_time: new Date().toISOString() }),
  });
  const acuse = new Date().toISOString();
  estado.acuse = acuse;
  estado.acuseMs = Date.now() - antes;
  writeFileSync(ARCHIVO, JSON.stringify(estado, null, 2));
  const acuso = check(res.status === 200, `el receptor acusa 200 en ${estado.acuseMs} ms (control positivo de la cañería)`, `HTTP ${res.status}`);
  if (!acuso) {
    noConcluyente("lo que sigue", "el receptor no aceptó un aviso válido");
    return;
  }

  let f = null;
  for (let i = 0; i < 40; i++) {
    f = await fila(estado);
    if (f && f.media_intentos >= 1 && f.media_status !== "pendiente") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!check(Boolean(f), "el mensaje está guardado")) return;
  estado.messageId = f.id;
  writeFileSync(ARCHIVO, JSON.stringify(estado, null, 2));

  console.log("\n2. El primer intento sale DESPUÉS del acuse, y falla con un error de Evolution");
  check(f.media_intentos === 1, "el receptor lo marcó y el after() lo intentó una vez", `intentos=${f.media_intentos}`);
  check(f.media_reclamado_at && new Date(f.media_reclamado_at).getTime() >= new Date(acuse).getTime() - 1000, "el primer reclamo es posterior al acuse", `acuse ${hora(acuse)}, reclamo ${hora(f.media_reclamado_at)}`);
  check(f.media_status === "fallido" && /^http_\d{3}$/.test(f.media_error ?? ""), "queda fallido con el código HTTP de Evolution", `${f.media_status} ${f.media_error}`);
  console.log(`  ${linea(f, await pendienteDe(f.id))}`);

  console.log("\n3. La clave de descifrado: la ve la clave de servicio, no el usuario");
  const conServicio = await pendienteDe(f.id);
  const vio = check(conServicio === 1, "con la clave de servicio, el mensaje guardado está (control positivo)", `${conServicio} filas`);
  const comoOwner = await comoUsuario(u.token, `whatsapp_adjuntos_por_bajar?select=message_id,mensaje&message_id=eq.${f.id}`);
  const filasOwner = Array.isArray(comoOwner.data) ? comoOwner.data.length : 0;
  if (!vio) noConcluyente("el Owner del espacio no la lee", "el control positivo falló: no hay fila que esconder");
  else check(filasOwner === 0, "el Owner del espacio, con su propio token, no la lee", `HTTP ${comoOwner.status}, ${filasOwner} filas`);
  console.log(`  (con el token del Owner: HTTP ${comoOwner.status}, ${filasOwner} filas)`);
  const { data: enMessages } = await admin(`messages?select=attachments&id=eq.${f.id}`);
  check(!JSON.stringify(enMessages ?? []).includes("mediaKey"), "messages no guarda la clave de descifrado");

  console.log(`\nEstado en ${ARCHIVO}. NO se borró nada: el reintento sigue cada 10 minutos.`);
}

// ── leer ───────────────────────────────────────────────────────────────────
async function leer() {
  const estado = JSON.parse(readFileSync(ARCHIVO, "utf8"));
  let ultimo = "";
  const hasta = Date.now() + 70 * 60_000;
  do {
    const f = await fila(estado);
    if (!f) {
      console.log(`${hora()} no hay fila`);
      return;
    }
    const l = linea(f, await pendienteDe(f.id));
    if (l !== ultimo) console.log(`${hora()} ${l}`);
    ultimo = l;
    if (["descargado", "no_disponible"].includes(f.media_status)) return;
    if (SEGUIR) await new Promise((r) => setTimeout(r, 60_000));
  } while (SEGUIR && Date.now() < hasta);
}

// ── borrar ─────────────────────────────────────────────────────────────────
async function borrar() {
  const e = JSON.parse(readFileSync(ARCHIVO, "utf8"));
  console.log(`Borrando el escenario del espacio ${e.espacio.slice(0, 8)} (instancia ${e.instancia})`);

  for (const nombre of ["evolution_webhook_secret", ...(e.canalId ? [`evolution_instance_token:${e.canalId}`] : [])]) {
    const r = await rpcAdmin("delete_secret", { secret_name: nombre, workspace_id: e.espacio });
    check(r.status < 300, `se borra ${nombre.split(":")[0]}`, `HTTP ${r.status}`);
  }
  // Los contactos ANTES que el canal y el espacio (00025: contact_channels → channels es NO ACTION).
  // Se llevan en cascada conversaciones, mensajes y el mensaje guardado de WhatsApp.
  const c = await admin(`contacts?workspace_id=eq.${e.espacio}`, { method: "DELETE" });
  check(c.status < 300, "se borran los contactos (y en cascada conversaciones, mensajes y el mensaje guardado)", `HTTP ${c.status}`);
  const ev = await admin(`webhook_events?event_id=like.${encodeURIComponent(`evolution:${e.instancia}:*`)}`, { method: "DELETE" });
  check(ev.status < 300, "se borran los reclamos del aviso en webhook_events", `HTTP ${ev.status}`);
  if (e.canalId) {
    const ch = await admin(`channels?id=eq.${e.canalId}`, { method: "DELETE" });
    check(ch.status < 300, "se borra el canal", `HTTP ${ch.status}`);
  }
  const au = await fetch(`${URL_BASE}/auth/v1/admin/users/${e.usuarioId}`, {
    method: "DELETE",
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  check(au.status < 300, "se borra el usuario de Auth", `HTTP ${au.status}`);
  const ws = await admin(`workspaces?id=eq.${e.espacio}`, { method: "DELETE" });
  check(ws.status < 300, "se borra el espacio (y en cascada tareas_estado y la membresía)", `HTTP ${ws.status}`);

  console.log("\nRecuento de lo que quedó (tiene que ser 0, salvo audit_log)");
  const contar = async (path) => ((await admin(path)).data ?? []).length;
  const q = {
    workspaces: await contar(`workspaces?select=id&id=eq.${e.espacio}`),
    workspace_members: await contar(`workspace_members?select=user_id&workspace_id=eq.${e.espacio}`),
    channels: await contar(`channels?select=id&workspace_id=eq.${e.espacio}`),
    contacts: await contar(`contacts?select=id&workspace_id=eq.${e.espacio}`),
    conversations: await contar(`conversations?select=id&workspace_id=eq.${e.espacio}`),
    messages: await contar(`messages?select=id&platform_message_id=eq.${encodeURIComponent(e.platformMessageId)}`),
    whatsapp_adjuntos_por_bajar: e.messageId ? await contar(`whatsapp_adjuntos_por_bajar?select=message_id&message_id=eq.${e.messageId}`) : 0,
    webhook_events: await contar(`webhook_events?select=event_id&event_id=like.${encodeURIComponent(`evolution:${e.instancia}:*`)}`),
    tareas_estado: await contar(`tareas_estado?select=clave&workspace_id=eq.${e.espacio}`),
    webhook_alerts: await contar(`webhook_alerts?select=id&workspace_id=eq.${e.espacio}`),
    email_log: await contar(`email_log?select=id&workspace_id=eq.${e.espacio}`),
    integration_configs: await contar(`integration_configs?select=workspace_id&workspace_id=eq.${e.espacio}`),
  };
  const usuario = await fetch(`${URL_BASE}/auth/v1/admin/users/${e.usuarioId}`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  q.auth_users = usuario.status === 404 ? 0 : 1;
  // Solo los NOMBRES de Vault, nunca los valores.
  q.vault_secrets = catalogo(`select count(*)::int as n from vault.secrets where name like 'ws:${e.espacio}:%'`)[0].n;
  q.storage_objects = catalogo(`select count(*)::int as n from storage.objects where bucket_id = 'message-media' and name like '${e.espacio}/%'`)[0].n;
  for (const [t, n] of Object.entries(q)) check(n === 0, `${t}: ${n}`);
  const auditoria = await contar(`audit_log?select=id&workspace_id=eq.${e.espacio}`);
  console.log(`  audit_log del espacio borrado: ${auditoria} filas. No se borran (F31: el historial nunca se borra); quedan huérfanas e invisibles.`);
}

try {
  if (modo === "preparar") await preparar();
  if (modo === "leer") await leer();
  if (modo === "borrar") await borrar();
} catch (err) {
  check(false, "el script se cortó con una excepción", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
