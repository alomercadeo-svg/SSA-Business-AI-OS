#!/usr/bin/env node
/**
 * F36, Respuestas rápidas (ítem 6 del plan maestro, 06/11/2026), con sesiones
 * reales contra PRODUCCIÓN, en un espacio fantasma que este script crea y
 * borra. Nunca en el espacio real.
 *
 * LO QUE PRUEBA:
 *   A. La base (00052), con el token de cada uno:
 *      - un Owner crea (control positivo del rol) y un Member no;
 *      - el Member las lee (las usa con «/»);
 *      - el Member no edita; el Owner sí (control positivo);
 *      - nadie elimina con un UPDATE directo de `deleted_at`, ni siquiera el
 *        Owner;
 *      - el Member no elimina con la función; el Owner sí, y la eliminada deja
 *        de verse para los dos;
 *      - nadie borra de verdad desde la API (sin política de DELETE);
 *      - el atajo es único entre las no eliminadas: se repite el de una viva y
 *        se rechaza; se reusa el de una eliminada y se acepta.
 *   B. La app:
 *      - Configuración › Respuestas rápidas: el Owner la abre y ve la suya; el
 *        Member vuelve a /dashboard;
 *      - el menú del Owner trae «Respuestas rápidas» y el del Member no;
 *      - la bandeja le entrega al Member las Respuestas rápidas vivas del
 *        espacio (para «/»), y no la eliminada. El selector en sí corre en el
 *        navegador: lo cubren `components/inbox/selector-respuestas.test.ts`,
 *        `lib/respuestas-rapidas.test.ts` y la mirada de Marcos.
 *   La purga a los 30 días no se prueba acá: la corre la tarea programada, con
 *   su secreto; la cubre `lib/purga.test.ts`.
 *
 * LOS ROJOS. Antes de la 00052 la tabla no existe: los pasos de A dan error de
 * carga y no cuentan. Después del push y antes de desplegar el código, A tiene
 * que estar en verde y B en rojo por su motivo: el menú y la bandeja existen y
 * no traen lo nuevo. La pantalla de Configuración nueva antes del despliegue da
 * 404: rojo de carga, no cuenta.
 *
 * QUÉ CAMBIA CADA PASO. Los de A escriben en `response_templates` del espacio
 * fantasma, en este orden, y cada uno se lee enseguida con la clave de
 * servicio: R1 se crea, se edita y se elimina; R2 queda viva y es la que leen
 * los pasos de B, que van después y no escriben. El rechazo de la eliminación
 * por UPDATE se prueba sobre R2 antes de cualquier eliminación, y la presencia
 * de R1 para el Member se lee antes de eliminarla.
 *
 * Uso: node scripts/verify-respuestas-rapidas.mjs
 */
import { admin, check, comoUsuario, correr, crearUsuario, limpiar, noConcluyente, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

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
let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

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
  return { status: res.status, html, location: res.headers.get("location") };
}

