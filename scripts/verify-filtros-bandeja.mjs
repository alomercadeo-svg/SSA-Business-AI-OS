#!/usr/bin/env node
/**
 * F35, tramo B de S8: los filtros de la bandeja, la búsqueda palabra por
 * palabra y dentro de los mensajes. Con sesiones reales contra PRODUCCIÓN, en
 * espacios fantasma que este script crea y borra. Nunca en «Ale Admin's
 * Workspace». Lee el HTML que sirve producción y la ruta de la lista con la
 * cookie real de cada uno (como `verify-bandeja.mjs`), y la función de la base
 * (00044) con el token de cada uno.
 *
 * LOS ESPACIOS:
 *   E  el del Owner, con la zona por defecto (America/Costa_Rica). El Member es
 *      miembro. Ahí está casi todo.
 *   U  el espacio propio del Member, con `zona_horaria = 'UTC'`: el control de
 *      la zona del paso de bordes (decidido por Marcos el 04/11/2026).
 *
 * EL ESCENARIO EN E (contacto → conversaciones; «m» es del Member, por setter):
 *   ETQ    m, etiqueta T1, Instagram, último mensaje hace 1 min; dos mensajes:
 *          «presupuesto… landing…» en uno y «hola…» en otro
 *   ETQ2   m, etiqueta T2, WhatsApp, último mensaje hace 5 días
 *   VEND   vendedor = Member, sin setter, WhatsApp, hace 20 días
 *   SIN    sin setter ni vendedor, Instagram, hace 40 días (el Owner la ve)
 *   TEL    m, teléfono sin resolver, WhatsApp
 *   S_HOY  m, seguimiento hoy (Costa Rica, reloj real), DOS conversaciones
 *          (Instagram y WhatsApp): el criterio de «muestra todas»
 *   S_AYER, S_MAN, S_PROX (hoy + 8), S_NULO: m, seguimientos con el reloj real
 *   AJENA  del Owner: T1, teléfono sin resolver, seguimiento hoy, Instagram,
 *          hace 30 s, un mensaje «secreto…». Cumple casi todos los filtros: el
 *          Owner la recibe, el Member nunca
 *   X      contacto del Owner, conversación asignada al Member (`assigned_to`),
 *          un mensaje «asignadamsj…»: por mensaje el Member la encuentra, por
 *          el contacto no (la RLS le oculta el contacto)
 *   TANIA  m, nombre «B8F tania-…», usuario de Instagram «robles-…»
 *   MARIA  m, nombre «B8F María-…»
 *   OBJ    m, teléfono +50688887777: lo del tramo A, por el camino nuevo
 *   B03, B04, B05, B08, B09, BNULO: m, seguimientos con fecha fija, para los
 *          bordes con el reloj fijo
 * EN U: B03, B04, B05 y BNULO, iguales.
 *
 * NINGUNA fila que el Member pueda ver lleva el id del Owner (ni setter, ni
 * vendedor, ni `assigned_to`): así, una aparición del Owner en la página del
 * Member es atribuible a la lista de «Asignación».
 *
 * QUÉ CAMBIA CADA PASO. Solo la preparación escribe, con la clave de servicio,
 * antes de todas las lecturas. Las lecturas no escriben: la ruta de la lista
 * no marca leídos, y el reloj fijo (`ahora`) es un dato de la lectura, no
 * cambia filas.
 *
 * LOS ROJOS. La ruta y la página existen e ignoran los parámetros que no
 * conocen: antes de construir, cada filtro falla por su motivo (lo que no
 * tendría que estar, está). Los pasos que llaman a `bandeja_pagina_filtros`
 * fallan antes porque la función no existe: rojo de carga, no cuenta.
 *
 * Uso: node scripts/verify-filtros-bandeja.mjs
 */
import { admin, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];

let espacioDeLaCookie = null;
let espaciosFantasma = [];
let usuariosFantasma = [];

