import { NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireManager } from "@/lib/workspace";
import { CHANNEL_PUBLIC_COLUMNS } from "@/lib/safe-columns";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/vault";
import {
  ensureWebhookRegistered,
  getOrCreateWorkspaceWebhookSecret,
  WEBHOOK_EVENTS,
} from "@/lib/zernio-webhook";
import { backfillInboxConversations, canalesConCuentaDeZernio } from "@/lib/inbox-sync";
import { isSupportedPlatform } from "@/lib/platforms";
import {
  ALERTA_CERO_CUENTAS,
  AVISO_CERO_CUENTAS,
  decidirCanalDeCuenta,
  planDeSincronizacion,
} from "@/lib/channel-rules";
import { actorDe, auditarAlertaSiEsNueva, etiquetaDeCanal, registrarAuditoria } from "@/lib/auditoria";
import { createServiceClient } from "@/lib/supabase/server";
import { notificarAlerta } from "@/lib/correo";

/**
 * POST /api/v1/channels/sync
 *
 * Syncs all Zernio accounts as channels for the current workspace.
 * Creates new channels for accounts not yet in the DB.
 * Deactivates channels whose Zernio accounts no longer exist.
 *
 * Salvo en tres casos que antes apagaban canales vivos sin aviso (§15 del
 * plano, resuelto el 06/10/2026): una respuesta sin lista de cuentas, una lista
 * vacía con canales de Zernio activos, y una cuenta de un perfil que excede el
 * límite del plan. La decisión vive en `planDeSincronizacion`
 * (lib/channel-rules.ts) y se toma antes de escribir nada.
 */
