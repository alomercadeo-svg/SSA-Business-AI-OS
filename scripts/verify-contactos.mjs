#!/usr/bin/env node
/**
 * F43, la lista de contactos completa, con sesiones reales contra PRODUCCIÓN,
 * en espacios fantasma que este script crea y borra. Nunca en el espacio real.
 *
 * LO QUE PRUEBA, por criterio de F43 (requerimientos-fase1.md:1203-1207):
 *   1. La lista por páginas desde el servidor, por interacción más reciente,
 *      con el total del alcance de quien mira («130 contactos»).
 *   2. La búsqueda en el servidor (nombre sin tildes, correo, correo
 *      secundario, usuario con y sin «@», teléfono por dígitos, palabra por
 *      palabra) y los cinco filtros de la fila (seguimiento, etapa, setter,
 *      vendedor y etiqueta), en la dirección.
 *   3. «Página N de M» y `?pagina=`.
 *   4. El control positivo: una más allá de las primeras 100 aparece al
 *      buscarla y se abre; con el Member, la búsqueda no trae lo ajeno, y con
 *      el Owner sí.
 *   5. «Sin nombre» en la lista, en la ficha y en la bandeja, con el
 *      identificador como dato secundario en la ficha.
 *   Y el pendiente de S8: la página del Member no trae el nombre, el correo
 *   ni el id del Owner (lista y ficha); la del Owner sí trae al Member.
 *   6. (Agregado el 06/11/2026, ítem 5 del plan maestro; criterio de F43 del
 *      05/11.) El filtro de los que escribieron: con `escribieron=si`, uno que
 *      escribió aparece y uno que nunca escribió (solo mensajes del negocio)
 *      no; sin el filtro, aparecen los dos; con el Member, solo su alcance.
 *      Sus contactos se crean al final, después de todos los pasos de antes,
 *      así no cambian los totales que esos pasos miden.
 *
 * LOS CONTROLES. Cada ausencia va después de su presencia. Las búsquedas
 * apuntan a contactos del puesto 101 en adelante: con la lista de antes (las
 * primeras 100, filtradas en el navegador) no llegan al HTML, así que un rojo
 * es por el motivo del criterio. Las funciones nuevas que todavía no existen
 * dan 404: rojo de carga, no cuenta.
 *
 * QUÉ CAMBIA CADA PASO. Solo la preparación escribe (con la clave de
 * servicio). Las lecturas de HTML, de la ruta y de las funciones no escriben.
 *
 * Uso: node scripts/verify-contactos.mjs
 */
import { admin, check, correr, crearUsuario, limpiar, noConcluyente, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const TOTAL = 130;

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
    /* no es JSON */
  }
  return { status: res.status, cuerpo, timing: res.headers.get("server-timing") };
}

const filas = async (path) => (await admin(path)).data ?? [];
/** Un texto visible: solo, entre etiquetas. Los datos de la página no cuentan. */
const visible = (html, texto) => html.includes(`>${texto}<`);

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

/** El día del calendario en Costa Rica, más `dias`, como AAAA-MM-DD. */
function diaCR(dias = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + dias));
  return d.toISOString().slice(0, 10);
}
const esDomingoEnCR = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/Costa_Rica", weekday: "short" }).format(new Date()) === "Sun";

/** La lista, como HTML, con presencia y después ausencia de nombres visibles. */
async function lista(u, quien, params, presentes, ausentes = []) {
  const r = await pagina(u, `/dashboard/contacts${params ? `?${params}` : ""}`);
  const ok = check(r.status === 200 && presentes.every((n) => visible(r.html, n)), `${quien}, ?${params}: llega ${presentes.join(", ")} (presencia)`, `HTTP ${r.status}`);
  for (const n of ausentes) {
    if (!ok) noConcluyente(`${quien}, ?${params}: no llega ${n}`, "falló la presencia");
    else check(!visible(r.html, n), `${quien}, ?${params}: no llega ${n}`);
  }
  return r;
}

