"use client";

import { avisoDelHistorial, type EstadoDelHistorial } from "@/lib/historial-aviso";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { refrescarHilo, sumarAnteriores } from "@/lib/hilo";
import { cambiaDeDia, horaDelMensaje, separadorDeDia } from "@/lib/fechas-bandeja";
import Link from "next/link";
import { enlaceAFicha } from "@/lib/ficha";
import { Send, Paperclip, Bot, User, MessageSquare, Loader2, History } from "lucide-react";
import { VistaDelEstado } from "@/components/inbox/estado-conversacion";
import { BloqueDePedido } from "@/components/inbox/selector-seguimiento";
import {
  AVISO_DE_FALLA_DE_ESTADO,
  avisoDeCambio,
  cambiarEstadoDeConversacion,
  type EstadoDeConversacion,
} from "@/lib/estado-conversacion";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import type { Database } from "@/lib/types/database";
import { MarcaDeVentana } from "@/components/inbox/marca-ventana";
import { inicialDe, nombreDeConversacion } from "@/lib/nombre-visible";
import { BloqueVentanaCerrada } from "@/components/inbox/ventana-cerrada";
import { AVISO_NO_CONTACTAR } from "@/lib/no-contactar-texto";
import { FotoDelHilo } from "@/components/inbox/visor-foto";
import { SelectorDeRespuestas } from "@/components/inbox/selector-respuestas";
import { estaAlFinal, lugarDelHilo, scrollParaVolver, type LugarDelHilo } from "@/lib/pantalla-telefono";
import { aplicarRespuesta, barraEn, filtrarRespuestas, interpolar, moverEleccion, type Barra, type RespuestaRapida } from "@/lib/respuestas-rapidas";
import { AVISO_VENTANA_CERRADA, estadoDeVentana, textoDeVence } from "@/lib/ventana-instagram";

/**
 * La fila que devuelve `GET /api/v1/messages`. F28: `archivo` trae la
 * dirección firmada del adjunto bajado (nulo si no hay); `media_path` no viaja.
 */
type Message = Database["public"]["Tables"]["messages"]["Row"] & {
  archivo?: { url: string; mime: string | null } | null;
};
type Conversation = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: Database["public"]["Tables"]["contacts"]["Row"] | null;
};


/**
 * Un mensaje sin texto ni adjunto. Lo medido es que Zernio devuelve
 * `message: ""` para buena parte del historial viejo de Instagram (nota de
 * F27); de quién es la falta no se sabe, y el texto no lo afirma. La
 * importación del 08/10/2026 trajo 825 así. Sin esto se dibujaba una burbuja
 * vacía.
 */
export const TEXTO_SIN_CONTENIDO = "El contenido de este mensaje no está disponible.";

export const TEXTO_ADJUNTO_FALLIDO = "Todavía no pudimos traer este archivo. Se vuelve a intentar solo.";
export const TEXTO_ADJUNTO_NO_DISPONIBLE = "Este archivo no está disponible.";

/**
 * El archivo bajado (F28). El reproductor se elige por `message_type` y no por
 * `media_mime`: la nota de voz de Instagram se detecta como `video/mp4`, porque
 * su cabecera no la distingue de un video (prueba real del 09/10/2026).
 */
/**
 * F44, criterios 1 y 2: lo que el lead compartió, como lo manda
 * `GET /api/v1/messages` (`compartido` y `enlace` en el primer adjunto). Va
 * antes que el estado de la descarga: un reel no es un archivo que faltó.
 */
const TEXTO_COMPARTIDO = { publicacion: "Compartió una publicación", reel: "Compartió un reel" } as const;

