import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";

/**
 * «Contacto creado» en la importación de historial (F31), con la
 * `registrarAuditoria` real.
 *
 * El defecto, encontrado el 08/10/2026: la sincronización y «Probar y guardar»
 * le pasan a la importación el cliente del usuario, y la importación auditaba
 * con ese cliente. La 00028 le quita a los usuarios el permiso de insertar en
 * `audit_log` (línea 123), así que la fila se rechazaba y el rechazo solo iba
 * al log. Los 7 contactos importados ese día quedaron sin su fila.
 *
 * Acá el cliente del usuario rechaza el insert en `audit_log` como la base
 * real, y el de servicio (`createServiceClient`, simulado) lo acepta. Se vio en
 * rojo el 08/10/2026, antes del arreglo.
 */

const h = vi.hoisted(() => ({
  auditoriaServicio: [] as Record<string, unknown>[],
  auditoriaUsuario: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (tabla: string) => ({
      insert: async (filas: Record<string, unknown> | Record<string, unknown>[]) => {
        if (tabla === "audit_log") h.auditoriaServicio.push(...(Array.isArray(filas) ? filas : [filas]));
        return { data: null, error: null };
      },
    }),
  }),
}));

const { backfillInboxConversations } = await import("./inbox-sync");

/** El cliente del usuario: lee e inserta lo de la importación, y la base le rechaza `audit_log`. */
function clienteDeUsuario() {
  let n = 0;
  return {
    from(tabla: string) {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
        insert(fila: Record<string, unknown> | Record<string, unknown>[]) {
          if (tabla === "audit_log") {
            h.auditoriaUsuario += Array.isArray(fila) ? fila.length : 1;
            return Promise.resolve({ data: null, error: { message: "permission denied for table audit_log" } });
          }
          if (tabla === "contacts") {
            const id = `contacto-${++n}`;
            return { select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) };
          }
          return Promise.resolve({ data: null, error: null });
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        upsert: (fila: Record<string, unknown>) => ({
          select: () => Promise.resolve({ data: [{ id: `conv-${fila.late_conversation_id}` }], error: null }),
        }),
      };
      return cadena;
    },
  } as unknown as SupabaseClient;
}

const zernio = {
  messages: {
    listInboxConversations: async () => ({
      data: {
        data: [{ id: "c1", participantId: "remitente-1", participantName: "Lead Uno", updatedTime: "2026-10-08T18:20:00Z" }],
        pagination: { hasMore: false },
      },
    }),
  },
} as unknown as Zernio;

const CANAL = { id: "ch-1", late_account_id: "acc-1", platform: "instagram" };
const MARCOS = { id: "u-marcos", etiqueta: "Marcos" };

beforeEach(() => {
  h.auditoriaServicio.length = 0;
  h.auditoriaUsuario = 0;
});

describe("la importación deja «contacto creado» en el historial", () => {
  it("con el cliente del usuario, la fila igual queda: se escribe con el de servicio", async () => {
    const r = await backfillInboxConversations({
      supabase: clienteDeUsuario(),
      zernio,
      workspaceId: "ws-1",
      channels: [CANAL],
      actor: MARCOS,
    });
    expect(r.imported).toBe(1);
    expect(h.auditoriaUsuario, "la importación no puede auditar con el cliente del usuario").toBe(0);
    expect(h.auditoriaServicio).toHaveLength(1);
    expect(h.auditoriaServicio[0]).toMatchObject({ action: "contacto.creado", entity_label: "Lead Uno" });
  });

  /** Control positivo: quien queda es el usuario que sincronizó, no «Sistema». */
  it("el actor es el usuario que conectó o sincronizó", async () => {
    await backfillInboxConversations({
      supabase: clienteDeUsuario(),
      zernio,
      workspaceId: "ws-1",
      channels: [CANAL],
      actor: MARCOS,
    });
    expect(h.auditoriaServicio[0]).toMatchObject({ actor_id: "u-marcos", actor_label: "Marcos" });
  });
});
