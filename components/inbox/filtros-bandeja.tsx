"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  SIN_FILTROS,
  cuantosFiltros,
  type FiltroDeVentana,
  type FiltrosDeBandeja,
  type OpcionesDeFiltros,
  type Plataforma,
  type RangoDeFechas,
} from "@/lib/filtros-bandeja";

/**
 * El botón «Filtros» de la bandeja y su panel (F35, tramo B de S8).
 *
 * Decidido el 03/11/2026 (chat de revisión, con el prototipo aprobado): los
 * grupos en este orden, «Seguimiento», «Canal», «Asignación», «Etiquetas»,
 * «Fecha del último mensaje» y «Teléfono sin resolver», y «Limpiar filtros».
 * Sin los atajos «Seguimiento hoy» y «Vencidos» del prototipo: el plano no
 * los pide. F40 (S9, tramo A): el grupo «Ventana de Instagram» va entre
 * «Etiquetas» y «Fecha del último mensaje», como en el prototipo
 * (prototipo-fase1.html:591), con una opción por vez, y solo si el espacio
 * tiene Instagram: la ventana existe solo ahí.
 *
 * Un «Rango de fechas» filtra recién con las dos fechas; mientras falta una,
 * queda elegido en el panel pero no se manda.
 */

const NOMBRE_DE_PLATAFORMA: Record<Plataforma, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };
const VENTANAS: Array<[FiltroDeVentana, string]> = [
  ["abierta", "Abierta"],
  ["por_vencer", "Vence en menos de 2 h"],
  ["cerrada", "Cerrada"],
];

