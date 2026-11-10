#!/usr/bin/env node
/**
 * F42, los portones del envío por WhatsApp desde la bandeja, contra
 * `POST /api/v1/messages` de PRODUCCIÓN, en un espacio fantasma que el script
 * crea y borra. **Nunca llama a Evolution:** ningún paso llega al envío (o la
 * sesión lo corta, o «no contactar», o el alcance, o falta el token de la
 * instancia en Vault, que el espacio fantasma no tiene). El envío que sale de
 * verdad lo prueban los tests con respuestas simuladas y la prueba real de
 * Marcos.
 *
 * EL ESCENARIO. Un Owner (con su espacio fantasma) y un Member; un canal de
 * WhatsApp falso (`provider = evolution`, una instancia inventada, sin token),
 * un contacto con su identificador en el canal y su conversación, sin asignar
 * (el Member no la ve).
 *
 * EL ROJO, antes del código de F42: la ruta respondía 400 «No Zernio
 * conversation ID linked to this conversation» a toda conversación de WhatsApp.
 *
 * Uso: node scripts/verify-respuesta-whatsapp.mjs
 */
import { admin, check, correr, crearContacto, crearUsuario, limpiar, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const REF = new URL(URL_BASE).hostname.split(".")[0];
const DESCONECTADO = "WhatsApp no está conectado. Los mensajes no pueden salir ni entrar por este canal hasta reconectarlo.";

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);

function cookieDe(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push(`${nombre}.${i}=${valor.slice(i * 3180, (i + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacio}`);
  return partes.join("; ");
}

async function enviar(u, espacio, conversationId) {
  const res = await fetch(`${APP_URL}/api/v1/messages`, {
    method: "POST",
    headers: { Cookie: cookieDe(u, espacio), "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, text: `verify F42 ${sufijo}` }),
    redirect: "manual",
  });
  const cuerpo = await res.json().catch(() => null);
  return { status: res.status, cuerpo };
}

const salientes = async (convId) => (await admin(`messages?select=id&conversation_id=eq.${convId}&direction=eq.outbound`)).data?.length ?? -1;

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo · sin llamar a Evolution`);
  const owner = await crearUsuario("f42-owner");
  const member = await crearUsuario("f42-member");
  const espacio = owner.espacio;
  await sumarAlEspacio(espacio, member, "member");

  const canal = (
    await admin("channels", {
      method: "POST",
      body: JSON.stringify({ workspace_id: espacio, platform: "whatsapp", provider: "evolution", instance_name: `v-f42-${sufijo}`, is_active: true, umbral_silencio_horas: null, session_state: "caido" }),
    })
  ).data?.[0]?.id;
  if (!canal) throw new Error("no se pudo crear el canal fantasma");
  limpiar.canales.push(canal);
  const contacto = await crearContacto(espacio, { display_name: `Lead F42 ${sufijo}` });
  const jid = `5067000${String(Date.now()).slice(-4)}@s.whatsapp.net`;
  await admin("contact_channels", { method: "POST", body: JSON.stringify({ contact_id: contacto.id, channel_id: canal, platform_sender_id: jid, raw_jid: jid }) });
  const conv = (
    await admin("conversations", {
      method: "POST",
      body: JSON.stringify({ workspace_id: espacio, channel_id: canal, contact_id: contacto.id, platform: "whatsapp", status: "open", historial_estado: "completo" }),
    })
  ).data?.[0]?.id;
  if (!conv) throw new Error("no se pudo crear la conversación fantasma");
  const sesion = async (estado) => admin(`channels?id=eq.${canal}`, { method: "PATCH", body: JSON.stringify({ session_state: estado }) });

  for (const estado of ["caido", "agotado", "sin_vincular"]) {
    titulo(`Sesión «${estado}»: 409 sin llamar a Evolution y sin guardar`);
    await sesion(estado);
    const r = await enviar(owner, espacio, conv);
    check(r.status === 409 && r.cuerpo?.code === "whatsapp_desconectado" && r.cuerpo?.error === DESCONECTADO, `409 whatsapp_desconectado con el texto del criterio`, `HTTP ${r.status} ${JSON.stringify(r.cuerpo)}`);
    check((await salientes(conv)) === 0, "ningún mensaje guardado");
  }

  titulo("Control: «no contactar» corta antes, con la sesión conectada");
  await sesion("conectado");
  await admin(`contacts?id=eq.${contacto.id}`, { method: "PATCH", body: JSON.stringify({ do_not_contact: true, do_not_contact_reason: "verify F42" }) });
  const rNo = await enviar(owner, espacio, conv);
  check(rNo.status === 409 && rNo.cuerpo?.code === "no_contactar", "409 no_contactar", `HTTP ${rNo.status} ${JSON.stringify(rNo.cuerpo)}`);
  await admin(`contacts?id=eq.${contacto.id}`, { method: "PATCH", body: JSON.stringify({ do_not_contact: false, do_not_contact_reason: null }) });

  titulo("Control: un Member que no tiene ese lead no envía");
  const rM = await enviar(member, espacio, conv);
  check(rM.status === 403, "403 para el Member sin el lead", `HTTP ${rM.status} ${JSON.stringify(rM.cuerpo)}`);

  titulo("Sesión conectada y sin el token de la instancia en Vault: 503 sin llamar");
  const rT = await enviar(owner, espacio, conv);
  check(rT.status === 503 && rT.cuerpo?.code === "whatsapp_sin_configurar", "503 whatsapp_sin_configurar", `HTTP ${rT.status} ${JSON.stringify(rT.cuerpo)}`);
  check((await salientes(conv)) === 0, "ningún mensaje guardado en toda la corrida");
});
