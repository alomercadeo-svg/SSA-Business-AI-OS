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
 * Parte 2, el código desplegado (otro espacio fantasma, con un canal de
 * Instagram inventado y su secreto; los avisos son simulados y firmados por
 * nosotros: ninguna llamada a Zernio):
 *   4. Un aviso con «no me escribas más» marca al contacto; control: uno con
 *      «basta con que me mandes el link» no (la palabra suelta dentro de una
 *      oración no es baja, decisión del 06/11/2026), y el aviso se guardó.
 *   5. Escribirle al marcado desde la bandeja da 409 «no_contactar»; control:
 *      al otro, la ruta no responde eso (sigue hasta su portón siguiente,
 *      que corta antes de llamar a Zernio: el espacio fantasma no tiene clave
 *      de Zernio, «API key not configured», 400).
 *
 * Qué cambia cada paso: el 2 crea dos inscripciones (de dos contactos que no
 * se usan después); el 3 edita un contacto que no se usa después; el 4 crea
 * dos contactos, que el 5 lee y no cambia. Ninguno toca lo que mira otro.
 *
 * Uso: node scripts/verify-no-contactar.mjs
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { admin, check, comoUsuario, correr, crearContacto, crearUsuario, limpiar, noConcluyente, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const REF = new URL(URL_BASE).hostname.split(".")[0];
const SECRETO = randomBytes(32).toString("hex");
const CUENTA = `vnc${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const SOBRE = JSON.parse(readFileSync(new URL("../lib/fixtures/zernio-webhook-message-received.json", import.meta.url), "utf8")).payload;
const eventos = [];

async function aviso(lead, texto) {
  const id = `v-nc-evt-${randomUUID()}`;
  eventos.push(id);
  const a = structuredClone(SOBRE);
  a.id = id;
  a.account.id = CUENTA;
  a.conversation.participantId = lead;
  a.conversation.platformConversationId = lead;
  a.conversation.participantUsername = `lead.${lead}`;
  a.message.sender.id = lead;
  a.message.sender.username = `lead.${lead}`;
  a.message.platformMessageId = `mid-${randomUUID()}`;
  a.message.sentAt = new Date().toISOString();
  a.message.text = texto;
  a.message.attachments = [];
  const cuerpo = JSON.stringify(a);
  const res = await fetch(`${APP_URL}/api/webhooks/late`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-late-signature": createHmac("sha256", SECRETO).update(cuerpo).digest("hex") },
    body: cuerpo,
  });
  return { status: res.status, mid: a.message.platformMessageId };
}

function cookieDe(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacio}`);
  return partes.join("; ");
}

