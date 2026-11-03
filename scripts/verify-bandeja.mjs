#!/usr/bin/env node
/**
 * F35, tramo A de S8: la lista de la bandeja, la búsqueda y las pestañas en el
 * servidor, y el hilo hasta el primer mensaje. Con sesiones reales contra
 * PRODUCCIÓN, en un espacio fantasma que este script crea y borra. Nunca en
 * «Ale Admin's Workspace». Lee el HTML que sirve producción con la cookie real
 * de cada uno (como `verify-ficha.mjs`), llama las rutas igual que la pantalla
 * y las funciones de la base (00043) con el token de cada uno.
 *
 * EL ESCENARIO, por último mensaje, del más nuevo al más viejo:
 *   L   conversación del Member con 205 mensajes (hilo largo)
 *   A   ajena: el contacto es del Owner; su nombre lleva el término buscado
 *   X   asignada al Member (`assigned_to`) con el contacto del Owner
 *   r0…r51, OBJ, r52…r54: el relleno del Member; OBJ, la objetivo, queda en el
 *   puesto 56 para el Owner y 55 para el Member: más abajo de las primeras 50.
 *   r52 y r53 están cerradas.
 *
 * LO QUE PRUEBA:
 *   - La pantalla: el HTML de la bandeja trae el total del servidor, y con
 *     `?q=` trae la objetivo. Antes del tramo A falla por eso (el control de
 *     presencia, A en la misma página, prueba que la lista se dibujó).
 *   - La base, con el token de cada uno: la misma búsqueda trae OBJ y A al
 *     Owner y solo OBJ al Member; por usuario (con y sin «@»), correo,
 *     correo secundario, teléfono y teléfono de WhatsApp escritos con guiones
 *     y espacios; un «%» no es comodín; las cantidades de las tres pestañas;
 *     las páginas de 50 sin repetir ni saltear.
 *   - X: el Member la ve en la lista y en la cantidad, y buscarla por el
 *     contacto no la encuentra, porque la RLS le oculta el contacto; el Owner
 *     sí la encuentra. Es el comportamiento esperado, y queda medido.
 *   - La ruta de la app: las páginas hasta la última, la búsqueda, y la
 *     objetivo se abre (sus mensajes llegan).
 *   - El hilo de 205: la primera página trae 200 y avisa que hay anteriores;
 *     la segunda trae los 5 restantes, con el primero guardado, y no avisa
 *     más. Cuatro mensajes comparten la hora justo en el corte de página.
 *
 * QUÉ CAMBIA CADA PASO. Solo la preparación escribe, con la clave de servicio,
 * antes de todas las lecturas. Las lecturas no escriben: la ruta de mensajes no
 * marca leídos (eso lo hace el navegador al abrir).
 *
 * Uso: node scripts/verify-bandeja.mjs
 */
import { admin, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const MENSAJES_DEL_HILO = 205;

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

async function json(u, ruta) {
  const res = await fetch(`${APP_URL}${ruta}`, { headers: { Cookie: cookieDe(u) }, redirect: "manual" });
  const texto = await res.text();
  let cuerpo = null;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    /* no es JSON: una página de error */
  }
  return { status: res.status, cuerpo };
}

const filas = async (path) => (await admin(path)).data ?? [];
/** Un id que llega como DATO de una fila (`"id":"…"`), no suelto en la dirección pedida. */
const ID_COMO_DATO = /\\?"id\\?":\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const traeComoDato = (html, id) => [...html.matchAll(ID_COMO_DATO)].some((m) => m[1] === id);

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

/** La función de la base, con el orden pedido explícito: el cursor sale de la última fila. */
const ORDEN_DE_LA_BANDEJA = "bandeja_pagina?order=last_message_at.desc.nullslast,id.desc";

