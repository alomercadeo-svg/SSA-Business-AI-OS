#!/usr/bin/env node
/**
 * F30, la ficha, con sesiones reales contra PRODUCCIÓN, en un espacio fantasma
 * que este script crea y borra. Nunca en «Ale Admin's Workspace». Lee el HTML
 * que sirve producción con la cookie real de cada uno (como
 * `verify-asignacion.mjs`) y llama la ruta de «Editar datos» igual que el botón.
 *
 * LO QUE PRUEBA:
 *   - La ficha de un contacto con todos los datos del criterio: nombre,
 *     correos, teléfono, redes (el usuario de cada canal), país, setter,
 *     vendedor, temperatura, seguimiento, atribución, etiquetas, campos
 *     propios, notas, historial; las conversaciones agrupadas por canal, cada
 *     una con su enlace al hilo; la marca «No contactar» (el dato lo escribe
 *     F34: acá lo pone la clave de servicio en el espacio fantasma) y la de
 *     «Teléfono sin resolver»; «Editar datos»; «Eliminar» solo para el Owner;
 *     la hora en la zona de Costa Rica, no en UTC.
 *   - «Editar datos» por la ruta: el Member edita su lead y no uno ajeno; queda
 *     «contacto editado» con antes y después; un nombre escrito a mano queda
 *     `manual`; sin origen de la aplicación, 403.
 *   - El clic al hilo (ajuste de Marcos del 20/10/2026): con
 *     `?conversacion=` de una suya que está más abajo de las primeras 50, el
 *     Member la ve y lee sus mensajes; con una ajena no ve nada, ni el hilo ni
 *     los mensajes; y la lista no cambia, ni de contenido ni de orden.
 *
 * LOS CONTROLES. El Member lee su lead antes que nada. La ausencia de la
 * conversación ajena vale porque el Owner la ve con el mismo pedido. La de la
 * profunda en la lista sin parámetro vale porque con el parámetro aparece.
 *
 * QUÉ CAMBIA CADA PASO. Las lecturas de HTML no escriben. Las ediciones van
 * después de las lecturas de la ficha, y cada rechazo se relee con la clave de
 * servicio.
 *
 * Uso: node scripts/verify-ficha.mjs
 */
