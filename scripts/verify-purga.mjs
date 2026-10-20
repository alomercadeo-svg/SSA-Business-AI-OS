#!/usr/bin/env node
/**
 * F30, la purga diaria, con la TAREA REAL de producción (`POST /api/cron/tareas`,
 * que corre el servicio «vigilancia-cron» de Railway cada 10 minutos), en un
 * espacio fantasma que este script crea y borra. Nunca en «Ale Admin's
 * Workspace». Este script no llama a la tarea: espera a que corra sola.
 *
 * VA EN TRES FASES, porque llevar `deleted_at` 31 días atrás es una escritura
 * con la clave de servicio, y esas se muestran antes (regla de Marcos):
 *
 *   node scripts/verify-purga.mjs preparar   --estado <archivo.json>
 *     Crea el escenario, elimina por las funciones de la base (deja la fila de
 *     «eliminado» en el historial), y muestra las filas que va a retroceder:
 *     cantidad, id corto, valor actual y nuevo. No limpia: lo deja armado.
 *   node scripts/verify-purga.mjs retroceder --estado <archivo.json>
 *     Escribe esas fechas, borra la marca de la purga del espacio fantasma (si
 *     la tarea ya pasó por él, no volvería hasta dentro de 24 horas), y las
 *     relee.
 *   node scripts/verify-purga.mjs comprobar  --estado <archivo.json>
 *     Espera a que la tarea real purgue el espacio fantasma (por condición: su
 *     marca posterior al retroceso), comprueba, limpia y recuenta.
 *   node scripts/verify-purga.mjs limpiar    --estado <archivo.json>
 *     Si algo quedó a medias: borra todo lo del espacio fantasma.
 *
 * EL ESCENARIO. Un Owner y su espacio, un canal de WhatsApp fantasma (una fila,
 * sin instancia detrás) y tres contactos:
 *   - X, eliminado hace 31 días: con su canal, su conversación, un mensaje con
 *     un PNG real en `message-media` y una nota. Tiene que irse todo.
 *   - Y, eliminado hace 29 días, con su mensaje y su PNG: el control de que el
 *     corte es de 30 días. Tiene que quedar todo.
 *   - Z, vivo, con una nota eliminada hace 31 días (se va) y una viva (queda).
 *
 * LOS CONTROLES. La presencia de cada fila y de cada archivo se comprueba al
 * preparar, así la ausencia del final significa algo. Y y Z son los controles
 * de que la purga no borra de más. `audit_log` se cuenta antes y después, y
 * las filas de X tienen que seguir: el historial no se purga nunca.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { admin, catalogo, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, rpcComo, sufijo, URL_BASE } from "./lib-verificador.mjs";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fase = process.argv[2];
const iEstado = process.argv.indexOf("--estado");
const ARCHIVO = iEstado > 0 ? process.argv[iEstado + 1] : null;
if (!["preparar", "retroceder", "comprobar", "limpiar"].includes(fase) || !ARCHIVO) {
  console.error("Uso: node scripts/verify-purga.mjs preparar|retroceder|comprobar|limpiar --estado <archivo.json>");
  process.exit(1);
}
const leerEstado = () => JSON.parse(readFileSync(ARCHIVO, "utf8"));
const guardarEstado = (e) => writeFileSync(ARCHIVO, JSON.stringify(e, null, 2));
const corto = (id) => String(id).slice(0, 8);
const DIA = 86_400_000;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

const objetos = (espacio) =>
  catalogo(`select name from storage.objects where bucket_id = 'message-media' and name like '${espacio}/%' order by name`).map((f) => f.name);
const filas = async (path) => (await admin(path)).data ?? [];
const auditTotal = () => catalogo("select count(*)::int as n from audit_log")[0].n;

async function subir(ruta) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/message-media/${ruta}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/png" },
    body: PNG,
  });
  if (r.status >= 300) throw new Error(`no se pudo subir ${ruta}: HTTP ${r.status}`);
}

async function borrarTodo(e) {
  console.log("\nLimpieza");
  const quedan = objetos(e.espacio);
  if (quedan.length) {
    const r = await fetch(`${URL_BASE}/storage/v1/object/message-media`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: quedan }),
    });
    check(r.status < 300, `se borran los ${quedan.length} archivos que quedaban en message-media`, `HTTP ${r.status}`);
  }
  const c = await admin(`contacts?workspace_id=eq.${e.espacio}`, { method: "DELETE" });
  check(c.status < 300, "se borran los contactos del espacio fantasma", `HTTP ${c.status}`);
  limpiar.usuarios.push(e.owner);
  limpiar.workspaces.push(e.espacio);
}

async function recuento(e) {
  console.log("\nRecuento posterior, sin contenido");
  const cuenta = async (path) => (await filas(path)).length;
  check((await cuenta(`workspaces?select=id&id=eq.${e.espacio}`)) === 0, "workspaces: 0");
  check((await cuenta(`contacts?select=id&workspace_id=eq.${e.espacio}`)) === 0, "contacts: 0");
  check((await cuenta(`channels?select=id&workspace_id=eq.${e.espacio}`)) === 0, "channels: 0");
  check((await cuenta(`tareas_estado?select=clave&workspace_id=eq.${e.espacio}`)) === 0, "tareas_estado del espacio: 0");
  check(objetos(e.espacio).length === 0, "objetos en message-media del espacio: 0");
  const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${e.owner}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  check(r.status === 404, `auth.users ${corto(e.owner)}: no existe`, `HTTP ${r.status}`);
  const aud = await cuenta(`audit_log?select=id&workspace_id=eq.${e.espacio}`);
  console.log(`  audit_log del espacio fantasma: ${aud} filas. No se borran (F31): quedan sin espacio.`);
}

if (fase === "preparar") {
  if (existsSync(ARCHIVO)) {
    console.error(`${ARCHIVO} ya existe: corré «limpiar» con ese archivo o usá otro.`);
    process.exit(1);
  }
  let espacioCreado = null;
  await correr(async () => {
    const owner = await crearUsuario("purga-owner");
    const espacio = owner.espacio;
    espacioCreado = espacio;
    console.log(`Espacio ${corto(espacio)}, Owner ${corto(owner.id)}`);
    try {
    const canal = (await admin("channels", {
      method: "POST",
      body: JSON.stringify({ workspace_id: espacio, platform: "whatsapp", provider: "evolution", instance_name: `b3-purga-${sufijo}`, is_active: true, umbral_silencio_horas: null }),
    })).data?.[0]?.id;
    if (!canal) throw new Error("no se pudo crear el canal fantasma");

    const X = (await crearContacto(espacio, { display_name: `b3-purga-X-${sufijo}` })).id;
    const Y = (await crearContacto(espacio, { display_name: `b3-purga-Y-${sufijo}` })).id;
    const Z = (await crearContacto(espacio, { display_name: `b3-purga-Z-${sufijo}` })).id;
    const jid = (n) => `5069${n}${String(Date.now()).slice(-6)}@s.whatsapp.net`;
    await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: X, channel_id: canal, platform_sender_id: jid(1), raw_jid: jid(1) }) });
    const conv = async (c) =>
      (await admin("conversations", { method: "POST", body: JSON.stringify({ workspace_id: espacio, channel_id: canal, contact_id: c, platform: "whatsapp", historial_estado: "completo" }) })).data?.[0]?.id;
    const convX = await conv(X);
    const convY = await conv(Y);
    const mensaje = async (convId, n) =>
      (await admin("messages", { method: "POST", body: JSON.stringify({ conversation_id: convId, direction: "inbound", message_type: "imagen", platform_message_id: `b3-purga-${n}-${sufijo}` }) })).data?.[0]?.id;
    const mX = await mensaje(convX, "X");
    const mY = await mensaje(convY, "Y");
    const rutaX = `${espacio}/${convX}/${mX}/archivo.png`;
    const rutaY = `${espacio}/${convY}/${mY}/archivo.png`;
    for (const [m, ruta] of [[mX, rutaX], [mY, rutaY]]) {
      await subir(ruta);
      await admin(`messages?id=eq.${m}`, { method: "PATCH", body: JSON.stringify({ media_path: ruta, media_mime: "image/png", media_bytes: PNG.byteLength, media_status: "descargado" }) });
    }
    const nota = async (c, body) =>
      (await comoUsuario(owner.token, "contact_notes", { method: "POST", body: JSON.stringify({ workspace_id: espacio, contact_id: c, body }) })).data?.[0]?.id;
    const nX = await nota(X, "nota de X");
    const nZ1 = await nota(Z, "nota de Z que se elimina");
    const nZ2 = await nota(Z, "nota viva de Z");

    // Eliminar por las funciones de la base: dejan la fila del historial.
    const eX = await rpcComo(owner.token, "eliminar_contacto", { p_contacto: X });
    const eY = await rpcComo(owner.token, "eliminar_contacto", { p_contacto: Y });
    const eN = await rpcComo(owner.token, "eliminar_nota", { p_nota: nZ1 });
    check(eX.status === 200 && eY.status === 200 && eN.status < 300, "el Owner elimina X, Y y una nota de Z por las funciones", `HTTP ${eX.status} ${eY.status} ${eN.status}`);

    console.log("\nPresencia de todo lo que después se mira");
    check((await filas(`contacts?select=id&id=in.(${X},${Y},${Z})`)).length === 3, "X, Y y Z existen");
    check((await filas(`conversations?select=id&id=in.(${convX},${convY})`)).length === 2, "sus dos conversaciones");
    check((await filas(`messages?select=id&id=in.(${mX},${mY})`)).length === 2, "sus dos mensajes con archivo");
    check((await filas(`contact_channels?select=id&contact_id=eq.${X}`)).length === 1, "la fila de canal de X");
    check((await filas(`contact_notes?select=id&id=in.(${nX},${nZ1},${nZ2})`)).length === 3, "las tres notas");
    check(objetos(espacio).length === 2, "los dos PNG en message-media");
    const audX = (await filas(`audit_log?select=id&entity_id=eq.${X}&action=eq.contacto.eliminado`)).length;
    check(audX === 1, "la fila «contacto.eliminado» de X en el historial");

    const ahora = Date.now();
    const estado = {
      espacio, owner: owner.id, canal, X, Y, Z, convX, convY, mX, mY, rutaX, rutaY, nX, nZ1, nZ2,
      retroceso: {
        X: new Date(ahora - 31 * DIA).toISOString(),
        Y: new Date(ahora - 29 * DIA).toISOString(),
        nZ1: new Date(ahora - 31 * DIA).toISOString(),
      },
    };
    const actual = async (tabla, id) => (await filas(`${tabla}?select=deleted_at&id=eq.${id}`))[0]?.deleted_at;
    const plan = [
      ["contacts", X, estado.retroceso.X],
      ["conversations", convX, estado.retroceso.X],
      ["contacts", Y, estado.retroceso.Y],
      ["conversations", convY, estado.retroceso.Y],
      ["contact_notes", nZ1, estado.retroceso.nZ1],
    ];
    console.log(`\nLas ${plan.length} filas que «retroceder» va a escribir con la clave de servicio, todas del espacio fantasma ${corto(espacio)} (deleted_at):`);
    for (const [tabla, id, nuevo] of plan) console.log(`  ${tabla} ${corto(id)}: ${await actual(tabla, id)} → ${nuevo}`);
    console.log(`  y, si existe, la fila purga_eliminados:${corto(espacio)}… de tareas_estado se borra (la marca de la purga del espacio fantasma)`);
    estado.audit_total_antes = auditTotal();
    estado.audit_espacio_antes = (await filas(`audit_log?select=id&workspace_id=eq.${espacio}`)).length;
    console.log(`\naudit_log antes: ${estado.audit_total_antes} en total, ${estado.audit_espacio_antes} del espacio fantasma.`);
    guardarEstado(estado);
    console.log(`\nEstado guardado en ${ARCHIVO}. El escenario queda armado: no se limpia hasta «comprobar» o «limpiar».`);
    // Que `correr` no limpie: el escenario sigue en «retroceder» y «comprobar».
    limpiar.usuarios.length = 0;
    limpiar.workspaces.length = 0;
    limpiar.contactos.length = 0;
    } catch (err) {
      // Cortado a mitad: `correr` limpia usuarios, espacio y contactos; los
      // archivos de Storage no se van con el espacio, así que se borran acá.
      const quedan = espacioCreado ? objetos(espacioCreado) : [];
      if (quedan.length) {
        await fetch(`${URL_BASE}/storage/v1/object/message-media`, {
          method: "DELETE",
          headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: quedan }),
        });
      }
      throw err;
    }
  });
}

if (fase === "retroceder") {
  const e = leerEstado();
  await correr(async () => {
    const escribir = async (tabla, id, valor) => {
      const r = await admin(`${tabla}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ deleted_at: valor }) });
      check(r.status < 300 && r.data?.length === 1, `${tabla} ${corto(id)}: deleted_at → ${valor}`, `HTTP ${r.status}`);
    };
    await escribir("contacts", e.X, e.retroceso.X);
    await escribir("conversations", e.convX, e.retroceso.X);
    await escribir("contacts", e.Y, e.retroceso.Y);
    await escribir("conversations", e.convY, e.retroceso.Y);
    await escribir("contact_notes", e.nZ1, e.retroceso.nZ1);
    const marca = await admin(`tareas_estado?clave=eq.purga_eliminados:${e.espacio}`, { method: "DELETE" });
    console.log(`  marca de la purga del espacio fantasma borrada: ${marca.data?.length ?? 0} fila(s)`);
    console.log("\nReleído");
    const ver = async (tabla, id, esperado) => {
      const v = (await filas(`${tabla}?select=deleted_at&id=eq.${id}`))[0]?.deleted_at;
      check(v && new Date(v).getTime() === new Date(esperado).getTime(), `${tabla} ${corto(id)}: ${v}`);
    };
    await ver("contacts", e.X, e.retroceso.X);
    await ver("conversations", e.convX, e.retroceso.X);
    await ver("contacts", e.Y, e.retroceso.Y);
    await ver("conversations", e.convY, e.retroceso.Y);
    await ver("contact_notes", e.nZ1, e.retroceso.nZ1);
    e.retrocedido_at = new Date().toISOString();
    guardarEstado(e);
  });
}

if (fase === "comprobar") {
  const e = leerEstado();
  if (!e.retrocedido_at) {
    console.error("Primero «retroceder».");
    process.exit(1);
  }
  await correr(async () => {
    try {
      console.log(`Esperando la corrida real de la purga sobre el espacio fantasma (hasta 15 minutos), posterior a ${e.retrocedido_at}`);
      let fila = null;
      for (let i = 0; i < 60; i++) {
        fila = (await filas(`tareas_estado?select=ultimo_ok_at,ultimo_error,resultado&clave=eq.purga_eliminados:${e.espacio}`))[0] ?? null;
        if (fila?.ultimo_ok_at && fila.ultimo_ok_at > e.retrocedido_at) break;
        if (fila?.ultimo_error) break;
        await new Promise((r) => setTimeout(r, 15_000));
      }
      const corrio = check(Boolean(fila?.ultimo_ok_at && fila.ultimo_ok_at > e.retrocedido_at), "la tarea real purgó el espacio fantasma", JSON.stringify(fila).slice(0, 300));
      if (!corrio) {
        noConcluyente("lo que se borró y lo que quedó", "la tarea no corrió (o falló) en el tiempo de espera: una ausencia no prueba nada");
        return;
      }
      console.log(`  resultado de la tarea: ${JSON.stringify(fila.resultado)}`);
      check(fila.resultado?.contactos === 1 && fila.resultado?.conversaciones === 1 && fila.resultado?.notas === 1 && fila.resultado?.archivos === 1,
        "la tarea dice: 1 contacto, 1 conversación, 1 nota suelta y 1 archivo");

      console.log("\nX, eliminado hace 31 días: se fue todo, en cascada");
      check((await filas(`contacts?select=id&id=eq.${e.X}`)).length === 0, "X no existe");
      check((await filas(`conversations?select=id&id=eq.${e.convX}`)).length === 0, "su conversación tampoco");
      check((await filas(`messages?select=id&id=eq.${e.mX}`)).length === 0, "ni su mensaje");
      check((await filas(`contact_channels?select=id&contact_id=eq.${e.X}`)).length === 0, "ni su fila de canal");
      check((await filas(`contact_notes?select=id&id=eq.${e.nX}`)).length === 0, "ni su nota");
      const objs = objetos(e.espacio);
      check(!objs.includes(e.rutaX), "su PNG ya no está en message-media");

      console.log("\nLos controles: lo que no tenía que irse");
      check((await filas(`contacts?select=id&id=eq.${e.Y}`)).length === 1, "Y (eliminado hace 29 días) sigue");
      check((await filas(`messages?select=id&id=eq.${e.mY}`)).length === 1, "su mensaje sigue");
      check(objs.includes(e.rutaY), "su PNG sigue");
      check((await filas(`contacts?select=id&id=eq.${e.Z}`)).length === 1, "Z (vivo) sigue");
      check((await filas(`contact_notes?select=id&id=eq.${e.nZ1}`)).length === 0, "la nota de Z eliminada hace 31 días se fue");
      check((await filas(`contact_notes?select=id&id=eq.${e.nZ2}`)).length === 1, "la nota viva de Z sigue");

      console.log("\nEl historial no se purga");
      const total = auditTotal();
      const delEspacio = (await filas(`audit_log?select=id&workspace_id=eq.${e.espacio}`)).length;
      console.log(`  audit_log: ${e.audit_total_antes} → ${total} en total; del espacio fantasma ${e.audit_espacio_antes} → ${delEspacio}`);
      check(delEspacio === e.audit_espacio_antes, "las filas del espacio fantasma son las mismas que antes de la purga");
      check(total >= e.audit_total_antes, "el total no bajó (puede subir por el tráfico real del negocio)");
      check((await filas(`audit_log?select=id&entity_id=eq.${e.X}&action=eq.contacto.eliminado`)).length === 1, "la fila «contacto.eliminado» de X, que ya no existe, sigue");
    } finally {
      await borrarTodo(e);
    }
  }, () => recuento(e));
}

if (fase === "limpiar") {
  const e = leerEstado();
  await correr(async () => {
    await borrarTodo(e);
  }, () => recuento(e));
}
