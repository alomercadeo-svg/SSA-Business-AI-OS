"use client";

import { Plus, X } from "lucide-react";
import { DIAS, type Dia, type Franja, type Horario } from "@/lib/horas-habiles";

/**
 * «Horario de atención del negocio» (§11, General). Es el que usa F39 para
 * contar las horas hábiles del límite de silencio. No es la franja de envío de
 * F33, que es del canal de WhatsApp y va en la zona del contacto.
 *
 * Las horas van en listas cada 30 minutos, de 0:00 a 24:00: un campo de hora
 * del navegador no deja escribir 24:00, y «todo el día» lo necesita. La
 * validación de verdad está en el servidor (`guardarGeneral`).
 */
const NOMBRE: Record<Dia, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

const HORAS = Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

const selector =
  "rounded-lg border border-input bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring";

function OpcionesDeHora({ actual }: { actual: string }) {
  // Si lo guardado no cae en la grilla de 30 minutos, igual se muestra.
  const lista = HORAS.includes(actual) ? HORAS : [...HORAS, actual].sort();
  return (
    <>
      {lista.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </>
  );
}

export function HorarioNegocio({ valor, onChange }: { valor: Horario; onChange: (h: Horario) => void }) {
  const cambiarDia = (dia: Dia, franjas: Franja[]) => onChange({ ...valor, [dia]: franjas });

  return (
    <div className="space-y-2">
      {DIAS.map((dia) => {
        const franjas = valor[dia] ?? [];
        return (
          <div key={dia} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-muted-foreground">{NOMBRE[dia]}</span>
            {franjas.length === 0 && <span className="text-xs text-muted-foreground">Cerrado</span>}
            {franjas.map(([desde, hasta], i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <select
                  aria-label={`${NOMBRE[dia]}, desde`}
                  value={desde}
                  onChange={(e) => cambiarDia(dia, franjas.map((f, j) => (j === i ? [e.target.value, f[1]] : f)))}
                  className={selector}
                >
                  <OpcionesDeHora actual={desde} />
                </select>
                <span className="text-xs text-muted-foreground">a</span>
                <select
                  aria-label={`${NOMBRE[dia]}, hasta`}
                  value={hasta}
                  onChange={(e) => cambiarDia(dia, franjas.map((f, j) => (j === i ? [f[0], e.target.value] : f)))}
                  className={selector}
                >
                  <OpcionesDeHora actual={hasta} />
                </select>
                <button
                  type="button"
                  aria-label={`Quitar esta franja del ${NOMBRE[dia].toLowerCase()}`}
                  onClick={() => cambiarDia(dia, franjas.filter((_, j) => j !== i))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => cambiarDia(dia, [...franjas, franjas.length ? ["14:00", "18:00"] : ["08:00", "18:00"]])}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Agregar franja
            </button>
          </div>
        );
      })}
    </div>
  );
}
