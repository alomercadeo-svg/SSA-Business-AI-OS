"use client";

/**
 * La vista «Eliminados» de Contactos (F30, §11). Las filas las trae la página
 * con `contactos_eliminados` (00038), que aplica el alcance de quien mira: un
 * Member ve solo sus leads, y lo garantiza la base.
 *
 * «Restaurar» es solo de Owner y Admin (decisión de Marcos del 20/10/2026): el
 * Member no ve el botón, y la base lo rechaza igual (`restaurar_contacto`).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { diasParaLaPurga } from "@/lib/borrado";

export interface FilaEliminada {
  id: string;
  display_name: string | null;
  deleted_at: string;
}

function haceCuanto(fecha: string, ahora: number): string {
  const dias = Math.floor((ahora - new Date(fecha).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "hace 1 día";
  return `hace ${dias} días`;
}

export function ContactosEliminados({ filas, puedeRestaurar }: { filas: FilaEliminada[]; puedeRestaurar: boolean }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [, empezar] = useTransition();
  const ahora = Date.now();

  function restaurar(id: string) {
    setAviso(null);
    setError(null);
    setEnCurso(id);
    empezar(async () => {
      try {
        const { error: e } = await createClient().rpc("restaurar_contacto", { p_contacto: id });
        if (e) {
          setError(
            e.code === "42501"
              ? "Solo Owner y Admin pueden restaurar contactos."
              : e.code === "P0002"
                ? "Ese contacto ya no está en Eliminados: alguien lo restauró, o ya se borró definitivamente."
                : "No se pudo restaurar. Volvé a intentar.",
          );
          if (e.code === "P0002") router.refresh();
        } else {
          setAviso("Contacto restaurado");
          router.refresh();
        }
      } catch {
        setError("No se pudo guardar: se perdió la conexión. Revisá internet y volvé a intentar.");
      } finally {
        setEnCurso(null);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Eliminados</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Se pueden restaurar durante 30 días. Después se borran definitivamente. El historial de cambios se conserva siempre.
            </p>
          </div>
          <Link
            href="/dashboard/contacts"
            className="shrink-0 rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            ← Volver a contactos
          </Link>
        </div>
        {aviso && <p className="mt-3 text-sm text-green-700 dark:text-green-400">{aviso}</p>}
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {filas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No hay contactos eliminados. Cuando elimines uno desde su ficha, aparece acá y se puede restaurar durante 30 días.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Nombre</th>
                <th className="py-2 pr-4 font-medium">Eliminado</th>
                <th className="py-2 pr-4 font-medium">Se borra en</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-border">
                  <td className="py-3 pr-4 font-medium">{f.display_name ?? "Sin nombre"}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{haceCuanto(f.deleted_at, ahora)}</td>
                  <td className="py-3 pr-4 tabular-nums">
                    {diasParaLaPurga(f.deleted_at, new Date(ahora))} días
                  </td>
                  <td className="py-3 text-right">
                    {puedeRestaurar && (
                      <button
                        type="button"
                        disabled={enCurso !== null}
                        onClick={() => restaurar(f.id)}
                        className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
                      >
                        {enCurso === f.id ? "Restaurando…" : "Restaurar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
