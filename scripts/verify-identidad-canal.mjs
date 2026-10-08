#!/usr/bin/env node
/**
 * Verificación de F26 contra la base real (migración 00031), con datos
 * simulados en un espacio fantasma.
 *
 * Lo que prueba:
 *   A. `contact_channels` guarda el identificador crudo y el modo, y el crudo
 *      no se sobrescribe. El relleno de las filas existentes no dejó ninguna
 *      sin identificador (lectura sobre los datos reales, sin escribir).
 *   B. `messages.remote_jid` existe y no se sobrescribe.
 *   C. La identidad del canal: solo un canal activo por ranura de Zernio, y el
 *      reemplazo (desactivar la vieja, crear otra) sí entra.
 *   D. `reconciliar_telefono`: la vía manual resuelve y queda en el historial
 *      con su autor; un Member no toca un contacto ajeno; si el teléfono ya es
 *      de otro contacto devuelve el conflicto sin escribir, y a un Member no le
 *      muestra nada de un contacto que no es suyo; las vías automáticas son
 *      solo del servidor.
 *   E. `fusionar_contactos`: solo Owner y Admin; une canales, conversaciones
 *      (con sus mensajes), etiquetas y atribución (el primer clic más viejo);
 *      borra el absorbido y deja su foto en el historial.
 *   F. `contar_mensajes_sin_telefono`: entrantes de WhatsApp de los últimos 7
 *      días, y cuántos sin teléfono resuelto (`@lid`).
 *
 * LO QUE NO PRUEBA, Y QUEDA PARA F27: nada de esto viene de un mensaje real de
 * WhatsApp. Los mensajes y los identificadores son simulados, porque los
 * entrantes recién se guardan con F27.
 *
 * ESTADO ESPERADO: falla antes de la 00031 y pasa después.
 *
 * Uso: node scripts/verify-identidad-canal.mjs
 */
import {
  admin, rpcAdmin, rpcComo, comoUsuario, check, noConcluyente, correr,
  crearUsuario, sumarAlEspacio, crearContacto, limpiar, sufijo,
} from "./lib-verificador.mjs";

const ok = (r) => r.status >= 200 && r.status < 300;
const dias = (n) => new Date(Date.now() - n * 864e5).toISOString();

