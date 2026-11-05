"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fechaSinHora } from "@/lib/ficha";
import {
  AVISO_DE_FALLA,
  DIAS_DE_SEGUIMIENTO,
  avisoDeSeguimiento,
  guardarSeguimiento,
  hoyEnZona,
  sumarDias,
  type EleccionDeSeguimiento,
} from "@/lib/seguimiento";
import { PEDIDO_DE_SEGUIMIENTO } from "@/lib/estado-conversacion";

/**
 * El selector de próximo seguimiento (F35, tramo C de S8): «En 3 días», «En 7
 * días», «En 14 días», «Otra fecha» y «Quitar». Los tres plazos y «Quitar»
 * guardan al tocarlos, sin confirmar. «Otra fecha» muestra, en el mismo lugar,
 * un campo de fecha y «Guardar»; el campo no ofrece fechas anteriores a hoy en
 * la zona del negocio. No abre la ficha ni ninguna ventana.
 *
 * Es una pieza aparte del panel a propósito: el tramo D la puede montar dentro
 * de «Cerrar» («al cerrar, se pide el próximo») y seguir con el cierre en
 * `alGuardar`.
 */
export function SelectorDeSeguimiento({
  contactoId,
  fecha: fechaInicial,
  zona,
  alGuardar,
  desdeManana = false,
}: {
  contactoId: string;
  fecha: string | null;
  /** `workspaces.zona_horaria`: la misma zona con la que el servidor cuenta los días. */
  zona: string;
  alGuardar?: (fecha: string | null) => void;
  /** En el bloque de «Cerrar» (tramo D), «Otra fecha» empieza mañana: con hoy, la ruta volvería a pedir. */
  desdeManana?: boolean;
}) {
  const [fecha, setFecha] = useState(fechaInicial);
  const [otraAbierta, setOtraAbierta] = useState(false);
  const [valorOtra, setValorOtra] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  }, []);

  function avisar(texto: string, error = false) {
    setAviso({ texto, error });
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setAviso(null), 4000);
  }

  let minimo = "";
  try {
    minimo = minimoDelSelector(new Date(), zona, desdeManana);
  } catch {
    minimo = "";
  }

  async function elegir(eleccion: EleccionDeSeguimiento) {
    if (guardando) return;
    setGuardando(true);
    const r = await guardarSeguimiento(contactoId, eleccion);
    setGuardando(false);
    if (!r.ok) {
      // Queda la fecha anterior: no se tocó `fecha`.
      avisar(AVISO_DE_FALLA, true);
      return;
    }
    setFecha(r.fecha);
    setOtraAbierta(false);
    setValorOtra("");
    avisar(avisoDeSeguimiento(r.fecha));
    alGuardar?.(r.fecha);
  }

  function guardarOtra() {
    if (!valorOtra) return avisar("Elegí una fecha", true);
    if (minimo && valorOtra < minimo) return avisar(desdeManana ? "Elegí una fecha de mañana en adelante." : "Elegí una fecha de hoy en adelante.", true);
    void elegir({ fecha: valorOtra });
  }

  return (
    <VistaDelSelector
      fecha={fecha}
      otraAbierta={otraAbierta}
      minimo={minimo}
      valorOtra={valorOtra}
      guardando={guardando}
      aviso={aviso}
      onElegir={(e) => void elegir(e)}
      onAbrirOtra={() => setOtraAbierta((v) => !v)}
      onCambiarOtra={setValorOtra}
      onGuardarOtra={guardarOtra}
    />
  );
}

const CHIP = "rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50";

/** Lo que dibuja el selector, sin estado: así se puede probar con datos fijos. */
export function VistaDelSelector({
  fecha,
  otraAbierta,
  minimo,
  valorOtra = "",
  guardando = false,
  aviso = null,
  onElegir,
  onAbrirOtra,
  onCambiarOtra,
  onGuardarOtra,
}: {
  fecha: string | null;
  otraAbierta: boolean;
  minimo: string;
  valorOtra?: string;
  guardando?: boolean;
  aviso?: { texto: string; error: boolean } | null;
  onElegir?: (e: EleccionDeSeguimiento) => void;
  onAbrirOtra?: () => void;
  onCambiarOtra?: (valor: string) => void;
  onGuardarOtra?: () => void;
}) {
  return (
    <div>
      <h4 className="text-xs font-medium uppercase text-muted-foreground">Próximo seguimiento</h4>
      <p className={cn("mt-1 text-sm", !fecha && "text-muted-foreground")}>{fechaSinHora(fecha)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DIAS_DE_SEGUIMIENTO.map((dias) => (
          <button key={dias} type="button" className={CHIP} disabled={guardando} onClick={() => onElegir?.({ dias })}>
            {`En ${dias} días`}
          </button>
        ))}
        <button type="button" className={cn(CHIP, otraAbierta && "bg-muted")} disabled={guardando} onClick={onAbrirOtra}>
          Otra fecha
        </button>
        {fecha && (
          <button type="button" className={CHIP} disabled={guardando} onClick={() => onElegir?.({ fecha: null })}>
            Quitar
          </button>
        )}
      </div>
      {otraAbierta && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            min={minimo || undefined}
            value={valorOtra}
            onChange={(e) => onCambiarOtra?.(e.target.value)}
            aria-label="Fecha de seguimiento"
            // El ícono del calendario lo dibuja el navegador según `color-scheme`:
            // sin declararlo, en modo nocturno quedaba oscuro sobre fondo oscuro
            // (visto por Marcos el 04/11/2026). La app pone el modo con la clase
            // `dark` en <html> (app/layout.tsx).
            className="rounded-md border border-input bg-background px-2 py-1 text-sm [color-scheme:light] [.dark_&]:[color-scheme:dark]"
          />
          <button
            type="button"
            disabled={guardando}
            onClick={onGuardarOtra}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      )}
      {aviso && (
        <p role="status" className={cn("mt-2 text-xs", aviso.error ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}


/** El primer día que ofrece «Otra fecha»: hoy en la zona del negocio, o mañana en el bloque de cerrar. */
export function minimoDelSelector(ahora: Date, zona: string, desdeManana: boolean): string {
  const hoy = hoyEnZona(ahora, zona);
  return desdeManana ? sumarDias(hoy, 1) : hoy;
}

/**
 * El pedido del próximo seguimiento al cerrar (F35, tramo D de S8): debajo del
 * encabezado del hilo, sin abrir ninguna ventana. Elegir una opción (también
 * «Quitar») guarda el seguimiento y `onElegido` vuelve a pedir el cierre;
 * «Cancelar» no cambia nada.
 */
export function BloqueDePedido({
  contactoId,
  fecha,
  zona,
  onElegido,
  onCancelar,
}: {
  contactoId: string;
  fecha: string | null;
  zona: string;
  onElegido: (fecha: string | null) => void;
  onCancelar: () => void;
}) {
  return (
    <div className="border-b border-border bg-amber-50 px-4 py-3 dark:bg-amber-950/40">
      <p className="mb-2 text-sm font-medium">{PEDIDO_DE_SEGUIMIENTO}</p>
      <SelectorDeSeguimiento contactoId={contactoId} fecha={fecha} zona={zona} alGuardar={onElegido} desdeManana />
      <button type="button" onClick={onCancelar} className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">
        Cancelar
      </button>
    </div>
  );
}
