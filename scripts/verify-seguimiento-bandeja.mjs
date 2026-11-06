#!/usr/bin/env node
/**
 * F35, tramo C de S8: el selector de próximo seguimiento del panel de la
 * bandeja, y la vuelta de la ficha a la bandeja. Con sesiones reales contra
 * PRODUCCIÓN, en espacios fantasma que este script crea y borra. Nunca en
 * «Ale Admin's Workspace».
 *
 * EL CAMINO es el mismo que usa el panel: `PATCH /api/v1/contacts/[id]` con la
 * cookie de cada uno y el `Origin` de la app. «En 3 días» viaja como
 * `seguimiento_en_dias: 3` y lo resuelve el servidor; «Otra fecha» y «Quitar»
 * viajan como `next_followup_date`. La lista se lee por la ruta de la bandeja
 * (`GET /api/v1/conversations`) con los filtros de seguimiento.
 *
 * LOS ESPACIOS:
 *   E  el del Owner, con la zona por defecto (America/Costa_Rica). El Member
 *      es miembro. Se renombra sin el nombre del Owner.
 *   K  el espacio propio del Member, con `zona_horaria = 'Pacific/Kiritimati'`,
 *      20 horas adelante de Costa Rica (decidido por Marcos el 04/11/2026): su
 *      «hoy» es distinto del de Costa Rica entre las 4:00 y las 24:00 de Costa
 *      Rica. Fuera de esa franja el paso de la zona da «no concluyente».
 *
 * EL ESCENARIO:
 *   M1  en E, del Member (setter), sin fecha, una conversación de Instagram
 *   M2  en E, del Member, con fecha de hoy (Costa Rica): el control de
 *       presencia de los filtros
 *   A   en E, del Owner (sin setter ni vendedor: el Member no lo ve), con fecha
 *       de hoy más 20
 *   K1  en K, sin fecha, una conversación de Instagram
 *   K2  en K, con fecha de hoy en Kiritimati: el control de que la base acepta
 *       la zona y la usa
 *
 * QUÉ CAMBIA CADA PASO. La preparación escribe con la clave de servicio, antes
 * de todo. Después, lo único que escribe son los PATCH de la ruta: cambian
 * `contacts.next_followup_date` y suman filas a `audit_log`; no tocan
 * `conversations`. Las lecturas de la lista no escriben. Cada condición se
 * prepara y se lee junta: un PATCH y enseguida sus lecturas. Una comprobación
 * por ausencia («ya no está») va después de la de presencia que la hace
 * significativa, y si esa falló, da «no concluyente».
 *
 * LOS ROJOS, dichos antes de correrlo contra el código de antes del tramo:
 *   - Los pasos que mandan `seguimiento_en_dias` reciben 400 («Pedido
 *     inválido.»): el campo no existe. Es un rojo de carga y no cuenta.
 *   - La auditoría, «Quitar», «Otra fecha» y el rechazo del Member con fecha
 *     explícita ya pasan antes del tramo: la ruta existe. No se ven en rojo.
 *   - La vuelta de la ficha (paso 10): la flecha dice «Contactos» aunque llegue
 *     `?volver=`. Es el único rojo por su motivo en producción.
 *
 * El `audit_log` no se borra nunca (F31): las filas de este script quedan sin
 * espacio cuando el espacio fantasma se borra.
 *
 * Uso: node scripts/verify-seguimiento-bandeja.mjs
 */