async function insertar(tabla, fila) {
  const r = await admin(tabla, { method: "POST", body: JSON.stringify(fila) });
  if (!ok(r)) throw new Error(`no se pudo insertar en ${tabla}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data[0];
}

await correr(async () => {
  console.log("Escenario");
  const owner = await crearUsuario("owner");
  const member = await crearUsuario("member");
  const W = owner.espacio;
  await sumarAlEspacio(W, member, "member");

  // ── A. Identificador crudo ───────────────────────────────────────────────
  console.log("\nA. contact_channels: identificador crudo y modo");
  const sinCrudo = await admin("contact_channels?select=id&raw_jid=is.null&limit=1");
  const columnasOk = check(ok(sinCrudo), "la columna raw_jid existe (control positivo de lo que sigue)",
    `HTTP ${sinCrudo.status} ${JSON.stringify(sinCrudo.data).slice(0, 160)}`);
  if (!columnasOk) {
    noConcluyente("A a F", "la migración 00031 no está aplicada");
    return;
  }
  check((sinCrudo.data ?? []).length === 0, "ninguna fila existente quedó sin identificador crudo (relleno)");

  const canalWa = await insertar("channels", {
    workspace_id: W, platform: "whatsapp", provider: "evolution", instance_name: `b3-${sufijo}`, is_active: false,
  });
  limpiar.canales.push(canalWa.id);
  const canalIg = await insertar("channels", {
    workspace_id: W, platform: "instagram", late_account_id: `b3-ig-${sufijo}`, is_active: false,
  });
  limpiar.canales.push(canalIg.id);

  const cLid = await crearContacto(W, { display_name: `lid-${sufijo}`, phone_resolved: false, setter_id: member.id });
  const cc = await insertar("contact_channels", {
    contact_id: cLid.id, channel_id: canalWa.id, platform_sender_id: `99${sufijo}@lid`,
    raw_jid: `99${sufijo}@lid`, addressing_mode: "lid",
  });
  check(cc.raw_jid === `99${sufijo}@lid` && cc.addressing_mode === "lid", "guarda el identificador tal como llegó y el modo");
  const modo = await admin(`contact_channels?id=eq.${cc.id}`, { method: "PATCH", body: JSON.stringify({ addressing_mode: "pn" }) });
  const pisar = await admin(`contact_channels?id=eq.${cc.id}`, { method: "PATCH", body: JSON.stringify({ raw_jid: "otro@s.whatsapp.net" }) });
  if (check(ok(modo), "el modo se puede actualizar (control positivo)")) {
    check(pisar.status >= 400, "el identificador crudo no se sobrescribe", `HTTP ${pisar.status}`);
  } else noConcluyente("el crudo no se sobrescribe", "ni el modo se pudo actualizar");

  // ── B. Identificador del mensaje ─────────────────────────────────────────
  console.log("\nB. messages.remote_jid");
  const conv = await insertar("conversations", { workspace_id: W, channel_id: canalWa.id, contact_id: cLid.id, platform: "whatsapp" });
  const m = await insertar("messages", { conversation_id: conv.id, direction: "inbound", text: "hola", remote_jid: `99${sufijo}@lid` });
  check(m.remote_jid === `99${sufijo}@lid`, "el mensaje guarda el identificador con que llegó (control positivo)");
  const pisarMsg = await admin(`messages?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ remote_jid: "otro@s.whatsapp.net" }) });
  check(pisarMsg.status >= 400, "ese identificador no se sobrescribe", `HTTP ${pisarMsg.status}`);

  // ── C. Identidad del canal ───────────────────────────────────────────────
  console.log("\nC. Un canal activo por ranura de Zernio");
  const ranura = `b3-ranura-${sufijo}`;
  const viejo = await insertar("channels", {
    workspace_id: W, platform: "instagram", late_account_id: ranura, platform_account_id: "cuenta-vieja", is_active: true,
  });
  limpiar.canales.push(viejo.id);
  const duplicado = await admin("channels", { method: "POST", body: JSON.stringify({
    workspace_id: W, platform: "instagram", late_account_id: ranura, platform_account_id: "cuenta-nueva", is_active: true,
  }) });
  if (duplicado.data?.[0]?.id) limpiar.canales.push(duplicado.data[0].id);
  check(duplicado.status === 409 || duplicado.data?.code === "23505", "dos canales activos en la misma ranura se rechazan", `HTTP ${duplicado.status}`);
  await admin(`channels?id=eq.${viejo.id}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
  const nuevo = await admin("channels", { method: "POST", body: JSON.stringify({
    workspace_id: W, platform: "instagram", late_account_id: ranura, platform_account_id: "cuenta-nueva", is_active: true,
  }) });
  if (nuevo.data?.[0]?.id) limpiar.canales.push(nuevo.data[0].id);
  check(ok(nuevo), "con la vieja desactivada, el canal nuevo de la misma ranura entra (el reemplazo de F26)", `HTTP ${nuevo.status}`);

  // ── D. Reconciliar ───────────────────────────────────────────────────────
  console.log("\nD. reconciliar_telefono");
  const telAjeno = `+5067${sufijo.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}`;
  const telNuevo = `+5068${sufijo.replace(/\D/g, "").padEnd(7, "2").slice(0, 7)}`;
  const ajeno = await crearContacto(W, { display_name: `ajeno-${sufijo}`, phone: telAjeno });
  const sinResolver2 = await crearContacto(W, { display_name: `lid2-${sufijo}`, phone_resolved: false, setter_id: member.id });

  const manual = await rpcComo(member.token, "reconciliar_telefono", { p_contacto: cLid.id, p_telefono: telNuevo, p_via: "manual" });
  const resolvio = check(ok(manual) && manual.data?.resultado === "resuelto", "un Member resuelve a mano el teléfono de su lead (control positivo)",
    `HTTP ${manual.status} ${JSON.stringify(manual.data).slice(0, 200)}`);
  const { data: trasManual } = await admin(`contacts?id=eq.${cLid.id}&select=phone,phone_resolved`);
  check(trasManual?.[0]?.phone === telNuevo && trasManual?.[0]?.phone_resolved === true, "quedó el teléfono y se sacó la marca");
  const hist = await comoUsuario(member.token, `audit_log?select=action,actor_id,detail,changes&entity_id=eq.${cLid.id}`);
  check((hist.data ?? []).some((e) => e.action === "contacto.reconciliado" && e.actor_id === member.id && e.detail?.via === "manual"),
    "queda en el historial como reconciliado, con su autor y la vía, y el Member lo ve", JSON.stringify(hist.data).slice(0, 200));

  const sobreAjeno = await rpcComo(member.token, "reconciliar_telefono", { p_contacto: ajeno.id, p_telefono: telNuevo, p_via: "manual" });
  if (resolvio) check(sobreAjeno.status >= 400, "un Member no reconcilia un contacto que no es suyo", `HTTP ${sobreAjeno.status}`);
  else noConcluyente("un Member no reconcilia lo ajeno", "la vía manual no funcionó ni sobre lo propio");

  const conflictoMember = await rpcComo(member.token, "reconciliar_telefono", { p_contacto: sinResolver2.id, p_telefono: telAjeno, p_via: "manual" });
  check(conflictoMember.data?.resultado === "conflicto" && conflictoMember.data?.visible === false && !conflictoMember.data?.otro_id,
    "con el teléfono de un contacto ajeno, el Member ve que hay conflicto, sin ningún dato del otro", JSON.stringify(conflictoMember.data));
  const conflictoOwner = await rpcComo(owner.token, "reconciliar_telefono", { p_contacto: sinResolver2.id, p_telefono: telAjeno, p_via: "manual" });
  check(conflictoOwner.data?.resultado === "conflicto" && conflictoOwner.data?.otro_id === ajeno.id,
    "el Owner ve con qué contacto choca, para proponer la fusión", JSON.stringify(conflictoOwner.data));
  const { data: trasConflicto } = await admin(`contacts?id=eq.${sinResolver2.id}&select=phone,phone_resolved`);
  check(trasConflicto?.[0]?.phone === null && trasConflicto?.[0]?.phone_resolved === false, "el conflicto no escribió nada: sigue sin resolver");

  const autoMember = await rpcComo(member.token, "reconciliar_telefono", { p_contacto: sinResolver2.id, p_telefono: `+1555${sufijo.replace(/\D/g, "").slice(0, 4)}`, p_via: "mensaje" });
  check(autoMember.status >= 400, "las vías automáticas (mensaje, aviso de Evolution) no las llama un usuario", `HTTP ${autoMember.status}`);
  const cAuto = await crearContacto(W, { display_name: `auto-${sufijo}`, phone_resolved: false });
  const auto = await rpcAdmin("reconciliar_telefono", { p_contacto: cAuto.id, p_telefono: `+1555${sufijo.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}`, p_via: "mensaje" });
  check(auto.data?.resultado === "resuelto", "el servidor sí resuelve por un mensaje posterior (simulado)", JSON.stringify(auto.data));
  const { data: histAuto } = await admin(`audit_log?select=actor_label,detail&entity_id=eq.${cAuto.id}`);
  check(histAuto?.[0]?.actor_label === "Sistema" && histAuto?.[0]?.detail?.via === "mensaje", "y queda en el historial con el Sistema como actor");
  const invalido = await rpcComo(owner.token, "reconciliar_telefono", { p_contacto: sinResolver2.id, p_telefono: "8856-12", p_via: "manual" });
  check(invalido.status >= 400, "un teléfono que no es E.164 se rechaza", `HTTP ${invalido.status}`);

  // ── E. Fusionar ──────────────────────────────────────────────────────────
  console.log("\nE. fusionar_contactos");
  const viejoClic = { source: "meta", captured_at: "2026-09-01T00:00:00Z" };
  const nuevoClic = { source: "google", captured_at: "2026-10-01T00:00:00Z" };
  await admin(`contacts?id=eq.${sinResolver2.id}`, { method: "PATCH", body: JSON.stringify({ attribution: { first_click: viejoClic, last_click: viejoClic } }) });
  await admin(`contacts?id=eq.${ajeno.id}`, { method: "PATCH", body: JSON.stringify({ attribution: { first_click: nuevoClic, last_click: nuevoClic } }) });
  await insertar("contact_channels", { contact_id: sinResolver2.id, channel_id: canalWa.id, platform_sender_id: `77${sufijo}@lid`, raw_jid: `77${sufijo}@lid` });
  const convAbs = await insertar("conversations", { workspace_id: W, channel_id: canalIg.id, contact_id: sinResolver2.id, platform: "instagram" });
  const convCons = await insertar("conversations", { workspace_id: W, channel_id: canalIg.id, contact_id: ajeno.id, platform: "instagram" });
  await insertar("messages", { conversation_id: convAbs.id, direction: "inbound", text: "a1" });
  await insertar("messages", { conversation_id: convAbs.id, direction: "inbound", text: "a2" });
  await insertar("messages", { conversation_id: convCons.id, direction: "inbound", text: "c1" });
  const t1 = await insertar("tags", { workspace_id: W, name: `t1-${sufijo}` });
  const t2 = await insertar("tags", { workspace_id: W, name: `t2-${sufijo}` });
  await insertar("contact_tags", { contact_id: sinResolver2.id, tag_id: t1.id });
  await insertar("contact_tags", { contact_id: sinResolver2.id, tag_id: t2.id });
  await insertar("contact_tags", { contact_id: ajeno.id, tag_id: t1.id });

  const porMember = await rpcComo(member.token, "fusionar_contactos", { p_conservar: ajeno.id, p_absorber: sinResolver2.id });
  const { data: sigue } = await admin(`contacts?id=eq.${sinResolver2.id}&select=id`);
  check(porMember.status >= 400 && sigue?.length === 1, "un Member no puede fusionar: borra un contacto", `HTTP ${porMember.status}`);

  const fusion = await rpcComo(owner.token, "fusionar_contactos", { p_conservar: ajeno.id, p_absorber: sinResolver2.id });
  const fusiono = check(ok(fusion), "el Owner fusiona (control positivo)", `HTTP ${fusion.status} ${JSON.stringify(fusion.data).slice(0, 300)}`);
  if (fusiono) {
    const { data: absorbido } = await admin(`contacts?id=eq.${sinResolver2.id}&select=id`);
    check(absorbido?.length === 0, "el absorbido ya no existe");
    const { data: canales } = await admin(`contact_channels?select=contact_id&platform_sender_id=eq.77${sufijo}@lid`);
    check(canales?.[0]?.contact_id === ajeno.id, "su canal pasó al que queda");
    const { data: msgs } = await admin(`messages?select=text&conversation_id=eq.${convCons.id}`);
    check((msgs ?? []).map((x) => x.text).sort().join(",") === "a1,a2,c1", "las conversaciones del mismo canal quedaron en una, con todos los mensajes",
      JSON.stringify(msgs));
    const { data: convs } = await admin(`conversations?select=id&id=eq.${convAbs.id}`);
    check(convs?.length === 0, "la conversación vacía del absorbido no queda colgada");
    const { data: tags } = await admin(`contact_tags?select=tag_id&contact_id=eq.${ajeno.id}`);
    check(new Set((tags ?? []).map((x) => x.tag_id)).size === 2, "las etiquetas quedaron unidas, sin repetir");
    const { data: atr } = await admin(`contacts?id=eq.${ajeno.id}&select=attribution`);
    check(atr?.[0]?.attribution?.first_click?.source === "meta" && atr?.[0]?.attribution?.last_click?.source === "google",
      "la atribución une el primer clic más viejo y el último más nuevo", JSON.stringify(atr?.[0]?.attribution));
    const { data: histFusion } = await admin(`audit_log?select=action,actor_id,detail&entity_id=eq.${ajeno.id}&action=eq.contacto.fusionado`);
    check(histFusion?.[0]?.actor_id === owner.id && histFusion?.[0]?.detail?.absorbido?.display_name === `lid2-${sufijo}`,
      "queda en el historial, con la foto del absorbido para poder reconstruir la fusión");
  } else {
    noConcluyente("lo que une la fusión", "la fusión no corrió");
  }

  // ── F. Contador ──────────────────────────────────────────────────────────
  console.log("\nF. contar_mensajes_sin_telefono");
  const cConteo = await crearContacto(W, { display_name: `conteo-${sufijo}` });
  const canalWa2 = await insertar("channels", { workspace_id: W, platform: "whatsapp", provider: "evolution", instance_name: `b3c-${sufijo}`, is_active: false });
  limpiar.canales.push(canalWa2.id);
  const convWa = await insertar("conversations", { workspace_id: W, channel_id: canalWa2.id, contact_id: cConteo.id, platform: "whatsapp" });
  const convIg = await insertar("conversations", { workspace_id: W, channel_id: canalIg.id, contact_id: cConteo.id, platform: "instagram" });
  const msg = (conversation_id, direction, remote_jid, created_at = dias(1)) =>
    insertar("messages", { conversation_id, direction, text: "x", remote_jid, created_at });
  // La conversación de WhatsApp del contacto con el lid de arriba también cuenta: tiene 1 entrante @lid.
  await msg(convWa.id, "inbound", "1@lid");
  await msg(convWa.id, "inbound", "2@lid");
  await msg(convWa.id, "inbound", "50670000000@s.whatsapp.net");
  await msg(convWa.id, "inbound", "50670000001@s.whatsapp.net");
  await msg(convWa.id, "outbound", "3@lid");
  await msg(convIg.id, "inbound", null);
  await msg(convWa.id, "inbound", "4@lid", dias(8));
  const conteo = await rpcComo(owner.token, "contar_mensajes_sin_telefono", { p_workspace: W, p_desde: dias(7) });
  const fila = Array.isArray(conteo.data) ? conteo.data[0] : conteo.data;
  check(ok(conteo) && fila?.sin_telefono === 3 && fila?.total === 5,
    "cuenta los entrantes de WhatsApp de los últimos 7 días (5) y los que llegaron sin teléfono (3)",
    `HTTP ${conteo.status} ${JSON.stringify(conteo.data)}`);
  const otroEspacio = await rpcComo(member.token, "contar_mensajes_sin_telefono", { p_workspace: member.espacio, p_desde: dias(7) });
  const filaOtro = Array.isArray(otroEspacio.data) ? otroEspacio.data[0] : otroEspacio.data;
  check(filaOtro?.total === 0, "en otro espacio no cuenta los mensajes de este", JSON.stringify(otroEspacio.data));
});
