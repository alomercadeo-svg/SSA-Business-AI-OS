"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Lock, MessageSquare, RefreshCw, User } from "lucide-react";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/types/database";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: Database["public"]["Tables"]["contacts"]["Row"] | null;
};
type Message = Database["public"]["Tables"]["messages"]["Row"];

export function InboxView({
  conversations,
  workspaceId,
}: {
  conversations: Conversation[];
  workspaceId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hayAnteriores, setHayAnteriores] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Un lead que le sacaron a este usuario mientras lo tenía abierto. Antes esto
  // no existía: el 403 caía en el mismo setMessages([]) que una conversación sin
  // mensajes, así que el hilo se renderizaba vacío y sin explicación.
  const [scopeError, setScopeError] = useState<string | null>(null);

  // Imports conversations that already exist in Zernio (e.g. from before the
  // webhook was registered), then refreshes the server-rendered list.
  async function handleSyncConversations() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/v1/channels/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSyncError(data.error || "Sync failed");
        return;
      }
      router.refresh();
    } catch {
      setSyncError("Failed to sync. Check your connection.");
    } finally {
      setSyncing(false);
    }
  }

  // Keep selected conversation in sync when conversation list updates
  const handleSelect = useCallback((c: Conversation) => {
    setSelected(c);
  }, []);

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      setHayAnteriores(false);
      return;
    }

    async function loadMessages() {
      setLoadingMessages(true);
      setScopeError(null);
      let fueraDeScope = false;
      try {
        const res = await fetch(
          `/api/v1/messages?conversationId=${selected!.id}`
        );
        if (res.ok) {
          // La respuesta pasó de ser un array pelado a { messages, hayAnteriores }:
          // se pide la última página, así que en una conversación larga queda
          // historial afuera y el hilo tiene que avisarlo.
          const data = await res.json();
          setMessages(data?.messages ?? []);
          setHayAnteriores(data?.hayAnteriores === true);
        } else {
          const data = await res.json().catch(() => null);
          setMessages([]);
          setHayAnteriores(false);
          if (res.status === 403 || data?.code === "fuera_de_scope") {
            fueraDeScope = true;
            setScopeError(
              data?.error ?? "Esta conversación ya no está disponible para vos"
            );
          } else {
            console.error("Failed to load messages:", res.status);
          }
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
        setMessages([]);
        setHayAnteriores(false);
      } finally {
        setLoadingMessages(false);
      }

      // Marcar como leído. No se intenta si el lead salió del scope: el UPDATE
      // afectaría cero filas y no hay nada que marcar.
      if (selected!.unread_count > 0 && !fueraDeScope) {
        const supabase = createClient();
        await supabase
          .from("conversations")
          .update({ unread_count: 0 })
          .eq("id", selected!.id);
      }
    }

    loadMessages();
  }, [selected?.id]);

  return (
    <div className="flex h-full">
      {/* Left panel: Conversation list */}
      <div className="w-80 flex-shrink-0">
        <ConversationList
          conversations={conversations}
          workspaceId={workspaceId}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
        />
      </div>

      {/* Center panel: Message thread */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Toggle contact panel button */}
        {selected && !showContactPanel && (
          <div className="flex shrink-0 justify-end border-b border-border px-2 py-1">
            <button
              onClick={() => setShowContactPanel(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Show contact info"
            >
              <User className="h-3.5 w-3.5" />
              Contact info
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {conversations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                No conversations yet
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                If you already have conversations in Zernio, sync them to bring
                them into your inbox.
              </p>
              <button
                onClick={handleSyncConversations}
                disabled={syncing}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing ? "Syncing..." : "Sync conversations"}
              </button>
              {syncError && (
                <p className="mt-2 text-xs text-destructive">{syncError}</p>
              )}
            </div>
          ) : loadingMessages && selected ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          ) : scopeError ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <Lock className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                {scopeError}
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                Puede que te hayan reasignado el lead o que lo hayan archivado.
                Consultá con un responsable del equipo.
              </p>
              <button
                onClick={() => {
                  setSelected(null);
                  setScopeError(null);
                  router.refresh();
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
                Actualizar la bandeja
              </button>
            </div>
          ) : (
            <MessageThread
              conversation={selected}
              messages={messages}
              hayAnteriores={hayAnteriores}
            />
          )}
        </div>
      </div>

      {/* Right panel: Contact info */}
      {showContactPanel && selected?.contact_id && (
        <ContactPanel
          contactId={selected.contact_id}
          workspaceId={workspaceId}
          onClose={() => setShowContactPanel(false)}
        />
      )}
    </div>
  );
}