export async function POST() {
  const { contexto, error: authError } = await requireManager();
  if (authError) return authError;
  const { workspace, supabase, user } = contexto;
  const actor = actorDe(user);

  const apiKey = await getZernioApiKey(supabase, workspace.id);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Zernio API key not configured. Go to Settings first." },
      { status: 400 }
    );
  }

  const zernio = createZernioClient(apiKey);

  try {
    // `includeOverLimit`: sin él, Zernio no trae las cuentas de perfiles que
    // exceden el límite del plan, y esos canales se desactivaban. Los perfiles
    // se piden porque la marca de exceso está en el perfil, no en la cuenta.
    const [res, perfilesRes] = await Promise.all([
      zernio.accounts.listAccounts({ query: { includeOverLimit: true } }),
      zernio.profiles.listProfiles({ query: { includeOverLimit: true } }),
    ]);

    // Get existing channels for this workspace
    const { data: existingChannels } = await supabase
      .from("channels")
      .select(CHANNEL_PUBLIC_COLUMNS)
      .eq("workspace_id", workspace.id);

    const plan = planDeSincronizacion({
      cuentas: res.data?.accounts,
      perfiles: perfilesRes.data?.profiles,
      canales: existingChannels ?? [],
    });
    // Forma inesperada: no se toca ningún canal, ni se registra el webhook, ni
    // se importa nada. Antes, `?? []` la convertía en una lista vacía.
    if (plan.error !== null) {
      console.error("[channels/sync]", plan.error);
      return NextResponse.json({ error: plan.error }, { status: 502 });
    }
    const lateAccounts: NonNullable<typeof res.data>["accounts"] = res.data!.accounts;

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

      const excede = plan.excedidas.has(account._id);
      // F26: la identidad del canal es la cuenta (`platformUserId`), no la
      // ranura de Zernio (`_id`). La regla está en `decidirCanalDeCuenta`.
      const decision = decidirCanalDeCuenta(account, existingChannels ?? []);

      if (decision.tipo === "existente" && decision.completarIdentidad) {
        await supabase
          .from("channels")
          .update({ platform_account_id: decision.completarIdentidad })
          .eq("id", decision.canal.id);
      }

      if (decision.tipo === "existente") {
        const existing = decision.canal;
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
        // El exceso de plan es un estado propio: se marca y se desmarca, y
        // nunca desactiva el canal.
        if (existing.excede_plan_zernio !== excede) {
          await supabase
            .from("channels")
            .update({ excede_plan_zernio: excede })
            .eq("id", existing.id);
        }
      } else {
        // Reemplazo: la fila vieja se desactiva ANTES de insertar la nueva,
        // porque desde la 00031 solo puede haber un canal activo por ranura.
        // No se renombra: lo que colgaba de ella sigue siendo de la cuenta
        // vieja, y la nueva arranca con su propia fecha de conexión.
        if (decision.tipo === "reemplazar") {
          await supabase.from("channels").update({ is_active: false }).eq("id", decision.viejo.id);
        }
        const { data: nuevo, error: insertErr } = await supabase
          .from("channels")
          .insert({
            workspace_id: workspace.id,
            platform: account.platform,
            late_account_id: account._id,
            platform_account_id: decision.identidad,
            username: account.username || null,
            display_name: account.displayName || account.username || null,
            profile_picture: profilePic,
            is_active: true,
            excede_plan_zernio: excede,
          })
          .select("id")
          .single();
        if (insertErr || !nuevo) {
          // Reporting a channel we did not store is how #16 stayed hidden:
          // the platform check constraint rejected the row and the UI said OK.
          console.error("[channels/sync] channel insert failed:", insertErr);
          failed.push(`${account.platform}: ${insertErr?.message ?? "sin fila"}`);
          if (decision.tipo === "reemplazar") {
            // Sin canal nuevo, la cuenta se quedaría sin canal activo: se
            // vuelve a encender la fila vieja y el reemplazo queda para la
            // próxima sincronización.
            await supabase.from("channels").update({ is_active: true }).eq("id", decision.viejo.id);
          }
          continue;
        }
        const etiqueta = etiquetaDeCanal({ platform: account.platform, username: account.username });
        await registrarAuditoria(
          decision.tipo === "reemplazar"
            ? {
                workspaceId: workspace.id,
                actor,
                accion: "canal.reemplazado",
                entidad: { tipo: "canal", id: nuevo.id, etiqueta },
                detalle: {
                  canal_viejo_id: decision.viejo.id,
                  cuenta_vieja: decision.viejo.platform_account_id,
                  cuenta_nueva: decision.identidad,
                  ranura_zernio: account._id,
                  usuario_viejo: (decision.viejo as { username?: string | null }).username ?? null,
                },
              }
            : {
                workspaceId: workspace.id,
                actor,
                accion: "canal.conectado",
                entidad: { tipo: "canal", id: nuevo.id, etiqueta },
                detalle: { origen: "sincronizacion" },
              }
        );
        created++;
      }
    }

    // Deactivate channels whose Zernio accounts no longer exist.
    //
    // La decisión vive en `debeDesactivarseCanal` y no acá adentro porque tiene
    // dos mitades que se rompen en silencio —desactivar un canal de Evolution
    // que no corresponde, o dejar de desactivar uno de Zernio que sí— y las dos
    // necesitan test. Ver lib/channel-rules.ts.
    //
    // Con cero cuentas y canales de Zernio activos, `plan.aDesactivar` viene
    // vacío: no se desactiva nada, se avisa en pantalla y se abre una alerta.
    let deactivated = 0;
    for (const channelId of plan.aDesactivar) {
      await supabase
        .from("channels")
        .update({ is_active: false })
        .eq("id", channelId);
      deactivated++;
      const canal = (existingChannels ?? []).find((c) => c.id === channelId);
      await registrarAuditoria({
        workspaceId: workspace.id,
        actor,
        accion: "canal.desconectado",
        entidad: { tipo: "canal", id: channelId, etiqueta: canal ? etiquetaDeCanal(canal) : null },
        detalle: { motivo: "cuenta_inexistente", origen: "sincronizacion" },
      });
    }

    // La alerta va con el cliente de servicio porque `record_webhook_alert` solo
    // la ejecuta `service_role` (00022). Si falla, el aviso en pantalla sale
    // igual: la alerta es el segundo canal del aviso, no el único.
    //
    // Al abrirla, el aviso por correo a Owner y Admin (F23) va en `after()`,
    // con el techo de un correo por tipo por hora.
    try {
      const servicio = await createServiceClient();
      if (plan.ceroCuentas) {
        const { data: alertaId, error: alertaErr } = await servicio.rpc("record_webhook_alert", {
          p_source: "zernio",
          p_condition: ALERTA_CERO_CUENTAS,
          p_workspace_id: workspace.id,
          p_detail: AVISO_CERO_CUENTAS,
        });
        if (alertaErr) console.error("[channels/sync] alert update failed:", alertaErr);
        else if (typeof alertaId === "string") {
          after(async () => {
            await auditarAlertaSiEsNueva(servicio as unknown as SupabaseClient, alertaId);
            await notificarAlerta(alertaId);
          });
        }
      } else if (plan.vigentes.size > 0) {
        const { error: alertaErr } = await servicio.rpc("resolve_webhook_alert", {
          p_source: "zernio",
          p_condition: ALERTA_CERO_CUENTAS,
          p_workspace_id: workspace.id,
        });
        if (alertaErr) console.error("[channels/sync] alert update failed:", alertaErr);
      }
    } catch (err) {
      console.error("[channels/sync] alert update failed:", err);
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
        events: [...WEBHOOK_EVENTS],
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
        channels: canalesConCuentaDeZernio(activeChannels ?? []),
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
        aviso: plan.ceroCuentas ? AVISO_CERO_CUENTAS : null,
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
