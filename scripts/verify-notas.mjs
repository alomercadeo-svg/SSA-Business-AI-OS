#!/usr/bin/env node
/**
 * F30, las notas, con sesiones reales contra PRODUCCIÓN, en un espacio fantasma
 * que este script crea y borra en la misma corrida. Nunca en «Ale Admin's
 * Workspace». Lo que se prueba es la seguridad por filas de `contact_notes`
 * (00037): consultas directas a la base con el token de cada uno, que es el
 * mismo camino que usa la ficha (el cliente del navegador).
 *
 * EL ESCENARIO. Un Owner (con el espacio que le crea `handle_new_user`), un
 * Admin y un Member sumados a ese espacio. Los contactos:
 *   - P, con el Member de setter: su lead;
 *   - A, sin asignar: ajeno para el Member (el espacio no deja ver los leads
 *     sin asignar a un Member, que es el valor por defecto);
 *   - F1 y F2, para la fusión con notas.
 *
 * LOS CONTROLES (las reglas de verificación del CLAUDE.md):
 *   - el Member lee P antes de todo: si no, un rechazo no distingue alcance de
 *     una sesión rota, y lo que depende de eso es «no concluyente»;
 *   - el Member no crea en A, y el Owner sí (contraparte);
 *   - el Member no ve la nota de A, y el Owner sí la ve (la presencia, antes
 *     de mirar la ausencia);
 *   - el Member no edita la nota del Admin, y sí la suya (control); el Admin
 *     edita la del Member (contraparte);
 *   - la nota eliminada se listaba antes de eliminarla.
 *
 * QUÉ CAMBIA CADA PASO. Los rechazos se comprueban releyendo la fila con la
 * clave de servicio, no con el token que acaba de fallar. Los pasos que
 * escriben (las ediciones que sí pasan) van después de las lecturas que miden
 * su estado anterior.
 *
 * ANTES DE LA 00037 tiene que fallar porque la tabla no existe, con el control
 * del principio en verde.
 *
 * AL FINAL borra contactos, notas (en cascada), los tres usuarios y los
 * espacios, y lo recuenta. Las filas de `audit_log` (la fusión deja una) NO se
 * borran (F31): se informan.
 *
 * Uso: node scripts/verify-notas.mjs
 */
