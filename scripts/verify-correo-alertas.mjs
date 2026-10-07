#!/usr/bin/env node
/**
 * Control positivo de F23: "se inserta una alerta en `webhook_alerts` y llega
 * el correo". Y el techo de un correo por tipo por hora, contra la base real.
 *
 * MANDA UN CORREO DE VERDAD. Por eso:
 *
 *   - Corre solo contra un workspace de prueba que se le pasa explícito, y se
 *     niega antes de mandar nada si ese workspace tiene cualquier miembro
 *     distinto del destinatario que se le pasa con `--para`, o si tiene canales.
 *   - Sin `--enviar` no manda nada: comprueba todo eso e imprime a quién le
 *     llegaría. Es lo que se le muestra a Marcos antes de correrlo de verdad.
 *   - Que el correo LLEGÓ no lo puede ver este script: lo confirma quien lee la
 *     casilla. Este script prueba que Resend lo aceptó.
 *
 * QUÉ HACE, Y POR QUÉ ASÍ:
 *
 *   1. Crea un canal de Evolution descartable: SOLO UNA FILA en `channels`, con
 *      un nombre de instancia inventado. No crea, no consulta y no toca ninguna
 *      instancia del servidor de Evolution, ni el canal real.
 *   2. Le manda al receptor real, en producción, una entrega sin token válido.
 *      El receptor busca los secretos por workspace (`evolution/route.ts`) y el
 *      de prueba no tiene ninguno: abre `webhook_auth_failed` con ese workspace
 *      y responde 401. Es el camino real por el que se abre esa alerta. NO se
 *      inserta la alerta a mano: abrirla con `record_webhook_alert` directo no
 *      manda correo, a propósito (ver `notificarAlerta` en `lib/correo.ts`).
 *   3. Espera, por condición y no con un tiempo fijo, a que la fila de
 *      `email_log` de esa alerta quede `enviado`.
 *   4. EL TECHO. Una segunda entrega igual. El tope de una escritura por minuto
 *      de `record_webhook_alert` no la frena: aplica solo a la instancia
 *      desconocida (00023), y además, aunque frenara, la función devuelve el id
 *      y el aviso se llama igual. Primero se comprueba que `occurrences` pasó de
 *      1 a 2, que es la prueba de que la entrega llegó. **El verde es que exista
 *      una fila `omitido_techo` para esa alerta**: que no llegue un segundo
 *      correo no alcanza, porque eso también pasaría si el aviso nunca corrió.
 *      Sin la fila, el resultado es NO CONCLUYENTE.
 *   5. Limpieza en el `finally`: cierra la alerta POR SU ID y borra el canal
 *      descartable, y comprueba las dos cosas. Las filas de `email_log` quedan:
 *      son el registro de lo que se mandó.
 *
 * Uso:
 *   node scripts/verify-correo-alertas.mjs <workspace_id> --para <correo>            (solo comprueba)
 *   node scripts/verify-correo-alertas.mjs <workspace_id> --para <correo> --enviar   (manda)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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
const ENVIAR = argumentos.includes("--enviar");

if (!WORKSPACE || !argumentos.includes("--para") || !PARA.includes("@")) {
  console.error("Uso: node scripts/verify-correo-alertas.mjs <workspace_id> --para <correo> [--enviar]");
  process.exit(1);
}

const RECEPTOR = `${APP_URL}/api/webhooks/evolution`;
const CABECERAS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const CLAVE_TECHO = "evolution:webhook_auth_failed";

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

async function admin(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...CABECERAS, Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const t = await r.text();
  return { status: r.status, ok: r.ok, data: t ? JSON.parse(t) : null };
}

async function usuario(id) {
  const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, { headers: CABECERAS });
  return r.ok ? r.json() : null;
}

/** Espera por condición: pregunta hasta que `obtener` devuelve algo, o se agota. */
async function esperarA(obtener, { maxMs = 90_000, cadaMs = 2_000 } = {}) {
  const hasta = Date.now() + maxMs;
  while (Date.now() < hasta) {
    const v = await obtener();
    if (v) return v;
    await new Promise((r) => setTimeout(r, cadaMs));
  }
  return null;
}

