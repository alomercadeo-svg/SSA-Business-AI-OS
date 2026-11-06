"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  X,
  Mail,
  Calendar,
  Tag,
  User,
  Hash,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform-icon";
import { SugerenciaUnion } from "@/components/inbox/sugerencia-union";
import { inicialDe, nombreVisible } from "@/lib/nombre-visible";
import { SelectorDeSeguimiento } from "@/components/inbox/selector-seguimiento";
import { enlaceAFicha, horaDelNegocio } from "@/lib/ficha";
import { nombreDePlataforma } from "@/lib/nombre-de-plataforma";
import type { Database, Platform } from "@/lib/types/database";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type TagRow = Database["public"]["Tables"]["tags"]["Row"];
type CustomFieldDef =
  Database["public"]["Tables"]["custom_field_definitions"]["Row"];
type CustomFieldValue =
  Database["public"]["Tables"]["contact_custom_fields"]["Row"];

export interface ContactDetails {
  contact: Contact;
  tags: TagRow[];
  customFields: { definition: CustomFieldDef; value: string }[];
  channels: {
    platform: Platform;
    platform_username: string | null;
    platform_sender_id: string;
  }[];
}

/** En hora de Costa Rica, como la ficha; sin fecha, «Nunca». */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  return horaDelNegocio(dateStr);
}

export function ContactPanel({
  contactId,
  workspaceId,
  zona = "America/Costa_Rica",
  volver = null,
  onClose,
  alGuardarSeguimiento,
}: {
  contactId: string | null;
  workspaceId: string;
  /** La dirección de la bandeja, para que la ficha vuelva a ella como estaba (tramo C de S8). */
  volver?: string | null;
  /** `workspaces.zona_horaria` (tramo C de S8): con la que se cuentan los días del seguimiento. */
  zona?: string;
  onClose: () => void;
  /** Después de guardar el próximo seguimiento: la bandeja vuelve a pedir la lista. */
  alGuardarSeguimiento?: (fecha: string | null) => void;
}) {
  const [loadedDetails, setDetails] = useState<ContactDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) return;

    async function loadContact() {
      setLoading(true);
      const supabase = createClient();

      const [contactRes, tagsRes, fieldsRes, channelsRes] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", contactId!).single(),
        supabase
          .from("contact_tags")
          .select("tag_id, tags(*)")
          .eq("contact_id", contactId!),
        supabase
          .from("contact_custom_fields")
          .select("*, custom_field_definitions(*)")
          .eq("contact_id", contactId!),
        supabase
          .from("contact_channels")
          .select("platform_username, platform_sender_id, channels(platform)")
          .eq("contact_id", contactId!),
      ]);

      if (contactRes.data) {
        const tags = (tagsRes.data ?? [])
          .map((ct) => ct.tags)
          .filter(Boolean) as TagRow[];

        const customFields = (fieldsRes.data ?? [])
          .map((cf) => ({
            definition: cf.custom_field_definitions as unknown as CustomFieldDef,
            value: cf.value,
          }))
          .filter((cf) => cf.definition);

        const channels = (channelsRes.data ?? []).map((cc) => ({
          platform: (cc.channels as unknown as { platform: Platform }).platform,
          platform_username: cc.platform_username,
          platform_sender_id: cc.platform_sender_id,
        }));

        setDetails({
          contact: contactRes.data,
          tags,
          customFields,
          channels,
        });
      }

      setLoading(false);
    }

    loadContact();
  }, [contactId, workspaceId]);

  if (!contactId) return null;

  const details =
    loadedDetails?.contact.id === contactId ? loadedDetails : null;

  return <VistaDelPanel cargando={loading} details={details} onClose={onClose} zona={zona} volver={volver} alGuardarSeguimiento={alGuardarSeguimiento} />;
}

