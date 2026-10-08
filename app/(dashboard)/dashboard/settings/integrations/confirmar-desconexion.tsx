"use client";

import { useState, useTransition } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { confirmacionCoincide } from "@/lib/integraciones";
import { desconectarCuentaInstagram } from "@/lib/actions/integraciones";

interface Cuenta {
  id: string;
  username: string;
}

type Resultado = { ok: true } | { ok: false; error: string };

/**
 * Lo que hace el botón del diálogo, aparte para poder probarlo sin navegador:
 * si lo escrito no es el nombre de la cuenta, no llama a nada. El servidor lo
 * vuelve a comparar igual, con la misma función.
 */
export async function intentarDesconexion(
  cuenta: Cuenta,
  escrito: string,
  desconectar: (id: string, confirmacion: string) => Promise<Resultado> = desconectarCuentaInstagram
): Promise<Resultado> {
  if (!confirmacionCoincide(escrito, cuenta.username)) {
    return { ok: false, error: `Escribí ${cuenta.username} para confirmar.` };
  }
  return desconectar(cuenta.id, escrito);
}

const claseInput =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring";
const claseBoton =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

/**
 * La confirmación de «Desconectar» (F24): nombra la cuenta, advierte que los
 * mensajes entrantes dejan de llegar y pide escribir su nombre. El texto sigue
 * al prototipo aprobado el 06/10/2026, salvo en cómo se vuelve: el prototipo
 * dice "podés volver a activarlo desde Canales", pero desconectar borra la
 * cuenta en Zernio y «Activar» solo cambia la base, así que hay que conectarla
 * de nuevo.
 */
export function ConfirmarDesconexion({
  cuenta,
  onCerrar,
  onHecho,
}: {
  cuenta: Cuenta;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const coincide = confirmacionCoincide(texto, cuenta.username);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-background p-6">
        <h3 className="text-base font-semibold">Desconectar @{cuenta.username}</h3>
        <div className="flex gap-2 rounded-md bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Si desconectás <strong>@{cuenta.username}</strong>, los mensajes que le escriban por Instagram{" "}
            <strong>dejan de llegar</strong> a la bandeja.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Las conversaciones que ya están guardadas no se borran. Para volver a recibir mensajes de esta cuenta, hay que
          conectarla de nuevo desde Canales.
        </p>
        <label className="block space-y-1 text-xs font-medium text-muted-foreground">
          <span className="block">Escribí {cuenta.username} para confirmar</span>
          <input
            type="text"
            autoComplete="off"
            value={texto}
            placeholder={cuenta.username}
            onChange={(e) => {
              setTexto(e.target.value);
              setError(null);
            }}
            className={claseInput}
          />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={claseBoton} onClick={onCerrar} disabled={pendiente}>
            Cancelar
          </button>
          <button
            type="button"
            data-confirmar
            className={cn(claseBoton, "border-red-500/50 text-red-700 dark:text-red-400")}
            disabled={!coincide || pendiente}
            onClick={() =>
              iniciar(async () => {
                const r = await intentarDesconexion(cuenta, texto);
                if (r.ok) onHecho();
                else setError(r.error);
              })
            }
          >
            {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Desconectar @{cuenta.username}
          </button>
        </div>
      </div>
    </div>
  );
}