async function entregar() {
  const cuerpo = {
    event: "messages.upsert",
    instance: instancia,
    data: { key: { remoteJid: `verificador-${SUFIJO}@s.whatsapp.net`, id: `PROBE-${randomUUID()}`, fromMe: false } },
  };
  const r = await fetch(RECEPTOR, {
    method: "POST",
    // Un token cualquiera: el workspace de prueba no tiene secreto, así que el
    // receptor rechaza antes de mirarlo.
    headers: { "Content-Type": "application/json", Authorization: "Bearer token-del-verificador-de-correo" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30_000),
  });
  return r.status;
}

async function alertaAbierta() {
  const { data } = await admin(
    `webhook_alerts?select=id,occurrences,resolved_at&workspace_id=eq.${WORKSPACE}` +
    `&source=eq.evolution&alert_condition=eq.webhook_auth_failed&resolved_at=is.null`
  );
  return Array.isArray(data) ? data : [];
}

async function correosDe(alertaId) {
  const { data } = await admin(
    `email_log?select=id,estado,para,intentos,ultimo_error,created_at&alerta_id=eq.${alertaId}&order=created_at.asc`
  );
  return Array.isArray(data) ? data : [];
}

// ── Estado a limpiar ────────────────────────────────────────────────────────

const SUFIJO = randomUUID().slice(0, 8);
const instancia = `verificador-correo-${SUFIJO}`;
const limpiar = { canalId: null, alertaId: null };

// ── Precondiciones: nada se manda si alguna falla ───────────────────────────

async function precondiciones() {
  console.log("\nPrecondiciones (no se manda nada si alguna falla)");

  const { data: ws } = await admin(`workspaces?select=id,name&id=eq.${WORKSPACE}`);
  if (!ws?.[0]) throw new Error(`no existe el workspace ${WORKSPACE}`);
  console.log(`  Workspace: «${ws[0].name}» (${WORKSPACE})`);

  // Todos los miembros, no solo Owner y Admin: un Member hoy no recibe avisos,
  // pero un workspace de prueba con alguien más adentro ya no es de prueba.
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

  const { data: canales } = await admin(`channels?select=id&workspace_id=eq.${WORKSPACE}`);
  if ((canales ?? []).length > 0) throw new Error(`el workspace tiene ${canales.length} canal(es): no es un workspace de prueba vacío`);
  ok("sin canales");

  const { data: resend } = await admin(
    `integration_configs?select=estado,config&workspace_id=eq.${WORKSPACE}&proveedor=eq.resend`
  );
  if (resend?.[0]?.estado !== "conectado" || !resend[0].config?.remitente) {
    throw new Error(
      `Resend no está conectado en este workspace, o le falta el remitente (estado: ${resend?.[0]?.estado ?? "sin fila"}).`
    );
  }
  ok(`Resend conectado, remitente ${resend[0].config.remitente}`);

  if ((await alertaAbierta()).length > 0) {
    throw new Error("ya hay una alerta `webhook_auth_failed` abierta en este workspace: el resultado no sería atribuible");
  }
  ok("sin alertas abiertas de rechazo");

  const haceUnaHora = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: recientes } = await admin(
    `email_log?select=id&workspace_id=eq.${WORKSPACE}&tipo=eq.alerta_webhook&clave_techo=eq.${encodeURIComponent(CLAVE_TECHO)}` +
    `&estado=in.(pendiente,enviado,fallido)&created_at=gt.${encodeURIComponent(haceUnaHora)}`
  );
  if ((recientes ?? []).length > 0) {
    throw new Error("en la última hora ya salió un aviso de este tipo: el techo omitiría el primero. Esperá una hora.");
  }
  ok("ningún aviso de este tipo en la última hora");

  const { data: mismo } = await admin(`channels?select=id&instance_name=eq.${instancia}`);
  if ((mismo ?? []).length > 0) throw new Error(`ya existe un canal con la instancia ${instancia}`);
  ok(`la instancia descartable ${instancia} no existe`);

  console.log(`\n  Destinatario del correo de prueba: ${PARA}. Ningún otro.`);
  console.log(`  Receptor: ${RECEPTOR}`);
}

// ── Verificación ────────────────────────────────────────────────────────────

