#!/usr/bin/env node
/**
 * F34, ítem 8 del plan maestro (06/11/2026): no contactar.
 *
 * En un espacio fantasma nuevo, con un Owner y un Member. Cada contacto se usa
 * en un solo paso, así un paso no marca ni desmarca al de otro.
 *
 * Parte 1, la base (la 00053):
 *   1. La lista de frases de baja existe y viene cargada con las del criterio.
 *   2. Un marcado no entra a una secuencia; control: uno sin marca, sí.
 *   3. Un Member no revierte la marca de su contacto; controles: el Member sí
 *      edita otro dato del mismo contacto (la edición le llega), y el Owner sí
 *      la revierte.
 *
 * Qué cambia cada paso: el 2 crea dos inscripciones (de dos contactos que no
 * se usan después); el 3 edita un contacto que no se usa después. Ninguno
 * toca lo que mira otro.
 *
 * Uso: node scripts/verify-no-contactar.mjs
 */
import { admin, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, sufijo, sumarAlEspacio } from "./lib-verificador.mjs";

const FRASES = ["no me escribas más", "dejá de mandar mensajes", "no quiero recibir mensajes", "stop", "unsubscribe", "basta", "no me contactes"];
let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

await correr(async () => {
  const owner = await crearUsuario("nocontactar-owner");
  const member = await crearUsuario("nocontactar-member");
  const espacio = owner.espacio;
  await sumarAlEspacio(espacio, member, "member");

  titulo("La lista de frases de baja del espacio");
  const ws = await admin(`workspaces?select=frases_de_baja&id=eq.${espacio}`);
  const frases = ws.data?.[0]?.frases_de_baja;
  check(ws.status === 200 && Array.isArray(frases), "la columna existe y es una lista", `HTTP ${ws.status} ${JSON.stringify(ws.data).slice(0, 160)}`);
  check(Array.isArray(frases) && FRASES.every((f) => frases.includes(f)) && frases.length === FRASES.length, "viene cargada con las siete del criterio", JSON.stringify(frases));

  titulo("Un marcado no entra a una secuencia");
  const canal = await admin("channels", {
    method: "POST",
    body: JSON.stringify({ workspace_id: espacio, platform: "whatsapp", provider: "evolution", instance_name: `b3-nocontactar-${sufijo}`, is_active: false, umbral_silencio_horas: null }),
  });
  const canalId = canal.data?.[0]?.id;
  if (!canalId) throw new Error(`no se pudo crear el canal: HTTP ${canal.status}`);
  limpiar.canales.push(canalId);
  const secuencia = await admin("sequences", { method: "POST", body: JSON.stringify({ workspace_id: espacio, name: `b3-${sufijo}`, status: "active", steps: [] }) });
  const secuenciaId = secuencia.data?.[0]?.id;
  if (!secuenciaId) throw new Error(`no se pudo crear la secuencia: HTTP ${secuencia.status}`);
  const sinMarca = await crearContacto(espacio, { display_name: `b3-sin-marca-${sufijo}` });
  const marcado = await crearContacto(espacio, { display_name: `b3-marcado-${sufijo}`, do_not_contact: true, do_not_contact_reason: "prueba", do_not_contact_at: new Date().toISOString() });
  const alta = (contacto) =>
    admin("sequence_enrollments", { method: "POST", body: JSON.stringify({ sequence_id: secuenciaId, contact_id: contacto.id, channel_id: canalId }) });
  const control = await alta(sinMarca);
  check(control.status === 201, "control: un contacto sin marca entra (la inscripción funciona)", `HTTP ${control.status}`);
  const r = await alta(marcado);
  if (control.status !== 201) noConcluyente("el marcado no entra", "el control falló: no se sabe si la inscripción funciona");
  else check(r.status >= 400 && /no entra a una secuencia/.test(JSON.stringify(r.data)), "el marcado no entra, con el motivo", `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);

  titulo("Revertir la marca: solo Owner y Admin");
  const deMember = await crearContacto(espacio, { display_name: `b3-de-member-${sufijo}`, setter_id: member.id, do_not_contact: true, do_not_contact_reason: "prueba", do_not_contact_at: new Date().toISOString() });
  const editar = await comoUsuario(member.token, `contacts?id=eq.${deMember.id}`, { method: "PATCH", body: JSON.stringify({ display_name: `b3-editado-${sufijo}` }) });
  const editado = Array.isArray(editar.data) && editar.data.length === 1;
  check(editado, "control: el Member edita otro dato de su contacto (la edición le llega)", `HTTP ${editar.status} ${JSON.stringify(editar.data).slice(0, 120)}`);
  const revertir = await comoUsuario(member.token, `contacts?id=eq.${deMember.id}`, { method: "PATCH", body: JSON.stringify({ do_not_contact: false }) });
  const despues = await admin(`contacts?select=do_not_contact&id=eq.${deMember.id}`);
  if (!editado) noConcluyente("el Member no revierte", "el control falló: no se sabe si la edición le llega");
  else check(revertir.status === 403 && despues.data?.[0]?.do_not_contact === true, "el Member no revierte: 403 y la marca sigue", `HTTP ${revertir.status}, marca ${despues.data?.[0]?.do_not_contact}`);
  const porOwner = await comoUsuario(owner.token, `contacts?id=eq.${deMember.id}`, { method: "PATCH", body: JSON.stringify({ do_not_contact: false }) });
  const final = await admin(`contacts?select=do_not_contact&id=eq.${deMember.id}`);
  check(porOwner.status === 200 && final.data?.[0]?.do_not_contact === false, "control del rol: el Owner sí la revierte", `HTTP ${porOwner.status}, marca ${final.data?.[0]?.do_not_contact}`);
});