import { admin, check, correr, crearContacto, crearUsuario, limpiar, noConcluyente, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const ZONA_E = "America/Costa_Rica";
const ZONA_K = "Pacific/Kiritimati";

let usuariosFantasma = [];

/** La cookie como la arma `@supabase/ssr` 0.8.0, más la del espacio elegido. */
function cookieDe(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacio}`);
  return partes.join("; ");
}

async function pagina(u, espacio, ruta) {
  const res = await fetch(`${APP_URL}${ruta}`, { headers: { Cookie: cookieDe(u, espacio) }, redirect: "manual" });
  const html = (await res.text()).replace(/<!-- -->/g, "");
  return { status: res.status, html };
}

/** El mismo pedido que hace el panel. */
async function guardar(u, espacio, contacto, cuerpo) {
  const res = await fetch(`${APP_URL}/api/v1/contacts/${contacto}`, {
    method: "PATCH",
    headers: { Cookie: cookieDe(u, espacio), "Content-Type": "application/json", Origin: APP_URL },
    body: JSON.stringify(cuerpo),
    redirect: "manual",
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}

/** Los ids de la lista de la bandeja con un filtro de seguimiento, o null si la ruta falló. */
async function lista(u, espacio, filtro) {
  const res = await fetch(`${APP_URL}/api/v1/conversations?estado=all&${filtro}`, { headers: { Cookie: cookieDe(u, espacio) }, redirect: "manual" });
  const cuerpo = await res.json().catch(() => null);
  if (res.status !== 200 || !Array.isArray(cuerpo?.conversaciones)) return { status: res.status, ids: null };
  return { status: res.status, ids: cuerpo.conversaciones.map((c) => c.id) };
}

const filas = async (path) => (await admin(path)).data ?? [];
const fechaDe = async (contacto) => (await filas(`contacts?select=next_followup_date&id=eq.${contacto}`))[0]?.next_followup_date ?? null;
const auditoriaDe = (contacto) => filas(`audit_log?select=id,actor_id,action,changes,created_at&entity_type=eq.contacto&entity_id=eq.${contacto}&order=created_at`);

/** Hoy, como AAAA-MM-DD, en una zona. */
const hoyEn = (zona) => new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function masDias(fecha, n) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
/** El domingo de la semana de `fecha` (la semana va de lunes a domingo). */
function domingoDe(fecha) {
  const [a, m, d] = fecha.split("-").map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  return masDias(fecha, dia === 0 ? 0 : 7 - dia);
}
const rango = (f) => `seguimiento=rango&seguimiento_desde=${f}&seguimiento_hasta=${f}`;
const OPCIONES = (f) => [
  ["«Vence hoy»", "seguimiento=hoy"],
  ["«Vence esta semana»", "seguimiento=semana"],
  ["«Vencido»", "seguimiento=vencido"],
  [`«Rango de fechas» del ${f}`, rango(f)],
];

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

await correr(async () => {
  console.log(`App: ${APP_URL} · espacios fantasma nuevos`);
  const owner = await crearUsuario("seg-owner");
  const member = await crearUsuario("seg-member");
  usuariosFantasma = [owner.id, member.id];
  const E = owner.espacio;
  const K = member.espacio;
  await sumarAlEspacio(E, member, "member");
  console.log(`  E ${E.slice(0, 8)} (Owner ${owner.id.slice(0, 8)}), K ${K.slice(0, 8)} (Member ${member.id.slice(0, 8)})`);

  try {
    // ── La preparación, con la clave de servicio ───────────────────────────
    const nombre = await admin(`workspaces?id=eq.${E}`, { method: "PATCH", body: JSON.stringify({ name: `B8S espacio-${sufijo}` }) });
    if (nombre.status >= 300) throw new Error(`no se pudo renombrar E: HTTP ${nombre.status}`);
    const zona = await admin(`workspaces?id=eq.${K}`, { method: "PATCH", body: JSON.stringify({ zona_horaria: ZONA_K }) });
    if (zona.status >= 300) throw new Error(`no se pudo poner la zona de K: HTTP ${zona.status}`);

    const nuevoCanal = async (espacio, campos) => {
      const id = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, ...campos }) })).data?.[0]?.id;
      if (!id) throw new Error("no se pudo crear un canal fantasma");
      limpiar.canales.push(id);
      return id;
    };
    const igE = await nuevoCanal(E, { platform: "instagram", provider: "zernio", late_account_id: `b8s${sufijo}e${Date.now()}`, username: `b8scuenta${sufijo}` });
    const igK = await nuevoCanal(K, { platform: "instagram", provider: "zernio", late_account_id: `b8s${sufijo}k${Date.now()}`, username: `b8scuentak${sufijo}` });

    const hoyE = hoyEn(ZONA_E);
    const hoyK = hoyEn(ZONA_K);
    const m = { setter_id: member.id };
    const contacto = async (espacio, n, campos) => (await crearContacto(espacio, { display_name: `B8S ${n}-${sufijo}`, ...campos })).id;
    const M1 = await contacto(E, "m1", { ...m });
    const M2 = await contacto(E, "m2", { ...m, next_followup_date: hoyE });
    const A = await contacto(E, "ajeno", { next_followup_date: masDias(hoyE, 20) });
    const K1 = await contacto(K, "k1", {});
    const K2 = await contacto(K, "k2", { next_followup_date: hoyK });
    const conv = async (espacio, canal, c) =>
      (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canal, contact_id: c, platform: "instagram", historial_estado: "completo", last_message_at: new Date().toISOString(), last_message_preview: `prev-${sufijo}` }) })).data?.[0]?.id;
    const cM1 = await conv(E, igE, M1);
    const cM2 = await conv(E, igE, M2);
    const cK1 = await conv(K, igK, K1);
    const cK2 = await conv(K, igK, K2);
    if (!cM1 || !cM2 || !cK1 || !cK2) throw new Error("no se pudieron crear las conversaciones fantasma");

    // ── 1. Antes de tocar nada ─────────────────────────────────────────────
    titulo("Antes de tocar nada: los filtros andan, y M1 (sin fecha) no está en ninguna opción");
    const hoyM = await lista(member, E, "seguimiento=hoy");
    const filtrosAndan = check(hoyM.ids?.includes(cM2) === true, "«Vence hoy», Member: está M2 (fecha de hoy), el control de presencia", `HTTP ${hoyM.status}`);
    for (const [texto, filtro] of OPCIONES(masDias(hoyE, 3))) {
      const r = await lista(member, E, filtro);
      if (!filtrosAndan || r.ids === null) noConcluyente(`${texto}: M1 sin fecha no está`, "falló el control de presencia de los filtros");
      else check(!r.ids.includes(cM1), `${texto}: M1 sin fecha no está`);
    }

    // ── 2 a 4. «En 3 días» ─────────────────────────────────────────────────
    titulo("«En 3 días» desde la bandeja, con la sesión del Member, sobre M1");
    const antes3 = masDias(hoyEn(ZONA_E), 3);
    const en3 = await guardar(member, E, M1, { seguimiento_en_dias: 3 });
    const despues3 = masDias(hoyEn(ZONA_E), 3);
    const guardo3 = check(en3.status === 200, "la ruta acepta «En 3 días»: 200", `HTTP ${en3.status} ${JSON.stringify(en3.cuerpo).slice(0, 160)}`);
    const D3 = antes3;
    if (antes3 !== despues3) {
      noConcluyente("la fecha es hoy (Costa Rica) más 3", "pasó la medianoche de Costa Rica durante el pedido");
    } else {
      check(en3.cuerpo?.next_followup_date === D3, `la respuesta trae la fecha: ${D3}`, `trajo ${JSON.stringify(en3.cuerpo?.next_followup_date)}`);
      check((await fechaDe(M1)) === D3, `en la base, M1 tiene ${D3}`, `tiene ${await fechaDe(M1)}`);
    }

    titulo("El historial de auditoría de M1");
    const aud1 = await auditoriaDe(M1);
    const fila1 = aud1[0];
    check(aud1.length === 1, "exactamente una fila", `hay ${aud1.length}`);
    check(fila1?.action === "contacto.editado", "como contacto editado", fila1?.action);
    check(fila1?.actor_id === member.id, "hecha por el Member");
    check(
      fila1?.changes?.next_followup_date?.antes === null && fila1?.changes?.next_followup_date?.despues === D3,
      `con el valor anterior (vacío) y el nuevo (${D3})`,
      JSON.stringify(fila1?.changes),
    );

    titulo(`M1 en el filtro, con la sesión del Member`);
    const enRango = await lista(member, E, rango(D3));
    const presenteEnRango = check(guardo3 && enRango.ids?.includes(cM1) === true, `«Rango de fechas» del ${D3}: está M1`, `HTTP ${enRango.status}`);
    const hoyTras3 = await lista(member, E, "seguimiento=hoy");
    if (!hoyTras3.ids?.includes(cM2)) noConcluyente("«Vence hoy»: M1 no está", "falló el control de presencia (M2)");
    else if (!presenteEnRango) noConcluyente("«Vence hoy»: M1 no está", "M1 no quedó con fecha");
    else check(!hoyTras3.ids.includes(cM1), "«Vence hoy»: M1 no está (vence en 3 días)");
    const vencidoTras3 = await lista(member, E, "seguimiento=vencido");
    if (!presenteEnRango || vencidoTras3.ids === null) noConcluyente("«Vencido»: M1 no está", "M1 no quedó con fecha");
    else check(!vencidoTras3.ids.includes(cM1), "«Vencido»: M1 no está");
    const semanaTras3 = await lista(member, E, "seguimiento=semana");
    const dentroDeLaSemana = D3 <= domingoDe(hoyE);
    if (!presenteEnRango || semanaTras3.ids === null) noConcluyente("«Vence esta semana»", "M1 no quedó con fecha");
    else check(semanaTras3.ids.includes(cM1) === dentroDeLaSemana, `«Vence esta semana»: M1 ${dentroDeLaSemana ? "está" : "no está"} (el domingo es ${domingoDe(hoyE)})`);

    // ── 5. El Member contra el Owner ───────────────────────────────────────
    titulo("Un contacto ajeno: el Member no puede, el Owner sí");
    const fechaA = await fechaDe(A);
    const audA0 = (await auditoriaDe(A)).length;
    const mA = await guardar(member, E, A, { seguimiento_en_dias: 7 });
    const mAfecha = await fechaDe(A);
    const mAaud = (await auditoriaDe(A)).length;
    const mAx = await guardar(member, E, A, { next_followup_date: masDias(hoyE, 1) });
    const mAxfecha = await fechaDe(A);
    const mAxaud = (await auditoriaDe(A)).length;
    const antes7 = masDias(hoyEn(ZONA_E), 7);
    const oA = await guardar(owner, E, A, { seguimiento_en_dias: 7 });
    const despues7 = masDias(hoyEn(ZONA_E), 7);
    const audA = await auditoriaDe(A);
    const ownerPudo = check(
      oA.status === 200 && antes7 === despues7 && (await fechaDe(A)) === antes7 && audA.length === audA0 + 1 && audA.at(-1)?.actor_id === owner.id,
      `el Owner, «En 7 días» sobre A: 200, ${antes7}, y una fila suya en el historial (control)`,
      `HTTP ${oA.status}, filas ${audA.length - audA0}`,
    );
    if (!ownerPudo) {
      noConcluyente("el Member, «En 7 días» sobre A: rechazado y sin efecto", "falló el control del Owner");
    } else {
      check(mA.status === 404, "el Member, «En 7 días» sobre A: rechazado con 404", `HTTP ${mA.status}`);
      check(mAfecha === fechaA && mAaud === audA0, "y sin efecto: la fecha de A no cambió y no hay fila nueva", `fecha ${mAfecha}, filas ${mAaud - audA0}`);
    }
    // Esto ya pasaba antes del tramo (la seguridad por filas es de la 00019).
    check(mAx.status === 404 && mAxfecha === fechaA && mAxaud === audA0, "el Member, con fecha explícita sobre A: 404 y sin efecto", `HTTP ${mAx.status}`);

    // ── 6. «Quitar» ────────────────────────────────────────────────────────
    titulo("«Quitar» sobre M1, con la sesión del Member");
    const quitar = await guardar(member, E, M1, { next_followup_date: null });
    check(quitar.status === 200, "200", `HTTP ${quitar.status}`);
    check(quitar.cuerpo !== null && "next_followup_date" in quitar.cuerpo && quitar.cuerpo.next_followup_date === null, "la respuesta trae la fecha vacía", JSON.stringify(quitar.cuerpo));
    check((await fechaDe(M1)) === null, "en la base, M1 no tiene fecha");
    const aud2 = (await auditoriaDe(M1)).at(-1);
    check(
      aud2?.changes?.next_followup_date?.antes === D3 && aud2?.changes?.next_followup_date?.despues === null,
      `una fila con el valor anterior (${D3}) y el nuevo (vacío)`,
      JSON.stringify(aud2?.changes),
    );
    for (const [texto, filtro] of OPCIONES(D3)) {
      const r = await lista(member, E, filtro);
      if (!presenteEnRango || r.ids === null) noConcluyente(`${texto}: M1 ya no está`, "no se probó antes que estaba");
      else check(!r.ids.includes(cM1), `${texto}: M1 ya no está`);
    }

    // ── 7. «Otra fecha» ────────────────────────────────────────────────────
    titulo("«Otra fecha» con hoy, sobre M1");
    const otra = await guardar(member, E, M1, { next_followup_date: hoyE });
    check(otra.status === 200 && otra.cuerpo?.next_followup_date === hoyE, `200, y la respuesta trae ${hoyE}`, `HTTP ${otra.status} ${JSON.stringify(otra.cuerpo)}`);
    const hoyOtra = await lista(member, E, "seguimiento=hoy");
    const semanaOtra = await lista(member, E, "seguimiento=semana");
    check(hoyOtra.ids?.includes(cM1) === true, "«Vence hoy»: está M1");
    check(semanaOtra.ids?.includes(cM1) === true, "«Vence esta semana»: está M1");

    // ── 8. La zona del espacio ─────────────────────────────────────────────
    titulo(`La zona del espacio: K está en ${ZONA_K}`);
    const hoyKl = await lista(member, K, "seguimiento=hoy");
    const baseAceptaLaZona = check(hoyKl.ids?.includes(cK2) === true, `la base acepta ${ZONA_K}: «Vence hoy» en K trae K2 (fecha ${hoyK})`, `HTTP ${hoyKl.status}`);
    const antesK = masDias(hoyEn(ZONA_K), 3);
    const enK = await guardar(member, K, K1, { seguimiento_en_dias: 3 });
    const despuesK = masDias(hoyEn(ZONA_K), 3);
    const distingue = hoyEn(ZONA_K) !== hoyEn(ZONA_E);
    if (!baseAceptaLaZona) noConcluyente("«En 3 días» en K se cuenta desde hoy en Kiritimati", "la base no mostró que acepta la zona");
    else if (antesK !== despuesK) noConcluyente("«En 3 días» en K se cuenta desde hoy en Kiritimati", "pasó la medianoche de Kiritimati durante el pedido");
    else if (!distingue) noConcluyente("«En 3 días» en K se cuenta desde hoy en Kiritimati", "a esta hora, hoy es el mismo día en Kiritimati y en Costa Rica: el paso no distingue");
    else {
      check(enK.status === 200 && enK.cuerpo?.next_followup_date === antesK, `200, y ${antesK} (hoy en Kiritimati más 3; en Costa Rica sería ${masDias(hoyEn(ZONA_E), 3)})`, `HTTP ${enK.status} ${JSON.stringify(enK.cuerpo)}`);
      const rK = await lista(member, K, rango(antesK));
      check(rK.ids?.includes(cK1) === true, `«Rango de fechas» del ${antesK} en K: está K1`);
    }

    // ── 9. Lo que no se acepta ─────────────────────────────────────────────
    titulo("Lo que no se acepta");
    const fechaM1 = await fechaDe(M1);
    const audM1 = (await auditoriaDe(M1)).length;
    const r5 = await guardar(member, E, M1, { seguimiento_en_dias: 5 });
    const rTexto = await guardar(member, E, M1, { seguimiento_en_dias: "3" });
    const rJuntos = await guardar(member, E, M1, { seguimiento_en_dias: 3, next_followup_date: "2030-01-01" });
    // Antes del tramo los tres dan 400 porque el campo no existe: no se ven en rojo.
    check(r5.status === 400 && rTexto.status === 400 && rJuntos.status === 400, "5 días, «3» como texto, y los dos campos juntos: 400", `HTTP ${r5.status}, ${rTexto.status}, ${rJuntos.status}`);
    check((await fechaDe(M1)) === fechaM1 && (await auditoriaDe(M1)).length === audM1, "y sin efecto: la fecha y el historial de M1 no cambiaron");

    // ── 10. La vuelta de la ficha a la bandeja ─────────────────────────────
    titulo("La ficha abierta desde la bandeja vuelve a la bandeja como estaba");
    const VOLVER = `/dashboard/inbox?q=b8s&estado=all&seguimiento=hoy&conversacion=${cM1}`;
    const conVolver = await pagina(member, E, `/dashboard/contacts/${M1}?volver=${encodeURIComponent(VOLVER)}`);
    const hrefVolver = `href="${VOLVER.replace(/&/g, "&amp;")}"`;
    // Desde el retrabajo del ítem 4 del plan maestro (06/11/2026, punto d,
    // decidido por Marcos): con una conversación en la vuelta, la flecha dice
    // «Volver al chat» (`textoDeLaVuelta`, lib/ficha.ts). Sigue exigiendo que
    // vaya a esa dirección exacta.
    const flechaABandeja = new RegExp(`<a[^>]*${hrefVolver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>(?:<svg[\\s\\S]*?</svg>)?\\s*Volver al chat\\s*</a>`);
    const vuelve = check(conVolver.status === 200 && flechaABandeja.test(conVolver.html), "con ?volver= de la bandeja con una conversación, la flecha dice «Volver al chat» y va a esa dirección", `HTTP ${conVolver.status}`);
    const flechaAContactos = /<a[^>]*href="\/dashboard\/contacts"[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*Contactos\s*<\/a>/;
    for (const externa of ["https://evil.example/dashboard/inbox", "//evil.example/dashboard/inbox", "/dashboard/inboxx", "/dashboard/inbox/../settings"]) {
      const p = await pagina(member, E, `/dashboard/contacts/${M1}?volver=${encodeURIComponent(externa)}`);
      const sinEnlace = !p.html.includes(`href="${externa}"`);
      if (!vuelve) noConcluyente(`con ?volver=${externa}, la flecha sigue en «Contactos»`, "falló la vuelta con una dirección válida");
      else check(p.status === 200 && sinEnlace && flechaAContactos.test(p.html), `con ?volver=${externa}, la flecha sigue en «Contactos» y no hay enlace a esa dirección`, `HTTP ${p.status}`);
    }
    const sinVolver = await pagina(member, E, `/dashboard/contacts/${M1}`);
    check(flechaAContactos.test(sinVolver.html), "sin ?volver=, la flecha dice «Contactos»");
  } finally {
    for (const espacio of [E, K]) {
      const r = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
      check(r.status < 300, `se borran los contactos del espacio fantasma ${espacio.slice(0, 8)}`, `HTTP ${r.status}`);
    }
    limpiar.contactos.length = 0;
  }
}, async () => {
  if (limpiar.workspaces.length === 0) return;
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
  console.log(`  audit_log de los espacios fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
