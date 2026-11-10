#!/usr/bin/env node
/**
 * A y B del 06/11/2026, en un iPhone emulado, contra PRODUCCIÓN.
 *
 * A. El chat que no abre en el último mensaje: se abre una conversación desde
 *    la lista y, después de que cargan las fotos, el hilo tiene que estar en el
 *    último mensaje. Tres intentos, cada uno en un navegador nuevo (sin caché),
 *    porque el error depende del momento en que cargan las fotos.
 * B. La vista previa de la lista después de un mensaje nuevo, al volver con
 *    «← Conversaciones»: la pantalla tiene que mostrar la de la base.
 *    B1, con Realtime funcionando. B2, con Realtime cortado a propósito
 *    mientras se está en el chat (el teléfono que pausa la conexión).
 *
 * DÓNDE CORRE. En esta Mac, con el WebKit de Playwright 1.64.1 instalado en
 * `herramientas-locales/playwright/` (fuera del proyecto, ignorado por git) y
 * el perfil «iPhone 15». La documentación oficial de Playwright no dice que su
 * WebKit emulado se porte como Safari del iPhone al desplazar: un verde de A
 * acá no prueba que en el iPhone ande. La prueba final es la de Marcos.
 *
 * QUÉ ESCRIBE. Todo en un espacio fantasma (`crearUsuario`), con la clave de
 * servicio: un canal de Instagram falso, dos contactos, dos conversaciones,
 * los mensajes y tres PNG altos en `message-media`, en la ruta del espacio.
 * Nunca toca «Enviar» (llamaría a Zernio) ni «Sincronizar». B simula el
 * mensaje nuevo escribiendo en la base lo mismo que el eco de Zernio
 * (`app/api/webhooks/late/route.ts:341`: `last_message_at` y
 * `last_message_preview`). Al final borra todo y recuenta en cero.
 *
 * LA SESIÓN. La cookie de `@supabase/ssr` 0.8.0 (`sb-<ref>-auth-token`, en
 * partes de 3180, `path /`, `sameSite lax`, `httpOnly` falso:
 * `utils/constants.js:4-10`), más `zernflow_workspace_id`, puestas con
 * `context.addCookies`. Ninguna pantalla de inicio de sesión.
 *
 * EL CORTE DE REALTIME (B2). `context.routeWebSocket` con `connectToServer()`
 * (Playwright 1.48+, documentación de `WebSocketRoute`): con un manejador de
 * mensajes del lado del servidor, lo que el servidor manda ya no se reenvía
 * solo; el script lo reenvía mientras no está cortado y lo descarta (y lo
 * cuenta) mientras lo está.
 *
 * LOS CONTROLES. A: las fotos cargaron y agrandaron el hilo (si no, «no
 * concluyente»). B1 y B2: un canario antes (otra conversación cambia su vista
 * previa y la lista lo muestra: Realtime entrega). B2: durante el corte se
 * descartó al menos un mensaje del servidor (si no, el corte no se puede
 * atribuir: «no concluyente»).
 *
 * Uso: node scripts/verify-hilo-telefono.mjs
 */
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { admin, catalogo, check, correr, crearContacto, crearUsuario, limpiar, noConcluyente, sufijo, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(URL_BASE).hostname.split(".")[0];

let playwright;
try {
  const requerir = createRequire(new URL("../herramientas-locales/playwright/package.json", import.meta.url));
  playwright = requerir("playwright");
} catch {
  console.error("Falta Playwright en herramientas-locales/playwright/ (npm install --ignore-scripts y playwright install webkit).");
  process.exit(1);
}
const { webkit, devices } = playwright;

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Un PNG alto, armado acá (600 × 900, un solo color) ─────────────────────
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([largo, td, crc]);
}
function pngAlto(ancho, alto, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  const fila = Buffer.alloc(1 + ancho * 3);
  for (let x = 0; x < ancho; x++) fila.set([r, g, b], 1 + x * 3);
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(crudo)),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

