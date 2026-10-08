#!/usr/bin/env node
/**
 * Recuento de la base, para comparar antes y después de una migración.
 *
 * Es de SOLO LECTURA: un único `select` contra la base vinculada, por el CLI de
 * Supabase (`supabase db query --linked`, que va por la API de administración).
 * No escribe nada, ni siquiera en tablas de prueba.
 *
 * Qué cuenta:
 *   - tablas del esquema `public`, migraciones registradas por el CLI y la última;
 *   - filas de las tablas que tocan las migraciones del Bloque 3, en total y por
 *     espacio de trabajo, con el nombre del espacio. Ahí está el historial real
 *     de «Ale Admin's Workspace»: conversaciones y mensajes;
 *   - `audit_log`, si existe. Si no existe, lo dice en vez de fallar: antes de la
 *     00028 esa es justamente la respuesta correcta.
 *
 * Uso:
 *   node scripts/recuento-base.mjs            tabla legible
 *   node scripts/recuento-base.mjs --json     el resultado crudo, para guardar
 *
 * Nació el 07/10/2026 con F31, F25 y F26, que piden recuentos antes y después
 * de cada `supabase db push`. Sirve igual para F27.
 */
import { execFileSync } from "node:child_process";

const TABLAS = [
  "contacts",
  "contact_channels",
  "contact_tags",
  "contact_custom_fields",
  "channels",
  "conversations",
  "messages",
  "workspace_members",
];

const porEspacio = (t) =>
  t === "contact_channels" || t === "contact_tags" || t === "contact_custom_fields"
    ? `select c.workspace_id, count(*)::int as n from public.${t} x join public.contacts c on c.id = x.contact_id group by 1`
    : t === "messages"
      ? `select v.workspace_id, count(*)::int as n from public.messages x join public.conversations v on v.id = x.conversation_id group by 1`
      : `select workspace_id, count(*)::int as n from public.${t} group by 1`;

const SQL = `
with
  esp as (select id, name from public.workspaces),
  conteos as (
    ${TABLAS.map((t) => `select '${t}' as tabla, workspace_id, n from (${porEspacio(t)}) q`).join("\n    union all\n    ")}
  )
select json_build_object(
  'tablas_public', (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'),
  'migraciones', (select count(*) from supabase_migrations.schema_migrations),
  'ultima_migracion', (select max(version) from supabase_migrations.schema_migrations),
  'existe_audit_log', to_regclass('public.audit_log') is not null,
  'espacios', (select json_agg(json_build_object('id', id, 'nombre', name) order by name) from esp),
  'conteos', (select json_agg(json_build_object('tabla', tabla, 'espacio', coalesce(e.name, '(sin espacio)'), 'n', n) order by tabla, e.name) from conteos left join esp e on e.id = conteos.workspace_id)
) as r
`;

// audit_log se cuenta aparte, con un bloque que no falla si la tabla no existe.
const SQL_AUDIT = `
select case when to_regclass('public.audit_log') is null then null
  else (select json_agg(row_to_json(q)) from (
    select coalesce(e.name, '(sin espacio o espacio borrado)') as espacio, count(*)::int as n
    from public.audit_log a left join public.workspaces e on e.id = a.workspace_id group by 1 order by 1
  ) q) end as r
`;

function consultar(sql) {
  const salida = execFileSync("npx", ["supabase", "db", "query", "--linked", "-o", "json", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const inicio = salida.indexOf("{");
  const j = JSON.parse(salida.slice(inicio));
  return j.rows[0].r;
}

let auditPorEspacio;
const r = consultar(SQL);
try {
  // Con la tabla inexistente, el `case` igual referencia public.audit_log y
  // Postgres lo rechaza al planificar. Ese rechazo es la respuesta "no existe".
  auditPorEspacio = r.existe_audit_log ? consultar(SQL_AUDIT) : null;
} catch {
  auditPorEspacio = null;
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...r, audit_log: auditPorEspacio }, null, 2));
  process.exit(0);
}

console.log(`Tablas en public: ${r.tablas_public}`);
console.log(`Migraciones registradas: ${r.migraciones} (última ${r.ultima_migracion})`);
console.log(`Espacios: ${(r.espacios ?? []).map((e) => e.nombre).join(" · ")}`);
console.log("");
const totales = {};
for (const c of r.conteos ?? []) totales[c.tabla] = (totales[c.tabla] ?? 0) + c.n;
for (const t of TABLAS) {
  const filas = (r.conteos ?? []).filter((c) => c.tabla === t);
  console.log(`${t}: ${totales[t] ?? 0}`);
  for (const f of filas) console.log(`    ${f.espacio}: ${f.n}`);
}
console.log("");
if (!r.existe_audit_log) console.log("audit_log: la tabla no existe");
else {
  const total = (auditPorEspacio ?? []).reduce((s, f) => s + f.n, 0);
  console.log(`audit_log: ${total}`);
  for (const f of auditPorEspacio ?? []) console.log(`    ${f.espacio}: ${f.n}`);
}
