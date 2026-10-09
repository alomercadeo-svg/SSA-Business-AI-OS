"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { guardarUmbral } from "@/lib/actions/vigilancia";

/**
 * El límite de silencio de un canal, editable (F39). Vacío = sin vigilar. El
 * control de rol y la validación están en la acción de servidor.
 */
export function UmbralCanal({ canalId, inicial }: { canalId: string; inicial: number | null }) {
  const [valor, setValor] = useState(inicial === null ? "" : String(inicial));
  const [guardado, setGuardado] = useState(valor);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();
  const cambiado = valor.trim() !== guardado.trim();

  function guardar() {
    setError(null);
    empezar(async () => {
      const r = await guardarUmbral(canalId, valor);
      if (r.ok) setGuardado(valor.trim());
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Sin vigilar"
          aria-label="Límite de silencio en horas hábiles"
          className="w-24 rounded-lg border border-input bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">horas hábiles</span>
        {cambiado && (
          <button
            type="button"
            onClick={guardar}
            disabled={pendiente}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pendiente && <Loader2 className="h-3 w-3 animate-spin" />}
            Guardar
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
