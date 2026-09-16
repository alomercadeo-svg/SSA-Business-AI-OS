#!/usr/bin/env node
/**
 * Verificación de F2: Supabase Vault aislado por workspace.
 *
 * Prueba las tres funciones RPC contra la base real, por la API REST, que es el
 * camino que usa la app. No usa el SDK: solo fetch y módulos de Node.
 *
 * Qué comprueba (criterios de aceptación de F2):
 *   1. Un secret guardado se lee y devuelve el valor original.
 *   2. Uno eliminado ya no es accesible.
 *   3. Los secrets están aislados por workspace: el Owner de otro workspace no
 *      puede leerlos ni sobreescribirlos.
 *   4. Solo Owner, Admin y service_role pueden crear, leer o eliminar.
 *      Un Member no puede.
 *   5. La anon key no puede invocar las funciones.
 *
 * Uso:
 *   node scripts/verify-vault.mjs
 *
 * Crea y borra sus propios datos de prueba. La limpieza corre en un finally,
 * así que también se ejecuta si una comprobación falla.
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

function ok(desc) {
  pasados++;
  console.log(`  ok    ${desc}`);
}

function fail(desc, detalle) {
  fallos++;
  console.log(`  FALLA ${desc}`);
  if (detalle !== undefined) console.log(`        ${detalle}`);
}

function check(cond, desc, detalle) {
  cond ? ok(desc) : fail(desc, detalle);
}

/** Llama una función RPC. `key` es la apikey y `token` el bearer (por defecto, la key). */
async function rpc(fn, body, key, token = key) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let data = null;
  const txt = await res.text();
  if (txt) {
    try {
      data = JSON.parse(txt);
    } catch {
      data = txt;
    }
  }
  return { status: res.status, data };
}

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
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

/** Token de acceso de un usuario, por password grant con la anon key. */
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
const limpiar = {
  usuarios: [],
  /**
   * Workspaces creados por el script MÁS los que crea el trigger
   * handle_new_user al dar de alta cada usuario. Ese workspace fantasma no lo
   * borra nadie: workspace_members.user_id cascadea al borrar el usuario de
   * auth, pero workspaces no tiene FK al usuario, así que queda huérfano con
   * cero miembros. Hay que borrarlo por id.
   */
  workspaces: [],
  secrets: [],
};

const SECRET_NOMBRE = `probe_${sufijo}`;
const SECRET_VALOR = `valor-de-prueba-${randomUUID()}`;

/** Da de alta un usuario y registra para limpieza tanto al usuario como su workspace propio. */
async function crearUsuario(nombre) {
  const email = `vault-${nombre}-${sufijo}@ssa-test.local`;
  const password = `Probe-${randomUUID()}`;
  const { data } = await auth("admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Vault ${nombre}` },
    }),
  });
  if (!data?.id) throw new Error(`no se pudo crear al usuario ${nombre}: ${JSON.stringify(data).slice(0, 200)}`);
  limpiar.usuarios.push(data.id);

  // Esperar a que el trigger cree el workspace propio y registrarlo.
  await new Promise((r) => setTimeout(r, 1200));
  const { data: ms } = await rest(`workspace_members?select=workspace_id&user_id=eq.${data.id}`);
  for (const m of ms ?? []) limpiar.workspaces.push(m.workspace_id);

  return { id: data.id, email, password };
}

// ── Verificación ────────────────────────────────────────────────────────────

