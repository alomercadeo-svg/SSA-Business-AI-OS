#!/usr/bin/env node
/**
 * F41 con sesiones reales: asignar setter y vendedor desde la pantalla cambia
 * quién lee el lead. Contra PRODUCCIÓN (`PATCH /api/v1/contacts/[id]/asignacion`,
 * la misma ruta que llama el desplegable de la ficha, y la lista de contactos),
 * en un espacio fantasma que este script crea y borra en la misma corrida.
 * Nunca en «Ale Admin's Workspace».
 *
 * EL ESCENARIO. Un Owner (con el espacio fantasma que le crea
 * `handle_new_user`) y un Member sumado a ese espacio. Los leads:
 *   - «propio», con el Member de setter: el control de que su sesión funciona;
 *   - 102 de relleno sin asignar, con la interacción más reciente;
 *   - X, sin asignar y con la interacción más vieja: queda en el puesto 104,
 *     fuera de los 100 que carga la lista.
 *
 * LOS CONTROLES (las reglas de verificación del CLAUDE.md):
 *   - el Member lee «propio» antes de mirar X: si no, un 0 en X no distingue
 *     alcance de una sesión rota, y el resto es «no concluyente»;
 *   - el Member no lee X; el Owner lo asigna por la ruta y el Member lo lee;
 *     el Owner le quita la asignación y el Member deja de leerlo (la ausencia
 *     del final vale porque la presencia se probó antes);
 *   - la lista sin filtro no muestra X (el tope lo esconde) y con
 *     `?setter=<Member>` sí: el filtro corre en el servidor. El control es que
 *     sin filtro sí aparece el relleno más reciente;
 *   - el historial tiene «contacto.asignado» con el antes y el después.
 *
 * QUÉ CAMBIA CADA PASO. Los PATCH rechazados (otro origen, un id que no es del
 * equipo, el Member que se quitaría el lead, el Member sobre un lead ajeno) no
 * escriben: se comprueba releyendo X después de cada uno. Las lecturas de la
 * lista y de la API no escriben nada.
 *
 * AL FINAL borra los contactos, los dos usuarios de Auth y los dos espacios, y
 * lo recuenta. Las filas de `audit_log` NO se borran (F31): se cuentan y se
 * informan.
 *
 * Uso: node scripts/verify-asignacion.mjs
 */
import { randomUUID } from "node:crypto";
import { admin, check, comoUsuario, correr, crearUsuario, limpiar, noConcluyente, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];
const RELLENO = 102;

