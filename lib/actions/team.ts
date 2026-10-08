"use server";

import { after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { esManager, getWorkspace } from "@/lib/workspace";
import { enviarCorreo, contenidoDeInvitacion, aHtml } from "@/lib/correo";
import { actorDe, registrarAuditoria } from "@/lib/auditoria";

/**
 * F31: los movimientos de equipo quedan en el historial. La etiqueta de la
 * persona afectada se toma en el momento (nombre o correo), porque el historial
 * sobrevive a que el usuario deje de existir.
 */
async function etiquetaDeUsuario(userId: string): Promise<string> {
  try {
    const service = await createServiceClient();
    const { data } = await service.auth.admin.getUserById(userId);
    const u = data?.user;
    if (!u) return userId;
    return actorDe(u).etiqueta;
  } catch {
    return userId;
  }
}

/**
 * Roles asignables desde la UI. `owner` no está: no se otorga invitando ni
 * cambiando un rol, se tiene por haber creado el workspace.
 */
const ROLES_ASIGNABLES = ["member", "admin"];

/**
 * Quién hace qué en el equipo:
 *   - Invitar, revocar y cambiar rol: Owner y Admin.
 *   - Remover a alguien del workspace: solo Owner.
 *
 * El rol sale de `getWorkspace()`, que ya lo resuelve. Antes cada acción hacía
 * su propia consulta a `workspace_members` para averiguarlo: tres copias del
 * mismo SELECT que el resolvedor ya había hecho.
 *
 * Estas guardas son la primera línea, no la única: las policies de la 00019
 * sobre `workspace_invites` y `workspace_members` dicen lo mismo en la base.
 */
export async function inviteTeamMember(
  workspaceId: string,
  email: string,
  role: string
) {
  const { workspace, user, role: rolPropio, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "Workspace mismatch" };
  }

  if (!esManager(rolPropio)) {
    return { error: "Solo Owner y Admin pueden invitar" };
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { error: "A valid email address is required" };
  }

  if (!ROLES_ASIGNABLES.includes(role)) {
    return { error: "Rol inválido. Tiene que ser member o admin." };
  }

  // Check if this email is already a member
  const { data: existingMembers } = await supabase
    .from("workspace_members")
    .select("user_id, workspaces!inner(id)")
    .eq("workspace_id", workspaceId);

  if (existingMembers && existingMembers.length > 0) {
    // We need to check auth.users for the email, but RLS won't let us.
    // Instead, check if there's already a pending invite for this email.
    const { data: existingInvite } = await supabase
      .from("workspace_invites")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("email", trimmedEmail)
      .eq("status", "pending")
      .single();

    if (existingInvite) {
      return { error: "An invite for this email is already pending" };
    }
  }

  const { data: invite, error: insertError } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email: trimmedEmail,
      role,
      invited_by: user.id,
      status: "pending",
    })
    .select("*")
    .single();

  if (insertError) {
    return { error: insertError.message };
  }

  await registrarAuditoria({
    workspaceId,
    actor: actorDe(user),
    accion: "equipo.invitado",
    entidad: { tipo: "invitacion", id: invite.id, etiqueta: trimmedEmail },
    detalle: { rol: invite.role },
  });

  // F23: la invitación llega por correo a quien se invita. El primer intento
  // corre acá, para poder decir en pantalla si salió; los reintentos van en
  // segundo plano. Si el correo no sale, la invitación igual queda creada y el
  // link se puede copiar desde la lista: el correo es el camino, no la
  // condición.
  const { asunto, parrafos } = contenidoDeInvitacion({
    inviteId: invite.id,
    espacio: workspace.name,
    invitador:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      "Alguien del equipo",
    rol: invite.role,
    vence: invite.expires_at,
  });
  const correo = await enviarCorreo(
    {
      workspaceId,
      tipo: "invitacion",
      para: [trimmedEmail],
      paraEtiqueta: trimmedEmail,
      asunto,
      texto: parrafos.join("\n\n"),
      html: aHtml(parrafos),
      inviteId: invite.id,
    },
    { reintentarEnSegundoPlano: (fn) => after(fn) }
  );

  return { ok: true, invite, correo: { estado: correo.estado, error: correo.error } };
}

/**
 * Cambiar el rol de un miembro. Owner y Admin.
 *
 * No se puede tocar a un Owner ni ascender a nadie a Owner: el rol de Owner
 * viene de haber creado el workspace y no se otorga desde acá. Sin ese límite,
 * un Admin podría degradar al Owner y quedarse con el workspace.
 */
