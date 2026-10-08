#!/usr/bin/env node
/**
 * Verificación de F31: el historial de auditoría, contra la base real.
 *
 * Lo que prueba, con tokens reales y por PostgREST (no por la app):
 *   - Owner y Admin ven todo el historial de su espacio; un Member, solo sus
 *     propias acciones; alguien de otro espacio, nada.
 *   - Nadie escribe desde afuera: un Member no inserta, no edita y no borra.
 *   - Nunca se elimina: ni siquiera la clave de servicio puede editar ni borrar
 *     una fila. Lo hace cumplir un trigger, que también frena TRUNCATE.
 *   - La lista de acciones es cerrada: una acción inventada se rechaza.
 *   - Los índices por espacio, por entidad y por fecha existen.
 *
 * CONTROLES POSITIVOS. Que un Member "no vea" no prueba nada si nadie ve nada:
 * el Owner tiene que ver las tres filas. Que el borrado "no funcione" no prueba
 * nada si la fila nunca existió: primero se comprueba que el insert entró, y
 * después del intento de borrado, que la fila sigue ahí con su texto original.
 *
 * ESTADO ESPERADO: falla antes de la 00028 (la tabla no existe) y pasa después.
 *
 * Escenario, en espacios fantasma (ver `lib-verificador.mjs`): nada de esto
 * toca el espacio real. Las filas de auditoría que deja quedan huérfanas al
 * borrarse el espacio, porque la tabla no se puede limpiar.
 *
 * Uso: node scripts/verify-auditoria.mjs
 */
import {
  admin, comoUsuario, catalogo, check, noConcluyente, correr,
  crearUsuario, sumarAlEspacio, sufijo,
} from "./lib-verificador.mjs";

const fila = (espacio, actor, etiqueta) => ({
  workspace_id: espacio,
  actor_id: actor?.id ?? null,
  actor_label: actor ? actor.email : "Sistema",
  action: "configuracion.cambiada",
  entity_type: "espacio",
  entity_id: espacio,
  entity_label: etiqueta,
  changes: {},
  detail: { verificador: sufijo },
});