async function main() {
  await precondiciones();
  if (!ENVIAR) {
    console.log("\nSin --enviar: no se mandó nada.");
    return;
  }

  paso(1, "Canal descartable: solo una fila en `channels`, sin instancia en Evolution");
  const { status, data } = await admin("channels", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: WORKSPACE,
      platform: "whatsapp",
      provider: "evolution",
      instance_name: instancia,
      display_name: instancia,
      late_account_id: null,
      is_active: true,
    }),
  });
  if (status >= 300 || !data?.[0]?.id) throw new Error(`no se pudo crear el canal descartable: HTTP ${status}`);
  limpiar.canalId = data[0].id;
  ok(`canal ${limpiar.canalId}`);

  paso(2, "Una entrega sin secreto en el workspace: 401 y la alerta abierta con ese workspace");
  const s1 = await entregar();
  s1 === 401 ? ok("el receptor respondió 401") : fail(`el receptor respondió ${s1}, se esperaba 401`);
  const abiertas = await esperarA(async () => {
    const a = await alertaAbierta();
    return a.length === 1 ? a : null;
  }, { maxMs: 20_000 });
  if (!abiertas) {
    inconcluso("no apareció la alerta: sin ella, nada de lo que sigue prueba algo");
    return;
  }
  limpiar.alertaId = abiertas[0].id;
  abiertas[0].occurrences === 1 ? ok(`alerta ${limpiar.alertaId}, occurrences 1`) : fail(`occurrences ${abiertas[0].occurrences}, se esperaba 1`);

  paso(3, "El correo de la alerta queda enviado (control positivo)");
  const primero = await esperarA(async () => {
    const c = (await correosDe(limpiar.alertaId)).find((x) => x.estado === "enviado" || x.estado === "fallido");
    return c ?? null;
  });
  if (!primero) {
    fail("en 90 segundos no apareció la fila del correo, ni enviada ni fallida");
  } else if (primero.estado === "fallido") {
    fail("el correo quedó fallido", primero.ultimo_error);
  } else {
    ok(`Resend lo aceptó (intento ${primero.intentos}), a: ${primero.para.join(", ")}`);
    JSON.stringify(primero.para) === JSON.stringify([PARA])
      ? ok("el único destinatario es el esperado")
      : fail(`destinatarios inesperados: ${primero.para.join(", ")}`);
  }

  paso(4, "El techo: la segunda entrega llega y su aviso queda omitido_techo");
  if (!primero || primero.estado !== "enviado") {
    inconcluso("sin el primer correo enviado, el techo no se puede probar");
    return;
  }
  const s2 = await entregar();
  s2 === 401 ? ok("el receptor respondió 401") : fail(`el receptor respondió ${s2}, se esperaba 401`);
  const dos = await esperarA(async () => {
    const a = await alertaAbierta();
    return a[0]?.occurrences === 2 ? a[0] : null;
  }, { maxMs: 20_000 });
  if (!dos) {
    inconcluso("occurrences no llegó a 2: la segunda entrega no está probada, así que el techo tampoco");
  } else {
    ok("occurrences pasó a 2: la segunda entrega llegó");
    const omitida = await esperarA(async () =>
      (await correosDe(limpiar.alertaId)).find((x) => x.estado === "omitido_techo") ?? null
    );
    if (omitida) ok(`fila omitido_techo ${omitida.id}: el aviso corrió y el techo no lo mandó`);
    else inconcluso("no apareció la fila omitido_techo: no se puede distinguir el techo de un aviso que no corrió");
    const enviados = (await correosDe(limpiar.alertaId)).filter((x) => x.estado === "enviado");
    enviados.length === 1 ? ok("un solo correo enviado para esta alerta") : fail(`${enviados.length} correos enviados para esta alerta`);
  }
}

async function limpieza() {
  console.log("\nLimpieza: la alerta por su id, el canal por su id");
  if (limpiar.alertaId) {
    const r = await admin(`webhook_alerts?id=eq.${limpiar.alertaId}`, {
      method: "PATCH",
      body: JSON.stringify({ resolved_at: new Date().toISOString() }),
    });
    const cerrada = r.ok && r.data?.[0]?.resolved_at;
    cerrada ? ok(`alerta ${limpiar.alertaId} cerrada (queda en el historial)`) : fail("no se pudo cerrar la alerta", JSON.stringify(r.data));
  }
  if (limpiar.canalId) {
    await admin(`channels?id=eq.${limpiar.canalId}`, { method: "DELETE" });
    const { data } = await admin(`channels?select=id&id=eq.${limpiar.canalId}`);
    (data ?? []).length === 0 ? ok("canal descartable borrado") : fail("el canal descartable sigue en la base");
  }
}

try {
  await main();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  if (ENVIAR) await limpieza();
}

console.log(`\n${pasados} ok, ${fallos} fallas${noConcluyente ? ", NO CONCLUYENTE" : ""}`);
process.exit(fallos > 0 || noConcluyente ? 1 : 0);
