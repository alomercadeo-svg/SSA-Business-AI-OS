"use client";

/**
 * «¿Es la misma persona?» en el panel del contacto de la bandeja (F29, §11).
 * Explica qué coincide y ofrece «Ver y unir» y «No es la misma». «Ver y unir»
 * abre la comparación lado a lado; «Unir contactos» es solo de Owner y Admin
 * (la fusión de F26 lo exige en la base). Los textos son los de §11.
 *
 * Al unir queda el contacto que ya estaba, y el que llegó se absorbe: sus
 * conversaciones, notas, etiquetas y origen pasan al que queda.
 *
 * Revisión del 20/10/2026: el texto depende de desde qué contacto se mira; si
 * el que se mira es el absorbido, la bandeja se recarga sin conversación
 * elegida (la suya puede haber pasado al otro, o haberse unido y borrado); y
 * después de unir se vuelve a pedir la lista, porque la fusión borra también
 * las otras sugerencias del absorbido.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  descartarSugerencia,
  fusionarContactos,
  sugerenciasDe,
  type ResumenContacto,
  type SugerenciaDeUnion,
} from "@/lib/actions/contactos";

function Lado({ titulo, c }: { titulo: string; c: ResumenContacto }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border p-3 text-sm">
      <p className="text-xs font-medium uppercase text-muted-foreground">{titulo}</p>
      <p className="mt-1 font-semibold">{c.nombre}</p>
      <dl className="mt-2 space-y-1 text-xs">
        <div><dt className="inline text-muted-foreground">Teléfono: </dt><dd className="inline">{c.telefono ?? "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Correo: </dt><dd className="inline">{c.correo ?? "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Canales: </dt><dd className="inline">{c.canales.length ? c.canales.join(", ") : "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Conversaciones: </dt><dd className="inline">{c.conversaciones}</dd></div>
        <div><dt className="inline text-muted-foreground">Etiquetas: </dt><dd className="inline">{c.etiquetas.length ? c.etiquetas.join(", ") : "—"}</dd></div>
      </dl>
    </div>
  );
}

function explicacion(s: SugerenciaDeUnion, contactoId: string): string {
  const desdeElNuevo = s.nuevo.id === contactoId;
  const otro = desdeElNuevo ? s.existente : s.nuevo;
  if (s.motivo === "usuario") {
    return `«${otro.nombre}» tiene el mismo usuario${s.dato ? ` (@${s.dato})` : ""} en otro canal. Coincide solo el usuario, así que no se unen solas.`;
  }
  // El motivo «teléfono»: el que llegó es un contacto de WhatsApp sin número
  // propio, y el número que trajo después ya era del otro.
  return desdeElNuevo
    ? `«${otro.nombre}» ya tiene este teléfono${s.dato ? ` (${s.dato})` : ""}. WhatsApp lo entregó después, así que no se unen solas.`
    : `«${otro.nombre}» escribió por WhatsApp con este mismo teléfono${s.dato ? ` (${s.dato})` : ""}. No se unen solas.`;
}

export function SugerenciaUnion({ contactoId }: { contactoId: string }) {
  const router = useRouter();
  const [sugerencias, setSugerencias] = useState<SugerenciaDeUnion[]>([]);
  const [abierta, setAbierta] = useState<SugerenciaDeUnion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  useEffect(() => {
    let vigente = true;
    sugerenciasDe(contactoId).then((s) => vigente && setSugerencias(s));
    return () => {
      vigente = false;
    };
  }, [contactoId]);

  const sacar = (id: string) => setSugerencias((xs) => xs.filter((x) => x.id !== id));

  function noEsLaMisma(s: SugerenciaDeUnion) {
    setError(null);
    empezar(async () => {
      const r = await descartarSugerencia(s.id);
      if (!r.ok) return setError(r.error);
      sacar(s.id);
      setAbierta(null);
      setAviso("Listo: no se vuelve a sugerir.");
    });
  }

  function unir(s: SugerenciaDeUnion) {
    setError(null);
    empezar(async () => {
      const r = await fusionarContactos(s.existente.id, s.nuevo.id);
      if (!r.ok) return setError(r.error);
      setAbierta(null);
      if (s.nuevo.id === contactoId) {
        // El contacto de este panel ya no existe: la bandeja vuelve sin
        // conversación elegida, en vez de quedar apuntando a la absorbida.
        window.location.assign("/dashboard/inbox");
        return;
      }
      setAviso("Contactos unidos. Queda en el historial.");
      setSugerencias(await sugerenciasDe(contactoId));
      router.refresh();
    });
  }

  if (sugerencias.length === 0 && !aviso) return null;

  return (
    <div className="space-y-2 border-b border-border p-4">
      {aviso && <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{aviso}</p>}
      {sugerencias.map((s) => (
        <div key={s.id} className="space-y-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40">
          <p className="font-medium">¿Es la misma persona?</p>
          <p className="text-muted-foreground">{explicacion(s, contactoId)}</p>
          <div className="flex gap-2">
            <button type="button" disabled={pendiente} onClick={() => setAbierta(s)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
              Ver y unir
            </button>
            <button type="button" disabled={pendiente} onClick={() => noEsLaMisma(s)} className="rounded-lg border border-input px-3 py-1.5 text-xs disabled:opacity-60">
              No es la misma
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

      {abierta && (
        <div role="dialog" aria-label="¿Es la misma persona?" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl space-y-3 rounded-xl bg-background p-5 shadow-xl">
            <h3 className="text-base font-semibold">¿Es la misma persona?</h3>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Lado titulo="El que ya estaba (queda)" c={abierta.existente} />
              <Lado titulo="El que llegó" c={abierta.nuevo} />
            </div>
            <p className="text-xs text-muted-foreground">
              Si las unís, quedan juntas las conversaciones, notas, etiquetas y el origen, y queda en el historial.
            </p>
            {!abierta.puedeUnir && <p className="text-xs text-muted-foreground">Unir contactos es de Owner y Admin. Pediles que lo hagan.</p>}
            {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pendiente} onClick={() => noEsLaMisma(abierta)} className="rounded-lg border border-input px-3 py-2 text-sm disabled:opacity-60">
                No es la misma
              </button>
              {abierta.puedeUnir && (
                <button type="button" disabled={pendiente} onClick={() => unir(abierta)} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  {pendiente ? "Uniendo…" : "Unir contactos"}
                </button>
              )}
              <button type="button" disabled={pendiente} onClick={() => setAbierta(null)} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
