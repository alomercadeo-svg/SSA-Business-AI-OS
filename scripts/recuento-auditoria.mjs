/**
 * `audit_log` por espacio y por acción, para `scripts/recuento-base.mjs`.
 * Aparte del script porque el script consulta la base apenas se abre, y esto
 * se testea sin conexión (`scripts/recuento-auditoria.test.ts`).
 */

export const SQL_AUDIT_ACCIONES = `
select case when to_regclass('public.audit_log') is null then null
  else (select json_agg(row_to_json(q) order by q.espacio, q.accion) from (
    select coalesce(e.name, '(sin espacio o espacio borrado)') as espacio, a.action as accion, count(*)::int as n,
      max(a.created_at) as ultima
    from public.audit_log a left join public.workspaces e on e.id = a.workspace_id group by 1, 2
  ) q) end as r
`;

/**
 * Las líneas que imprime el recuento, una por espacio y acción: cantidad y
 * hora de la última, nada más. Hasta el 19/10/2026 imprimía también la
 * etiqueta de la última fila, que en «contacto.creado» es el nombre de un lead
 * real: contenido, en un recuento que se presenta como sin contenido. Si una
 * fila llega con más campos, no se imprimen.
 */
export function lineasPorAccion(filas) {
  return (filas ?? []).map((a) => `    ${a.espacio} · ${a.accion}: ${a.n} (última ${a.ultima})`);
}
