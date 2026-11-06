"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MessageSquare, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import type { Database } from "@/lib/types/database";
import {
  cursorDe,
  fusionarDeBandeja,
  type CantidadesDeBandeja,
  type ConversacionDeBandeja,
  type EstadoDeBandeja,
} from "@/lib/bandeja";
import { horaDeLaLista } from "@/lib/fechas-bandeja";
import {
  SIN_FILTROS,
  SIN_OPCIONES,
  hayFiltros,
  parametrosDeFiltros,
  pedidoDeUna,
  queHacerConElAviso,
  type FiltrosDeBandeja,
  type OpcionesDeFiltros,
} from "@/lib/filtros-bandeja";
import { FiltrosBandeja } from "./filtros-bandeja";
import { MarcaDeVentana } from "./marca-ventana";
import { crearUnPedidoALaVez } from "@/lib/un-pedido-a-la-vez";
import { direccionDeLaBandeja } from "@/lib/direccion-bandeja";
import { inicialDe, nombreDeConversacion } from "@/lib/nombre-visible";

type Conversation = ConversacionDeBandeja;

/** La primera página, leída por el servidor (F35, tramo A de S8). */
export interface InicialDeLaLista {
  conversaciones: Conversation[];
  hayMas: boolean;
  cantidades: CantidadesDeBandeja | null;
}

/**
 * Las pestañas (F35). No hay «Pospuestas»: para volver a un lead en una fecha
 * se usa el próximo seguimiento, y `snoozed` queda en la base sin uso.
 */
const PESTANAS: ReadonlyArray<{ estado: EstadoDeBandeja; texto: string; cantidad: keyof CantidadesDeBandeja }> = [
  { estado: "open", texto: "Abiertas", cantidad: "abiertas" },
  { estado: "closed", texto: "Cerradas", cantidad: "cerradas" },
  { estado: "all", texto: "Todas", cantidad: "todas" },
];

const cantidadDe = (cantidades: CantidadesDeBandeja | null, estado: EstadoDeBandeja) =>
  cantidades ? cantidades[PESTANAS.find((p) => p.estado === estado)!.cantidad] : null;

/** La dirección de la bandeja con la pestaña, lo buscado y los filtros: se puede recargar o compartir. */
const direccionCon = (estado: EstadoDeBandeja, busqueda: string, filtros: FiltrosDeBandeja) =>
  direccionDeLaBandeja(window.location.href, estado, busqueda, filtros);

/** Un pedido de la primera página de la lista: pestaña, búsqueda y filtros. */
type PedidoDeLista = { estado: EstadoDeBandeja; q: string; filtros: FiltrosDeBandeja };
type RespuestaDeLista = { conversaciones: Conversation[]; hayMas?: boolean; cantidades?: CantidadesDeBandeja | null };
const mismoPedido = (a: PedidoDeLista, b: PedidoDeLista) =>
  a.estado === b.estado && a.q === b.q && JSON.stringify(parametrosDeFiltros(a.filtros)) === JSON.stringify(parametrosDeFiltros(b.filtros));

/** Los filtros como parámetros para la ruta de la lista (tramo B). */
const conFiltros = (filtros: FiltrosDeBandeja) => {
  const p = new URLSearchParams(parametrosDeFiltros(filtros)).toString();
  return p ? `&${p}` : "";
};