import { admin, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const RELLENO = 54;

let espacioFantasma = null;
let usuariosFantasma = [];

/** La cookie como la arma `@supabase/ssr` 0.8.0, más la del espacio elegido. */
function cookieDe(u) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacioFantasma}`);
  return partes.join("; ");
}

/** El HTML, sin los separadores `<!-- -->` que React mete entre textos contiguos. */
async function pagina(u, ruta) {
  const res = await fetch(`${APP_URL}${ruta}`, { headers: { Cookie: cookieDe(u) }, redirect: "manual" });
  const html = (await res.text()).replace(/<!-- -->/g, "");
  return { status: res.status, html };
}

async function editar(u, contacto, cuerpo, origen = APP_URL) {
  const headers = { Cookie: cookieDe(u), "Content-Type": "application/json" };
  if (origen) headers.Origin = origen;
  const res = await fetch(`${APP_URL}/api/v1/contacts/${contacto}`, { method: "PATCH", headers, body: JSON.stringify(cuerpo), redirect: "manual" });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}

async function mensajesDe(u, conv) {
  const res = await fetch(`${APP_URL}/api/v1/messages?conversationId=${conv}`, { headers: { Cookie: cookieDe(u) }, redirect: "manual" });
  return { status: res.status, texto: await res.text() };
}

const filas = async (path) => (await admin(path)).data ?? [];
/**
 * Un id que llega como DATO de una fila (`"id":"…"`, con las comillas escapadas
 * dentro del script de la página), no suelto: Next también escribe en la
 * página la dirección pedida, con su `?conversacion=`, y buscar el id suelto
 * lo encontraba ahí (visto en rojo el 20/10/2026 contra el código viejo).
 */
const ID_COMO_DATO = /\\?"id\\?":\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const idsComoDato = (html) => [...html.matchAll(ID_COMO_DATO)].map((m) => m[1]);
/** El orden en que aparecen por primera vez estos ids, como dato, en el HTML. */
const ordenDe = (html, ids) => {
  const vistos = [];
  for (const id of idsComoDato(html)) if (ids.has(id) && !vistos.includes(id)) vistos.push(id);
  return vistos;
};
const traeComoDato = (html, id) => idsComoDato(html).includes(id);

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo`);
  const owner = await crearUsuario("ficha-owner");
  const member = await crearUsuario("ficha-member");
  usuariosFantasma = [owner.id, member.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, member, "member");
  console.log(`  espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  try {
    // ── El escenario ───────────────────────────────────────────────────────
    const nuevoCanal = async (campos) => (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...campos }) })).data?.[0]?.id;
    const IG_CUENTA = `b3fichacuenta${sufijo}`;
    const canalIg = await nuevoCanal({ platform: "instagram", provider: "zernio", late_account_id: `b3ficha${sufijo}${Date.now()}`, username: IG_CUENTA });
    const canalWa = await nuevoCanal({ platform: "whatsapp", provider: "evolution", instance_name: `b3-ficha-${sufijo}` });
    if (!canalIg || !canalWa) throw new Error("no se pudieron crear los canales fantasma");

    const NOMBRE = `B3 Ficha ${sufijo}`;
    const IG_USUARIO = `b3.ficha.${sufijo}`;
    const TAG = `b3-etiqueta-${sufijo}`;
    const CAMPO = `B3 campo ${sufijo}`;
    const MOTIVO = `b3-motivo-${sufijo}`;
    const F = (await crearContacto(espacio, {
      display_name: NOMBRE,
      email: `ficha-${sufijo}@ssa-test.local`,
      secondary_email: `otra-${sufijo}@ssa-test.local`,
      phone: "+50670009999",
      phone_resolved: true,
      country: "Costa Rica",
      lead_temperature: "tibio",
      next_followup_date: "2026-11-03",
      setter_id: member.id,
      vendedor_id: owner.id,
      do_not_contact: true,
      do_not_contact_reason: MOTIVO,
      do_not_contact_at: "2026-10-18T15:00:00Z",
      last_interaction_at: "2026-10-19T20:40:00Z",
      attribution: { first_click: { source: "meta", medium: "cpc", campaign: `b3c${sufijo}`, captured_at: "2026-10-01T15:00:00Z" } },
    })).id;
    const U = (await crearContacto(espacio, { display_name: `B3 Sin Resolver ${sufijo}`, phone_resolved: false, setter_id: member.id })).id;
    const A = (await crearContacto(espacio, { display_name: `B3 Ajeno ${sufijo}` })).id;

    const tag = (await admin("tags", { method: "POST", body: JSON.stringify({ workspace_id: espacio, name: TAG }) })).data?.[0]?.id;
    await admin("contact_tags", { method: "POST", body: JSON.stringify({ contact_id: F, tag_id: tag }) });
    // La columna es `type` (no `field_type`): con el nombre equivocado, el alta
    // fallaba sin que el script lo notara (visto el 20/10/2026).
    const def = (await admin("custom_field_definitions", { method: "POST", body: JSON.stringify({ workspace_id: espacio, name: CAMPO, slug: `b3_campo_${sufijo}`, type: "text" }) })).data?.[0]?.id;
    const valor = await admin("contact_custom_fields", { method: "POST", body: JSON.stringify({ contact_id: F, field_id: def, value: `valor-${sufijo}` }) });
    if (!def || valor.status >= 300) throw new Error(`no se pudo crear el campo propio: ${JSON.stringify(valor.data).slice(0, 200)}`);
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: F, channel_id: canalIg, platform_sender_id: `ig-${sufijo}`, raw_jid: `ig-${sufijo}`, platform_username: IG_USUARIO }) });
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: F, channel_id: canalWa, platform_sender_id: "50670009999@s.whatsapp.net", raw_jid: "50670009999@s.whatsapp.net" }) });
    const conv = async (contacto, canal, platform, cuando) =>
      (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canal, contact_id: contacto, platform, historial_estado: "completo", last_message_at: cuando, last_message_preview: `prev-${sufijo}` }) })).data?.[0]?.id;
    const ahora = Date.now();
    const convFIg = await conv(F, canalIg, "instagram", new Date(ahora - 60_000).toISOString());
    const convFWa = await conv(F, canalWa, "whatsapp", new Date(ahora - 120_000).toISOString());
    const convA = await conv(A, canalWa, "whatsapp", new Date(ahora - 30_000).toISOString());
    await admin("messages", { method: "POST", body: JSON.stringify({ conversation_id: convA, direction: "inbound", text: `ajeno-${sufijo}`, platform_message_id: `b3-ficha-A-${sufijo}` }) });
    // Un video sin texto como último mensaje de la de WhatsApp, con el resumen
    // vacío, como lo deja el receptor: la ficha tiene que decir «Video», no
    // «Sin mensajes» (lectura de Marcos del 20/10/2026).
    await admin("messages", { method: "POST", body: JSON.stringify({ conversation_id: convFWa, direction: "inbound", message_type: "video", platform_message_id: `b3-ficha-video-${sufijo}` }) });
    await admin(`conversations?id=eq.${convFWa}`, { method: "PATCH", body: JSON.stringify({ last_message_preview: "" }) });
    const NOTA = `nota-del-owner-${sufijo}`;
    await comoUsuario(owner.token, "contact_notes", { method: "POST", body: JSON.stringify({ workspace_id: espacio, contact_id: F, body: NOTA }) });

    // El relleno del Member, más reciente, y D, la más vieja: queda más abajo de las 50.
    const relleno = Array.from({ length: RELLENO }, (_, i) => ({ workspace_id: espacio, display_name: `b3-ficha-r${i}-${sufijo}`, setter_id: member.id }));
    const alta = await admin("contacts", { method: "POST", body: JSON.stringify(relleno) });
    if (!Array.isArray(alta.data) || alta.data.length !== RELLENO) throw new Error(`no se creó el relleno: HTTP ${alta.status}`);
    const convRelleno = await admin("conversations", {
      method: "POST",
      body: JSON.stringify(alta.data.map((c, i) => ({ workspace_id: espacio, channel_id: canalWa, contact_id: c.id, platform: "whatsapp", historial_estado: "completo", last_message_at: new Date(ahora - 300_000 - i * 60_000).toISOString() }))),
    });
    const D_CONTACTO = (await crearContacto(espacio, { display_name: `b3-ficha-D-${sufijo}`, setter_id: member.id })).id;
    const D = await conv(D_CONTACTO, canalWa, "whatsapp", new Date(ahora - 40 * 86_400_000).toISOString());
    await admin("messages", { method: "POST", body: JSON.stringify({ conversation_id: D, direction: "inbound", text: `profunda-${sufijo}`, platform_message_id: `b3-ficha-D-${sufijo}` }) });
    const idsDelMember = new Set([convFIg, convFWa, ...(convRelleno.data ?? []).map((c) => c.id), D]);
    console.log(`  F ${F.slice(0, 8)}, U ${U.slice(0, 8)}, A ${A.slice(0, 8)}; ${idsDelMember.size} conversaciones del Member, D ${D.slice(0, 8)} la más vieja`);

    titulo("Control: el Member lee su lead F con su token");
    const sesionOk = check((await comoUsuario(member.token, `contacts?select=id&id=eq.${F}`)).data?.length === 1, "el Member lee F");

    titulo("La ficha de F, como la ve el Owner");
    const fo = await pagina(owner, `/dashboard/contacts/${F}`);
    check(fo.status === 200, "HTTP 200", `HTTP ${fo.status}`);
    const tiene = (html, texto, desc) => check(html.includes(texto), desc ?? `muestra «${texto}»`);
    tiene(fo.html, NOMBRE, "el nombre");
    tiene(fo.html, `ficha-${sufijo}@ssa-test.local`, "el correo");
    tiene(fo.html, `otra-${sufijo}@ssa-test.local`, "el correo secundario");
    tiene(fo.html, "+50670009999", "el teléfono");
    tiene(fo.html, "Costa Rica", "el país");
    tiene(fo.html, `@${IG_USUARIO}`, "las redes: el usuario de Instagram del canal");
    tiene(fo.html, "B3 ficha-member", "el setter, con su nombre");
    tiene(fo.html, "B3 ficha-owner", "el vendedor, con su nombre");
    tiene(fo.html, "Tibio", "la temperatura");
    tiene(fo.html, "Próximo seguimiento", "el título del seguimiento");
    check(/3 nov(\.)? 2026/.test(fo.html), "la fecha de seguimiento, sin correrla de día (3 nov 2026)");
    tiene(fo.html, "meta / cpc", "el origen del primer clic");
    tiene(fo.html, TAG, "la etiqueta");
    tiene(fo.html, CAMPO, "el campo propio");
    tiene(fo.html, `valor-${sufijo}`, "su valor");
    tiene(fo.html, "No contactar", "la marca «No contactar»");
    tiene(fo.html, "Pidió no ser contactado", "el bloque rojo");
    tiene(fo.html, MOTIVO, "con el motivo");
    tiene(fo.html, NOTA, "la nota");
    tiene(fo.html, "Historial de cambios", "el historial");
    tiene(fo.html, "Editar datos", "el botón «Editar datos»");
    check(fo.html.includes(">Eliminar<"), "el botón «Eliminar» (el Owner es manager)");
    tiene(fo.html, `Instagram @${IG_CUENTA}`, "el grupo de Instagram, con la cuenta del negocio");
    tiene(fo.html, `WhatsApp (instancia b3-ficha-${sufijo})`, "el grupo de WhatsApp");
    tiene(fo.html, `/dashboard/inbox?conversacion=${convFIg}`, "el enlace al hilo de Instagram");
    tiene(fo.html, `/dashboard/inbox?conversacion=${convFWa}`, "el enlace al hilo de WhatsApp");
    check(fo.html.includes(">Video</p>"), "una conversación cuyo último mensaje es un video sin texto dice «Video», no «Sin mensajes»");
    check(fo.html.includes("14:40") && !fo.html.includes("20:40"), "la última interacción en la hora de Costa Rica (14:40), no en UTC (20:40)");

    titulo("La marca de «Teléfono sin resolver», en U");
    const fu = await pagina(owner, `/dashboard/contacts/${U}`);
    tiene(fu.html, "Teléfono sin resolver", "la marca y el bloque para cargarlo");

    titulo("La ficha como la ve el Member");
    const fm = await pagina(member, `/dashboard/contacts/${F}`);
    if (!sesionOk) noConcluyente("la ficha del Member", "falló el control de su sesión");
    else {
      check(fm.status === 200 && fm.html.includes(NOMBRE), "ve la ficha de su lead");
      check(fm.html.includes("Editar datos"), "con «Editar datos»");
      check(!fm.html.includes(">Eliminar<"), "y sin «Eliminar»: no es manager");
      const fa = await pagina(member, `/dashboard/contacts/${A}`);
      check(fa.html.includes("No podés ver este contacto") && !fa.html.includes(`B3 Ajeno ${sufijo}`), "la ficha de un lead ajeno dice que no la puede ver, sin sus datos");
    }

    titulo("«Editar datos» por la ruta");
    const e1 = await editar(member, F, { country: "Argentina", lead_temperature: "caliente" });
    check(e1.status === 200, "el Member edita su lead", `HTTP ${e1.status} ${JSON.stringify(e1.cuerpo)}`);
    const f1 = (await filas(`contacts?select=country,lead_temperature&id=eq.${F}`))[0];
    check(f1?.country === "Argentina" && f1?.lead_temperature === "caliente", "quedó escrito (releído con la clave de servicio)");
    const e2 = await editar(member, A, { country: "Argentina" });
    check(e2.status === 404 && (await filas(`contacts?select=country&id=eq.${A}`))[0]?.country == null, "el Member NO edita un lead ajeno (404; releído: igual)", `HTTP ${e2.status}`);
    const e3 = await editar(member, F, { country: "Chile" }, null);
    check(e3.status === 403 && (await filas(`contacts?select=country&id=eq.${F}`))[0]?.country === "Argentina", "sin origen de la aplicación, 403 y nada escrito", `HTTP ${e3.status}`);
    const e4 = await editar(owner, F, { display_name: `${NOMBRE} editado` });
    const f4 = (await filas(`contacts?select=display_name,display_name_source&id=eq.${F}`))[0];
    check(e4.status === 200 && f4?.display_name === `${NOMBRE} editado` && f4?.display_name_source === "manual", "el Owner cambia el nombre, que queda «manual»", `HTTP ${e4.status}`);
    const aud = await filas(`audit_log?select=actor_id,changes&entity_id=eq.${F}&action=eq.contacto.editado&order=created_at`);
    check(aud.length === 2, "dos filas «contacto editado» hasta acá (los rechazos no dejan fila)", `${aud.length}`);
    check(aud[0]?.actor_id === member.id && aud[0]?.changes?.country?.antes === "Costa Rica" && aud[0]?.changes?.country?.despues === "Argentina", "la del Member, con el país antes y después");
    check(aud[1]?.actor_id === owner.id && aud[1]?.changes?.display_name?.despues === `${NOMBRE} editado`, "la del Owner, con el nombre");

    titulo("«Editar datos» con un teléfono o un correo que ya tiene otro contacto (revisión del 20/10/2026)");
    const Z = (await crearContacto(espacio, { display_name: `B3 Otro ${sufijo}`, phone: "+50670008888", phone_resolved: true, email: `otro-${sufijo}@ssa-test.local` })).id;
    const e5 = await editar(owner, F, { phone: "+506 7000 8888" });
    check(e5.status === 409 && e5.cuerpo?.conflicto?.otro_id === Z, "teléfono de otro contacto: 409 con el otro, para proponer la unión con los dos lados", `HTTP ${e5.status} ${JSON.stringify(e5.cuerpo)}`);
    check((await filas(`contacts?select=phone&id=eq.${F}`))[0]?.phone === "+50670009999", "y el teléfono de F no cambió (releído)");
    const e6 = await editar(owner, F, { email: `OTRO-${sufijo}@ssa-test.local` });
    check(e6.status === 200 && typeof e6.cuerpo?.aviso === "string" && e6.cuerpo.aviso.includes(`B3 Otro ${sufijo}`), "correo de otro contacto: se guarda y avisa quién lo tiene", `HTTP ${e6.status} ${JSON.stringify(e6.cuerpo)}`);
    check((await filas(`contacts?select=email&id=eq.${F}`))[0]?.email === `otro-${sufijo}@ssa-test.local`, "el correo quedó guardado, en minúsculas");

    titulo("El clic al hilo: una conversación que está más abajo de las primeras 50");
    const sinParam = await pagina(member, "/dashboard/inbox");
    const conParam = await pagina(member, `/dashboard/inbox?conversacion=${D}`);
    const ordenSin = ordenDe(sinParam.html, idsDelMember);
    const ordenCon = ordenDe(conParam.html, idsDelMember);
    check(sinParam.status === 200 && ordenSin.length === 50, "sin parámetro, la lista del Member trae 50 de sus conversaciones", `${ordenSin.length}`);
    check(!ordenSin.includes(D), "y D no está entre ellas (es la más vieja)");
    check(ordenCon.includes(D), "con ?conversacion=D, D llega a la página (la presencia que da sentido a la ausencia de arriba)");
    check(JSON.stringify(ordenCon.filter((id) => id !== D)) === JSON.stringify(ordenSin), "la lista no cambia: las mismas 50, en el mismo orden");
    const mD = await mensajesDe(member, D);
    check(mD.status === 200 && mD.texto.includes(`profunda-${sufijo}`), "el Member lee los mensajes de D", `HTTP ${mD.status}`);

    titulo("El clic al hilo con una conversación ajena: el Member no ve nada");
    const ownerA = await pagina(owner, `/dashboard/inbox?conversacion=${convA}`);
    const presenteA = check(traeComoDato(ownerA.html, convA), "el Owner, con el mismo pedido, sí la recibe (control)");
    const memberA = await pagina(member, `/dashboard/inbox?conversacion=${convA}`);
    if (!presenteA) noConcluyente("el Member no recibe la conversación ajena", "falló el control del Owner");
    else check(!traeComoDato(memberA.html, convA) && !memberA.html.includes(`B3 Ajeno ${sufijo}`), "el Member no la recibe: ni la conversación ni el contacto");
    const mA = await mensajesDe(member, convA);
    check(mA.status >= 400 && !mA.texto.includes(`ajeno-${sufijo}`), "ni sus mensajes por la API", `HTTP ${mA.status}`);
  } finally {
    const r = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(r.status < 300, "se borran los contactos del espacio fantasma", `HTTP ${r.status}`);
    limpiar.contactos.length = 0;
  }
}, async () => {
  if (!espacioFantasma) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => (await filas(path)).length;
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`conversations?select=id&workspace_id=in.(${ids})`)) === 0, "conversations: 0");
  check((await cuenta(`channels?select=id&workspace_id=in.(${ids})`)) === 0, "channels: 0");
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log del espacio fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
