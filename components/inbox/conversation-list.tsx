"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MessageSquare, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import type { Database, ConversationStatus } from "@/lib/types/database";
import { cursorDe, fusionarDeBandeja, type CantidadesDeBandeja, type ConversacionDeBandeja } from "@/lib/bandeja";

type Conversation = ConversacionDeBandeja;

/** La primera página, leída por el servidor (F35, tramo A de S8). */
export interface InicialDeLaLista {
  conversaciones: Conversation[];
  hayMas: boolean;
  cantidades: CantidadesDeBandeja | null;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationList({
  inicial,
  workspaceId,
  selectedId,
  onSelect,
}: {
  inicial: InicialDeLaLista;
  workspaceId: string;
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
}) {
  const [conversations, setConversations] = useState(inicial.conversaciones);
  const [hayMas, setHayMas] = useState(inicial.hayMas);
  const [cantidades, setCantidades] = useState(inicial.cantidades);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorAlCargar, setErrorAlCargar] = useState<string | null>(null);
  // Lo que ya está cargado, para que Realtime sepa si una conversación es nueva
  // en la lista sin depender del estado viejo de la suscripción.
  const cargadas = useRef(new Set(inicial.conversaciones.map((c) => c.id)));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("open");
  // Relative timestamps depend on the client's clock/locale, which differ from the
  // server's during SSR and trigger a hydration mismatch (React #418, which crashes
  // the inbox in production). Defer time rendering until after mount so the server
  // and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setConversations(inicial.conversaciones);
    setHayMas(inicial.hayMas);
    setCantidades(inicial.cantidades);
    cargadas.current = new Set(inicial.conversaciones.map((c) => c.id));
  }, [inicial]);

  useEffect(() => {
    cargadas.current = new Set(conversations.map((c) => c.id));
  }, [conversations]);

  // La página siguiente, desde la última cargada (F35). El cursor es la pareja
  // último mensaje e id, como el orden de la base: una conversación que sube
  // mientras tanto no hace saltear otra.
  async function cargarMas() {
    const ultima = conversations[conversations.length - 1];
    if (!ultima || cargandoMas) return;
    setCargandoMas(true);
    setErrorAlCargar(null);
    try {
      const cursor = cursorDe(ultima);
      const res = await fetch(`/api/v1/conversations?estado=all&antesOrden=${encodeURIComponent(cursor.orden)}&antesId=${cursor.id}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.conversaciones)) throw new Error(String(res.status));
      setConversations((prev) => fusionarDeBandeja(prev, data.conversaciones));
      setHayMas(data.hayMas === true);
    } catch {
      setErrorAlCargar("No se pudieron cargar más conversaciones. Probá de nuevo.");
    } finally {
      setCargandoMas(false);
    }
  }

  // Las cantidades, de nuevo desde el servidor, un segundo después del último
  // aviso: una conversación nueva suma al total.
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recontar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(async () => {
      const res = await fetch("/api/v1/conversations?soloCantidades=1").catch(() => null);
      const data = await res?.json().catch(() => null);
      if (data?.cantidades) setCantidades(data.cantidades);
    }, 1000);
  }, []);

  // Subscribe to conversation updates via Realtime
  useEffect(() => {
    const supabase = createClient();

    // Una conversación que no está cargada se pide sola, por la ruta de la
    // lista: la seguridad por filas decide si la puede ver.
    async function traerUna(id: string) {
      const res = await fetch(`/api/v1/conversations?estado=all&id=${id}`).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (Array.isArray(data?.conversaciones) && data.conversaciones.length > 0) {
        setConversations((prev) => fusionarDeBandeja(prev, data.conversaciones));
      }
    }

    const channel = supabase
      .channel("conversations-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        async (payload) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as Database["public"]["Tables"]["conversations"]["Row"];
            if (cargadas.current.has(updated.id)) {
              setConversations((prev) =>
                fusionarDeBandeja(prev, prev.filter((c) => c.id === updated.id).map((c) => ({ ...c, ...updated })))
              );
            } else {
              // Una que estaba más abajo de lo cargado y le llegó un mensaje.
              await traerUna(updated.id);
              recontar();
            }
          } else if (payload.eventType === "INSERT") {
            const inserted = payload.new as Database["public"]["Tables"]["conversations"]["Row"];
            await traerUna(inserted.id);
            recontar();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [workspaceId, recontar]);

  const filtered = conversations.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search) {
      const name = c.contacts?.display_name?.toLowerCase() ?? "";
      const preview = c.last_message_preview?.toLowerCase() ?? "";
      const q = search.toLowerCase();
      if (!name.includes(q) && !preview.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Inbox</h2>
        <span className="text-xs text-muted-foreground">
          {cantidades ? `${conversations.length} de ${cantidades.todas}` : `${conversations.length}`}
        </span>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 px-3 pb-2">
        {(["all", "open", "closed", "snoozed"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
              statusFilter === status
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">No conversations found</p>
          </div>
        ) : (
          filtered.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => onSelect(conversation)}
              className={cn(
                "flex w-full items-start gap-3 border-b border-border p-3 text-left transition-colors hover:bg-accent/50",
                selectedId === conversation.id && "bg-accent"
              )}
            >
              {/* Avatar with platform badge */}
              <div className="relative flex-shrink-0">
                {conversation.contacts?.avatar_url ? (
                  <img
                    src={conversation.contacts.avatar_url}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {conversation.contacts?.display_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-background bg-background">
                  <PlatformIcon
                    platform={conversation.platform}
                    className="h-3 w-3"
                    size={12}
                  />
                </div>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="truncate text-sm font-medium">
                    {conversation.contacts?.display_name ?? "Unknown"}
                  </p>
                  <span
                    suppressHydrationWarning
                    className="flex-shrink-0 text-[11px] text-muted-foreground"
                  >
                    {mounted ? formatTime(conversation.last_message_at) : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {conversation.last_message_preview ?? "No messages yet"}
                  </p>
                  {conversation.unread_count > 0 && (
                    <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {conversation.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
        {hayMas && (
          <div className="flex flex-col items-center gap-1 p-3">
            <button
              onClick={cargarMas}
              disabled={cargandoMas}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {cargandoMas && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Cargar más conversaciones
            </button>
            {errorAlCargar && <p className="text-xs text-destructive">{errorAlCargar}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
