"use client";

/**
 * «Revertir la marca» de la ficha (F34, ítem 8 del plan maestro). Solo lo ve
 * un Owner o un Admin, y la acción y la base lo exigen igual.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revertirNoContactar } from "@/lib/actions/contactos";

export function RevertirNoContactar({ contactoId }: { contactoId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function revertir() {
    setError(null);
    empezar(async () => {
      const r = await revertirNoContactar(contactoId);
      if (!r.ok) return setError(r.error);
      setAbierto(false);
      router.refresh();
    });
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="mt-2 text-sm font-medium underline underline-offset-2">
        Revertir la marca
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <p>¿Revertir la marca? Hacelo solo si el contacto pidió volver a recibir mensajes. Queda en el historial.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={revertir}
          disabled={pendiente}
          className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pendiente ? "Revirtiendo…" : "Sí, revertir"}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium dark:border-red-800">
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs">{error}</p>}
    </div>
  );
}
