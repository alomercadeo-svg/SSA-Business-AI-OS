"use client";

/**
 * «Eliminar» de la ficha (F30). Solo lo ve un Owner o un Admin, y la base lo
 * exige igual: `eliminar_contacto` (00038) rechaza a cualquier otro. Eliminar
 * marca la fecha (el contacto y sus conversaciones), no borra: se restaura
 * desde «Eliminados» durante 30 días y después la purga lo borra.
 *
 * Llama a la función con el cliente del navegador, que es el mismo camino que
 * prueba `scripts/verify-borrado.mjs` con el token de cada uno.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function EliminarContacto({ contactoId, nombre }: { contactoId: string; nombre: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function eliminar() {
    setError(null);
    empezar(async () => {
      try {
        const { error: e } = await createClient().rpc("eliminar_contacto", { p_contacto: contactoId });
        if (e) {
          return setError(
            e.code === "42501"
              ? "Solo Owner y Admin pueden eliminar contactos."
              : e.code === "P0002"
                ? "Este contacto ya no existe o ya estaba eliminado."
                : "No se pudo eliminar. Volvé a intentar."
          );
        }
        router.push("/dashboard/contacts?eliminado=1");
        router.refresh();
      } catch {
        setError("No se pudo eliminar: se perdió la conexión. Revisá internet y volvé a intentar.");
      }
    });
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        Eliminar
      </button>
    );
  }

  return (
    <div role="dialog" aria-label="Eliminar contacto" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950/40">
      <p className="font-medium">Eliminar contacto</p>
      <p className="mt-1 text-muted-foreground">
        {nombre} pasa a Eliminados. Se puede restaurar durante 30 días; después se borra definitivamente.
      </p>
      {error && <p className="mt-2 text-red-700 dark:text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pendiente}
          onClick={() => setAbierto(false)}
          className="rounded-lg border border-input px-3 py-1.5 hover:bg-accent disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={pendiente}
          onClick={eliminar}
          className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pendiente ? "Eliminando…" : "Eliminar"}
        </button>
      </div>
    </div>
  );
}
