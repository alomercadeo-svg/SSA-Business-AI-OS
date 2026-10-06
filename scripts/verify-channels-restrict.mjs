#!/usr/bin/env node
/**
 * Verificación de la 00025 en la base: borrar un canal con historial falla, y
 * el historial sigue ahí. Borrar un workspace entero sigue funcionando.
 *
 * TODO PASA EN UN WORKSPACE DE PRUEBA PROPIO (`verificador-<sufijo>`), creado
 * por el script. No toca el workspace real ni ningún dato del negocio.
 *
 *   a. Un canal con una conversación y un mensaje: borrarlo tiene que FALLAR, y
 *      después la conversación y el mensaje tienen que seguir.
 *   b. Control positivo: un canal sin historia se borra. Sin esto, "no se pudo
 *      borrar" no distingue la protección de cualquier otra cosa que impida
 *      borrar (permisos, una ruta equivocada).
 *   c. Borrar directo el workspace de prueba, con canal, contacto, conversación
 *      y mensaje adentro: tiene que funcionar, y no tiene que quedar nada. Es
 *      el motivo de NO ACTION en vez de RESTRICT: borrar un workspace entero es
 *      una decisión legítima del Owner, y la protección no la puede trabar.
 *
 * Qué cambia el propio script, y por qué el orden: el escenario (a) intenta un
 * borrado que, sin la protección, se llevaría la conversación en cascada. Por
 * eso la conversación y el mensaje se leen DESPUÉS del intento, y si el borrado
 * pasó, el resultado es un rojo. El (c) usa los datos que dejó el (a), que son
 * exactamente los que tiene que poder borrar.
 *
 * ESTADO ESPERADO: pasa con la 00025 aplicada. Sin ella, el (a) falla por la
 * razón correcta: el canal se borra y la conversación y el mensaje desaparecen
 * en cascada. Ese es el rojo previo.
 *
 * Uso:
 *   node scripts/verify-channels-restrict.mjs
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

async function crear(tabla, fila) {
  const { status, data } = await admin(tabla, { method: "POST", body: JSON.stringify(fila) });
  if (status >= 300 || !data?.[0]?.id) throw new Error(`no se pudo crear en ${tabla}: HTTP ${status}`);
  return data[0].id;
}

const existe = async (tabla, id) => ((await admin(`${tabla}?select=id&id=eq.${id}`)).data ?? []).length === 1;

const sufijo = randomUUID().slice(0, 8);
const NOMBRE_WS = `verificador-${sufijo}`;
let wsPrueba = null;
let totalWorkspacesInicial = null;

async function main() {
  totalWorkspacesInicial = ((await admin("workspaces?select=id")).data ?? []).length;

  wsPrueba = await crear("workspaces", { name: NOMBRE_WS, slug: NOMBRE_WS });
  console.log(`Workspace de prueba propio: ${NOMBRE_WS} (${wsPrueba})\n`);

  const canal = (nombre) =>
    crear("channels", {
      workspace_id: wsPrueba,
      platform: "instagram",
      late_account_id: `restrict-${nombre}-${sufijo}`,
      username: `restrict-${nombre}-${sufijo}`,
      is_active: false,
    });

  // ── a. Un canal con historia no se borra ──────────────────────────────────
  console.log("a. Canal con una conversación y un mensaje");
  const canalConHistoria = await canal("con-historia");
  const contacto = await crear("contacts", { workspace_id: wsPrueba, display_name: `restrict-${sufijo}` });
  const conv = await crear("conversations", {
    workspace_id: wsPrueba, channel_id: canalConHistoria, contact_id: contacto, platform: "instagram",
  });
  const msg = await crear("messages", { conversation_id: conv, direction: "inbound", text: `restrict ${sufijo}` });

  const borrado = await admin(`channels?id=eq.${canalConHistoria}`, { method: "DELETE" });
  check(borrado.status >= 400, "borrar el canal con historia falla",
    `HTTP ${borrado.status}; con la 00025 tendría que ser un error de clave foránea`);
  check(await existe("channels", canalConHistoria), "el canal sigue ahí");
  check(await existe("conversations", conv), "la conversación sigue ahí", "se fue en cascada: falta la protección");
  check(await existe("messages", msg), "el mensaje sigue ahí", "se fue en cascada: falta la protección");

  // ── b. Control positivo: un canal sin historia se borra ───────────────────
  console.log("\nb. Control positivo: canal sin historia");
  const canalVacio = await canal("sin-historia");
  const borradoVacio = await admin(`channels?id=eq.${canalVacio}`, { method: "DELETE" });
  const positivo = borradoVacio.status < 300 && !(await existe("channels", canalVacio));
  check(positivo, "un canal sin historia se borra", `HTTP ${borradoVacio.status}`);
  if (!positivo) {
    console.log("  NO CONCLUYENTE: si tampoco se borra un canal vacío, el fallo de (a) no se puede atribuir a la protección.");
    noConcluyente = true;
  }

  // ── c. Borrar el workspace entero funciona y no deja nada ─────────────────
  console.log("\nc. Borrar el workspace de prueba, con canal, contacto, conversación y mensaje");
  const canalDeC = (await existe("channels", canalConHistoria)) ? canalConHistoria : await canal("para-c");
  const borradoWs = await admin(`workspaces?id=eq.${wsPrueba}`, { method: "DELETE" });
  check(borradoWs.status < 300, "borrar el workspace de prueba funciona",
    `HTTP ${borradoWs.status}: la protección traba el borrado de un workspace entero`);
  const quedan = {
    workspace: await existe("workspaces", wsPrueba),
    canal: await existe("channels", canalDeC),
    contacto: await existe("contacts", contacto),
    conversacion: await existe("conversations", conv),
    mensaje: await existe("messages", msg),
  };
  check(!Object.values(quedan).some(Boolean), "no queda nada del workspace de prueba", JSON.stringify(quedan));
  if (!quedan.workspace) wsPrueba = null;
}

async function cleanup() {
  console.log("\nLimpieza");
  if (wsPrueba) {
    // Solo si (c) no llegó a borrarlo: contactos primero (se llevan sus
    // conversaciones y mensajes), después canales, después el workspace.
    await admin(`contacts?workspace_id=eq.${wsPrueba}`, { method: "DELETE" });
    await admin(`channels?workspace_id=eq.${wsPrueba}`, { method: "DELETE" });
    const r = await admin(`workspaces?id=eq.${wsPrueba}`, { method: "DELETE" });
    if (r.status >= 300) check(false, "se borra el workspace de prueba en la limpieza", `HTTP ${r.status}`);
  }
  const wsQuedan = (await admin(`workspaces?select=id&name=like.verificador-*`)).data ?? [];
  check(wsQuedan.length === 0, "no quedó ningún workspace de prueba", `quedaron ${wsQuedan.length}`);
  const canalesQuedan = (await admin(`channels?select=id&username=like.restrict-*`)).data ?? [];
  check(canalesQuedan.length === 0, "no quedó ningún canal de prueba", `quedaron ${canalesQuedan.length}`);
  if (totalWorkspacesInicial !== null) {
    const total = ((await admin("workspaces?select=id")).data ?? []).length;
    check(total === totalWorkspacesInicial, "la cantidad de workspaces es la del principio",
      `al empezar ${totalWorkspacesInicial}, al terminar ${total}`);
  }
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
