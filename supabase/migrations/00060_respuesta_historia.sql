-- ============================================================
-- 00060: «RESPONDIÓ A TU HISTORIA» (F44, criterio 3; ítem 5 de la sesión de cierre, 10/11/2026)
-- ============================================================
-- Columna nueva en `messages`, no una marca dentro de `attachments` (decidido
-- por Marcos el 06/11/2026). Guarda `{ storyId, storyUrl }`: la forma real de
-- `metadata.storyReply` leída el 10/11/2026 en una entrega del registro de
-- Zernio. En la importación del historial, el listado trae solo un sí o no, y
-- se guarda `{ storyId: null, storyUrl: null }`. No se guarda la imagen.
--
-- La escriben el receptor de Zernio y la importación; la leen el hilo y la
-- vista previa. Sin políticas nuevas: hereda las de `messages`. Nula en todos
-- los mensajes que ya existen. Idempotente.

alter table public.messages add column if not exists respuesta_historia jsonb;

comment on column public.messages.respuesta_historia is
  'F44: si el mensaje responde a una historia de Instagram, { storyId, storyUrl } (storyUrl del CDN de Meta, vence a las ~24 h). Nulo si no. No se guarda la imagen.';
