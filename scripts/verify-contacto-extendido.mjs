#!/usr/bin/env node
/**
 * Verificación de F25 y de las columnas de §7.1, contra la base real.
 *
 * F25 (00029):
 *   - las columnas nuevas existen, con sus valores por defecto;
 *   - el teléfono no es obligatorio, y si está, es E.164 (la base lo hace
 *     cumplir: §14, "+, código de país y número, solo dígitos, hasta 15");
 *   - `phone_resolved` no puede ser falso con un teléfono cargado;
 *   - `display_name_source` y `lead_temperature` aceptan solo su lista;
 *   - `next_followup_date` es fecha, sin hora;
 *   - `attribution.first_click` se escribe una vez y no se modifica más,
 *     mientras `last_click` sí se actualiza;
 *   - los índices pedidos existen.
 * §7.1 (00030), columnas sin criterio propio todavía:
 *   - `pipeline_stage`, `deal_status` y `booking_status` aceptan cada valor de
 *     su lista y rechazan uno de afuera; `deal_currency` no tiene restricción.
 *
 * UNA PRUEBA POR RESTRICCIÓN, CON LAS DOS MITADES. Que la base rechace un valor
 * de afuera no distingue una restricción bien escrita de una que rechaza todo:
 * por eso cada una prueba primero que un valor de la lista entra.
 *
 * Las 13 etapas se leen de §7.1 del plano, no de una copia acá: tienen que
 * coincidir carácter por carácter con el export de Pipedrive, y el plano es
 * donde se escribieron.
 *
 * ESTADO ESPERADO: falla antes de la 00029 y la 00030, y pasa después.
 *
 * Escenario en un espacio fantasma (ver `lib-verificador.mjs`).
 *
 * Uso: node scripts/verify-contacto-extendido.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { admin, catalogo, check, noConcluyente, correr, crearUsuario, crearContacto } from "./lib-verificador.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const plano = readFileSync(resolve(__dirname, "../docs/requerimientos-fase1.md"), "utf8");
const bloque = plano.split("**Los trece valores de `pipeline_stage`**")[1]?.split("```")[1] ?? "";
const ETAPAS = bloque.split("\n").map((l) => l.trim()).filter(Boolean);

const RECHAZO = "23514"; // check_violation

async function intentar(id, campos) {
  return admin(`contacts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(campos) });
}

const entra = (r) => r.status >= 200 && r.status < 300 && Array.isArray(r.data) && r.data.length === 1;
const rechazada = (r) => r.status === 400 && r.data?.code === RECHAZO;

/** Las dos mitades de una restricción: lo de la lista entra, lo de afuera no. */
async function restriccion(id, campo, validos, invalido) {
  let todosEntran = true;
  for (const v of validos) {
    const r = await intentar(id, { [campo]: v });
    if (!entra(r)) {
      todosEntran = false;
      check(false, `${campo} acepta «${v}»`, `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    }
  }
  if (todosEntran) check(true, `${campo} acepta ${validos.length === 1 ? `«${validos[0]}»` : `los ${validos.length} valores de su lista`}`);
  if (invalido === undefined) return;
  if (!todosEntran) {
    noConcluyente(`${campo} rechaza «${invalido}»`, "ni siquiera entraron los valores válidos");
    return;
  }
  const r = await intentar(id, { [campo]: invalido });
  check(rechazada(r), `${campo} rechaza «${invalido}»`, `HTTP ${r.status} ${r.data?.code ?? ""}`);
}

await correr(async () => {
  check(ETAPAS.length === 13, "§7.1 del plano tiene 13 etapas", JSON.stringify(ETAPAS));

  console.log("\nEscenario");
  const owner = await crearUsuario("owner");
  const W = owner.espacio;

  // ── Control positivo: un contacto sin teléfono entra, con los defaults ───
  console.log("\nF25: columnas y valores por defecto");
  let c;
  try {
    c = await crearContacto(W, {});
  } catch (err) {
    check(false, "se crea un contacto de prueba", String(err));
    return;
  }
  const { data: leido } = await admin(
    `contacts?id=eq.${c.id}&select=phone,phone_resolved,do_not_contact,attribution,display_name_source,deleted_at,next_followup_date,lead_temperature,secondary_email,country,whatsapp_phone,do_not_contact_reason,do_not_contact_at,ai_conversation_summary`
  );
  const fila = Array.isArray(leido) ? leido[0] : null;
  const columnasOk = check(Boolean(fila), "las 14 columnas de F25 existen (control positivo de todo lo que sigue)", JSON.stringify(leido).slice(0, 200));
  if (!columnasOk) {
    noConcluyente("restricciones de F25 y §7.1", "las columnas no existen");
    return;
  }
  check(fila.phone === null, "el teléfono no es obligatorio: el contacto entra sin teléfono");
  check(fila.phone_resolved === true, "phone_resolved arranca en true (nada pendiente)");
  check(fila.do_not_contact === false, "do_not_contact arranca en false");
  check(JSON.stringify(fila.attribution) === "{}", "attribution arranca en '{}'", JSON.stringify(fila.attribution));
  check(fila.display_name_source === "provider", "display_name_source arranca en provider");

  // ── Teléfono E.164 ───────────────────────────────────────────────────────
  console.log("\nF25: teléfono en E.164");
  await restriccion(c.id, "phone", ["+50670349182", "+1", "+123456789012345"], "8856-12");
  for (const malo of ["+0123456", "50670349182", "+506 7034 9182", "+1234567890123456"]) {
    const r = await intentar(c.id, { phone: malo });
    check(rechazada(r), `phone rechaza «${malo}»`, `HTTP ${r.status} ${r.data?.code ?? ""}`);
  }
  await restriccion(c.id, "whatsapp_phone", ["+50688561234"], "+506-8856-1234");

  console.log("\nF25: phone_resolved");
  await intentar(c.id, { phone: null });
  const sinResolver = await intentar(c.id, { phone_resolved: false });
  const sinResolverOk = check(entra(sinResolver), "un contacto sin teléfono puede quedar sin resolver");
  const contradiccion = await intentar(c.id, { phone: "+50670349182", phone_resolved: false });
  if (sinResolverOk) check(rechazada(contradiccion), "no puede tener teléfono y estar sin resolver a la vez");
  else noConcluyente("teléfono y sin resolver a la vez", "no entró ni el caso válido");
  await intentar(c.id, { phone_resolved: true, phone: null });

  console.log("\nF25: listas cerradas");
  await restriccion(c.id, "display_name_source", ["provider", "manual"], "importado");
  await restriccion(c.id, "lead_temperature", ["frio", "tibio", "caliente", null], "templado");

  console.log("\nF25: próximo seguimiento, fecha sin hora");
  const conHora = await intentar(c.id, { next_followup_date: "2026-10-08T23:30:00-06:00" });
  check(entra(conHora) && conHora.data[0].next_followup_date === "2026-10-08",
    "next_followup_date guarda la fecha y descarta la hora", JSON.stringify(conHora.data?.[0]?.next_followup_date));
  const tipo = catalogo(
    "select data_type from information_schema.columns where table_schema='public' and table_name='contacts' and column_name='next_followup_date'"
  );
  check(tipo[0]?.data_type === "date", "en el catálogo es date", JSON.stringify(tipo));

  // ── Atribución ───────────────────────────────────────────────────────────
  console.log("\nF25: atribución");
  const primero = { source: "meta", campaign: "octubre", captured_at: "2026-10-01T10:00:00Z" };
  const r1 = await intentar(c.id, { attribution: { first_click: primero, last_click: primero } });
  const primeroOk = check(entra(r1), "el primer first_click se escribe (control positivo)");
  const otro = { source: "google", campaign: "x", captured_at: "2026-10-05T10:00:00Z" };
  const r2 = await intentar(c.id, { attribution: { first_click: primero, last_click: otro } });
  check(entra(r2) && r2.data[0].attribution.last_click.source === "google", "last_click se actualiza");
  const r3 = await intentar(c.id, { attribution: { first_click: otro, last_click: otro } });
  const r4 = await intentar(c.id, { attribution: { last_click: otro } });
  if (primeroOk) {
    check(r3.status >= 400, "sobrescribir first_click se rechaza", `HTTP ${r3.status}`);
    check(r4.status >= 400, "borrar first_click también se rechaza", `HTTP ${r4.status}`);
    const { data: final } = await admin(`contacts?id=eq.${c.id}&select=attribution`);
    check(final?.[0]?.attribution?.first_click?.source === "meta", "first_click sigue siendo el original");
  } else {
    noConcluyente("first_click inmutable", "ni siquiera entró el primero");
  }
  const noObjeto = await intentar(c.id, { attribution: [] });
  check(noObjeto.status >= 400, "attribution tiene que ser un objeto", `HTTP ${noObjeto.status}`);

  // ── Índices ──────────────────────────────────────────────────────────────
  console.log("\nF25: índices");
  const idx = catalogo(
    "select tablename, indexdef from pg_indexes where schemaname='public' and tablename in ('contacts','contact_channels')"
  ).map((r) => r.indexdef);
  for (const [desc, re] of [
    ["teléfono", /contacts USING btree \(phone\)/],
    ["correo", /contacts USING btree \(email\)/],
    ["marca de borrado", /contacts USING btree \(deleted_at\)/],
    ["espacio y teléfono", /contacts USING btree \(workspace_id, phone\)/],
    ["espacio y correo", /contacts USING btree \(workspace_id, email\)/],
    ["contact_channels.platform_username", /contact_channels USING btree \(platform_username\)/],
  ]) {
    check(idx.some((d) => re.test(d)), `índice por ${desc}`);
  }

  // ── §7.1 ─────────────────────────────────────────────────────────────────
  console.log("\n§7.1: estado comercial y agenda (sin criterio propio en esta sesión)");
  await restriccion(c.id, "pipeline_stage", ETAPAS, "Negociación");
  const sinSigno = await intentar(c.id, { pipeline_stage: "4. Es mi cliente?" });
  check(rechazada(sinSigno), "pipeline_stage rechaza la etapa 4 sin los signos de pregunta");
  await restriccion(c.id, "deal_status", ["abierto", "ganado", "perdido"], "cerrado");
  await restriccion(c.id, "booking_status", ["sin_agendar", "agendada", "asistio", "no_asistio", "cancelada"], "pendiente");
  await restriccion(c.id, "deal_currency", ["USD", "CRC", "MXN"]);
  const resto = await intentar(c.id, {
    deal_value: 150.5, deal_closed_at: "2026-10-01", pipedrive_person_id: "123", pipedrive_deal_id: "456",
    booking_at: "2026-10-10T15:00:00Z", booking_external_id: "cal-1",
  });
  check(entra(resto), "deal_value, deal_closed_at, pipedrive_*, booking_at y booking_external_id existen");
});
