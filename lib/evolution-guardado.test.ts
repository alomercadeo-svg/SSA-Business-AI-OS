import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El guardado de WhatsApp (F27) y lo de F25 y F26 que cuelga de él, con la
 * base simulada. Los avisos están ARMADOS desde el código de Evolution 2.3.7
 * (`whatsapp.baileys.service.ts` de la etiqueta `2.3.7`) y de Baileys
 * 7.0.0-rc.9; cada uno dice de qué líneas sale. No hay un aviso real: el número
 * no se vincula hasta el Bloque 4. Llegada real: se comprueba en la puesta en
 * marcha. La parte que solo la base puede probar (la restricción única contra
 * Postgres, el contador) la cubre `scripts/verify-guardado-whatsapp.mjs`.
 */

const h = vi.hoisted(() => ({
  porSender: new Map<string, string>(), // platform_sender_id → contact_id
  porRawJid: new Map<string, string>(), // raw_jid → contact_id
  ops: [] as Array<{ tabla: string; op: string; valores?: any; filtros: Array<[string, unknown]> }>,
  rpcs: [] as Array<{ fn: string; args: any }>,
  upsertContactForSender: vi.fn(),
}));

vi.mock("./inbox-sync", () => ({ upsertContactForSender: h.upsertContactForSender }));

function supabaseFalso() {
  return {
    from(tabla: string) {
      const op = { tabla, op: "select", valores: undefined as any, filtros: [] as Array<[string, unknown]> };
      const cadena: any = {
        select: () => cadena,
        eq: (c: string, v: unknown) => (op.filtros.push([c, v]), cadena),
        update: (v: any) => ((op.op = "update"), (op.valores = v), h.ops.push(op), cadena),
        upsert: (v: any, o: any) => {
          op.op = "upsert";
          op.valores = v;
          (op as any).opciones = o;
          h.ops.push(op);
          if (tabla === "messages") return Promise.resolve({ error: null });
          return cadena;
        },
        single: async () => ({ data: tabla === "conversations" ? { id: "conv-1" } : null, error: null }),
        maybeSingle: async () => {
          if (tabla === "contact_channels") {
            const [col, valor] = op.filtros.find(([c]) => c !== "channel_id") ?? [];
            const mapa = col === "raw_jid" ? h.porRawJid : h.porSender;
            const id = mapa.get(String(valor));
            return { data: id ? { contact_id: id } : null, error: null };
          }
          if (tabla === "contacts") return { data: { attribution: {} }, error: null };
          return { data: null, error: null };
        },
        then: (ok: (r: { error: null }) => unknown) => Promise.resolve({ error: null }).then(ok),
      };
      return cadena;
    },
    rpc: async (fn: string, args: any) => {
      h.rpcs.push({ fn, args });
      return { data: fn === "reconciliar_telefono" ? { resultado: "resuelto" } : null, error: null };
    },
  };
}

const { guardarMensajesDeEvolution, procesarAvisoDeContacto, fechaDeEvolution, traducirMensaje } = await import(
  "./evolution-guardado"
);

const CANAL = { id: "ch-wa", workspace_id: "ws-1", platform: "whatsapp" };
const TEL = "50670001111";
const LID = "123456789012345@lid";

/** `prepareMessage` (4652-4704): key, pushName, message, messageType, messageTimestamp en segundos, contextInfo. */
function aviso(cambios: Record<string, any> = {}) {
  return {
    key: { remoteJid: `${TEL}@s.whatsapp.net`, fromMe: false, id: "3EB0AAAA", addressingMode: "pn", ...(cambios.key ?? {}) },
    pushName: cambios.pushName ?? "Lead de Prueba",
    message: cambios.message ?? { conversation: "hola" },
    messageType: cambios.messageType ?? "conversation",
    messageTimestamp: cambios.messageTimestamp ?? 1_760_000_000,
    contextInfo: cambios.contextInfo ?? null,
  };
}

