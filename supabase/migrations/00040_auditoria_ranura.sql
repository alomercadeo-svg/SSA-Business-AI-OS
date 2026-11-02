-- ============================================================
-- EL EVENTO «RANURA ACTUALIZADA» DEL HISTORIAL (retrabajo de F26)
-- ============================================================
-- Cuando la misma cuenta vuelve de Zernio con otra ranura (`_id`), la
-- sincronización le cambia `late_account_id` a su fila en vez de crear otra
-- (`b4470a3`, 08/10/2026). Esa rama no dejaba rastro. Desde el 02/11/2026 queda
-- en `audit_log` como «canal.ranura_actualizada», con la ranura anterior y la
-- nueva: la primera fila de estas en producción es el disparador para tildar
-- el criterio de la identidad del canal.
--
-- Misma forma que la 00036: reemplaza el `check` con la lista de la 00039 más
-- «canal.ranura_actualizada», y nada más. No toca filas: solo amplía lo que se
-- acepta, así que ninguna fila existente puede quedar fuera del `check` nuevo.
--
-- Idempotente: `drop ... if exists` y vuelta a crear.
-- ============================================================

alter table audit_log drop constraint if exists audit_log_action_check;
alter table audit_log add constraint audit_log_action_check check (action in (
  'contacto.creado',
  'contacto.editado',
  'contacto.reconciliado',
  'contacto.fusionado',
  'contacto.asignado',
  'contacto.eliminado',
  'contacto.restaurado',
  'contacto.vinculado',
  'canal.conectado',
  'canal.desconectado',
  'canal.error',
  'canal.reemplazado',
  'canal.ranura_actualizada',
  'configuracion.cambiada',
  'equipo.invitado',
  'equipo.invitacion_revocada',
  'equipo.ingreso',
  'equipo.rol_cambiado',
  'equipo.removido'
));