await correr(async () => {
  console.log("Escenario");
  const owner = await crearUsuario("owner");
  const member = await crearUsuario("member");
  const otro = await crearUsuario("otro");
  const ajeno = await crearUsuario("ajeno");
  const adminU = await crearUsuario("admin");
  const W = owner.espacio;
  await sumarAlEspacio(W, adminU, "admin");
  await sumarAlEspacio(W, member, "member");
  await sumarAlEspacio(W, otro, "member");
  console.log(`  espacio de prueba ${W}\n`);

  // ── Control previo: la tabla existe y el servidor puede escribir ─────────
  console.log("Escritura del servidor");
  const ins = await admin("audit_log", {
    method: "POST",
    body: JSON.stringify([
      fila(W, member, `del-member-${sufijo}`),
      fila(W, otro, `del-otro-${sufijo}`),
      fila(W, null, `del-sistema-${sufijo}`),
      fila(ajeno.espacio, ajeno, `del-ajeno-${sufijo}`),
    ]),
  });
  const tablaOk = check(ins.status === 201 && ins.data?.length === 4,
    "la clave de servicio inserta en audit_log (control positivo de todo lo que sigue)",
    `HTTP ${ins.status}: ${JSON.stringify(ins.data).slice(0, 200)}`);
  if (!tablaOk) {
    noConcluyente("lectura por rol, inmutabilidad y vocabulario", "no hay filas contra las cuales probar");
    return;
  }
  const idMember = ins.data[0].id;

  const inventada = await admin("audit_log", {
    method: "POST",
    body: JSON.stringify({ ...fila(W, null, "x"), action: "contacto.inventado" }),
  });
  check(inventada.status === 400 && inventada.data?.code === "23514",
    "una acción fuera de la lista cerrada se rechaza (check)", `HTTP ${inventada.status} ${inventada.data?.code}`);

  // ── Lectura por rol ──────────────────────────────────────────────────────
  console.log("\nLectura por rol");
  const q = `audit_log?select=entity_label&workspace_id=eq.${W}&detail->>verificador=eq.${sufijo}`;
  const delOwner = await comoUsuario(owner.token, q);
  const etiquetasOwner = (delOwner.data ?? []).map((r) => r.entity_label).sort();
  const ownerVeTodo = check(etiquetasOwner.length === 3,
    "el Owner ve las tres filas de su espacio (control positivo)", JSON.stringify(etiquetasOwner));

  const delAdmin = await comoUsuario(adminU.token, q);
  check((delAdmin.data ?? []).length === 3, "el Admin también ve las tres", JSON.stringify(delAdmin.data));

  const delMember = await comoUsuario(member.token, q);
  const etiquetasMember = (delMember.data ?? []).map((r) => r.entity_label);
  if (ownerVeTodo) {
    check(etiquetasMember.length === 1 && etiquetasMember[0] === `del-member-${sufijo}`,
      "el Member ve solo su propia acción, no la de otro Member ni la del Sistema", JSON.stringify(etiquetasMember));
  } else {
    noConcluyente("el Member ve solo lo suyo", "el Owner no vio las tres filas");
  }

  const delAjeno = await comoUsuario(ajeno.token, `audit_log?select=entity_label&detail->>verificador=eq.${sufijo}`);
  const etiquetasAjeno = (delAjeno.data ?? []).map((r) => r.entity_label);
  check(etiquetasAjeno.length === 1 && etiquetasAjeno[0] === `del-ajeno-${sufijo}`,
    "alguien de otro espacio ve solo lo de su espacio (y sí ve lo suyo)", JSON.stringify(etiquetasAjeno));

  // ── Nadie escribe desde afuera ───────────────────────────────────────────
  console.log("\nEscritura de usuarios");
  const insMember = await comoUsuario(member.token, "audit_log", {
    method: "POST",
    body: JSON.stringify(fila(W, member, `forjada-${sufijo}`)),
  });
  const forjada = await admin(`audit_log?select=id&entity_label=eq.forjada-${sufijo}`);
  check(insMember.status >= 400 && (forjada.data ?? []).length === 0,
    "un Member no puede insertar en el historial", `HTTP ${insMember.status}`);

  await comoUsuario(member.token, `audit_log?id=eq.${idMember}`, {
    method: "PATCH",
    body: JSON.stringify({ entity_label: "editada" }),
  });
  await comoUsuario(member.token, `audit_log?id=eq.${idMember}`, { method: "DELETE" });
  const trasMember = await admin(`audit_log?select=entity_label&id=eq.${idMember}`);
  check(trasMember.data?.[0]?.entity_label === `del-member-${sufijo}`,
    "un Member no puede editar ni borrar ni su propia fila", JSON.stringify(trasMember.data));

  // ── Nunca se elimina, ni con la clave de servicio ────────────────────────
  console.log("\nInmutabilidad");
  const upd = await admin(`audit_log?id=eq.${idMember}`, {
    method: "PATCH",
    body: JSON.stringify({ entity_label: "editada" }),
  });
  const del = await admin(`audit_log?id=eq.${idMember}`, { method: "DELETE" });
  const trasServicio = await admin(`audit_log?select=entity_label&id=eq.${idMember}`);
  check(upd.status >= 400, "la clave de servicio no puede editar una fila", `HTTP ${upd.status}`);
  check(del.status >= 400, "la clave de servicio no puede borrar una fila", `HTTP ${del.status}`);
  check(trasServicio.data?.[0]?.entity_label === `del-member-${sufijo}`,
    "la fila sigue ahí, con su texto original", JSON.stringify(trasServicio.data));

  // ── Catálogo: TRUNCATE, índices, columnas de borrado ─────────────────────
  console.log("\nCatálogo");
  const triggers = catalogo(
    "select tgname, tgtype from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal"
  );
  // tgtype: bit 5 (32) = TRUNCATE, bit 3 (8) = DELETE, bit 4 (16) = UPDATE.
  const tipos = triggers.reduce((acc, t) => acc | Number(t.tgtype), 0);
  check((tipos & 32) !== 0, "hay un trigger que frena TRUNCATE", JSON.stringify(triggers));
  check((tipos & 8) !== 0 && (tipos & 16) !== 0, "hay un trigger que frena UPDATE y DELETE");

  const indices = catalogo("select indexdef from pg_indexes where schemaname = 'public' and tablename = 'audit_log'")
    .map((r) => r.indexdef);
  check(indices.some((d) => /\(workspace_id, created_at DESC\)/.test(d)), "índice por espacio de trabajo", indices.join(" | "));
  check(indices.some((d) => /\(entity_type, entity_id\)/.test(d)), "índice por entidad");
  check(indices.some((d) => /\(created_at\)/.test(d)), "índice por fecha");

  const columnas = catalogo(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'audit_log'"
  ).map((r) => r.column_name);
  check(!columnas.includes("deleted_at"), "no tiene borrado suave (no hay deleted_at)", columnas.join(", "));

  const fks = catalogo(
    "select conname from pg_constraint where conrelid = 'public.audit_log'::regclass and contype = 'f'"
  );
  check(fks.length === 0, "no tiene claves foráneas: borrar un contacto o un espacio no arrastra el historial",
    JSON.stringify(fks));
});
