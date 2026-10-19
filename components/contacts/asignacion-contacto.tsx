"use client";

/**
 * Setter y vendedor de un contacto (F41): dos desplegables con los miembros
 * del espacio y «Sin asignar», que guardan al elegir.
 *
 * Es una pieza aparte a propósito: F30 rehace la ficha y la reubica (en
 * «Editar datos», según el prototipo) sin reescribirla. No depende del diseño
 * de la página, solo del contacto, los dos valores y la lista de miembros.
 *
 * Guarda con `PATCH /api/v1/contacts/[id]/asignacion`, la misma ruta que usa
 * `scripts/verify-asignacion.mjs` para el control positivo con sesiones reales.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Miembro } from "@/lib/miembros";

type Campo = "setter_id" | "vendedor_id";
const SIN_ASIGNAR = "";

export function AsignacionContacto({
  contactoId,
  setterId,
  vendedorId,
  miembros,
}: {
  contactoId: string;
  setterId: string | null;
  vendedorId: string | null;
  miembros: Miembro[];
}) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<Campo, string | null>>({ setter_id: setterId, vendedor_id: vendedorId });
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function cambiar(campo: Campo, valor: string) {
    const nuevo = valor === SIN_ASIGNAR ? null : valor;
    const anterior = valores[campo];
    setError(null);
    setAviso(null);
    setValores((v) => ({ ...v, [campo]: nuevo }));
    empezar(async () => {
      try {
        const r = await fetch(`/api/v1/contacts/${contactoId}/asignacion`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [campo]: nuevo }),
        });
        const cuerpo = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) {
          setValores((v) => ({ ...v, [campo]: anterior }));
          return setError(cuerpo.error ?? "No se pudo guardar la asignación. Volvé a intentar.");
        }
        setAviso("Asignación guardada. Queda en el historial.");
        router.refresh();
      } catch {
        setValores((v) => ({ ...v, [campo]: anterior }));
        setError("No se pudo guardar: se perdió la conexión. Revisá internet y volvé a intentar.");
      }
    });
  }

  // Un id asignado que ya no es del equipo se muestra igual, para no mentir.
  const opciones = (actual: string | null) =>
    actual && !miembros.some((m) => m.id === actual) ? [...miembros, { id: actual, etiqueta: "Ya no está en el equipo" }] : miembros;

  const desplegable = (campo: Campo, etiqueta: string, ayuda: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground">{etiqueta}</span>
      <select
        aria-label={etiqueta}
        value={valores[campo] ?? SIN_ASIGNAR}
        disabled={pendiente}
        onChange={(e) => cambiar(campo, e.target.value)}
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      >
        <option value={SIN_ASIGNAR}>Sin asignar</option>
        {opciones(valores[campo]).map((m) => (
          <option key={m.id} value={m.id}>
            {m.etiqueta}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">{ayuda}</span>
    </label>
  );

  return (
    <div className="mt-4 max-w-xl">
      <div className="grid gap-3 sm:grid-cols-2">
        {desplegable("setter_id", "Setter", "Quien lo contacta")}
        {desplegable("vendedor_id", "Vendedor", "Quien lo cierra")}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Cambiar la asignación cambia al instante quién puede ver este contacto.</p>
      {aviso && (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400" role="status">
          {aviso}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