/** La cookie como la arma `@supabase/ssr` 0.8.0 (igual que `verify-alcance-firmada.mjs`). */
function cookieDe(sesion) {
  const valor = `base64-${Buffer.from(JSON.stringify(sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  if (valor.length <= 3180) return `${nombre}=${valor}`;
  const partes = [];
  for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  return partes.join("; ");
}

async function asignar(u, contacto, cuerpo, origen = APP_URL) {
  const headers = { Cookie: cookieDe(u.sesion), "Content-Type": "application/json" };
  if (origen) headers.Origin = origen;
  const res = await fetch(`${APP_URL}/api/v1/contacts/${contacto}/asignacion`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(cuerpo),
    redirect: "manual",
  });
  let j = null;
  try {
    j = await res.json();
  } catch {
    j = null;
  }
  return { status: res.status, cuerpo: j };
}

async function lista(u, query = "") {
  const res = await fetch(`${APP_URL}/dashboard/contacts${query}`, { headers: { Cookie: cookieDe(u.sesion) }, redirect: "manual" });
  return { status: res.status, html: await res.text() };
}

/** Cuántas filas de `contacts` con ese id le devuelve la API al usuario, con su token. */
async function leeComo(u, id) {
  const r = await comoUsuario(u.token, `contacts?select=id&id=eq.${id}`);
  return r.status === 200 && Array.isArray(r.data) ? r.data.length : -1;
}

async function asignacionDe(id) {
  const r = await admin(`contacts?select=setter_id,vendedor_id&id=eq.${id}`);
  return r.data?.[0] ?? null;
}

let espacioFantasma = null;
let usuariosFantasma = [];

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo`);
  const owner = await crearUsuario("asig-owner");
  const member = await crearUsuario("asig-member");
  usuariosFantasma = [owner.id, member.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, member, "member");
  console.log(`  espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  const ws = await admin(`workspaces?select=unassigned_leads_visible_to_members&id=eq.${espacio}`);
  check(ws.data?.[0]?.unassigned_leads_visible_to_members === false, "el espacio no deja ver los leads sin asignar a un Member (el valor por defecto)");

  const audit0 = await admin(`audit_log?select=id&workspace_id=eq.${espacio}`);
  check(Array.isArray(audit0.data) && audit0.data.length === 0, "el historial del espacio fantasma arranca vacío", JSON.stringify(audit0.data).slice(0, 200));

  const ahora = Date.now();
  const nombre = (s) => `b3-asig-${s}-${sufijo}`;
  const filas = [
    { workspace_id: espacio, display_name: nombre("propio"), setter_id: member.id, last_interaction_at: new Date(ahora).toISOString() },
    ...Array.from({ length: RELLENO }, (_, i) => ({
      workspace_id: espacio,
      display_name: nombre(`relleno-${String(i).padStart(3, "0")}`),
      setter_id: null,
      last_interaction_at: new Date(ahora - (i + 1) * 60_000).toISOString(),
    })),
    { workspace_id: espacio, display_name: nombre("x"), setter_id: null, last_interaction_at: new Date(ahora - 30 * 86_400_000).toISOString() },
  ];
  const alta = await admin("contacts", { method: "POST", body: JSON.stringify(filas) });
  if (!Array.isArray(alta.data) || alta.data.length !== filas.length) throw new Error(`no se crearon los contactos: HTTP ${alta.status} ${JSON.stringify(alta.data).slice(0, 300)}`);
  const id = (n) => alta.data.find((c) => c.display_name === nombre(n)).id;
  const PROPIO = id("propio");
  const X = id("x");
  console.log(`  ${filas.length} contactos; X ${X.slice(0, 8)}, propio ${PROPIO.slice(0, 8)}`);

  try {
    console.log("\n1. Control de la sesión del Member: lee su propio lead");
    const sesionOk = check((await leeComo(member, PROPIO)) === 1, "el Member lee «propio» con su token");

    console.log("\n2. Sin asignar, el Member no lee X");
    if (!sesionOk) noConcluyente("el Member no lee X", "falló el control de su sesión");
    else check((await leeComo(member, X)) === 0, "0 filas para X con el token del Member");

    console.log("\n3. El Owner asigna X al Member como setter, por la ruta del desplegable");
    const a1 = await asignar(owner, X, { setter_id: member.id });
    const asignado = check(a1.status === 200 && a1.cuerpo?.setter_id === member.id, "200 con el setter nuevo", `HTTP ${a1.status} ${JSON.stringify(a1.cuerpo)}`);
    check(JSON.stringify(await asignacionDe(X)) === JSON.stringify({ setter_id: member.id, vendedor_id: null }), "en la base: setter el Member, vendedor sin tocar");

    console.log("\n4. Control positivo: ahora el Member lee X con su token");
    const loLee = check((await leeComo(member, X)) === 1, "1 fila para X con el token del Member");

    console.log("\n5. El vendedor se asigna sin tocar al setter (independientes)");
    const a2 = await asignar(owner, X, { vendedor_id: owner.id });
    check(a2.status === 200, "200 al asignar vendedor", `HTTP ${a2.status} ${JSON.stringify(a2.cuerpo)}`);
    check(JSON.stringify(await asignacionDe(X)) === JSON.stringify({ setter_id: member.id, vendedor_id: owner.id }), "en la base: el setter sigue, el vendedor es el Owner");

    console.log("\n6. La lista de contactos: el filtro corre en el servidor, antes del tope de 100");
    const sinFiltro = await lista(owner);
    const listaOk = check(sinFiltro.status === 200 && sinFiltro.html.includes(nombre("relleno-000")), "sin filtro, la lista carga y muestra el relleno más reciente (control)", `HTTP ${sinFiltro.status}`);
    if (listaOk) {
      check(!sinFiltro.html.includes(nombre("x")), "sin filtro, X no aparece: está en el puesto 104");
      check(sinFiltro.html.includes(`de ${filas.length} contactos`), `el título dice que hay ${filas.length}, no solo los cargados`);
      const porSetter = await lista(owner, `?setter=${member.id}`);
      check(porSetter.html.includes(nombre("x")) && porSetter.html.includes(nombre("propio")), "con «Setter: el Member», aparecen X y «propio»");
      check(!porSetter.html.includes(nombre("relleno-000")), "con «Setter: el Member», no aparece el relleno");
      const porVendedor = await lista(owner, `?vendedor=${owner.id}`);
      check(porVendedor.html.includes(nombre("x")) && !porVendedor.html.includes(nombre("propio")), "con «Vendedor: el Owner», aparece X y no «propio»");
      const sinSetter = await lista(owner, "?setter=sin");
      check(sinSetter.html.includes(nombre("relleno-000")) && !sinSetter.html.includes(nombre("x")), "con «Setter: Sin asignar», aparece el relleno y no X");
    } else {
      noConcluyente("el filtro de la lista", "la lista sin filtro no cargó: un nombre ausente no probaría nada");
    }

    console.log("\n7. Los pedidos rechazados no escriben");
    const antes = JSON.stringify(await asignacionDe(X));
    const otroOrigen = await asignar(owner, X, { setter_id: null }, "https://malicioso.example");
    check(otroOrigen.status === 403, "otro origen: 403", `HTTP ${otroOrigen.status}`);
    const sinOrigen = await asignar(owner, X, { setter_id: null }, null);
    check(sinOrigen.status === 403, "sin Origin: 403", `HTTP ${sinOrigen.status}`);
    const ajeno = await asignar(owner, X, { setter_id: randomUUID() });
    check(ajeno.status === 400, "un id que no es del equipo: 400", `HTTP ${ajeno.status}`);
    const seQuita = await asignar(member, X, { setter_id: null });
    check(seQuita.status === 403 && /dejarías de verlo/.test(seQuita.cuerpo?.error ?? ""), "el Member que se quitaría X: 403 con el mensaje claro", `HTTP ${seQuita.status} ${JSON.stringify(seQuita.cuerpo)}`);
    check(JSON.stringify(await asignacionDe(X)) === antes, "X sigue igual después de los cuatro rechazos");

    console.log("\n8. El Owner le quita el setter al Member, y el Member deja de leer X");
    const a3 = await asignar(owner, X, { setter_id: null });
    check(a3.status === 200 && a3.cuerpo?.setter_id === null, "200 con el setter vacío", `HTTP ${a3.status} ${JSON.stringify(a3.cuerpo)}`);
    if (!asignado || !loLee) noConcluyente("el Member deja de leer X", "no se probó antes que lo leía");
    else check((await leeComo(member, X)) === 0, "0 filas para X con el token del Member");
    check((await leeComo(member, PROPIO)) === 1, "y sigue leyendo «propio»: su sesión no se rompió");

    console.log("\n9. El Member no se puede asignar un lead que no ve");
    const robar = await asignar(member, X, { setter_id: member.id });
    check(robar.status === 404, "404", `HTTP ${robar.status}`);
    check((await asignacionDe(X))?.setter_id === null, "X sigue sin setter");

    console.log("\n10. El historial: «contacto.asignado» con el antes y el después");
    const h = await admin(
      `audit_log?select=action,actor_id,entity_id,changes,detail&workspace_id=eq.${espacio}&order=created_at.asc`,
    );
    const filasH = h.data ?? [];
    check(filasH.length === 3 && filasH.every((f) => f.action === "contacto.asignado" && f.entity_id === X && f.actor_id === owner.id), "3 filas, todas «asignado», de X y del Owner (los rechazos no dejan fila)", JSON.stringify(filasH.map((f) => f.action)));
    check(
      JSON.stringify(filasH[0]?.changes) === JSON.stringify({ setter_id: { antes: null, despues: member.id } }) &&
        filasH[0]?.detail?.nombres?.setter_id?.despues === "B3 asig-member",
      "la primera: setter de nadie al Member, con su nombre",
      JSON.stringify(filasH[0]),
    );
    check(JSON.stringify(filasH[1]?.changes) === JSON.stringify({ vendedor_id: { antes: null, despues: owner.id } }), "la segunda: vendedor de nadie al Owner");
    check(JSON.stringify(filasH[2]?.changes) === JSON.stringify({ setter_id: { antes: member.id, despues: null } }), "la tercera: setter del Member a nadie");
  } finally {
    const r = await admin(`contacts?workspace_id=eq.${espacio}`, { method: "DELETE" });
    check(r.status < 300, `se borran los ${filas.length} contactos del espacio fantasma`, `HTTP ${r.status}`);
    limpiar.contactos.length = 0;
  }
}, async () => {
  if (!espacioFantasma) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => {
    const r = await admin(path);
    return Array.isArray(r.data) ? r.data.length : -1;
  };
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces de los dos usuarios: 0");
  check((await cuenta(`workspace_members?select=user_id&workspace_id=in.(${ids})`)) === 0, "workspace_members: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  check((await cuenta(`conversations?select=id&workspace_id=in.(${ids})`)) === 0, "conversations: 0");
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log del espacio fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
