"use client";

/**
 * «Editar datos» de la ficha (F30): nombre, correo, correo secundario,
 * teléfono, país, temperatura y próximo seguimiento, con la ruta
 * `PATCH /api/v1/contacts/[id]` (la misma que llama `scripts/verify-ficha.mjs`).
 * Setter y vendedor van en el mismo panel con su pieza de F41
 * (`asignacion-contacto.tsx`), reubicada sin reescribirla, que guarda al elegir.
 *
 * Revisión del 20/10/2026:
 *   - Guardar compara contra los datos de CUANDO SE ABRIÓ el panel, no contra
 *     los de ahora: si mientras tanto la página se recargó (por ejemplo, al
 *     cambiar el setter) con un cambio de un compañero, no se lo pisa.
 *   - Si el teléfono ya es de otro contacto, muestra la propuesta de unión con
 *     los dos lados (F26), la misma de «Teléfono sin resolver».
 *   - Si algo falló a mitad de camino, recarga: lo que sí se guardó se ve.
 */
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TEMPERATURAS } from "@/lib/edicion-contacto";
import { TEXTO_DE_TEMPERATURA } from "@/lib/ficha";
import { cargarTelefono } from "@/lib/actions/contactos";
import { PropuestaDeUnion, type Conflicto } from "@/components/contacts/telefono-sin-resolver";

export interface DatosEditables {
  display_name: string | null;
  email: string | null;
  secondary_email: string | null;
  phone: string | null;
  country: string | null;
  lead_temperature: string | null;
  next_followup_date: string | null;
}

const CAMPOS: Array<{ campo: keyof DatosEditables; etiqueta: string; tipo?: string; ayuda?: string }> = [
  { campo: "display_name", etiqueta: "Nombre", ayuda: "El nombre que escribís a mano no lo pisa ninguna importación ni ningún mensaje." },
  { campo: "email", etiqueta: "Correo", tipo: "email" },
  { campo: "secondary_email", etiqueta: "Correo secundario", tipo: "email" },
  { campo: "phone", etiqueta: "Teléfono", tipo: "tel", ayuda: "Con el signo + y el código de país, por ejemplo +506 7034 9182." },
  { campo: "country", etiqueta: "País" },
  { campo: "next_followup_date", etiqueta: "Próximo seguimiento", tipo: "date" },
];

export function EditarContacto({
  contactoId,
  datos,
  asignacion,
}: {
  contactoId: string;
  datos: DatosEditables;
  /** La pieza de setter y vendedor de F41, tal cual. */
  asignacion: ReactNode;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<DatosEditables>(datos);
  // Los datos tal como estaban al abrir el panel: contra eso se calcula qué cambió.
  const [alAbrir, setAlAbrir] = useState<DatosEditables>(datos);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function guardar() {
    setError(null);
    setAviso(null);
    const cambios: Record<string, string | null> = {};
    for (const k of Object.keys(valores) as Array<keyof DatosEditables>) {
      const nuevo = (valores[k] ?? "").trim();
      const antes = (alAbrir[k] ?? "").trim();
      if (nuevo !== antes) cambios[k] = nuevo === "" ? null : nuevo;
    }
    if (Object.keys(cambios).length === 0) {
      setAbierto(false);
      return;
    }
    empezar(async () => {
      try {
        const r = await fetch(`/api/v1/contacts/${contactoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cambios),
        });
        const cuerpo = (await r.json().catch(() => ({}))) as { error?: string; aviso?: string; guardado?: string[] };
        if (!r.ok) {
          // Lo que sí se guardó antes del error, que se vea.
          if (r.status === 409 || r.status >= 500) router.refresh();
          if (r.status === 409 && valores.phone) {
            const c = await cargarTelefono(contactoId, valores.phone);
            if (c.ok && c.resultado === "conflicto") {
              setConflicto(c);
              const otros = (cuerpo.guardado ?? []).length;
              return setError(otros ? "El teléfono no se guardó: ya es de otro contacto. Lo demás quedó guardado." : null);
            }
          }
          return setError(cuerpo.error ?? "No se pudo guardar. Volvé a intentar.");
        }
        setAviso(cuerpo.aviso ? `Datos guardados. ${cuerpo.aviso}` : "Datos guardados. Queda en el historial.");
        setAbierto(false);
        router.refresh();
      } catch {
        setError("No se pudo guardar: se perdió la conexión. Revisá internet y volvé a intentar.");
      }
    });
  }

  if (!abierto) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            setValores(datos);
            setAlAbrir(datos);
            setConflicto(null);
            setAbierto(true);
          }}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Editar datos
        </button>
        {aviso && <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{aviso}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Editar datos</h3>
      {CAMPOS.map(({ campo, etiqueta, tipo, ayuda }) => (
        <label key={campo} className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium uppercase text-muted-foreground">{etiqueta}</span>
          <input
            type={tipo ?? "text"}
            value={valores[campo] ?? ""}
            onChange={(e) => setValores((v) => ({ ...v, [campo]: e.target.value }))}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {ayuda && <span className="text-xs text-muted-foreground">{ayuda}</span>}
        </label>
      ))}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium uppercase text-muted-foreground">Temperatura</span>
        <select
          value={valores.lead_temperature ?? ""}
          onChange={(e) => setValores((v) => ({ ...v, lead_temperature: e.target.value }))}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Sin definir</option>
          {TEMPERATURAS.map((t) => (
            <option key={t} value={t}>
              {TEXTO_DE_TEMPERATURA[t]}
            </option>
          ))}
        </select>
      </label>
      {asignacion}
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      {conflicto && (
        <PropuestaDeUnion
          contactoId={contactoId}
          conflicto={conflicto}
          onCerrar={(texto) => {
            setConflicto(null);
            setValores((v) => ({ ...v, phone: alAbrir.phone }));
            if (texto) setError(texto);
          }}
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pendiente}
          onClick={guardar}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
          className="rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
