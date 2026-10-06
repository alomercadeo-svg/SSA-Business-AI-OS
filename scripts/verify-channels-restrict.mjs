#!/usr/bin/env node
/**
 * Verificación de la 00025 en la base: borrar un canal con historial falla, y
 * el historial sigue ahí.
 *
 *   1. Un canal de prueba con una conversación y un mensaje: borrarlo tiene que
 *      FALLAR, y después la conversación y el mensaje tienen que seguir.
 *   2. Control positivo: un canal de prueba sin historia se borra bien. Sin
 *      esto, "no se pudo borrar" no distingue entre RESTRICT y cualquier otra
 *      cosa que impida borrar (permisos, una ruta equivocada).
 *
 * Qué cambia el propio script, y por qué el orden: el paso 1 intenta un borrado
 * que, si la protección faltara, se llevaría la conversación en cascada. Por
 * eso la conversación se lee DESPUÉS del intento, y si el borrado pasó, el
 * resultado es un rojo, no "no concluyente".
 *
 * ESTADO ESPERADO: pasa con la 00025 aplicada. Sin ella el paso 1 falla: el
 * canal se borra y la conversación desaparece. Ese es el rojo previo.
 *
 * Uso:
 *   node scripts/verify-channels-restrict.mjs
 *
 * Crea y borra sus propios datos. La limpieza borra primero el contacto (que
 * se lleva conversación y mensaje por su propia clave, la que usa la purga de
 * F30) y recién después el canal, que ya no tiene historia.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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

let fallos = 0;
let pasados = 0;
let noConcluyente = false;
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
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }
  return { status: res.status, data };
}

const sufijo = randomUUID().slice(0, 8);
const limpiar = { contactos: [], canales: [] };

async function crearCanal(nombre) {
  const { status, data } = await admin("channels", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceA,
      platform: "instagram",
      late_account_id: `restrict-${nombre}-${sufijo}`,
      username: `restrict-${nombre}-${sufijo}`,
      is_active: false,
    }),
  });
  if (status >= 300 || !data?.[0]?.id) throw new Error(`no se pudo crear el canal ${nombre}: HTTP ${status}`);
  limpiar.canales.push(data[0].id);
  return data[0].id;
}

let workspaceA = null;

async function main() {
  const { data: wss } = await admin("workspaces?select=id,name");
  workspaceA = wss[0].id;
  console.log(`Workspace: ${wss[0].name} (${workspaceA})\n`);

  // ── 1. Un canal con historia no se borra ──────────────────────────────────
  console.log("1. Canal con una conversación y un mensaje");
  const canalConHistoria = await crearCanal("con-historia");
  const { data: contacto } = await admin("contacts", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, display_name: `restrict-${sufijo}` }),
  });
  limpiar.contactos.push(contacto[0].id);
  const { data: conv } = await admin("conversations", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, channel_id: canalConHistoria, contact_id: contacto[0].id, platform: "instagram" }),
  });
  const { data: msg } = await admin("messages", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conv[0].id, direction: "inbound", text: `restrict ${sufijo}` }),
  });

  const borrado = await admin(`channels?id=eq.${canalConHistoria}`, { method: "DELETE" });
  const sigueConv = await admin(`conversations?select=id&id=eq.${conv[0].id}`);
  const sigueMsg = await admin(`messages?select=id&id=eq.${msg[0].id}`);
  const sigueCanal = await admin(`channels?select=id&id=eq.${canalConHistoria}`);

  check(borrado.status >= 400, "borrar el canal con historia falla",
    `HTTP ${borrado.status}; con la 00025 tendría que ser un error de clave foránea`);
  check(sigueCanal.data?.length === 1, "el canal sigue ahí");
  check(sigueConv.data?.length === 1, "la conversación sigue ahí", "se fue en cascada: falta la protección");
  check(sigueMsg.data?.length === 1, "el mensaje sigue ahí", "se fue en cascada: falta la protección");

  // ── 2. Control positivo: un canal sin historia se borra ───────────────────
  console.log("\n2. Control positivo: canal sin historia");
  const canalVacio = await crearCanal("sin-historia");
  const borradoVacio = await admin(`channels?id=eq.${canalVacio}`, { method: "DELETE" });
  const sigueVacio = await admin(`channels?select=id&id=eq.${canalVacio}`);
  const positivo = borradoVacio.status < 300 && sigueVacio.data?.length === 0;
  check(positivo, "un canal sin historia se borra", `HTTP ${borradoVacio.status}`);
  if (positivo) limpiar.canales = limpiar.canales.filter((id) => id !== canalVacio);
  if (!positivo) {
    console.log("  NO CONCLUYENTE: si tampoco se borra un canal vacío, el fallo del paso 1 no se puede atribuir a RESTRICT.");
    noConcluyente = true;
  }
}

async function cleanup() {
  console.log("\nLimpieza");
  // Primero el contacto: se lleva conversación y mensaje por contact_id. Recién
  // después el canal, que ya no tiene historia y se puede borrar.
  for (const id of limpiar.contactos) await admin(`contacts?id=eq.${id}`, { method: "DELETE" });
  for (const id of limpiar.canales) {
    const r = await admin(`channels?id=eq.${id}`, { method: "DELETE" });
    if (r.status >= 300) check(false, `se borra el canal de prueba ${id}`, `HTTP ${r.status}: quedó en la base`);
  }
  const quedan = await admin(`channels?select=id&username=like.restrict-*-${sufijo}`);
  check(Array.isArray(quedan.data) && quedan.data.length === 0, "no quedaron canales de prueba",
    `quedaron ${quedan.data?.length}`);
}

try {
  await main();
} catch (err) {
  check(false, "el script se cortó con una excepción", err instanceof Error ? err.message : String(err));
} finally {
  await cleanup();
}

console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron${noConcluyente ? ". Veredicto: NO CONCLUYENTE" : ""}`);
process.exit(fallos > 0 || noConcluyente ? 1 : 0);
