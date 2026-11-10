-- ============================================================
-- 00057: IMPORTACIONES EN SEGUNDO PLANO (F37, parte 2; ítem 2 de la sesión de cierre, 10/11/2026)
-- ============================================================
-- Más de 500 filas se procesan en segundo plano (F37, criterio 7). El archivo
-- se sube en tandas de hasta 500 filas a `csv_import_lotes`, y el servidor las
-- procesa después de responder. `csv_imports` suma lo que hace falta para la
-- barra de progreso, el resumen con el detalle de los errores, el control de
-- la migración y el aviso por correo al terminar (F37, criterio 8, vía F23).
--
-- Quién escribe: SOLO el servidor, con la clave de servicio, como en la 00054.
-- `csv_import_lotes` tiene la seguridad por filas activada y ninguna política:
-- ninguna sesión de usuario la lee ni la escribe (guarda las celdas crudas).
--
-- Idempotente: se puede correr dos veces sin error ni cambios.

alter table public.csv_imports add column if not exists en_segundo_plano boolean not null default false;
alter table public.csv_imports add column if not exists procesadas integer not null default 0;
alter table public.csv_imports add column if not exists lotes integer not null default 0;
alter table public.csv_imports add column if not exists opciones jsonb;
alter table public.csv_imports add column if not exists lineas jsonb not null default '[]'::jsonb;
alter table public.csv_imports add column if not exists usaron_codigo integer not null default 0;
alter table public.csv_imports add column if not exists control jsonb;
alter table public.csv_imports add column if not exists trabajando_hasta timestamptz;
alter table public.csv_imports add column if not exists empezada_at timestamptz;
alter table public.csv_imports add column if not exists error text;
alter table public.csv_imports add column if not exists intentos integer not null default 0;
alter table public.csv_imports add column if not exists aviso_enviado_at timestamptz;
alter table public.csv_imports add column if not exists etiquetas_creadas text[] not null default '{}';

alter table public.csv_imports drop constraint if exists csv_imports_estado_check;
alter table public.csv_imports
  add constraint csv_imports_estado_check check (estado in ('subiendo', 'en_cola', 'en_curso', 'terminada', 'fallida'));

comment on column public.csv_imports.en_segundo_plano is 'F37: true si se procesa después de responder (más de 500 filas).';
comment on column public.csv_imports.procesadas is 'F37: filas ya procesadas, para la barra de progreso.';
comment on column public.csv_imports.lotes is 'F37: cuántas tandas de csv_import_lotes tiene la importación.';
comment on column public.csv_imports.opciones is 'F37: el mapeo, el código de país, la asignación y la etiqueta de origen elegidos en la pantalla.';
comment on column public.csv_imports.lineas is 'F37: el detalle del resumen (número de fila, nombre y qué pasó), hasta 2000.';
comment on column public.csv_imports.trabajando_hasta is 'F37: hasta cuándo la reclamó un proceso. Vencida, la retoma la tarea programada.';
comment on column public.csv_imports.intentos is 'F37: cuántas veces falló el proceso en segundo plano; a la tercera queda fallida.';
comment on column public.csv_imports.aviso_enviado_at is 'F37: cuándo salió el correo de fin de importación (una sola vez).';

create index if not exists idx_csv_imports_pendientes on public.csv_imports (estado) where estado in ('en_cola', 'en_curso');

create table if not exists public.csv_import_lotes (
  import_id uuid not null references public.csv_imports(id) on delete cascade,
  numero integer not null,
  filas jsonb not null,
  cantidad integer not null default 0,
  procesado_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (import_id, numero)
);

alter table public.csv_import_lotes add column if not exists cantidad integer not null default 0;

alter table public.csv_import_lotes enable row level security;

comment on table public.csv_import_lotes is
  'F37: las tandas de hasta 500 filas de una importación en segundo plano, con las celdas crudas. Solo el servidor (clave de servicio); seguridad por filas activada y sin políticas.';

alter table email_log drop constraint if exists email_log_tipo_check;
alter table email_log add constraint email_log_tipo_check check (tipo in (
  'invitacion',
  'alerta_webhook',
  'sesion_whatsapp',
  'importacion'
));
