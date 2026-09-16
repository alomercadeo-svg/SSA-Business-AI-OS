import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/workspace";
import { CHANNEL_PUBLIC_COLUMNS } from "@/lib/safe-columns";
import { createZernioClient } from "@/lib/zernio-client";
import {
  ensureWebhookRegistered,
  getOrCreateWorkspaceWebhookSecret,
} from "@/lib/zernio-webhook";
import { backfillInboxConversations, canalesConCuentaDeZernio } from "@/lib/inbox-sync";
import { isSupportedPlatform } from "@/lib/platforms";
import { SECRET_NAMES, setWorkspaceSecret } from "@/lib/vault";

/**
 * POST /api/v1/channels/test-key
 *
 * Tests a Zernio API key, saves it to the workspace, and auto-syncs channels.
 *
 * Solo Owner y Admin. Hasta la Sesión B esta ruta no tenía **ninguna** capa de
 * autorización: no llamaba a `getUser()`, no miraba membresía, y tomaba el
 * `workspaceId` del body. Un POST sin sesión llegaba a Zernio con la clave que
 * mandara quien llamara y recibía `{ accounts }` de vuelta, o sea un oráculo
 * abierto para validar claves de Zernio robadas.
 *
 * El `workspaceId` ya no se lee del body: sale de la sesión. Lo que manda el
 * cliente no decide sobre qué workspace se escribe.
 */
export async function POST(request: NextRequest) {
  const { contexto, error: authError } = await requireManager();
  if (authError) return authError;
  const { workspace, supabase } = contexto;

  const body = await request.json();
  const { apiKey } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json(
      { error: "apiKey is required" },
      { status: 400 }
    );
  }

  // Validate the key by listing accounts
  let accounts: Array<{ _id?: string; platform?: string; username?: string; displayName?: string; profilePicture?: string }>;
  try {
    const zernio = createZernioClient(apiKey.trim());
    const res = await zernio.accounts.listAccounts();
    accounts = (res.data?.accounts ?? []) as typeof accounts;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid API key or connection error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Save the API key to Vault. store_secret solo acepta a Owner y Admin, así
  // que un Member no puede sobreescribir la clave del workspace (antes podía:
  // la RLS de `workspaces` deja actualizar a cualquier miembro).
  const { error: saveErr } = await setWorkspaceSecret(
    supabase,
    workspace.id,
    SECRET_NAMES.zernio,
    apiKey.trim()
  );

  if (saveErr) {
    return NextResponse.json(
      { error: `Key valid but failed to save: ${saveErr}` },
      { status: 500 }
    );
  }

  // Register (or refresh) this deployment's webhook in Zernio so inbound
  // messages/comments reach the Inbox. Best-effort: a failure here must not
  // block saving the key or syncing channels.
  try {
    const secret = await getOrCreateWorkspaceWebhookSecret(supabase, workspace.id);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const zernio = createZernioClient(apiKey.trim());
    await ensureWebhookRegistered(zernio, {
      appUrl,
      secret,
      events: ["message.received", "comment.received"],
    });
  } catch (err) {
    console.error("[test-key] webhook auto-registration failed:", err);
  }

  // Auto-sync channels
  const { data: existingChannels } = await supabase
    .from("channels")
    .select(CHANNEL_PUBLIC_COLUMNS)
    .eq("workspace_id", workspace.id);

  const existingByLateId = new Map(
    (existingChannels ?? []).map((c) => [c.late_account_id, c])
  );

  for (const account of accounts) {
    if (!account._id) continue;
    if (existingByLateId.has(account._id)) continue;
    if (!isSupportedPlatform(account.platform)) continue;

    const { error: insertErr } = await supabase.from("channels").insert({
      workspace_id: workspace.id,
      platform: account.platform,
      late_account_id: account._id,
      username: account.username || null,
      display_name: account.displayName || account.username || null,
      profile_picture: account.profilePicture || null,
      is_active: true,
    });
    if (insertErr) {
      console.error("[test-key] channel insert failed:", insertErr);
    }
  }

  // Backfill conversations that predate webhook registration so a
  // first-time API-key setup fills the Inbox immediately (best-effort).
  try {
    const { data: activeChannels } = await supabase
      .from("channels")
      .select("id, late_account_id, platform")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true);

    await backfillInboxConversations({
      supabase,
      zernio: createZernioClient(apiKey.trim()),
      workspaceId: workspace.id,
      channels: canalesConCuentaDeZernio(activeChannels ?? []),
    });
  } catch (err) {
    console.error("[test-key] inbox backfill failed:", err);
  }

  return NextResponse.json({ accounts });
}