/** La cookie como la arma `@supabase/ssr` 0.8.0, más la del espacio elegido. */
function cookieDe(u) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacioDeLaCookie}`);
  return partes.join("; ");
}

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
    /* no es JSON */
  }
  return { status: res.status, cuerpo };
}

const filas = async (path) => (await admin(path)).data ?? [];
const ID_COMO_DATO = /\\?"id\\?":\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const traeComoDato = (html, id) => [...html.matchAll(ID_COMO_DATO)].some((m) => m[1] === id);

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

/** Todas las páginas de la ruta de la lista, con los parámetros dados. */
async function ruta(u, params) {
  const ids = [];
  let extra = "";
  let primera = null;
  for (let i = 0; i < 10; i++) {
    const r = await json(u, `/api/v1/conversations?estado=all&${params}${extra}`);
    if (r.status !== 200 || !Array.isArray(r.cuerpo?.conversaciones)) return { ok: false, status: r.status, ids, primera };
    if (i === 0) primera = r.cuerpo;
    ids.push(...r.cuerpo.conversaciones.map((c) => c.id));
    if (!r.cuerpo.hayMas) return { ok: true, status: 200, ids, primera };
    const ultima = r.cuerpo.conversaciones[r.cuerpo.conversaciones.length - 1];
    extra = `&antesOrden=${encodeURIComponent(ultima.last_message_at ?? "-infinity")}&antesId=${ultima.id}`;
  }
  return { ok: false, status: 200, ids, primera };
}

const FUNCION = "bandeja_pagina_filtros?order=last_message_at.desc.nullslast,id.desc";
/** La función de la base (00044), una página de 200, con el token de quien mira. */
async function base(token, espacio, filtros) {
  const r = await rpcComo(token, FUNCION, { p_workspace: espacio, p_estado: "all", p_filtros: filtros, p_antes_orden: null, p_antes_id: null, p_limite: 200, p_id: null });
  return { ok: r.status === 200 && Array.isArray(r.data), status: r.status, ids: Array.isArray(r.data) ? r.data.map((c) => c.id) : [], detalle: JSON.stringify(r.data).slice(0, 200) };
}

const tiene = (r, ...ids) => r.ok && ids.every((id) => r.ids.includes(id));
const noTiene = (r, ...ids) => r.ok && ids.every((id) => !r.ids.includes(id));
const det = (r) => `HTTP ${r.status} · ${r.ids.length} ids ${r.detalle ?? ""}`;

/**
 * Presencia y después ausencia: «no está» solo significa algo si antes se
 * probó que lo que sí tiene que estar llegó.
 */
function presenciaYAusencia(r, quien, presentes, ausentes) {
  const ok = check(tiene(r, ...presentes.map((p) => p[0])), `${quien}: llegan ${presentes.map((p) => p[1]).join(", ")} (presencia)`, det(r));
  for (const [id, nombre] of ausentes) {
    if (!ok) noConcluyente(`${quien}: no llega ${nombre}`, "falló la presencia");
    else check(noTiene(r, id), `${quien}: no llega ${nombre}`, det(r));
  }
  return ok;
}

/** El día del calendario en Costa Rica, más `dias`, como AAAA-MM-DD. */
function diaCR(dias = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + dias));
  return d.toISOString().slice(0, 10);
}
const esDomingoEnCR = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/Costa_Rica", weekday: "short" }).format(new Date()) === "Sun";

await correr(async () => {
  console.log(`App: ${APP_URL} · espacios fantasma nuevos`);
  const owner = await crearUsuario("filtros-owner");
  const member = await crearUsuario("filtros-member");
  usuariosFantasma = [owner.id, member.id];
  const E = owner.espacio;
  const U = member.espacio;
  espaciosFantasma = [E, U];
  espacioDeLaCookie = E;
  await sumarAlEspacio(E, member, "member");
  console.log(`  E ${E.slice(0, 8)} (Costa Rica), U ${U.slice(0, 8)} (UTC), Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  try {
    // ── La preparación (lo único que escribe) ──────────────────────────────
    const zona = await admin(`workspaces?id=eq.${U}`, { method: "PATCH", body: JSON.stringify({ zona_horaria: "UTC" }) });
    if (zona.status >= 300) throw new Error(`no se pudo poner U en UTC: HTTP ${zona.status}`);
    const nuevoCanal = async (espacio, campos) => (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...campos }) })).data?.[0]?.id;
    const igE = await nuevoCanal(E, { platform: "instagram", provider: "zernio", late_account_id: `b8f${sufijo}e${Date.now()}`, username: `b8fcuenta${sufijo}` });
    const waE = await nuevoCanal(E, { platform: "whatsapp", provider: "evolution", instance_name: `b8f-${sufijo}` });
    const igU = await nuevoCanal(U, { platform: "instagram", provider: "zernio", late_account_id: `b8f${sufijo}u${Date.now()}`, username: `b8fcuentau${sufijo}` });
    if (!igE || !waE || !igU) throw new Error("no se pudieron crear los canales fantasma");

    const etiqueta = async (nombre) => (await admin("tags", { method: "POST", body: JSON.stringify({ workspace_id: E, name: nombre }) })).data?.[0]?.id;
    const T1 = await etiqueta(`b8f-caliente-${sufijo}`);
    const T2 = await etiqueta(`b8f-frio-${sufijo}`);
    const T3 = await etiqueta(`b8f-vacia-${sufijo}`);
    if (!T1 || !T2 || !T3) throw new Error("no se pudieron crear las etiquetas");
    const etiquetar = async (contacto, tag) => {
      const r = await admin("contact_tags", { method: "POST", body: JSON.stringify({ contact_id: contacto, tag_id: tag }) });
      if (r.status >= 300) throw new Error(`no se pudo etiquetar: HTTP ${r.status}`);
    };

    const ahora = Date.now();
    const hace = (seg) => new Date(ahora - seg * 1000).toISOString();
    const DIA = 86_400;
    const conv = async (espacio, contacto, canal, platform, cuando, extra = {}) => {
      const r = await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canal, contact_id: contacto, platform, historial_estado: "completo", last_message_at: cuando, last_message_preview: `prev-${sufijo}`, ...extra }) });
      if (!r.data?.[0]?.id) throw new Error(`no se pudo crear la conversación: ${JSON.stringify(r.data).slice(0, 200)}`);
      return r.data[0].id;
    };
    const mensaje = async (conversacion, texto, n) => {
      const r = await admin("messages", { method: "POST", body: JSON.stringify({ conversation_id: conversacion, direction: "inbound", text: texto, platform_message_id: `b8f-${n}-${sufijo}` }) });
      if (r.status >= 300) throw new Error(`no se pudo crear el mensaje: HTTP ${r.status}`);
    };
    const m = { setter_id: member.id };
    const deOwner = { setter_id: owner.id, vendedor_id: owner.id };
    const contacto = async (espacio, nombre, campos) => (await crearContacto(espacio, { display_name: `B8F ${nombre}-${sufijo}`, ...campos })).id;

    const ETQ_C = await contacto(E, "etq", m);
    const ETQ2_C = await contacto(E, "etq2", m);
    const VEND_C = await contacto(E, "vend", { vendedor_id: member.id });
    const SIN_C = await contacto(E, "sin", {});
    const TEL_C = await contacto(E, "tel", { ...m, phone_resolved: false });
    const S_HOY_C = await contacto(E, "s-hoy", { ...m, next_followup_date: diaCR(0) });
    const S_AYER_C = await contacto(E, "s-ayer", { ...m, next_followup_date: diaCR(-1) });
    const S_MAN_C = await contacto(E, "s-man", { ...m, next_followup_date: diaCR(1) });
    const S_PROX_C = await contacto(E, "s-prox", { ...m, next_followup_date: diaCR(8) });
    const S_NULO_C = await contacto(E, "s-nulo", m);
    const AJENA_C = await contacto(E, "ajena", { ...deOwner, phone_resolved: false, next_followup_date: diaCR(0) });
    const X_C = await contacto(E, "x", deOwner);
    const TANIA_C = (await crearContacto(E, { display_name: `B8F tania-${sufijo}`, ...m })).id;
    const MARIA_C = (await crearContacto(E, { display_name: `B8F María-${sufijo}`, ...m })).id;
    const OBJ_C = await contacto(E, "obj", { ...m, phone: "+50688887777", phone_resolved: true });
    await etiquetar(ETQ_C, T1);
    await etiquetar(AJENA_C, T1);
    await etiquetar(ETQ2_C, T2);
    const usuarioTania = `robles-${sufijo}`;
    const r = await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: TANIA_C, channel_id: igE, platform_sender_id: `ig-${usuarioTania}`, raw_jid: `ig-${usuarioTania}`, platform_username: usuarioTania }) });
    if (r.status >= 300) throw new Error(`no se pudo crear el canal de TANIA: HTTP ${r.status}`);

    const ETQ = await conv(E, ETQ_C, igE, "instagram", hace(60));
    const ETQ2 = await conv(E, ETQ2_C, waE, "whatsapp", hace(5 * DIA));
    const VEND = await conv(E, VEND_C, waE, "whatsapp", hace(20 * DIA));
    const SIN = await conv(E, SIN_C, igE, "instagram", hace(40 * DIA));
    const TEL = await conv(E, TEL_C, waE, "whatsapp", hace(120));
    const S_HOY_IG = await conv(E, S_HOY_C, igE, "instagram", hace(130));
    const S_HOY_WA = await conv(E, S_HOY_C, waE, "whatsapp", hace(140));
    const S_AYER = await conv(E, S_AYER_C, igE, "instagram", hace(150));
    const S_MAN = await conv(E, S_MAN_C, igE, "instagram", hace(160));
    const S_PROX = await conv(E, S_PROX_C, igE, "instagram", hace(170));
    const S_NULO = await conv(E, S_NULO_C, igE, "instagram", hace(180));
    const AJENA = await conv(E, AJENA_C, igE, "instagram", hace(30));
    const X = await conv(E, X_C, waE, "whatsapp", hace(90), { assigned_to: member.id });
    const TANIA = await conv(E, TANIA_C, igE, "instagram", hace(200));
    const MARIA = await conv(E, MARIA_C, igE, "instagram", hace(210));
    const OBJ = await conv(E, OBJ_C, waE, "whatsapp", hace(220));
    await mensaje(ETQ, `presupuesto-${sufijo} para la landing-${sufijo}`, "etq1");
    await mensaje(ETQ, `hola-${sufijo}`, "etq2");
    await mensaje(AJENA, `secreto-${sufijo}`, "ajena");
    await mensaje(X, `asignadamsj-${sufijo}`, "x");

    // Los bordes, con fecha fija: el reloj fijo es el miércoles 04/11/2026 a
    // las 18:30 de Costa Rica (00:30 UTC del jueves 05) y el domingo 08/11.
    const bordes = {};
    for (const [nombre, fecha] of [["B03", "2026-11-03"], ["B04", "2026-11-04"], ["B05", "2026-11-05"], ["B08", "2026-11-08"], ["B09", "2026-11-09"], ["BNULO", null]]) {
      const c = await contacto(E, nombre.toLowerCase(), { ...m, next_followup_date: fecha });
      bordes[nombre] = await conv(E, c, igE, "instagram", hace(300));
    }
    const bordesU = {};
    for (const [nombre, fecha] of [["B03", "2026-11-03"], ["B04", "2026-11-04"], ["B05", "2026-11-05"], ["BNULO", null]]) {
      const c = await contacto(U, `u-${nombre.toLowerCase()}`, { setter_id: member.id, next_followup_date: fecha });
      bordesU[nombre] = await conv(U, c, igU, "instagram", hace(300));
    }
    // Si algún disparador movió la hora del último mensaje, se vuelve a fijar.
    for (const [id, seg] of [[ETQ, 60], [AJENA, 30], [X, 90]]) {
      await admin(`conversations?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ last_message_at: hace(seg) }) });
    }
    console.log(`  hoy en Costa Rica: ${diaCR(0)}${esDomingoEnCR() ? " (domingo)" : ""}`);

    // ── Las lecturas ───────────────────────────────────────────────────────
    titulo("Control: el Member lee su contacto ETQ con su token, y el Owner lee AJENA");
    const canario = check((await comoUsuario(member.token, `contacts?select=id&id=eq.${ETQ_C}`)).data?.length === 1, "el Member lee ETQ");
    check((await comoUsuario(owner.token, `contacts?select=id&id=eq.${AJENA_C}`)).data?.length === 1, "el Owner lee AJENA");
    const sinFiltroO = await ruta(owner, "");
    const sinFiltroM = await ruta(member, "");
    check(tiene(sinFiltroO, ETQ, AJENA, SIN), "sin filtros, el Owner recibe ETQ, AJENA y SIN", det(sinFiltroO));
    check(tiene(sinFiltroM, ETQ, X) && noTiene(sinFiltroM, AJENA), "sin filtros, el Member recibe ETQ y X, y no AJENA", det(sinFiltroM));
    if (!canario) throw new Error("falló el canario: nada de lo que sigue sería atribuible");

    titulo("Etiquetas (cualquiera de las elegidas), con el Owner y con el Member");
    presenciaYAusencia(await ruta(owner, `etiquetas=${T1}`), "T1, Owner", [[ETQ, "ETQ"], [AJENA, "AJENA"]], [[ETQ2, "ETQ2 (T2)"], [SIN, "SIN (sin etiquetas)"]]);
    presenciaYAusencia(await ruta(member, `etiquetas=${T1}`), "T1, Member", [[ETQ, "ETQ"]], [[AJENA, "AJENA (fuera de su alcance)"], [ETQ2, "ETQ2"]]);
    presenciaYAusencia(await ruta(owner, `etiquetas=${T1},${T2}`), "T1 o T2, Owner", [[ETQ, "ETQ"], [ETQ2, "ETQ2"], [AJENA, "AJENA"]], [[SIN, "SIN"]]);

    titulo("Asignación: un miembro (setter o vendedor) y «Sin asignar»");
    presenciaYAusencia(await ruta(owner, `asignacion=${member.id}`), "el Member, visto por el Owner", [[ETQ, "ETQ (setter)"], [VEND, "VEND (vendedor)"]], [[AJENA, "AJENA (del Owner)"], [SIN, "SIN"], [X, "X (solo assigned_to)"]]);
    presenciaYAusencia(await ruta(owner, "asignacion=sin"), "«Sin asignar», Owner", [[SIN, "SIN"]], [[ETQ, "ETQ"], [VEND, "VEND"], [AJENA, "AJENA"]]);
    const propio = await ruta(member, `asignacion=${member.id}`);
    // El control del paso siguiente: que el filtro por el propio Member de verdad
    // filtre (deja afuera a X). Si no filtra, «da lo mismo que Todas» no prueba nada.
    const propioFiltra = presenciaYAusencia(propio, "el Member a sí mismo", [[ETQ, "ETQ"], [VEND, "VEND"]], [[X, "X (solo assigned_to)"]]) && noTiene(propio, X);
    const ajenoId = await ruta(member, `asignacion=${owner.id}`);
    if (!propioFiltra) noConcluyente("un Member con el id del Owner en la dirección: se ignora", "el filtro por el propio Member no filtró");
    else check(ajenoId.ok && ajenoId.ids.length === sinFiltroM.ids.length && tiene(ajenoId, ...sinFiltroM.ids), "un Member con el id del Owner en la dirección: 200 y lo mismo que «Todas» (se ignora, sin error)", det(ajenoId));

    titulo("Canal, por plataforma");
    presenciaYAusencia(await ruta(owner, "canal=whatsapp"), "WhatsApp, Owner", [[ETQ2, "ETQ2"], [TEL, "TEL"], [X, "X"]], [[ETQ, "ETQ (Instagram)"], [AJENA, "AJENA (Instagram)"]]);
    presenciaYAusencia(await ruta(member, "canal=instagram"), "Instagram, Member", [[ETQ, "ETQ"], [TANIA, "TANIA"]], [[ETQ2, "ETQ2 (WhatsApp)"], [X, "X (WhatsApp)"], [AJENA, "AJENA (fuera de su alcance)"]]);
    const ambos = await ruta(owner, "canal=instagram,whatsapp");
    check(ambos.ok && ambos.ids.length === sinFiltroO.ids.length, "los dos canales: lo mismo que sin filtro", det(ambos));

    titulo("Fecha del último mensaje (reloj real, días de Costa Rica)");
    presenciaYAusencia(await ruta(owner, "ultimo=hoy"), "«Hoy»", [[ETQ, "ETQ (hace 1 min)"], [AJENA, "AJENA (hace 30 s)"]], [[ETQ2, "ETQ2 (hace 5 días)"], [VEND, "VEND (hace 20)"]]);
    presenciaYAusencia(await ruta(owner, "ultimo=7"), "«Últimos 7 días»", [[ETQ, "ETQ"], [ETQ2, "ETQ2 (hace 5)"]], [[VEND, "VEND (hace 20)"], [SIN, "SIN (hace 40)"]]);
    presenciaYAusencia(await ruta(owner, "ultimo=30"), "«Últimos 30 días»", [[ETQ2, "ETQ2"], [VEND, "VEND (hace 20)"]], [[SIN, "SIN (hace 40)"]]);
    const dia20 = diaCR(-20);
    presenciaYAusencia(await ruta(owner, `ultimo=rango&ultimo_desde=${dia20}&ultimo_hasta=${dia20}`), `«Rango de fechas» ${dia20} a ${dia20}`, [[VEND, "VEND"]], [[ETQ, "ETQ"], [ETQ2, "ETQ2"], [SIN, "SIN"]]);

    titulo("Teléfono sin resolver");
    presenciaYAusencia(await ruta(owner, "telefono=sin-resolver"), "Owner", [[TEL, "TEL"], [AJENA, "AJENA"]], [[ETQ, "ETQ"], [OBJ, "OBJ (con teléfono)"]]);
    presenciaYAusencia(await ruta(member, "telefono=sin-resolver"), "Member", [[TEL, "TEL"]], [[AJENA, "AJENA (fuera de su alcance)"], [ETQ, "ETQ"]]);

    titulo("Seguimiento con el reloj real, y las dos conversaciones del mismo contacto");
    const domingo = esDomingoEnCR();
    presenciaYAusencia(await ruta(owner, "seguimiento=hoy"), "«Vence hoy», Owner", [[S_HOY_IG, "S_HOY por Instagram"], [S_HOY_WA, "S_HOY por WhatsApp"], [AJENA, "AJENA"]], [[S_MAN, "S_MAN (mañana)"], [S_AYER, "S_AYER"], [S_NULO, "S_NULO (sin fecha)"]]);
    presenciaYAusencia(await ruta(member, "seguimiento=hoy"), "«Vence hoy», Member", [[S_HOY_IG, "S_HOY por Instagram"], [S_HOY_WA, "S_HOY por WhatsApp"]], [[AJENA, "AJENA (fuera de su alcance)"], [S_MAN, "S_MAN"]]);
    presenciaYAusencia(await ruta(owner, "seguimiento=vencido"), "«Vencido»", [[S_AYER, "S_AYER"]], [[S_HOY_IG, "S_HOY"], [S_MAN, "S_MAN"], [S_NULO, "S_NULO"]]);
    presenciaYAusencia(
      await ruta(owner, "seguimiento=semana"),
      "«Vence esta semana»",
      domingo ? [[S_HOY_IG, "S_HOY"]] : [[S_HOY_IG, "S_HOY"], [S_MAN, "S_MAN"]],
      [[S_AYER, "S_AYER (vencido)"], [S_PROX, "S_PROX (hoy + 8)"], [S_NULO, "S_NULO"], ...(domingo ? [[S_MAN, "S_MAN (hoy es domingo)"]] : [])],
    );
    presenciaYAusencia(await ruta(owner, `seguimiento=rango&seguimiento_desde=${diaCR(0)}&seguimiento_hasta=${diaCR(1)}`), "«Rango de fechas» hoy a mañana", [[S_HOY_IG, "S_HOY"], [S_MAN, "S_MAN"]], [[S_AYER, "S_AYER"], [S_PROX, "S_PROX"], [S_NULO, "S_NULO"]]);

    titulo("Bordes con el reloj fijo, en la base: el control de la zona primero (U, en UTC)");
    const MIERCOLES = "2026-11-05T00:30:00Z";
    const DOMINGO = "2026-11-09T00:30:00Z";
    const u = await base(member.token, U, { seguimiento: "hoy", ahora: MIERCOLES });
    const zonaOk = check(tiene(u, bordesU.B05), "en U (UTC), a las 00:30 UTC del 05/11, el del 05/11 está en «Vence hoy»", det(u));
    const uv = await base(member.token, U, { seguimiento: "vencido", ahora: MIERCOLES });
    check(tiene(uv, bordesU.B04, bordesU.B03), "en U, el del 04/11 ya está en «Vencido»", det(uv));

    titulo("Bordes con el reloj fijo: miércoles 04/11 a las 18:30 de Costa Rica (E)");
    const eh = await base(member.token, E, { seguimiento: "hoy", ahora: MIERCOLES });
    const es = await base(member.token, E, { seguimiento: "semana", ahora: MIERCOLES });
    const ev = await base(member.token, E, { seguimiento: "vencido", ahora: MIERCOLES });
    if (!zonaOk) {
      noConcluyente("el miércoles en Costa Rica", "en U el 05/11 no dio distinto: este paso no probaría que detecta un cálculo en UTC");
    } else {
      check(tiene(eh, bordes.B04) && tiene(es, bordes.B04) && noTiene(ev, bordes.B04), "el de hoy (04/11): en «Vence hoy» y en «esta semana», no en «Vencido»", `${det(eh)} | ${det(es)} | ${det(ev)}`);
      check(tiene(ev, bordes.B03), "el de ayer (03/11): en «Vencido»", det(ev));
      check(noTiene(eh, bordes.B05) && tiene(es, bordes.B05), "el de mañana (05/11): no en «Vence hoy», sí en «esta semana»", `${det(eh)} | ${det(es)}`);
      check(tiene(es, bordes.B08) && noTiene(es, bordes.B09), "la semana termina el domingo 08/11: el del lunes 09 no está", det(es));
      check(noTiene(eh, bordes.BNULO) && noTiene(es, bordes.BNULO) && noTiene(ev, bordes.BNULO), "el contacto sin fecha no aparece en ninguna", `${det(eh)} | ${det(es)} | ${det(ev)}`);
    }
    titulo("Bordes con el reloj fijo: domingo 08/11 a las 18:30 de Costa Rica");
    const dh = await base(member.token, E, { seguimiento: "hoy", ahora: DOMINGO });
    const ds = await base(member.token, E, { seguimiento: "semana", ahora: DOMINGO });
    const dOk = check(tiene(dh, bordes.B08) && tiene(ds, bordes.B08), "el del domingo 08/11 está en «Vence hoy» y en «esta semana» (presencia)", `${det(dh)} | ${det(ds)}`);
    if (!dOk) noConcluyente("el domingo, mañana no está en «esta semana»", "falló la presencia");
    else check(noTiene(ds, bordes.B09) && noTiene(ds, bordes.B05), "el domingo, el de mañana (09/11) no está en «esta semana», ni el vencido (05/11)", det(ds));

    titulo("Combinados, las cantidades de las pestañas y «una» para Realtime");
    presenciaYAusencia(await ruta(owner, `canal=instagram&etiquetas=${T1}`), "Instagram y T1, Owner", [[ETQ, "ETQ"], [AJENA, "AJENA"]], [[ETQ2, "ETQ2"], [TANIA, "TANIA"]]);
    presenciaYAusencia(await ruta(owner, `canal=instagram&etiquetas=${T1}&telefono=sin-resolver`), "Instagram, T1 y teléfono sin resolver", [[AJENA, "AJENA"]], [[ETQ, "ETQ (con teléfono resuelto)"]]);
    const cw = await json(owner, "/api/v1/conversations?estado=all&canal=whatsapp");
    const nWa = (await ruta(owner, "canal=whatsapp")).ids.length;
    check(cw.status === 200 && Number(cw.cuerpo?.cantidades?.todas) === nWa && nWa < sinFiltroO.ids.length, `con WhatsApp, «Todas» cuenta las de WhatsApp (${nWa}), menos que sin filtro (${sinFiltroO.ids.length})`, JSON.stringify(cw.cuerpo?.cantidades));
    const unaSi = await json(owner, `/api/v1/conversations?estado=all&etiquetas=${T1}&id=${ETQ}`);
    const unaSiOk = check(unaSi.status === 200 && unaSi.cuerpo?.conversaciones?.length === 1, "por id, con T1: ETQ vuelve (la cumple)", `HTTP ${unaSi.status}`);
    const unaNo = await json(owner, `/api/v1/conversations?estado=all&etiquetas=${T1}&id=${ETQ2}`);
    if (!unaSiOk) noConcluyente("por id, con T1: ETQ2 no vuelve", "falló la presencia");
    else check(unaNo.status === 200 && unaNo.cuerpo?.conversaciones?.length === 0, "por id, con T1: ETQ2 no vuelve (no la cumple)", `HTTP ${unaNo.status} · ${unaNo.cuerpo?.conversaciones?.length}`);

    titulo("La pantalla, con la dirección (se puede abrir en otra pestaña)");
    const pe = await pagina(owner, `/dashboard/inbox?estado=all&etiquetas=${T1}`);
    const peOk = check(pe.status === 200 && traeComoDato(pe.html, ETQ) && traeComoDato(pe.html, AJENA), "con ?etiquetas=T1, ETQ y AJENA llegan a la página (presencia)", `HTTP ${pe.status}`);
    if (!peOk) noConcluyente("con ?etiquetas=T1, ETQ2 no llega a la página", "falló la presencia");
    else check(!traeComoDato(pe.html, ETQ2) && !traeComoDato(pe.html, SIN), "con ?etiquetas=T1, ETQ2 y SIN no llegan a la página", "");
    const dos = await pagina(owner, `/dashboard/inbox?estado=all&etiquetas=${T1}&canal=instagram`);
    check(dos.html.includes("Filtros · 2"), "con dos grupos elegidos, el botón dice «Filtros · 2»");
    const vacia = await pagina(owner, `/dashboard/inbox?estado=all&etiquetas=${T3}`);
    check(vacia.html.includes("Ninguna conversación con estos filtros") && vacia.html.includes("Probá con otros filtros o limpialos para ver todas."), "con una etiqueta sin contactos: «Ninguna conversación con estos filtros»");
    check(!vacia.html.includes("Todavía no hay conversaciones"), "y no «Todavía no hay conversaciones»");

    titulo("La lista de «Asignación»: el Owner ve al equipo; el Member, solo a sí mismo");
    const po = await pagina(owner, "/dashboard/inbox");
    const nombreMember = "B3 filtros-member";
    const nombreOwner = "B3 filtros-owner";
    const listaOk = check(po.status === 200 && po.html.includes(nombreMember), `con la cookie del Owner, la página trae al Member («${nombreMember}»): la lista llegó (control positivo)`, `HTTP ${po.status}`);
    const pm = await pagina(member, "/dashboard/inbox");
    if (!listaOk) noConcluyente("con la cookie del Member, la página no trae al Owner", "falló el control del Owner");
    else {
      check(pm.status === 200 && !pm.html.includes(nombreOwner), `con la cookie del Member, la página no trae el nombre del Owner`, `HTTP ${pm.status}`);
      check(!pm.html.includes(owner.email), "ni su correo");
      check(!pm.html.includes(owner.id), "ni su id");
    }

    titulo("La búsqueda palabra por palabra, sin tildes, y lo del tramo A por el camino nuevo");
    presenciaYAusencia(await ruta(member, `q=${encodeURIComponent(`tania-${sufijo} robles-${sufijo}`)}`), "«tania robles» (nombre y usuario)", [[TANIA, "TANIA"]], [[MARIA, "MARIA"]]);
    presenciaYAusencia(await ruta(member, `q=${encodeURIComponent(`robles-${sufijo} TANIA-${sufijo}`)}`), "en otro orden y en mayúsculas", [[TANIA, "TANIA"]], [[ETQ, "ETQ"]]);
    presenciaYAusencia(await ruta(member, `q=${encodeURIComponent(`maria-${sufijo}`)}`), "«maria» encuentra a «María»", [[MARIA, "MARIA"]], [[TANIA, "TANIA"]]);
    presenciaYAusencia(await ruta(member, `q=${encodeURIComponent("+506 8888 7777")}`), "el teléfono con «+» y espacios", [[OBJ, "OBJ"]], [[TANIA, "TANIA"]]);
    presenciaYAusencia(await ruta(member, `q=${encodeURIComponent("8888-7777")}`), "el teléfono con guion", [[OBJ, "OBJ"]], [[TEL, "TEL"]]);
    const pct = await json(member, `/api/v1/conversations?estado=all&q=${encodeURIComponent("%")}`);
    if (!sinFiltroM.ok || sinFiltroM.ids.length === 0) noConcluyente("«%» no es comodín", "sin búsqueda, el Member no recibió nada");
    else check(pct.status === 200 && Number(pct.cuerpo?.cantidades?.todas) === 0, "«%» no es comodín: no trae nada", JSON.stringify(pct.cuerpo?.cantidades));
    const nada = await ruta(member, `q=${encodeURIComponent(`tania-${sufijo} inexistente-${sufijo}`)}`);
    check(nada.ok && nada.ids.length === 0, "una palabra que no está en ningún dato: no encuentra nada", det(nada));

    titulo("La búsqueda dentro de los mensajes");
    const lp = await ruta(member, `q=${encodeURIComponent(`landing-${sufijo} presupuesto-${sufijo}`)}`);
    const lpOk = check(tiene(lp, ETQ), "«landing presupuesto»: las dos palabras en un mismo mensaje de ETQ (presencia)", det(lp));
    const lh = await ruta(member, `q=${encodeURIComponent(`landing-${sufijo} hola-${sufijo}`)}`);
    if (!lpOk) noConcluyente("«landing hola»: en dos mensajes distintos no encuentra", "falló la presencia");
    else check(noTiene(lh, ETQ), "«landing hola»: cada palabra en un mensaje distinto, no encuentra", det(lh));
    const so = await ruta(owner, `q=${encodeURIComponent(`secreto-${sufijo}`)}`);
    const soOk = check(tiene(so, AJENA), "«secreto»: el Owner encuentra AJENA por su mensaje (control)", det(so));
    const sm = await ruta(member, `q=${encodeURIComponent(`secreto-${sufijo}`)}`);
    if (!soOk) noConcluyente("«secreto»: el Member no la encuentra", "falló el control del Owner");
    else check(sm.ok && sm.ids.length === 0, "«secreto»: el Member no encuentra nada (AJENA está fuera de su alcance)", det(sm));
    const xm = await ruta(member, `q=${encodeURIComponent(`asignadamsj-${sufijo}`)}`);
    check(tiene(xm, X), "X: el Member la encuentra por su mensaje (la conversación es suya por assigned_to)", det(xm));
    const xn = await ruta(member, `q=${encodeURIComponent(`x-${sufijo}`)}`);
    check(noTiene(xn, X), "X: por el nombre del contacto, el Member no la encuentra (la RLS le oculta el contacto)", det(xn));
  } finally {
    const r = await admin(`contacts?workspace_id=in.(${E},${U})`, { method: "DELETE" });
    check(r.status < 300, "se borran los contactos de los espacios fantasma", `HTTP ${r.status}`);
    limpiar.contactos.length = 0;
  }
}, async () => {
  if (!espaciosFantasma.length) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => (await filas(path)).length;
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`conversations?select=id&workspace_id=in.(${ids})`)) === 0, "conversations: 0");
  check((await cuenta(`channels?select=id&workspace_id=in.(${ids})`)) === 0, "channels: 0");
  check((await cuenta(`tags?select=id&workspace_id=in.(${ids})`)) === 0, "tags: 0");
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log de los espacios fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
