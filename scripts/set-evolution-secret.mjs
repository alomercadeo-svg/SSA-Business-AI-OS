#!/usr/bin/env node
/**
 * Genera un secreto de Evolution, lo guarda en Supabase Vault y lo deja en el
 * portapapeles. NUNCA lo imprime.
 *
 * POR QUÉ ESTA REGLA EXISTE
 * Un secreto que pasa por la terminal queda en el scrollback, en el historial
 * del shell, en la transcripción de la sesión de trabajo y, si la sesión es con
 * una IA, en el contexto del modelo. Con la API key de Zernio ya nos pasó y
 * hubo que rotarla. Lo único que se imprime acá es "guardado" y el largo.
 *
 * Uso:
 *   node scripts/set-evolution-secret.mjs evolution_api_key
 *   node scripts/set-evolution-secret.mjs evolution_webhook_secret
 *   node scripts/set-evolution-secret.mjs evolution_webhook_secret --rotar
 *
 * Con --rotar, el secreto actual se copia a `evolution_webhook_secret_previous`
 * ANTES de escribir el nuevo. Eso es lo que hace que la ventana de rotación no
 * pierda mensajes: el receptor acepta los dos mientras Evolution todavía firma
 * con el viejo. El procedimiento completo, con el orden y cómo verificar cada
 * paso, está en docs/despliegue-evolution.md.
 */

import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

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

// ── Nombres permitidos ──────────────────────────────────────────────────────

const ACTUAL = "evolution_webhook_secret";
const ANTERIOR = "evolution_webhook_secret_previous";

const PERMITIDOS = new Set(["evolution_api_key", ACTUAL]);

const nombre = process.argv[2];
const rotar = process.argv.includes("--rotar");

if (!PERMITIDOS.has(nombre)) {
  console.error(`Uso: node scripts/set-evolution-secret.mjs <${[...PERMITIDOS].join(" | ")}> [--rotar]`);
  process.exit(1);
}
if (rotar && nombre !== ACTUAL) {
  console.error(`--rotar solo aplica a ${ACTUAL}.`);
  process.exit(1);
}

// ── Supabase ────────────────────────────────────────────────────────────────

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

/**
 * El workspace, resuelto solo si hay exactamente uno.
 *
 * El proyecto es single-tenant, pero la arquitectura del fork es multi-tenant y
 * se conserva. Adivinar cuál de varios sería escribir un secreto en el lugar
 * equivocado sin decirlo, así que con más de uno el script para y pide el id.
 */
async function resolverWorkspace() {
  const explicito = process.argv.find((a) => a.startsWith("--workspace="));
  if (explicito) return explicito.slice("--workspace=".length);

  const r = await fetch(`${URL_BASE}/rest/v1/workspaces?select=id,name`, { headers: CABECERAS });
  const filas = await r.json();

  if (!Array.isArray(filas) || filas.length === 0) {
    throw new Error("No hay ningún workspace en la base.");
  }
  if (filas.length > 1) {
    throw new Error(
      `Hay ${filas.length} workspaces. Pasá cuál con --workspace=<uuid>:\n` +
      filas.map((w) => `  ${w.id}  ${w.name}`).join("\n")
    );
  }
  console.log(`Workspace: ${filas[0].name} (${filas[0].id})`);
  return filas[0].id;
}

// ── Entrega del valor sin imprimirlo ────────────────────────────────────────

/**
 * Deja el valor donde se pueda pegar, sin que pase por la salida estándar.
 *
 * En macOS va al portapapeles. En cualquier otro lado cae a un archivo con
 * permisos 600 y se avisa que hay que borrarlo: es peor que el portapapeles,
 * pero es explícito, y un secreto en un archivo que alguien tiene que borrar a
 * mano es mejor que un secreto en el scrollback de una terminal para siempre.
 */
function entregar(valor) {
  const pb = spawnSync("pbcopy", { input: valor });
  if (pb.status === 0) return { via: "portapapeles", donde: null };

  const ruta = join(tmpdir(), `evolution-secret-${Date.now()}.txt`);
  writeFileSync(ruta, valor, { mode: 0o600 });
  chmodSync(ruta, 0o600);
  return { via: "archivo", donde: ruta };
}

// ── Principal ───────────────────────────────────────────────────────────────

async function main() {
  const workspaceId = await resolverWorkspace();

  if (rotar) {
    const anterior = await rpc("read_secret", { secret_name: ACTUAL, workspace_id: workspaceId });
    if (!anterior) {
      console.error(
        `No hay un ${ACTUAL} guardado, así que no hay nada que rotar.\n` +
        `Corré el script sin --rotar para crearlo por primera vez.`
      );
      process.exit(1);
    }
    await rpc("store_secret", {
      secret_name: ANTERIOR,
      secret_value: anterior,
      workspace_id: workspaceId,
    });
    console.log(`  ok    el secreto actual se guardó como ${ANTERIOR}`);
    console.log(
      `        durante la ventana de rotación el receptor acepta los dos.\n` +
      `        NO borres el anterior hasta confirmar que Evolution firma con el nuevo.`
    );
  }

  // 32 bytes en hex: 64 caracteres. Es el mismo largo que usa
  // generateWebhookSecret() para el secreto de Zernio.
  const valor = randomBytes(32).toString("hex");

  await rpc("store_secret", {
    secret_name: nombre,
    secret_value: valor,
    workspace_id: workspaceId,
  });

  const entrega = entregar(valor);

  console.log(`  ok    ${nombre} guardado en Vault, ${valor.length} caracteres`);
  if (entrega.via === "portapapeles") {
    console.log(`        copiado al portapapeles: pegalo donde haga falta sin leerlo`);
  } else {
    console.log(`        no hay pbcopy. Quedó en ${entrega.donde} (permisos 600)`);
    console.log(`        BORRALO apenas lo pegues: rm "${entrega.donde}"`);
  }
}

main().catch((err) => {
  // El mensaje de error nunca lleva el valor: las RPC de la 00018 tampoco lo
  // incluyen en sus excepciones, a propósito.
  console.error(`Falló: ${err.message}`);
  process.exit(1);
});
