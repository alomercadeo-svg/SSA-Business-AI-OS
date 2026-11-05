"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { conConversacion } from "@/lib/direccion-bandeja";
import { enlaceAFicha } from "@/lib/ficha";

/**
 * F40 (S9, tramo A): el bloque que reemplaza al campo de respuesta cuando la
 * ventana de Instagram está cerrada. Los textos son los de §11 del plano
 * (docs/requerimientos-fase1.md, «Ventana de Instagram cerrada (F40)») y de
 * los criterios de F40; el del teléfono sin resolver es D7 (decidido el
 * 05/11/2026). «Escribir por WhatsApp» solo abre una conversación de WhatsApp
 * que ya existe: contestar en ella es F42.
 */

const TEXTO_SIN_CONVERSACION =
  "Escribile primero desde WhatsApp Business en el teléfono. La conversación aparece acá en cuanto se guarde el mensaje.";
const TEXTO_SIN_TELEFONO = "No tiene teléfono cargado. Si te lo pasa, podés seguir por WhatsApp.";

/** La dirección de la bandeja con esa conversación abierta (`?conversacion=`, F30). */
function enlaceALaConversacion(volver: string | null, id: string): string {
  return conConversacion(new URL(volver ?? "/dashboard/inbox", "http://bandeja.local").href, id);
}

export function VistaVentanaCerrada({
  volver,
  contactoId,
  conversacionWa,
  telefono,
  telefonoResuelto,
}: {
  volver: string | null;
  contactoId: string | null;
  /** La conversación de WhatsApp del contacto; null si no tiene; undefined mientras se busca. */
  conversacionWa: string | null | undefined;
  telefono: string | null;
  telefonoResuelto: boolean;
}) {
  let debajo: React.ReactNode = null;
  if (conversacionWa) {
    debajo = (
      <Link
        href={enlaceALaConversacion(volver, conversacionWa)}
        className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        Escribir por WhatsApp
      </Link>
    );
  } else if (conversacionWa === null) {
    if (telefono && telefonoResuelto) debajo = <span className="text-xs text-muted-foreground">{TEXTO_SIN_CONVERSACION}</span>;
    else if (telefono && contactoId)
      debajo = (
        <span className="text-xs text-muted-foreground">
          El teléfono está sin resolver:{" "}
          <Link href={enlaceAFicha(contactoId, volver)} className="font-medium text-foreground underline">
            cargalo en la ficha
          </Link>{" "}
          para seguir por WhatsApp.
        </span>
      );
    else debajo = <span className="text-xs text-muted-foreground">{TEXTO_SIN_TELEFONO}</span>;
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
        Pasaron 24 horas desde el último mensaje: escribile desde la app de Instagram.
      </p>
      <p className="text-xs text-amber-800 dark:text-amber-200">
        Instagram no deja que el sistema envíe después de 24 horas. Lo que escribas desde la app queda registrado igual en esta conversación.
      </p>
      {debajo}
    </div>
  );
}

/**
 * El bloque, con la búsqueda de la conversación de WhatsApp del contacto: con
 * el cliente del usuario, así que pasa por la seguridad por filas. Si tiene
 * más de una, la del último mensaje más reciente (D10).
 */
export function BloqueVentanaCerrada({
  volver,
  contactoId,
  telefono,
  telefonoResuelto,
}: {
  volver: string | null;
  contactoId: string | null;
  telefono: string | null;
  telefonoResuelto: boolean;
}) {
  // Lo encontrado, con el contacto al que corresponde: mientras se busca el de
  // ahora (o si cambió de contacto), queda en undefined.
  const [encontrada, setEncontrada] = useState<{ contacto: string; id: string | null } | null>(null);
  const conversacionWa = !contactoId ? null : encontrada?.contacto === contactoId ? encontrada.id : undefined;
  useEffect(() => {
    if (!contactoId) return;
    let vigente = true;
    void (async () => {
      const { data } = await createClient()
        .from("conversations")
        .select("id")
        .eq("contact_id", contactoId)
        .eq("platform", "whatsapp")
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1);
      if (vigente) setEncontrada({ contacto: contactoId, id: (data?.[0] as { id?: string } | undefined)?.id ?? null });
    })();
    return () => {
      vigente = false;
    };
  }, [contactoId]);
  return (
    <VistaVentanaCerrada
      volver={volver}
      contactoId={contactoId}
      conversacionWa={conversacionWa}
      telefono={telefono}
      telefonoResuelto={telefonoResuelto}
    />
  );
}
