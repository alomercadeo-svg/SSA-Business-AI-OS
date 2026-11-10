"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { guardarReglasDeSeguridad } from "@/lib/actions/reglas-seguridad";
import type { ReglasDeSeguridad } from "@/lib/reglas-seguridad";

/**
 * Un control por regla, con su valor por defecto y una línea de para qué
 * sirve y qué pasa si se desactiva (§11). El opt-out no tiene control: no se
 * puede apagar.
 */
const DIAS = [
  { n: 1, t: "Lun" },
  { n: 2, t: "Mar" },
  { n: 3, t: "Mié" },
  { n: 4, t: "Jue" },
  { n: 5, t: "Vie" },
  { n: 6, t: "Sáb" },
  { n: 0, t: "Dom" },
];

const entrada = "rounded-lg border border-input bg-background px-2 py-1 text-sm";

function Regla({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-b border-border py-4 last:border-0">
      <p className="text-sm font-medium">{titulo}</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">{children}</div>
      <p className="text-xs text-muted-foreground">{ayuda}</p>
    </div>
  );
}

function Activa({ valor, onCambio }: { valor: boolean; onCambio: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <input type="checkbox" checked={valor} onChange={(e) => onCambio(e.target.checked)} /> Activa
    </label>
  );
}

const num = (v: string) => (v === "" ? NaN : Number(v));

export function FormularioDeReglas({ canalId, nombre, inicial }: { canalId: string; nombre: string; inicial: ReglasDeSeguridad }) {
  const [r, setR] = useState<ReglasDeSeguridad>(inicial);
  const [guardadas, setGuardadas] = useState(JSON.stringify(inicial));
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [pendiente, empezar] = useTransition();
  const cambiado = JSON.stringify(r) !== guardadas;
  const poner = <K extends keyof ReglasDeSeguridad>(k: K, v: Partial<ReglasDeSeguridad[K]>) => setR((x) => ({ ...x, [k]: { ...x[k], ...v } }));

  function guardar() {
    setAviso(null);
    empezar(async () => {
      const res = await guardarReglasDeSeguridad(canalId, r);
      if (!res.ok) return setAviso({ texto: res.error, error: true });
      setR(res.reglas);
      setGuardadas(JSON.stringify(res.reglas));
      setAviso({ texto: "Reglas guardadas. Queda en el historial.", error: false });
    });
  }

  return (
    <section className="rounded-lg border border-border px-4">
      <h2 className="pt-4 text-base font-semibold">{nombre}</h2>

      <Regla
        titulo="Corte con el silencio"
        ayuda="La secuencia se detiene sola después de esa cantidad de seguimientos sin respuesta. Es la protección más importante: el que nunca contesta y sigue recibiendo mensajes es el que denuncia. Si la apagás, un lead que no contesta sigue recibiendo seguimientos."
      >
        <Activa valor={r.corte_silencio.activo} onCambio={(v) => poner("corte_silencio", { activo: v })} />
        <label className="inline-flex items-center gap-1.5">
          Después de
          <input type="number" min={1} max={10} value={r.corte_silencio.seguimientos} onChange={(e) => poner("corte_silencio", { seguimientos: num(e.target.value) })} className={`${entrada} w-16`} />
          seguimientos sin respuesta
        </label>
      </Regla>

      <Regla
        titulo="Texto variable"
        ayuda="Rota entre las variantes de cada paso, con los datos del contacto, y avisa si el mismo texto va a muchas personas: es la huella de un envío masivo. Si la apagás, todos reciben la primera variante."
      >
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={r.texto_variable.rotar} onChange={(e) => poner("texto_variable", { rotar: e.target.checked })} /> Rotar variantes
        </label>
        <label className="inline-flex items-center gap-1.5">
          Avisar desde
          <input type="number" min={2} value={r.texto_variable.aviso_desde} onChange={(e) => poner("texto_variable", { aviso_desde: num(e.target.value) })} className={`${entrada} w-20`} />
          personas con el mismo texto
        </label>
      </Regla>

      <Regla
        titulo="Envíos espaciados"
        ayuda="Separa al azar los envíos de un mismo grupo. Si la apagás, salen todos juntos, que es lo que parece un envío masivo."
      >
        <Activa valor={r.espaciado.activo} onCambio={(v) => poner("espaciado", { activo: v })} />
        <label className="inline-flex items-center gap-1.5">
          Entre
          <input type="number" min={0} max={3600} value={r.espaciado.min_segundos} onChange={(e) => poner("espaciado", { min_segundos: num(e.target.value) })} className={`${entrada} w-20`} />y
          <input type="number" min={0} max={3600} value={r.espaciado.max_segundos} onChange={(e) => poner("espaciado", { max_segundos: num(e.target.value) })} className={`${entrada} w-20`} />
          segundos
        </label>
      </Regla>

      <Regla
        titulo="Horario comercial"
        ayuda="Fuera de este horario el envío se pospone, no se cancela. Se usa la zona horaria del negocio: los contactos todavía no tienen una propia. Si la apagás, se puede mandar de madrugada."
      >
        <Activa valor={r.horario.activo} onCambio={(v) => poner("horario", { activo: v })} />
        <label className="inline-flex items-center gap-1.5">
          De
          <input type="time" value={r.horario.desde} onChange={(e) => poner("horario", { desde: e.target.value })} className={entrada} />a
          <input type="time" value={r.horario.hasta} onChange={(e) => poner("horario", { hasta: e.target.value })} className={entrada} />
        </label>
        <div className="flex flex-wrap gap-2">
          {DIAS.map((d) => (
            <label key={d.n} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={r.horario.dias.includes(d.n)}
                onChange={(e) => poner("horario", { dias: e.target.checked ? [...r.horario.dias, d.n].sort((a, b) => a - b) : r.horario.dias.filter((x) => x !== d.n) })}
              />
              {d.t}
            </label>
          ))}
        </div>
      </Regla>

      <Regla titulo="No contactar" ayuda="Si el contacto escribe una frase de baja o lo marcás a mano, no se le vuelve a escribir.">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Siempre activo. Un pedido de no contacto corta para siempre, sin opción de forzarlo. No se puede apagar.</span>
      </Regla>

      <Regla
        titulo="Proporción de respuesta"
        ayuda="Avisa si de los últimos seguimientos responde menos que este porcentaje: es la alarma temprana, y una de las señales que mira Meta. Todavía no hay seguimientos automáticos por WhatsApp: el número aparece cuando la Fase 2 los mande."
      >
        <label className="inline-flex items-center gap-1.5">
          Avisar si responde menos del
          <input type="number" min={1} max={100} value={r.proporcion.umbral_porcentaje} onChange={(e) => poner("proporcion", { umbral_porcentaje: num(e.target.value) })} className={`${entrada} w-16`} />%
        </label>
        <label className="inline-flex items-center gap-1.5">
          de los últimos
          <input type="number" min={10} max={1000} value={r.proporcion.muestra} onChange={(e) => poner("proporcion", { muestra: num(e.target.value) })} className={`${entrada} w-20`} />
          seguimientos
        </label>
      </Regla>

      <div className="flex items-center gap-3 py-4">
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
    </section>
  );
}
