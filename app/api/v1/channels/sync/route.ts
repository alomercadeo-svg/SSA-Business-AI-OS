import { NextResponse } from "next/server";
import { requireManager } from "@/lib/workspace";
import { CHANNEL_PUBLIC_COLUMNS } from "@/lib/safe-columns";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/vault";
import {
  ensureWebhookRegistered,
  getOrCreateWorkspaceWebhookSecret,
} from "@/lib/zernio-webhook";
import { backfillInboxConversations } from "@/lib/inbox-sync";
import { isSupportedPlatform } from "@/lib/platforms";

/**
 * POST /api/v1/channels/sync
 *
 * Syncs all Zernio accounts as channels for the current workspace.
 * Creates new channels for accounts not yet in the DB.
 * Deactivates channels whose Zernio accounts no longer exist.
 */
export async function POST() {
  const { contexto, error: authError } = await requireManager();
  if (authError) return authError;
  const { workspace, supabase } = contexto;

  const apiKey = await getZernioApiKey(supabase, workspace.id);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Zernio API key not configured. Go to Settings first." },
      { status: 400 }
    );
  }

  const zernio = createZernioClient(apiKey);

  try {
    const res = await zernio.accounts.listAccounts();
    const lateAccounts = res.data?.accounts ?? [];

    // Get existing channels for this workspace
    const { data: existingChannels } = await supabase
      .from("channels")
      .select(CHANNEL_PUBLIC_COLUMNS)
      .eq("workspace_id", workspace.id);

    const existingByZernioId = new Map(
      (existingChannels ?? []).map((c) => [c.late_account_id, c])
    );

    // The SDK type doesn't declare profilePicture but the API returns it
    const lateAccountIds = new Set(lateAccounts.map((a: { _id?: string }) => a._id).filter(Boolean));
    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    const failed: string[] = [];

    for (const account of lateAccounts) {
      if (!account._id) continue;
      // A Zernio key also carries accounts we can't drive (TikTok, YouTube,
      // ads accounts...). Inserting those hit the channels platform check
      // constraint and, since the error was discarded, vanished silently.
      if (!isSupportedPlatform(account.platform)) {
        if (account.platform) skipped.push(account.platform);
        continue;
      }
      const acc = account as typeof account & { profilePicture?: string };
      const profilePic = acc.profilePicture || null;

      const existing = existingByZernioId.get(account._id);

      if (existing) {
        if (
          existing.username !== (account.username || null) ||
          existing.display_name !== (account.displayName || account.username || null) ||
          existing.profile_picture !== profilePic
        ) {
          await supabase
            .from("channels")
            .update({
              username: account.username || null,
              display_name: account.displayName || account.username || null,
              profile_picture: profilePic,
            })
            .eq("id", existing.id);
          updated++;
        }
      } else {
        const { error: insertErr } = await supabase.from("channels").insert({
          workspace_id: workspace.id,
          platform: account.platform,
          late_account_id: account._id,
          username: account.username || null,
          display_name: account.displayName || account.username || null,
          profile_picture: profilePic,
          is_active: true,
        });
        if (insertErr) {
          // Reporting a channel we did not store is how #16 stayed hidden:
          // the platform check constraint rejected the row and the UI said OK.
          console.error("[channels/sync] channel insert failed:", insertErr);
          failed.push(`${account.platform}: ${insertErr.message}`);
          continue;
        }
        created++;
      }
    }

    // Deactivate channels whose Zernio accounts no longer exist
    let deactivated = 0;
    for (const channel of existingChannels ?? []) {
      if (!lateAccountIds.has(channel.late_account_id) && channel.is_active) {
        await supabase
          .from("channels")
          .update({ is_active: false })
          .eq("id", channel.id);
        deactivated++;
      }
    }

    // Re-register the webhook so inbound events reach the Inbox. Both the
    // Channels "Sync" button and the OAuth callback land here, and until now
    // registration only happened in the Settings test-key flow (#12).
    // Best-effort: a failure must not block the channel sync.
    try {
      const secret = await getOrCreateWorkspaceWebhookSecret(supabase, workspace.id);
      await ensureWebhookRegistered(zernio, {
        appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        secret,
        events: ["message.received", "comment.received"],
      });
    } catch (err) {
      console.error("[channels/sync] webhook auto-registration failed:", err);
    }

    // Backfill conversations that predate webhook registration (best-effort).
    let conversationsImported = 0;
    try {
      const { data: activeChannels } = await supabase
        .from("channels")
        .select("id, late_account_id, platform")
        .eq("workspace_id", workspace.id)
        .eq("is_active", true);

      const { imported } = await backfillInboxConversations({
        supabase,
        zernio,
        workspaceId: workspace.id,
        channels: activeChannels ?? [],
      });
      conversationsImported = imported;
    } catch (err) {
      console.error("[channels/sync] inbox backfill failed:", err);
    }

    // Return updated channel list
    const { data: channels } = await supabase
      .from("channels")
      .select(CHANNEL_PUBLIC_COLUMNS)
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      channels: channels ?? [],
      synced: {
        created,
        updated,
        deactivated,
        conversationsImported,
        skipped: [...new Set(skipped)],
        failed,
      },
    });
  } catch (error) {
    console.error("Failed to sync channels:", error);
    return NextResponse.json(
      { error: `Failed to sync channels: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