// ── Los datos del espacio fantasma ─────────────────────────────────────────
const rutas = [];
const NOMBRE_HILO = `Lead hilo ${sufijo}`;
const NOMBRE_CANARIO = `Lead canario ${sufijo}`;
const FINAL = `ULTIMO-${sufijo} este es el último mensaje`;

async function conversacion(espacio, canal, nombre, preview, cuando) {
  const contacto = await crearContacto(espacio, { display_name: nombre });
  const r = await admin("conversations", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: espacio, channel_id: canal, contact_id: contacto.id, platform: "instagram",
      status: "open", unread_count: 0, historial_estado: "completo",
      last_message_at: cuando, last_message_preview: preview,
    }),
  });
  const id = r.data?.[0]?.id;
  if (!id) throw new Error(`no se pudo crear la conversación de ${nombre}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return id;
}

async function mensaje(convId, campos, cuando) {
  const r = await admin("messages", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: convId, direction: "inbound", status: "sent",
      platform_message_id: `vtel-${sufijo}-${Math.random().toString(36).slice(2, 10)}`,
      created_at: cuando, ...campos,
    }),
  });
  const id = r.data?.[0]?.id;
  if (!id) throw new Error(`no se pudo crear un mensaje: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return id;
}

async function foto(espacio, convId, cuando, color) {
  const png = pngAlto(600, 900, color);
  const msgId = await mensaje(convId, { attachments: [{ type: "image" }], message_type: "imagen", media_status: "descargado", media_intentos: 1 }, cuando);
  const ruta = `${espacio}/${convId}/${msgId}/archivo.png`;
  const subida = await fetch(`${URL_BASE}/storage/v1/object/message-media/${ruta}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/png" },
    body: png,
  });
  if (subida.status >= 300) throw new Error(`no se pudo subir la foto: HTTP ${subida.status}`);
  rutas.push(ruta);
  await admin(`messages?id=eq.${msgId}`, { method: "PATCH", body: JSON.stringify({ media_path: ruta, media_mime: "image/png", media_bytes: png.byteLength }) });
}

// ── El navegador ───────────────────────────────────────────────────────────
function cookies(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push({ name: nombre, value: valor });
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push({ name: `${nombre}.${i}`, value: valor.slice(i * 3180, (i + 1) * 3180) });
  partes.push({ name: "zernflow_workspace_id", value: espacio });
  return partes.map((c) => ({ ...c, url: APP_URL, sameSite: "Lax", httpOnly: false }));
}

async function contexto(navegador, u, espacio) {
  const ctx = await navegador.newContext({ ...devices["iPhone 15"] });
  await ctx.addCookies(cookies(u, espacio));
  return ctx;
}

const itemDe = (page, nombre) => page.locator("button", { hasText: nombre }).first();

async function abrirBandeja(page) {
  await page.goto(`${APP_URL}/dashboard/inbox`, { waitUntil: "domcontentloaded" });
  await itemDe(page, NOMBRE_HILO).waitFor({ state: "visible", timeout: 30000 });
}

/**
 * El contenedor que se desplaza, medido desde un texto del hilo. Se busca
 * primero el contenedor (el que se desplaza y tiene las fotos) y el texto
 * adentro de él: la vista previa de la lista oculta tiene el mismo texto, y en
 * la primera corrida (18:42) la medición la encontró a ella y devolvió nulo.
 */
async function medirHilo(page, texto) {
  return page.evaluate((t) => {
    // El que se desplaza, se ve, y tiene el texto. Sin exigir las fotos: en la
    // segunda corrida (18:43) las fotos todavía no estaban en la página cuando
    // apareció el último mensaje, y el «antes» quedaba sin medir.
    const contenedores = [...document.querySelectorAll("div")].filter(
      (d) => getComputedStyle(d).overflowY === "auto" && d.clientHeight > 0 && d.textContent?.includes(t) && !d.querySelector("button[class*='border-b'] p")
    );
    const c = contenedores[contenedores.length - 1];
    if (!c) return { error: "sin contenedor del hilo" };
    const nodo = [...c.querySelectorAll("*")].filter((n) => n.textContent?.includes(t)).pop();
    if (!nodo) return { error: "sin el texto adentro del hilo" };
    const rc = c.getBoundingClientRect();
    const rn = nodo.getBoundingClientRect();
    const imgs = [...c.querySelectorAll("img")].filter((i) => i.src.includes("/message-media/"));
    return {
      scrollHeight: c.scrollHeight, scrollTop: Math.round(c.scrollTop), clientHeight: c.clientHeight,
      distancia: Math.round(c.scrollHeight - c.scrollTop - c.clientHeight),
      ultimoVisible: rn.top >= rc.top - 1 && rn.bottom <= rc.bottom + 1,
      fotos: imgs.length, fotosCargadas: imgs.filter((i) => i.complete && i.naturalHeight > 0).length,
    };
  }, texto);
}

/** Lo que muestra la lista para una conversación, y lo que dice la base. */
async function vistaPrevia(page, convId, nombre) {
  const pantalla = await itemDe(page, nombre).innerText().catch(() => null);
  const base = (await admin(`conversations?select=last_message_preview&id=eq.${convId}`)).data?.[0]?.last_message_preview ?? null;
  return { pantalla, base };
}

async function esperarTexto(page, nombre, texto, ms) {
  try {
    await page.waitForFunction(
      ([n, t]) => [...document.querySelectorAll("button")].some((b) => b.innerText.includes(n) && b.innerText.includes(t)),
      [nombre, texto],
      { timeout: ms }
    );
    return true;
  } catch {
    return false;
  }
}

async function mensajeNuevo(convId, texto) {
  const ahora = new Date().toISOString();
  await mensaje(convId, { text: texto, message_type: "texto" }, ahora);
  await admin(`conversations?id=eq.${convId}`, { method: "PATCH", body: JSON.stringify({ last_message_at: ahora, last_message_preview: texto }) });
}

let espacioFantasma = null;

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo · WebKit de Playwright, perfil «iPhone 15»`);
  const u = await crearUsuario("tel");
  const espacio = u.espacio;
  espacioFantasma = espacio;
  await admin(`workspaces?id=eq.${espacio}`, { method: "PATCH", body: JSON.stringify({ name: `V tel ${sufijo}` }) });

  titulo("El escenario, en el espacio fantasma");
  const canal = (await admin("channels", { method: "POST", body: JSON.stringify({ workspace_id: espacio, is_active: true, umbral_silencio_horas: null, platform: "instagram", provider: "zernio", late_account_id: `vtel-${sufijo}`, username: `cuentatel${sufijo}` }) })).data?.[0]?.id;
  if (!canal) throw new Error("no se pudo crear el canal fantasma");
  limpiar.canales.push(canal);

  const base = Date.now() - 2 * 60 * 60 * 1000;
  const t = (min) => new Date(base + min * 60 * 1000).toISOString();
  const convHilo = await conversacion(espacio, canal, NOMBRE_HILO, FINAL, t(60));
  const convCanario = await conversacion(espacio, canal, NOMBRE_CANARIO, "canario sin cambios", t(1));
  for (let i = 0; i < 36; i++) {
    await mensaje(convHilo, { direction: i % 2 ? "outbound" : "inbound", text: `Mensaje ${i + 1} del hilo de prueba, con algo de texto para que ocupe una línea o dos.`, message_type: "texto" }, t(i));
  }
  await foto(espacio, convHilo, t(40), [200, 80, 80]);
  await mensaje(convHilo, { text: "texto entre fotos", message_type: "texto" }, t(41));
  await foto(espacio, convHilo, t(42), [80, 160, 80]);
  const ADJ = (await import("../lib/fixtures/zernio-adjuntos-f44.json", { with: { type: "json" } })).default;
  await mensaje(convHilo, { attachments: [ADJ.reel], message_type: "video", media_status: "pendiente" }, t(43));
  await mensaje(convHilo, { attachments: [ADJ.publicacion], message_type: "otro", media_status: "pendiente" }, t(44));
  await foto(espacio, convHilo, t(45), [80, 80, 200]);
  await mensaje(convHilo, { text: "penúltimo mensaje", message_type: "texto" }, t(46));
  await mensaje(convHilo, { text: FINAL, message_type: "texto" }, t(60));
  await mensaje(convCanario, { text: "canario sin cambios", message_type: "texto" }, t(1));
  console.log(`  2 conversaciones, ${36 + 9} mensajes, 3 fotos de 600 × 900 en message-media`);

  const navegador = await webkit.launch();
  try {
    // ── A ────────────────────────────────────────────────────────────────
    for (let intento = 1; intento <= 3; intento++) {
      titulo(`A, intento ${intento}: abrir el chat desde la lista y que quede en el último mensaje`);
      const ctx = await contexto(navegador, u, espacio);
      const page = await ctx.newPage();
      try {
        await abrirBandeja(page);
        await itemDe(page, NOMBRE_HILO).tap();
        // La primera medición en cuanto el hilo existe. `getByText(FINAL)` no
        // sirve para esperarlo: encuentra al instante la vista previa de la
        // lista oculta (tercera corrida, 18:44).
        let antes = null;
        for (let i = 0; i < 400 && (!antes || antes.error); i++) {
          antes = await medirHilo(page, FINAL);
          if (antes?.error) await esperar(50);
        }
        let cargaron = true;
        try {
          await page.waitForFunction(
            (t) => {
              const imgs = [...document.querySelectorAll("img")].filter((i) => i.src.includes("/message-media/"));
              return imgs.length > 0 && imgs.filter((i) => i.complete && i.naturalHeight > 0).length === imgs.length;
            },
            FINAL,
            { timeout: 20000 }
          );
        } catch {
          cargaron = false;
        }
        await esperar(1500);
        const despues = await medirHilo(page, FINAL);
        console.log(`        al aparecer: ${JSON.stringify(antes)}`);
        console.log(`        con las fotos: ${JSON.stringify(despues)}`);
        const creció = antes && despues && despues.scrollHeight > antes.scrollHeight;
        const control = check(cargaron && despues?.fotosCargadas > 0 && creció, "control: las fotos del hilo cargaron y agrandaron el hilo", JSON.stringify({ cargaron, antes, despues }));
        if (!control) noConcluyente("el hilo queda en el último mensaje", "las fotos no cargaron después de montarse el hilo: no hubo crecimiento que probar");
        else check(despues.distancia <= 4 && despues.ultimoVisible, "el hilo queda en el último mensaje después de cargar las fotos", `distancia al final ${despues.distancia}px, último visible ${despues.ultimoVisible}`);
      } finally {
        await ctx.close();
      }
    }

    // ── B1 ───────────────────────────────────────────────────────────────
    titulo("B1, con Realtime funcionando: al volver, la lista muestra la vista previa nueva");
    {
      const ctx = await contexto(navegador, u, espacio);
      const page = await ctx.newPage();
      try {
        await abrirBandeja(page);
        await esperar(2000);
        const CANARIO = `CANARIO1-${sufijo}`;
        await mensajeNuevo(convCanario, CANARIO);
        const canario = check(await esperarTexto(page, NOMBRE_CANARIO, CANARIO, 15000), "control: Realtime entrega (la lista muestra el canario de otra conversación)");
        await itemDe(page, NOMBRE_HILO).tap();
        await page.getByText(FINAL).first().waitFor({ state: "attached", timeout: 20000 });
        const NUEVO = `NUEVO-B1-${sufijo}`;
        await mensajeNuevo(convHilo, NUEVO);
        await esperar(4000);
        await page.getByRole("button", { name: /Conversaciones/ }).first().tap();
        const aparece = await esperarTexto(page, NOMBRE_HILO, NUEVO, 5000);
        const vp = await vistaPrevia(page, convHilo, NOMBRE_HILO);
        console.log(`        base: ${JSON.stringify(vp.base)} · pantalla: ${JSON.stringify(vp.pantalla)}`);
        if (!canario) noConcluyente("B1: la lista muestra la vista previa nueva", "el canario no llegó: Realtime no entregaba con esta sesión");
        else check(aparece && vp.base === NUEVO, "B1: la lista muestra la vista previa de la base al volver");
      } finally {
        await ctx.close();
      }
    }

    // ── B2 ───────────────────────────────────────────────────────────────
    titulo("B2, con Realtime cortado mientras se está en el chat: al volver, la lista muestra la vista previa nueva");
    {
      const ctx = await contexto(navegador, u, espacio);
      const corte = { cortado: false, entregados: 0, descartados: 0, sockets: 0 };
      await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
        corte.sockets++;
        const servidor = ws.connectToServer();
        servidor.onMessage((m) => {
          if (corte.cortado) corte.descartados++;
          else {
            corte.entregados++;
            ws.send(m);
          }
        });
        ws.onMessage((m) => {
          if (!corte.cortado) servidor.send(m);
        });
      });
      const page = await ctx.newPage();
      try {
        await abrirBandeja(page);
        await esperar(2000);
        const CANARIO = `CANARIO2-${sufijo}`;
        await mensajeNuevo(convCanario, CANARIO);
        const canario = check(await esperarTexto(page, NOMBRE_CANARIO, CANARIO, 15000), "control: Realtime entrega a través del desvío del websocket (la lista muestra el canario)", JSON.stringify(corte));
        await itemDe(page, NOMBRE_HILO).tap();
        await page.getByText(FINAL).first().waitFor({ state: "attached", timeout: 20000 });
        await esperar(1000);
        corte.cortado = true;
        const descartadosAntes = corte.descartados;
        const NUEVO = `NUEVO-B2-${sufijo}`;
        await mensajeNuevo(convHilo, NUEVO);
        await esperar(4000);
        const huboCorte = check(corte.descartados > descartadosAntes, "control: durante el corte se descartó al menos un mensaje de Realtime", JSON.stringify(corte));
        await page.getByRole("button", { name: /Conversaciones/ }).first().tap();
        const aparece = await esperarTexto(page, NOMBRE_HILO, NUEVO, 5000);
        const vp = await vistaPrevia(page, convHilo, NOMBRE_HILO);
        console.log(`        base: ${JSON.stringify(vp.base)} · pantalla: ${JSON.stringify(vp.pantalla)} · ${JSON.stringify(corte)}`);
        if (!canario || !huboCorte) noConcluyente("B2: la lista muestra la vista previa nueva", !canario ? "el canario no llegó" : "no se descartó nada durante el corte: no se puede atribuir");
        else check(aparece && vp.base === NUEVO, "B2: la lista muestra la vista previa de la base al volver, sin Realtime");
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await navegador.close();
  }
}, async () => {
  // Después de `limpiarTodo`: los archivos y el recuento.
  titulo("Limpieza de Storage y recuento");
  if (rutas.length) {
    await fetch(`${URL_BASE}/storage/v1/object/message-media`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: rutas }),
    });
  }
  if (!espacioFantasma) return;
  const objetos = catalogo(`select count(*)::int as n from storage.objects where bucket_id = 'message-media' and name like '${espacioFantasma}/%'`)[0].n;
  check(objetos === 0, `no quedan objetos del espacio fantasma en message-media (${objetos})`);
  const cuenta = async (q) => (await admin(q)).data?.length ?? -1;
  check((await cuenta(`conversations?select=id&workspace_id=eq.${espacioFantasma}`)) === 0, "conversations del espacio: 0");
  check((await cuenta(`channels?select=id&workspace_id=eq.${espacioFantasma}`)) === 0, "channels del espacio: 0");
  check((await cuenta(`contacts?select=id&workspace_id=eq.${espacioFantasma}`)) === 0, "contacts del espacio: 0");
});
