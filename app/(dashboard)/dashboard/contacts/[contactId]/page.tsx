import Link from "next/link";
import { esManager, getWorkspace } from "@/lib/workspace";
import { ArrowLeft } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { TelefonoSinResolver } from "@/components/contacts/telefono-sin-resolver";
import { AsignacionContacto } from "@/components/contacts/asignacion-contacto";
import { EliminarContacto } from "@/components/contacts/eliminar-contacto";
import { EditarContacto } from "@/components/contacts/editar-contacto";
import { NotasContacto, type NotaDeFicha } from "@/components/contacts/notas-contacto";
import { miembrosDelEspacio } from "@/lib/miembros";
import { etiquetaDeCanal, nombreDePlataforma, textoDeEvento } from "@/lib/auditoria";
import type { Atribucion } from "@/lib/atribucion";
import {
  agruparPorCanal,
  enlaceAlHilo,
  fechaSinHora,
  horaDelNegocio,
  resumenDeConversacion,
  textoDeToque,
  TEXTO_DE_TEMPERATURA,
  type ConversacionDeFicha,
} from "@/lib/ficha";

/**
 * La ficha de contacto (F30, §11 «Ficha de contacto»): dos columnas, a la
 * izquierda los datos y a la derecha conversaciones, notas e historial. En
 * teléfono se apilan, con los datos arriba.
 *
 * Todo se lee con el cliente del usuario: la seguridad por filas decide. Un
 * contacto fuera de su alcance, o eliminado (00038), no llega, y la ficha lo
 * dice en lenguaje claro en vez de un error de permisos (§11, Reglas).
 */
