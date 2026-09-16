#!/usr/bin/env node
/**
 * Verificación de F3: scope duro de leads, evaluado en la base.
 *
 * El criterio de F3 pide probarlo "por API, no solo por UI": con el token de un
 * Member, un GET directo a Supabase de un lead ajeno tiene que devolver vacío.
 * Eso es exactamente lo que hace este script. No usa el SDK ni la app: pega
 * contra PostgREST con el token del Member, así que lo único que puede hacer
 * pasar estas comprobaciones es la RLS.
 *
 * Escenario que arma en el workspace existente:
 *   - un Member de prueba
 *   - un contacto donde el Member es setter          → tiene que verlo
 *   - un contacto donde el Member es vendedor        → tiene que verlo
 *   - un contacto de otra persona                    → NO tiene que verlo
 *   - un contacto sin asignar                        → depende del flag del workspace
 *   - una conversación asignada al Member            → tiene que verla
 *   - una conversación de otra persona               → NO tiene que verla
 *   - un mensaje de la conversación ajena            → NO tiene que verlo
 *   - las satélite del lead ajeno (@, flow_session,
 *     destinatario de difusión)                      → NO tiene que verlas
 *   - la cola de scheduled_jobs                      → NO tiene que tocarla
 *
 * Uso:
 *   node scripts/verify-lead-scope.mjs
 *
 * Crea y borra sus propios datos. La limpieza corre en un finally, así que
 * también se ejecuta si una comprobación falla o el script se corta.
 *
 * ESTADO ESPERADO: pasa en verde con 00019_lead_scope_rls aplicada.
 *
 * Antes de esa migración fallaba 11 de 19, y eso era el punto de partida: las
 * policies que trae el fork son `for all using (is_workspace_member(...))`, y
 * como las policies permisivas se combinan con OR, cualquier miembro del
 * workspace veía todo. Un script de verificación que nunca falló no prueba
 * nada. Si alguna vez vuelve a rojo, la primera sospecha es una policy
 * permisiva agregada al lado de las de la 00019 en lugar de reemplazarlas.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// ── Entorno ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let fallos = 0;
let pasados = 0;

function check(cond, desc, detalle) {
  if (cond) {
    pasados++;
    console.log(`  ok    ${desc}`);
  } else {
    fallos++;
    console.log(`  FALLA ${desc}`);
    if (detalle !== undefined) console.log(`        ${detalle}`);
  }
}

/** Consulta con el service role: saltea RLS. Se usa para armar y limpiar. */
async function admin(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  return { status: res.status, data: txt ? JSON.parse(txt) : null };
}

/** Consulta con el token de un usuario: la RLS aplica. Esto es lo que se prueba. */
async function comoUsuario(token, path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  let data = null;
  if (txt) {
    try {
      data = JSON.parse(txt);
    } catch {
      data = txt;
    }
  }
  return { status: res.status, data };
}

async function auth(path, init = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const txt = await res.text();
  return { status: res.status, data: txt ? JSON.parse(txt) : null };
}