const fila = async (id) => (await admin(`response_templates?select=id,nombre,atajo,deleted_at&id=eq.${id}`)).data?.[0] ?? null;

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo`);
  const owner = await crearUsuario("respuestas-owner");
  const member = await crearUsuario("respuestas-member");
  usuariosFantasma = [owner.id, member.id];
  const E = owner.espacio;
  espaciosFantasma = [E, member.espacio];
  espacioDeLaCookie = E;
  await sumarAlEspacio(E, member, "member");
  const nombreE = await admin(`workspaces?id=eq.${E}`, { method: "PATCH", body: JSON.stringify({ name: `F36 espacio-${sufijo}` }) });
  if (nombreE.status >= 300) throw new Error(`no se pudo renombrar el espacio: HTTP ${nombreE.status}`);
  console.log(`  E ${E.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  const R = {
    uno: { nombre: `F36 Uno ${sufijo}`, atajo: `uno${sufijo}`, contenido: `Hola {{contact.display_name}}, uno-${sufijo}` },
    dos: { nombre: `F36 Dos ${sufijo}`, atajo: `dos${sufijo}`, contenido: `dos-${sufijo}` },
  };

  // ── A. La base ──────────────────────────────────────────────────────────
  titulo("Crear: el Owner sí (control positivo), el Member no");
  const c1 = await comoUsuario(owner.token, "response_templates", { method: "POST", body: JSON.stringify({ workspace_id: E, ...R.uno }) });
  const c2 = await comoUsuario(owner.token, "response_templates", { method: "POST", body: JSON.stringify({ workspace_id: E, ...R.dos }) });
  const id1 = c1.data?.[0]?.id;
  const id2 = c2.data?.[0]?.id;
  const okCrear = check(c1.status === 201 && c2.status === 201 && id1 && id2, "el Owner crea dos, con su token", `HTTP ${c1.status} / ${c2.status} ${JSON.stringify(c1.data).slice(0, 160)}`);
  const cm = await comoUsuario(member.token, "response_templates", { method: "POST", body: JSON.stringify({ workspace_id: E, nombre: `F36 Member ${sufijo}`, atajo: `mem${sufijo}`, contenido: "x" }) });
  const delMember = (await admin(`response_templates?select=id&workspace_id=eq.${E}&atajo=eq.mem${sufijo}`)).data ?? [];
  if (!okCrear) noConcluyente("el Member no crea", "falló el control positivo del Owner");
  else check(cm.status >= 400 && delMember.length === 0, "el Member no crea (rechazado, y no quedó ninguna fila)", `HTTP ${cm.status}, ${delMember.length} filas`);
  if (!okCrear) throw new Error("sin las respuestas del Owner no hay nada que medir");

  titulo("Leer: el Member las ve (las usa con «/»)");
  const lm = await comoUsuario(member.token, `response_templates?select=id&workspace_id=eq.${E}`);
  const okLeer = check(lm.status === 200 && Array.isArray(lm.data) && [id1, id2].every((id) => lm.data.some((r) => r.id === id)), "el Member lee las dos (presencia)", `HTTP ${lm.status}, ${Array.isArray(lm.data) ? lm.data.length : "?"}`);

  titulo("Editar: el Member no, el Owner sí (control positivo)");
  await comoUsuario(member.token, `response_templates?id=eq.${id1}`, { method: "PATCH", body: JSON.stringify({ nombre: `F36 Pisado ${sufijo}` }) });
  const trasMember = await fila(id1);
  const eo = await comoUsuario(owner.token, `response_templates?id=eq.${id1}`, { method: "PATCH", body: JSON.stringify({ nombre: `F36 Uno editado ${sufijo}` }) });
  const trasOwner = await fila(id1);
  const okEditar = check(eo.status < 300 && trasOwner?.nombre === `F36 Uno editado ${sufijo}`, "el Owner edita el nombre", `HTTP ${eo.status} · ${trasOwner?.nombre}`);
  if (!okEditar) noConcluyente("el Member no edita", "falló el control positivo del Owner");
  else check(trasMember?.nombre === R.uno.nombre, "el Member no edita (el nombre siguió igual hasta que lo cambió el Owner)", trasMember?.nombre);

  titulo("Nadie elimina con un UPDATE directo de deleted_at, ni el Owner");
  const ud = await comoUsuario(owner.token, `response_templates?id=eq.${id2}`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
  const r2 = await fila(id2);
  check(r2 !== null && r2.deleted_at === null, "el Owner no pone deleted_at por UPDATE (la fila sigue viva)", `HTTP ${ud.status} · deleted_at ${r2?.deleted_at}`);

  titulo("Eliminar: el Member no, el Owner sí, por la función");
  const em = await rpcComo(member.token, "eliminar_respuesta_rapida", { p_id: id1 });
  const trasEm = await fila(id1);
  const eo2 = await rpcComo(owner.token, "eliminar_respuesta_rapida", { p_id: id1 });
  const trasEo = await fila(id1);
  const okEliminar = check(eo2.status === 200 && eo2.data === true && trasEo?.deleted_at !== null, "el Owner elimina: la función devuelve true y marca la fecha", `HTTP ${eo2.status} ${JSON.stringify(eo2.data)} · ${trasEo?.deleted_at}`);
  if (!okEliminar) noConcluyente("el Member no elimina", "falló el control positivo del Owner");
  else check(em.status === 200 && em.data === false && trasEm?.deleted_at === null, "el Member no elimina: la función devuelve false y la fila siguió viva hasta que la eliminó el Owner", `HTTP ${em.status} ${JSON.stringify(em.data)}`);
  check(trasEo !== null, "eliminar no borró la fila: solo marcó la fecha");

  titulo("La eliminada deja de verse, para los dos");
  const lo2 = await comoUsuario(owner.token, `response_templates?select=id&workspace_id=eq.${E}`);
  const lm2 = await comoUsuario(member.token, `response_templates?select=id&workspace_id=eq.${E}`);
  const ve = (r, id) => Array.isArray(r.data) && r.data.some((x) => x.id === id);
  const okSigue = check(ve(lo2, id2) && ve(lm2, id2), "la viva se sigue viendo, para los dos (presencia)");
  if (!okLeer || !okSigue) noConcluyente("la eliminada no se ve", "falló la presencia");
  else check(!ve(lo2, id1) && !ve(lm2, id1), "la eliminada no la ve ni el Owner ni el Member");

  titulo("Nadie borra de verdad desde la API");
  await comoUsuario(owner.token, `response_templates?id=eq.${id2}`, { method: "DELETE" });
  check((await fila(id2)) !== null, "un DELETE del Owner no borra la fila");

  titulo("El atajo es único entre las no eliminadas");
  const rep = await comoUsuario(owner.token, "response_templates", { method: "POST", body: JSON.stringify({ workspace_id: E, nombre: `F36 Otra ${sufijo}`, atajo: R.dos.atajo, contenido: "x" }) });
  check(rep.status === 409, "repetir el atajo de una viva se rechaza (409)", `HTTP ${rep.status}`);
  const reuso = await comoUsuario(owner.token, "response_templates", { method: "POST", body: JSON.stringify({ workspace_id: E, nombre: `F36 Reuso ${sufijo}`, atajo: R.uno.atajo, contenido: "x" }) });
  check(reuso.status === 201, "reusar el atajo de una eliminada se acepta", `HTTP ${reuso.status}`);

  // ── B. La app (solo lee) ────────────────────────────────────────────────
  titulo("Configuración › Respuestas rápidas");
  const po = await pagina(owner, "/dashboard/settings/response-templates");
  check(po.status === 200 && po.html.includes(">Respuestas rápidas</h1>") && po.html.includes(`>${R.dos.nombre}<`), "el Owner la abre y ve la suya", `HTTP ${po.status}`);
  const pm = await pagina(member, "/dashboard/settings/response-templates");
  // El panel tiene `loading.tsx`: la respuesta empieza a mandarse antes de la
  // guarda, y entonces la redirección de Next viaja en la página, con estado
  // 200, como `<meta id="__next-page-redirect" http-equiv="refresh"
  // content="1;url=/dashboard">` (node_modules/next/dist/server/app-render/
  // make-get-server-inserted-html.js:52-61). Se aceptan las dos formas.
  // Cambiado el 06/11/2026 después de la primera corrida con el código nuevo,
  // que dio 200: la comprobación exigía un 3xx.
  const redirige = (pm.status >= 300 && pm.status < 400 && (pm.location ?? "").endsWith("/dashboard")) ||
    (pm.status === 200 && /<meta[^>]*id="__next-page-redirect"[^>]*content="\d;url=\/dashboard"/.test(pm.html));
  check(redirige, "el Member vuelve a /dashboard", `HTTP ${pm.status} → ${pm.location ?? "(en la página)"}`);
  check(!pm.html.includes(R.dos.nombre) && !pm.html.includes(R.dos.contenido), "la página del Member no trae la respuesta rápida (el Owner sí la recibió)");

  titulo("El menú: «Respuestas rápidas» para el Owner, no para el Member");
  const io = await pagina(owner, "/dashboard/inbox");
  const im = await pagina(member, "/dashboard/inbox");
  const enlace = 'href="/dashboard/settings/response-templates"';
  const okMenu = check(io.status === 200 && io.html.includes(enlace), "el menú del Owner trae el enlace (presencia)", `HTTP ${io.status}`);
  if (!okMenu) noConcluyente("el menú del Member no trae el enlace", "falló la presencia del Owner");
  else check(im.status === 200 && !im.html.includes(enlace), "el menú del Member no trae el enlace", `HTTP ${im.status}`);

  titulo("La bandeja le entrega al Member las vivas, para «/»");
  const okEntrega = check(im.html.includes(R.dos.atajo), "la página de la bandeja del Member trae la viva (R2)", `HTTP ${im.status}`);
  if (!okEntrega) noConcluyente("la bandeja no trae la eliminada", "falló la presencia");
  else check(!im.html.includes(R.uno.contenido.split(", ")[1]), "la bandeja del Member no trae la eliminada (R1)");
}, async () => {
  if (!espaciosFantasma.length) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => ((await admin(path)).data ?? []).length;
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`response_templates?select=id&workspace_id=in.(${ids})`)) === 0, "response_templates: 0");
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log de los espacios fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
