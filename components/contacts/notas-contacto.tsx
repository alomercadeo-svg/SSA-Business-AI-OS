"use client";

/**
 * Las notas de la ficha (F30), en orden cronológico, la más nueva arriba.
 *
 * Todo va con el cliente del navegador, directo a la base: es el mismo camino
 * que prueba `scripts/verify-notas.mjs` con el token de cada uno. La base
 * decide (00037): cualquiera que ve el contacto crea; edita el autor, un Admin
 * o el Owner; eliminar pasa por `eliminar_nota`. Los botones se muestran según
 * esas mismas reglas, pero no son la protección.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { horaDelNegocio } from "@/lib/ficha";

export interface NotaDeFicha {
  id: string;
  body: string;
  author_id: string | null;
  author_label: string | null;
  created_at: string;
  updated_at: string;
}

export function NotasContacto({
  contactoId,
  espacioId,
  notas,
  usuarioId,
  esManager,
}: {
  contactoId: string;
  espacioId: string;
  notas: NotaDeFicha[];
  usuarioId: string;
  esManager: boolean;
}) {
  const router = useRouter();
  const [nueva, setNueva] = useState("");
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const correr = (accion: () => PromiseLike<{ error: { message: string } | null }>, ok: string, despues?: () => void) => {
    setError(null);
    setAviso(null);
    empezar(async () => {
      try {
        const { error: e } = await accion();
        if (e) return setError("No se pudo guardar la nota. Volvé a intentar.");
        setAviso(ok);
        despues?.();
        router.refresh();
      } catch {
        setError("No se pudo guardar: se perdió la conexión. Revisá internet y volvé a intentar.");
      }
    });
  };

  const crear = () => {
    const body = nueva.trim();
    if (!body) return;
    correr(
      () => createClient().from("contact_notes").insert({ workspace_id: espacioId, contact_id: contactoId, body }),
      "Nota guardada",
      () => setNueva(""),
    );
  };
  const guardarEdicion = () => {
    if (!editando || !editando.texto.trim()) return;
    correr(
      () => createClient().from("contact_notes").update({ body: editando.texto.trim() }).eq("id", editando.id),
      "Nota editada",
      () => setEditando(null),
    );
  };
  const eliminar = (id: string) => correr(() => createClient().rpc("eliminar_nota", { p_nota: id }), "Nota eliminada.");

  return (
    <div className="space-y-3">
      {notas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay notas. Escribí la primera abajo: la ve todo el que puede ver este contacto.</p>
      ) : (
        <ul className="space-y-2">
          {notas.map((n) => {
            const puede = esManager || n.author_id === usuarioId;
            return (
              <li key={n.id} className="rounded-lg border border-border p-3 text-sm">
                {editando?.id === n.id ? (
                  <textarea
                    aria-label="Editar la nota"
                    rows={3}
                    value={editando.texto}
                    onChange={(e) => setEditando({ id: n.id, texto: e.target.value })}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{n.body}</p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {n.author_label ?? "Ex miembro"} · {horaDelNegocio(n.created_at)}
                    {n.updated_at !== n.created_at ? " · editada" : ""}
                  </span>
                  {puede &&
                    (editando?.id === n.id ? (
                      <>
                        <button type="button" disabled={pendiente} onClick={guardarEdicion} className="font-medium text-foreground hover:underline">
                          Guardar
                        </button>
                        <button type="button" disabled={pendiente} onClick={() => setEditando(null)} className="hover:underline">
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={pendiente} onClick={() => setEditando({ id: n.id, texto: n.body })} className="hover:underline">
                          Editar
                        </button>
                        <button type="button" disabled={pendiente} onClick={() => eliminar(n.id)} className="text-red-700 hover:underline dark:text-red-400">
                          Eliminar
                        </button>
                      </>
                    ))}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <textarea
        aria-label="Nueva nota"
        rows={2}
        placeholder="Agregar una nota…"
        value={nueva}
        onChange={(e) => setNueva(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pendiente || !nueva.trim()}
          onClick={crear}
          className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          Guardar nota
        </button>
        {aviso && <span className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{aviso}</span>}
        {error && <span className="text-sm text-red-700 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
