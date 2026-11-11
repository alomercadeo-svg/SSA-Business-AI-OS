#!/usr/bin/env node
/**
 * 1a, la condición del paso 2 (ítem 7 de la sesión de cierre, 10/11/2026):
 * antes de vaciar `workspaces.webhook_secret`, probar en PRODUCCIÓN que el
 * receptor de Zernio acepta un aviso firmado con un secreto que está SOLO en
 * Vault (`zernio_webhook_secret`), con la columna vacía.
 *
 * En un espacio fantasma: un canal de Instagram de mentira, el secreto
 * guardado con `store_secret` y la columna en nulo.
 *   - Firmado con el secreto de Vault: 200 y el mensaje queda guardado.
 *   - Control negativo: firmado con otro secreto, 401 y no se guarda nada.
 *   - Control de presencia: el primero se guardó, así que el segundo, por
 *     ausencia, significa algo.
 * Limpia el canal, los contactos, los eventos, el secreto de Vault y el
 * espacio.
 *
 * Uso: node scripts/verify-secreto-vault.mjs
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { admin, check, correr, crearUsuario, limpiar, rpcAdmin } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SOBRE = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-received.json", import.meta.url), "utf8")).payload;
const SECRETO = randomBytes(32).toString("hex");
const CUENTA = `vvault${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const eventos = [];

async function aviso(secreto) {
  const id = `v-vault-evt-${randomUUID()}`;
  eventos.push(id);
  const lead = `vV${String(Date.now()).slice(-6)}`;
  const a = structuredClone(SOBRE);
  a.id = id;
  a.account.id = CUENTA;
  a.conversation.participantId = lead;
  a.conversation.platformConversationId = lead;
  a.conversation.participantUsername = `lead.${lead}`;
  a.message.sender.id = lead;
  a.message.sender.username = `lead.${lead}`;
  a.message.platformMessageId = `mid-${randomUUID()}`;
  a.message.sentAt = new Date().toISOString();
  a.message.text = "prueba del secreto en Vault";
  a.message.attachments = [];
  const cuerpo = JSON.stringify(a);
  const res = await fetch(`${APP_URL}/api/webhooks/late`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-late-signature": createHmac("sha256", secreto).update(cuerpo).digest("hex") },
    body: cuerpo,
  });
  return { status: res.status, mid: a.message.platformMessageId };
}

const guardado = async (mid) => ((await admin(`messages?select=id&platform_message_id=eq.${encodeURIComponent(mid)}`)).data ?? []).length;

let espacio = null;
await correr(async () => {
  const owner = await crearUsuario("vault-owner");
  espacio = owner.espacio;
  await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ webhook_secret: null }) });
  const g = await rpcAdmin("store_secret", { secret_name: "zernio_webhook_secret", secret_value: SECRETO, workspace_id: espacio });
  check(g.status < 300, "el secreto quedó solo en Vault", `HTTP ${g.status}`);
  const canal = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, platform: "instagram", provider: "zernio", late_account_id: CUENTA, username: `cuentav${randomUUID().slice(0, 6)}` }) })).data?.[0]?.id;
  if (!canal) throw new Error("no se pudo crear el canal fantasma");
  limpiar.canales.push(canal);
  try {
    const ws = await admin(`workspaces?select=webhook_secret&id=eq.${espacio}`);
    check(ws.data?.[0]?.webhook_secret === null, "la columna del espacio está vacía");
    const bien = await aviso(SECRETO);
    const okBien = check(bien.status === 200, `firmado con el secreto de Vault: 200 (HTTP ${bien.status})`);
    check((await guardado(bien.mid)) === 1, "y el mensaje quedó guardado (presencia)");
    const mal = await aviso(randomBytes(32).toString("hex"));
    check(mal.status === 401, `firmado con otro secreto: 401 (HTTP ${mal.status})`);
    if (okBien) check((await guardado(mal.mid)) === 0, "y no se guardó nada");
  } finally {
    for (const id of eventos) await admin(`webhook_events?event_id=eq.${id}`, { method: "DELETE" });
    await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    await rpcAdmin("delete_secret", { secret_name: "zernio_webhook_secret", workspace_id: espacio });
  }
});
