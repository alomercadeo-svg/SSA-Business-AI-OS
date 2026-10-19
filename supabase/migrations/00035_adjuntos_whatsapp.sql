-- ============================================================
-- ADJUNTOS DE WHATSAPP (F28, parte B)
-- ============================================================
-- WhatsApp no manda una dirección para bajar el archivo: manda el mensaje con
-- su clave de descifrado (`mediaKey`), y el archivo se le pide a nuestro
-- Evolution con `POST /chat/getBase64FromMediaMessage/{instancia}`, pasándole
-- el mensaje entero (`whatsapp.baileys.service.ts` de 2.3.7, 3837-3845: con el
-- mensaje entero no consulta su base). Para que el REINTENTO pueda volver a
-- pedirlo, el mensaje se guarda acá hasta que el archivo quede bajado o pase a
-- `no_disponible`, y entonces se borra.
--
-- POR QUÉ UNA TABLA APARTE Y NO UNA COLUMNA DE `messages`. La lectura de
-- `messages` es por fila (00019): quien ve el mensaje ve todas sus columnas, y
-- la clave de descifrado no puede quedar donde un usuario la lea con su propio
-- token. Esta tabla tiene la seguridad por filas activa y NINGUNA política, y
-- además se le quitan los permisos a `anon` y `authenticated`: solo la clave de
-- servicio la lee y la escribe. Tampoco va a la publicación de Realtime.
--
-- POR QUÉ NO DEPENDER DE LA BASE DE EVOLUTION. Con solo la `key`, Evolution
-- busca el mensaje en su Postgres, que lo tiene solo con
-- `DATABASE_SAVE_DATA_NEW_MESSAGE=true`; `docs/despliegue-evolution.md` deja
-- anotada la decisión de apagar ese guardado más adelante. Depender de él
-- ataría las dos decisiones en silencio.
--
-- Qué se guarda: la `key` del mensaje y `message[tipo]`, nada más. Nunca el
-- `pushName`, la `apikey` ni el cuerpo del aviso. Si el mensaje se borra (la
-- purga de F30), la fila se va en cascada.
--
-- Idempotente: la tabla se crea solo si no existe; activar la seguridad por filas y
-- quitar permisos se puede repetir sin efecto.

create table if not exists whatsapp_adjuntos_por_bajar (
  message_id uuid primary key references messages(id) on delete cascade,
  mensaje jsonb not null,
  created_at timestamptz not null default now()
);

alter table whatsapp_adjuntos_por_bajar enable row level security;

revoke all on table whatsapp_adjuntos_por_bajar from anon, authenticated;

comment on table whatsapp_adjuntos_por_bajar is
  'El mensaje de WhatsApp (key y message[tipo], con la clave de descifrado) para que el reintento de F28 le pida el archivo a Evolution. Sin políticas: solo la clave de servicio. Se borra al bajar el archivo o al pasar a no_disponible.';