export function ConversationList({
  inicial,
  estado: estadoInicial = "open",
  busqueda = "",
  filtros: filtrosIniciales = SIN_FILTROS,
  opcionesDeFiltros = SIN_OPCIONES,
  workspaceId,
  selectedId,
  onSelect,
  volverAPedir = 0,
  ahora,
}: {
  inicial: InicialDeLaLista;
  /** La pestaña que vino en la dirección (`?estado=`), ya aplicada por el servidor. */
  estado?: EstadoDeBandeja;
  /** Lo buscado que vino en la dirección (`?q=`), ya aplicado por el servidor. */
  busqueda?: string;
  /** Los filtros que vinieron en la dirección, ya aplicados por el servidor (tramo B). */
  filtros?: FiltrosDeBandeja;
  /** Lo que ofrece el panel de filtros, leído por el servidor. */
  opcionesDeFiltros?: OpcionesDeFiltros;
  workspaceId: string;
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
  /**
   * Sube cuando algo cambió afuera de la lista (el próximo seguimiento, desde
   * el panel): la primera página se vuelve a pedir con lo elegido ahora, aunque
   * sea lo mismo que ya se ve (F35, tramo C de S8).
   */
  volverAPedir?: number;
  /** F40: la hora del reloj de la bandeja (`useAhora`), para la ventana de Instagram. */
  ahora?: number;
}) {
  const ahoraMs = ahora ?? Date.now();
  const [conversations, setConversations] = useState(inicial.conversaciones);
  const [hayMas, setHayMas] = useState(inicial.hayMas);
  const [cantidades, setCantidades] = useState(inicial.cantidades);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorAlCargar, setErrorAlCargar] = useState<string | null>(null);
  // Lo que ya está cargado, para que Realtime sepa si una conversación es nueva
  // en la lista sin depender del estado viejo de la suscripción.
  const cargadas = useRef(new Set(inicial.conversaciones.map((c) => c.id)));
  // `search` es lo escrito; `buscada`, lo que ya respondió el servidor.
  const [search, setSearch] = useState(busqueda);
  const buscada = useRef(busqueda);
  const [buscando, setBuscando] = useState(false);
  const [estado, setEstado] = useState<EstadoDeBandeja>(estadoInicial);
  const estadoVigente = useRef(estadoInicial);
  // `filtros` es lo elegido; `filtrosVigentes`, lo que ya respondió el servidor.
  const [filtros, setFiltros] = useState<FiltrosDeBandeja>(filtrosIniciales);
  const filtrosVigentes = useRef(filtrosIniciales);
  // Lo elegido en pantalla, aunque el servidor todavía no haya respondido:
  // un pedido guardado tiene que salir con la pestaña y los filtros de ahora.
  const estadoElegido = useRef(estadoInicial);
  const filtrosElegidos = useRef(filtrosIniciales);
  // Relative timestamps depend on the client's clock/locale, which differ from the
  // server's during SSR and trigger a hydration mismatch (React #418, which crashes
  // the inbox in production). Defer time rendering until after mount so the server
  // and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // La primera página de una pestaña, una búsqueda y unos filtros, desde el
  // servidor, de a un pedido por vez. `useState` con inicializador: se crea una
  // sola vez; adentro solo usa `setState` y refs, que no cambian.
  const [pedidos] = useState(() =>
    crearUnPedidoALaVez<PedidoDeLista, RespuestaDeLista>({
      esperaMs: 300,
      inicial: { estado: estadoInicial, q: busqueda, filtros: filtrosIniciales },
      igual: mismoPedido,
      ejecutar: async (p) => {
        const res = await fetch(`/api/v1/conversations?estado=${p.estado}&q=${encodeURIComponent(p.q)}${conFiltros(p.filtros)}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data?.conversaciones)) throw new Error(String(res.status));
        return data as RespuestaDeLista;
      },
      aplicar: (p, data) => {
        buscada.current = p.q;
        estadoVigente.current = p.estado;
        filtrosVigentes.current = p.filtros;
        setErrorAlCargar(null);
        setConversations(data.conversaciones);
        setHayMas(data.hayMas === true);
        setCantidades(data.cantidades ?? null);
        window.history.replaceState(null, "", direccionCon(p.estado, p.q, p.filtros));
      },
      alFallar: () => setErrorAlCargar("No se pudo cargar la bandeja. Probá de nuevo."),
      alCambiarOcupado: setBuscando,
    }),
  );

  useEffect(() => {
    setConversations(inicial.conversaciones);
    setHayMas(inicial.hayMas);
    setCantidades(inicial.cantidades);
    cargadas.current = new Set(inicial.conversaciones.map((c) => c.id));
    buscada.current = busqueda;
    estadoVigente.current = estadoInicial;
    setEstado(estadoInicial);
    filtrosVigentes.current = filtrosIniciales;
    setFiltros(filtrosIniciales);
    estadoElegido.current = estadoInicial;
    filtrosElegidos.current = filtrosIniciales;
    pedidos.seVe({ estado: estadoInicial, q: busqueda, filtros: filtrosIniciales });
  }, [inicial, busqueda, estadoInicial, filtrosIniciales, pedidos]);

  // La lista como está ahora, para los avisos de Realtime: un actualizador de
  // `setConversations` corre más tarde, y lo que se decida adentro no se ve afuera.
  const listaActual = useRef(conversations);
  useEffect(() => {
    cargadas.current = new Set(conversations.map((c) => c.id));
    listaActual.current = conversations;
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
      const res = await fetch(`/api/v1/conversations?estado=${estadoVigente.current}&q=${encodeURIComponent(buscada.current)}${conFiltros(filtrosVigentes.current)}&antesOrden=${encodeURIComponent(cursor.orden)}&antesId=${cursor.id}`);
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
      const res = await fetch(`/api/v1/conversations?soloCantidades=1&q=${encodeURIComponent(buscada.current)}${conFiltros(filtrosVigentes.current)}`).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (data?.cantidades) setCantidades(data.cantidades);
    }, 1000);
  }, []);

  // La búsqueda corre en el servidor, sobre todas las conversaciones que quien
  // mira puede ver (F35), 300 ms después de la última tecla. Un solo pedido en
  // curso a la vez (retrabajo del 04/11/2026, lib/un-pedido-a-la-vez.ts):
  // mientras uno está en curso no sale otro, y cuando vuelve, si lo pedido
  // cambió, su respuesta se ignora y sale uno solo con lo último.
  useEffect(() => {
    pedidos.escribir({ estado: estadoElegido.current, q: search.trim(), filtros: filtrosElegidos.current });
  }, [search, pedidos]);

  useEffect(() => () => pedidos.cancelar(), [pedidos]);

  // Lo escrito ahora, para volver a pedir sin depender de cada tecla.
  const buscadoAhora = useRef(search);
  useEffect(() => {
    buscadoAhora.current = search;
  }, [search]);
  useEffect(() => {
    if (!volverAPedir) return;
    pedidos.volverAPedir({ estado: estadoElegido.current, q: buscadoAhora.current.trim(), filtros: filtrosElegidos.current });
  }, [volverAPedir, pedidos]);

  function elegirPestana(nuevo: EstadoDeBandeja) {
    if (nuevo === estado) return;
    setEstado(nuevo);
    estadoElegido.current = nuevo;
    pedidos.pedirYa({ estado: nuevo, q: search.trim(), filtros: filtrosElegidos.current });
  }

  function cambiarFiltros(nuevos: FiltrosDeBandeja) {
    setFiltros(nuevos);
    filtrosElegidos.current = nuevos;
    pedidos.pedirYa({ estado: estadoElegido.current, q: search.trim(), filtros: nuevos });
  }

  // Subscribe to conversation updates via Realtime
  useEffect(() => {
    const supabase = createClient();

    // Una conversación se pide sola, por la ruta de la lista, con la pestaña,
    // la búsqueda y los filtros: la seguridad por filas decide si la puede ver,
    // y la base, si cumple los filtros. Si no vuelve y estaba cargada, sale.
    async function traerUna(id: string) {
      const res = await fetch(pedidoDeUna(estadoVigente.current, buscada.current, filtrosVigentes.current, id)).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => null);
      if (!Array.isArray(data?.conversaciones)) return;
      if (data.conversaciones.length > 0) setConversations((prev) => fusionarDeBandeja(prev, data.conversaciones));
      else if (cargadas.current.has(id)) setConversations((prev) => prev.filter((c) => c.id !== id));
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
            const cargada = cargadas.current.has(updated.id);
            const anterior = listaActual.current.find((c) => c.id === updated.id);
            const decision = queHacerConElAviso({
              cargada,
              // Si ya no es de esta pestaña (la cerraron o la reabrieron), sale.
              esDeOtraPestana: estadoVigente.current !== "all" && updated.status !== estadoVigente.current,
              filtros: filtrosVigentes.current,
            });
            if (decision === "sacar") {
              setConversations((prev) => prev.filter((c) => c.id !== updated.id));
            } else if (decision === "fusionar") {
              setConversations((prev) => fusionarDeBandeja(prev, prev.filter((c) => c.id === updated.id).map((c) => ({ ...c, ...updated }))));
            } else {
              // No estaba cargada (estaba más abajo y le llegó un mensaje), o
              // hay filtros y puede haber dejado de cumplirlos.
              await traerUna(updated.id);
            }
            if (!cargada || decision === "pedir" || (anterior && anterior.status !== updated.status)) recontar();
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

  // La búsqueda ya la aplicó el servidor: acá no se vuelve a filtrar por
  // texto, porque el servidor también busca por usuario, correo y teléfono.
  const filtered = conversations;
  const total = cantidadDe(cantidades, estado);

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Bandeja</h2>
        <span className="text-xs text-muted-foreground">
          {total !== null ? `${conversations.length} de ${total}` : `${conversations.length}`}
        </span>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          {buscando ? (
            <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          )}
          <input
            type="text"
            placeholder="Buscar por nombre, usuario, correo, teléfono o mensaje"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Pestañas (F35): la cantidad de cada una la calcula el servidor */}
      <div className="flex gap-1 px-3 pb-2" role="tablist">
        {PESTANAS.map((p) => (
          <button
            key={p.estado}
            role="tab"
            aria-selected={estado === p.estado}
            onClick={() => elegirPestana(p.estado)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              estado === p.estado
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {p.texto}
            <span className="tabular-nums opacity-80">{cantidades ? cantidades[p.cantidad] : "–"}</span>
          </button>
        ))}
      </div>

      {/* Filtros (F35, tramo B): el botón «Filtros» y su panel */}
      <FiltrosBandeja filtros={filtros} opciones={opcionesDeFiltros} onCambiar={cambiarFiltros} />

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && hayFiltros(filtrosVigentes.current) ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium text-muted-foreground">Ninguna conversación con estos filtros</p>
            <p className="mt-1 text-xs text-muted-foreground/80">Probá con otros filtros o limpialos para ver todas.</p>
            <button
              type="button"
              onClick={() => cambiarFiltros(SIN_FILTROS)}
              className="mt-3 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Limpiar filtros
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {buscada.current ? `Ninguna conversación coincide con «${buscada.current}»` : "No hay conversaciones"}
            </p>
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
                    {inicialDe(nombreDeConversacion(conversation))}
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
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{nombreDeConversacion(conversation)}</span>
                    {/* F34: pidió no recibir más mensajes. */}
                    {conversation.contacts?.do_not_contact && (
                      <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">No contactar</span>
                    )}
                  </p>
                  <span
                    suppressHydrationWarning
                    className="flex-shrink-0 text-[11px] text-muted-foreground"
                  >
                    {mounted ? horaDeLaLista(conversation.last_message_at) : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {conversation.last_message_preview ?? "Sin mensajes"}
                  </p>
                  {conversation.unread_count > 0 && (
                    <span className="ml-2 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {conversation.unread_count}
                    </span>
                  )}
                </div>
                {/* F40: solo lo que pide atención (el criterio reescrito y D12). */}
                <MarcaDeVentana conversacion={conversation} ahora={ahoraMs} lugar="lista" />
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
