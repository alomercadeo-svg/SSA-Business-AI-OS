import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El módulo del historial de auditoría (F31).
 *
 * Lo que NO prueba este archivo: que la base frene UPDATE y DELETE, ni que un
 * Member vea solo lo suyo. Eso solo lo prueba una consulta contra la base real,
 * y está en `scripts/verify-auditoria.mjs`.
 */

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => {
    throw new Error("el test tiene que pasar su propio cliente");
  },
}));

const {
  ACCIONES_AUDITORIA,
  actorDe,
  auditarAlertaSiEsNueva,
  etiquetaDeCanal,
  filaDeAuditoria,
  registrarAuditoria,
  sinSecretos,
  textoDeEvento,
} = await import("./auditoria");

/** Cliente falso: guarda los inserts de audit_log y responde lecturas fijas. */
function clienteFalso(opts: { errorAlInsertar?: string; filas?: Record<string, unknown> } = {}) {
  const insertados: unknown[] = [];
  const cliente = {
    from: (tabla: string) => ({
      insert: async (v: unknown) => {
        if (tabla === "audit_log") insertados.push(...(Array.isArray(v) ? v : [v]));
        return { error: opts.errorAlInsertar ? { message: opts.errorAlInsertar } : null };
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: opts.filas?.[tabla] ?? null }) }),
      }),
    }),
  };
  return { cliente: cliente as never, insertados };
}

describe("la lista de acciones", () => {
  it("es la misma que el check de la migración 00028", () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "00028_audit_log.sql"), "utf8");
    const bloque = sql.match(/audit_log_action_check check \(action in \(([\s\S]*?)\)\);/)![1];
    const enLaBase = [...bloque.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(enLaBase).toEqual([...ACCIONES_AUDITORIA]);
  });
});

describe("registrarAuditoria", () => {
  it("escribe la fila con el actor, y el Sistema cuando no hay actor", async () => {
    const { cliente, insertados } = clienteFalso();
    const ok = await registrarAuditoria(
      [
        {
          workspaceId: "ws",
          actor: { id: "u", etiqueta: "Ale" },
          accion: "equipo.invitado",
          entidad: { tipo: "invitacion", id: "inv", etiqueta: "x@y.z" },
        },
        { workspaceId: "ws", actor: null, accion: "contacto.creado", entidad: { tipo: "contacto", id: "c" } },
      ],
      cliente
    );
    expect(ok).toBe(true);
    expect(insertados).toMatchObject([
      { workspace_id: "ws", actor_id: "u", actor_label: "Ale", action: "equipo.invitado", entity_label: "x@y.z" },
      { actor_id: null, actor_label: "Sistema", action: "contacto.creado" },
    ]);
  });

  it("si la base rechaza, devuelve false y no lanza: la acción que registra sigue", async () => {
    const { cliente } = clienteFalso({ errorAlInsertar: "sin conexión" });
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      registrarAuditoria({ workspaceId: "ws", actor: null, accion: "contacto.creado", entidad: { tipo: "contacto" } }, cliente)
    ).resolves.toBe(false);
    expect(errores).toHaveBeenCalled();
    errores.mockRestore();
  });

  it("si ni siquiera hay cliente, tampoco lanza", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      registrarAuditoria({ workspaceId: "ws", actor: null, accion: "contacto.creado", entidad: { tipo: "contacto" } })
    ).resolves.toBe(false);
    errores.mockRestore();
  });
});

describe("nunca guarda un secreto", () => {
  it("un campo que suena a clave se guarda sin valores", () => {
    expect(
      sinSecretos({
        api_key: { antes: "re_viejo", despues: "re_nuevo" },
        token_de_acceso: { antes: "a", despues: "b" },
        remitente: { antes: "a@x.com", despues: "b@x.com" },
      })
    ).toEqual({
      api_key: { antes: null, despues: null },
      token_de_acceso: { antes: null, despues: null },
      remitente: { antes: "a@x.com", despues: "b@x.com" },
    });
  });

  it("filaDeAuditoria aplica la limpieza siempre", () => {
    const f = filaDeAuditoria({
      workspaceId: "ws",
      actor: null,
      accion: "configuracion.cambiada",
      entidad: { tipo: "integracion" },
      cambios: { clave: { antes: "sk-1", despues: "sk-2" } },
    });
    expect(JSON.stringify(f)).not.toContain("sk-");
  });
});

describe("actorDe", () => {
  it("usa el nombre si lo tiene, y si no el correo", () => {
    expect(actorDe({ id: "u", email: "a@b.c", user_metadata: { full_name: " Ale " } })).toEqual({ id: "u", etiqueta: "Ale" });
    expect(actorDe({ id: "u", email: "a@b.c", user_metadata: {} })).toEqual({ id: "u", etiqueta: "a@b.c" });
  });
});

describe("canal con error: una vez por condición abierta", () => {
  const alerta = (occurrences: number) => ({
    webhook_alerts: { workspace_id: "ws", channel_id: "ch", alert_condition: "webhook_auth_failed", occurrences, source: "evolution" },
    channels: { platform: "whatsapp", username: null, display_name: null, instance_name: "ssa-wa" },
  });

  it("la alerta recién abierta (1 ocurrencia) queda en el historial", async () => {
    const { cliente, insertados } = clienteFalso({ filas: alerta(1) });
    await auditarAlertaSiEsNueva(cliente, "al-1");
    expect(insertados).toMatchObject([
      { action: "canal.error", entity_id: "ch", entity_label: "WhatsApp (instancia ssa-wa)", actor_label: "Sistema" },
    ]);
  });

  it("las ocurrencias siguientes no: el historial no se puede limpiar", async () => {
    const { cliente, insertados } = clienteFalso({ filas: alerta(2) });
    await auditarAlertaSiEsNueva(cliente, "al-1");
    expect(insertados).toHaveLength(0);
  });

  it("si la lectura falla, no lanza: va en el mismo after() que el correo", async () => {
    const roto = { from: () => { throw new Error("caído"); } } as never;
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(auditarAlertaSiEsNueva(roto, "al-1")).resolves.toBeUndefined();
    errores.mockRestore();
  });
});

describe("lo que muestra la pestaña", () => {
  it("cada acción tiene un texto que no es el código crudo", () => {
    for (const action of ACCIONES_AUDITORIA) {
      const t = textoDeEvento({ action, entity_label: "Valeria", changes: {}, detail: {} });
      expect(t, action).not.toContain(action);
      expect(t.length, action).toBeGreaterThan(5);
    }
  });

  it("los cambios se leen como antes → después, y los roles con su nombre", () => {
    expect(
      textoDeEvento({ action: "equipo.rol_cambiado", entity_label: "Laura", changes: { role: { antes: "member", despues: "admin" } }, detail: {} })
    ).toBe("Rol cambiado: Laura · rol: Member → Admin");
    expect(
      textoDeEvento({ action: "contacto.creado", entity_label: "Valeria Monge", changes: {}, detail: { plataforma: "instagram" } })
    ).toBe("Contacto creado: Valeria Monge (Instagram)");
  });

  it("etiquetaDeCanal", () => {
    expect(etiquetaDeCanal({ platform: "instagram", username: "@alomercadeo" })).toBe("Instagram @alomercadeo");
    expect(etiquetaDeCanal({ platform: "whatsapp", instance_name: "ssa" })).toBe("WhatsApp (instancia ssa)");
  });
});