const mensajesGuardados = () => h.ops.filter((o) => o.tabla === "messages").flatMap((o) => o.valores);

beforeEach(() => {
  h.porSender.clear();
  h.porRawJid.clear();
  h.ops.length = 0;
  h.rpcs.length = 0;
  h.upsertContactForSender.mockReset();
  h.upsertContactForSender.mockImplementation(async ({ senderId }: { senderId: string }) => {
    h.porSender.set(senderId, `ct-${senderId}`);
    return { contactId: `ct-${senderId}`, existed: false };
  });
});

describe("guardado de WhatsApp (F27)", () => {
  it("la fecha del proveedor viene en segundos y se convierte (también un Long de Baileys)", () => {
    expect(fechaDeEvolution(1_760_000_000)).toBe(new Date(1_760_000_000_000).toISOString());
    expect(fechaDeEvolution({ low: 1_760_000_000 })).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it("un entrante: contacto con su teléfono, mensaje con su identificador crudo, y la marca del último entrante", async () => {
    await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.upsert", [aviso()]);
    expect(mensajesGuardados()).toEqual([
      expect.objectContaining({
        direction: "inbound",
        platform_message_id: "3EB0AAAA",
        remote_jid: `${TEL}@s.whatsapp.net`,
        text: "hola",
        message_type: "texto",
        created_at: new Date(1_760_000_000_000).toISOString(),
      }),
    ]);
    expect(h.ops).toContainEqual(expect.objectContaining({ tabla: "contacts", op: "update", valores: { phone: `+${TEL}`, phone_resolved: true } }));
    expect(h.ops).toContainEqual(expect.objectContaining({ tabla: "contact_channels", op: "update", valores: { addressing_mode: "pn" } }));
    expect(h.ops).toContainEqual(expect.objectContaining({ tabla: "channels", op: "update", valores: { last_inbound_at: expect.any(String) } }));
  });

  it("un mensaje propio escrito desde el teléfono (fromMe, 1166 y 1483) se guarda como del negocio, sin marca de entrante", async () => {
    await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.upsert", [
      aviso({ key: { fromMe: true }, pushName: "Você" }),
    ]);
    expect(mensajesGuardados()).toEqual([expect.objectContaining({ direction: "outbound", platform_message_id: "3EB0AAAA" })]);
    // El nombre del contacto no sale de un pushName propio.
    expect(h.upsertContactForSender.mock.calls[0][0]).toMatchObject({ senderName: `+${TEL}` });
    expect(h.ops.some((o) => o.tabla === "channels")).toBe(false);
  });

  it("send.message (2545) usa la misma clave de unicidad: si ya estaba guardado, la base no lo duplica", async () => {
    await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "send.message", [aviso({ key: { fromMe: true } })]);
    const op = h.ops.find((o) => o.tabla === "messages") as any;
    expect(op.opciones).toEqual({ onConflict: "conversation_id,platform_message_id,direction", ignoreDuplicates: true });
  });

  it("las dos formas del aviso: messages.set trae una lista (1049-1052) y se guarda entera, sin sumar no leídos", async () => {
    const r = await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.set", [
      aviso({ key: { id: "H1" } }),
      aviso({ key: { id: "H2" } }),
    ]);
    expect(r.guardados).toBe(2);
    expect(mensajesGuardados().map((m: any) => m.platform_message_id)).toEqual(["H1", "H2"]);
    expect(h.rpcs.some((x) => x.fn === "increment_unread")).toBe(false);
  });

  it("un @lid sin teléfono entra como contacto nuevo con la marca de sin resolver (F26)", async () => {
    await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.upsert", [
      aviso({ key: { remoteJid: LID, addressingMode: "lid" } }),
    ]);
    expect(h.ops).toContainEqual(expect.objectContaining({ tabla: "contacts", op: "update", valores: { phone_resolved: false } }));
    expect(mensajesGuardados()[0]).toMatchObject({ remote_jid: LID });
  });

  it("vía 1 de F26: un mensaje en modo pn con el @lid en remoteJidAlt reconcilia la identidad guardada", async () => {
    h.porRawJid.set(LID, "ct-lid");
    await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.upsert", [
      aviso({ key: { remoteJidAlt: LID, addressingMode: "pn" } }),
    ]);
    expect(h.rpcs).toContainEqual({ fn: "reconciliar_telefono", args: { p_contacto: "ct-lid", p_telefono: `+${TEL}`, p_via: "mensaje" } });
    expect(h.upsertContactForSender).not.toHaveBeenCalled();
  });

  it("vía 2 de F26: un aviso de contacto con los dos identificadores reconcilia", async () => {
    h.porRawJid.set(LID, "ct-lid");
    const n = await procesarAvisoDeContacto(supabaseFalso() as never, CANAL, [
      { remoteJid: `${TEL}@s.whatsapp.net`, remoteJidAlt: LID },
    ]);
    expect(n).toBe(1);
    expect(h.rpcs).toContainEqual({ fn: "reconciliar_telefono", args: expect.objectContaining({ p_via: "aviso_evolution" }) });
  });

  it("vía 2 con la forma real de 2.3.7 (solo remoteJid, 1496-1506): no hay con qué reconciliar", async () => {
    h.porRawJid.set(LID, "ct-lid");
    const n = await procesarAvisoDeContacto(supabaseFalso() as never, CANAL, {
      remoteJid: `${TEL}@s.whatsapp.net`,
      pushName: "Lead",
      profilePicUrl: null,
    });
    expect(n).toBe(0);
    expect(h.rpcs).toEqual([]);
  });

  it("el mensaje citado (contextInfo.stanzaId, 4665) se guarda aunque no exista de nuestro lado", async () => {
    await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.upsert", [
      aviso({ contextInfo: { stanzaId: "3EB0CITADO" } }),
    ]);
    expect(mensajesGuardados()[0]).toMatchObject({ quoted_message_id: "3EB0CITADO" });
  });

  it("click-to-WhatsApp (contextInfo.externalAdReply): primer y último toque (F25)", async () => {
    await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.upsert", [
      aviso({ contextInfo: { externalAdReply: { sourceId: "AD-1", ctwaClid: "CLID-1", sourceType: "ad", sourceUrl: "https://fb.me/x?utm_source=meta" } } }),
    ]);
    const op = h.ops.find((o) => o.tabla === "contacts" && o.valores?.attribution);
    expect(op?.valores.attribution).toMatchObject({
      first_click: { ad_id: "AD-1", ctwa_clid: "CLID-1", channel: "whatsapp", source: "meta" },
      last_click: { ad_id: "AD-1" },
    });
  });

  it("tipos: imagen, audio, documento, video, sticker y ubicación; los de archivo quedan con el adjunto pendiente (F28)", () => {
    const casos: Array<[string, string]> = [
      ["imageMessage", "imagen"],
      ["audioMessage", "audio"],
      ["documentMessage", "documento"],
      ["videoMessage", "video"],
      ["stickerMessage", "sticker"],
      ["locationMessage", "ubicacion"],
    ];
    for (const [crudo, tipo] of casos) {
      const t = traducirMensaje(aviso({ messageType: crudo, message: { [crudo]: { mimetype: "x/y" } } }) as never);
      expect(t.messageType).toBe(tipo);
      expect(Boolean(t.attachments)).toBe(tipo !== "ubicacion");
    }
  });

  it("los grupos y las difusiones no son un contacto: se saltean", async () => {
    const r = await guardarMensajesDeEvolution(supabaseFalso() as never, CANAL, "messages.upsert", [
      aviso({ key: { remoteJid: "120363000000000000@g.us" } }),
      aviso({ key: { remoteJid: "status@broadcast" } }),
    ]);
    expect(r).toEqual({ guardados: 0, salteados: 2 });
  });
});
