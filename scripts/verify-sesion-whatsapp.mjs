#!/usr/bin/env node
/**
 * Verificación de F32 contra producción, en un espacio de prueba: el estado de
 * sesión que escribe el receptor, el correo de la caída y de «se agotaron los
 * intentos», su control negativo, y (con `--esperar-chequeo`) el chequeo
 * periódico real que deja «no se pudo verificar» sin correo.
 *
 * MANDA CORREOS DE VERDAD (dos, a `--para`). Por eso, como
 * `verify-correo-alertas.mjs`:
 *   - corre solo contra el espacio que se le pasa, y se niega si tiene otro
 *     miembro que el Owner `--para`, si tiene canales, si Resend no está
 *     conectado, o si ya tiene un secreto de webhook de Evolution guardado;
 *   - sin `--correr` no escribe ni manda nada: comprueba e imprime a quién le
 *     llegaría.
 *
 * NO LLAMA A NUESTRO EVOLUTION. Los dos canales son solo filas en `channels`,
 * con instancias inventadas, y los avisos se los manda el script al receptor
 * de producción, firmados con un secreto que genera y borra al final. Los
 * canales no tienen token de instancia en Vault, así que el chequeo periódico
 * los deja en «no se pudo verificar» con motivo `sin_credencial` SIN llamar a
 * Evolution (`lib/chequeo-sesion-whatsapp.ts`). Es una simulación de Evolution:
 * no cuenta como dato real (regla del 19/10/2026).
 *
 * LOS PARES AVISO → LECTURA, Y EL CRON (condición 4 de Marcos, 02/11/2026). El
 * chequeo real corre cada 10 minutos y puede pasar un canal a «no se pudo
 * verificar» entre un aviso y su lectura. Cada par lee la marca de la tarea
 * `sesion_whatsapp:<espacio>` antes del aviso y después de la lectura (y del
 * conteo de correos): si cambió, ese par es NO CONCLUYENTE, nunca verde, y el
 * script sale con 2 sin reintentar.
 *
 * LOS CANALES:
 *   B (control positivo): `open` pone la marca de vinculado; `close` da caído y
 *     un correo `sesion_whatsapp` enviado; `refused` da agotado y otro correo.
 *   A (negativo): `close` sin marca da «sin vincular» y NINGUNA fila de correo
 *     con su clave. La reserva del techo siempre escribe una fila, aunque sea
 *     `omitido_techo`, así que «ninguna fila» no se confunde con el techo.
 *
 * Uso:
 *   node scripts/verify-sesion-whatsapp.mjs <workspace_id> --para <correo>                 (solo comprueba)
 *   node scripts/verify-sesion-whatsapp.mjs <workspace_id> --para <correo> --correr        (escribe y manda)
 *     [--pausa]            se detiene con B caído, para mirar Canales y la Bandeja
 *     [--esperar-chequeo]  al final espera la corrida siguiente del chequeo (hasta 12 min)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { SignJWT } from "jose";

// ── Entorno ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const faltantes = [
  ["NEXT_PUBLIC_APP_URL", APP_URL],
  ["NEXT_PUBLIC_SUPABASE_URL", URL_BASE],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
].filter(([, v]) => !v).map(([k]) => k);
if (faltantes.length > 0) {
  console.error(`Faltan en .env: ${faltantes.join(", ")}`);
  process.exit(1);
}

const argumentos = process.argv.slice(2);
const WORKSPACE = argumentos.find((a) => !a.startsWith("--") && argumentos[argumentos.indexOf(a) - 1] !== "--para");
const PARA = (argumentos[argumentos.indexOf("--para") + 1] ?? "").trim().toLowerCase();
const CORRER = argumentos.includes("--correr");
const PAUSA = argumentos.includes("--pausa");
const ESPERAR_CHEQUEO = argumentos.includes("--esperar-chequeo");

if (!WORKSPACE || !argumentos.includes("--para") || !PARA.includes("@")) {
  console.error("Uso: node scripts/verify-sesion-whatsapp.mjs <workspace_id> --para <correo> [--correr] [--pausa] [--esperar-chequeo]");
  process.exit(1);
}

const RECEPTOR = `${APP_URL}/api/webhooks/evolution`;
const CABECERAS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const CLAVE_TAREA = `sesion_whatsapp:${WORKSPACE}`;
const SUFIJO = randomUUID().slice(0, 8);
const SECRETO = randomBytes(32).toString("hex");
const INICIO = new Date().toISOString();

// ── Helpers ─────────────────────────────────────────────────────────────────

let fallos = 0;
let pasados = 0;
let noConcluyente = false;
const ok = (d) => { pasados++; console.log(`  ok    ${d}`); };
const fail = (d, detalle) => {
  fallos++;
  console.log(`  FALLA ${d}`);
  if (detalle) for (const l of String(detalle).split("\n")) console.log(`        ${l}`);
};
const inconcluso = (d) => { noConcluyente = true; console.log(`  NO CONCLUYENTE ${d}`); };
const paso = (n, d) => console.log(`\n${n}. ${d}`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function admin(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...CABECERAS, Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const t = await r.text();
  return { status: r.status, ok: r.ok, data: t ? JSON.parse(t) : null };
}
const rpc = (fn, args) => admin(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

async function usuario(id) {
  const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { headers: CABECERAS });
  return r.ok ? r.json() : null;
}

async function esperarA(obtener, { maxMs = 60_000, cadaMs = 2_000 } = {}) {
  const hasta = Date.now() + maxMs;
  while (Date.now() < hasta) {
    const v = await obtener();
    if (v) return v;
    await esperar(cadaMs);
  }
  return null;
}

async function firmar() {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 600)
    .sign(new TextEncoder().encode(SECRETO));
}

/** `connection.update` con la forma de Evolution 2.3.7 (B:350-357, B:463, B:509-515). */
async function avisar(instancia, state) {
  const r = await fetch(RECEPTOR, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await firmar()}` },
    body: JSON.stringify({ event: "connection.update", instance: instancia, data: { instance: instancia, state, statusReason: 200 }, date_time: new Date().toISOString() }),
    signal: AbortSignal.timeout(30_000),
  });
  return r.status;
}

async function marcaDeLaTarea() {
  const { data } = await admin(`tareas_estado?select=ultima_ejecucion_at,ultimo_ok_at&clave=eq.${encodeURIComponent(CLAVE_TAREA)}`);
  return JSON.stringify(data?.[0] ?? null);
}

async function sesion(canalId) {
  const { data } = await admin(`channels?select=session_state,session_detail,session_linked_at,session_checked_at&id=eq.${canalId}`);
  return data?.[0] ?? null;
}

async function correosDe(clave) {
  const { data } = await admin(
    `email_log?select=id,estado,para,intentos,ultimo_error,created_at&workspace_id=eq.${WORKSPACE}&tipo=eq.sesion_whatsapp` +
    `&clave_techo=eq.${encodeURIComponent(clave)}&order=created_at.asc`
  );
  return Array.isArray(data) ? data : [];
}

/** Un par aviso → lectura: la marca de la tarea antes y después. */
async function par(desc, fn) {
  const antes = await marcaDeLaTarea();
  const resultado = await fn();
  const despues = await marcaDeLaTarea();
  if (antes !== despues) {
    inconcluso(`${desc}: el chequeo periódico corrió en el medio (la marca de ${CLAVE_TAREA} cambió). Este par no se cuenta.`);
    return { cron: true, resultado };
  }
  return { cron: false, resultado };
}

function nombreEnVault(nombre) {
  // Solo el nombre, nunca el valor: `vault.secrets`, no `decrypted_secrets`.
  const sql = `select exists (select 1 from vault.secrets where name = 'ws:${WORKSPACE}:${nombre}') as hay;`;
  const salida = execFileSync("npx", ["supabase", "db", "query", "--linked", "-o", "json", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(salida.slice(salida.indexOf("{"))).rows[0].hay === true;
}

// ── Estado a limpiar ────────────────────────────────────────────────────────

const canales = { A: { instancia: `verificador-sesion-a-${SUFIJO}`, id: null }, B: { instancia: `verificador-sesion-b-${SUFIJO}`, id: null } };
let secretoGuardado = false;

// ── Precondiciones ──────────────────────────────────────────────────────────

async function precondiciones() {
  console.log("\nPrecondiciones (no se escribe ni se manda nada si alguna falla)");

  const { data: ws } = await admin(`workspaces?select=id,name&id=eq.${WORKSPACE}`);
  if (!ws?.[0]) throw new Error(`no existe el workspace ${WORKSPACE}`);
  console.log(`  Workspace: «${ws[0].name}» (${WORKSPACE})`);

  const { data: miembros } = await admin(`workspace_members?select=user_id,role&workspace_id=eq.${WORKSPACE}`);
  const conCorreo = await Promise.all(
    (miembros ?? []).map(async (m) => ({ ...m, email: ((await usuario(m.user_id))?.email ?? "").toLowerCase() }))
  );
  if (conCorreo.length !== 1 || conCorreo[0].email !== PARA || conCorreo[0].role !== "owner") {
    throw new Error(
      `el workspace tiene que tener un solo miembro, Owner, con el correo ${PARA}. Tiene:\n` +
      conCorreo.map((m) => `  ${m.role}: ${m.email || "(sin correo)"}`).join("\n")
    );
  }
  ok(`un solo miembro, Owner: ${PARA}`);

  const { data: existentes } = await admin(`channels?select=id&workspace_id=eq.${WORKSPACE}`);
  if ((existentes ?? []).length > 0) throw new Error(`el workspace tiene ${existentes.length} canal(es): no es un workspace de prueba vacío`);
  ok("sin canales");

  const { data: resend } = await admin(`integration_configs?select=estado,config&workspace_id=eq.${WORKSPACE}&proveedor=eq.resend`);
  if (resend?.[0]?.estado !== "conectado" || !resend[0].config?.remitente) {
    throw new Error(`Resend no está conectado en este workspace, o le falta el remitente (estado: ${resend?.[0]?.estado ?? "sin fila"}).`);
  }
  ok(`Resend conectado, remitente ${resend[0].config.remitente}`);

  if (nombreEnVault("evolution_webhook_secret")) {
    throw new Error("el workspace ya tiene un evolution_webhook_secret: no se pisa. Borralo a mano si es de una corrida anterior.");
  }
  ok("sin secreto de webhook de Evolution guardado (leído solo el nombre)");

  console.log(`\n  Destinatario de los correos de prueba: ${PARA}. Ningún otro. Son dos: la caída y «se agotaron los intentos».`);
  console.log(`  Receptor: ${RECEPTOR}`);
  console.log(`  No se llama a Evolution: los canales no tienen token de instancia.`);
}

// ── Verificación ────────────────────────────────────────────────────────────

async function main() {
  await precondiciones();
  if (!CORRER) {
    console.log("\nSin --correr: no se escribió ni se mandó nada.");
    return;
  }

  paso(1, "El secreto de webhook generado y los dos canales descartables (solo filas)");
  const g = await rpc("store_secret", { secret_name: "evolution_webhook_secret", secret_value: SECRETO, workspace_id: WORKSPACE });
  if (!g.ok) throw new Error(`no se pudo guardar el secreto: HTTP ${g.status}`);
  secretoGuardado = true;
  ok("secreto guardado");
  for (const [letra, c] of Object.entries(canales)) {
    const { status, data } = await admin("channels", {
      method: "POST",
      body: JSON.stringify({ workspace_id: WORKSPACE, platform: "whatsapp", provider: "evolution", instance_name: c.instancia, display_name: c.instancia, late_account_id: null, is_active: true }),
    });
    if (status >= 300 || !data?.[0]?.id) throw new Error(`no se pudo crear el canal ${letra}: HTTP ${status}`);
    c.id = data[0].id;
    ok(`canal ${letra}: ${c.id}`);
  }

  paso(2, "B: open → conectado, con la marca de vinculado (control positivo del camino)");
  const p2 = await par("B open", async () => ({ status: await avisar(canales.B.instancia, "open"), s: await sesion(canales.B.id) }));
  if (!p2.cron) {
    p2.resultado.status === 200 ? ok("el receptor respondió 200") : fail(`el receptor respondió ${p2.resultado.status}`);
    p2.resultado.s?.session_state === "conectado" ? ok("B quedó conectado") : fail(`B quedó en ${p2.resultado.s?.session_state ?? "(nulo)"}`);
    p2.resultado.s?.session_linked_at ? ok("B tiene la marca de vinculado") : fail("B no tiene la marca de vinculado");
  }
  if (p2.cron || p2.resultado.s?.session_state !== "conectado") {
    inconcluso("sin B conectado, nada de lo que sigue prueba algo");
    return;
  }

  paso(3, "B: close con marca → caído y un correo enviado a Owner y Admin");
  const claveCaida = `${canales.B.id}:caido`;
  const p3 = await par("B close", async () => {
    const status = await avisar(canales.B.instancia, "close");
    const s = await sesion(canales.B.id);
    const correo = await esperarA(async () => (await correosDe(claveCaida)).find((x) => ["enviado", "fallido"].includes(x.estado)) ?? null);
    return { status, s, correo, todas: await correosDe(claveCaida) };
  });
  if (!p3.cron) {
    const { status, s, correo, todas } = p3.resultado;
    status === 200 ? ok("el receptor respondió 200") : fail(`el receptor respondió ${status}`);
    s?.session_state === "caido" ? ok("B quedó caído") : fail(`B quedó en ${s?.session_state ?? "(nulo)"}`);
    if (!correo) fail("en 60 s no apareció la fila del correo de la caída");
    else if (correo.estado === "fallido") fail("el correo de la caída quedó fallido", correo.ultimo_error);
    else ok(`correo de la caída enviado (intento ${correo.intentos}), a: ${correo.para.join(", ")}`);
    if (correo) JSON.stringify(correo.para) === JSON.stringify([PARA]) ? ok("el único destinatario es el esperado") : fail(`destinatarios: ${correo.para.join(", ")}`);
    todas.length === 1 ? ok("una sola fila para la caída") : fail(`${todas.length} filas para la caída`);
  }

  if (PAUSA) {
    console.log(`\n  PAUSA: B está caído. Mirá Canales y la Bandeja de «Pruebas de correo» y apretá Enter para seguir.`);
    await new Promise((r) => createInterface({ input: process.stdin }).once("line", r));
  }

  paso(4, "B: refused → «se agotaron los intentos» y otro correo enviado");
  const claveAgotado = `${canales.B.id}:agotado`;
  const p4 = await par("B refused", async () => {
    const status = await avisar(canales.B.instancia, "refused");
    const s = await sesion(canales.B.id);
    const correo = await esperarA(async () => (await correosDe(claveAgotado)).find((x) => ["enviado", "fallido"].includes(x.estado)) ?? null);
    return { status, s, correo };
  });
  if (!p4.cron) {
    const { status, s, correo } = p4.resultado;
    status === 200 ? ok("el receptor respondió 200") : fail(`el receptor respondió ${status}`);
    s?.session_state === "agotado" ? ok("B quedó en agotado") : fail(`B quedó en ${s?.session_state ?? "(nulo)"}`);
    if (!correo) fail("en 60 s no apareció la fila del correo de «se agotaron los intentos»");
    else if (correo.estado === "fallido") fail("el correo quedó fallido", correo.ultimo_error);
    else ok("correo de «se agotaron los intentos» enviado");
  }

  paso(5, "A: close SIN marca → «sin vincular» y NINGUNA fila de correo (el negativo)");
  const p5 = await par("A close", async () => {
    const status = await avisar(canales.A.instancia, "close");
    const s = await sesion(canales.A.id);
    // El correo de B tardó lo que tardó: se espera lo mismo de margen antes de contar.
    await esperar(20_000);
    const { data } = await admin(`email_log?select=id&workspace_id=eq.${WORKSPACE}&clave_techo=like.${encodeURIComponent(`${canales.A.id}:*`)}`);
    return { status, s, filas: data ?? [] };
  });
  if (!p5.cron) {
    const { status, s, filas } = p5.resultado;
    status === 200 ? ok("el receptor respondió 200") : fail(`el receptor respondió ${status}`);
    s?.session_state === "sin_vincular" ? ok("A quedó «sin vincular»") : fail(`A quedó en ${s?.session_state ?? "(nulo)"}`);
    s?.session_linked_at === null ? ok("A sigue sin marca") : fail("A tiene marca de vinculado");
    if (p3.cron || !p3.resultado.correo || p3.resultado.correo.estado !== "enviado") {
      inconcluso("sin el correo de B enviado, «ninguna fila para A» no prueba nada");
    } else {
      filas.length === 0 ? ok("ninguna fila de correo para A: «sin vincular» no avisa") : fail(`${filas.length} fila(s) de correo para A`);
    }
  }

  if (!ESPERAR_CHEQUEO) {
    console.log("\nSin --esperar-chequeo: no se probó el chequeo periódico.");
    return;
  }

  paso(6, "El chequeo periódico real: los dos pasan a «no se pudo verificar», sin correo nuevo");
  const filasAntes = (await admin(`email_log?select=id&workspace_id=eq.${WORKSPACE}&tipo=eq.sesion_whatsapp&created_at=gt.${encodeURIComponent(INICIO)}`)).data?.length ?? 0;
  const marcaAntes = await marcaDeLaTarea();
  const corrio = await esperarA(async () => ((await marcaDeLaTarea()) !== marcaAntes ? true : null), { maxMs: 12 * 60_000, cadaMs: 15_000 });
  if (!corrio) {
    inconcluso("en 12 minutos el chequeo no corrió: no se puede afirmar nada de él");
    return;
  }
  ok("el chequeo corrió (la marca de la tarea cambió)");
  for (const letra of ["A", "B"]) {
    const s = await sesion(canales[letra].id);
    if (!s?.session_checked_at || s.session_checked_at < INICIO) {
      inconcluso(`${letra}: el chequeo no lo leyó`);
      continue;
    }
    s.session_state === "sin_verificar" ? ok(`${letra} quedó en «no se pudo verificar» (${s.session_detail})`) : fail(`${letra} quedó en ${s.session_state}`);
  }
  await esperar(20_000);
  const filasDespues = (await admin(`email_log?select=id&workspace_id=eq.${WORKSPACE}&tipo=eq.sesion_whatsapp&created_at=gt.${encodeURIComponent(INICIO)}`)).data?.length ?? 0;
  filasDespues === filasAntes ? ok("ninguna fila de correo nueva: «no se pudo verificar» no avisa") : fail(`${filasDespues - filasAntes} fila(s) de correo nuevas`);
}

async function limpieza() {
  console.log("\nLimpieza: los canales por su id y el secreto");
  for (const [letra, c] of Object.entries(canales)) {
    if (!c.id) continue;
    await admin(`channels?id=eq.${c.id}`, { method: "DELETE" });
    const { data } = await admin(`channels?select=id&id=eq.${c.id}`);
    (data ?? []).length === 0 ? ok(`canal ${letra} borrado`) : fail(`el canal ${letra} sigue en la base`);
  }
  if (secretoGuardado) {
    const r = await rpc("delete_secret", { secret_name: "evolution_webhook_secret", workspace_id: WORKSPACE });
    r.ok ? ok("secreto borrado") : fail(`no se pudo borrar el secreto: HTTP ${r.status}`);
  }
  console.log("  Las filas de email_log quedan: son el registro de lo que se mandó.");
}

try {
  await main();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  if (CORRER) await limpieza();
  console.log(`\n${pasados} ok, ${fallos} fallas${noConcluyente ? ", NO CONCLUYENTE" : ""}.`);
  process.exit(fallos > 0 ? 1 : noConcluyente ? 2 : 0);
}
