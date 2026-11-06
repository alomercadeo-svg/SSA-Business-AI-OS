"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { guardarFrasesDeBaja } from "@/lib/actions/frases-de-baja";

export function FormularioDeFrases({ inicial }: { inicial: string[] }) {
  const [texto, setTexto] = useState(inicial.join("\n"));
  const [guardado, setGuardado] = useState(inicial.join("\n"));
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [pendiente, empezar] = useTransition();
  const cambiado = texto.trim() !== guardado.trim();

  function guardar() {
    setAviso(null);
    empezar(async () => {
      const r = await guardarFrasesDeBaja(texto);
      if (!r.ok) return setAviso({ texto: r.error, error: true });
      const limpio = r.frases.join("\n");
      setTexto(limpio);
      setGuardado(limpio);
      setAviso({ texto: "Frases guardadas. Queda en el historial.", error: false });
    });
  }

  return (
    <div className="space-y-3">
      <textarea
        aria-label="Frases de baja, una por línea"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={10}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={!cambiado || pendiente}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
        {aviso && <p className={aviso.error ? "text-sm text-red-600 dark:text-red-400" : "text-sm text-green-700 dark:text-green-400"}>{aviso.texto}</p>}
      </div>
    </div>
  );
}