async function tokenDe(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`no se pudo autenticar a ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

// ── Estado a limpiar ────────────────────────────────────────────────────────

const sufijo = randomUUID().slice(0, 8);
const limpiar = { usuarios: [], workspaces: [], canales: [], contactos: [], flujos: [], difusiones: [] };
let flagOriginal = null;
let workspaceA = null;

/**
 * Da de alta un usuario y registra para limpieza tanto al usuario como el
 * workspace que le crea el trigger handle_new_user.
 *
 * Ese workspace fantasma no lo borra nadie solo: workspace_members.user_id
 * cascadea al borrar el usuario de auth, pero workspaces no tiene FK al
 * usuario, así que queda huérfano con cero miembros. Sin borrarlo por id, unas
 * cuantas corridas del script llenan la tabla de basura.
 */
async function crearUsuario(nombre) {
  const email = `scope-${nombre}-${sufijo}@ssa-test.local`;
  const password = `Probe-${randomUUID()}`;
  const { data } = await auth("admin/users", {
    method: "POST",
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: { full_name: `Scope ${nombre}` },
    }),
  });
  if (!data?.id) throw new Error(`no se pudo crear al usuario ${nombre}: ${JSON.stringify(data).slice(0, 200)}`);
  limpiar.usuarios.push(data.id);

  await new Promise((r) => setTimeout(r, 1200));
  const { data: ms } = await admin(`workspace_members?select=workspace_id&user_id=eq.${data.id}`);
  for (const m of ms ?? []) limpiar.workspaces.push(m.workspace_id);

  return { id: data.id, email, password };
}

async function crearContacto(campos) {
  const { data } = await admin("contacts", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, ...campos }),
  });
  if (!data?.[0]?.id) throw new Error(`no se pudo crear el contacto: ${JSON.stringify(data).slice(0, 200)}`);
  limpiar.contactos.push(data[0].id);
  return data[0].id;
}

// ── Verificación ────────────────────────────────────────────────────────────

async function main() {
  const { data: wsIniciales } = await admin("workspaces?select=id,name,unassigned_leads_visible_to_members");
  workspaceA = wsIniciales[0].id;
  flagOriginal = wsIniciales[0].unassigned_leads_visible_to_members;
  const totalInicial = wsIniciales.length;
  console.log(`Workspace: ${wsIniciales[0].name} (${workspaceA})`);
  console.log(`Workspaces al empezar: ${totalInicial}\n`);

  // ── Escenario ───────────────────────────────────────────────────────────
  const member = await crearUsuario("member");
  const otro = await crearUsuario("otro");

  await admin("workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, user_id: member.id, role: "member" }),
  });
  await admin("workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, user_id: otro.id, role: "member" }),
  });

  const cSetter = await crearContacto({ display_name: `setter-${sufijo}`, setter_id: member.id });
  const cVendedor = await crearContacto({ display_name: `vendedor-${sufijo}`, vendedor_id: member.id });
  const cAjeno = await crearContacto({ display_name: `ajeno-${sufijo}`, setter_id: otro.id });
  const cSinAsignar = await crearContacto({ display_name: `sin-asignar-${sufijo}` });

  // Un canal de mentira: conversations.channel_id es not null. No se conecta a
  // nada ni dispara ninguna llamada a Zernio, es solo una fila.
  const { data: canal } = await admin("channels", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceA,
      platform: "instagram",
      late_account_id: `scope-test-${sufijo}`,
      username: `scope-test-${sufijo}`,
      is_active: false,
    }),
  });
  limpiar.canales.push(canal[0].id);

  const conv = async (contactId, assignedTo) => {
    const { data } = await admin("conversations", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceA,
        channel_id: canal[0].id,
        contact_id: contactId,
        platform: "instagram",
        assigned_to: assignedTo,
      }),
    });
    return data[0].id;
  };

  const convPropia = await conv(cSetter, null);           // por el contacto
  const convAsignada = await conv(cSinAsignar, member.id); // por assigned_to
  const convAjena = await conv(cAjeno, otro.id);           // de otro

  const { data: msg } = await admin("messages", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: convAjena,
      direction: "inbound",
      text: `mensaje privado ajeno ${sufijo}`,
    }),
  });
  const msgAjeno = msg[0].id;

  const token = await tokenDe(member.email, member.password);

  // ── 1. Lectura de contactos ─────────────────────────────────────────────
  console.log("1. Un Member solo lee los contactos donde está asignado");

  const vistos = await comoUsuario(token, "contacts?select=id,display_name,setter_id,vendedor_id");
  const ids = new Set((Array.isArray(vistos.data) ? vistos.data : []).map((c) => c.id));

  check(ids.has(cSetter), "ve el contacto donde es setter");
  check(ids.has(cVendedor), "ve el contacto donde es vendedor");
  check(!ids.has(cAjeno), "NO ve el contacto de otra persona",
    `devolvió ${ids.size} contactos: ${JSON.stringify(vistos.data).slice(0, 200)}`);

  // El GET puntual es el que pide el criterio de F3, textual.
  const puntual = await comoUsuario(token, `contacts?select=*&id=eq.${cAjeno}`);
  check(Array.isArray(puntual.data) && puntual.data.length === 0,
    "un GET directo del contacto ajeno devuelve vacío, no el registro",
    `status=${puntual.status} data=${JSON.stringify(puntual.data).slice(0, 200)}`);

  // ── 2. Leads sin asignar según el flag del workspace ────────────────────
  console.log("\n2. Los leads sin asignar se rigen por la configuración del workspace");

  await admin(`workspaces?id=eq.${workspaceA}`, {
    method: "PATCH",
    body: JSON.stringify({ unassigned_leads_visible_to_members: false }),
  });
  const conFlagOff = await comoUsuario(token, `contacts?select=id&id=eq.${cSinAsignar}`);
  check(Array.isArray(conFlagOff.data) && conFlagOff.data.length === 0,
    "con el flag en false (default) el Member NO ve el lead sin asignar",
    `data=${JSON.stringify(conFlagOff.data).slice(0, 200)}`);

  await admin(`workspaces?id=eq.${workspaceA}`, {
    method: "PATCH",
    body: JSON.stringify({ unassigned_leads_visible_to_members: true }),
  });
  const conFlagOn = await comoUsuario(token, `contacts?select=id&id=eq.${cSinAsignar}`);
  check(Array.isArray(conFlagOn.data) && conFlagOn.data.length === 1,
    "con el flag en true el Member sí ve el lead sin asignar",
    `data=${JSON.stringify(conFlagOn.data).slice(0, 200)}`);

  await admin(`workspaces?id=eq.${workspaceA}`, {
    method: "PATCH",
    body: JSON.stringify({ unassigned_leads_visible_to_members: false }),
  });

  // ── 3. Conversaciones ───────────────────────────────────────────────────
  console.log("\n3. El mismo scope aplica a conversaciones");

  const convs = await comoUsuario(token, "conversations?select=id,assigned_to,contact_id");
  const convIds = new Set((Array.isArray(convs.data) ? convs.data : []).map((c) => c.id));

  check(convIds.has(convPropia), "ve la conversación del contacto donde es setter");
  check(convIds.has(convAsignada), "ve la conversación que le está asignada por assigned_to");
  check(!convIds.has(convAjena), "NO ve la conversación de otra persona",
    `devolvió ${convIds.size} conversaciones`);

  const convPuntual = await comoUsuario(token, `conversations?select=*&id=eq.${convAjena}`);
  check(Array.isArray(convPuntual.data) && convPuntual.data.length === 0,
    "un GET directo de la conversación ajena devuelve vacío",
    `data=${JSON.stringify(convPuntual.data).slice(0, 200)}`);

  // Regresión, no scope: la bandeja marca como leído desde el NAVEGADOR, con el
  // cliente del usuario. Si al reemplazar la policy `for all` del fork se
  // olvidara la de UPDATE, esto devolvería 0 filas afectadas y el
  // marcar-como-leído se rompería sin un solo error visible. Por eso se prueba
  // acá y no a mano en la UI.
  await admin(`conversations?id=eq.${convPropia}`, {
    method: "PATCH",
    body: JSON.stringify({ unread_count: 3 }),
  });
  await comoUsuario(token, `conversations?id=eq.${convPropia}`, {
    method: "PATCH",
    body: JSON.stringify({ unread_count: 0 }),
  });
  const trasMarcarLeido = await admin(`conversations?select=unread_count&id=eq.${convPropia}`);
  check(trasMarcarLeido.data[0]?.unread_count === 0,
    "el Member SÍ puede marcar como leída una conversación suya (unread_count)",
    `quedó en ${trasMarcarLeido.data[0]?.unread_count}`);

  // ── 4. Mensajes ─────────────────────────────────────────────────────────
  console.log("\n4. Los mensajes heredan el scope de su conversación");

  const msgs = await comoUsuario(token, `messages?select=id,text&id=eq.${msgAjeno}`);
  check(Array.isArray(msgs.data) && msgs.data.length === 0,
    "NO ve el mensaje de la conversación ajena",
    `data=${JSON.stringify(msgs.data).slice(0, 200)}`);

  // ── 5. Tablas satélite del contacto ─────────────────────────────────────
  // Sin propagar el scope acá, un Member no ve el lead ajeno pero sí su @ de
  // Instagram, sus tags y sus custom fields, que es la misma fuga por otra puerta.
  console.log("\n5. El scope se propaga a las tablas satélite del contacto");

  await admin("contact_channels", {
    method: "POST",
    body: JSON.stringify({
      contact_id: cAjeno,
      channel_id: canal[0].id,
      platform_sender_id: `ajeno-${sufijo}`,
      platform_username: `handle_ajeno_${sufijo}`,
    }),
  });

  const satelite = await comoUsuario(token, `contact_channels?select=platform_username&contact_id=eq.${cAjeno}`);
  check(Array.isArray(satelite.data) && satelite.data.length === 0,
    "NO ve el contact_channels del lead ajeno (su @ de la red social)",
    `data=${JSON.stringify(satelite.data).slice(0, 200)}`);

  // flow_sessions.variables es donde el motor guarda lo que capturó de la
  // conversación: nombre, email, teléfono, respuestas. La policy del fork
  // autorizaba vía flows, no vía contacto, así que se leía todo el workspace.
  const { data: flujo } = await admin("flows", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, name: `scope-test-${sufijo}` }),
  });
  limpiar.flujos.push(flujo[0].id);

  await admin("flow_sessions", {
    method: "POST",
    body: JSON.stringify({
      contact_id: cAjeno,
      flow_id: flujo[0].id,
      channel_id: canal[0].id,
      variables: { email_capturado: `ajeno-${sufijo}@ejemplo.com` },
    }),
  });

  const sesiones = await comoUsuario(token, `flow_sessions?select=variables&contact_id=eq.${cAjeno}`);
  check(Array.isArray(sesiones.data) && sesiones.data.length === 0,
    "NO ve la flow_session del lead ajeno (los datos que capturó el flujo)",
    `data=${JSON.stringify(sesiones.data).slice(0, 200)}`);

  // broadcast_recipients autorizaba vía broadcasts. Las difusiones no se usan
  // en la Etapa 1, pero la policy es consultable hoy.
  const { data: difusion } = await admin("broadcasts", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, name: `scope-test-${sufijo}` }),
  });
  limpiar.difusiones.push(difusion[0].id);

  await admin("broadcast_recipients", {
    method: "POST",
    body: JSON.stringify({
      broadcast_id: difusion[0].id,
      contact_id: cAjeno,
      channel_id: canal[0].id,
    }),
  });

  const destinatarios = await comoUsuario(token, `broadcast_recipients?select=id&contact_id=eq.${cAjeno}`);
  check(Array.isArray(destinatarios.data) && destinatarios.data.length === 0,
    "NO ve el broadcast_recipient del lead ajeno",
    `data=${JSON.stringify(destinatarios.data).slice(0, 200)}`);

  // ── 6. Reasignación ─────────────────────────────────────────────────────
  console.log("\n6. Reasignar un lead cambia de inmediato quién lo ve");

  await admin(`contacts?id=eq.${cAjeno}`, {
    method: "PATCH",
    body: JSON.stringify({ setter_id: member.id }),
  });
  const trasReasignar = await comoUsuario(token, `contacts?select=id&id=eq.${cAjeno}`);
  check(Array.isArray(trasReasignar.data) && trasReasignar.data.length === 1,
    "al pasarle el lead, el Member lo ve");

  await admin(`contacts?id=eq.${cAjeno}`, {
    method: "PATCH",
    body: JSON.stringify({ setter_id: otro.id }),
  });
  const trasQuitar = await comoUsuario(token, `contacts?select=id&id=eq.${cAjeno}`);
  check(Array.isArray(trasQuitar.data) && trasQuitar.data.length === 0,
    "al quitárselo, deja de verlo",
    `data=${JSON.stringify(trasQuitar.data).slice(0, 200)}`);

  // ── 7. La cola de trabajos no la toca ningún token de usuario ───────────
  // Se prueba con el token del Member, que SÍ es miembro del workspace, y no
  // con un no-miembro. El motivo: `scheduled_jobs` no tiene `workspace_id`, así
  // que la pertenencia no otorga nada y un no-miembro pasaría sin demostrar
  // nada. Lo que se prueba es que ningún token de usuario toca esa tabla, sea
  // miembro o no.
  //
  // Las tres policies que borró la 00019 autorizaban con `auth.uid() is not
  // null`: cualquier usuario autenticado del proyecto podía encolar trabajo que
  // el cron ejecuta, marcar la cola entera como completed y leer los payloads
  // de todos los workspaces.
  console.log("\n7. Ningún token de usuario lee ni escribe en scheduled_jobs");

  const colaLeida = await comoUsuario(token, "scheduled_jobs?select=id,type,payload");
  check(Array.isArray(colaLeida.data) && colaLeida.data.length === 0,
    "un Member NO lee la cola de trabajos",
    `status=${colaLeida.status} data=${JSON.stringify(colaLeida.data).slice(0, 200)}`);

  const tipoDePrueba = `scope-test-${sufijo}`;
  await comoUsuario(token, "scheduled_jobs", {
    method: "POST",
    body: JSON.stringify({
      type: tipoDePrueba,
      payload: { intruso: true },
      run_at: new Date().toISOString(),
    }),
  });
  // Se comprueba contra la base y no contra el código de estado: lo que importa
  // es que la fila no exista, no cómo se rechazó el intento.
  const colaTrasInsert = await admin(`scheduled_jobs?select=id&type=eq.${tipoDePrueba}`);
  check((colaTrasInsert.data ?? []).length === 0,
    "un Member NO puede encolar un trabajo que el cron ejecutaría",
    `quedaron ${(colaTrasInsert.data ?? []).length} filas con type=${tipoDePrueba}`);

  // ── 8. Escritura y borrado ──────────────────────────────────────────────
  // Va al final y sobre contactos dedicados: si las policies NO frenan el
  // borrado (como pasa con las del fork), el cascade se lleva las
  // conversaciones y los mensajes, y cualquier comprobación posterior daría un
  // falso verde imposible de atribuir.
  console.log("\n8. Un Member no puede editar ni borrar un lead ajeno");

  const cParaUpdate = await crearContacto({ display_name: `update-${sufijo}`, setter_id: otro.id });
  const cParaDelete = await crearContacto({ display_name: `delete-${sufijo}`, setter_id: otro.id });
  const cPropioParaDelete = await crearContacto({ display_name: `delete-propio-${sufijo}`, setter_id: member.id });

  await comoUsuario(token, `contacts?id=eq.${cParaUpdate}`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: "pisado-por-member" }),
  });
  const trasUpdate = await admin(`contacts?select=display_name&id=eq.${cParaUpdate}`);
  check(trasUpdate.data[0]?.display_name === `update-${sufijo}`,
    "un UPDATE del Member sobre un contacto ajeno no cambia nada",
    `quedó "${trasUpdate.data[0]?.display_name}"`);

  await comoUsuario(token, `contacts?id=eq.${cParaDelete}`, { method: "DELETE" });
  const trasDelete = await admin(`contacts?select=id&id=eq.${cParaDelete}`);
  check(trasDelete.data.length === 1, "un DELETE del Member sobre un contacto ajeno no lo borra");

  // El DELETE es de Owner y Admin: un Member tampoco borra los suyos.
  await comoUsuario(token, `contacts?id=eq.${cPropioParaDelete}`, { method: "DELETE" });
  const propioTrasDelete = await admin(`contacts?select=id&id=eq.${cPropioParaDelete}`);
  check(propioTrasDelete.data.length === 1,
    "un Member no puede borrar ni sus propios contactos (DELETE es de Owner/Admin)");

  return totalInicial;
}

