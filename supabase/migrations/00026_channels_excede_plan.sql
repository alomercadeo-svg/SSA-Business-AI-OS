-- ============================================================
-- UNA CUENTA QUE EXCEDE EL PLAN DE ZERNIO NO SE DESACTIVA (§15, 06/10/2026)
-- ============================================================
-- Antes, la sincronización pedía las cuentas a Zernio sin `includeOverLimit`,
-- así que una cuenta de un perfil que excede el límite del plan no venía en la
-- lista y su canal se desactivaba. Ahora se piden todas, y el exceso de plan es
-- un estado propio del canal: se muestra en su tarjeta y no lo desactiva.
--
-- La marca la escribe solo `POST /api/v1/channels/sync`, a partir de
-- `Profile.isOverLimit` del SDK de Zernio. Los canales de Evolution la tienen
-- siempre en false.
--
-- Idempotente: solo agrega una columna con valor por defecto, y el código
-- anterior a esta migración no la lee.
alter table channels
  add column if not exists excede_plan_zernio boolean not null default false;

comment on column channels.excede_plan_zernio is
  'La cuenta de Zernio es de un perfil que excede el límite del plan (Profile.isOverLimit). No desactiva el canal. Si una cuenta excedida sigue recibiendo mensajes no está verificado.';
