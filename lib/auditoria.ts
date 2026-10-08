/**
 * Historial de auditoría (F31): quién hizo qué y cuándo.
 *
 * Toda escritura de `audit_log` desde el código pasa por `registrarAuditoria`.
 * La tabla no tiene policies de escritura para usuarios, así que esto corre con
 * la clave de servicio, y el actor lo pone el servidor, no el navegador.
 *
 * NUNCA TUMBA LA ACCIÓN QUE REGISTRA. Si el insert falla, se loguea y se sigue:
 * que no entre un mensaje, o que no se guarde una clave, porque falló el
 * historial, es peor que el hueco en el historial. Las dos operaciones donde el
 * cambio y su registro tienen que ser una sola (reconciliar un teléfono y
 * fusionar contactos, de F26) no pasan por acá: las hace una función SQL.
 *
 * NUNCA GUARDA SECRETOS. Para una clave se registra que se guardó o se borró,
 * jamás el valor. `registrarAuditoria` lo hace cumplir: un cambio cuyo campo
 * suena a secreto se guarda sin valores.
 *
 * Por qué se escribe desde el código y no con triggers en la base, y por qué la
 * tabla no tiene claves foráneas: ver `supabase/migrations/00028_audit_log.sql`.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";

/** La lista cerrada, igual al `check` de la 00028. Sumar una es una migración. */
export const ACCIONES_AUDITORIA = [
  "contacto.creado",
  "contacto.editado",
  "contacto.reconciliado",
  "contacto.fusionado",
  "canal.conectado",
  "canal.desconectado",
  "canal.error",
  "canal.reemplazado",
  "configuracion.cambiada",
  "equipo.invitado",
  "equipo.invitacion_revocada",
  "equipo.ingreso",
  "equipo.rol_cambiado",
  "equipo.removido",
] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

export const TIPOS_DE_ENTIDAD = ["contacto", "canal", "espacio", "integracion", "miembro", "invitacion"] as const;
export type TipoDeEntidad = (typeof TIPOS_DE_ENTIDAD)[number];

export interface Actor {
  id: string;
  etiqueta: string;
}

export type Cambios = Record<string, { antes: unknown; despues: unknown }>;

export interface EventoAuditoria {
  workspaceId: string;
  /** Nulo es el Sistema: un webhook, la sincronización, un script. */
  actor: Actor | null;
  accion: AccionAuditoria;
  entidad: { tipo: TipoDeEntidad; id?: string | null; etiqueta?: string | null };
  cambios?: Cambios;
  detalle?: Record<string, unknown>;
}

/** El nombre con que se muestra quien actuó: su nombre si lo tiene, si no su correo. */
export function actorDe(user: Pick<User, "id" | "email" | "user_metadata">): Actor {
  const nombre = (user.user_metadata as { full_name?: unknown } | undefined)?.full_name;
  return {
    id: user.id,
    etiqueta: typeof nombre === "string" && nombre.trim() ? nombre.trim() : (user.email ?? user.id),
  };
}

const PARECE_SECRETO = /(^|_)(secret|token|key|password|clave|api_key)(_|$)/i;

/** Saca los valores de todo campo que suene a secreto. Exportada para el test. */
export function sinSecretos(cambios: Cambios | undefined): Cambios {
  const limpio: Cambios = {};
  for (const [campo, v] of Object.entries(cambios ?? {})) {
    limpio[campo] = PARECE_SECRETO.test(campo) ? { antes: null, despues: null } : v;
  }
  return limpio;
}

export function filaDeAuditoria(evento: EventoAuditoria) {
  return {
    workspace_id: evento.workspaceId,
    actor_id: evento.actor?.id ?? null,
    actor_label: evento.actor?.etiqueta ?? "Sistema",
    action: evento.accion,
    entity_type: evento.entidad.tipo,
    entity_id: evento.entidad.id ?? null,
    entity_label: evento.entidad.etiqueta ?? null,
    changes: sinSecretos(evento.cambios),
    detail: evento.detalle ?? {},
  };
}

/**
 * Registra uno o más eventos. Devuelve si quedaron escritos; nunca lanza.
 *
 * `cliente` tiene que ser uno con la clave de servicio. Si el llamador ya tiene
 * uno (el webhook, la sincronización), lo pasa; si no, se crea.
 */
