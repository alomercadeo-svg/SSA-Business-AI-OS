"use server";

/**
 * Acciones de la ficha del contacto para F26: cargar a mano un teléfono que
 * WhatsApp no entregó (la tercera vía de reconciliación, la que garantiza que
 * el caso nunca queda trabado) y, si ese teléfono ya es de otro contacto,
 * confirmar la fusión.
 *
 * Las dos escrituras las hacen funciones SQL (00031), que escriben el cambio y
 * su registro en el historial en una sola operación, y que deciden el permiso
 * en la base: la reconciliación, quien ve el contacto; la fusión, solo Owner y
 * Admin. Estas acciones corren con el cliente del usuario, así que la base sabe
 * quién es.
 *
 * Ninguna manda correo.
 */
import { revalidatePath } from "next/cache";
import { getWorkspaceOrNull, esManager } from "@/lib/workspace";
import { motivoTelefonoInvalido, normalizarTelefono } from "@/lib/telefono";

export interface ResumenContacto {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  canales: string[];
  conversaciones: number;
  etiquetas: string[];
  creado: string;
}

export type ResultadoTelefono =
  | { ok: true; resultado: "resuelto" | "sin_cambios" }
  | {
      ok: true;
      resultado: "conflicto";
      /** Si quien carga puede ver el otro contacto. Si no, no se manda ningún dato suyo. */
      visible: boolean;
      puedeUnir: boolean;
      telefono: string;
      este?: ResumenContacto;
      otro?: ResumenContacto;
    }
  | { ok: false; error: string };

const SIN_CONEXION = "No se pudo guardar: se perdió la conexión. Revisá internet y volvé a intentar.";

type Contexto = NonNullable<Awaited<ReturnType<typeof getWorkspaceOrNull>>>;

async function resumen(supabase: Contexto["supabase"], id: string): Promise<ResumenContacto | undefined> {
  const [{ data: c }, { data: canales }, { count }, { data: etiquetas }] = await Promise.all([
    supabase.from("contacts").select("id, display_name, phone, email, created_at").eq("id", id).maybeSingle(),
    supabase.from("contact_channels").select("platform_username, platform_sender_id, channels(platform)").eq("contact_id", id),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("contact_id", id),
    supabase.from("contact_tags").select("tags(name)").eq("contact_id", id),
  ]);
  if (!c) return undefined;
  return {
    id: c.id,
    nombre: c.display_name ?? "Sin nombre",
    telefono: c.phone,
    correo: c.email,
    canales: (canales ?? []).map((x) => {
      const plataforma = (x.channels as { platform?: string } | null)?.platform ?? "canal";
      return `${plataforma} · ${x.platform_username ? `@${x.platform_username}` : x.platform_sender_id}`;
    }),
    conversaciones: count ?? 0,
    etiquetas: (etiquetas ?? []).map((t) => (t.tags as { name?: string } | null)?.name).filter((n): n is string => Boolean(n)),
    creado: c.created_at,
  };
}

/** Carga a mano el teléfono de un contacto (F26, tercera vía). */
export async function cargarTelefono(contactoId: string, texto: string): Promise<ResultadoTelefono> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };

  const telefono = normalizarTelefono(texto);
  if (!telefono) return { ok: false, error: motivoTelefonoInvalido(texto) };

  const { data, error } = await contexto.supabase.rpc("reconciliar_telefono", {
    p_contacto: contactoId,
    p_telefono: telefono,
    p_via: "manual",
  });
  if (error) {
    if (error.code === "42501" || error.code === "P0002") {
      return { ok: false, error: "Este contacto ya no está a tu cargo, o no existe. Volvé a la lista de contactos." };
    }
    console.error("[contactos] reconciliar_telefono:", error.message);
    return { ok: false, error: SIN_CONEXION };
  }

  const r = (data ?? {}) as { resultado?: string; visible?: boolean; otro_id?: string | null };
  if (r.resultado === "conflicto") {
    const puedeUnir = esManager(contexto.role);
    if (!r.visible || !r.otro_id) {
      return { ok: true, resultado: "conflicto", visible: false, puedeUnir: false, telefono };
    }
    const [este, otro] = await Promise.all([resumen(contexto.supabase, contactoId), resumen(contexto.supabase, r.otro_id)]);
    return { ok: true, resultado: "conflicto", visible: true, puedeUnir, telefono, este, otro };
  }

  revalidatePath(`/dashboard/contacts/${contactoId}`);
  revalidatePath("/dashboard/contacts");
  return { ok: true, resultado: r.resultado === "sin_cambios" ? "sin_cambios" : "resuelto" };
}

/**
 * Une dos contactos. La confirma una persona, nunca es automática, y solo
 * Owner y Admin (decidido el 07/10/2026: borra un contacto). El que queda es
 * el que ya tenía el teléfono; el que estaba sin resolver se absorbe.
 */
export async function fusionarContactos(
  conservarId: string,
  absorberId: string
): Promise<{ ok: true; conservado: string } | { ok: false; error: string }> {
  const contexto = await getWorkspaceOrNull();
  if (!contexto) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  if (!esManager(contexto.role)) return { ok: false, error: "Unir contactos es de Owner y Admin. Pediles que lo hagan." };

  const { error } = await contexto.supabase.rpc("fusionar_contactos", {
    p_conservar: conservarId,
    p_absorber: absorberId,
  });
  if (error) {
    console.error("[contactos] fusionar_contactos:", error.message);
    if (error.code === "42501") return { ok: false, error: "Unir contactos es de Owner y Admin." };
    if (error.code === "P0002") return { ok: false, error: "Alguno de los dos contactos ya no existe. Recargá la pantalla." };
    return { ok: false, error: "No se pudieron unir los contactos. No se cambió nada." };
  }

  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${conservarId}`);
  return { ok: true, conservado: conservarId };
}
