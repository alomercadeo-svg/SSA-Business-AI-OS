#!/usr/bin/env node
/**
 * Verificación de las alertas del receptor de Evolution (F22).
 *
 * CORRE CONTRA LA BASE REAL, POR LA API REST, Y NO CONTRA UN MOCK. No es una
 * preferencia: lo que hay que probar acá es la inferencia del `on conflict`
 * sobre un índice PARCIAL y SOBRE UNA EXPRESIÓN, y esa inferencia no existe en
 * un mock. Un `on conflict` mal escrito pasaría en verde contra un doble y
 * reventaría en producción con el código 42P10, la primera vez que llegue un
 * evento real.
 *
 * Qué comprueba:
 *   1. El `on conflict` resuelve: la primera llamada crea la fila, la segunda
 *      con otro nombre NO crea una segunda.
 *   2. El tope, mitad negativa: dos eventos seguidos dejan occurrences en 1.
 *   3. El tope, mitad positiva: pasado el minuto, sí incrementa a 2.
 *   4. El `detail` se acota a 200 caracteres.
 *   5. `webhook_auth_failed` NO tiene tope: dos seguidos dejan occurrences en 2.
 *
 * La 3 es lo que le da sentido a la 2. Sin ella, un tope que no incrementa nunca
 * —un `where` que jamás matchea, o un `on conflict` que silenciosamente no
 * actualiza— pasaría la 2 en verde. Es la regla del control positivo.
 *
 * Uso:
 *   node scripts/verify-evolution-alertas.mjs
 *
 * Crea y borra sus propios datos. La limpieza corre en un finally.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const CABECERAS = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

/** Fuente propia, para no pisar las alertas reales del sistema. */
const FUENTE = `verificador-${Date.now()}`;

// ── Helpers ─────────────────────────────────────────────────────────────────

let fallos = 0;
let pasados = 0;

function ok(desc) {
  pasados++;
  console.log(`  ok    ${desc}`);
}

function fail(desc, detalle) {
  fallos++;
  console.log(`  FALLA ${desc}`);
  if (detalle) console.log(`        ${detalle}`);
}

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: CABECERAS,
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${fn} devolvió ${r.status}: ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

async function filas(condicion) {
  const r = await fetch(
    `${URL_BASE}/rest/v1/webhook_alerts?select=id,alert_condition,detail,occurrences,last_seen_at,resolved_at&source=eq.${FUENTE}` +
    (condicion ? `&alert_condition=eq.${condicion}` : ""),
    { headers: CABECERAS }
  );
  return r.json();
}

const registrar = (condicion, detalle) =>
  rpc("record_webhook_alert", {
    p_source: FUENTE,
    p_condition: condicion,
    p_workspace_id: null,
    p_channel_id: null,
    p_detail: detalle,
  });