export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ unidos?: string }>;
}) {
  const { contactId } = await params;
  const { unidos } = await searchParams;
  const { workspace, supabase, role, user } = await getWorkspace();
  const manager = esManager(role);

  const [contactRes, channelsRes, conversationsRes, customFieldsRes, notasRes, historialRes, miembros] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, contact_tags(tag_id, tags(*))")
      .eq("id", contactId)
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("contact_channels")
      .select("id, platform_username, platform_sender_id, channels(platform, username, display_name, instance_name)")
      .eq("contact_id", contactId),
    supabase
      .from("conversations")
      .select("id, channel_id, status, last_message_at, last_message_preview, channels(id, platform, username, display_name, instance_name)")
      .eq("contact_id", contactId)
      .eq("workspace_id", workspace.id),
    supabase
      .from("contact_custom_fields")
      .select("value, custom_field_definitions(name, slug, type)")
      .eq("contact_id", contactId),
    supabase
      .from("contact_notes")
      .select("id, body, author_id, author_label, created_at, updated_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
    supabase
      .from("audit_log")
      .select("id, created_at, actor_label, action, entity_label, changes, detail")
      .eq("entity_type", "contacto")
      .eq("entity_id", contactId)
      .order("created_at", { ascending: false })
      .limit(50),
    miembrosDelEspacio(workspace.id),
  ]);

  if (!contactRes.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <h1 className="text-lg font-semibold">No podés ver este contacto</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          No existe, fue eliminado, o no está asignado a vos. Si lo estabas trabajando, pedile a un Owner o un Admin que te lo asigne.
        </p>
        <Link href="/dashboard/contacts" className="rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent">
          ← Volver a contactos
        </Link>
      </div>
    );
  }

  const contact = contactRes.data;
  const canales = channelsRes.data ?? [];
  const grupos = agruparPorCanal((conversationsRes.data ?? []) as unknown as ConversacionDeFicha[], etiquetaDeCanal);
  // El tipo del último mensaje de cada conversación: para un resumen vacío
  // (un video, una foto sin texto). Una consulta por conversación; un contacto
  // tiene pocas.
  const tipos = new Map<string, string | null>(
    await Promise.all(
      (conversationsRes.data ?? []).map(async (c) => {
        const { data } = await supabase
          .from("messages")
          .select("message_type")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        // Un mensaje sin tipo (de antes de F27) cuenta como «otro»: hay mensaje.
        return [c.id, data ? ((data as { message_type?: string | null }).message_type ?? "otro") : null] as [string, string | null];
      }),
    ),
  );
  const customFields = customFieldsRes.data ?? [];
  const notas = (notasRes.data ?? []) as NotaDeFicha[];
  const historial = historialRes.data ?? [];
  const tags = contact.contact_tags
    .map((ct: { tags: unknown }) => ct.tags)
    .filter(Boolean) as { id: string; name: string; color: string | null }[];
  const atribucion = (contact.attribution ?? {}) as Atribucion;
  const nombreDe = (id: string | null) => (id ? (miembros.find((m) => m.id === id)?.etiqueta ?? "Ya no está en el equipo") : "Sin asignar");
  const nombre = contact.display_name ?? "Sin nombre";

  const dato = (titulo: string, valor: React.ReactNode) => (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{titulo}</dt>
      <dd className="min-w-0 break-words">{valor ?? <span className="text-muted-foreground/60">—</span>}</dd>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border px-4 py-4 sm:px-8">
        <Link href="/dashboard/contacts" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Contactos
        </Link>
      </div>

      <div className="grid gap-6 px-4 py-6 sm:px-8 lg:grid-cols-2">
        {/* ── Izquierda: los datos ─────────────────────────────────────── */}
        <section className="min-w-0 space-y-5" aria-label="Datos del contacto">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
              {nombre.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{nombre}</h1>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {contact.do_not_contact && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">No contactar</span>
                )}
                {!contact.phone_resolved && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    Teléfono sin resolver
                  </span>
                )}
                {contact.lead_temperature && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{TEXTO_DE_TEMPERATURA[contact.lead_temperature] ?? contact.lead_temperature}</span>
                )}
              </div>
            </div>
          </div>

          {unidos === "1" && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
              Contactos unidos. Queda en el historial.
            </p>
          )}

          {contact.do_not_contact && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
              <p className="font-medium">Pidió no ser contactado</p>
              <p>
                {[contact.do_not_contact_reason, contact.do_not_contact_at ? horaDelNegocio(contact.do_not_contact_at) : null].filter(Boolean).join(" · ")}
                {". "}No se le puede escribir ni entra a secuencias.
              </p>
            </div>
          )}

          {!contact.phone_resolved && <TelefonoSinResolver contactoId={contact.id} />}

          <dl className="divide-y divide-border rounded-lg border border-border px-4 py-1">
            {dato("Correo", contact.email)}
            {dato("Correo secundario", contact.secondary_email)}
            {dato("Teléfono", contact.phone)}
            {contact.whatsapp_phone && contact.whatsapp_phone !== contact.phone ? dato("WhatsApp", contact.whatsapp_phone) : null}
            {dato("País", contact.country)}
            {dato(
              "Redes",
              canales.length ? (
                <ul className="space-y-0.5">
                  {canales.map((cc) => {
                    const ch = cc.channels as unknown as { platform?: string | null } | null;
                    return (
                      <li key={cc.id}>
                        {nombreDePlataforma(ch?.platform)}: {cc.platform_username ? `@${cc.platform_username}` : <span className="text-muted-foreground">sin usuario</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : null,
            )}
            {dato("Setter", nombreDe(contact.setter_id))}
            {dato("Vendedor", nombreDe(contact.vendedor_id))}
            {dato("Temperatura", contact.lead_temperature ? TEXTO_DE_TEMPERATURA[contact.lead_temperature] : "Sin definir")}
            {dato("Próximo seguimiento", fechaSinHora(contact.next_followup_date))}
            {contact.pipeline_stage ? dato("Etapa", `${contact.pipeline_stage}${contact.deal_status ? ` · ${contact.deal_status}` : ""}`) : null}
            {dato("Origen (primer clic)", textoDeToque(atribucion.first_click))}
            {dato("Origen (último clic)", textoDeToque(atribucion.last_click))}
            {dato(
              "Etiquetas",
              tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: tag.color ? `${tag.color}20` : "#3b82f620", color: tag.color ?? "#3b82f6" }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : null,
            )}
            {dato(
              "Campos propios",
              customFields.length ? (
                <ul className="space-y-0.5">
                  {customFields.map((cf, i) => (
                    <li key={i}>
                      {(cf.custom_field_definitions as unknown as { name?: string } | null)?.name ?? "Campo"}: {cf.value}
                    </li>
                  ))}
                </ul>
              ) : null,
            )}
            {dato("Última interacción", horaDelNegocio(contact.last_interaction_at))}
          </dl>

          <div className="flex flex-wrap items-start gap-3">
            <EditarContacto
              contactoId={contact.id}
              datos={{
                display_name: contact.display_name,
                email: contact.email,
                secondary_email: contact.secondary_email,
                phone: contact.phone,
                country: contact.country,
                lead_temperature: contact.lead_temperature,
                next_followup_date: contact.next_followup_date,
              }}
              asignacion={
                <AsignacionContacto
                  contactoId={contact.id}
                  setterId={contact.setter_id}
                  vendedorId={contact.vendedor_id}
                  miembros={miembros}
                />
              }
            />
            {/* Eliminar marca la fecha; solo Owner y Admin (la base lo exige igual). */}
            {manager && <EliminarContacto contactoId={contact.id} nombre={nombre} />}
          </div>
        </section>

        {/* ── Derecha: conversaciones, notas e historial ───────────────── */}
        <section className="min-w-0 space-y-6" aria-label="Conversaciones, notas e historial">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Conversaciones</h2>
            {grupos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {canales.length === 0 && !contact.phone && !contact.email
                  ? "Este contacto no tiene teléfono, correo ni usuario de Instagram: no hay forma de escribirle."
                  : "Todavía no hay conversaciones."}
              </p>
            ) : (
              <div className="space-y-4">
                {grupos.map((g) => (
                  <div key={g.canalId}>
                    <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <PlatformIcon platform={g.platform ?? ""} className="h-3.5 w-3.5" size={14} />
                      {g.etiqueta}
                    </p>
                    <div className="space-y-2">
                      {g.conversaciones.map((conv) => (
                        <Link
                          key={conv.id}
                          href={enlaceAlHilo(conv.id)}
                          className="block rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{conv.status === "closed" ? "Cerrada" : conv.status === "snoozed" ? "Pospuesta" : "Abierta"}</span>
                            <span>{horaDelNegocio(conv.last_message_at)}</span>
                          </div>
                          <p className="mt-0.5 truncate text-sm">{resumenDeConversacion(conv.last_message_preview, tipos.get(conv.id))}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Notas</h2>
            <NotasContacto contactoId={contact.id} espacioId={workspace.id} notas={notas} usuarioId={user.id} esManager={manager} />
          </div>

          <div>
            <h2 className="mb-1 text-sm font-semibold uppercase text-muted-foreground">Historial de cambios</h2>
            <p className="mb-3 text-xs text-muted-foreground">No se borra nunca.{manager ? "" : " Ves los cambios que hiciste vos."}</p>
            {historial.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {manager ? "Todavía no hay cambios registrados." : "Todavía no hiciste cambios en este contacto. Los de otras personas los ven Owner y Admin."}
              </p>
            ) : (
              <ol className="space-y-2">
                {historial.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="text-muted-foreground">{horaDelNegocio(h.created_at)}</span>
                    {" · "}
                    <span className="font-medium">{h.actor_label}</span>
                    {" · "}
                    {textoDeEvento(h)}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
