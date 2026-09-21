#!/usr/bin/env node
/**
 * Suscribe o desuscribe `message.sent` en el webhook de Zernio.
 *
 * ── QUÉ PREGUNTA CIERRA ─────────────────────────────────────────────────────
 *
 * El negocio responde desde el celular. Si los mensajes escritos desde la app
 * de Instagram no producen ningún evento, no llegan a la base en tiempo real y
 * el agente de IA leería conversaciones donde el lead pregunta y nadie contesta.
 * Para un sistema cuya premisa es que la base local es la única fuente de
 * verdad, eso no es un hueco de datos, es un hueco de sentido.
 *
 * La documentación **dice** que `message.sent` se dispara también para lo que
 * escribe el operador desde la app nativa, pero lo dice con claridad solo para
 * WhatsApp, donde hay un campo `source` que distingue el origen. Para Instagram
 * ese campo está declarado como ausente, y además el texto y el esquema se
 * contradicen sobre si el evento trae `metadata`. No se puede cerrar leyendo.
 *
 * ── POR QUÉ ESTE ARCHIVO TIENE LAS DOS DIRECCIONES ──────────────────────────
 *
 * La decisión se tomó **antes** de medir, no después de ver el resultado:
 *
 *   - Si el echo llega, la suscripción se queda, porque F27 la va a necesitar.
 *   - Si no llega, se desuscribe y se vuelve a dos eventos.
 *
 * Escribir el revertir en el mismo archivo que el suscribir es lo que impide
 * que esto quede "a ver qué pasa". Un experimento sin camino de vuelta escrito
 * de antemano no es un experimento: es un cambio de configuración con una
 * excusa.
 *
 * ── LO QUE ESTO CAMBIA Y LO QUE NO ──────────────────────────────────────────
 *
 * Verificado en `app/api/webhooks/late/route.ts`: el descarte por tipo de
 * evento está en la línea 167 y **devuelve antes** de tocar la base, que recién
 * aparece en la 194, y antes del ledger de idempotencia, que está en la 229.
 * Así que las entregas de `message.sent` no crean filas en `webhook_events` ni
 * tocan la base.
 *
 * Lo que sí cambia, y conviene decirlo con precisión en vez de decir "nada":
 * Zernio va a entregar peticiones HTTP que antes no entregaba, nuestro receptor
 * va a responder 200 con `skipped`, y esas entregas van a dejar fila en el log
 * de Zernio, que es justamente lo que se quiere medir. El descarte también
 * ocurre **antes** de la verificación de firma, así que esas entregas se
 * responden 200 sin validar nada; no importa porque no se hace nada con ellas,
 * pero es parte de lo que cambia.
 *
 * ── CUIDADO CON EL PRÓXIMO SYNC ─────────────────────────────────────────────
 *
 * La lista de eventos está cableada en los dos llamadores de
 * `ensureWebhookRegistered`. Esa función solo actualiza si falta alguno de SUS
 * eventos, así que un evento de más sobrevive a un sync normal. Pero si el sync
 * dispara un update por otro motivo —la URL cambió, el secreto no coincide—
 * **reescribe la lista completa con los dos cableados y se lleva puesto
 * `message.sent` sin avisar**. Si después de la medición la suscripción se
 * queda, hay que agregarlo también en el código.
 *
 * Uso:
 *   node scripts/suscribir-message-sent.mjs --suscribir
 *   node scripts/suscribir-message-sent.mjs --revertir
 *   node scripts/suscribir-message-sent.mjs            (solo muestra el estado)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { protegerSalida, redactar } from "./redaccion.mjs";

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
const ZERNIO = "https://zernio.com/api";

/** Los que el código registra por su cuenta. Ver el aviso sobre el sync. */
const EVENTOS_BASE = ["message.received", "comment.received"];
const EXTRA = "message.sent";

if (!URL_BASE || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

async function main() {
  const suscribir = process.argv.includes("--suscribir");
  const revertir = process.argv.includes("--revertir");
  if (suscribir && revertir) {
    console.error("--suscribir y --revertir son excluyentes.");
    return 1;
  }

  const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
  const canales = await (
    await fetch(`${URL_BASE}/rest/v1/channels?select=workspace_id&platform=eq.instagram&is_active=eq.true`, {
      headers: h,
    })
  ).json();
  if (!Array.isArray(canales) || canales.length === 0) {
    console.error("No hay canal de Instagram activo.");
    return 1;
  }

  const clave = await (
    await fetch(`${URL_BASE}/rest/v1/rpc/read_secret`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ secret_name: "zernio_api_key", workspace_id: canales[0].workspace_id }),
    })
  ).json();
  if (typeof clave !== "string" || !clave) {
    console.error("No se pudo leer la clave de Zernio de Vault.");
    return 1;
  }
  const sumarSecreto = protegerSalida([clave]);

  const res = await fetch(`${ZERNIO}/v1/webhooks/settings`, {
    headers: { Authorization: `Bearer ${clave}` },
  });
  if (!res.ok) {
    console.error(`La configuración respondió ${res.status}.`);
    return 1;
  }
  const webhooks = (await res.json())?.webhooks ?? [];
  for (const w of webhooks) sumarSecreto(w?.secret);

  const mio = webhooks.find((w) => w.name === "Zernflow");
  if (!mio) {
    console.error('No se encontró el webhook "Zernflow".');
    return 1;
  }

  const actuales = mio.events ?? [];
  console.log(`Webhook "Zernflow"  ${mio.url}`);
  console.log(`  eventos actuales  ${actuales.join(", ")}`);
  console.log(`  secreto           ${redactar(mio.secret)}`);

  if (!suscribir && !revertir) {
    console.log(`\n${EXTRA} ${actuales.includes(EXTRA) ? "ESTÁ" : "no está"} suscrito.`);
    console.log("Pasá --suscribir o --revertir para cambiarlo.");
    return 0;
  }

  const deseados = suscribir ? [...EVENTOS_BASE, EXTRA] : [...EVENTOS_BASE];
  if (actuales.length === deseados.length && deseados.every((e) => actuales.includes(e))) {
    console.log(`\nYa está como se pide: ${deseados.join(", ")}. No se toca nada.`);
    return 0;
  }

  // El secreto y la URL se conservan tal cual: esto cambia eventos y nada más.
  const put = await fetch(`${ZERNIO}/v1/webhooks/settings`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      _id: mio._id,
      name: mio.name,
      url: mio.url,
      secret: mio.secret,
      events: deseados,
    }),
  });
  if (!put.ok) {
    console.error(`\nEl cambio falló: ${put.status}`);
    return 1;
  }

  // Lectura de vuelta: que el PUT devuelva 200 no prueba que haya quedado.
  const verif = await fetch(`${ZERNIO}/v1/webhooks/settings`, {
    headers: { Authorization: `Bearer ${clave}` },
  });
  const despues = ((await verif.json())?.webhooks ?? []).find((w) => w.name === "Zernflow");
  const quedaron = despues?.events ?? [];
  console.log(`\n  eventos después   ${quedaron.join(", ")}`);

  const ok = deseados.every((e) => quedaron.includes(e)) && quedaron.length === deseados.length;
  if (!ok) {
    console.error("NO QUEDÓ como se pidió. Ver arriba.");
    return 1;
  }
  if (despues.secret !== mio.secret) {
    console.error("EL SECRETO CAMBIÓ y no tenía que cambiar. Verificar el registro antes de seguir.");
    return 1;
  }
  console.log(suscribir ? "Suscrito. El secreto no cambió." : "Revertido a los dos eventos base.");
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("Error inesperado:", e);
    process.exit(1);
  });