async function contactoDelLead(espacio, lead) {
  const { data } = await admin(`contact_channels?select=contact_id,contacts!inner(id,workspace_id,do_not_contact,do_not_contact_reason)&platform_sender_id=eq.${lead}&contacts.workspace_id=eq.${espacio}`);
  return data?.[0]?.contacts ?? null;
}

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

  // ── Parte 2: el código desplegado ─────────────────────────────────────────
  const owner2 = await crearUsuario("nocontactar-receptor");
  const espacio2 = owner2.espacio;
  await admin(`workspaces?id=eq.${espacio2}`, { method: "PATCH", body: JSON.stringify({ webhook_secret: SECRETO }) });
  const canal2 = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio2, is_active: true, umbral_silencio_horas: null, platform: "instagram", provider: "zernio", late_account_id: CUENTA, username: `cuentanc${sufijo}` }) })).data?.[0]?.id;
  if (!canal2) throw new Error("no se pudo crear el canal de Instagram fantasma");
  limpiar.canales.push(canal2);

  titulo("Un aviso con una frase de baja marca al contacto");
  const leadBaja = `vNb${String(Date.now()).slice(-6)}${sufijo}`;
  const leadOtro = `vNo${String(Date.now()).slice(-6)}${sufijo}`;
  const rControl = await aviso(leadOtro, "basta con que me mandes el link");
  const cControl = await contactoDelLead(espacio2, leadOtro);
  const llego = check(rControl.status === 200 && cControl !== null, "control: el aviso llega y se guarda (HTTP 200, contacto creado)", `HTTP ${rControl.status} · ${JSON.stringify(cControl)}`);
  check(cControl?.do_not_contact === false, "«basta con que me mandes el link» no marca", JSON.stringify(cControl));
  const rBaja = await aviso(leadBaja, "Hola. Por favor, NO me escribas más.");
  const cBaja = await contactoDelLead(espacio2, leadBaja);
  if (!llego) noConcluyente("la frase de baja marca", "el control falló: no se sabe si el aviso llega");
  else check(rBaja.status === 200 && cBaja?.do_not_contact === true && /no me escribas más/.test(cBaja?.do_not_contact_reason ?? ""), "«no me escribas más» marca, con el motivo, y el aviso se acusa (200)", `HTTP ${rBaja.status} · ${JSON.stringify(cBaja)}`);
  const historial = await admin(`audit_log?select=action&workspace_id=eq.${espacio2}&action=eq.contacto.no_contactar`);
  check((historial.data ?? []).length === 1, "queda una vez en el historial", JSON.stringify(historial.data));

  // F34, criterio 3 (09/11/2026): al marcarlo por un aviso, se pausan sus
  // secuencias activas. Las inscripciones se crean antes del aviso de baja.
  titulo("Al marcarlo por un aviso, se pausan sus secuencias activas (F34, criterio 3)");
  const leadPausa = `vNp${String(Date.now()).slice(-6)}${sufijo}`;
  const rHola = await aviso(leadPausa, "hola, quería info");
  const cPausa = await contactoDelLead(espacio2, leadPausa);
  const secuencia2 = (await admin("sequences", { method: "POST", body: JSON.stringify({ workspace_id: espacio2, name: `b3-pausa-${sufijo}`, status: "active", steps: [] }) })).data?.[0]?.id;
  const inscribir = async (contactoId) =>
    (await admin("sequence_enrollments", { method: "POST", body: JSON.stringify({ sequence_id: secuencia2, contact_id: contactoId, channel_id: canal2 }) })).data?.[0]?.id ?? null;
  const insPausa = cPausa && secuencia2 ? await inscribir(cPausa.id) : null;
  const insControl = cControl && secuencia2 ? await inscribir(cControl.id) : null;
  const estadoIns = async (id) => (id ? (await admin(`sequence_enrollments?select=status&id=eq.${id}`)).data?.[0]?.status ?? null : null);
  const presentes = check(
    rHola.status === 200 && cPausa?.do_not_contact === false && (await estadoIns(insPausa)) === "active" && (await estadoIns(insControl)) === "active",
    "presencia: el contacto existe sin marca y las dos inscripciones arrancan activas",
    JSON.stringify({ status: rHola.status, cPausa, insPausa, insControl }),
  );
  const rBaja2 = await aviso(leadPausa, "no me escribas más");
  if (!presentes) noConcluyente("la pausa de sus secuencias", "falló la presencia: no había inscripciones activas que pausar");
  else {
    check(rBaja2.status === 200 && (await contactoDelLead(espacio2, leadPausa))?.do_not_contact === true && (await estadoIns(insPausa)) === "paused", "el marcado queda con la marca y su inscripción pasa a «paused»", `HTTP ${rBaja2.status}, estado ${await estadoIns(insPausa)}`);
    check((await estadoIns(insControl)) === "active", "control: la inscripción del otro contacto sigue activa", `estado ${await estadoIns(insControl)}`);
  }

  titulo("Escribirle a un marcado desde la bandeja: 409, sin llamar a Zernio");
  const conv = async (contactoId) => (await admin(`conversations?select=id&contact_id=eq.${contactoId}`)).data?.[0]?.id ?? null;
  const enviar = async (conversationId) => {
    const res = await fetch(`${APP_URL}/api/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieDe(owner2, espacio2) },
      body: JSON.stringify({ conversationId, text: "prueba del verificador" }),
      redirect: "manual",
    });
    return { status: res.status, cuerpo: await res.json().catch(() => null) };
  };
  const convOtro = cControl ? await conv(cControl.id) : null;
  const convBaja = cBaja ? await conv(cBaja.id) : null;
  const aOtro = convOtro ? await enviar(convOtro) : { status: 0, cuerpo: null };
  const controlEnvio = check(aOtro.status > 0 && aOtro.cuerpo?.code !== "no_contactar" && aOtro.status !== 200, "control: al no marcado la ruta no responde «no_contactar» (corta después, sin Zernio)", `HTTP ${aOtro.status} ${JSON.stringify(aOtro.cuerpo).slice(0, 140)}`);
  const aBaja = convBaja ? await enviar(convBaja) : { status: 0, cuerpo: null };
  if (!controlEnvio) noConcluyente("al marcado, 409", "el control falló: no se sabe si la ruta responde");
  else check(aBaja.status === 409 && aBaja.cuerpo?.code === "no_contactar", "al marcado: 409 «no_contactar», con el aviso", `HTTP ${aBaja.status} ${JSON.stringify(aBaja.cuerpo).slice(0, 140)}`);

  // Los contactos que creó el receptor, para la limpieza (los canales con mensajes no se borran si no).
  const creados = (await admin(`contacts?select=id&workspace_id=eq.${espacio2}`)).data ?? [];
  for (const c of creados) limpiar.contactos.push(c.id);
}, async () => {
  for (const id of eventos) await admin(`webhook_events?event_id=eq.${id}`, { method: "DELETE" });
  const quedan = (await admin(`webhook_events?select=event_id&event_id=like.v-nc-evt-*`)).data ?? [];
  check(quedan.length === 0, "webhook_events del verificador: 0");
});
