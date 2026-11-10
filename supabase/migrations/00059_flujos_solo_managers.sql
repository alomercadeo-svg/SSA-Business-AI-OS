-- ============================================================
-- 00059: ESCRIBIR FLUJOS ES DE OWNER Y ADMIN (1b; ítem 4 de la sesión de cierre, 10/11/2026)
-- ============================================================
-- §15 del plano, «El Member puede crear y publicar flujos del fork»: la
-- política de escritura de `flows` (00002:212-214) y la de `triggers`
-- (00002:231-239) son `is_workspace_member`, y la de alta de `flow_versions`
-- (00010) también. Un flujo publicado corre con la clave de servicio ante los
-- mensajes de cualquier contacto, así que un Member podría hacer que el
-- sistema les escriba a leads fuera de su alcance.
--
-- Esta migración deja la LECTURA como estaba (cualquier miembro) y pasa la
-- ESCRITURA (alta, cambio y borrado) a `is_workspace_manager`. Las rutas
-- `app/api/v1/flows/**` ya devuelven 403 a un Member desde el mismo ítem; esto
-- es la misma regla en la base. Al 10/11/2026 (copia de las 17:49) hay 0
-- flujos, 0 disparadores y 0 versiones: no cambia nada que exista.
--
-- Idempotente: cada política se borra si existe y se vuelve a crear.

drop policy if exists "Users can manage flows in their workspaces" on public.flows;
drop policy if exists "flows: escribir, solo Owner y Admin (alta)" on public.flows;
drop policy if exists "flows: escribir, solo Owner y Admin (cambio)" on public.flows;
drop policy if exists "flows: escribir, solo Owner y Admin (borrado)" on public.flows;
create policy "flows: escribir, solo Owner y Admin (alta)"
  on public.flows for insert to authenticated
  with check (public.is_workspace_manager(workspace_id));
create policy "flows: escribir, solo Owner y Admin (cambio)"
  on public.flows for update to authenticated
  using (public.is_workspace_manager(workspace_id))
  with check (public.is_workspace_manager(workspace_id));
create policy "flows: escribir, solo Owner y Admin (borrado)"
  on public.flows for delete to authenticated
  using (public.is_workspace_manager(workspace_id));

drop policy if exists "Users can manage triggers via flow" on public.triggers;
drop policy if exists "triggers: escribir, solo Owner y Admin" on public.triggers;
create policy "triggers: escribir, solo Owner y Admin"
  on public.triggers for all to authenticated
  using (exists (select 1 from public.flows f where f.id = triggers.flow_id and public.is_workspace_manager(f.workspace_id)))
  with check (exists (select 1 from public.flows f where f.id = triggers.flow_id and public.is_workspace_manager(f.workspace_id)));

drop policy if exists "flow_versions_insert" on public.flow_versions;
create policy "flow_versions_insert"
  on public.flow_versions for insert to authenticated
  with check (exists (select 1 from public.flows f where f.id = flow_versions.flow_id and public.is_workspace_manager(f.workspace_id)));
