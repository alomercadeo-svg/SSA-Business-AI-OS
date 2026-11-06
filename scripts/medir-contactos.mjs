#!/usr/bin/env node
/**
 * F43, la medición M del tramo B de S9 (con el OK de Marcos del 05/11/2026):
 * cuánto tardan las funciones de la 00049, por PostgREST, con la seguridad
 * por filas de quien llama. Solo en un espacio fantasma, que crea y borra:
 * 800 contactos con su canal de Instagram y su usuario, un cuarto del Member.
 *
 * Solo imprime tiempos y cantidades. Tres corridas de cada cosa. El freno:
 * si la cantidad con búsqueda pasa de 1,5 s, lo dice y sale con 1.
 *
 * 06/11/2026, ítem 5 del plan maestro (la 00051): suma 400 conversaciones, una
 * por cada uno de los primeros 400 contactos, con un mensaje cada una: del lead
 * (inbound) en las pares y del negocio (outbound) en las impares. Así 200
 * escribieron, y se miden los casos con `escribieron: 'si'`, con el mismo freno.
 *
 * Uso: node scripts/medir-contactos.mjs
 */
import { admin, check, correr, crearUsuario, limpiar, rpcComo, sufijo, sumarAlEspacio } from "./lib-verificador.mjs";

const N = 800;
const FRENO_MS = 1500;
let espacios = [];

await correr(async () => {
  const owner = await crearUsuario("medir-owner");
  const member = await crearUsuario("medir-member");
  const E = owner.espacio;
  espacios = [E, member.espacio];
  await sumarAlEspacio(E, member, "member");
  try {
    const canal = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: E, is_active: true, umbral_silencio_horas: null, platform: "instagram", provider: "zernio", late_account_id: `medir${sufijo}${Date.now()}`, username: `medir${sufijo}` }) })).data?.[0]?.id;
    if (!canal) throw new Error("no se pudo crear el canal");
    const ahora = Date.now();
    const alta = await admin("contacts", {
      method: "POST",
      body: JSON.stringify(Array.from({ length: N }, (_, k) => ({
        workspace_id: E,
        display_name: k === 700 ? `Tania Robles ${sufijo}` : `medir-${k}-${sufijo}`,
        email: `medir-${k}-${sufijo}@ssa-test.local`,
        setter_id: k % 4 === 0 ? member.id : null,
        last_interaction_at: new Date(ahora - k * 60_000).toISOString(),
      }))),
    });
    if (!Array.isArray(alta.data) || alta.data.length !== N) throw new Error(`no se crearon los contactos: HTTP ${alta.status}`);
    const canales = await admin("contact_channels", {
      method: "POST",
      body: JSON.stringify(alta.data.map((c, k) => ({ contact_id: c.id, channel_id: canal, platform_sender_id: `medir-${k}-${sufijo}`, raw_jid: `medir-${k}-${sufijo}`, platform_username: `medir.usuario.${k}` }))),
    });
    if (!Array.isArray(canales.data) || canales.data.length !== N) throw new Error(`no se crearon los canales: HTTP ${canales.status}`);
    const convs = await admin("conversations", {
      method: "POST",
      body: JSON.stringify(alta.data.slice(0, 400).map((c) => ({ workspace_id: E, channel_id: canal, contact_id: c.id, platform: "instagram", historial_estado: "completo", last_message_at: new Date(ahora).toISOString() }))),
    });
    if (!Array.isArray(convs.data) || convs.data.length !== 400) throw new Error(`no se crearon las conversaciones: HTTP ${convs.status}`);
    const mensajes = await admin("messages", {
      method: "POST",
      body: JSON.stringify(convs.data.map((cv, k) => ({ conversation_id: cv.id, direction: k % 2 === 0 ? "inbound" : "outbound", text: `medir-${sufijo}`, platform_message_id: `medir-${k}-${sufijo}` }))),
    });
    if (!Array.isArray(mensajes.data) || mensajes.data.length !== 400) throw new Error(`no se crearon los mensajes: HTTP ${mensajes.status}`);
    console.log(`Espacio fantasma ${E.slice(0, 8)}: ${N} contactos, ${N} canales, ${N / 4} del Member, 400 conversaciones (200 con mensaje del lead)`);

    const casos = [
      ["cantidad, sin filtros", "contactos_cantidad", {}, true],
      ["cantidad, «tania robles»", "contactos_cantidad", { q: "tania robles" }, true],
      ["cantidad, palabra inexistente", "contactos_cantidad", { q: `zqxw${sufijo}` }, true],
      ["cantidad, «medir.usuario.799»", "contactos_cantidad", { q: "medir.usuario.799" }, true],
      ["página 1, «tania»", "contactos_pagina", { q: "tania" }, false],
      ["página 1, sin filtros", "contactos_pagina", {}, false],
      ["cantidad, escribieron", "contactos_cantidad", { escribieron: "si" }, true],
      ["cantidad, «medir» y escribieron", "contactos_cantidad", { q: "medir", escribieron: "si" }, true],
      ["página 1, escribieron", "contactos_pagina", { escribieron: "si" }, false],
    ];
    let peor = 0;
    for (const [quien, u] of [["Owner", owner], ["Member", member]]) {
      for (const [nombre, fn, filtros, esCantidad] of casos) {
        const tiempos = [];
        let cantidad = null;
        for (let i = 0; i < 3; i++) {
          const args = esCantidad ? { p_workspace: E, p_filtros: filtros } : { p_workspace: E, p_filtros: filtros, p_pagina: 1, p_por_pagina: 50 };
          const t0 = performance.now();
          const r = await rpcComo(u.token, fn, args);
          tiempos.push(Math.round(performance.now() - t0));
          if (r.status !== 200) throw new Error(`${fn}: HTTP ${r.status}`);
          cantidad = esCantidad ? Number(r.data) : r.data.length;
        }
        if (esCantidad && (filtros.q || filtros.escribieron)) peor = Math.max(peor, ...tiempos);
        console.log(`  ${quien} · ${nombre}: ${tiempos.join(" / ")} ms · ${esCantidad ? "cantidad" : "filas"} ${cantidad}`);
      }
    }
    check(peor <= FRENO_MS, `la cantidad con búsqueda no pasa de ${FRENO_MS} ms (la peor: ${peor} ms)`);
  } finally {
    const r = await admin(`contacts?workspace_id=in.(${espacios.join(",")})`, { method: "DELETE" });
    check(r.status < 300, "se borran los contactos del espacio fantasma", `HTTP ${r.status}`);
    limpiar.contactos.length = 0;
  }
}, async () => {
  const ids = limpiar.workspaces.join(",");
  const cuenta = async (path) => ((await admin(path)).data ?? []).length;
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`channels?select=id&workspace_id=in.(${ids})`)) === 0, "channels: 0");
  check((await cuenta(`conversations?select=id&workspace_id=in.(${ids})`)) === 0, "conversations: 0");
});