/** Empuja `last_seen_at` hacia atrás para simular el paso del tiempo. */
async function envejecer(id, minutos) {
  const cuando = new Date(Date.now() - minutos * 60_000).toISOString();
  const r = await fetch(`${URL_BASE}/rest/v1/webhook_alerts?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...CABECERAS, Prefer: "return=minimal" },
    body: JSON.stringify({ last_seen_at: cuando }),
  });
  if (!r.ok) throw new Error(`no se pudo envejecer la fila: ${await r.text()}`);
}

// ── Comprobaciones ──────────────────────────────────────────────────────────

const DESCONOCIDA = "webhook_unknown_instance";
const AUTENTICACION = "webhook_auth_failed";

async function main() {
  console.log(`\nVerificación de alertas del receptor (fuente de prueba: ${FUENTE})\n`);

  try {
    // ── 1. El on conflict resuelve al índice parcial sobre expresión ────────
    //
    // Si la cláusula de inferencia no reprodujera la expresión con su coalesce
    // Y el predicado `where resolved_at is null`, acá saltaría el 42P10.
    console.log("1. La inferencia del on conflict");

    const id1 = await registrar(DESCONOCIDA, "fantasma-a");
    const id2 = await registrar(DESCONOCIDA, "fantasma-b");

    if (id1 && id1 === id2) {
      ok("dos nombres distintos van a la misma condición abierta");
    } else {
      fail("dos nombres distintos van a la misma condición abierta", `id1=${id1} id2=${id2}`);
    }

    const abiertas = await filas(DESCONOCIDA);
    if (abiertas.length === 1) {
      ok("hay UNA sola fila, no una por evento");
    } else {
      fail("hay UNA sola fila, no una por evento", `hay ${abiertas.length}`);
    }

    // ── 2. El tope, mitad negativa ──────────────────────────────────────────
    console.log("\n2. El tope de un minuto, mitad negativa");

    const [fila] = await filas(DESCONOCIDA);
    if (fila?.occurrences === 1) {
      ok("el segundo evento dentro del minuto NO incrementó");
    } else {
      fail("el segundo evento dentro del minuto NO incrementó", `occurrences=${fila?.occurrences}`);
    }

    // El detalle sí se actualiza cuando la actualización pasa; acá no pasó, así
    // que sigue siendo el primero. Se comprueba para que quede claro que el tope
    // frena la fila entera y no solo el contador.
    if (fila?.detail === "fantasma-a") {
      ok("tampoco se pisó el detalle: el tope frena la actualización entera");
    } else {
      fail("tampoco se pisó el detalle", `detail=${JSON.stringify(fila?.detail)}`);
    }

    // ── 3. El tope, mitad positiva. ES LA QUE LE DA SENTIDO A LA 2 ──────────
    console.log("\n3. El tope de un minuto, mitad positiva (control positivo)");

    await envejecer(fila.id, 2);
    await registrar(DESCONOCIDA, "fantasma-c");

    const [despues] = await filas(DESCONOCIDA);
    if (despues?.occurrences === 2) {
      ok("pasado el minuto, SÍ incrementa");
    } else {
      fail(
        "pasado el minuto, SÍ incrementa",
        `occurrences=${despues?.occurrences}. Sin esto, la comprobación 2 no distingue ` +
        `un tope que funciona de un tope que no incrementa nunca.`
      );
    }

    if (despues?.detail === "fantasma-c") {
      ok("y el detalle pasa a ser el de la última ocurrencia");
    } else {
      fail("y el detalle pasa a ser el de la última ocurrencia", `detail=${JSON.stringify(despues?.detail)}`);
    }

    // ── 4. El detail acotado ────────────────────────────────────────────────
    console.log("\n4. El detalle se acota");

    await envejecer(despues.id, 2);
    await registrar(DESCONOCIDA, "x".repeat(500));

    const [acotada] = await filas(DESCONOCIDA);
    if (acotada?.detail?.length === 200) {
      ok("un nombre de 500 caracteres se guarda truncado a 200");
    } else {
      fail("un nombre de 500 caracteres se guarda truncado a 200", `largo=${acotada?.detail?.length}`);
    }

    // ── 5. La otra condición NO tiene tope ──────────────────────────────────
    //
    // La asimetría es deliberada: en webhook_auth_failed un incremento sí es un
    // mensaje perdido, porque el 401 no se reintenta. Limitarlo rompería el
    // único número de esta tabla que significa algo.
    console.log("\n5. webhook_auth_failed NO tiene tope (la asimetría es a propósito)");

    await registrar(AUTENTICACION, "firma_invalida");
    await registrar(AUTENTICACION, "firma_invalida");

    const [auth] = await filas(AUTENTICACION);
    if (auth?.occurrences === 2) {
      ok("dos rechazos seguidos incrementan a 2, sin tope");
    } else {
      fail("dos rechazos seguidos incrementan a 2, sin tope", `occurrences=${auth?.occurrences}`);
    }
  } finally {
    console.log("\nLimpieza");
    const r = await fetch(`${URL_BASE}/rest/v1/webhook_alerts?source=eq.${FUENTE}`, {
      method: "DELETE",
      headers: { ...CABECERAS, Prefer: "return=minimal" },
    });
    const quedan = await filas();
    if (r.ok && quedan.length === 0) {
      console.log("  ok    no quedaron filas de prueba");
    } else {
      console.log(`  FALLA quedaron ${quedan.length} filas de prueba`);
      fallos++;
    }
  }

  console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFalló: ${err.message}\n`);
  process.exit(1);
});
