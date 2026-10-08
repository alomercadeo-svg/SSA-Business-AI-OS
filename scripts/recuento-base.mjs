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
 *   - por canal (desde el 08/10/2026, para la prueba de «Desconectar» de F24):
 *     id, plataforma, usuario, si está activo, `platform_account_id`,
 *     `excede_plan_zernio`, y cuántas conversaciones, contactos y mensajes
 *     cuelgan de él. Con `--desde`, cuántas conversaciones de cada canal se
 *     crearon después de esa hora: separa un lead real que escribió en el medio
 *     de un efecto de la prueba;
 *   - `audit_log` por espacio y por acción, con la hora y la etiqueta de la
 *     entidad de la última. La etiqueta es la del historial («Instagram
 *     @cuenta»), nunca el contenido de un mensaje ni datos de un contacto.
 *
 * Uso:
 *   node scripts/recuento-base.mjs                         tabla legible
 *   node scripts/recuento-base.mjs --json                  el resultado crudo, para guardar
 *   node scripts/recuento-base.mjs --desde 2026-10-08T11:40:00-06:00
 *
 *   - desde el 08/10/2026 (F27), si existen las columnas de la 00032: por canal,
 *     cuántas conversaciones hay en cada `historial_estado` (qué quedó a medio
 *     importar), mensajes entrantes y salientes, y con adjunto; y el estado de
 *     las tareas del servidor (`tareas_estado`): si la importación corre, cuándo
 *     terminó y su resultado. Solo cantidades.
 *
 * Nació el 07/10/2026 con F31, F25 y F26, que piden recuentos antes y después
 * de cada `supabase db push`. Sirve igual para F27.
 */
import { execFileSync } from "node:child_process";

// `--desde` entra en el SQL, así que se acepta solo una fecha ISO y nada más.
const iDesde = process.argv.indexOf("--desde");
const DESDE = iDesde >= 0 ? process.argv[iDesde + 1] : null;
if (DESDE !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(DESDE ?? "")) {
  console.error("--desde necesita una fecha ISO con zona, por ejemplo 2026-10-08T11:40:00-06:00");
  process.exit(2);
}

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

// Por canal. Solo cantidades e identificadores de cuenta, nunca contenido.
const SQL_CANALES = `
select json_agg(row_to_json(q) order by q.espacio, q.plataforma, q.usuario) as r from (
  select e.name as espacio, ch.id, ch.platform as plataforma, ch.provider as proveedor,
    coalesce(ch.username, ch.instance_name) as usuario, ch.is_active as activo,
    ch.platform_account_id, ch.excede_plan_zernio,
    (select count(*)::int from public.conversations v where v.channel_id = ch.id) as conversaciones,
    (select count(distinct cc.contact_id)::int from public.contact_channels cc where cc.channel_id = ch.id) as contactos,
    (select count(*)::int from public.messages m join public.conversations v on v.id = m.conversation_id where v.channel_id = ch.id) as mensajes,
    ${
      DESDE
        ? `(select count(*)::int from public.conversations v where v.channel_id = ch.id and v.created_at > '${DESDE}'::timestamptz)`
        : "null::int"
    } as conversaciones_desde
  from public.channels ch join public.workspaces e on e.id = ch.workspace_id
) q
`;

const SQL_AUDIT_ACCIONES = `
select case when to_regclass('public.audit_log') is null then null
  else (select json_agg(row_to_json(q) order by q.espacio, q.accion) from (
    select coalesce(e.name, '(sin espacio o espacio borrado)') as espacio, a.action as accion, count(*)::int as n,
      max(a.created_at) as ultima,
      (array_agg(a.entity_label order by a.created_at desc))[1] as ultima_entidad
    from public.audit_log a left join public.workspaces e on e.id = a.workspace_id group by 1, 2
  ) q) end as r
`;

