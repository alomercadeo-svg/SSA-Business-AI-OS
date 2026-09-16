-- ============================================================
-- WORKSPACE_MEMBERS: UN MANAGER VE A TODO SU EQUIPO
-- ============================================================
-- La 00019 le dio al manager una policy de UPDATE sobre `workspace_members`
-- para que pudiera cambiar el rol de un miembro. No alcanzaba, y el modo de
-- fallar era silencioso.
--
-- POR QUÉ: Postgres aplica también las policies de SELECT cuando un UPDATE o un
-- DELETE referencia columnas de la tabla, y PostgREST siempre arma un WHERE. La
-- policy de SELECT que trae el fork es `user_id = auth.uid()`: cada quien ve
-- solo su propia fila. Entonces un Owner que intentaba cambiarle el rol a otra
-- persona no veía esa fila, el UPDATE afectaba cero filas, y PostgREST
-- respondía 204 igual. Éxito aparente, rol sin cambiar.
--
-- Encontrado probando con un Member invitado de verdad: la comprobación "un
-- Manager SÍ puede cambiar el rol de un miembro" devolvía 204 y el rol seguía
-- en 'member'. La policy de UPDATE de la 00019 era letra muerta.
--
-- EL ARREGLO: que el manager vea las membresías de su workspace. Además de
-- destrabar el UPDATE, es lo correcto por sí solo: la pantalla de equipo ya
-- muestra ese listado, y hoy tiene que armarlo con el service client porque la
-- RLS no se lo permite.
--
-- POR QUÉ NO HAY RECURSIÓN: el comentario del fork en la 00002 advierte que
-- consultar `workspace_members` desde su propia policy vuelve a disparar la
-- RLS. Por eso la rama nueva no consulta la tabla directamente: llama a
-- `is_workspace_manager`, que es `security definer` y corre como el dueño de la
-- tabla, que no está sujeto a RLS. Es el mismo mecanismo que ya usan
-- `is_workspace_member` y las funciones del scope de leads.
--
-- Lo que NO cambia: quién puede escribir. El UPDATE sigue siendo de manager
-- (00019) y el DELETE sigue siendo solo del Owner (00002). Esto es únicamente
-- lectura.
--
-- Idempotente: `drop policy if exists` + `create policy`.
-- ============================================================

drop policy if exists "Members can view their workspace memberships" on workspace_members;

create policy "workspace_members: la propia fila, y el equipo si sos manager"
  on workspace_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_workspace_manager(workspace_id)
  );
