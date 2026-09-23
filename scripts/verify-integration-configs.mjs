#!/usr/bin/env node
/**
 * Verificación de F24 en la base: `integration_configs` es solo de Owner y Admin,
 * por API y por Realtime.
 *
 * Lo que comprueba, y la contraparte de cada negativo:
 *   1. Por API: un Member no lee ninguna fila del workspace. Contraparte: un
 *      manager (Admin de prueba) lee la fila de prueba. Si el manager no la lee,
 *      el negativo del Member no dice nada y el veredicto es "no concluyente".
 *   2. Por Realtime: un Member suscrito a la tabla no recibe el cambio de estado.
 *      Canario: el mismo cambio le tiene que llegar antes al manager suscrito. Si
 *      no le llega, el pipe estaba frío o la tabla no está en la publicación, y
 *      "el Member no lo recibió" se cumpliría por vacío: "no concluyente".
 *
 * El canario es un Admin y no un Owner: la política exige
 * `is_workspace_manager`, que cubre a los dos, y sumar un Owner de prueba al
 * workspace real le daría además acceso a las alertas de sistema mientras dura
 * la corrida.
 *
 * Los pasos que preparan la condición y los que la leen van juntos: el único
 * cambio que se provoca es el del canario, y el veredicto del Member se lee
 * sobre ese mismo evento, después de un margen.
 *
 * ESTADO ESPERADO: pasa con la 00024 aplicada. Sin ella falla, porque la tabla
 * no existe y la fila de prueba no se puede crear. Ese es el rojo previo.
 *
 * Uso:
 *   node scripts/verify-integration-configs.mjs
 *
 * Crea y borra sus propios datos. La limpieza corre en un finally.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

const ESPERA_MAX_MS = 15000;
const GRACIA_MS = 3000;

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
  return { status: res.status, data: txt ? JSON.parse(txt) : null };
}

async function comoUsuario(token, path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
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
  if (!j.access_token) throw new Error(`no se pudo autenticar a ${email}`);
  return j.access_token;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarHasta(condicion, limiteMs = ESPERA_MAX_MS, pasoMs = 250) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    if (condicion()) return true;
    await esperar(pasoMs);
  }
  return condicion();
}

const sufijo = randomUUID().slice(0, 8);
const PROVEEDOR_PRUEBA = `verificador-${sufijo}`;
const limpiar = { usuarios: [], workspaces: [], filas: [] };
const clientes = [];
let workspaceA = null;

async function crearUsuario(nombre, rol) {
  const email = `ic-${nombre}-${sufijo}@ssa-test.local`;
  const password = `Probe-${randomUUID()}`;
  const { data } = await auth("admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Integraciones ${nombre}` } }),
  });
  if (!data?.id) throw new Error(`no se pudo crear al usuario ${nombre}`);
  limpiar.usuarios.push(data.id);

  await esperar(1200);
  const { data: ms } = await admin(`workspace_members?select=workspace_id&user_id=eq.${data.id}`);
  for (const m of ms ?? []) limpiar.workspaces.push(m.workspace_id);

  await admin("workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, user_id: data.id, role: rol }),
  });
  return { id: data.id, email, password };
}

async function suscribir(token, recibidos) {
  const cliente = createClient(URL_BASE, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  clientes.push(cliente);
  await cliente.realtime.setAuth(token);
  await new Promise((resolver, rechazar) => {
    cliente
      .channel(`ic-${sufijo}-${clientes.length}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "integration_configs" },
        (p) => recibidos.push(p.new?.id ?? p.old?.id))
      .subscribe((estado, err) => {
        if (estado === "SUBSCRIBED") resolver(true);
        if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") rechazar(err ?? new Error(estado));
      });
    setTimeout(() => rechazar(new Error("la suscripción no llegó a SUBSCRIBED")), 15000);
  });
}

async function main() {
  const { data: wss } = await admin("workspaces?select=id,name");
  workspaceA = wss[0].id;
  const totalInicial = wss.length;
  console.log(`Workspace: ${wss[0].name} (${workspaceA})\n`);

  // La fila de prueba. Si la tabla no existe (00024 sin aplicar), esto falla y
  // el script lo dice: es el rojo previo, no un verde.
  const { status, data: fila } = await admin("integration_configs", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceA, tipo: "canal", proveedor: PROVEEDOR_PRUEBA,
      nombre: `Prueba del verificador ${sufijo}`, estado: "sin_configurar",
    }),
  });
  if (status >= 300 || !fila?.[0]?.id) {
    check(false, "se puede crear una fila de prueba en integration_configs",
      `HTTP ${status}. Si la tabla no existe, falta aplicar la 00024.`);
    noConcluyente = true;
    return totalInicial;
  }
  const idFila = fila[0].id;
  limpiar.filas.push(idFila);

  const manager = await crearUsuario("admin", "admin");
  const member = await crearUsuario("member", "member");
  const tManager = await tokenDe(manager.email, manager.password);
  const tMember = await tokenDe(member.email, member.password);

  // ── 1. API ──────────────────────────────────────────────────────────────
  console.log("1. Lectura por API");
  const leeManager = await comoUsuario(tManager, `integration_configs?select=id&workspace_id=eq.${workspaceA}`);
  const managerLaVe = Array.isArray(leeManager.data) && leeManager.data.some((f) => f.id === idFila);
  check(managerLaVe, "un manager lee la fila de prueba (contraparte afirmativa)",
    `HTTP ${leeManager.status}, ${JSON.stringify(leeManager.data).slice(0, 160)}`);

  const leeMember = await comoUsuario(tMember, `integration_configs?select=id&workspace_id=eq.${workspaceA}`);
  if (!managerLaVe) {
    console.log("  NO CONCLUYENTE: sin la contraparte, que el Member no lea nada no prueba la RLS.");
    noConcluyente = true;
  } else {
    check(leeMember.status === 200 && Array.isArray(leeMember.data) && leeMember.data.length === 0,
      "un Member no lee ninguna fila del workspace",
      `HTTP ${leeMember.status}, ${JSON.stringify(leeMember.data).slice(0, 160)}`);
  }

  // ── 2. Realtime ─────────────────────────────────────────────────────────
  console.log("\n2. Realtime");
  const recibeManager = [];
  const recibeMember = [];
  await suscribir(tManager, recibeManager);
  await suscribir(tMember, recibeMember);

  await admin(`integration_configs?id=eq.${idFila}`, {
    method: "PATCH",
    body: JSON.stringify({ estado: "sin_verificar", ultimo_error: `canario ${sufijo}`, updated_at: new Date().toISOString() }),
  });

  const canario = await esperarHasta(() => recibeManager.includes(idFila));
  check(canario, "el manager recibe el cambio de estado (canario)",
    `no llegó en ${ESPERA_MAX_MS} ms: pipe frío o tabla fuera de la publicación`);

  if (!canario) {
    console.log("  NO CONCLUYENTE: sin canario, que el Member no reciba nada no prueba nada.");
    noConcluyente = true;
    return totalInicial;
  }

  await esperar(GRACIA_MS);
  check(!recibeMember.includes(idFila), "un Member suscrito NO recibe el cambio de estado",
    `el Member recibió: ${JSON.stringify(recibeMember)}`);

  return totalInicial;
}

async function cleanup() {
  console.log("\nLimpieza");
  for (const c of clientes) {
    try { await c.removeAllChannels(); } catch {}
  }
  for (const id of limpiar.filas) await admin(`integration_configs?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.usuarios) await auth(`admin/users/${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.workspaces) await admin(`workspaces?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  console.log(`  ${limpiar.filas.length} filas, ${limpiar.usuarios.length} usuarios y ${limpiar.workspaces.length} workspaces de prueba borrados`);
}

let totalInicial = null;
try {
  totalInicial = await main();
} catch (err) {
  check(false, "el script se cortó con una excepción", err instanceof Error ? err.message : String(err));
} finally {
  await cleanup();
}

if (totalInicial !== null) {
  const { data: wsFinales } = await admin("workspaces?select=id");
  check(wsFinales.length === totalInicial, "no quedaron workspaces de prueba",
    `al empezar ${totalInicial}, al terminar ${wsFinales.length}`);
}

console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron${noConcluyente ? ". Veredicto: NO CONCLUYENTE" : ""}`);
process.exit(fallos > 0 || noConcluyente ? 1 : 0);