import { admin, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcComo, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
let espacioFantasma = null;
let usuariosFantasma = [];

const lee = async (u, path) => {
  const r = await comoUsuario(u.token, path);
  return Array.isArray(r.data) ? r.data : null;
};
const notaDeServicio = async (id) => (await admin(`contact_notes?select=*&id=eq.${id}`)).data?.[0] ?? null;

await correr(async () => {
  const owner = await crearUsuario("notas-owner");
  const adminU = await crearUsuario("notas-admin");
  const member = await crearUsuario("notas-member");
  usuariosFantasma = [owner.id, adminU.id, member.id];
  const espacio = owner.espacio;
  espacioFantasma = espacio;
  await sumarAlEspacio(espacio, adminU, "admin");
  await sumarAlEspacio(espacio, member, "member");
  console.log(`Espacio ${espacio.slice(0, 8)}, Owner ${owner.id.slice(0, 8)}, Admin ${adminU.id.slice(0, 8)}, Member ${member.id.slice(0, 8)}`);

  const ws = await admin(`workspaces?select=unassigned_leads_visible_to_members&id=eq.${espacio}`);
  check(ws.data?.[0]?.unassigned_leads_visible_to_members === false, "el espacio no deja ver los leads sin asignar a un Member (el valor por defecto)");

  const P = (await crearContacto(espacio, { display_name: `b3-notas-P-${sufijo}`, setter_id: member.id })).id;
  const A = (await crearContacto(espacio, { display_name: `b3-notas-A-${sufijo}` })).id;
  const F1 = (await crearContacto(espacio, { display_name: `b3-notas-F1-${sufijo}` })).id;
  const F2 = (await crearContacto(espacio, { display_name: `b3-notas-F2-${sufijo}` })).id;
  console.log(`  P ${P.slice(0, 8)}, A ${A.slice(0, 8)}, F1 ${F1.slice(0, 8)}, F2 ${F2.slice(0, 8)}`);

  const crear = (u, contacto, body) =>
    comoUsuario(u.token, "contact_notes", {
      method: "POST",
      body: JSON.stringify({ workspace_id: espacio, contact_id: contacto, body }),
    });

  console.log("\n1. Control de la sesión del Member: lee su lead");
  const sesionOk = check((await lee(member, `contacts?select=id&id=eq.${P}`))?.length === 1, "el Member lee P con su token");
  const siSesion = (desc, cond, detalle) =>
    sesionOk ? check(cond(), desc, detalle) : noConcluyente(desc, "falló el control de la sesión del Member");

  console.log("\n2. Crear");
  const rM = await crear(member, P, "nota del member");
  const notaM = rM.data?.[0];
  check(rM.status === 201 && notaM?.id, "el Member crea una nota en su lead", `HTTP ${rM.status} ${JSON.stringify(rM.data).slice(0, 200)}`);
  check(notaM?.author_id === member.id, "el autor es el Member, puesto por la base");
  check(notaM?.author_label === "B3 notas-member", "el nombre del autor sale de Auth", `author_label ${JSON.stringify(notaM?.author_label)}`);

  const rAj = await crear(member, A, "intento en lead ajeno");
  siSesion("el Member NO crea una nota en un lead ajeno", () => rAj.status >= 400, `HTTP ${rAj.status}`);
  const cuentaA0 = (await admin(`contact_notes?select=id&contact_id=eq.${A}`)).data?.length;
  check(cuentaA0 === 0, "y no quedó ninguna nota en A (releído con la clave de servicio)", `filas ${cuentaA0}`);

  const rOA = await crear(owner, A, "nota del owner en A");
  const notaOA = rOA.data?.[0];
  check(rOA.status === 201 && notaOA?.id, "el Owner crea una nota en A (contraparte)", `HTTP ${rOA.status}`);

  const rAd = await crear(adminU, P, "nota del admin en P");
  const notaAd = rAd.data?.[0];
  check(rAd.status === 201 && notaAd?.id, "el Admin crea una nota en P", `HTTP ${rAd.status}`);

  const rSuplanta = await comoUsuario(member.token, "contact_notes", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, contact_id: P, body: "suplantando", author_id: owner.id }),
  });
  const suplantada = rSuplanta.data?.[0];
  check(
    rSuplanta.status >= 400 || suplantada?.author_id === member.id,
    "el Member no puede firmar una nota a nombre del Owner",
    `HTTP ${rSuplanta.status}, autor ${suplantada?.author_id?.slice(0, 8)}`
  );
  if (suplantada?.id) await admin(`contact_notes?id=eq.${suplantada.id}`, { method: "DELETE" });

  console.log("\n3. Leer");
  const ownerA = await lee(owner, `contact_notes?select=id&contact_id=eq.${A}`);
  check(ownerA?.length === 1, "el Owner ve la nota de A (la presencia, antes de mirar al Member)", `filas ${ownerA?.length}`);
  const memberA = await lee(member, `contact_notes?select=id&contact_id=eq.${A}`);
  if (sesionOk && ownerA?.length === 1) check(memberA?.length === 0, "0 notas de A con el token del Member", `filas ${memberA?.length}`);
  else noConcluyente("0 notas de A con el token del Member", "faltó el control de la sesión o la presencia");
  const memberP = await lee(member, `contact_notes?select=id&contact_id=eq.${P}&order=created_at`);
  check(memberP?.length === 2, "el Member ve las 2 notas de su lead (la suya y la del Admin)", `filas ${memberP?.length}`);
  const ownerTodas = await lee(owner, `contact_notes?select=id&workspace_id=eq.${espacio}`);
  check(ownerTodas?.length === 3, "el Owner ve todas las notas del espacio (3)", `filas ${ownerTodas?.length}`);
  const adminTodas = await lee(adminU, `contact_notes?select=id&workspace_id=eq.${espacio}`);
  check(adminTodas?.length === 3, "el Admin ve todas las notas del espacio (3)", `filas ${adminTodas?.length}`);

  console.log("\n4. Editar");
  const editar = (u, id, campos) =>
    comoUsuario(u.token, `contact_notes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(campos) });
  const eAd = await editar(member, notaAd.id, { body: "el member pisa la del admin" });
  const trasAd = await notaDeServicio(notaAd.id);
  check(trasAd?.body === "nota del admin en P", "el Member NO edita la nota del Admin (releída: igual)", `HTTP ${eAd.status}`);
  const eM = await editar(member, notaM.id, { body: "nota del member, editada" });
  check(eM.status === 200 && eM.data?.length === 1, "el Member edita su propia nota (control)", `HTTP ${eM.status}`);
  check((await notaDeServicio(notaM.id))?.body === "nota del member, editada", "y quedó el texto nuevo");
  const eMover = await editar(member, notaM.id, { contact_id: A });
  check((await notaDeServicio(notaM.id))?.contact_id === P, "el Member no puede mover su nota a otro contacto", `HTTP ${eMover.status}`);
  const eAdM = await editar(adminU, notaM.id, { body: "corregida por el admin" });
  check(eAdM.status === 200 && (await notaDeServicio(notaM.id))?.body === "corregida por el admin", "el Admin edita la nota del Member (contraparte)", `HTTP ${eAdM.status}`);

  console.log("\n5. Eliminar");
  const dAd = await rpcComo(member.token, "eliminar_nota", { p_nota: notaAd.id });
  check((await notaDeServicio(notaAd.id))?.deleted_at === null, "el Member NO elimina la nota del Admin (releída: sin fecha)", `HTTP ${dAd.status}`);
  const dDirecto = await editar(member, notaM.id, { deleted_at: new Date().toISOString() });
  check((await notaDeServicio(notaM.id))?.deleted_at === null, "el Member NO marca deleted_at a mano, ni en su propia nota", `HTTP ${dDirecto.status}`);
  const antes = await lee(member, `contact_notes?select=id&id=eq.${notaM.id}`);
  check(antes?.length === 1, "antes de eliminarla, el Member lista su nota (presencia)");
  const dM = await rpcComo(member.token, "eliminar_nota", { p_nota: notaM.id });
  check(dM.status < 300, "el Member elimina su propia nota por la función", `HTTP ${dM.status} ${JSON.stringify(dM.data).slice(0, 200)}`);
  check((await notaDeServicio(notaM.id))?.deleted_at !== null, "la fila sigue en la base, con la fecha de eliminada");
  check((await lee(member, `contact_notes?select=id&id=eq.${notaM.id}`))?.length === 0, "la nota eliminada no se lista para el Member");
  check((await lee(owner, `contact_notes?select=id&id=eq.${notaM.id}`))?.length === 0, "ni para el Owner");
  const dOA = await rpcComo(adminU.token, "eliminar_nota", { p_nota: notaOA.id });
  check(dOA.status < 300 && (await notaDeServicio(notaOA.id))?.deleted_at !== null, "el Admin elimina la nota del Owner (contraparte)", `HTTP ${dOA.status}`);
  const rev = await editar(owner, notaM.id, { deleted_at: null });
  check((await notaDeServicio(notaM.id))?.deleted_at !== null, "nadie la restaura a mano, tampoco el Owner", `HTTP ${rev.status}`);

  console.log("\n6. La fusión pasa las notas");
  const n1 = (await crear(owner, F2, "nota viva de F2")).data?.[0];
  const n2 = (await crear(owner, F2, "nota de F2 que se elimina")).data?.[0];
  await rpcComo(owner.token, "eliminar_nota", { p_nota: n2?.id });
  check(n1?.id && (await notaDeServicio(n2?.id))?.deleted_at !== null, "F2 tiene una nota viva y una eliminada");
  const fus = await rpcComo(owner.token, "fusionar_contactos", { p_conservar: F1, p_absorber: F2 });
  check(fus.status === 200 && fus.data?.resultado === "fusionado", "el Owner une F2 en F1", `HTTP ${fus.status} ${JSON.stringify(fus.data).slice(0, 300)}`);
  check((await notaDeServicio(n1?.id))?.contact_id === F1, "la nota viva de F2 queda en F1");
  check((await notaDeServicio(n2?.id))?.contact_id === F1, "la eliminada también (si no, la guarda de la fusión cortaba)");
  check((await admin(`contacts?select=id&id=eq.${F2}`)).data?.length === 0, "F2 ya no existe");
  check((await lee(owner, `contact_notes?select=id&contact_id=eq.${F1}`))?.length === 1, "en F1 el Owner lista solo la viva");
  limpiar.contactos = limpiar.contactos.filter((c) => c !== F2);
}, async () => {
  if (!espacioFantasma) return;
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => {
    const r = await admin(path);
    return Array.isArray(r.data) ? r.data.length : -1;
  };
  const ids = limpiar.workspaces.join(",");
  check((await cuenta(`workspaces?select=id&id=in.(${ids})`)) === 0, "workspaces: 0");
  check((await cuenta(`workspace_members?select=user_id&workspace_id=in.(${ids})`)) === 0, "workspace_members: 0");
  check((await cuenta(`contacts?select=id&workspace_id=in.(${ids})`)) === 0, "contacts: 0");
  const notas = await cuenta(`contact_notes?select=id&workspace_id=in.(${ids})`);
  check(notas === 0 || notas === -1, "contact_notes: 0", `filas ${notas}`);
  for (const uid of usuariosFantasma) {
    const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${uid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    check(r.status === 404, `auth.users ${uid.slice(0, 8)}: no existe`, `HTTP ${r.status}`);
  }
  const quedan = await cuenta(`audit_log?select=id&workspace_id=in.(${ids})`);
  console.log(`  audit_log del espacio fantasma: ${quedan} filas. No se borran (F31): quedan sin espacio.`);
});
