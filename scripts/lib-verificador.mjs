/**
 * Piezas comunes de los verificadores del Bloque 3 (`verify-auditoria.mjs`,
 * `verify-contacto-extendido.mjs`, `verify-identidad-canal.mjs`).
 *
 * Son las mismas que `verify-lead-scope.mjs` tiene adentro, sacadas a un módulo
 * para no copiarlas tres veces más. Ese script no se tocó: funciona, y cambiarlo
 * no es de esta sesión.
 *
 * DÓNDE TRABAJAN ESTOS VERIFICADORES. Nunca en el espacio real. Cada usuario de
 * prueba que se da de alta recibe su propio espacio de trabajo por el trigger
 * `handle_new_user`, y ese espacio fantasma es el escenario. Importa por
 * `audit_log`: esa tabla no se puede limpiar (F31), así que lo que un
 * verificador deje ahí queda para siempre. En un espacio fantasma queda
 * huérfano cuando el espacio se borra, e invisible para todos, porque nadie es
 * miembro de un espacio que ya no existe.
 *
 * Los usuarios de prueba son `@ssa-test.local`, dados de alta por la API de
 * administración con `email_confirm: true`, igual que en `verify-lead-scope`.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

export const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !ANON || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

export const sufijo = randomUUID().slice(0, 8);

const estado = { fallos: 0, pasados: 0, noConcluyentes: 0 };

export function check(cond, desc, detalle) {
  if (cond) {
    estado.pasados++;
    console.log(`  ok    ${desc}`);
  } else {
    estado.fallos++;
    console.log(`  FALLA ${desc}`);
    if (detalle !== undefined) console.log(`        ${detalle}`);
  }
  return cond;
}

/** Cuando el control positivo falló, lo que dependía de él no es verde ni rojo. */
export function noConcluyente(desc, motivo) {
  estado.noConcluyentes++;
  console.log(`  NO CONCLUYENTE ${desc}`);
  console.log(`        ${motivo}`);
}

async function pedir(base, path, clave, token, init = {}) {
  const res = await fetch(`${URL_BASE}/${base}/${path}`, {
    ...init,
    headers: {
      apikey: clave,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
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

/** Con la clave de servicio: saltea RLS. Para armar y limpiar el escenario. */
export const admin = (path, init) => pedir("rest/v1", path, SERVICE, SERVICE, init);

/** Con el token de un usuario: la RLS aplica. Esto es lo que se prueba. */
export const comoUsuario = (token, path, init) => pedir("rest/v1", path, ANON, token, init);

/** Llamada a una función SQL por PostgREST. */
export const rpcAdmin = (fn, args) => admin(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
export const rpcComo = (token, fn, args) =>
  comoUsuario(token, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

const authAdmin = (path, init) => pedir("auth/v1", path, SERVICE, SERVICE, init);

/**
 * Consulta de solo lectura al catálogo, por el CLI (`supabase db query
 * --linked`). PostgREST no expone `pg_indexes` ni `pg_trigger`.
 */
export function catalogo(sql) {
  const salida = execFileSync("npx", ["supabase", "db", "query", "--linked", "-o", "json", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(salida.slice(salida.indexOf("{"))).rows;
}

export const limpiar = { usuarios: [], workspaces: [], contactos: [], canales: [] };

/**
 * Da de alta un usuario de prueba y devuelve su espacio fantasma.
 * Lo registra para limpieza, igual que el espacio.
 */
export async function crearUsuario(nombre) {
  const email = `b3-${nombre}-${sufijo}@ssa-test.local`;
  const password = `Probe-${randomUUID()}`;
  const { data } = await authAdmin("admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `B3 ${nombre}` } }),
  });
  if (!data?.id) throw new Error(`no se pudo crear al usuario ${nombre}: ${JSON.stringify(data).slice(0, 200)}`);
  limpiar.usuarios.push(data.id);

  let espacio = null;
  for (let i = 0; i < 10 && !espacio; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const { data: ms } = await admin(`workspace_members?select=workspace_id&user_id=eq.${data.id}`);
    espacio = ms?.[0]?.workspace_id ?? null;
  }
  if (!espacio) throw new Error(`el alta de ${nombre} no creó su espacio de trabajo`);
  limpiar.workspaces.push(espacio);

  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`no se pudo autenticar a ${nombre}`);
  return { id: data.id, email, espacio, token: j.access_token };
}

/** Suma un usuario a un espacio con un rol. */
export async function sumarAlEspacio(espacio, usuario, rol) {
  const r = await admin("workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, user_id: usuario.id, role: rol }),
  });
  if (r.status >= 300) throw new Error(`no se pudo sumar a ${usuario.email}: HTTP ${r.status}`);
}

export async function crearContacto(espacio, campos = {}) {
  const r = await admin("contacts", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, display_name: `b3-${sufijo}`, ...campos }),
  });
  if (!r.data?.[0]?.id) throw new Error(`no se pudo crear el contacto: ${JSON.stringify(r.data).slice(0, 300)}`);
  limpiar.contactos.push(r.data[0].id);
  return r.data[0];
}

/**
 * Limpia en el orden que exige la base: contactos (cascadean conversaciones y
 * mensajes), canales (desde la 00025 no se borran con historia), usuarios y
 * espacios. Lo que no se pudo borrar se dice, no se calla.
 */
export async function limpiarTodo() {
  console.log("\nLimpieza");
  for (const id of limpiar.contactos) await admin(`contacts?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.canales) {
    const r = await admin(`channels?id=eq.${id}`, { method: "DELETE" }).catch(() => ({ status: 0 }));
    if (r.status >= 300 || r.status === 0) check(false, `se borra el canal de prueba ${id}`, `HTTP ${r.status}`);
  }
  for (const id of limpiar.usuarios) await authAdmin(`admin/users/${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of limpiar.workspaces) await admin(`workspaces?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  const quedan = await admin(`workspaces?select=id&id=in.(${limpiar.workspaces.join(",") || "00000000-0000-0000-0000-000000000000"})`);
  check((quedan.data ?? []).length === 0, "no quedaron espacios de prueba");
  console.log(
    `  ${limpiar.usuarios.length} usuarios, ${limpiar.workspaces.length} espacios, ` +
      `${limpiar.contactos.length} contactos y ${limpiar.canales.length} canales de prueba borrados`
  );
}

/** Corre el escenario, limpia siempre, y sale con el código que corresponde. */
export async function correr(main) {
  try {
    await main();
  } catch (err) {
    check(false, "el script se cortó con una excepción", err instanceof Error ? err.stack : String(err));
  } finally {
    await limpiarTodo();
  }
  console.log(
    `\n${estado.pasados} comprobaciones pasaron, ${estado.fallos} fallaron` +
      (estado.noConcluyentes ? `, ${estado.noConcluyentes} no concluyentes` : "")
  );
  process.exit(estado.fallos > 0 ? 1 : estado.noConcluyentes > 0 ? 2 : 0);
}