/** Todas las páginas de la función de la base, siguiendo el cursor. */
async function paginasDeLaBase(token, espacio, estado, busqueda) {
  const ids = [];
  let cursor = { orden: null, id: null };
  for (let i = 0; i < 10; i++) {
    const r = await rpcComo(token, ORDEN_DE_LA_BANDEJA, { p_workspace: espacio, p_estado: estado, p_busqueda: busqueda, p_antes_orden: cursor.orden, p_antes_id: cursor.id, p_limite: 50 });
    if (r.status !== 200 || !Array.isArray(r.data)) return { ok: false, status: r.status, ids, detalle: JSON.stringify(r.data).slice(0, 200) };
    ids.push(...r.data.map((c) => c.id));
    if (r.data.length < 50) return { ok: true, ids };
    const ultima = r.data[r.data.length - 1];
    cursor = { orden: ultima.last_message_at ?? "-infinity", id: ultima.id };
  }
  return { ok: false, ids, detalle: "más de 10 páginas" };
}

const buscarEnLaBase = async (token, espacio, q) => {
  const r = await rpcComo(token, ORDEN_DE_LA_BANDEJA, { p_workspace: espacio, p_estado: "all", p_busqueda: q, p_antes_orden: null, p_antes_id: null, p_limite: 50 });
  return { status: r.status, ids: Array.isArray(r.data) ? r.data.map((c) => c.id) : null, detalle: JSON.stringify(r.data).slice(0, 200) };
};

const cantidadesEnLaBase = async (token, espacio, q) => {
  const r = await rpcComo(token, "bandeja_cantidades", { p_workspace: espacio, p_busqueda: q });
  return Array.isArray(r.data) ? r.data[0] ?? null : null;
};

/** Todas las páginas de la ruta de la app. */
async function paginasDeLaRuta(u, estado, q = "") {
  const ids = [];
  let extra = "";
  let primera = null;
  for (let i = 0; i < 10; i++) {
    const r = await json(u, `/api/v1/conversations?estado=${estado}&q=${encodeURIComponent(q)}${extra}`);
    if (r.status !== 200 || !Array.isArray(r.cuerpo?.conversaciones)) return { ok: false, status: r.status, ids, primera: null };
    if (i === 0) primera = r.cuerpo;
    ids.push(...r.cuerpo.conversaciones.map((c) => c.id));
    if (!r.cuerpo.hayMas) return { ok: true, ids, primera };
    const ultima = r.cuerpo.conversaciones[r.cuerpo.conversaciones.length - 1];
    extra = `&antesOrden=${encodeURIComponent(ultima.last_message_at ?? "-infinity")}&antesId=${ultima.id}`;
  }
  return { ok: false, ids, primera };
}

