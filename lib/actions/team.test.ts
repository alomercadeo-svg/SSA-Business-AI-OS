import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Movimientos de equipo en el historial de auditoría (F31).
 *
 * Cada acción de `team.ts` que cambia el equipo deja un evento con quién lo
 * hizo. Y dos cosas que no: una acción rechazada no deja rastro, y una
 * escritura que la base dejó en cero filas (una policy que no la permite
 * responde sin error) no se registra como un cambio.
 *
 * El envío de la invitación está simulado: este test no manda correo.
 */

const h = vi.hoisted(() => ({
  rol: "owner",
  filasAfectadas: 1,
  auditoria: [] as Record<string, unknown>[],
  correos: 0,
}));

/** Cliente encadenable: resuelve con filas según la operación. */
function cliente() {
  const fila = (tabla: string, op: string) => {
    if (tabla === "workspace_invites" && op === "insert")
      return { id: "inv-1", role: "member", expires_at: "2026-10-14T00:00:00Z" };
    if (tabla === "workspace_invites" && op === "select")
      return { id: "inv-1", workspace_id: "ws-1", email: "nuevo@ssa-test.local", status: "pending", role: "member", expires_at: "2999-01-01T00:00:00Z" };
    if (tabla === "workspace_members" && op === "select") return { role: "member" };
    return null;
  };
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u-nuevo", email: "nuevo@ssa-test.local", user_metadata: { full_name: "Nuevo" } } } }),
      admin: { getUserById: async () => ({ data: { user: { id: "u-2", email: "laura@ssa-test.local", user_metadata: { full_name: "Laura" } } } }) },
    },
    from: (tabla: string) => {
      let op = "select";
      const c: Record<string, unknown> = {};
      const yo = () => c;
      Object.assign(c, {
        select: () => (op === "select" ? (op = "select", c) : c),
        insert: () => ((op = "insert"), c),
        update: () => ((op = "update"), c),
        delete: () => ((op = "delete"), c),
        eq: yo,
        single: async () => ({ data: op === "select" && tabla === "workspace_members" && h.rol === "aceptar" ? null : fila(tabla, op), error: null }),
        maybeSingle: async () => ({ data: fila(tabla, op), error: null }),
        then: (ok: (r: unknown) => unknown) => {
          const filas = op === "update" || op === "delete" ? Array.from({ length: h.filasAfectadas }, () => ({ user_id: "u-2", role: "member", id: "inv-1" })) : [];
          return Promise.resolve({ data: filas, error: null }).then(ok);
        },
      });
      return c;
    },
  };
}

vi.mock("@/lib/workspace", () => ({
  esManager: (r: string) => r === "owner" || r === "admin",
  getWorkspace: async () => ({
    workspace: { id: "ws-1", name: "Espacio" },
    user: { id: "u-1", email: "ale@ssa-test.local", user_metadata: { full_name: "Ale" } },
    role: h.rol,
    supabase: cliente(),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cliente(),
  createServiceClient: async () => cliente(),
}));
vi.mock("@/lib/correo", () => ({
  enviarCorreo: async () => {
    h.correos++;
    return { estado: "enviado", error: null };
  },
  contenidoDeInvitacion: () => ({ asunto: "a", parrafos: ["b"] }),
  aHtml: () => "",
}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/auditoria")>()),
  registrarAuditoria: async (e: Record<string, unknown>) => {
    h.auditoria.push(e);
    return true;
  },
}));

const team = await import("./team");

beforeEach(() => {
  h.rol = "owner";
  h.filasAfectadas = 1;
  h.auditoria.length = 0;
  h.correos = 0;
});

describe("movimientos de equipo en el historial", () => {
  it("invitar: queda «equipo.invitado» con el correo y el rol", async () => {
    const r = await team.inviteTeamMember("ws-1", "Nuevo@ssa-test.local", "member");
    expect(r).toMatchObject({ ok: true });
    expect(h.auditoria).toMatchObject([
      { accion: "equipo.invitado", actor: { id: "u-1", etiqueta: "Ale" }, entidad: { tipo: "invitacion", etiqueta: "nuevo@ssa-test.local" }, detalle: { rol: "member" } },
    ]);
  });

  it("cambiar el rol: queda el antes y el después", async () => {
    await team.changeTeamMemberRole("ws-1", "u-2", "admin");
    expect(h.auditoria).toMatchObject([
      { accion: "equipo.rol_cambiado", entidad: { tipo: "miembro", id: "u-2", etiqueta: "Laura" }, cambios: { role: { antes: "member", despues: "admin" } } },
    ]);
  });

  it("remover: queda «equipo.removido» con el nombre de la persona", async () => {
    await team.removeTeamMember("ws-1", "u-2");
    expect(h.auditoria).toMatchObject([{ accion: "equipo.removido", entidad: { id: "u-2", etiqueta: "Laura" } }]);
  });

  it("revocar una invitación: queda con el correo invitado", async () => {
    await team.revokeInvite("inv-1");
    expect(h.auditoria).toMatchObject([{ accion: "equipo.invitacion_revocada", entidad: { etiqueta: "nuevo@ssa-test.local" } }]);
  });

  it("aceptar: queda «equipo.ingreso», y el actor es quien se suma", async () => {
    h.rol = "aceptar";
    const r = await team.acceptInvite("inv-1");
    expect(r).toMatchObject({ ok: true });
    expect(h.auditoria).toMatchObject([{ accion: "equipo.ingreso", actor: { id: "u-nuevo" }, workspaceId: "ws-1" }]);
  });
});

describe("lo que no se registra", () => {
  it("una acción rechazada por rol no deja rastro", async () => {
    h.rol = "member";
    await team.inviteTeamMember("ws-1", "x@ssa-test.local", "member");
    await team.changeTeamMemberRole("ws-1", "u-2", "admin");
    await team.removeTeamMember("ws-1", "u-2");
    await team.revokeInvite("inv-1");
    expect(h.auditoria).toHaveLength(0);
  });

  it("una escritura que afectó cero filas no se registra como cambio", async () => {
    h.filasAfectadas = 0;
    await team.changeTeamMemberRole("ws-1", "u-2", "admin");
    await team.removeTeamMember("ws-1", "u-2");
    await team.revokeInvite("inv-1");
    expect(h.auditoria).toHaveLength(0);
  });

  it("registrar no manda correos: el único es el de la invitación, que ya salía", async () => {
    await team.changeTeamMemberRole("ws-1", "u-2", "admin");
    await team.removeTeamMember("ws-1", "u-2");
    await team.revokeInvite("inv-1");
    expect(h.correos).toBe(0);
    await team.inviteTeamMember("ws-1", "y@ssa-test.local", "member");
    expect(h.correos).toBe(1);
  });
});
