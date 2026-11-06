"use client";

import type { RespuestaRapida } from "@/lib/respuestas-rapidas";

/**
 * F36, criterio 2: el selector que abre «/» en el campo de escritura. Va
 * encima del campo, a todo su ancho (también en el teléfono), con la lista
 * desplazable. Se maneja con las flechas, Enter y Escape desde el campo
 * (`message-thread.tsx`), y con el dedo o el mouse.
 *
 * `onMouseDown` y no `onClick`: el clic sacaría el foco del campo antes de
 * elegir, y el campo cerraría el selector.
 */
export function SelectorDeRespuestas({
  opciones,
  elegida,
  alElegir,
}: {
  opciones: RespuestaRapida[];
  elegida: number;
  alElegir: (indice: number) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Respuestas rápidas"
      className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-60 overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg"
    >
      {opciones.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">Ninguna respuesta rápida coincide</p>
      ) : (
        opciones.map((r, i) => (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={i === elegida}
            onMouseDown={(e) => {
              e.preventDefault();
              alElegir(i);
            }}
            className={`flex w-full flex-col items-start rounded-md px-3 py-2 text-left ${i === elegida ? "bg-accent" : "hover:bg-accent/60"}`}
          >
            <span className="flex w-full items-baseline gap-2">
              <span className="font-mono text-xs font-semibold">/{r.atajo}</span>
              <span className="truncate text-xs text-muted-foreground">{r.nombre}</span>
            </span>
            <span className="line-clamp-2 w-full text-xs text-muted-foreground/80">{r.contenido}</span>
          </button>
        ))
      )}
    </div>
  );
}
