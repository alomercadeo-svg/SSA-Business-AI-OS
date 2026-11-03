"use client";

/**
 * El estado de la sesión de WhatsApp en la tarjeta del canal, y el botón de
 * reconectar con el código QR (F32). La pantalla es solo de Owner y Admin
 * (`getWorkspaceAsManager` en la página), así que todos los que la ven pueden
 * apretar el botón.
 *
 * El botón no siempre puede entregar un código, y cuando no puede lo dice en
 * vez de fallar en silencio (§11, Pantalla: Canales). Con «se agotaron los
 * intentos», primero explica qué hacer en el teléfono y recién con «Empezar de
 * cero» pide el código: en Evolution 2.3.7 la instancia quedó en `close`, y
 * pedirlo arranca una vinculación nueva.
 */
import { useState } from "react";
import { Loader2, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { pedirCodigoWhatsapp } from "@/lib/actions/canales";
import {
  textoDeSesion,
  textoDeMotivo,
  type RespuestaDeCodigo,
  type SesionDelCanal,
} from "@/lib/sesion-whatsapp-pantalla";

const TONOS = {
  ok: "bg-green-100 text-green-700",
  peligro: "bg-red-100 text-red-700",
  aviso: "bg-amber-100 text-amber-800",
  neutro: "bg-muted text-muted-foreground",
} as const;

export type FaseDelModal = { tipo: "agotado" } | { tipo: "pidiendo" } | RespuestaDeCodigo;

export function SesionWhatsapp({ canal }: { canal: SesionDelCanal & { id: string } }) {
  const t = textoDeSesion(canal);
  const [fase, setFase] = useState<FaseDelModal | null>(null);

  async function pedir() {
    setFase({ tipo: "pidiendo" });
    try {
      setFase(await pedirCodigoWhatsapp(canal.id));
    } catch {
      setFase({ tipo: "error", motivo: "sin_respuesta" });
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", TONOS[t.tono])}>
          Sesión de WhatsApp: {t.etiqueta}
        </span>
        {t.boton && (
          <button
            onClick={() => (t.estado === "agotado" ? setFase({ tipo: "agotado" }) : pedir())}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <QrCode className="h-3.5 w-3.5" />
            {t.boton}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t.explicacion}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{t.verificado}</p>

      {fase && <ModalDeCodigo fase={fase} onCerrar={() => setFase(null)} onPedir={pedir} />}
    </div>
  );
}

export function ModalDeCodigo({
  fase,
  onCerrar,
  onPedir,
}: {
  fase: FaseDelModal;
  onCerrar: () => void;
  onPedir: () => void;
}) {
  const boton = "rounded-lg px-3 py-1.5 text-sm font-medium";
  const secundario = cn(boton, "border border-border hover:bg-muted");
  const primario = cn(boton, "bg-primary text-primary-foreground hover:bg-primary/90");

  let titulo = "Vincular WhatsApp";
  let cuerpo: React.ReactNode = null;
  let acciones: React.ReactNode = (
    <button onClick={onCerrar} className={secundario}>
      Cerrar
    </button>
  );

  switch (fase.tipo) {
    case "pidiendo":
      cuerpo = (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Pidiendo el código…
        </p>
      );
      break;
    case "agotado":
      titulo = "No se puede generar un código";
      cuerpo = (
        <p className="text-sm">
          WhatsApp ya no acepta más códigos para esta vinculación. Hay que empezar de cero: en el teléfono del negocio,
          abrí WhatsApp Business → Dispositivos vinculados, cerrá la sesión del sistema si aparece, y volvé a intentar en
          unos minutos.
        </p>
      );
      acciones = (
        <>
          <button onClick={onCerrar} className={secundario}>
            Entendido
          </button>
          <button onClick={onPedir} className={primario}>
            Empezar de cero
          </button>
        </>
      );
      break;
    case "qr":
      cuerpo = (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fase.imagen} alt="Código QR para vincular WhatsApp" className="mx-auto h-56 w-56" />
          <p className="mt-3 text-sm">
            En el teléfono del negocio, abrí <strong>WhatsApp Business → Dispositivos vinculados → Vincular un
            dispositivo</strong> y escaneá este código.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            El código vence a los pocos segundos. Si vence, apretá «Actualizar código».
          </p>
        </>
      );
      acciones = (
        <>
          <button onClick={onCerrar} className={secundario}>
            Cerrar
          </button>
          <button onClick={onPedir} className={primario}>
            Actualizar código
          </button>
        </>
      );
      break;
    case "conectado":
      titulo = "WhatsApp ya está conectado";
      cuerpo = <p className="text-sm">No hace falta escanear ningún código. El estado de la tarjeta se actualiza con el próximo chequeo.</p>;
      break;
    case "sin_codigo":
      titulo = "Todavía no hay un código";
      cuerpo = <p className="text-sm">WhatsApp tarda unos segundos en generarlo. Probá con «Actualizar código».</p>;
      acciones = (
        <>
          <button onClick={onCerrar} className={secundario}>
            Cerrar
          </button>
          <button onClick={onPedir} className={primario}>
            Actualizar código
          </button>
        </>
      );
      break;
    case "error":
      titulo = "No se pudo pedir el código";
      cuerpo = (
        <p className="text-sm">
          {fase.motivo === "permiso"
            ? "Solo Owner y Admin pueden reconectar WhatsApp."
            : fase.motivo === "canal"
              ? "No se encontró este canal de WhatsApp en tu espacio."
              : textoDeMotivo(fase.motivo)}
        </p>
      );
      break;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold">{titulo}</h2>
        <div className="mt-3">{cuerpo}</div>
        <div className="mt-4 flex justify-end gap-2">{acciones}</div>
      </div>
    </div>
  );
}