/** Los ids que devuelve una función de la base, con el token de quien mira. */
async function ids(token, fn, args) {
  const r = await rpcComo(token, `${fn}?select=id`, args);
  return { ok: r.status === 200 && Array.isArray(r.data), status: r.status, ids: Array.isArray(r.data) ? r.data.map((c) => c.id) : [] };
}

await correr(async () => {
  console.log(`App: ${APP_URL} · espacios fantasma nuevos`);
  const owner = await crearUsuario("contactos-owner");
  const member = await crearUsuario("contactos-member");
  const tercero = await crearUsuario("contactos-tercero");
  usuariosFantasma = [owner.id, member.id, tercero.id];
  const E = owner.espacio;
  const O = tercero.espacio;
  espaciosFantasma = [E, member.espacio, O];
  espacioDeLaCookie = E;
  await sumarAlEspacio(E, member, "member");
  console.log(`  E ${E.slice(0, 8)}, O ${O.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  try {
    // ── La preparación (lo único que escribe) ──────────────────────────────
    // Sin esto el nombre del Owner llega a la página del Member por el
    // selector de espacios («<dueño>'s Workspace», 00001:313-314), y el paso
    // de la lista del equipo no sería atribuible (lección del tramo B de S8).
    const nombreE = await admin(`workspaces?id=eq.${E}`, { method: "PATCH", body: JSON.stringify({ name: `B9C espacio-${sufijo}` }) });
    if (nombreE.status >= 300) throw new Error(`no se pudo renombrar E: HTTP ${nombreE.status}`);
    const nuevoCanal = async (espacio, campos) => (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...campos }) })).data?.[0]?.id;
    const igE = await nuevoCanal(E, { platform: "instagram", provider: "zernio", late_account_id: `b9c${sufijo}e${Date.now()}`, username: `b9ccuenta${sufijo}` });
    if (!igE) throw new Error("no se pudo crear el canal fantasma");
    const T1 = (await admin("tags", { method: "POST", body: JSON.stringify({ workspace_id: E, name: `b9c-etiqueta-${sufijo}` }) })).data?.[0]?.id;
    if (!T1) throw new Error("no se pudo crear la etiqueta");

    const ahora = Date.now();
    const HOY = diaCR(0);
    const ID_SIN = `1784${String(ahora).slice(-10)}`;
    const ID_ALIAS = `1785${String(ahora).slice(-10)}`;
    const N = {
      obj: `Ñandú Pérez ${sufijo}`,
      correo: `B9C Correo ${sufijo}`,
      segundo: `B9C Segundo ${sufijo}`,
      usuario: `B9C Usuario ${sufijo}`,
      telefono: `B9C Telefono ${sufijo}`,
      dos: `Zorzal ${sufijo}`,
      hoy: `B9C Hoy ${sufijo}`,
      ayer: `B9C Ayer ${sufijo}`,
      manana: `B9C Manana ${sufijo}`,
      etapa3: `B9C Etapa3 ${sufijo}`,
      etapa14: `B9C Etapa14 ${sufijo}`,
      etiqueta: `B9C Etiquetado ${sufijo}`,
      setterOwner: `B9C SetterOwner ${sufijo}`,
      vend: `B9C Vendedor ${sufijo}`,
      sinSetter: `B9C SinSetter ${sufijo}`,
      condor: `Cóndor Ajeno ${sufijo}`,
      nombrado: `B9C Nombrado ${sufijo}`,
      delMember: `B9C DelMember ${sufijo}`,
    };
    // 130 contactos; el puesto k tiene la interacción k minutos atrás.
    const especiales = {
      1: { display_name: N.nombrado },
      2: { display_name: ID_SIN },
      3: { display_name: ID_ALIAS },
      101: { display_name: N.delMember, setter_id: member.id },
      102: { display_name: N.sinSetter },
      109: { display_name: N.obj },
      110: { display_name: N.correo, email: `correo-${sufijo}@ssa-test.local` },
      111: { display_name: N.segundo, secondary_email: `segundo-${sufijo}@ssa-test.local` },
      112: { display_name: N.usuario },
      113: { display_name: N.telefono, phone: "+50688881234", phone_resolved: true },
      114: { display_name: N.dos, email: `cielo-${sufijo}@ssa-test.local` },
      115: { display_name: N.hoy, next_followup_date: HOY },
      116: { display_name: N.ayer, next_followup_date: diaCR(-1) },
      117: { display_name: N.manana, next_followup_date: diaCR(1) },
      118: { display_name: N.etapa3, pipeline_stage: "3. Respondió" },
      119: { display_name: N.etapa14, pipeline_stage: "14. Repesca" },
      120: { display_name: N.etiqueta },
      121: { display_name: N.setterOwner, setter_id: owner.id },
      122: { display_name: N.vend, vendedor_id: owner.id },
      129: { display_name: N.condor, setter_id: owner.id },
    };
    const filasNuevas = Array.from({ length: TOTAL }, (_, k) => ({
      workspace_id: E,
      display_name: `b9c-r${k}-${sufijo}`,
      // El Member: los de relleno múltiplos de 4 (ninguno lleva al Owner).
      setter_id: k % 4 === 0 && !especiales[k] ? member.id : null,
      vendedor_id: null,
      email: null,
      secondary_email: null,
      phone: null,
      phone_resolved: true,
      next_followup_date: null,
      pipeline_stage: null,
      last_interaction_at: new Date(ahora - k * 60_000).toISOString(),
      ...(especiales[k] ?? {}),
    }));
    const alta = await admin("contacts", { method: "POST", body: JSON.stringify(filasNuevas) });
    if (!Array.isArray(alta.data) || alta.data.length !== TOTAL) throw new Error(`no se crearon los contactos: HTTP ${alta.status}`);
    const porNombre = Object.fromEntries(alta.data.map((c) => [c.display_name, c.id]));
    const idDe = (nombre) => porNombre[nombre];
    const delMember = alta.data.filter((c) => c.setter_id === member.id || c.vendedor_id === member.id);
    const totalMember = delMember.length;

    const canal = async (contacto, sender, usuario = null) => {
      const r = await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: contacto, channel_id: igE, platform_sender_id: sender, raw_jid: sender, platform_username: usuario }) });
      if (r.status >= 300) throw new Error(`no se pudo crear el canal del contacto: HTTP ${r.status}`);
    };
    const USUARIO = `b9c.usuario.${sufijo}`;
    const ALIAS = `b9c.alias.${sufijo}`;
    await canal(idDe(N.usuario), `ig-usuario-${sufijo}`, USUARIO);
    await canal(idDe(N.nombrado), `ig-nombrado-${sufijo}`);
    await canal(idDe(ID_SIN), ID_SIN);
    await canal(idDe(ID_ALIAS), ID_ALIAS, ALIAS);
    const et = await admin("contact_tags", { method: "POST", body: JSON.stringify({ contact_id: idDe(N.etiqueta), tag_id: T1 }) });
    if (et.status >= 300) throw new Error(`no se pudo etiquetar: HTTP ${et.status}`);
    // Las conversaciones de la bandeja: la sin nombre arriba de todo.
    const conv = async (contacto, cuando) =>
      (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: E, channel_id: igE, contact_id: contacto, platform: "instagram", historial_estado: "completo", last_message_at: new Date(cuando).toISOString(), last_message_preview: `prev-${sufijo}` }) })).data?.[0]?.id;
    const convSin = await conv(idDe(ID_SIN), ahora);
    const convAlias = await conv(idDe(ID_ALIAS), ahora - 10_000);
    const convNom = await conv(idDe(N.nombrado), ahora - 20_000);
    if (!convSin || !convAlias || !convNom) throw new Error("no se pudieron crear las conversaciones");
    // En O, uno que coincide con la búsqueda de OBJ.
    const otro = await admin("contacts", { method: "POST", body: JSON.stringify({ workspace_id: O, display_name: `Ñandú Pérez Otro ${sufijo}` }) });
    if (!otro.data?.[0]?.id) throw new Error("no se pudo crear el contacto de O");
    console.log(`  ${TOTAL} contactos en E (${totalMember} del Member), OBJ en el puesto 110, 1 en O`);

    // ── 1. La lista por páginas ────────────────────────────────────────────
    titulo("La lista por páginas, con el total del alcance (criterios 1 y 3)");
    const p1 = await pagina(owner, "/dashboard/contacts");
    check(p1.status === 200, "HTTP 200", `HTTP ${p1.status}`);
    const controlPrimero = check(visible(p1.html, `b9c-r0-${sufijo}`), "el más reciente está en la página 1 (control)");
    check(visible(p1.html, `${TOTAL} contactos`), `dice «${TOTAL} contactos»`);
    check(visible(p1.html, "Página 1 de 3"), "dice «Página 1 de 3»");
    if (!controlPrimero) noConcluyente("la página 1 no trae el puesto 51", "falló el control");
    else check(!visible(p1.html, `b9c-r50-${sufijo}`) && visible(p1.html, `b9c-r49-${sufijo}`), "la página 1 trae los primeros 50 y no el 51");
    check(!visible(p1.html, N.obj), "la página 1 no trae OBJ (puesto 110)");
    const p3 = await lista(owner, "Owner", "pagina=3", [N.obj, `b9c-r127-${sufijo}`], [`b9c-r0-${sufijo}`]);
    check(visible(p3.html, "Página 3 de 3"), "dice «Página 3 de 3»");
    const p2 = await pagina(owner, "/dashboard/contacts?pagina=2");
    const orden2 = [`b9c-r50-${sufijo}`, `b9c-r75-${sufijo}`, `b9c-r99-${sufijo}`].map((n) => p2.html.indexOf(`>${n}<`));
    check(orden2.every((i) => i >= 0) && orden2[0] < orden2[1] && orden2[1] < orden2[2], "la página 2 trae del 51 al 100, de la más reciente a la más vieja");

    // ── 2. La búsqueda ─────────────────────────────────────────────────────
    titulo("La búsqueda en el servidor, sobre todos los contactos (criterios 2 y 4)");
    const q = (texto) => `q=${encodeURIComponent(texto)}`;
    const conObj = await lista(owner, "Owner", q("perez"), [N.obj], [`b9c-r0-${sufijo}`, `Ñandú Pérez Otro ${sufijo}`]);
    check(visible(conObj.html, `1 de ${TOTAL} contactos`), `dice «1 de ${TOTAL} contactos»`);
    await lista(owner, "Owner", q(`correo-${sufijo}`), [N.correo], [N.obj]);
    await lista(owner, "Owner", q(`segundo-${sufijo}`), [N.segundo], [N.obj]);
    await lista(owner, "Owner", q(`@${USUARIO}`), [N.usuario], [N.obj]);
    await lista(owner, "Owner", q(USUARIO), [N.usuario], [N.obj]);
    await lista(owner, "Owner", q("8888-1234"), [N.telefono], [N.obj]);
    await lista(owner, "Owner", q(`zorzal cielo-${sufijo}`), [N.dos], [N.obj]);
    const nada = await pagina(owner, `/dashboard/contacts?${q(`zqxw${sufijo}`)}`);
    check(nada.status === 200 && nada.html.includes(`Ningún contacto coincide con «zqxw${sufijo}»`), "sin coincidencias, lo dice");

    // ── 3. Los filtros ─────────────────────────────────────────────────────
    titulo("Los cinco filtros de la fila, en la dirección (criterio 2)");
    await lista(owner, "Owner", "seguimiento=hoy", [N.hoy], [N.ayer, N.manana]);
    if (esDomingoEnCR()) await lista(owner, "Owner", "seguimiento=semana", [N.hoy], [N.ayer, N.manana]);
    else await lista(owner, "Owner", "seguimiento=semana", [N.hoy, N.manana], [N.ayer]);
    await lista(owner, "Owner", "seguimiento=vencido", [N.ayer], [N.hoy, N.manana]);
    await lista(owner, "Owner", `etapa=${encodeURIComponent("3. Respondió")}`, [N.etapa3], [N.etapa14]);
    await lista(owner, "Owner", `etiqueta=${T1}`, [N.etiqueta], [`b9c-r0-${sufijo}`]);
    await lista(owner, "Owner", `setter=${member.id}`, [N.delMember], [N.setterOwner]);
    // Los sin setter son 97: no entran en una página (cambio del 05/11/2026,
    // con el OK de Marcos; en el rojo pasaba por la lista vieja de 100). Se
    // recorren todas las páginas y se comprueba sobre todas juntas.
    {
      const p1sin = await pagina(owner, "/dashboard/contacts?setter=sin");
      const m = p1sin.html.match(/>Página 1 de (\d+)</);
      let html = p1sin.html;
      for (let n = 2; m && n <= Number(m[1]); n++) html += (await pagina(owner, `/dashboard/contacts?setter=sin&pagina=${n}`)).html;
      const ok = check(!!m && visible(html, N.sinSetter), `Owner, ?setter=sin, todas las páginas (${m?.[1] ?? "?"}): llega ${N.sinSetter} (presencia)`);
      for (const n of [N.setterOwner, N.delMember]) {
        if (!ok) noConcluyente(`Owner, ?setter=sin, todas las páginas: no llega ${n}`, "falló la presencia");
        else check(!visible(html, n), `Owner, ?setter=sin, todas las páginas: no llega ${n}`);
      }
    }
    await lista(owner, "Owner", `vendedor=${owner.id}`, [N.vend], [`b9c-r0-${sufijo}`]);
    await lista(owner, "Owner", `seguimiento=hoy&${q("b9c hoy")}`, [N.hoy], [N.ayer]);

    titulo("Los bordes del seguimiento con el reloj fijo a las 18:30 de Costa Rica (00:30 UTC del día siguiente)");
    const reloj = `${HOY}T18:30:00-06:00`;
    for (const [opcion, presentes, ausentes] of [
      ["hoy", [N.hoy], [N.ayer, N.manana]],
      ["vencido", [N.ayer], [N.hoy, N.manana]],
    ]) {
      const r = await ids(owner.token, "contactos_filtrados", { p_workspace: E, p_filtros: { seguimiento: opcion, ahora: reloj } });
      const ok = check(r.ok && presentes.every((n) => r.ids.includes(idDe(n))), `«${opcion}» a las 18:30: llega ${presentes.join(", ")}`, `HTTP ${r.status}`);
      for (const n of ausentes) {
        if (!ok) noConcluyente(`«${opcion}» a las 18:30: no llega ${n}`, "falló la presencia");
        else check(!r.ids.includes(idDe(n)), `«${opcion}» a las 18:30: no llega ${n}`);
      }
    }

    // ── 4. El Member ───────────────────────────────────────────────────────
    titulo("El alcance del Member (criterio 4)");
    const controlOwner = await pagina(owner, `/dashboard/contacts?${q("condor")}`);
    const condorOwner = check(visible(controlOwner.html, N.condor), "el Owner encuentra «condor» (control positivo)");
    const pm = await pagina(member, `/dashboard/contacts?${q("condor")}`);
    if (!condorOwner) noConcluyente("el Member no encuentra «condor»", "falló el control del Owner");
    else check(pm.status === 200 && !visible(pm.html, N.condor) && !pm.html.includes(idDe(N.condor)), "el Member no encuentra «condor», ni como dato");
    const pmTodo = await pagina(member, "/dashboard/contacts");
    check(visible(pmTodo.html, `${totalMember} contactos`), `el Member: «${totalMember} contactos», su alcance`);
    check(visible(pmTodo.html, "Página 1 de 1"), "el Member: «Página 1 de 1»");
    const cOwner = await rpcComo(owner.token, "contactos_cantidad", { p_workspace: E, p_filtros: { q: "condor" } });
    const cMember = await rpcComo(member.token, "contactos_cantidad", { p_workspace: E, p_filtros: { q: "condor" } });
    const okCant = check(cOwner.status === 200 && Number(cOwner.data) === 1, "la función, con el token del Owner: 1 (control positivo)", `HTTP ${cOwner.status} ${JSON.stringify(cOwner.data)}`);
    if (!okCant) noConcluyente("la función, con el token del Member: 0", "falló el control");
    else check(cMember.status === 200 && Number(cMember.data) === 0, "la función, con el token del Member: 0", `HTTP ${cMember.status} ${JSON.stringify(cMember.data)}`);
    const todosMember = await ids(member.token, "contactos_filtrados", { p_workspace: E, p_filtros: {} });
    check(todosMember.ok && todosMember.ids.length === totalMember && delMember.every((c) => todosMember.ids.includes(c.id)), `la función, con el token del Member: sus ${totalMember}, ninguno más`, `HTTP ${todosMember.status}, ${todosMember.ids.length}`);
    const enO = await ids(owner.token, "contactos_filtrados", { p_workspace: O, p_filtros: { q: "perez" } });
    check(enO.ok && enO.ids.length === 0, "el Owner de E, pidiendo el espacio O: nada", `HTTP ${enO.status}, ${enO.ids.length}`);

    // ── 5. El equipo, según el rol ─────────────────────────────────────────
    titulo("La lista del equipo: el Member no recibe al Owner (pendiente de S8)");
    const ownerVe = check(pmTodo.status === 200 && p1.html.includes("B3 contactos-member"), "la lista del Owner trae el nombre del Member (control positivo)");
    const fichaMember = await pagina(member, `/dashboard/contacts/${idDe(N.delMember)}`);
    const fichaOk = check(fichaMember.status === 200 && fichaMember.html.includes(N.delMember), "el Member abre la ficha de su lead (control)", `HTTP ${fichaMember.status}`);
    for (const [html, donde, ok] of [[pmTodo.html, "la lista", ownerVe], [fichaMember.html, "la ficha", fichaOk && ownerVe]]) {
      if (!ok) {
        noConcluyente(`${donde} del Member no trae al Owner`, "falló el control");
        continue;
      }
      check(!html.includes("B3 contactos-owner"), `${donde} del Member no trae el nombre del Owner`);
      check(!html.includes(owner.email), `${donde} del Member no trae el correo del Owner`);
      check(!html.includes(owner.id), `${donde} del Member no trae el id del Owner`);
    }

    // ── 6. «Sin nombre» ────────────────────────────────────────────────────
    titulo("«Sin nombre» en la lista, en la ficha y en la bandeja (criterio 5)");
    const nombradoLista = check(visible(p1.html, N.nombrado), "la lista: el contacto con nombre muestra su nombre (control)");
    if (!nombradoLista) noConcluyente("la lista: «Sin nombre» y no el identificador", "falló el control");
    else {
      check(visible(p1.html, "Sin nombre"), "la lista: muestra «Sin nombre»");
      check(!visible(p1.html, ID_SIN), "la lista: no muestra el identificador como nombre");
      check(visible(p1.html, `@${ALIAS}`) && !visible(p1.html, ID_ALIAS), "la lista: el que tiene usuario muestra «@usuario»");
    }
    const fs = await pagina(owner, `/dashboard/contacts/${idDe(ID_SIN)}`);
    check(fs.status === 200 && fs.html.includes(">Sin nombre</h1>"), "la ficha: el título es «Sin nombre»", `HTTP ${fs.status}`);
    check(fs.html.includes(`identificador ${ID_SIN}`), "la ficha: el identificador queda como dato secundario");
    const bandeja = await pagina(owner, "/dashboard/inbox");
    const nombradoBandeja = check(bandeja.status === 200 && visible(bandeja.html, N.nombrado), "la bandeja: la conversación con nombre lo muestra (control)", `HTTP ${bandeja.status}`);
    if (!nombradoBandeja) noConcluyente("la bandeja: «Sin nombre» y no el identificador", "falló el control");
    else {
      check(visible(bandeja.html, "Sin nombre") && !visible(bandeja.html, ID_SIN), "la bandeja: «Sin nombre», no el identificador");
      check(visible(bandeja.html, `@${ALIAS}`) && !visible(bandeja.html, ID_ALIAS), "la bandeja: el que tiene usuario muestra «@usuario»");
    }

    // ── 7. Se abre ─────────────────────────────────────────────────────────
    titulo("OBJ, más allá de los primeros 100, se abre (criterio 4)");
    const fo = await pagina(owner, `/dashboard/contacts/${idDe(N.obj)}`);
    check(fo.status === 200 && fo.html.includes(N.obj), "su ficha responde 200 con su nombre", `HTTP ${fo.status}`);
    check(conObj.html.includes(`/dashboard/contacts/${idDe(N.obj)}`), "la búsqueda trae el enlace a su ficha");

    // ── 8. La ruta ─────────────────────────────────────────────────────────
    titulo("La ruta de la lista, con Server-Timing");
    const r = await json(owner, `/api/v1/contacts?${q("perez")}`);
    check(r.status === 200 && Array.isArray(r.cuerpo?.contactos) && r.cuerpo.contactos.some((c) => c.id === idDe(N.obj)), "GET ?q=perez trae OBJ", `HTTP ${r.status}`);
    check(r.cuerpo?.cantidad === 1 && r.cuerpo?.total === TOTAL && r.cuerpo?.paginas === 1, "con cantidad 1, total y páginas", JSON.stringify({ c: r.cuerpo?.cantidad, t: r.cuerpo?.total, p: r.cuerpo?.paginas }));
    check(/total;dur=/.test(r.timing ?? ""), "trae Server-Timing", r.timing ?? "sin cabecera");
    const r3 = await json(owner, "/api/v1/contacts?pagina=3");
    check(r3.status === 200 && r3.cuerpo?.contactos?.length === TOTAL - 100 && r3.cuerpo.contactos.some((c) => c.id === idDe(N.obj)), "GET ?pagina=3 trae los 30 últimos, con OBJ", `HTTP ${r3.status}`);
    const rm = await json(member, `/api/v1/contacts?${q("condor")}`);
    check(rm.status === 200 && rm.cuerpo?.cantidad === 0, "GET como el Member, «condor»: 0", `HTTP ${rm.status}`);

    // ── 9. Igual que la bandeja ────────────────────────────────────────────
    titulo("La búsqueda de contactos encuentra lo mismo que la de la bandeja");
    const muestra = [N.obj, N.correo, N.segundo, N.usuario, N.telefono, N.dos, N.nombrado, `b9c-r0-${sufijo}`, `b9c-r5-${sufijo}`].map(idDe);
    for (const texto of ["perez", "8888", `@${USUARIO}`, `zorzal cielo-${sufijo}`, `zqxw${sufijo}`]) {
      const nueva = await ids(owner.token, "contactos_filtrados", { p_workspace: E, p_filtros: { q: texto } });
      if (!nueva.ok) {
        check(false, `«${texto}»: la función nueva responde`, `HTTP ${nueva.status}`);
        continue;
      }
      const vieja = [];
      for (const id of muestra) {
        const b = await rpcComo(owner.token, "bandeja_busca", { p_conversacion: null, p_contacto: id, p_busqueda: texto });
        if (b.data === true) vieja.push(id);
      }
      const enMuestra = nueva.ids.filter((id) => muestra.includes(id));
      check(enMuestra.length === vieja.length && vieja.every((id) => enMuestra.includes(id)), `«${texto}»: las mismas (${vieja.length})`, `nueva ${enMuestra.length}, bandeja ${vieja.length}`);
    }

    // ── 9b. Los que escribieron (06/11/2026, criterio 6 de F43) ────────────
    // Se preparan acá, después de todos los pasos que miden totales.
    titulo("El filtro de los que escribieron (criterio de F43 del 05/11/2026)");
    const W = {
      escribio: `B9CW Escribio ${sufijo}`,
      nunca: `B9CW Nunca ${sufijo}`,
      delMember: `B9CW EscribioMember ${sufijo}`,
      ajeno: `B9CW EscribioAjeno ${sufijo}`,
    };
    const altaW = await admin("contacts", {
      method: "POST",
      body: JSON.stringify([
        { workspace_id: E, display_name: W.escribio, setter_id: null, last_interaction_at: new Date(ahora - 500 * 60_000).toISOString() },
        { workspace_id: E, display_name: W.nunca, setter_id: null, last_interaction_at: new Date(ahora - 501 * 60_000).toISOString() },
        { workspace_id: E, display_name: W.delMember, setter_id: member.id, last_interaction_at: new Date(ahora - 502 * 60_000).toISOString() },
        { workspace_id: E, display_name: W.ajeno, setter_id: owner.id, last_interaction_at: new Date(ahora - 503 * 60_000).toISOString() },
      ]),
    });
    if (!Array.isArray(altaW.data) || altaW.data.length !== 4) throw new Error(`no se crearon los contactos de W: HTTP ${altaW.status}`);
    const idW = Object.fromEntries(altaW.data.map((c) => [c.display_name, c.id]));
    for (const [nombre, direccion] of [[W.escribio, "inbound"], [W.nunca, "outbound"], [W.delMember, "inbound"], [W.ajeno, "inbound"]]) {
      const cv = await conv(idW[nombre], ahora - 600 * 60_000);
      if (!cv) throw new Error("no se pudo crear la conversación de W");
      const m = await admin("messages", { method: "POST", body: JSON.stringify({ conversation_id: cv, direction: direccion, text: `w-${sufijo}`, platform_message_id: `b9cw-${direccion}-${idW[nombre].slice(0, 8)}-${sufijo}` }) });
      if (m.status >= 300) throw new Error(`no se pudo crear el mensaje de W: HTTP ${m.status}`);
    }
    const sinFiltro = await ids(owner.token, "contactos_filtrados", { p_workspace: E, p_filtros: { q: "b9cw" } });
    const okW = check(
      sinFiltro.ok && Object.values(idW).every((id) => sinFiltro.ids.includes(id)),
      "Owner, sin el filtro: aparecen los cuatro, también el que nunca escribió (control positivo)",
      `HTTP ${sinFiltro.status}, ${sinFiltro.ids.length}`,
    );
    const conFiltro = await ids(owner.token, "contactos_filtrados", { p_workspace: E, p_filtros: { q: "b9cw", escribieron: "si" } });
    check(conFiltro.ok && [W.escribio, W.delMember, W.ajeno].every((n) => conFiltro.ids.includes(idW[n])), "Owner, con escribieron=si: aparecen los tres que escribieron (presencia)", `HTTP ${conFiltro.status}, ${conFiltro.ids.length}`);
    if (!okW) noConcluyente("Owner, con escribieron=si: no aparece el que nunca escribió", "falló el control positivo");
    else check(conFiltro.ok && !conFiltro.ids.includes(idW[W.nunca]), "Owner, con escribieron=si: no aparece el que nunca escribió", `${conFiltro.ids.length} contactos`);
    const memberW = await ids(member.token, "contactos_filtrados", { p_workspace: E, p_filtros: { q: "b9cw", escribieron: "si" } });
    check(memberW.ok && memberW.ids.includes(idW[W.delMember]), "Member, con escribieron=si: aparece el suyo que escribió (presencia)", `HTTP ${memberW.status}`);
    check(memberW.ok && !memberW.ids.includes(idW[W.ajeno]) && memberW.ids.length === 1, "Member, con escribieron=si: solo el suyo, no el ajeno", `${memberW.ids.length} contactos`);
    const cuantos = await rpcComo(owner.token, "contactos_cantidad", { p_workspace: E, p_filtros: { q: "b9cw", escribieron: "si" } });
    check(cuantos.status === 200 && Number(cuantos.data) === 3, "contactos_cantidad, con escribieron=si: 3", `HTTP ${cuantos.status} ${JSON.stringify(cuantos.data)}`);
    const pw = await lista(owner, "Owner", "q=b9cw&escribieron=si", [W.escribio], [W.nunca]);
    check(pw.html.includes('<option value="si" selected="">Solo los que escribieron</option>'), "la página muestra el filtro puesto («Solo los que escribieron»)");
    await lista(owner, "Owner", "q=b9cw", [W.escribio, W.nunca]);

    // ── 10. Server-Timing de la bandeja (solo se anota) ────────────────────
    titulo("Server-Timing de la bandeja, tres corridas (se anota, no se juzga)");
    for (let i = 0; i < 3; i++) {
      const b = await json(owner, "/api/v1/conversations?estado=all");
      console.log(`  corrida ${i + 1}: HTTP ${b.status} · ${b.timing ?? "sin cabecera"}`);
    }
  } finally {
    const r = await admin(`contacts?workspace_id=in.(${espaciosFantasma.join(",")})`, { method: "DELETE" });
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
