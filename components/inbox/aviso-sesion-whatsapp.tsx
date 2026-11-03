"use client";

/**
 * El aviso de WhatsApp caído arriba de la bandeja (F32, criterio 6): una
 * bandeja silenciosa no puede parecer un día tranquilo.
 *
 * Aparece con la sesión caída o con «se agotaron los intentos». No con «sin
 * vincular» (decisión de Marcos del 02/11/2026) ni con «no se pudo verificar»,
 * que no es una caída. Los textos son los del prototipo aprobado, sin «Se avisó
 * por correo»: el espacio real no tiene clave de Resend, y no siempre sería
 * cierto.
 *
 * Arranca con lo que leyó el servidor y se vuelve a leer cada 60 segundos con
 * el cliente del navegador: `channels` se lee con la seguridad por filas, y
 * todos los miembros del espacio pueden leerla (00002). El botón a Canales lo
 * ven Owner y Admin, que son los que pueden reconectar.
 *
 * F35 REESCRIBE LA BANDEJA ENTERA (S8) Y TIENE QUE CONSERVAR ESTE AVISO: está
 * montado en `app/(dashboard)/dashboard/inbox/page.tsx`, arriba de `InboxView`.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { haceCuanto } from "@/lib/tareas-estado";
import type { SesionEstado } from "@/lib/types/database";
import { COLUMNAS_DEL_AVISO, type CanalDeSesion } from "@/lib/sesion-whatsapp-pantalla";

const CADA_MS = 60_000;

export function canalesCaidos<T extends { session_state: SesionEstado | null }>(canales: T[]): T[] {
  return canales.filter((c) => c.session_state === "caido" || c.session_state === "agotado");
}

export function AvisoSesionWhatsapp({ inicial, esManager }: { inicial: CanalDeSesion[]; esManager: boolean }) {
  const [canales, setCanales] = useState(inicial);

  useEffect(() => {
    const supabase = createClient();
    const id = setInterval(async () => {
      const { data } = await supabase
        .from("channels")
        .select(COLUMNAS_DEL_AVISO)
        .eq("provider", "evolution")
        .eq("is_active", true);
      if (data) setCanales(data as CanalDeSesion[]);
    }, CADA_MS);
    return () => clearInterval(id);
  }, []);

  const caidos = canalesCaidos(canales);
  if (caidos.length === 0) return null;

  return (
    <div className="shrink-0 space-y-2 border-b border-red-300 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      {caidos.map((c) => {
        const nombre = c.display_name || c.instance_name || "WhatsApp";
        const agotado = c.session_state === "agotado";
        return (
          <div key={c.id} className="flex items-start gap-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1">
              {agotado ? (
                <>
                  <strong>WhatsApp quedó desvinculado</strong> ({nombre}) y se agotaron los intentos de vinculación. Hay que
                  vincular el número de nuevo. Mientras tanto, lo que le escriban no llega a la bandeja.
                </>
              ) : (
                <>
                  <strong>WhatsApp no está recibiendo mensajes</strong> ({nombre})
                  {c.session_changed_at ? ` desde ${haceCuanto(c.session_changed_at)}` : ""}. Mientras tanto, lo que le
                  escriban no llega a la bandeja.
                </>
              )}
            </p>
            {esManager && (
              <Link
                href="/dashboard/channels"
                className="shrink-0 rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                {agotado ? "Ver qué hacer" : "Reconectar"}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