/** Lo que dibuja el panel, sin la carga: así se puede probar con datos fijos. */
export function VistaDelPanel({
  cargando,
  details,
  onClose,
  zona = "America/Costa_Rica",
  volver = null,
  alGuardarSeguimiento,
}: {
  cargando: boolean;
  details: ContactDetails | null;
  onClose: () => void;
  zona?: string;
  volver?: string | null;
  alGuardarSeguimiento?: (fecha: string | null) => void;
}) {
  const loading = cargando;
  return (
    // F35, teléfono: a todo el ancho; desde `md`, la columna de 80 de siempre.
    <div className="flex h-full w-full shrink-0 flex-col border-border bg-background md:w-80 md:border-l">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h3 className="text-sm font-semibold">Datos del contacto</h3>
        <button
          onClick={onClose}
          aria-label="Cerrar los datos del contacto"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : details ? (
        <div className="flex-1 overflow-y-auto">
          {/* F29: «¿Es la misma persona?», si hay una sugerencia pendiente. */}
          <SugerenciaUnion contactoId={details.contact.id} />
          {/* Profile section */}
          <div className="flex flex-col items-center border-b border-border p-6">
            {/* El nombre y la foto abren la ficha (decidido por Marcos el 03/11/2026). */}
            <Link href={enlaceAFicha(details.contact.id, volver)} className="flex flex-col items-center rounded-md hover:opacity-80">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-semibold">
                {details.contact.avatar_url ? (
                  <img
                    src={details.contact.avatar_url}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  inicialDe(nombreVisible(details.contact, details.channels))
                )}
              </div>
              <p className="mt-3 text-sm font-semibold hover:underline">
                {nombreVisible(details.contact, details.channels)}
              </p>
            </Link>
            <Link
              href={enlaceAFicha(details.contact.id, volver)}
              className="mt-2 rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              Ver ficha completa
            </Link>
            {details.contact.email && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {details.contact.email}
              </p>
            )}
            <span
              className={cn(
                "mt-2 rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                details.contact.is_subscribed
                  ? "bg-green-100 text-green-700"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {details.contact.is_subscribed ? "Suscripto" : "Dado de baja"}
            </span>
          </div>

          {/* F35, tramo C de S8: el próximo seguimiento, sin abrir la ficha. Con
              `key`, el selector arranca de cero con cada contacto. */}
          <div className="border-b border-border p-4">
            <SelectorDeSeguimiento
              key={details.contact.id}
              contactoId={details.contact.id}
              fecha={details.contact.next_followup_date}
              zona={zona}
              alGuardar={alGuardarSeguimiento}
            />
          </div>

          {/* Details */}
          <div className="space-y-4 p-4">
            {/* Connected platforms */}
            {details.channels.length > 0 && (
              <div>
                <h4 className="text-xs font-medium uppercase text-muted-foreground">
                  Canales
                </h4>
                <div className="mt-2 space-y-1.5">
                  {details.channels.map((ch, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm"
                    >
                      <PlatformIcon
                        platform={ch.platform}
                        className="h-3.5 w-3.5"
                        size={14}
                      />
                      <span className="text-muted-foreground">
                        {nombreDePlataforma(ch.platform)}
                      </span>
                      {ch.platform_username && (
                        <span className="truncate text-foreground">
                          @{ch.platform_username}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email */}
            {details.contact.email && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  Correo
                </h4>
                <p className="mt-1 text-sm">{details.contact.email}</p>
              </div>
            )}

            {/* Last interaction */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Última interacción
              </h4>
              <p className="mt-1 text-sm">
                {formatDate(details.contact.last_interaction_at)}
              </p>
            </div>

            {/* Joined */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <User className="h-3 w-3" />
                Creado
              </h4>
              <p className="mt-1 text-sm">
                {formatDate(details.contact.created_at)}
              </p>
            </div>

            {/* Tags */}
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                <Tag className="h-3 w-3" />
                Etiquetas
              </h4>
              {details.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {details.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs"
                      style={
                        tag.color
                          ? {
                              backgroundColor: `${tag.color}20`,
                              borderColor: `${tag.color}40`,
                              color: tag.color,
                            }
                          : undefined
                      }
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Sin etiquetas</p>
              )}
            </div>

            {/* Custom fields */}
            {details.customFields.length > 0 && (
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  Campos propios
                </h4>
                <div className="mt-2 space-y-2">
                  {details.customFields.map((cf) => (
                    <div key={cf.definition.id}>
                      <p className="text-xs text-muted-foreground">
                        {cf.definition.name}
                      </p>
                      <p className="text-sm">{cf.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <PieDelPanel contactoId={details.contact.id} telefonoResuelto={details.contact.phone_resolved !== false} volver={volver} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No podés ver este contacto
        </div>
      )}
    </div>
  );
}

/**
 * El pie del panel (F35, criterio 31, agregado el 03/11/2026): con el teléfono
 * sin resolver, lo dice y lleva a la ficha, que es donde se carga (F26). «Ver
 * ficha completa» subió a quedar debajo del nombre (tramo C de S8).
 */
export function PieDelPanel({ contactoId, telefonoResuelto, volver = null }: { contactoId: string; telefonoResuelto: boolean; volver?: string | null }) {
  if (telefonoResuelto) return null;
  return (
    <div className="space-y-2 border-t border-border p-4">
      <Link
        href={enlaceAFicha(contactoId, volver)}
        className="block rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-center text-xs font-medium text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
      >
        Cargar teléfono en la ficha
      </Link>
    </div>
  );
}
