#!/usr/bin/env node
/**
 * Verificación de punta a punta del receptor de webhooks de Evolution (F22).
 *
 * Manda eventos firmados contra el receptor REAL, en el dominio público. Es la
 * única forma honesta de probar esto: lo que estamos verificando es la cadena
 * entera —DNS, TLS, el enrutado de Next, Vault, la RLS— y ninguna de esas piezas
 * existe en un mock. Es seguro hoy justamente porque F27 no está construido: el
 * receptor autentica, controla duplicados, acusa y DESCARTA el contenido.
 *
 * ── EL CONTROL POSITIVO VA PRIMERO ──────────────────────────────────────────
 *
 * Una batería de "esto se rechaza" no distingue entre *se rechazó porque está
 * bien protegido* y *se rechazó porque nada llegó a ejecutarse*. Si la
 * comprobación 1 falla, el veredicto de todo lo demás es NO CONCLUYENTE, dicho
 * con esas palabras, nunca verde.
 *
 * ── LA LIMPIEZA ES QUIRÚRGICA, Y SE PRUEBA ──────────────────────────────────
 *
 * Cierra SOLO las alertas que abrió, por id, nunca por condición: si hay una
 * condición abierta de verdad cuando esto corre, cerrarla sería apagar una
 * alarma real. Borra de `webhook_events` solo las claves exactas que creó, nunca
 * por patrón. Y lleva su propio control: deja una condición centinela abierta
 * antes de limpiar y comprueba que sigue abierta después. Sin eso, "limpió bien"
 * y "limpió todo" darían el mismo verde.
 *
 * Uso:
 *   node scripts/verify-evolution-webhook.mjs [nombre-de-la-instancia]
 *
 * Sin argumento, usa el único canal de Evolution activo que encuentre.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
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
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const faltantes = [
  ["NEXT_PUBLIC_APP_URL", APP_URL],
  ["NEXT_PUBLIC_SUPABASE_URL", URL_BASE],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON],
].filter(([, v]) => !v).map(([k]) => k);

if (faltantes.length > 0) {
  console.error(`Faltan en .env: ${faltantes.join(", ")}`);
  process.exit(1);
}

const RECEPTOR = `${APP_URL}/api/webhooks/evolution`;

const CABECERAS = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

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
const paso = (n, d) => console.log(`\n${n}. ${d}`);

async function admin(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...CABECERAS, Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const t = await r.text();
  return { status: r.status, ok: r.ok, data: t ? JSON.parse(t) : null };
}

async function rpc(fn, args, headers = CABECERAS) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} devolvió ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

async function auth(path, init = {}) {
  const r = await fetch(`${URL_BASE}/auth/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const t = await r.text();
  return { status: r.status, ok: r.ok, data: t ? JSON.parse(t) : null };
}

/** Consulta con el token de una persona: la RLS aplica. Esto es lo que se prueba. */
async function comoUsuario(token, path) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const t = await r.text();
  return { status: r.status, ok: r.ok, data: t ? JSON.parse(t) : null };
}

// ── Firma, igual a la de Evolution ──────────────────────────────────────────

/**
 * Los claims son los mismos cuatro que pone `generateJwtToken()` de la 2.3.7
 * (`webhook.controller.ts`, líneas 287 a 305): iat, exp a 600 s, app y action.
 * Ninguno identifica la instancia: lo que ata el evento al canal es el secreto.
 */
