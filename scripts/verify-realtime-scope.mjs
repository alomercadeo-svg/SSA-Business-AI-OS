#!/usr/bin/env node
/**
 * Verificación de F3 en Realtime: un Member suscrito a `conversations` y
 * `messages` NO recibe eventos de lo que está fuera de su scope.
 *
 * Por qué hace falta aparte de verify-lead-scope.mjs: ese prueba PostgREST, que
 * es una consulta con la RLS adelante. Realtime es otro camino — el servidor
 * empuja cada cambio a los suscriptores — y decide a quién mandarle cada fila
 * evaluando la policy de SELECT con el token de cada uno. Son dos caminos
 * distintos que pueden estar de acuerdo o no. Si Realtime no respetara la
 * policy, la bandeja de un Member recibiría en vivo los mensajes de los leads
 * de sus compañeros aunque al recargar no los viera.
 *
 * La bandeja usa esto de verdad: `conversation-list.tsx` y `message-thread.tsx`
 * se suscriben por `postgres_changes`, y `conversations` y `messages` están en
 * la publicación `supabase_realtime` desde la migración 00001.
 *
 * LÍMITE CONOCIDO, y no es un agujero de esta implementación: **los eventos de
 * DELETE no los filtra la RLS.** Postgres solo entrega la clave primaria vieja
 * en el WAL para un DELETE, así que Realtime no tiene columnas contra las que
 * evaluar la policy y manda el evento a todos los suscriptores de la tabla. Lo
 * que viaja es un UUID, sin contenido del lead. La app no borra conversaciones
 * ni mensajes desde la interfaz, y el soft delete del Bloque 3 es un UPDATE, que
 * sí se filtra. Se verifica lo que se puede verificar y queda escrito el resto.
 *
 * Uso:
 *   node scripts/verify-realtime-scope.mjs
 *
 * Crea y borra sus propios datos. La limpieza corre en un finally.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

/**
 * Temporizado.
 *
 * El riesgo de este script no es equivocarse, es pasar sin probar nada: si la
 * suscripción todavía no está caliente cuando se provocan los cambios, no llega
 * ningún evento, y "no recibe la conversación ajena" se cumple trivialmente.
 * Pasó en la primera corrida. Por eso hay un canario y una espera con
 * condición, en vez de un sleep fijo y fe.
 */
const ESPERA_MAX_MS = 15000;
/** Margen extra tras recibir lo propio, por si lo ajeno viniera más lento. */
const GRACIA_MS = 3000;

// ── Helpers ─────────────────────────────────────────────────────────────────

let fallos = 0;
let pasados = 0;

function check(cond, desc, detalle) {
  if (cond) {
    pasados++;
    console.log(`  ok    ${desc}`);
  } else {
    fallos++;
    console.log(`  FALLA ${desc}`);
    if (detalle !== undefined) console.log(`        ${detalle}`);
  }
}

async function admin(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  return { status: res.status, data: txt ? JSON.parse(txt) : null };
}

async function auth(path, init = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  return { status: res.status, data: txt ? JSON.parse(txt) : null };
}