// F27: solo si ya está la 00032. Cantidades, nunca contenido.
const SQL_HISTORIAL = `
select json_build_object(
  'por_canal', (select json_agg(row_to_json(q) order by q.usuario) from (
    select coalesce(ch.username, ch.instance_name) as usuario, ch.last_inbound_at as ultimo_entrante,
      (select json_object_agg(estado, n) from (select v.historial_estado as estado, count(*)::int as n
         from public.conversations v where v.channel_id = ch.id group by 1) e) as historial,
      (select count(*)::int from public.messages m join public.conversations v on v.id = m.conversation_id
         where v.channel_id = ch.id and m.direction = 'inbound') as entrantes,
      (select count(*)::int from public.messages m join public.conversations v on v.id = m.conversation_id
         where v.channel_id = ch.id and m.direction = 'outbound') as salientes,
      (select count(*)::int from public.messages m join public.conversations v on v.id = m.conversation_id
         where v.channel_id = ch.id and m.media_status is not null) as con_adjunto
    from public.channels ch) q),
  'tareas', (select json_agg(json_build_object('clave', t.clave, 'ocupada_hasta', t.ocupada_hasta,
      'ultima_ejecucion_at', t.ultima_ejecucion_at, 'ultimo_ok_at', t.ultimo_ok_at,
      'ultimo_error', t.ultimo_error, 'resultado', t.resultado) order by t.clave) from public.tareas_estado t)
) as r
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
let auditPorAccion;
const r = consultar(SQL);
try {
  // Con la tabla inexistente, el `case` igual referencia public.audit_log y
  // Postgres lo rechaza al planificar. Ese rechazo es la respuesta "no existe".
  auditPorEspacio = r.existe_audit_log ? consultar(SQL_AUDIT) : null;
  auditPorAccion = r.existe_audit_log ? consultar(SQL_AUDIT_ACCIONES) : null;
} catch {
  auditPorEspacio = null;
  auditPorAccion = null;
}
const canales = consultar(SQL_CANALES) ?? [];
let historial = null;
try {
  historial = consultar(SQL_HISTORIAL);
} catch {
  historial = null; // antes de la 00032
}

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify({ ...r, audit_log: auditPorEspacio, audit_log_por_accion: auditPorAccion, canales, historial, desde: DESDE }, null, 2)
  );
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

console.log("");
console.log(`Canales${DESDE ? ` (conversaciones nuevas desde ${DESDE})` : ""}:`);
for (const c of canales) {
  console.log(
    `    ${c.espacio} · ${c.plataforma}/${c.proveedor} · ${c.usuario ?? "(sin usuario)"} · ${c.activo ? "activo" : "INACTIVO"}`
  );
  console.log(`        id ${c.id}`);
  console.log(`        platform_account_id ${c.platform_account_id ?? "(nulo)"} · excede_plan_zernio ${c.excede_plan_zernio}`);
  console.log(
    `        conversaciones ${c.conversaciones} · contactos ${c.contactos} · mensajes ${c.mensajes}` +
      (DESDE ? ` · conversaciones creadas desde --desde: ${c.conversaciones_desde}` : "")
  );
}

if (auditPorAccion) {
  console.log("");
  console.log("audit_log por acción:");
  for (const a of auditPorAccion) {
    console.log(`    ${a.espacio} · ${a.accion}: ${a.n} (última ${a.ultima}, ${a.ultima_entidad ?? "sin etiqueta"})`);
  }
}

if (historial) {
  console.log("");
  console.log("Historial (F27), por canal:");
  for (const c of historial.por_canal ?? []) {
    console.log(
      `    ${c.usuario ?? "(sin usuario)"}: conversaciones por estado ${JSON.stringify(c.historial ?? {})} · ` +
        `mensajes entrantes ${c.entrantes}, salientes ${c.salientes}, con adjunto ${c.con_adjunto} · ` +
        `último entrante ${c.ultimo_entrante ?? "(nunca)"}`
    );
  }
  console.log("Tareas del servidor:");
  if (!(historial.tareas ?? []).length) console.log("    (ninguna registrada)");
  for (const t of historial.tareas ?? []) {
    console.log(
      `    ${t.clave}: ${t.ocupada_hasta ? `EN CURSO hasta ${t.ocupada_hasta}` : "libre"} · ` +
        `última ${t.ultima_ejecucion_at ?? "-"} · último ok ${t.ultimo_ok_at ?? "-"}` +
        (t.ultimo_error ? ` · error: ${t.ultimo_error}` : "")
    );
    if (t.resultado && Object.keys(t.resultado).length) console.log(`        ${JSON.stringify(t.resultado)}`);
  }
}

