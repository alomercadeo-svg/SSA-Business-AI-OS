#!/usr/bin/env node
/**
 * Verificación del despliegue de Evolution API (F21).
 *
 * Tres comprobaciones, y la tercera existe para que la segunda signifique algo.
 *
 *   1. La versión que responde el servidor es la fijada en el repo.
 *   2. El servidor rechaza sin clave.
 *   3. El servidor acepta con clave.
 *
 * ── POR QUÉ LA 1 ESTÁ ACÁ Y NO EN UN DOCUMENTO ──────────────────────────────
 *
 * El procedimiento de re-verificar `jwt_key` antes de subir de versión estaba
 * escrito en `docs/despliegue-evolution.md`, y eso no es un control: depende de
 * que alguien lea un documento antes de cambiar un tag en la interfaz de
 * Railway. Ahora la versión esperada vive en `lib/evolution-version.mjs`, con el
 * procedimiento en el comentario de al lado, y este script la compara contra lo
 * que hay corriendo. Subir la imagen sin actualizar el repo hace fallar esto, y
 * el mensaje de falla dice qué leer. El olvido deja de ser silencioso, que es el
 * único modo de falla que importa acá.
 *
 * ── POR QUÉ LA 3 ──────────────────────────────────────────────────────────────
 *
 * Es el control positivo de la 2. Sin ella, un 401 podría venir de un servidor
 * que no arrancó y no de uno bien protegido, y el resultado sería un verde
 * falso. Si la 3 falla, el veredicto de la 2 es "no concluyente", dicho con esas
 * palabras.
 *
 * Uso:
 *   node scripts/verify-evolution-deploy.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EVOLUTION_VERSION_ESPERADA, EVOLUTION_IMAGEN } from "../lib/evolution-version.mjs";

// ── Entorno ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const EVOLUTION_URL = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/$/, "");

/**
 * El salteo es RUIDOSO y con fecha de vencimiento escrita.
 *
 * Un check que se saltea en silencio cuando falta configuración es exactamente
 * la forma en que los checks se mueren: pasa en verde durante meses y nadie nota
 * que dejó de comprobar nada. Esto imprime por qué se salteó y hasta cuándo es
 * esperable.
 */
if (!EVOLUTION_URL) {
  console.log("\n  SALTEADO  verificación del despliegue de Evolution");
  console.log("            falta EVOLUTION_API_URL en .env");
  console.log("            (esperado hasta que se complete el Paso 3 del Bloque 2;");
  console.log("             a partir de ahí, que esto aparezca es un problema)\n");
  process.exit(0);
}

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let fallos = 0;
let pasados = 0;

const ok = (d) => { pasados++; console.log(`  ok    ${d}`); };
const fail = (d, detalle) => {
  fallos++;
  console.log(`  FALLA ${d}`);
  if (detalle) for (const linea of String(detalle).split("\n")) console.log(`        ${linea}`);
};

/** La clave global de Evolution, desde Vault. Nunca se imprime. */
async function claveDeEvolution() {
  const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
  const ws = await (await fetch(`${URL_BASE}/rest/v1/workspaces?select=id`, { headers: h })).json();
  if (!Array.isArray(ws) || ws.length !== 1) {
    throw new Error(`esperaba exactamente un workspace, hay ${ws?.length}`);
  }
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/read_secret`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ secret_name: "evolution_api_key", workspace_id: ws[0].id }),
  });
  const texto = await r.text();
  return texto ? JSON.parse(texto) : null;
}

// ── Comprobaciones ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\nVerificación del despliegue de Evolution\n  ${EVOLUTION_URL}\n`);

  // ── 1. La versión ─────────────────────────────────────────────────────────
  console.log("1. La versión desplegada es la fijada en el repo");

  let versionQueResponde = null;
  try {
    const r = await fetch(`${EVOLUTION_URL}/`, { signal: AbortSignal.timeout(15_000) });
    const cuerpo = await r.json();
    versionQueResponde = cuerpo?.version ?? null;
  } catch (err) {
    fail("el servidor responde en /", err.message);
  }

  if (versionQueResponde === EVOLUTION_VERSION_ESPERADA) {
    ok(`versión ${versionQueResponde}, que es la esperada`);
  } else if (versionQueResponde) {
    fail(
      `versión ${versionQueResponde}, se esperaba ${EVOLUTION_VERSION_ESPERADA}`,
      "ANTES de aceptar esta versión hay que leer el webhook.controller.ts de la\n" +
      "versión nueva y confirmar que `jwt_key` sigue existiendo y firmando igual.\n" +
      "El procedimiento completo está en el comentario de lib/evolution-version.mjs.\n" +
      "\n" +
      "El mecanismo NO está documentado por Evolution, así que puede desaparecer sin\n" +
      "aviso. Si eso pasa, los webhooks dejan de traer el header Authorization, el\n" +
      "receptor sigue rechazando con 401, y Evolution descarta cada evento sin\n" +
      "reintentar: mensajes de leads perdidos en silencio.\n" +
      "\n" +
      `La imagen que el repo espera es ${EVOLUTION_IMAGEN}.`
    );
  }

  // ── 2. Rechaza sin clave ──────────────────────────────────────────────────
  console.log("\n2. El servidor rechaza sin clave");

  let sinClave = null;
  try {
    const r = await fetch(`${EVOLUTION_URL}/instance/fetchInstances`, {
      signal: AbortSignal.timeout(15_000),
    });
    sinClave = r.status;
  } catch (err) {
    fail("la petición sin clave llegó a destino", err.message);
  }

  // ── 3. Acepta con clave. ES EL CONTROL POSITIVO DE LA 2 ───────────────────
  console.log("\n3. El servidor acepta con clave (control positivo)");

  let conClave = null;
  try {
    const clave = await claveDeEvolution();
    if (!clave) {
      fail(
        "hay una clave de Evolution en Vault",
        "sin ella no se puede probar el camino afirmativo.\n" +
        "Correr: node scripts/set-evolution-secret.mjs evolution_api_key"
      );
    } else {
      const r = await fetch(`${EVOLUTION_URL}/instance/fetchInstances`, {
        headers: { apikey: clave },
        signal: AbortSignal.timeout(15_000),
      });
      conClave = r.status;
      if (conClave === 200) {
        ok("con la clave correcta devuelve 200");
      } else {
        fail(`con la clave correcta devuelve ${conClave}, se esperaba 200`);
      }
    }
  } catch (err) {
    fail("la petición con clave llegó a destino", err.message);
  }

  // El veredicto de la 2 depende de la 3.
  if (conClave === 200) {
    if (sinClave === 401) {
      ok("sin clave devuelve 401");
    } else {
      fail(`sin clave devuelve ${sinClave}, se esperaba 401`);
    }
  } else {
    console.log("  NO CONCLUYENTE  el resultado de la comprobación 2");
    console.log("        el control positivo falló, así que un 401 sin clave no distingue");
    console.log("        un servidor bien protegido de uno que no arrancó.");
    fallos++;
  }

  console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFalló: ${err.message}\n`);
  process.exit(1);
});