async function tokenDe(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`no se pudo autenticar a ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera hasta que `condicion()` se cumpla. Devuelve si se cumplió. */
async function esperarHasta(condicion, limiteMs = ESPERA_MAX_MS, pasoMs = 250) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    if (condicion()) return true;
    await esperar(pasoMs);
  }
  return condicion();
}

// ── Estado a limpiar ────────────────────────────────────────────────────────

const sufijo = randomUUID().slice(0, 8);
const limpiar = { usuarios: [], workspaces: [], canales: [], contactos: [] };
let workspaceA = null;
let cliente = null;

async function crearUsuario(nombre) {
  const email = `rt-${nombre}-${sufijo}@ssa-test.local`;
  const password = `Probe-${randomUUID()}`;
  const { data } = await auth("admin/users", {
    method: "POST",
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: { full_name: `Realtime ${nombre}` },
    }),
  });
  if (!data?.id) throw new Error(`no se pudo crear al usuario ${nombre}: ${JSON.stringify(data).slice(0, 200)}`);
  limpiar.usuarios.push(data.id);

  await esperar(1200);
  const { data: ms } = await admin(`workspace_members?select=workspace_id&user_id=eq.${data.id}`);
  for (const m of ms ?? []) limpiar.workspaces.push(m.workspace_id);

  return { id: data.id, email, password };
}

// ── Verificación ────────────────────────────────────────────────────────────

async function main() {
  const { data: wss } = await admin("workspaces?select=id,name");
  workspaceA = wss[0].id;
  const totalInicial = wss.length;
  console.log(`Workspace: ${wss[0].name} (${workspaceA})`);
  console.log(`Espera máxima por evento: ${ESPERA_MAX_MS} ms, gracia: ${GRACIA_MS} ms\n`);

  // ── Escenario ───────────────────────────────────────────────────────────
  const member = await crearUsuario("member");
  const otro = await crearUsuario("otro");

  for (const u of [member, otro]) {
    await admin("workspace_members", {
      method: "POST",
      body: JSON.stringify({ workspace_id: workspaceA, user_id: u.id, role: "member" }),
    });
  }

  const contacto = async (nombre, setterId) => {
    const { data } = await admin("contacts", {
      method: "POST",
      body: JSON.stringify({ workspace_id: workspaceA, display_name: `${nombre}-${sufijo}`, setter_id: setterId }),
    });
    limpiar.contactos.push(data[0].id);
    return data[0].id;
  };

  const cPropio = await contacto("rt-propio", member.id);
  const cAjeno = await contacto("rt-ajeno", otro.id);

  const { data: canal } = await admin("channels", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceA,
      platform: "instagram",
      late_account_id: `rt-test-${sufijo}`,
      username: `rt-test-${sufijo}`,
      is_active: false,
    }),
  });
  limpiar.canales.push(canal[0].id);

  const conversacion = async (contactId, assignedTo) => {
    const { data } = await admin("conversations", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceA,
        channel_id: canal[0].id,
        contact_id: contactId,
        platform: "instagram",
        assigned_to: assignedTo,
      }),
    });
    return data[0].id;
  };

  const convPropia = await conversacion(cPropio, member.id);
  const convAjena = await conversacion(cAjeno, otro.id);

  // ── Suscripción con el token del Member ─────────────────────────────────
  const token = await tokenDe(member.email, member.password);

  cliente = createClient(URL_BASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Lo que hace que la RLS aplique: sin esto el socket va como `anon`.
  await cliente.realtime.setAuth(token);

  const recibidos = { conversations: [], messages: [] };

  const suscripto = await new Promise((resolver, rechazar) => {
    const canalRt = cliente
      .channel(`scope-${sufijo}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" },
        (p) => recibidos.conversations.push(p.new?.id ?? p.old?.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" },
        (p) => recibidos.messages.push(p.new?.conversation_id ?? null))
      .subscribe((estado, err) => {
        if (estado === "SUBSCRIBED") resolver(true);
        if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") rechazar(err ?? new Error(estado));
      });
    setTimeout(() => rechazar(new Error("la suscripción no llegó a SUBSCRIBED")), 15000);
    return canalRt;
  });

  check(suscripto === true, "el Member logra suscribirse a Realtime");

  // ── Canario: probar que el pipe está vivo ANTES de medir nada ───────────
  // `SUBSCRIBED` dice que el socket se abrió, no que el servidor ya esté
  // empujando cambios. Si se midiera sin esto y el pipe estuviera frío, no
  // llegaría ningún evento y "no recibe la ajena" se cumpliría por vacío: el
  // script daría verde sin haber probado nada.
  console.log("\nCanario: esperando el primer evento de la conversación propia...");
  await admin(`conversations?id=eq.${convPropia}`, {
    method: "PATCH",
    body: JSON.stringify({ last_message_preview: `canario ${sufijo}` }),
  });

  const pipeVivo = await esperarHasta(() => recibidos.conversations.includes(convPropia));
  check(pipeVivo, "el pipe de Realtime entrega eventos (canario)",
    `no llegó ningún evento de la conversación propia en ${ESPERA_MAX_MS} ms; ` +
    `sin esto el resto del script no probaría nada`);

  if (!pipeVivo) {
    console.log("\n  Sin canario no hay veredicto posible: el resultado sería un verde falso.");
    return totalInicial;
  }

  // ── Provocar los cambios con service role ───────────────────────────────
  recibidos.conversations.length = 0;
  recibidos.messages.length = 0;

  console.log("Provocando cambios en las dos conversaciones...");

  for (const [id, etiqueta] of [[convPropia, "propia"], [convAjena, "ajena"]]) {
    await admin(`conversations?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ last_message_preview: `cambio ${etiqueta} ${sufijo}` }),
    });
    await admin("messages", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: id,
        direction: "inbound",
        text: `mensaje ${etiqueta} ${sufijo}`,
      }),
    });
  }

  // Se espera a que llegue lo PROPIO, y recién entonces se da un margen extra
  // por si lo ajeno viniera más lento. Así el veredicto no depende de que un
  // sleep fijo haya sido suficiente.
  const llegoLoPropio = await esperarHasta(
    () => recibidos.conversations.includes(convPropia) && recibidos.messages.includes(convPropia)
  );
  await esperar(GRACIA_MS);

  // ── Veredicto ───────────────────────────────────────────────────────────
  if (!llegoLoPropio) {
    console.log("\n  Aviso: no llegó todo lo propio dentro de la ventana. Lo que sigue puede ser un verde falso.");
  }

  console.log("\n1. Conversaciones");
  check(recibidos.conversations.includes(convPropia),
    "recibe el cambio de SU conversación",
    `llegaron ${recibidos.conversations.length} eventos: ${JSON.stringify(recibidos.conversations)}`);
  check(!recibidos.conversations.includes(convAjena),
    "NO recibe el cambio de la conversación ajena",
    `llegaron ${recibidos.conversations.length} eventos: ${JSON.stringify(recibidos.conversations)}`);

  console.log("\n2. Mensajes");
  check(recibidos.messages.includes(convPropia),
    "recibe el mensaje de SU conversación",
    `llegaron ${recibidos.messages.length} eventos: ${JSON.stringify(recibidos.messages)}`);
  check(!recibidos.messages.includes(convAjena),
    "NO recibe el mensaje de la conversación ajena",
    `llegaron ${recibidos.messages.length} eventos: ${JSON.stringify(recibidos.messages)}`);

  return totalInicial;
}

// ── Limpieza ────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log("\nLimpieza");
  try {
    if (cliente) await cliente.removeAllChannels();
  } catch {}
  for (const id of limpiar.canales) await admin(`channels?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.contactos) await admin(`contacts?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.usuarios) await auth(`admin/users/${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.workspaces) await admin(`workspaces?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  console.log(
    `  ${limpiar.usuarios.length} usuarios, ${limpiar.workspaces.length} workspaces, ` +
    `${limpiar.canales.length} canales y ${limpiar.contactos.length} contactos de prueba borrados`
  );
}

let totalInicial = null;
try {
  totalInicial = await main();
} catch (err) {
  check(false, "el script se cortó con una excepción", err instanceof Error ? err.stack : String(err));
} finally {
  await cleanup();
}

if (totalInicial !== null) {
  const { data: wsFinales } = await admin("workspaces?select=id");
  check(wsFinales.length === totalInicial, "no quedaron workspaces de prueba",
    `al empezar ${totalInicial}, al terminar ${wsFinales.length}`);
}

console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron`);
process.exit(fallos > 0 ? 1 : 0);