async function main() {
  const { data: wsIniciales } = await rest("workspaces?select=id,name");
  const workspaceA = wsIniciales[0].id;
  const totalInicial = wsIniciales.length;
  console.log(`Workspace A: ${wsIniciales[0].name} (${workspaceA})`);
  console.log(`Workspaces al empezar: ${totalInicial}\n`);

  // ── 1. Guardar y leer con service_role ──────────────────────────────────
  console.log("1. Guardar y leer con service_role");

  const guardado = await rpc("store_secret", {
    secret_name: SECRET_NOMBRE,
    secret_value: SECRET_VALOR,
    workspace_id: workspaceA,
  }, SERVICE);
  check(guardado.status === 200 && typeof guardado.data === "string",
    "store_secret devuelve el id del secret",
    `status=${guardado.status} data=${JSON.stringify(guardado.data)}`);
  if (guardado.status === 200) limpiar.secrets.push([SECRET_NOMBRE, workspaceA]);

  const leido = await rpc("read_secret", {
    secret_name: SECRET_NOMBRE,
    workspace_id: workspaceA,
  }, SERVICE);
  check(leido.data === SECRET_VALOR,
    "read_secret devuelve el valor original",
    `status=${leido.status} coincide=${leido.data === SECRET_VALOR}`);

  // Sobreescribir: el índice único en vault.secrets.name obliga a update, no insert.
  const VALOR_2 = `${SECRET_VALOR}-v2`;
  await rpc("store_secret", {
    secret_name: SECRET_NOMBRE, secret_value: VALOR_2, workspace_id: workspaceA,
  }, SERVICE);
  const releido = await rpc("read_secret", {
    secret_name: SECRET_NOMBRE, workspace_id: workspaceA,
  }, SERVICE);
  check(releido.data === VALOR_2,
    "guardar dos veces el mismo nombre actualiza en lugar de duplicar",
    `coincide=${releido.data === VALOR_2}`);

  const inexistente = await rpc("read_secret", {
    secret_name: `no_existe_${sufijo}`, workspace_id: workspaceA,
  }, SERVICE);
  check(inexistente.status === 200 && inexistente.data === null,
    "un secret que no existe devuelve null, no un error",
    `status=${inexistente.status} data=${JSON.stringify(inexistente.data)}`);

  // ── 2. La anon key no puede invocar las funciones ───────────────────────
  console.log("\n2. La anon key no puede invocar las funciones");

  const anonRead = await rpc("read_secret", {
    secret_name: SECRET_NOMBRE, workspace_id: workspaceA,
  }, ANON);
  check(anonRead.status === 401 || anonRead.status === 403 || anonRead.status === 404,
    "read_secret con anon key es rechazada",
    `status=${anonRead.status} data=${JSON.stringify(anonRead.data).slice(0, 160)}`);
  check(JSON.stringify(anonRead.data ?? "").includes(VALOR_2) === false,
    "la respuesta a la anon key no contiene el valor del secret");

  // ── 3. Un Member no puede tocar los secrets ─────────────────────────────
  console.log("\n3. Un Member del mismo workspace no puede tocar los secrets");

  const member = await crearUsuario("member");
  await rest("workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceA, user_id: member.id, role: "member" }),
  });
  const tokenMember = await tokenDe(member.email, member.password);

  const memberRead = await rpc("read_secret", {
    secret_name: SECRET_NOMBRE, workspace_id: workspaceA,
  }, ANON, tokenMember);
  check(memberRead.status === 403,
    "read_secret con token de Member devuelve 403",
    `status=${memberRead.status} data=${JSON.stringify(memberRead.data).slice(0, 160)}`);
  check(JSON.stringify(memberRead.data ?? "").includes(VALOR_2) === false,
    "el error devuelto al Member no filtra el valor del secret");

  const memberStore = await rpc("store_secret", {
    secret_name: SECRET_NOMBRE, secret_value: "pisado-por-member", workspace_id: workspaceA,
  }, ANON, tokenMember);
  check(memberStore.status === 403, "store_secret con token de Member devuelve 403", `status=${memberStore.status}`);

  const memberDelete = await rpc("delete_secret", {
    secret_name: SECRET_NOMBRE, workspace_id: workspaceA,
  }, ANON, tokenMember);
  check(memberDelete.status === 403, "delete_secret con token de Member devuelve 403", `status=${memberDelete.status}`);

  const trasIntentos = await rpc("read_secret", {
    secret_name: SECRET_NOMBRE, workspace_id: workspaceA,
  }, SERVICE);
  check(trasIntentos.data === VALOR_2, "después de los intentos del Member el secret sigue intacto");

  // ── 4. Aislamiento entre workspaces ─────────────────────────────────────
  console.log("\n4. Aislamiento entre workspaces");

  // El usuario ajeno es Owner de su propio workspace (el que le creó el trigger),
  // así que es manager en algún lado pero no en A.
  const ajeno = await crearUsuario("ajeno");
  const tokenAjeno = await tokenDe(ajeno.email, ajeno.password);
  const { data: msAjeno } = await rest(`workspace_members?select=workspace_id,role&user_id=eq.${ajeno.id}`);
  const workspaceB = msAjeno[0].workspace_id;
  check(msAjeno[0].role === "owner", "el usuario ajeno es Owner de su propio workspace (workspace B)");

  const ajenoLeeA = await rpc("read_secret", {
    secret_name: SECRET_NOMBRE, workspace_id: workspaceA,
  }, ANON, tokenAjeno);
  check(ajenoLeeA.status === 403,
    "el Owner del workspace B no puede leer un secret del workspace A",
    `status=${ajenoLeeA.status} data=${JSON.stringify(ajenoLeeA.data).slice(0, 160)}`);
  check(JSON.stringify(ajenoLeeA.data ?? "").includes(VALOR_2) === false,
    "el error devuelto al Owner de B no filtra el valor del secret de A");

  const ajenoEscribeA = await rpc("store_secret", {
    secret_name: SECRET_NOMBRE, secret_value: "pisado-desde-B", workspace_id: workspaceA,
  }, ANON, tokenAjeno);
  check(ajenoEscribeA.status === 403, "el Owner de B no puede sobreescribir un secret de A", `status=${ajenoEscribeA.status}`);

  // Mismo nombre de secret en B: tiene que ser un secret distinto, no el de A.
  const VALOR_B = `valor-de-B-${randomUUID()}`;
  const guardaB = await rpc("store_secret", {
    secret_name: SECRET_NOMBRE, secret_value: VALOR_B, workspace_id: workspaceB,
  }, ANON, tokenAjeno);
  check(guardaB.status === 200, "el Owner de B sí puede guardar en su propio workspace", `status=${guardaB.status}`);
  if (guardaB.status === 200) limpiar.secrets.push([SECRET_NOMBRE, workspaceB]);

  const leeB = await rpc("read_secret", { secret_name: SECRET_NOMBRE, workspace_id: workspaceB }, ANON, tokenAjeno);
  const leeAotraVez = await rpc("read_secret", { secret_name: SECRET_NOMBRE, workspace_id: workspaceA }, SERVICE);
  check(leeB.data === VALOR_B && leeAotraVez.data === VALOR_2,
    "el mismo nombre de secret en dos workspaces son dos secrets distintos",
    `B=${leeB.data === VALOR_B} A=${leeAotraVez.data === VALOR_2}`);

  // ── 5. Borrado ──────────────────────────────────────────────────────────
  console.log("\n5. Borrado");

  const borrado = await rpc("delete_secret", { secret_name: SECRET_NOMBRE, workspace_id: workspaceA }, SERVICE);
  check(borrado.data === true, "delete_secret devuelve true cuando borró algo", `data=${JSON.stringify(borrado.data)}`);

  const trasBorrado = await rpc("read_secret", { secret_name: SECRET_NOMBRE, workspace_id: workspaceA }, SERVICE);
  check(trasBorrado.status === 200 && trasBorrado.data === null,
    "un secret eliminado ya no es accesible",
    `status=${trasBorrado.status} data=${JSON.stringify(trasBorrado.data)}`);

  const reborrado = await rpc("delete_secret", { secret_name: SECRET_NOMBRE, workspace_id: workspaceA }, SERVICE);
  check(reborrado.data === false, "borrar dos veces devuelve false, no un error", `data=${JSON.stringify(reborrado.data)}`);

  const bSigue = await rpc("read_secret", { secret_name: SECRET_NOMBRE, workspace_id: workspaceB }, ANON, tokenAjeno);
  check(bSigue.data === VALOR_B, "borrar el secret de A no toca el de B");

  return totalInicial;
}

// ── Limpieza ────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log("\nLimpieza");
  for (const [nombre, ws] of limpiar.secrets) {
    await rpc("delete_secret", { secret_name: nombre, workspace_id: ws }, SERVICE).catch(() => {});
  }
  for (const id of limpiar.usuarios) {
    await auth(`admin/users/${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const id of limpiar.workspaces) {
    await rest(`workspaces?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  }
  console.log(`  ${limpiar.usuarios.length} usuarios, ${limpiar.workspaces.length} workspaces y ${limpiar.secrets.length} secrets de prueba borrados`);
}

let totalInicial = null;
try {
  totalInicial = await main();
} catch (err) {
  fail("el script se cortó con una excepción", err instanceof Error ? err.message : String(err));
} finally {
  await cleanup();
}

// El conteo de workspaces tiene que volver al valor de partida: si no, quedó basura.
if (totalInicial !== null) {
  const { data: wsFinales } = await rest("workspaces?select=id");
  check(wsFinales.length === totalInicial,
    "no quedaron workspaces de prueba",
    `al empezar ${totalInicial}, al terminar ${wsFinales.length}`);
}

console.log(`\n${pasados} comprobaciones pasaron, ${fallos} fallaron`);
process.exit(fallos > 0 ? 1 : 0);