const sinRepetidos = (ids) => new Set(ids).size === ids.length;
const mismoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo`);
  const owner = await crearUsuario("bandeja-owner");
  const member = await crearUsuario("bandeja-member");
  usuariosFantasma = [owner.id, member.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, member, "member");
  console.log(`  espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  try {
    // ── El escenario ───────────────────────────────────────────────────────
    const nuevoCanal = async (campos) => (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...campos }) })).data?.[0]?.id;
    const canalIg = await nuevoCanal({ platform: "instagram", provider: "zernio", late_account_id: `b8bandeja${sufijo}${Date.now()}`, username: `b8bandejacuenta${sufijo}` });
    const canalWa = await nuevoCanal({ platform: "whatsapp", provider: "evolution", instance_name: `b8-bandeja-${sufijo}` });
    if (!canalIg || !canalWa) throw new Error("no se pudieron crear los canales fantasma");

    const TERMINO = `buscado-${sufijo}`;
    const ASIGNADA = `asignada-${sufijo}`;
    const USUARIO_OBJ = `b8.objetivo.${sufijo}`;
    const USUARIO_X = `b8.asignada.${sufijo}`;
    const conIg = async (contacto, usuario) => {
      const r = await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: contacto, channel_id: canalIg, platform_sender_id: `ig-${usuario}`, raw_jid: `ig-${usuario}`, platform_username: usuario }) });
      if (r.status >= 300) throw new Error(`no se pudo crear el canal del contacto: ${JSON.stringify(r.data).slice(0, 200)}`);
    };
    const conv = async (contacto, canal, platform, cuando, extra = {}) => {
      const r = await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canal, contact_id: contacto, platform, historial_estado: "completo", last_message_at: cuando, last_message_preview: `prev-${sufijo}`, ...extra }) });
      if (!r.data?.[0]?.id) throw new Error(`no se pudo crear la conversación: ${JSON.stringify(r.data).slice(0, 200)}`);
      return r.data[0].id;
    };
    const ahora = Date.now();
    const hace = (seg) => new Date(ahora - seg * 1000).toISOString();

    // OBJ, la objetivo, del Member, con todos los datos por los que se busca.
    const OBJ_C = (await crearContacto(espacio, {
      display_name: `B8 ${TERMINO} Objetivo`,
      email: `objetivo-${sufijo}@ssa-test.local`,
      secondary_email: `segundo-${sufijo}@ssa-test.local`,
      phone: "+50688887777",
      phone_resolved: true,
      whatsapp_phone: "+50677776666",
      setter_id: member.id,
    })).id;
    await conIg(OBJ_C, USUARIO_OBJ);
    // A, ajena, con el mismo término en el nombre.
    const A_C = (await crearContacto(espacio, { display_name: `B8 ${TERMINO} Ajeno`, setter_id: owner.id, vendedor_id: owner.id })).id;
    // X: el contacto es del Owner, la conversación está asignada al Member.
    const X_C = (await crearContacto(espacio, { display_name: `B8 ${ASIGNADA}`, setter_id: owner.id, vendedor_id: owner.id })).id;
    await conIg(X_C, USUARIO_X);
    const L_C = (await crearContacto(espacio, { display_name: `B8 hilo-largo-${sufijo}`, setter_id: member.id })).id;

    const L = await conv(L_C, canalWa, "whatsapp", hace(10));
    const A = await conv(A_C, canalIg, "instagram", hace(20));
    const X = await conv(X_C, canalIg, "instagram", hace(30), { assigned_to: member.id });

    const relleno = Array.from({ length: 55 }, (_, i) => ({ workspace_id: espacio, display_name: `b8-r${i}-${sufijo}`, setter_id: member.id }));
    const alta = await admin("contacts", { method: "POST", body: JSON.stringify(relleno) });
    if (!Array.isArray(alta.data) || alta.data.length !== 55) throw new Error(`no se creó el relleno: HTTP ${alta.status}`);
    for (const c of alta.data) limpiar.contactos.push(c.id);
    // r0…r51 entre 300 s y 3360 s; OBJ a los 3500 s; r52…r54 después, y r52 y r53 cerradas.
    const segDe = (i) => (i < 52 ? 300 + i * 60 : 3600 + (i - 52) * 60);
    const convRelleno = await admin("conversations", {
      method: "POST",
      body: JSON.stringify(alta.data.map((c, i) => ({ workspace_id: espacio, channel_id: canalWa, contact_id: c.id, platform: "whatsapp", historial_estado: "completo", last_message_at: hace(segDe(i)), status: i === 52 || i === 53 ? "closed" : "open" }))),
    });
    if (!Array.isArray(convRelleno.data) || convRelleno.data.length !== 55) throw new Error(`no se crearon las conversaciones del relleno: HTTP ${convRelleno.status}`);
    const OBJ = await conv(OBJ_C, canalIg, "instagram", hace(3500));
    await admin("messages", { method: "POST", body: JSON.stringify({ conversation_id: OBJ, direction: "inbound", text: `objetivo-${sufijo}`, platform_message_id: `b8-obj-${sufijo}` }) });

    // El hilo largo: 205 mensajes, uno por minuto; del 3 al 6 (del más viejo al
    // más nuevo, contando desde 0) comparten la hora, y el corte de 200 cae ahí.
    const base = ahora - 10 * 86_400_000;
    const mensajes = Array.from({ length: MENSAJES_DEL_HILO }, (_, i) => ({
      conversation_id: L,
      direction: i % 2 ? "outbound" : "inbound",
      text: i === 0 ? `primero-${sufijo}` : `m${i}-${sufijo}`,
      platform_message_id: `b8-largo-${i}-${sufijo}`,
      created_at: new Date(base + (i >= 3 && i <= 6 ? 3 : i) * 60_000).toISOString(),
    }));
    const altaMsj = await admin("messages", { method: "POST", body: JSON.stringify(mensajes) });
    if (!Array.isArray(altaMsj.data) || altaMsj.data.length !== MENSAJES_DEL_HILO) throw new Error(`no se crearon los mensajes del hilo: HTTP ${altaMsj.status}`);
    // Si algún disparador movió la hora del último mensaje, se vuelve a fijar.
    await admin(`conversations?id=eq.${L}`, { method: "PATCH", body: JSON.stringify({ last_message_at: hace(10) }) });
    await admin(`conversations?id=eq.${OBJ}`, { method: "PATCH", body: JSON.stringify({ last_message_at: hace(3500) }) });

    const todasDelOwner = 59;
    const todasDelMember = 58;
    console.log(`  OBJ ${OBJ.slice(0, 8)}, A ${A.slice(0, 8)}, X ${X.slice(0, 8)}, L ${L.slice(0, 8)}; ${todasDelOwner} conversaciones en el espacio`);

    // ── Las lecturas ───────────────────────────────────────────────────────
    titulo("Control: el Member lee su lead OBJ con su token, y el Owner lee A");
    const canario = check((await comoUsuario(member.token, `contacts?select=id&id=eq.${OBJ_C}`)).data?.length === 1, "el Member lee OBJ");
    check((await comoUsuario(owner.token, `contacts?select=id&id=eq.${A_C}`)).data?.length === 1, "el Owner lee A");
    if (!canario) throw new Error("falló el canario: nada de lo que sigue sería atribuible");

    titulo("La pantalla, con la cookie del Owner");
    const sinQ = await pagina(owner, "/dashboard/inbox");
    check(sinQ.status === 200, "la bandeja responde 200", `HTTP ${sinQ.status}`);
    check(sinQ.html.includes(`50 de ${todasDelOwner - 2}`), `arriba dice «50 de ${todasDelOwner - 2}»: el total de «Abiertas» del servidor, no las cargadas`);
    const conQ = await pagina(owner, `/dashboard/inbox?q=${encodeURIComponent(TERMINO)}`);
    const presenciaA = check(traeComoDato(conQ.html, A), "con ?q=, A (puesto 2) llega a la página: la lista se dibujó (control de presencia)");
    if (!presenciaA) noConcluyente("con ?q=, la objetivo llega a la página", "falló el control de presencia");
    else check(traeComoDato(conQ.html, OBJ), "con ?q=, OBJ (puesto 56) llega a la página: la búsqueda corre en el servidor");

    titulo("La base: la misma búsqueda con el token de cada uno");
    const bo = await buscarEnLaBase(owner.token, espacio, TERMINO);
    const okOwner = check(bo.status === 200 && mismoConjunto(bo.ids ?? [], [OBJ, A]), "el Owner encuentra OBJ y A (control)", `HTTP ${bo.status} ${bo.detalle}`);
    const bm = await buscarEnLaBase(member.token, espacio, TERMINO);
    if (!okOwner) noConcluyente("el Member encuentra solo OBJ", "falló la búsqueda del Owner");
    else check(bm.status === 200 && mismoConjunto(bm.ids ?? [], [OBJ]), "el Member encuentra solo OBJ: A, fuera de su alcance, no vuelve", `HTTP ${bm.status} ${bm.detalle}`);

    titulo("La base: por qué se busca (con el token del Member)");
    for (const [q, desc] of [
      [`@${USUARIO_OBJ}`, "el usuario de Instagram con «@»"],
      [USUARIO_OBJ.toUpperCase(), "el usuario de Instagram en mayúsculas"],
      [`OBJETIVO-${sufijo}@SSA-TEST.LOCAL`, "el correo, sin importar mayúsculas"],
      [`segundo-${sufijo}@ssa-test.local`, "el correo secundario"],
      ["8888-7777", "el teléfono con guion"],
      ["+506 8888 7777", "el teléfono con «+» y espacios"],
      ["7777-6666", "el teléfono de WhatsApp"],
    ]) {
      const r = await buscarEnLaBase(member.token, espacio, q);
      check(r.status === 200 && mismoConjunto(r.ids ?? [], [OBJ]), `${desc} («${q}») encuentra OBJ`, `HTTP ${r.status} ${r.detalle}`);
    }
    const todas = await cantidadesEnLaBase(member.token, espacio, "");
    const porcentaje = await cantidadesEnLaBase(member.token, espacio, "%");
    if (!todas || Number(todas.todas) !== todasDelMember) noConcluyente("«%» no es comodín", `sin búsqueda, «Todas» no dio ${todasDelMember}: ${JSON.stringify(todas)}`);
    else check(porcentaje && Number(porcentaje.todas) === 0, "«%» no es comodín: no trae nada (sin búsqueda trae todas)", JSON.stringify(porcentaje));

    titulo("La base: las cantidades de las pestañas y las páginas");
    const co = await cantidadesEnLaBase(owner.token, espacio, "");
    check(co && Number(co.abiertas) === todasDelOwner - 2 && Number(co.cerradas) === 2 && Number(co.todas) === todasDelOwner, `Owner: ${todasDelOwner - 2} abiertas, 2 cerradas, ${todasDelOwner} en total`, JSON.stringify(co));
    check(todas && Number(todas.abiertas) === todasDelMember - 2 && Number(todas.cerradas) === 2 && Number(todas.todas) === todasDelMember, `Member: ${todasDelMember - 2} abiertas, 2 cerradas, ${todasDelMember} (incluye X, asignada a él)`, JSON.stringify(todas));
    const pm = await paginasDeLaBase(member.token, espacio, "all", "");
    check(pm.ok && pm.ids.length === todasDelMember && sinRepetidos(pm.ids), `las páginas de 50 del Member traen ${todasDelMember}, sin repetir`, `${pm.ids.length} ${pm.detalle ?? ""}`);
    check(pm.ids.includes(X) && !pm.ids.includes(A), "entre ellas X (asignada) y no A (ajena)");
    check(pm.ids.indexOf(OBJ) >= 50, "OBJ está más abajo de las primeras 50", `puesto ${pm.ids.indexOf(OBJ) + 1}`);
    const cerradas = await paginasDeLaBase(member.token, espacio, "closed", "");
    check(cerradas.ok && cerradas.ids.length === 2, "«Cerradas» trae las 2", `${cerradas.ids.length}`);

    titulo("X: asignada al Member, con el contacto del Owner (comportamiento esperado)");
    const xo = await buscarEnLaBase(owner.token, espacio, ASIGNADA);
    const xoOk = check(xo.status === 200 && mismoConjunto(xo.ids ?? [], [X]), "el Owner la encuentra por el nombre del contacto (control)", `${xo.detalle}`);
    const xou = await buscarEnLaBase(owner.token, espacio, `@${USUARIO_X}`);
    check(xou.status === 200 && mismoConjunto(xou.ids ?? [], [X]), "y por el usuario", `${xou.detalle}`);
    const xm = await buscarEnLaBase(member.token, espacio, ASIGNADA);
    const xmu = await buscarEnLaBase(member.token, espacio, `@${USUARIO_X}`);
    if (!xoOk) noConcluyente("el Member no la encuentra buscando", "falló la búsqueda del Owner");
    else {
      check(xm.status === 200 && (xm.ids ?? []).length === 0, "el Member no la encuentra por el nombre: la RLS le oculta el contacto", `${xm.detalle}`);
      check(xmu.status === 200 && (xmu.ids ?? []).length === 0, "ni por el usuario", `${xmu.detalle}`);
    }

    titulo("La ruta de la app, con la cookie");
    const rm = await paginasDeLaRuta(member, "all");
    check(rm.ok && rm.ids.length === todasDelMember && sinRepetidos(rm.ids), `«Cargar más» hasta la última: ${todasDelMember}, sin repetir`, `HTTP ${rm.status ?? 200} · ${rm.ids.length}`);
    check(rm.primera?.conversaciones?.length === 50 && Number(rm.primera?.cantidades?.todas) === todasDelMember, `la primera página trae 50 y el total ${todasDelMember}`, JSON.stringify(rm.primera?.cantidades));
    const qo = await paginasDeLaRuta(owner, "all", TERMINO);
    const qoOk = check(qo.ok && mismoConjunto(qo.ids, [OBJ, A]), "buscando, el Owner recibe OBJ y A (control)", `${qo.ids.length}`);
    const qm = await paginasDeLaRuta(member, "all", TERMINO);
    if (!qoOk) noConcluyente("buscando, el Member recibe solo OBJ", "falló el control del Owner");
    else check(qm.ok && mismoConjunto(qm.ids, [OBJ]), "buscando, el Member recibe solo OBJ", `${qm.ids.length}`);
    const abre = await json(member, `/api/v1/messages?conversationId=${OBJ}`);
    check(abre.status === 200 && abre.cuerpo?.messages?.some((m) => m.text === `objetivo-${sufijo}`), "la objetivo se abre: el Member lee sus mensajes", `HTTP ${abre.status}`);

    titulo(`El hilo de ${MENSAJES_DEL_HILO} mensajes, hasta el primero`);
    const p1 = await json(member, `/api/v1/messages?conversationId=${L}`);
    const p1Ok = check(p1.status === 200 && p1.cuerpo?.messages?.length === 200 && p1.cuerpo?.hayAnteriores === true, "la primera página trae 200 y avisa que hay anteriores", `HTTP ${p1.status} · ${p1.cuerpo?.messages?.length}`);
    if (!p1Ok) noConcluyente("la segunda página llega al primero", "falló la primera página");
    else {
      const masViejo = p1.cuerpo.messages[0];
      const p2 = await json(member, `/api/v1/messages?conversationId=${L}&antesAt=${encodeURIComponent(masViejo.created_at)}&antesId=${masViejo.id}`);
      const todosLosIds = [...(p2.cuerpo?.messages ?? []), ...p1.cuerpo.messages].map((m) => m.id);
      check(p2.status === 200 && p2.cuerpo?.messages?.length === MENSAJES_DEL_HILO - 200, `la segunda página trae los ${MENSAJES_DEL_HILO - 200} anteriores`, `HTTP ${p2.status} · ${p2.cuerpo?.messages?.length}`);
      check(p2.cuerpo?.messages?.[0]?.text === `primero-${sufijo}` && p2.cuerpo?.hayAnteriores === false, "empieza por el primero guardado y no avisa más", `${p2.cuerpo?.messages?.[0]?.text} · ${p2.cuerpo?.hayAnteriores}`);
      check(todosLosIds.length === MENSAJES_DEL_HILO && sinRepetidos(todosLosIds), `entre las dos, los ${MENSAJES_DEL_HILO}, sin repetir (con cuatro a la misma hora en el corte)`, `${todosLosIds.length}`);
    }
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