export async function changeTeamMemberRole(
  workspaceId: string,
  userId: string,
  nuevoRol: string
) {
  const { workspace, user, role: rolPropio, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "Workspace mismatch" };
  }

  if (!esManager(rolPropio)) {
    return { error: "Solo Owner y Admin pueden cambiar roles" };
  }

  if (!ROLES_ASIGNABLES.includes(nuevoRol)) {
    return { error: "Rol inválido. Tiene que ser member o admin." };
  }

  if (userId === user.id) {
    return { error: "No podés cambiar tu propio rol" };
  }

  // El rol actual del afectado se lee con el service client: la policy de
  // SELECT de workspace_members solo deja ver la fila propia.
  const serviceClient = await createServiceClient();
  const { data: objetivo } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single();

  if (!objetivo) {
    return { error: "Esa persona no es miembro del workspace" };
  }

  if (objetivo.role === "owner") {
    return { error: "No se puede cambiar el rol del Owner" };
  }

  // `.select()` para saber si la fila cambió de verdad: una policy que deja
  // afectar cero filas responde sin error, y eso no se audita como un cambio.
  const { data: cambiadas, error: updateError } = await supabase
    .from("workspace_members")
    .update({ role: nuevoRol })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");

  if (updateError) {
    return { error: updateError.message };
  }

  if ((cambiadas ?? []).length > 0 && objetivo.role !== nuevoRol) {
    await registrarAuditoria({
      workspaceId,
      actor: actorDe(user),
      accion: "equipo.rol_cambiado",
      entidad: { tipo: "miembro", id: userId, etiqueta: await etiquetaDeUsuario(userId) },
      cambios: { role: { antes: objetivo.role, despues: nuevoRol } },
    });
  }

  return { ok: true };
}

export async function removeTeamMember(
  workspaceId: string,
  userId: string
) {
  const { workspace, user, role: rolPropio, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "Workspace mismatch" };
  }

  // Remover es la única acción de equipo que no se delega en el Admin.
  if (rolPropio !== "owner") {
    return { error: "Solo el Owner puede remover miembros" };
  }

  // Can't remove yourself
  if (userId === user.id) {
    return { error: "No podés removerte a vos mismo del workspace" };
  }

  const etiqueta = await etiquetaDeUsuario(userId);
  const { data: removidas, error: deleteError } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id, role");

  if (deleteError) {
    return { error: deleteError.message };
  }

  if ((removidas ?? []).length > 0) {
    await registrarAuditoria({
      workspaceId,
      actor: actorDe(user),
      accion: "equipo.removido",
      entidad: { tipo: "miembro", id: userId, etiqueta },
      detalle: { rol: removidas![0].role },
    });
  }

  return { ok: true };
}

export async function acceptInvite(inviteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Use service client to bypass RLS (the user is not a workspace member yet)
  const serviceClient = await createServiceClient();

  // Fetch the invite
  const { data: invite, error: fetchError } = await serviceClient
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { error: "Invite not found" };
  }

  if (invite.status !== "pending") {
    return { error: "This invite is no longer valid" };
  }

  if (new Date(invite.expires_at) < new Date()) {
    return { error: "This invite has expired" };
  }

  // Verify the invite email matches the current user's email
  if (invite.email !== user.email) {
    return { error: "This invite was sent to a different email address" };
  }

  // Check if user is already a member
  const { data: existingMembership } = await serviceClient
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (existingMembership) {
    // Already a member, just mark the invite as accepted
    await serviceClient
      .from("workspace_invites")
      .update({ status: "accepted" })
      .eq("id", inviteId);

    return { ok: true, workspaceId: invite.workspace_id, alreadyMember: true };
  }

  // Insert into workspace_members (service client bypasses owner-only RLS)
  const { error: insertError } = await serviceClient
    .from("workspace_members")
    .insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
    });

  if (insertError) {
    return { error: insertError.message };
  }

  // Update invite status to accepted
  await serviceClient
    .from("workspace_invites")
    .update({ status: "accepted" })
    .eq("id", inviteId);

  await registrarAuditoria(
    {
      workspaceId: invite.workspace_id,
      actor: actorDe(user),
      accion: "equipo.ingreso",
      entidad: { tipo: "miembro", id: user.id, etiqueta: actorDe(user).etiqueta },
      detalle: { rol: invite.role, invitacion_id: inviteId },
    }
  );

  return { ok: true, workspaceId: invite.workspace_id };
}

export async function revokeInvite(inviteId: string) {
  const { workspace, user, role: rolPropio, supabase } = await getWorkspace();

  // Fetch the invite to get workspace_id
  const { data: invite, error: fetchError } = await supabase
    .from("workspace_invites")
    .select("workspace_id, email")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { error: "Invite not found" };
  }

  // La invitación tiene que ser del workspace activo. Sin este chequeo, un
  // manager de un workspace podría revocar la de otro pasando el id a mano:
  // `rolPropio` es su rol en SU workspace, no en el de la invitación.
  if (invite.workspace_id !== workspace.id) {
    return { error: "Invite not found" };
  }

  if (!esManager(rolPropio)) {
    return { error: "Solo Owner y Admin pueden revocar invitaciones" };
  }

  const { data: revocadas, error: deleteError } = await supabase
    .from("workspace_invites")
    .delete()
    .eq("id", inviteId)
    .select("id");

  if (deleteError) {
    return { error: deleteError.message };
  }

  if ((revocadas ?? []).length > 0) {
    await registrarAuditoria({
      workspaceId: workspace.id,
      actor: actorDe(user),
      accion: "equipo.invitacion_revocada",
      entidad: { tipo: "invitacion", id: inviteId, etiqueta: invite.email },
    });
  }

  return { ok: true };
}