// ── Limpieza ────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log("\nLimpieza");
  if (workspaceA && flagOriginal !== null) {
    await admin(`workspaces?id=eq.${workspaceA}`, {
      method: "PATCH",
      body: JSON.stringify({ unassigned_leads_visible_to_members: flagOriginal }),
    }).catch(() => {});
  }
  // El canal cascadea conversaciones y mensajes; el flujo y la difusión
  // cascadean sus sesiones y destinatarios; el contacto cascadea el resto.
  for (const id of limpiar.canales) await admin(`channels?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.flujos) await admin(`flows?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.difusiones) await admin(`broadcasts?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.contactos) await admin(`contacts?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.usuarios) await auth(`admin/users/${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.workspaces) await admin(`workspaces?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  // Por si el INSERT del Member sobre la cola llegara a pasar: sin esto, una
  // corrida en rojo dejaría un trabajo encolado que el cron levantaría.
  await admin(`scheduled_jobs?type=eq.scope-test-${sufijo}`, { method: "DELETE" }).catch(() => {});
  console.log(
    `  ${limpiar.usuarios.length} usuarios, ${limpiar.workspaces.length} workspaces, ` +
    `${limpiar.canales.length} canales, ${limpiar.flujos.length} flujos, ` +
    `${limpiar.difusiones.length} difusiones y ${limpiar.contactos.length} contactos de prueba borrados`
  );
}

let totalInicial = null;
try {
  totalInicial = await main();
} catch (err) {
  check(false, "el script se cortó con una excepción", err instanceof Error ? err.stack : String(err));
} finally {
  await cleanup();
}

if (totalInicial !== null) {
  const { data: wsFinales } = await admin("workspaces?select=id");
  check(wsFinales.length === totalInicial, "no quedaron workspaces de prueba",
    `al empezar ${totalInicial}, al terminar ${wsFinales.length}`);
  const { data: contactosFinales } = await admin(`contacts?select=id,display_name&display_name=like.*${sufijo}*`);
  check((contactosFinales ?? []).length === 0, "no quedaron contactos de prueba");
}

console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron`);
process.exit(fallos > 0 ? 1 : 0);
