"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, MessageSquare, RefreshCw, User } from "lucide-react";
import { ConversationList, type InicialDeLaLista } from "@/components/inbox/conversation-list";
import type { EstadoDeBandeja } from "@/lib/bandeja";
import { SIN_FILTROS, SIN_OPCIONES, hayFiltros, type FiltrosDeBandeja, type OpcionesDeFiltros } from "@/lib/filtros-bandeja";
import { MessageThread } from "@/components/inbox/message-thread";
import { useAhora } from "@/components/inbox/use-ahora";
import type { EstadoDelHistorial } from "@/lib/historial-aviso";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { conConversacion, crearVigiaDeLaDireccion } from "@/lib/direccion-bandeja";
import { volverDe } from "@/lib/ficha";
import { clasesDeLaLista, clasesDelHilo, clasesDelPanel } from "@/lib/columnas-bandeja";
import { conectarHiloEnTelefono, esAnchoDeTelefono } from "@/lib/historial-bandeja";
import type { RespuestaRapida } from "@/lib/respuestas-rapidas";
import type { Database } from "@/lib/types/database";

type Conversation = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: Database["public"]["Tables"]["contacts"]["Row"] | null;
};
type Message = Database["public"]["Tables"]["messages"]["Row"];

export function InboxView({
  inicial,
  estado = "open",
  busqueda = "",
  filtros = SIN_FILTROS,
  opcionesDeFiltros = SIN_OPCIONES,
  workspaceId,
  zonaDelNegocio = "America/Costa_Rica",
  conversacionInicial = null,
  respuestas = [],
  nombreDelEspacio = null,
}: {
  /** La primera página de la lista, leída por el servidor (F35). */
  inicial: InicialDeLaLista;
  /** La pestaña que vino en la dirección (`?estado=`). */
  estado?: EstadoDeBandeja;
  /** Lo buscado que vino en la dirección (`?q=`). */
  busqueda?: string;
  /** Los filtros que vinieron en la dirección (tramo B). */
  filtros?: FiltrosDeBandeja;
  /** Lo que ofrece el panel de filtros. */
  opcionesDeFiltros?: OpcionesDeFiltros;
  workspaceId: string;
  /** `workspaces.zona_horaria` (tramo C de S8): el «hoy» del selector de seguimiento. */
  zonaDelNegocio?: string;
  /**
   * F30: la conversación que pidió la ficha (`?conversacion=`), ya leída por
   * el servidor con la seguridad por filas. Abre su hilo aunque no esté entre
   * las que carga la lista; la lista y su orden no cambian.
   */
  conversacionInicial?: Conversation | null;
  /** F36: las Respuestas rápidas del espacio, para «/». */
  respuestas?: RespuestaRapida[];
  /** F36: el nombre del espacio, para `{{workspace.name}}`. */
  nombreDelEspacio?: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Conversation | null>(conversacionInicial);
  // F40: un solo reloj para la ventana de Instagram de la lista y del hilo.
  const ahora = useAhora();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hayAnteriores, setHayAnteriores] = useState(false);
  const [historial, setHistorial] = useState<EstadoDelHistorial | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState(true);
  // F35, teléfono: el panel del contacto, cerrado por defecto y encima del hilo.
  const [panelEnTelefono, setPanelEnTelefono] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Un lead que le sacaron a este usuario mientras lo tenía abierto. Antes esto
  // no existía: el 403 caía en el mismo setMessages([]) que una conversación sin
  // mensajes, así que el hilo se renderizaba vacío y sin explicación.
  const [scopeError, setScopeError] = useState<string | null>(null);
  // Sube cada vez que el panel guarda el próximo seguimiento: la lista se
  // vuelve a pedir con la pestaña, la búsqueda y los filtros de ahora, así la
  // conversación entra o sale del filtro sin recargar (F35, tramo C de S8).
  const [listaDesactualizada, setListaDesactualizada] = useState(0);
  // Sube cuando el pedido del seguimiento al cerrar (tramo D) guarda una
  // fecha: el panel se vuelve a montar y lee la nueva.
  const [versionDelPanel, setVersionDelPanel] = useState(0);

  // Imports conversations that already exist in Zernio (e.g. from before the
  // webhook was registered), then refreshes the server-rendered list.
  async function handleSyncConversations() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/v1/channels/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSyncError(data.error || "No se pudo sincronizar");
        return;
      }
      // Cero cuentas en Zernio: no se desactivó nada, pero tampoco se importó.
      if (data.synced?.aviso) setSyncError(data.synced.aviso);
      router.refresh();
    } catch {
      setSyncError("No se pudo sincronizar. Revisá la conexión.");
    } finally {
      setSyncing(false);
    }
  }

  // F35, teléfono (revisión del 06/11/2026): en el ancho del teléfono, abrir
  // una conversación suma una entrada al historial, y volver lleva a la lista
  // (`lib/historial-bandeja.ts`). En la computadora no se suman entradas.
  const hiloEnTelefono = useRef<ReturnType<typeof conectarHiloEnTelefono> | null>(null);
  useEffect(() => {
    const h = conectarHiloEnTelefono(window, () => {
      setSelected(null);
      setPanelEnTelefono(false);
      // Si el hilo no sumó entrada (vino de la ficha), la dirección todavía
      // nombra la conversación: se saca sin sumar otra entrada.
      if (new URLSearchParams(window.location.search).has("conversacion")) {
        window.history.replaceState(null, "", conConversacion(window.location.href, null));
      }
    });
    hiloEnTelefono.current = h;
    return () => h.desconectar();
  }, []);

  // La conversación abierta va en la dirección (`?conversacion=`, el mismo
  // parámetro de F30), así volver desde la ficha la vuelve a abrir (tramo C).
  const handleSelect = useCallback((c: Conversation) => {
    setSelected(c);
    setPanelEnTelefono(false);
    const url = conConversacion(window.location.href, c.id);
    if (esAnchoDeTelefono() && hiloEnTelefono.current) hiloEnTelefono.current.abrir(url);
    else window.history.replaceState(null, "", url);
  }, []);

  // Volver con el atrás del navegador: Next dibuja la página que guardó la
  // primera vez, aunque la dirección diga otra cosa (visto por Marcos el
  // 04/11/2026). Si no coinciden, se le pide la página al servidor otra vez,
  // como mucho una vez por montaje (lib/direccion-bandeja.ts).
  const [vigia] = useState(() => crearVigiaDeLaDireccion(() => router.refresh()));
  useEffect(() => {
    vigia.alMontar(new URLSearchParams(window.location.search), {
      estado,
      busqueda,
      filtros,
      conversacion: conversacionInicial?.id ?? null,
    });
  }, [vigia, estado, busqueda, filtros, conversacionInicial]);
  // Si la página nueva trae otra conversación (la de la dirección), se abre.
  useEffect(() => {
    if (conversacionInicial) setSelected((prev) => (prev?.id === conversacionInicial.id ? prev : conversacionInicial));
  }, [conversacionInicial]);

  // La dirección de la bandeja como está ahora, para que la ficha vuelva a ella.
  // `useSearchParams` sigue a cada `replaceState` de la lista (app-router.js:253-255).
  const pathname = usePathname();
  const parametros = useSearchParams();
  const consulta = parametros?.toString() ?? "";
  const volver = volverDe(`${pathname ?? ""}${consulta ? `?${consulta}` : ""}`);

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      setHayAnteriores(false);
      setHistorial(null);
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
          setHistorial(data?.historial ?? null);
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
      {/* Left panel: Conversation list. En el teléfono, sola (F35). */}
      <div className={clasesDeLaLista(selected !== null)}>
        <ConversationList
          inicial={inicial}
          estado={estado}
          busqueda={busqueda}
          filtros={filtros}
          opcionesDeFiltros={opcionesDeFiltros}
          workspaceId={workspaceId}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          volverAPedir={listaDesactualizada}
          ahora={ahora}
        />
      </div>

      {/* Center panel: Message thread */}
      {/* min-w-0: un nombre largo no ensancha la columna (S8, tramo 9). En el teléfono, solo con una abierta (F35). */}
      <div className={clasesDelHilo(selected !== null)}>
        {/* Teléfono: volver a la lista y abrir los datos del contacto (F35). */}
        {selected && (
          <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1 md:hidden">
            <button
              type="button"
              onClick={() => hiloEnTelefono.current?.volver()}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Conversaciones
            </button>
            {selected.contact_id && (
              <button
                type="button"
                onClick={() => setPanelEnTelefono(true)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <User className="h-3.5 w-3.5" />
                Datos del contacto
              </button>
            )}
          </div>
        )}
        {/* Toggle contact panel button (computadora) */}
        {selected && !showContactPanel && (
          <div className="hidden shrink-0 justify-end border-b border-border px-2 py-1 md:flex">
            <button
              onClick={() => setShowContactPanel(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Mostrar los datos del contacto"
            >
              <User className="h-3.5 w-3.5" />
              Datos del contacto
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {/* Sin ninguna conversación en el espacio, no solo en la pestaña elegida.
              Con búsqueda o filtros, «Todas» en 0 no dice eso (tramo B). */}
          {(inicial.cantidades?.todas ?? inicial.conversaciones.length) === 0 && !busqueda && !hayFiltros(filtros) ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                Todavía no hay conversaciones
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                Si ya tenés conversaciones en Instagram, sincronizalas para
                traerlas a la bandeja.
              </p>
              <button
                onClick={handleSyncConversations}
                disabled={syncing}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing ? "Sincronizando..." : "Sincronizar conversaciones"}
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
                  setScopeError(null);
                  // Lleva a la lista; en el teléfono, sin dejar la entrada del hilo colgada.
                  if (hiloEnTelefono.current) hiloEnTelefono.current.volver();
                  else {
                    setSelected(null);
                    window.history.replaceState(null, "", conConversacion(window.location.href, null));
                  }
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
              historial={historial}
              volverALaBandeja={volver}
              zona={zonaDelNegocio}
              ahora={ahora}
              respuestas={respuestas}
              nombreDelEspacio={nombreDelEspacio}
              panelAbierto={panelEnTelefono}
              alGuardarSeguimiento={() => {
                setVersionDelPanel((n) => n + 1);
                setListaDesactualizada((n) => n + 1);
              }}
            />
          )}
        </div>
      </div>

      {/* Right panel: Contact info. En el teléfono, encima del hilo y a pantalla completa (F35). */}
      {selected?.contact_id && (showContactPanel || panelEnTelefono) && (
        <div className={clasesDelPanel({ enCompu: showContactPanel, enTelefono: panelEnTelefono })}>
          <div className="flex shrink-0 items-center border-b border-border px-2 py-1 md:hidden">
            <button
              type="button"
              onClick={() => setPanelEnTelefono(false)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver al chat
            </button>
          </div>
          <div className="min-h-0 flex-1 md:flex-none">
            <ContactPanel
              key={`${selected.contact_id}-${versionDelPanel}`}
              contactId={selected.contact_id}
              workspaceId={workspaceId}
              zona={zonaDelNegocio}
              volver={volver}
              onClose={() => {
                if (esAnchoDeTelefono()) setPanelEnTelefono(false);
                else setShowContactPanel(false);
              }}
              alGuardarSeguimiento={() => setListaDesactualizada((n) => n + 1)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
