import { describe, it, expect, vi } from "vitest";

/**
 * Control positivo del relleno de F27, determinista: la respuesta de
 * `getInboxConversation` es SIMULADA, como pide el criterio. Contra la API real
 * no se prueba porque, en lo medido el 22/09/2026, el perfil aparece alrededor
 * de un segundo antes de la entrega del webhook, y un test que dependa de ganar
 * esa carrera termina desactivado.
 *
 * Los tres casos van juntos a propósito: probar solo que un nombre `manual` no
 * se pisa no distingue "está bien hecho" de "está todo congelado".
 */

vi.mock("./vault", () => ({ getZernioApiKey: async () => "no-se-usa" }));
vi.mock("./zernio-client", () => ({ createZernioClient: () => ({}) }));

const { rellenarPerfilSiFalta, TECHO_DE_INTENTOS } = await import("./relleno-perfil");

type Escritura = { tabla: string; valores: Record<string, unknown>; filtros: Array<[string, unknown]> };

function base(fila: { profile_status: string; profile_attempts: number; source: "provider" | "manual" }) {
  const escrituras: Escritura[] = [];
  const contacto = { display_name: "handle_viejo", display_name_source: fila.source };
  const supabase = {
    from(tabla: string) {
      let escritura: Escritura | null = null;
      const cadena = {
        select: () => cadena,
        eq: (col: string, valor: unknown) => {
          escritura?.filtros.push([col, valor]);
          return cadena;
        },
        maybeSingle: async () => ({
          data: { id: "cc-1", contact_id: "ct-1", profile_status: fila.profile_status, profile_attempts: fila.profile_attempts },
          error: null,
        }),
        update: (valores: Record<string, unknown>) => {
          escritura = { tabla, valores, filtros: [] };
          escrituras.push(escritura);
          return cadena;
        },
        then: (ok: (r: { error: null }) => unknown) => {
          // Aplica la escritura sobre el contacto como lo haría la base,
          // respetando el filtro por origen del nombre.
          if (escritura?.tabla === "contacts") {
            const pide = escritura.filtros.find(([c]) => c === "display_name_source")?.[1];
            if (!pide || pide === contacto.display_name_source) Object.assign(contacto, escritura.valores);
          }
          return Promise.resolve({ error: null }).then(ok);
        },
      };
      return cadena;
    },
  };
  return { supabase, escrituras, contacto };
}

const canal = { id: "ch-1", workspace_id: "ws-1", platform: "instagram", late_account_id: "acc-1" };

function zernioQueDevuelve(data: Record<string, unknown>) {
  return { messages: { getInboxConversation: vi.fn(async () => ({ data })) } };
}

const CON_PERFIL = {
  participantName: "Nombre Real",
  participantUsername: "handle_real",
  instagramProfile: { isFollower: true, followerCount: 105 },
};

describe("relleno del perfil (F27)", () => {
  it("1. nombre de origen provider y pending: recibe nombre y handle cuando la respuesta trae instagramProfile", async () => {
    const { supabase, escrituras, contacto } = base({ profile_status: "pending", profile_attempts: 0, source: "provider" });
    const r = await rellenarPerfilSiFalta(supabase as never, {
      channel: canal,
      senderId: "s-1",
      conversacionDeZernio: "zc-1",
      zernio: zernioQueDevuelve(CON_PERFIL),
    });
    expect(r).toBe("completo");
    expect(contacto.display_name).toBe("Nombre Real");
    expect(escrituras).toContainEqual(
      expect.objectContaining({ tabla: "contact_channels", valores: { profile_status: "complete", platform_username: "handle_real" } }),
    );
  });

  it("2. sin instagramProfile no cambia nada, salvo profile_attempts", async () => {
    const { supabase, escrituras, contacto } = base({ profile_status: "pending", profile_attempts: 0, source: "provider" });
    const r = await rellenarPerfilSiFalta(supabase as never, {
      channel: canal,
      senderId: "s-1",
      conversacionDeZernio: "zc-1",
      zernio: zernioQueDevuelve({ participantName: "Nombre Real", participantUsername: "handle_real" }),
    });
    expect(r).toBe("sin_perfil");
    expect(contacto.display_name).toBe("handle_viejo");
    expect(escrituras).toEqual([expect.objectContaining({ tabla: "contact_channels", valores: { profile_attempts: 1 } })]);
  });

  it("2b. al tercer intento sin perfil pasa a unavailable", async () => {
    const { supabase, escrituras } = base({ profile_status: "pending", profile_attempts: TECHO_DE_INTENTOS - 1, source: "provider" });
    const r = await rellenarPerfilSiFalta(supabase as never, {
      channel: canal,
      senderId: "s-1",
      conversacionDeZernio: "zc-1",
      zernio: zernioQueDevuelve({}),
    });
    expect(r).toBe("agotado");
    expect(escrituras[0].valores).toEqual({ profile_attempts: TECHO_DE_INTENTOS, profile_status: "unavailable" });
  });

  it("2c. con profile_status distinto de pending no llama a Zernio", async () => {
    const { supabase } = base({ profile_status: "unavailable", profile_attempts: 3, source: "provider" });
    const zernio = zernioQueDevuelve(CON_PERFIL);
    expect(
      await rellenarPerfilSiFalta(supabase as never, { channel: canal, senderId: "s-1", conversacionDeZernio: "zc-1", zernio }),
    ).toBe("no_aplica");
    expect(zernio.messages.getInboxConversation).not.toHaveBeenCalled();
  });

  it("3. un nombre de origen manual no se pisa aunque la respuesta traiga perfil (el handle sí se escribe)", async () => {
    const { supabase, escrituras, contacto } = base({ profile_status: "pending", profile_attempts: 0, source: "manual" });
    const r = await rellenarPerfilSiFalta(supabase as never, {
      channel: canal,
      senderId: "s-1",
      conversacionDeZernio: "zc-1",
      zernio: zernioQueDevuelve(CON_PERFIL),
    });
    expect(r).toBe("completo");
    expect(contacto.display_name).toBe("handle_viejo");
    expect(escrituras).toContainEqual(
      expect.objectContaining({ tabla: "contact_channels", valores: { profile_status: "complete", platform_username: "handle_real" } }),
    );
  });
});