async function firmar(secreto, { vencido = false } = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  const iat = vencido ? ahora - 3600 : ahora;
  return new SignJWT({ app: "evolution", action: "webhook" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + 600)
    .sign(new TextEncoder().encode(secreto));
}

// ── Estado a limpiar ────────────────────────────────────────────────────────

const SUFIJO = randomUUID().slice(0, 8);
/** Fuente propia para el centinela: no puede colisionar con la real, que es "evolution". */
const FUENTE_CENTINELA = `centinela-${SUFIJO}`;

const limpiar = {
  /** Claves EXACTAS creadas en webhook_events. Nunca se borra por patrón. */
  claves: [],
  /** Ids EXACTOS de alertas abiertas por esta corrida. Nunca se cierra por condición. */
  alertas: [],
  usuarios: [],
  workspaces: [],
  centinelaId: null,
};

let instancia = null;
let canal = null;

// ── Evento de prueba ────────────────────────────────────────────────────────

function nuevoEvento() {
  const id = `PROBE-${SUFIJO}-${randomBytes(4).toString("hex")}`;
  const remoteJid = `verificador-${SUFIJO}@s.whatsapp.net`;
  return {
    clave: `evolution:${instancia}:${remoteJid}:${id}:0`,
    cuerpo: {
      event: "messages.upsert",
      instance: instancia,
      data: {
        key: { remoteJid, id, fromMe: false },
        messageType: "conversation",
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
      date_time: new Date().toISOString(),
    },
  };
}

async function entregar(evento, token) {
  const r = await fetch(RECEPTOR, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(evento.cuerpo),
    signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  let json = null;
  try { json = t ? JSON.parse(t) : null; } catch { /* no era JSON */ }
  return { status: r.status, json, texto: t };
}

/** Las alertas abiertas de una fuente, tal como las ve el cliente de servicio. */
async function alertasAbiertas(fuente, condicion) {
  const { data } = await admin(
    `webhook_alerts?select=id,occurrences,resolved_at,workspace_id` +
    `&source=eq.${encodeURIComponent(fuente)}&alert_condition=eq.${condicion}&resolved_at=is.null`
  );
  return Array.isArray(data) ? data : [];
}

// ── Verificación ────────────────────────────────────────────────────────────

async function main() {
  // ── El canal ──────────────────────────────────────────────────────────────
  const pedido = process.argv[2];
  const filtro = pedido ? `&instance_name=eq.${encodeURIComponent(pedido)}` : "";
  const { data: canales } = await admin(
    `channels?select=id,workspace_id,instance_name,is_active&provider=eq.evolution&is_active=is.true${filtro}`
  );

  if (!Array.isArray(canales) || canales.length === 0) {
    throw new Error(
      "no hay ningún canal de Evolution activo en la base.\n" +
      "Corré primero: node scripts/setup-evolution-channel.mjs <nombre>"
    );
  }
  if (canales.length > 1) {
    throw new Error(
      `hay ${canales.length} canales de Evolution activos. Pasá cuál:\n` +
      canales.map((c) => `  ${c.instance_name}`).join("\n")
    );
  }

  canal = canales[0];
  instancia = canal.instance_name;

  console.log(`\nVerificación del receptor de Evolution`);
  console.log(`  Receptor:  ${RECEPTOR}`);
  console.log(`  Instancia: ${instancia}`);

  const secreto = await rpc("read_secret", {
    secret_name: "evolution_webhook_secret",
    workspace_id: canal.workspace_id,
  });
  if (!secreto) {
    throw new Error(
      "no hay `evolution_webhook_secret` en Vault para este workspace.\n" +
      "Corré: node scripts/setup-evolution-channel.mjs <nombre> --solo-webhook"
    );
  }

  // El centinela: una condición abierta que esta corrida NO debe tocar.
  limpiar.centinelaId = await rpc("record_webhook_alert", {
    p_source: FUENTE_CENTINELA,
    p_condition: "webhook_auth_failed",
    p_workspace_id: canal.workspace_id,
    p_channel_id: canal.id,
    p_detail: "centinela del verificador: no la cierra nadie más que el finally",
  });

  // ── 1. El control positivo ────────────────────────────────────────────────
  paso(1, "Un evento firmado con el secreto real llega y devuelve 200 (control positivo)");

  const primero = nuevoEvento();
  const r1 = await entregar(primero, await firmar(secreto));
  if (r1.status === 200) {
    limpiar.claves.push(primero.clave);
    ok("200, y el receptor lo encoló");
  } else {
    fail(`devolvió ${r1.status}, se esperaba 200`, r1.texto.slice(0, 300));
    noConcluyente = true;
  }

  if (noConcluyente) {
    console.log("\n  NO CONCLUYENTE  todo lo que sigue");
    console.log("        el control positivo falló, así que un rechazo no distingue");
    console.log("        un receptor bien protegido de uno que no llegó a ejecutarse.");
    console.log("        Mirá primero: el DNS de app.alomercadeo.com, que el despliegue");
    console.log("        de la app esté arriba, y que el canal esté activo.");
    return;
  }

  // Desde acá el camino válido funciona, así que un 401 significa algo.

  // ── 2. Repetido ───────────────────────────────────────────────────────────
  //
  // ESTA VA ANTES DE LOS RECHAZOS, Y NO ES UN CAPRICHO DE ORDEN.
  //
  // El evento repetido es un evento VÁLIDO, y en `route.ts` el orden del
  // receptor es: verificar el token -> resolverAlertas() -> recién ahí el
  // control de duplicados. O sea que CUALQUIER entrega válida cierra
  // `webhook_auth_failed`, incluida una que después se descarta por repetida.
  //
  // Con esta comprobación después de los rechazos, cerraba la condición que
  // ellos acababan de abrir, la comprobación 5 la buscaba y no la encontraba, y
  // la 6 pasaba EN FALSO: afirmaba "el evento válido la cerró" comprobando que
  // no quedara ninguna abierta, que era trivialmente cierto porque nunca hubo
  // ninguna. Los rechazos y la lectura de la alerta tienen que quedar juntos,
  // sin ninguna entrega válida en el medio.
  paso(2, "El mismo evento repetido se acusa sin reprocesar");
  const r2 = await entregar(primero, await firmar(secreto));
  if (r2.status === 200 && r2.json?.skipped === true) {
    ok(`200 con skipped: true, motivo "${r2.json?.reason}"`);
  } else if (r2.status === 200) {
    fail(
      "200 pero sin `skipped: true`: el ledger de idempotencia no lo reconoció",
      `respuesta: ${JSON.stringify(r2.json).slice(0, 200)}`
    );
  } else {
    fail(`devolvió ${r2.status}, se esperaba 200`, r2.texto.slice(0, 200));
  }

  // A partir de acá NO puede haber ninguna entrega válida hasta la 6.

  // ── 3. Token vencido ──────────────────────────────────────────────────────
  paso(3, "Un token vencido devuelve 401");
  const e3 = nuevoEvento();
  const r3 = await entregar(e3, await firmar(secreto, { vencido: true }));
  if (r3.status === 401) ok("401");
  else fail(`devolvió ${r3.status}, se esperaba 401`, r3.texto.slice(0, 200));

  // ── 4. Otro secreto ───────────────────────────────────────────────────────
  paso(4, "Un token firmado con otro secreto devuelve 401");
  const e4 = nuevoEvento();
  const r4 = await entregar(e4, await firmar(randomBytes(32).toString("hex")));
  if (r4.status === 401) ok("401");
  else fail(`devolvió ${r4.status}, se esperaba 401`, r4.texto.slice(0, 200));

  // ── 5. El rechazo dejó la condición abierta ───────────────────────────────
  paso(5, "Los rechazos dejaron `webhook_auth_failed` abierta, con su contador");
  const abiertas = (await alertasAbiertas("evolution", "webhook_auth_failed"))
    .filter((a) => a.workspace_id === canal.workspace_id);

  let habiaCondicionAbierta = false;

  if (abiertas.length === 1) {
    const a = abiertas[0];
    limpiar.alertas.push(a.id);
    habiaCondicionAbierta = true;
    if (a.occurrences >= 2) {
      ok(`una condición abierta, occurrences = ${a.occurrences} (los dos rechazos)`);
    } else {
      fail(`occurrences = ${a.occurrences}, se esperaba al menos 2`);
    }
  } else {
    fail(
      `hay ${abiertas.length} condiciones abiertas de este workspace, se esperaba 1`,
      "sin exactamente una, no se puede atribuir el contador a los rechazos de arriba."
    );
  }

  // ── 6. Un evento válido la cerró ──────────────────────────────────────────
  //
  // ESTA COMPROBACIÓN NO PUEDE DAR VERDE SI LA 5 NO ENCONTRÓ NADA ABIERTO. Sin
  // esta guarda, "la cerró" se comprobaba mirando que no quedara ninguna
  // abierta, y eso es trivialmente cierto cuando nunca hubo una: un verde que no
  // prueba nada. La 5 es el control positivo de la 6.
  paso(6, "Un evento válido posterior la cerró");

  if (!habiaCondicionAbierta) {
    console.log("  NO CONCLUYENTE  no había ninguna condición abierta que cerrar");
    console.log("        la comprobación 5 falló, así que \"no queda ninguna abierta\"");
    console.log("        no distingue un cierre correcto de que nunca hubo nada.");
    fallos++;
  } else {
    const e6 = nuevoEvento();
    const r6 = await entregar(e6, await firmar(secreto));
    if (r6.status === 200) limpiar.claves.push(e6.clave);

    const siguenAbiertas = (await alertasAbiertas("evolution", "webhook_auth_failed"))
      .filter((a) => a.workspace_id === canal.workspace_id);

    if (r6.status === 200 && siguenAbiertas.length === 0) {
      ok("el evento válido cerró la condición sola");
    } else if (r6.status !== 200) {
      fail(`el evento válido devolvió ${r6.status}`, "sin él no se puede probar el cierre.");
    } else {
      fail(`la condición sigue abierta después de un evento válido`);
    }
  }

  // ── 7. Quién puede leer la alerta de sistema ──────────────────────────────
  paso(7, "La alerta de sistema no es legible por RLS (mitad negativa)");
  await comprobarLecturaDeSistema();

  // ── Limpieza, y su control ────────────────────────────────────────────────
  paso("Limpieza", "Quirúrgica: por id y por clave exacta, nunca por condición ni por patrón");
  await limpieza();
}

/**
 * La mitad negativa del viejo punto 7 del documento, con su control positivo.
 *
 * ── POR QUÉ ESTO NO ES EL PUNTO 7 QUE DICE docs/despliegue-evolution.md ─────
 *
 * Ese documento pide probar que "un Owner puede leer la condición de instancia
 * desconocida, y un Member no". Era cierto con la 00022, que tenía
 * `is_any_workspace_owner()` y una policy para las filas sin workspace. LA 00023
 * BORRÓ LAS DOS: hoy las filas de sistema no tienen ninguna vía de lectura por
 * RLS, y se leen del lado del servidor con el cliente de servicio detrás de una
 * guarda de rol (`page.tsx` pasa `esOwner`, y `webhook-alerts-actions.ts` corta
 * con `role !== "owner"`).
 *
 * Así que acá se prueba lo que HOY tiene que ser cierto: que ninguna persona la
 * lee por RLS. El control positivo es que el MISMO token sí lee una alerta de su
 * propio workspace: sin eso, cero filas no distingue "la policy lo niega" de "la
 * consulta estaba mal escrita".
 *
 * LO QUE ESTA COMPROBACIÓN NO PRUEBA, y hay que decirlo en voz alta: que una
 * PERSONA pueda ver la alerta de sistema en la pantalla. Eso depende de las dos
 * guardas de rol del servidor, y HOY NO ESTÁN CUBIERTAS POR NINGÚN TEST.
 */
async function comprobarLecturaDeSistema() {
  // Una fila de sistema propia, con fuente propia: no toca la real.
  const idSistema = await rpc("record_webhook_alert", {
    p_source: FUENTE_CENTINELA,
    p_condition: "webhook_unknown_instance",
    p_workspace_id: null,
    p_detail: "fila de sistema del verificador",
  });

  // Una persona nueva. El trigger handle_new_user le crea su propio workspace y
  // la deja como owner, así que no hace falta tocar la membresía del workspace
  // real: para probar "ni siquiera un Owner la lee" alcanza con que sea Owner.
  const email = `evo-webhook-${SUFIJO}@ssa-test.local`;
  const password = `Probe-${randomUUID()}`;
  const alta = await auth("admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!alta.data?.id) {
    fail("no se pudo crear el usuario de prueba", JSON.stringify(alta.data).slice(0, 200));
    return;
  }
  limpiar.usuarios.push(alta.data.id);

  await new Promise((r) => setTimeout(r, 1500));
  const { data: membresias } = await admin(
    `workspace_members?select=workspace_id,role&user_id=eq.${alta.data.id}`
  );
  const propio = membresias?.[0];
  if (!propio) {
    fail("el trigger no creó el workspace del usuario de prueba");
    return;
  }
  limpiar.workspaces.push(propio.workspace_id);

  // Una alerta CON workspace, en el workspace propio de esa persona: es el
  // control positivo.
  const idPropia = await rpc("record_webhook_alert", {
    p_source: FUENTE_CENTINELA,
    p_condition: "webhook_auth_failed",
    p_workspace_id: propio.workspace_id,
    p_detail: "control positivo del verificador",
  });

  const sesion = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());

  if (!sesion.access_token) {
    fail("no se pudo autenticar al usuario de prueba", JSON.stringify(sesion).slice(0, 200));
    return;
  }

  // Control positivo primero.
  const positiva = await comoUsuario(sesion.access_token, `webhook_alerts?select=id&id=eq.${idPropia}`);
  const leePropia = Array.isArray(positiva.data) && positiva.data.length === 1;

  if (leePropia) {
    ok(`control positivo: el Owner lee la alerta de su workspace (rol ${propio.role})`);
  } else {
    fail(
      "control positivo: el Owner NO lee la alerta de su propio workspace",
      `status ${positiva.status}, filas ${Array.isArray(positiva.data) ? positiva.data.length : "?"}.\n` +
      "Sin esto, cero filas en la mitad negativa no significa nada."
    );
  }

  const negativa = await comoUsuario(sesion.access_token, `webhook_alerts?select=id&id=eq.${idSistema}`);
  const filas = Array.isArray(negativa.data) ? negativa.data.length : -1;

  if (!leePropia) {
    console.log("  NO CONCLUYENTE  la mitad negativa");
    console.log("        el control positivo falló.");
    fallos++;
  } else if (filas === 0) {
    ok("la fila de sistema (workspace_id nulo) no la lee ni un Owner, como corresponde desde la 00023");
  } else {
    fail(`la fila de sistema devolvió ${filas} filas para un Owner`, "la 00023 borró esa policy: no debería leerla nadie.");
  }

  // ── EL HUECO, DICHO EN VOZ ALTA ───────────────────────────────────────────
  console.log("");
  console.log("  SIN CUBRIR  que una PERSONA vea la alerta de sistema en la pantalla");
  console.log("        Esta comprobación prueba la mitad negativa: nadie la lee por RLS.");
  console.log("        La mitad positiva depende de dos guardas de rol en el servidor:");
  console.log("          app/(dashboard)/dashboard/channels/page.tsx        -> esOwner={role === \"owner\"}");
  console.log("          app/(dashboard)/dashboard/channels/webhook-alerts-actions.ts -> role !== \"owner\"");
  console.log("        NINGUNA DE LAS DOS TIENE TEST HOY. No lo cuentes como probado.");
}

// ── Limpieza ────────────────────────────────────────────────────────────────

/**
 * Cierra y borra SOLO lo propio, y después comprueba que el centinela sobrevivió.
 *
 * El centinela es el control positivo de la limpieza: sin él, una limpieza que
 * borrara de más —por condición, o por un patrón sobre `source`— daría
 * exactamente el mismo verde que una correcta.
 */
async function limpieza() {
  // Alertas: por id, una por una.
  for (const id of limpiar.alertas) {
    await admin(`webhook_alerts?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ resolved_at: new Date().toISOString() }),
    });
  }
  if (limpiar.alertas.length > 0) ok(`${limpiar.alertas.length} alerta(s) cerrada(s), por id`);

  // webhook_events: claves exactas, con `in`. Nunca `like`.
  if (limpiar.claves.length > 0) {
    const lista = limpiar.claves.map((c) => `"${c}"`).join(",");
    await admin(`webhook_events?event_id=in.(${encodeURIComponent(lista)})`, { method: "DELETE" });
    const { data } = await admin(
      `webhook_events?select=event_id&event_id=in.(${encodeURIComponent(lista)})`
    );
    if (Array.isArray(data) && data.length === 0) {
      ok(`${limpiar.claves.length} clave(s) borrada(s) de webhook_events, por clave exacta`);
    } else {
      fail(`quedaron ${data?.length ?? "?"} claves sin borrar en webhook_events`);
    }
  }

  // ── El control de la limpieza ─────────────────────────────────────────────
  //
  // Solo corre si el centinela llegó a existir. Si la corrida abortó antes —por
  // ejemplo porque todavía no hay canal—, no hay nada que controlar, y reportar
  // una falla ahí sería ruido que enseña a ignorar este control.
  if (limpiar.centinelaId) {
    const centinela = await admin(
      `webhook_alerts?select=id,resolved_at&id=eq.${limpiar.centinelaId}`
    );
    const fila = centinela.data?.[0];
    if (fila && fila.resolved_at === null) {
      ok("control de la limpieza: la condición centinela preexistente sigue abierta");
    } else {
      fail(
        "control de la limpieza: la condición centinela quedó cerrada o desapareció",
        "la limpieza tocó algo que no era suyo. Revisá que cierre por id y borre por clave exacta."
      );
    }
  }

  // Lo propio del verificador, ahora sí, borrado entero.
  await admin(`webhook_alerts?source=eq.${encodeURIComponent(FUENTE_CENTINELA)}`, { method: "DELETE" });
  for (const id of limpiar.usuarios) await auth(`admin/users/${id}`, { method: "DELETE" });
  for (const id of limpiar.workspaces) await admin(`workspaces?id=eq.${id}`, { method: "DELETE" });
}

// ── Salida ──────────────────────────────────────────────────────────────────

main()
  .then(() => {
    if (noConcluyente) {
      console.log(`\nNO CONCLUYENTE: el control positivo falló.\n`);
      process.exit(1);
    }
    console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron\n`);
    process.exit(fallos === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(`\nFalló: ${err.message}`);
    try { await limpieza(); } catch { /* la limpieza no puede tapar el error real */ }
    process.exit(1);
  });