export async function registrarAuditoria(
  eventos: EventoAuditoria | EventoAuditoria[],
  cliente?: SupabaseClient
): Promise<boolean> {
  const lista = Array.isArray(eventos) ? eventos : [eventos];
  if (lista.length === 0) return true;
  try {
    const supabase = cliente ?? ((await createServiceClient()) as unknown as SupabaseClient);
    const { error } = await supabase.from("audit_log").insert(lista.map(filaDeAuditoria));
    if (error) {
      console.error("[auditoria] no se pudo registrar:", lista.map((e) => e.accion).join(", "), error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[auditoria] no se pudo registrar:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * «Canal con error»: una vez por condición abierta, no por cada ocurrencia.
 *
 * `record_webhook_alert` devuelve solo el id de la alerta, abierta o
 * incrementada. Se distingue la recién abierta por `occurrences = 1`. Un
 * rechazo nunca viene solo (§7.2): registrar cada ocurrencia llenaría para
 * siempre un historial que no se puede limpiar con el mismo evento repetido.
 */
export async function auditarAlertaSiEsNueva(supabase: SupabaseClient, alertaId: string): Promise<void> {
  // Va adentro del mismo `after()` que el correo de la alerta: si esto tirara,
  // el correo no saldría. Por eso no lanza nunca.
  try {
    await auditarAlerta(supabase, alertaId);
  } catch (err) {
    console.error("[auditoria] no se pudo registrar la alerta:", err instanceof Error ? err.message : String(err));
  }
}

async function auditarAlerta(supabase: SupabaseClient, alertaId: string): Promise<void> {
  const { data: alerta } = await supabase
    .from("webhook_alerts")
    .select("workspace_id, channel_id, alert_condition, occurrences, source")
    .eq("id", alertaId)
    .maybeSingle();
  if (!alerta?.workspace_id || alerta.occurrences !== 1) return;

  let etiqueta: string | null = null;
  if (alerta.channel_id) {
    const { data: canal } = await supabase
      .from("channels")
      .select("platform, username, display_name, instance_name")
      .eq("id", alerta.channel_id)
      .maybeSingle();
    if (canal) etiqueta = etiquetaDeCanal(canal);
  }
  await registrarAuditoria(
    {
      workspaceId: alerta.workspace_id,
      actor: null,
      accion: "canal.error",
      entidad: { tipo: "canal", id: alerta.channel_id, etiqueta },
      detalle: { condicion: alerta.alert_condition, fuente: alerta.source, alerta_id: alertaId },
    },
    supabase
  );
}

const NOMBRE_DE_PLATAFORMA: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  telegram: "Telegram",
  twitter: "X",
  bluesky: "Bluesky",
  reddit: "Reddit",
};

export function nombreDePlataforma(p: string | null | undefined): string {
  return (p && NOMBRE_DE_PLATAFORMA[p]) || p || "canal";
}

/** «Instagram @alomercadeo», «WhatsApp (instancia ssa-wa)». */
export function etiquetaDeCanal(c: {
  platform?: string | null;
  username?: string | null;
  display_name?: string | null;
  instance_name?: string | null;
}): string {
  const plataforma = nombreDePlataforma(c.platform);
  if (c.username) return `${plataforma} @${c.username.replace(/^@/, "")}`;
  if (c.instance_name) return `${plataforma} (instancia ${c.instance_name})`;
  if (c.display_name) return `${plataforma} ${c.display_name}`;
  return plataforma;
}

// ── Lo que muestra la pestaña «Historial de cambios» ────────────────────────

export interface FilaAuditoria {
  action: string;
  entity_label: string | null;
  changes: unknown;
  detail: unknown;
}

const ETIQUETA_DE_CAMPO: Record<string, string> = {
  name: "nombre del espacio",
  global_keywords: "palabras clave",
  phone: "teléfono",
  role: "rol",
  modelo: "modelo por defecto",
  remitente: "remitente",
  clave: "clave",
};

function valor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vacío";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "vacío";
  return String(v);
}

const ROLES: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function cambiosEnTexto(changes: unknown): string {
  if (!changes || typeof changes !== "object") return "";
  const partes = Object.entries(changes as Cambios).map(([campo, c]) => {
    const etiqueta = ETIQUETA_DE_CAMPO[campo] ?? campo;
    if (c.antes === null && c.despues === null) return etiqueta;
    const fmt = (x: unknown) => (campo === "role" && typeof x === "string" ? ROLES[x] ?? x : valor(x));
    return `${etiqueta}: ${fmt(c.antes)} → ${fmt(c.despues)}`;
  });
  return partes.join(" · ");
}

const VIA: Record<string, string> = {
  manual: "cargado a mano",
  mensaje: "por un mensaje posterior",
  aviso_evolution: "por un aviso de WhatsApp",
};

/** «Qué cambió», en una línea y en lenguaje claro. */
export function textoDeEvento(fila: FilaAuditoria): string {
  const quien = fila.entity_label ?? "";
  const d = (fila.detail ?? {}) as Record<string, unknown>;
  const cambios = cambiosEnTexto(fila.changes);
  const con = (base: string) => (cambios ? `${base} · ${cambios}` : base);
  switch (fila.action) {
    case "contacto.creado":
      return `Contacto creado: ${quien}${d.plataforma ? ` (${nombreDePlataforma(String(d.plataforma))})` : ""}`;
    case "contacto.editado":
      return con(`Contacto editado: ${quien}`);
    case "contacto.reconciliado":
      return con(`Teléfono resuelto de ${quien}${d.via ? `, ${VIA[String(d.via)] ?? String(d.via)}` : ""}`);
    case "contacto.fusionado":
      return `Contactos unidos: ${d.absorbido_nombre ? `${String(d.absorbido_nombre)} pasó a ` : ""}${quien}`;
    case "canal.conectado":
      return `Canal conectado: ${quien}`;
    case "canal.desconectado":
      return `Canal desconectado: ${quien}${d.motivo === "cuenta_inexistente" ? " · la cuenta ya no está en Zernio" : ""}`;
    case "canal.error":
      return `Canal con error: ${quien || "sin canal identificado"}${d.condicion === "webhook_auth_failed" ? " · rechazo de autenticación" : ""}`;
    case "canal.reemplazado":
      return `Canal reemplazado: ${quien} · la ranura de Zernio pasó a otra cuenta`;
    case "configuracion.cambiada":
      return con(quien || "Configuración cambiada");
    case "equipo.invitado":
      return `Invitación enviada a ${quien}${d.rol ? ` como ${ROLES[String(d.rol)] ?? String(d.rol)}` : ""}`;
    case "equipo.invitacion_revocada":
      return `Invitación revocada: ${quien}`;
    case "equipo.ingreso":
      return `${quien} se sumó al equipo${d.rol ? ` como ${ROLES[String(d.rol)] ?? String(d.rol)}` : ""}`;
    case "equipo.rol_cambiado":
      return con(`Rol cambiado: ${quien}`);
    case "equipo.removido":
      return `Removido del equipo: ${quien}`;
    default:
      return con(fila.action);
  }
}
