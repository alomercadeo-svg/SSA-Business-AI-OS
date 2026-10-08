"use client";

/**
 * El bloque «Teléfono sin resolver» de la ficha (F26, §11 «Ficha de
 * contacto»): el campo para cargar el número a mano y, si ese número ya es de
 * otro contacto, la propuesta de fusión con los dos lados. La fusión la
 * confirma la persona; nunca es automática. Los textos son los del prototipo
 * aprobado el 06/10/2026.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cargarTelefono, fusionarContactos, type ResultadoTelefono, type ResumenContacto } from "@/lib/actions/contactos";

type Conflicto = Extract<ResultadoTelefono, { resultado: "conflicto" }>;

function Lado({ titulo, c }: { titulo: string; c: ResumenContacto }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border p-3 text-sm">
      <p className="text-xs font-medium uppercase text-muted-foreground">{titulo}</p>
      <p className="mt-1 font-semibold">{c.nombre}</p>
      <dl className="mt-2 space-y-1 text-xs">
        <div><dt className="inline text-muted-foreground">Teléfono: </dt><dd className="inline">{c.telefono ?? "sin resolver"}</dd></div>
        <div><dt className="inline text-muted-foreground">Correo: </dt><dd className="inline">{c.correo ?? "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Canales: </dt><dd className="inline">{c.canales.length ? c.canales.join(", ") : "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Conversaciones: </dt><dd className="inline">{c.conversaciones}</dd></div>
        <div><dt className="inline text-muted-foreground">Etiquetas: </dt><dd className="inline">{c.etiquetas.length ? c.etiquetas.join(", ") : "—"}</dd></div>
      </dl>
    </div>
  );
}

export function TelefonoSinResolver({ contactoId }: { contactoId: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<Conflicto | null>(null);
  const [pendiente, empezar] = useTransition();

  function guardar() {
    setError(null);
    setAviso(null);
    empezar(async () => {
      const r = await cargarTelefono(contactoId, texto);
      if (!r.ok) return setError(r.error);
      if (r.resultado === "conflicto") return setConflicto(r);
      setAviso("Teléfono guardado. Queda en el historial.");
      router.refresh();
    });
  }

  function unir() {
    if (!conflicto?.otro) return;
    setError(null);
    empezar(async () => {
      const r = await fusionarContactos(conflicto.otro!.id, contactoId);
      if (!r.ok) return setError(r.error);
      router.push(`/dashboard/contacts/${r.conservado}?unidos=1`);
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4" role="region" aria-label="Teléfono sin resolver">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Teléfono sin resolver</p>
      <p className="mt-1 text-sm text-muted-foreground">WhatsApp entregó este contacto sin su número. Si lo conocés, cargalo acá.</p>

      {!conflicto && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="+506 7034 9182"
            aria-label="Teléfono"
            inputMode="tel"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={pendiente || !texto.trim()}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pendiente ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}

      {conflicto && !conflicto.visible && (
        <div className="mt-3 text-sm">
          <p>Ya existe otro contacto con el teléfono {conflicto.telefono}, a cargo de otra persona del equipo.</p>
          <p className="mt-1 text-muted-foreground">No se guardó, para no duplicarlo. Pedile a un Owner o Admin que los una.</p>
          <button type="button" onClick={() => setConflicto(null)} className="mt-2 text-sm underline">
            Volver
          </button>
        </div>
      )}

      {conflicto && conflicto.visible && conflicto.este && conflicto.otro && (
        <div className="mt-3">
          <p className="text-sm font-medium">¿Es la misma persona?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ya existe otro contacto con el teléfono {conflicto.telefono}. Si las unís, quedan juntas las conversaciones, notas,
            etiquetas y el origen, y queda en el historial.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Lado titulo="Este contacto" c={conflicto.este} />
            <Lado titulo="El que ya tiene ese teléfono (queda)" c={conflicto.otro} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setConflicto(null);
                setAviso("Listo: no se guardó el teléfono.");
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              No es la misma
            </button>
            {conflicto.puedeUnir ? (
              <button
                type="button"
                onClick={unir}
                disabled={pendiente}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {pendiente ? "Uniendo…" : "Unir contactos"}
              </button>
            ) : (
              <p className="self-center text-sm text-muted-foreground">Pedile a un Owner o Admin que los una.</p>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {aviso && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400" role="status">{aviso}</p>}
    </div>
  );
}
