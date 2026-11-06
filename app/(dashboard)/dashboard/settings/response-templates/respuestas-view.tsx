"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import { crearRespuestaRapida, editarRespuestaRapida, eliminarRespuestaRapida } from "@/lib/actions/respuestas-rapidas";
import { VARIABLES } from "@/lib/respuestas-rapidas";

/**
 * F36, Configuración › Respuestas rápidas: la lista y el formulario. Los
 * textos son los del prototipo aprobado (`docs/diseno/prototipo-fase1.html`,
 * «Respuestas rápidas»), con la columna «Nombre» que pide el criterio 2 (el
 * selector busca por nombre o atajo) y el prototipo no tenía.
 */
type Respuesta = { id: string; nombre: string; atajo: string; contenido: string };
type Edicion = { id: string | null; nombre: string; atajo: string; contenido: string };

const claseCampo =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function RespuestasRapidasView({ respuestas }: { respuestas: Respuesta[] }) {
  const router = useRouter();
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const nueva = () => {
    setError(null);
    setAviso(null);
    setEdicion({ id: null, nombre: "", atajo: "", contenido: "" });
  };

  const guardar = () => {
    if (!edicion) return;
    const datos = { nombre: edicion.nombre, atajo: edicion.atajo, contenido: edicion.contenido };
    empezar(async () => {
      const r = edicion.id ? await editarRespuestaRapida(edicion.id, datos) : await crearRespuestaRapida(datos);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEdicion(null);
      setError(null);
      setAviso("Respuesta rápida guardada");
      router.refresh();
    });
  };

  const eliminar = (r: Respuesta) => {
    if (!window.confirm(`¿Eliminar la respuesta rápida «${r.nombre}»? Deja de aparecer en la bandeja y se borra definitivamente a los 30 días.`)) return;
    empezar(async () => {
      const res = await eliminarRespuestaRapida(r.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setAviso("Respuesta rápida eliminada");
      router.refresh();
    });
  };

  const formulario = edicion && (
    <div className="mb-6 rounded-lg border border-border p-4 sm:p-6">
      <h2 className="text-base font-semibold">{edicion.id ? "Editar respuesta rápida" : "Nueva respuesta rápida"}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Nombre</span>
          <input
            className={`mt-1 ${claseCampo}`}
            value={edicion.nombre}
            maxLength={80}
            onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
            placeholder="Por ejemplo, Precios del curso"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Atajo</span>
          <div className="mt-1 flex items-center gap-1">
            <span className="font-mono text-muted-foreground">/</span>
            <input
              className={`${claseCampo} font-mono`}
              value={edicion.atajo}
              maxLength={31}
              onChange={(e) => setEdicion({ ...edicion, atajo: e.target.value })}
              placeholder="precios"
            />
          </div>
        </label>
      </div>
      <label className="mt-4 block text-sm">
        <span className="font-medium">Texto</span>
        <textarea
          className={`mt-1 ${claseCampo}`}
          rows={4}
          maxLength={2000}
          value={edicion.contenido}
          onChange={(e) => setEdicion({ ...edicion, contenido: e.target.value })}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          Datos que se completan solos: {VARIABLES.join(" · ")}. Si falta un dato, queda vacío.
        </span>
      </label>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={pendiente}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Guardar
        </button>
        <button type="button" onClick={() => setEdicion(null)} className="rounded-lg border border-border px-4 py-2 text-sm">
          Cancelar
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Respuestas rápidas</h1>
            <p className="mt-1 text-sm text-muted-foreground">Textos que se insertan en la bandeja escribiendo /. No son plantillas de WhatsApp.</p>
          </div>
          {respuestas.length > 0 && !edicion && (
            <button type="button" onClick={nueva} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Nueva respuesta rápida
            </button>
          )}
        </div>
        {aviso && <p className="mt-3 text-sm text-green-700 dark:text-green-400">{aviso}</p>}
        <div className="mt-6">{formulario}</div>

        {respuestas.length === 0 && !edicion ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <MessageSquareText className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Todavía no hay respuestas rápidas</p>
            <p className="mt-1 text-sm text-muted-foreground">Escribí una vez los textos que repetís seguido. Después los insertás en la bandeja escribiendo /.</p>
            <button type="button" onClick={nueva} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Nueva respuesta rápida
            </button>
          </div>
        ) : (
          respuestas.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Nombre</th>
                    <th className="px-4 py-2 font-medium">Atajo</th>
                    <th className="px-4 py-2 font-medium">Texto</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {respuestas.map((r) => (
                    <tr key={r.id} className="border-t border-border align-top">
                      <td className="px-4 py-3 font-medium">{r.nombre}</td>
                      <td className="px-4 py-3 font-mono">/{r.atajo}</td>
                      <td className="px-4 py-3 whitespace-pre-wrap text-muted-foreground">{r.contenido}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setError(null);
                              setAviso(null);
                              setEdicion({ id: r.id, nombre: r.nombre, atajo: r.atajo, contenido: r.contenido });
                            }}
                            className="rounded-md border border-border px-2.5 py-1 text-xs"
                          >
                            Editar
                          </button>
                          <button type="button" onClick={() => eliminar(r)} disabled={pendiente} className="rounded-md px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950">
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