function compartidoDe(
  message: Message,
): { compartido: keyof typeof TEXTO_COMPARTIDO; enlace: string | null; titulo: string | null } | null {
  const a = Array.isArray(message.attachments)
    ? (message.attachments[0] as { compartido?: unknown; enlace?: unknown; titulo?: unknown } | null)
    : null;
  if (!a || (a.compartido !== "publicacion" && a.compartido !== "reel")) return null;
  return {
    compartido: a.compartido,
    // Solo el reel tiene botón: el enlace de una publicación no la abre
    // (F44, criterio 1, reescrito el 06/11/2026).
    enlace: a.compartido === "reel" && typeof a.enlace === "string" ? a.enlace : null,
    titulo: a.compartido === "publicacion" && typeof a.titulo === "string" ? a.titulo : null,
  };
}

function ArchivoDelMensaje({ message }: { message: Message }) {
  const compartido = compartidoDe(message);
  if (compartido) {
    return (
      <div className="mt-1">
        <p className="text-xs opacity-70">{TEXTO_COMPARTIDO[compartido.compartido]}</p>
        {compartido.titulo && <p className="line-clamp-3 break-words text-sm italic">«{compartido.titulo}»</p>}
        {compartido.enlace && (
          <a href={compartido.enlace} target="_blank" rel="noopener noreferrer" className="text-xs underline">
            Ver en Instagram
          </a>
        )}
      </div>
    );
  }
  const archivo = message.archivo;
  if (archivo) {
    const tipo = message.message_type;
    if (tipo === "audio") return <audio controls preload="metadata" src={archivo.url} className="mt-1 max-w-full" />;
    if (tipo === "video") return <video controls preload="metadata" src={archivo.url} className="mt-1 max-h-80 max-w-full rounded-lg" />;
    if (tipo === "imagen" || tipo === "sticker" || archivo.mime?.startsWith("image/")) {
      // F44, criterio 4: tocarla la abre a pantalla completa.
      return <FotoDelHilo url={archivo.url} />;
    }
    return (
      <a href={archivo.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline">
        <Paperclip className="inline h-3 w-3" />
        Abrir el archivo
      </a>
    );
  }
  if (message.media_status === "fallido" || message.media_status === "no_disponible") {
    return (
      <p className="mt-1 text-xs italic opacity-70">
        <Paperclip className="mr-1 inline h-3 w-3" />
        {message.media_status === "fallido" ? TEXTO_ADJUNTO_FALLIDO : TEXTO_ADJUNTO_NO_DISPONIBLE}
      </p>
    );
  }
  return (
    <div className="mt-1">
      <Paperclip className="inline h-3 w-3" />
      <span className="ml-1 text-xs opacity-70">Adjunto</span>
    </div>
  );
}

export function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === "inbound";
  const isBot = message.sent_by_flow_id !== null;

  return (
    <div
      className={cn(
        "flex gap-2",
        isInbound ? "justify-start" : "justify-end"
      )}
    >
      {isInbound && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}

      <div className="max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2 text-sm",
            isInbound
              ? "rounded-tl-md bg-muted text-foreground"
              : "rounded-tr-md bg-primary text-primary-foreground"
          )}
        >
          {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
          {!message.text && !message.attachments && (
            <p className="italic opacity-70">{TEXTO_SIN_CONTENIDO}</p>
          )}
          {message.attachments && <ArchivoDelMensaje message={message} />}
        </div>
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground",
            isInbound ? "justify-start" : "justify-end"
          )}
        >
          {isBot && (
            <Bot className="h-3 w-3" />
          )}
          <span>{horaDelMensaje(message.created_at)}</span>
          {!isInbound && message.status !== "sent" && (
            <span>
              {message.status === "delivered"
                ? "Entregado"
                : message.status === "failed"
                ? "No se envió"
                : ""}
            </span>
          )}
        </div>
      </div>

      {!isInbound && !isBot && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      {!isInbound && isBot && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
    </div>
  );
}