function Opcion({ elegida, onClick, children }: { elegida: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={elegida}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        elegida ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Fechas({ rango, onCambiar }: { rango: Partial<RangoDeFechas>; onCambiar: (r: Partial<RangoDeFechas>) => void }) {
  const clase = "rounded-md border border-input bg-background px-2 py-1 text-xs";
  return (
    <div className="mt-1.5 flex w-full items-center gap-2">
      <input type="date" aria-label="Desde" className={clase} value={rango.desde ?? ""} onChange={(e) => onCambiar({ ...rango, desde: e.target.value })} />
      <span className="text-xs text-muted-foreground">a</span>
      <input type="date" aria-label="Hasta" className={clase} value={rango.hasta ?? ""} onChange={(e) => onCambiar({ ...rango, hasta: e.target.value })} />
    </div>
  );
}

const rangoDe = (v: FiltrosDeBandeja["ultimo"] | FiltrosDeBandeja["seguimiento"]): Partial<RangoDeFechas> | null =>
  v && typeof v === "object" ? { desde: v.desde, hasta: v.hasta } : null;

/** Un rango completo, en orden; si falta una fecha, ninguno. */
function completo(r: Partial<RangoDeFechas>): RangoDeFechas | null {
  if (!r.desde || !r.hasta) return null;
  return r.desde <= r.hasta ? { desde: r.desde, hasta: r.hasta } : { desde: r.hasta, hasta: r.desde };
}

export function FiltrosBandeja({
  filtros,
  opciones,
  onCambiar,
  abiertoAlInicio = false,
}: {
  filtros: FiltrosDeBandeja;
  opciones: OpcionesDeFiltros;
  onCambiar: (f: FiltrosDeBandeja) => void;
  /** Para los tests, que dibujan sin hacer clic. */
  abiertoAlInicio?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoAlInicio);
  // Los rangos a medio elegir viven acá hasta tener las dos fechas.
  const [rangoUltimo, setRangoUltimo] = useState<Partial<RangoDeFechas> | null>(rangoDe(filtros.ultimo));
  const [rangoSeguimiento, setRangoSeguimiento] = useState<Partial<RangoDeFechas> | null>(rangoDe(filtros.seguimiento));
  const n = cuantosFiltros(filtros);
  const cambiar = (c: Partial<FiltrosDeBandeja>) => onCambiar({ ...filtros, ...c });
  const alternar = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  const elegirSeguimiento = (v: "hoy" | "semana" | "vencido") => {
    setRangoSeguimiento(null);
    cambiar({ seguimiento: filtros.seguimiento === v ? null : v });
  };
  const elegirUltimo = (v: "hoy" | "7" | "30") => {
    setRangoUltimo(null);
    cambiar({ ultimo: filtros.ultimo === v ? null : v });
  };
  const alternarRangoSeguimiento = () => {
    if (rangoSeguimiento) {
      setRangoSeguimiento(null);
      cambiar({ seguimiento: null });
    } else {
      setRangoSeguimiento({});
      if (filtros.seguimiento) cambiar({ seguimiento: null });
    }
  };
  const alternarRangoUltimo = () => {
    if (rangoUltimo) {
      setRangoUltimo(null);
      cambiar({ ultimo: null });
    } else {
      setRangoUltimo({});
      if (filtros.ultimo) cambiar({ ultimo: null });
    }
  };
  const fechasDeSeguimiento = (r: Partial<RangoDeFechas>) => {
    setRangoSeguimiento(r);
    const c = completo(r);
    cambiar({ seguimiento: c ? { tipo: "rango", ...c } : null });
  };
  const fechasDelUltimo = (r: Partial<RangoDeFechas>) => {
    setRangoUltimo(r);
    const c = completo(r);
    cambiar({ ultimo: c ? { tipo: "rango", ...c } : null });
  };
  const limpiar = () => {
    setRangoSeguimiento(null);
    setRangoUltimo(null);
    onCambiar(SIN_FILTROS);
  };

  return (
    <div className="px-3 pb-2">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
        className={cn(
          "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
          n ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {n ? `Filtros · ${n}` : "Filtros"}
      </button>

      {abierto && (
        <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <Grupo titulo="Seguimiento">
            <Opcion elegida={filtros.seguimiento === "hoy"} onClick={() => elegirSeguimiento("hoy")}>Vence hoy</Opcion>
            <Opcion elegida={filtros.seguimiento === "semana"} onClick={() => elegirSeguimiento("semana")}>Vence esta semana</Opcion>
            <Opcion elegida={filtros.seguimiento === "vencido"} onClick={() => elegirSeguimiento("vencido")}>Vencido</Opcion>
            <Opcion elegida={rangoSeguimiento !== null} onClick={alternarRangoSeguimiento}>Rango de fechas</Opcion>
            {rangoSeguimiento && <Fechas rango={rangoSeguimiento} onCambiar={fechasDeSeguimiento} />}
          </Grupo>

          <Grupo titulo="Canal">
            {opciones.plataformas.map((p) => (
              <Opcion key={p} elegida={filtros.canal.includes(p)} onClick={() => cambiar({ canal: alternar(filtros.canal, p) })}>
                {NOMBRE_DE_PLATAFORMA[p]}
              </Opcion>
            ))}
          </Grupo>

          <Grupo titulo="Asignación">
            <Opcion elegida={filtros.asignacion === null} onClick={() => cambiar({ asignacion: null })}>Todas</Opcion>
            <Opcion elegida={filtros.asignacion === "sin"} onClick={() => cambiar({ asignacion: "sin" })}>Sin asignar</Opcion>
            {opciones.miembros.map((m) => (
              <Opcion key={m.id} elegida={filtros.asignacion === m.id} onClick={() => cambiar({ asignacion: m.id })}>
                {m.etiqueta}
              </Opcion>
            ))}
          </Grupo>

          <Grupo titulo="Etiquetas">
            {opciones.etiquetas.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todavía no hay etiquetas.</p>
            ) : (
              opciones.etiquetas.map((t) => (
                <Opcion key={t.id} elegida={filtros.etiquetas.includes(t.id)} onClick={() => cambiar({ etiquetas: alternar(filtros.etiquetas, t.id) })}>
                  {t.name}
                </Opcion>
              ))
            )}
          </Grupo>

          {opciones.plataformas.includes("instagram") && (
            <Grupo titulo="Ventana de Instagram">
              {VENTANAS.map(([v, texto]) => (
                <Opcion key={v} elegida={filtros.ventana === v} onClick={() => cambiar({ ventana: filtros.ventana === v ? null : v })}>
                  {texto}
                </Opcion>
              ))}
            </Grupo>
          )}

          <Grupo titulo="Fecha del último mensaje">
            <Opcion elegida={filtros.ultimo === "hoy"} onClick={() => elegirUltimo("hoy")}>Hoy</Opcion>
            <Opcion elegida={filtros.ultimo === "7"} onClick={() => elegirUltimo("7")}>Últimos 7 días</Opcion>
            <Opcion elegida={filtros.ultimo === "30"} onClick={() => elegirUltimo("30")}>Últimos 30 días</Opcion>
            <Opcion elegida={rangoUltimo !== null} onClick={alternarRangoUltimo}>Rango de fechas</Opcion>
            {rangoUltimo && <Fechas rango={rangoUltimo} onCambiar={fechasDelUltimo} />}
          </Grupo>

          <div className="flex items-center justify-between gap-2">
            <Opcion elegida={filtros.telefonoSinResolver} onClick={() => cambiar({ telefonoSinResolver: !filtros.telefonoSinResolver })}>
              Teléfono sin resolver
            </Opcion>
            <button type="button" onClick={limpiar} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              Limpiar filtros
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
