-- ============================================================
-- EL EVENTO «ASIGNADO» DEL HISTORIAL (F41)
-- ============================================================
-- F41 asigna setter y vendedor desde la interfaz, y cada cambio queda en
-- `audit_log` como «contacto.asignado», con el valor anterior y el nuevo
-- (criterio de F41, que cita a F31).
--
-- La lista de acciones de `audit_log` es cerrada (00028): un evento nuevo
-- necesita reemplazar el `check`. Esta migración lo reemplaza con la misma
-- lista de la 00028 más «contacto.asignado», y nada más. Los eventos que faltan
-- los suma cada funcionalidad en su propia migración: eliminado y restaurado
-- (F30), no contactar (F34), importaciones (F37).
--
-- No toca filas: solo amplía lo que se acepta, así que ninguna fila existente
-- puede quedar fuera del `check` nuevo.
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
  'canal.conectado',
  'canal.desconectado',
  'canal.error',
  'canal.reemplazado',
  'configuracion.cambiada',
  'equipo.invitado',
  'equipo.invitacion_revocada',
  'equipo.ingreso',
  'equipo.rol_cambiado',
  'equipo.removido'
));