export function MessageThread({
  conversation,
  messages: initialMessages,
  hayAnteriores = false,
  historial = null,
  volverALaBandeja = null,
  zona = "America/Costa_Rica",
  alGuardarSeguimiento,
  ahora,
  respuestas = [],
  nombreDelEspacio = null,
  panelAbierto = false,
}: {
  conversation: Conversation | null;
  messages: Message[];
  /**
   * true cuando la conversación tiene mensajes más viejos que los que se
   * trajeron. El hilo pide la última página, así que en una conversación larga
   * el corte existe y NO puede quedar callado: pasar de "faltan los nuevos sin
   * avisar" a "faltan los viejos sin avisar" no sería una mejora.
   */
  hayAnteriores?: boolean;
  historial?: EstadoDelHistorial | null;
  /** La dirección de la bandeja, para que la ficha vuelva a ella como estaba (tramo C de S8). */
  volverALaBandeja?: string | null;
  /** `workspaces.zona_horaria`, para el selector del pedido al cerrar (tramo D). */
  zona?: string;
  /** Al guardar el seguimiento desde el pedido al cerrar: el panel y la lista se vuelven a pedir. */
  alGuardarSeguimiento?: () => void;
  /** F40: la hora del reloj de la bandeja (`useAhora`), para la ventana de Instagram. */
  ahora?: number;
  /** F36: las Respuestas rápidas del espacio, para «/» (las lee la seguridad por filas: sin las eliminadas). */
  respuestas?: RespuestaRapida[];
  /** F36: el nombre del espacio, para `{{workspace.name}}`. */
  nombreDelEspacio?: string | null;
  /** En el teléfono, el panel del contacto tapa el hilo (segundo retrabajo del ítem 4). */
  panelAbierto?: boolean;
}) {
  const ahoraMs = ahora ?? Date.now();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  // F35: los anteriores a los últimos 200, hasta el primero guardado.
  const [hayMasAnteriores, setHayMasAnteriores] = useState(hayAnteriores);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const [errorAnteriores, setErrorAnteriores] = useState<string | null>(null);
  const [llegoAlPrimero, setLlegoAlPrimero] = useState(false);
  // Al sumar arriba, el hilo no baja al final y conserva lo que se estaba leyendo.
  const alturaAntesDeSumar = useRef<number | null>(null);
  const [input, setInput] = useState("");
  // F36: la «/» que abrió el selector, y cuál está elegida con el teclado.
  const [barra, setBarra] = useState<Barra | null>(null);
  const [elegida, setElegida] = useState(0);
  const opciones = barra ? filtrarRespuestas(respuestas, barra.consulta) : [];
  const leerBarra = (el: HTMLTextAreaElement) => {
    const b = respuestas.length > 0 ? barraEn(el.value, el.selectionStart ?? el.value.length) : null;
    setBarra(b);
    if (!b || b.consulta !== barra?.consulta) setElegida(0);
  };
  const elegirRespuesta = (indice: number) => {
    const r = opciones[indice];
    if (!r || !barra) return;
    const contenido = interpolar(r.contenido, { contacto: conversation?.contacts ?? null, espacio: { name: nombreDelEspacio } });
    const { texto, cursor } = aplicarRespuesta(input, barra, contenido);
    setInput(texto);
    setBarra(null);
    setElegida(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
      autoResize();
    });
  };
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [avisoDeEstado, setAvisoDeEstado] = useState<{ texto: string; error: boolean } | null>(null);
  // F35, tramo D: el seguimiento era de hoy o venció, y la ruta pide el próximo antes de cerrar.
  const [pedido, setPedido] = useState<{ fecha: string | null } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contenidoRef = useRef<HTMLDivElement>(null);
  // Si el hilo está pegado al último mensaje. Lo actualiza el desplazamiento.
  const pegadoAlFinal = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // El estado que se ve: el de la conversación elegida, y después el que
  // devuelve la ruta o llega por Realtime. La conversación elegida es una foto
  // que guarda la bandeja y no se entera sola de los cambios.
  const [estadoActual, setEstadoActual] = useState<string>(conversation?.status ?? "open");
  useEffect(() => {
    setEstadoActual(conversation?.status ?? "open");
    setAvisoDeEstado(null);
    setPedido(null);
  }, [conversation?.id, conversation?.status]);

  // F40: la ventana de Instagram que se ve. La de la conversación elegida, y
  // después la que llega por Realtime (el lead escribió) o la del envío
  // rechazado por la ventana (409), que la da por cerrada.
  const [ventanaActual, setVentanaActual] = useState<string | null>(conversation?.window_expires_at ?? null);
  const [avisoDeEnvio, setAvisoDeEnvio] = useState<string | null>(null);
  useEffect(() => {
    setVentanaActual(conversation?.window_expires_at ?? null);
    setAvisoDeEnvio(null);
  }, [conversation?.id, conversation?.window_expires_at]);
  // F34: el contacto pidió no recibir más mensajes.
  const noContactar = Boolean(conversation?.contacts?.do_not_contact);
  const ventana = conversation ? estadoDeVentana({ platform: conversation.platform, window_expires_at: ventanaActual }, ahoraMs) : null;

  const updateConversationStatus = useCallback(async (status: EstadoDeConversacion) => {
    if (!conversation || statusUpdating) return;
    setStatusUpdating(status);
    const r = await cambiarEstadoDeConversacion(conversation.id, status);
    setStatusUpdating(null);
    if (r.tipo === "cambiado") {
      setPedido(null);
      setEstadoActual(r.estado);
      setAvisoDeEstado({ texto: avisoDeCambio(r.estado), error: false });
    } else if (r.tipo === "pide_seguimiento") {
      // No se cierra todavía: debajo del encabezado aparece el selector.
      setAvisoDeEstado(null);
      setPedido({ fecha: r.fecha });
    } else {
      // Queda como estaba: no se tocó `estadoActual`.
      setAvisoDeEstado({ texto: AVISO_DE_FALLA_DE_ESTADO, error: true });
    }
  }, [conversation, statusUpdating]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
    setHayMasAnteriores(hayAnteriores);
    setLlegoAlPrimero(false);
    setErrorAnteriores(null);
  }, [initialMessages, hayAnteriores]);

  // Al cambiar los mensajes, al final; salvo cuando se sumaron los anteriores
  // arriba: ahí se conserva la posición. Retrabajo del ítem 4 (06/11/2026),
  // punto b: los mensajes recién cargados (la conversación que se abre) bajan
  // de una, sin animación; uno nuevo baja con animación. Solo se mueve el
  // hilo: `scrollIntoView` movía también la página, y en el iPhone eso sacaba
  // el encabezado de la vista.
  useLayoutEffect(() => {
    pegadoAlFinal.current = true;
  }, [conversation?.id]);
  useLayoutEffect(() => {
    const contenedor = scrollContainerRef.current;
    if (!contenedor) return;
    if (alturaAntesDeSumar.current !== null) {
      contenedor.scrollTop += contenedor.scrollHeight - alturaAntesDeSumar.current;
      alturaAntesDeSumar.current = null;
      return;
    }
    pegadoAlFinal.current = true;
    if (messages === initialMessages) contenedor.scrollTop = contenedor.scrollHeight;
    else contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: "smooth" });
  }, [messages, initialMessages]);
  // Segundo retrabajo del ítem 4 (06/11/2026), punto b: al abrir el panel del
  // contacto en el teléfono, el hilo guarda dónde estaba; al volver, lo repone
  // (al final si estaba al final). Después de un cuadro: el hilo tiene que
  // estar dibujado de nuevo.
  const lugarAntesDelPanel = useRef<LugarDelHilo | null>(null);
  useLayoutEffect(() => {
    const contenedor = scrollContainerRef.current;
    if (!contenedor) return;
    if (panelAbierto) {
      lugarAntesDelPanel.current = lugarDelHilo(contenedor);
      return;
    }
    const lugar = lugarAntesDelPanel.current;
    if (!lugar) return;
    lugarAntesDelPanel.current = null;
    pegadoAlFinal.current = lugar.pegado;
    const cuadro = requestAnimationFrame(() => {
      contenedor.scrollTop = scrollParaVolver(lugar, contenedor);
    });
    return () => cancelAnimationFrame(cuadro);
  }, [panelAbierto]);
  // Las fotos cargan después y agrandan el hilo, y el teclado lo achica: si
  // estaba al final, se queda al final.
  useEffect(() => {
    const contenedor = scrollContainerRef.current;
    const contenido = contenidoRef.current;
    if (!contenedor || !contenido || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => {
      if (pegadoAlFinal.current) contenedor.scrollTop = contenedor.scrollHeight;
    });
    observador.observe(contenido);
    observador.observe(contenedor);
    return () => observador.disconnect();
  }, [conversation?.id]);

  async function verAnteriores() {
    const masViejo = messages.find((m) => !m.id.startsWith("optimistic-"));
    if (!conversation || !masViejo || cargandoAnteriores) return;
    setCargandoAnteriores(true);
    setErrorAnteriores(null);
    try {
      const res = await fetch(
        `/api/v1/messages?conversationId=${conversation.id}&antesAt=${encodeURIComponent(masViejo.created_at)}&antesId=${masViejo.id}`
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.messages)) throw new Error(String(res.status));
      alturaAntesDeSumar.current = scrollContainerRef.current?.scrollHeight ?? null;
      pegadoAlFinal.current = false;
      setMessages((prev) => sumarAnteriores(prev, data.messages as Message[]));
      setHayMasAnteriores(data.hayAnteriores === true);
      if (data.hayAnteriores !== true) setLlegoAlPrimero(true);
    } catch {
      setErrorAnteriores("No se pudieron traer los mensajes anteriores. Probá de nuevo.");
    } finally {
      setCargandoAnteriores(false);
    }
  }

  // Listen for conversation updates (last_message_at changes when a new message arrives)
  // and re-fetch the latest messages from the base (F27), keeping the older
  // ones already loaded (F35).
  useEffect(() => {
    if (!conversation) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`conversation-${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversation.id}`,
        },
        async (payload) => {
          // F35, tramo D: si la cerraron o la reabrieron (el lead escribió, la
          // tarea del seguimiento, otra pestaña), el encabezado lo muestra.
          const nuevo = (payload.new as { status?: string } | null)?.status;
          if (nuevo === "open" || nuevo === "closed") setEstadoActual(nuevo);
          // F40: el lead escribió y la ventana se movió.
          const fila = payload.new as { window_expires_at?: string | null } | null;
          if (fila && "window_expires_at" in fila) setVentanaActual(fila.window_expires_at ?? null);
          try {
            const res = await fetch(
              `/api/v1/messages?conversationId=${conversation.id}`
            );
            if (res.ok) {
              // La respuesta es { messages, hayAnteriores }, no un array.
              const data = await res.json();
              const freshMessages: Message[] = data?.messages ?? [];
              setMessages((prev) => refrescarHilo(prev, freshMessages));
            }
          } catch (err) {
            console.error("Failed to refresh messages:", err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  async function handleSend() {
    if (!input.trim() || !conversation || sending) return;

    const text = input.trim();
    setInput("");
    setSending(true);

    // Optimistic update: add a temporary message immediately
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      conversation_id: conversation.id,
      direction: "outbound",
      text,
      attachments: null,
      quick_reply_payload: null,
      postback_payload: null,
      callback_data: null,
      platform_message_id: null,
      remote_jid: null,
      message_type: "texto",
      quoted_message_id: null,
      media_path: null,
      media_status: null,
      media_intentos: null,
      media_reclamado_at: null,
      media_mime: null,
      media_bytes: null,
      media_error: null,
      sent_by_flow_id: null,
      sent_by_node_id: null,
      sent_by_user_id: null,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, text }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        // F40: rechazado por la ventana. El campo pasa al bloque de la ventana
        // cerrada, y el texto escrito queda guardado (D11).
        if (errorData?.code === "ventana_cerrada") {
          setVentanaActual(null);
          setInput(text);
          setAvisoDeEnvio(errorData.error || AVISO_VENTANA_CERRADA);
        } else {
          setAvisoDeEnvio(errorData?.error || "No se envió.");
        }
        throw new Error(errorData.error || `Send failed (${res.status})`);
      }
      setAvisoDeEnvio(null);

      const confirmedMessage: Message = await res.json();

      // Replace optimistic message with confirmed one
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? confirmedMessage : m))
      );
    } catch (err) {
      console.error("Failed to send message:", err);
      // Mark optimistic message as failed
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, status: "failed" as const } : m
        )
      );
    } finally {
      setSending(false);
    }
  }

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          Elegí una conversación
        </h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Elegí una de la lista para ver sus mensajes
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      {/* Alto fijo: el nombre ocupa hasta dos filas y el estado no se achica (S8, tramos 8 y 9). */}
      {/* Segundo retrabajo del ítem 4 (06/11/2026), punto a, decisión de
          pantalla de la revisión, vetable: en el teléfono, dos filas; arriba el
          nombre (hasta dos líneas), abajo la ventana, el estado y «Cerrar».
          Desde md, la fila de siempre. */}
      <div className="flex flex-col gap-0.5 border-b border-border px-4 py-1.5 md:h-14 md:flex-row md:items-center md:justify-between md:gap-3 md:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Tercer retrabajo del ítem 4 (06/11/2026): la foto también abre la
              ficha, como el nombre y como en el panel (S8). */}
          {conversation.contact_id ? (
            <Link
              href={enlaceAFicha(conversation.contact_id, volverALaBandeja)}
              aria-label="Abrir la ficha del contacto"
              className="shrink-0 rounded-full hover:opacity-80"
            >
          <div className="relative shrink-0">
            {conversation.contacts?.avatar_url ? (
              <img
                src={conversation.contacts.avatar_url}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {inicialDe(nombreDeConversacion(conversation))}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-background">
              <PlatformIcon
                platform={conversation.platform}
                className="h-2.5 w-2.5"
                size={10}
              />
            </div>
          </div>
            </Link>
          ) : (
          <div className="relative shrink-0">
            {conversation.contacts?.avatar_url ? (
              <img
                src={conversation.contacts.avatar_url}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {inicialDe(nombreDeConversacion(conversation))}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-background">
              <PlatformIcon
                platform={conversation.platform}
                className="h-2.5 w-2.5"
                size={10}
              />
            </div>
          </div>
          )}
          <div className="min-w-0">
            {/* F35, criterio 31: el nombre abre la ficha del contacto. */}
            {conversation.contact_id ? (
              <Link
                href={enlaceAFicha(conversation.contact_id, volverALaBandeja)}
                title={nombreDeConversacion(conversation)}
                className="line-clamp-2 break-words text-sm font-medium hover:underline"
              >
                {nombreDeConversacion(conversation)}
              </Link>
            ) : (
              <p title={nombreDeConversacion(conversation)} className="line-clamp-2 break-words text-sm font-medium">
                {nombreDeConversacion(conversation)}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-11 md:pl-0">
          {noContactar && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">No contactar</span>
          )}
          {conversation.is_automation_paused && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
              Automatización en pausa
            </span>
          )}
          <MarcaDeVentana conversacion={{ platform: conversation.platform, window_expires_at: ventanaActual }} ahora={ahoraMs} lugar="encabezado" />
          <VistaDelEstado
            estado={estadoActual}
            ocupado={!!statusUpdating}
            aviso={avisoDeEstado}
            onCambiar={() => updateConversationStatus(estadoActual === "closed" ? "open" : "closed")}
          />
        </div>
      </div>

      {pedido && conversation.contact_id && (
        <BloqueDePedido
          contactoId={conversation.contact_id}
          fecha={pedido.fecha}
          zona={zona}
          // Elegir una opción guarda el seguimiento; después se vuelve a pedir
          // el cierre. En este bloque «Otra fecha» empieza mañana (desdeManana).
          onElegido={() => {
            alGuardarSeguimiento?.();
            setPedido(null);
            void updateConversationStatus("closed");
          }}
          onCancelar={() => setPedido(null)}
        />
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={(e) => {
          pegadoAlFinal.current = estaAlFinal(e.currentTarget);
        }}
        className="flex-1 overflow-y-auto p-4"
      >
        <div ref={contenidoRef} className="mx-auto max-w-2xl space-y-4">
          {avisoDelHistorial(historial) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {avisoDelHistorial(historial)}
            </div>
          )}
          {hayMasAnteriores && (
            <div className="flex flex-col items-center gap-1 pb-2">
              <button
                onClick={verAnteriores}
                disabled={cargandoAnteriores}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {cargandoAnteriores ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />}
                Ver mensajes anteriores
              </button>
              {errorAnteriores && <p className="text-[11px] text-destructive">{errorAnteriores}</p>}
            </div>
          )}
          {llegoAlPrimero && (
            <div className="flex items-center gap-3 pb-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground">Este es el primer mensaje guardado</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {messages.map((message, i) => (
            <div key={message.id}>
              {cambiaDeDia(message.created_at, messages[i - 1]?.created_at) && (
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] text-muted-foreground">
                    {separadorDeDia(message.created_at)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <MessageBubble message={message} />
            </div>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border p-4">
        {avisoDeEnvio && (
          <p role="alert" className="mx-auto mb-2 max-w-2xl text-xs text-destructive">
            {avisoDeEnvio}
          </p>
        )}
        {noContactar ? (
          <div className="mx-auto max-w-2xl rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100" role="status">
            {AVISO_NO_CONTACTAR}
          </div>
        ) : ventana?.estado === "cerrada" ? (
          <div className="mx-auto max-w-2xl">
            <BloqueVentanaCerrada
              volver={volverALaBandeja}
              contactoId={conversation.contact_id}
              telefono={conversation.contacts?.phone ?? null}
              telefonoResuelto={conversation.contacts?.phone_resolved !== false}
            />
          </div>
        ) : (
        <>
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <div className="relative flex-1">
            {/* F36: «/» abre las Respuestas rápidas. */}
            {barra && <SelectorDeRespuestas opciones={opciones} elegida={elegida} alElegir={elegirRespuesta} />}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                leerBarra(e.target);
                autoResize();
              }}
              onClick={(e) => leerBarra(e.currentTarget)}
              onBlur={() => setBarra(null)}
              onKeyDown={(e) => {
                if (barra) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setElegida((i) => moverEleccion(i, opciones.length, e.key as "ArrowDown" | "ArrowUp"));
                    return;
                  }
                  if (e.key === "Enter" && opciones.length > 0) {
                    e.preventDefault();
                    elegirRespuesta(elegida);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setBarra(null);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Escribí un mensaje… (usá / para respuestas rápidas)"
              rows={1}
              className="w-full resize-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              style={{ maxHeight: 150 }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            aria-label="Enviar mensaje"
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              input.trim() && !sending
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {ventana?.estado === "por_vencer" && (
          <p suppressHydrationWarning className="mx-auto mt-1.5 max-w-2xl text-[11px] text-amber-700 dark:text-amber-400">
            {textoDeVence(ventana.restanteMs)}. Después, solo desde la app de Instagram.
          </p>
        )}
        </>
        )}
      </div>
    </div>
  );
}
