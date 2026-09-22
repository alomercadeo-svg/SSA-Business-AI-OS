#!/usr/bin/env node
/**
 * Crea la instancia de Evolution, registra su webhook y deja la fila en
 * `channels` (F21).
 *
 * NO VINCULA NINGÚN NÚMERO, y no es una omisión: el `create` va con la
 * generación de QR apagada. La compuerta son DOS funcionalidades, F27 y F32.
 * Mientras F27 no exista, el receptor autentica, acusa con 200 y DESCARTA el
 * contenido, así que un número real conectado ahora significa mensajes de leads
 * perdidos en silencio y con acuse de éxito. Y sin F32 no hay estado de sesión
 * ni forma de reconectar desde la interfaz: una sesión caída se ve igual que un
 * día tranquilo.
 * Ver docs/requerimientos-fase1.md §4.7.
 *
 * ── EL ORDEN DE LAS OPERACIONES ES EL CONTROL, NO UN DETALLE ────────────────
 *
 *   1. workspace y clave global de Evolution
 *   2. fila en `channels` con is_active = false        ← reversible
 *   3. POST /instance/create                           ← IRREVERSIBLE
 *   4. token de la instancia a Vault
 *   5. secreto del webhook, registro y lectura de vuelta
 *   6. is_active = true
 *
 * La fila va PRIMERO porque no depende de Evolution: el `instance_name` lo
 * elegimos nosotros. Así, lo que falle antes del paso 3 deja una fila inactiva,
 * que se borra o que un reintento con el mismo nombre vuelve a encontrar por el
 * índice único de la 00022, en vez de dejar una instancia creada con un token
 * que no se puede recuperar.
 *
 * Y arranca en `is_active = false` para que no exista, ni por un instante, un
 * canal activo sin instancia detrás: el receptor filtra por `is_active`, así que
 * un canal activo a medio construir es una ventana en la que los avisos se
 * rechazan.
 *
 * EL ÚNICO PASO IRREVERSIBLE ES EL 3, y la ventana que importa es entre el 3 y
 * el 4.
 *
 * **CORRECCIÓN DEL 17/09/2026.** Este comentario decía que si el token no llega
 * a Vault no se recupera, porque con
 * `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` `fetchInstances` no lo
 * devuelve. **Eso es falso y se midió:** con la variable en `false`,
 * `fetchInstances` devuelve igual el campo `token` con el valor real. La
 * variable se lee y no se consume en ese camino en la 2.3.7. Ver
 * `docs/despliegue-evolution.md` §3.
 *
 * O sea que el token SÍ se puede recuperar, y la salida de "borrar la instancia
 * y volver a empezar" que este script propone más abajo es más destructiva de lo
 * necesario. **No se cambió el flujo todavía**: cambiar la recuperación es una
 * decisión de diseño, no una corrección de comentario, y este archivo se limita
 * a dejar de afirmar algo falso.
 *
 * Uso:
 *   node scripts/setup-evolution-channel.mjs <nombre-de-la-instancia>
 *   node scripts/setup-evolution-channel.mjs <nombre> --solo-webhook
 *   node scripts/setup-evolution-channel.mjs <nombre> --borrar-instancia
 *   node scripts/setup-evolution-channel.mjs <nombre> --workspace=<uuid>
 *
 * `--borrar-instancia` borra la instancia en Evolution, borra su token de Vault
 * y deja el canal inactivo, sin tocar la fila. Es la ÚNICA forma de rotar el
 * token de una instancia: Evolution lo entrega en el `create` y no lo vuelve a
 * dar. Lee la clave global de Vault y no la imprime.
 *
 * `--solo-webhook` es el paso 2 del procedimiento de rotación
 * (docs/despliegue-evolution.md §9): no crea nada, solo vuelve a registrar el
 * webhook con el secreto que hoy está en Vault.
 *
 * NINGÚN SECRETO SE IMPRIME. Ni el token de la instancia, ni el del webhook, ni
 * la clave global.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// ── Entorno ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const EVOLUTION_URL = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/$/, "");
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const faltantes = [
  ["EVOLUTION_API_URL", EVOLUTION_URL],
  ["NEXT_PUBLIC_APP_URL", APP_URL],
  ["NEXT_PUBLIC_SUPABASE_URL", URL_BASE],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
].filter(([, v]) => !v).map(([k]) => k);

if (faltantes.length > 0) {
  console.error(`Faltan en .env: ${faltantes.join(", ")}`);
  process.exit(1);
}

const CABECERAS = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

// ── Constantes del canal ────────────────────────────────────────────────────

/**
 * La URL del receptor. El esquema va incluido y no es cosmético:
 * `webhook.controller.ts:126` exige `regex.test(instance.url)` con
 * `/^(https?:\/\/)/`, y sin él Evolution NO emite el evento y no da ningún
 * error. Se arma desde NEXT_PUBLIC_APP_URL y se imprime antes de mandarla.
 */
const WEBHOOK_URL = `${APP_URL}/api/webhooks/evolution`;

/**
 * Los eventos que queremos, y NADA MÁS.
 *
 * Van en MAYÚSCULAS con guion bajo porque `emit()` transforma `messages.upsert`
 * en `MESSAGES_UPSERT` antes de comparar.
 *
 * LA LISTA EXPLÍCITA ES OBLIGATORIA, verificado en `event.controller.ts` de la
 * 2.3.7: `if (0 === data[this.name].events.length) data[this.name].events =
 * EventController.events`. Un array vacío no significa "ninguno", significa LOS
 * 31. Borrar esta lista para "simplificar" suscribe el receptor a todo.
 *
 * Y las `WEBHOOK_EVENTS_*` del entorno no gobiernan nada acá: solo las lee la
 * rama global de `emit()`, que dejamos apagada con WEBHOOK_GLOBAL_ENABLED=false.
 */
const EVENTOS = [
  "MESSAGES_UPSERT",    // mensajes en vivo
  "MESSAGES_SET",       // historial, llega como array
  "QRCODE_UPDATED",     // pantalla de canales
  "CONNECTION_UPDATE",  // estado de sesión
  "CONTACTS_UPSERT",    // una de las tres vías de reconciliación de teléfonos (F26)
  "STATUS_INSTANCE",    // desconexión definitiva (F32, Bloque 4)
  "LOGOUT_INSTANCE",
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const ok = (d) => console.log(`  ok    ${d}`);
const paso = (n, d) => console.log(`\n${n}. ${d}`);

class FalloDePaso extends Error {
  constructor(mensaje, { instanciaCreada = false } = {}) {
    super(mensaje);
    this.instanciaCreada = instanciaCreada;
  }
}

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: CABECERAS,
    body: JSON.stringify(args),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${fn} devolvió ${r.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

/** Llamada a Evolution con la clave global. La clave nunca se loguea. */
async function evolution(ruta, { method = "GET", body, clave } = {}) {
  const r = await fetch(`${EVOLUTION_URL}${ruta}`, {
    method,
    headers: { apikey: clave, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* no era JSON */ }
  return { status: r.status, ok: r.ok, json, texto };
}

// ── Argumentos ──────────────────────────────────────────────────────────────

const nombre = process.argv[2];
const soloWebhook = process.argv.includes("--solo-webhook");
const borrarInstancia = process.argv.includes("--borrar-instancia");

/**
 * El nombre se valida acá y no solo del lado de Evolution porque termina en una
 * URL y en una clave de idempotencia. Conservador a propósito.
 */
if (!nombre || nombre.startsWith("--") || !/^[A-Za-z0-9_-]{3,64}$/.test(nombre)) {
  console.error(
    "Uso: node scripts/setup-evolution-channel.mjs <nombre> [--solo-webhook | --borrar-instancia] [--workspace=<uuid>]\n" +
    "El nombre acepta letras, números, guion y guion bajo, entre 3 y 64 caracteres."
  );
  process.exit(1);
}

// ── Workspace ───────────────────────────────────────────────────────────────

/** Mismo criterio que set-evolution-secret.mjs: con más de uno, para y pregunta. */
async function resolverWorkspace() {
  const explicito = process.argv.find((a) => a.startsWith("--workspace="));
  if (explicito) return explicito.slice("--workspace=".length);

  const r = await fetch(`${URL_BASE}/rest/v1/workspaces?select=id,name`, { headers: CABECERAS });
  const filas = await r.json();

  if (!Array.isArray(filas) || filas.length === 0) throw new Error("No hay ningún workspace en la base.");
  if (filas.length > 1) {
    throw new Error(
      `Hay ${filas.length} workspaces. Pasá cuál con --workspace=<uuid>:\n` +
      filas.map((w) => `  ${w.id}  ${w.name}`).join("\n")
    );
  }
  return filas[0];
}

// ── Pasos ───────────────────────────────────────────────────────────────────

/**
 * La fila del canal: la encuentra si ya existe, o la crea inactiva.
 *
 * El reintento después de un fallo es lo que hace que esto tenga que ser
 * idempotente. El índice único `channels_instance_name_key` de la 00022
 * garantiza que no puedan existir dos con el mismo nombre.
 */
async function asegurarCanal(workspaceId) {
  const existente = await fetch(
    `${URL_BASE}/rest/v1/channels?select=id,provider,is_active,workspace_id&instance_name=eq.${encodeURIComponent(nombre)}`,
    { headers: CABECERAS }
  ).then((r) => r.json());

  if (Array.isArray(existente) && existente.length > 0) {
    const canal = existente[0];
    if (canal.provider !== "evolution") {
      throw new Error(
        `Ya hay un canal con instance_name "${nombre}" y provider "${canal.provider}". ` +
        `No se toca: elegí otro nombre o corregí esa fila a mano.`
      );
    }
    ok(`la fila del canal ya existía: ${canal.id}`);
    return canal.id;
  }

  const r = await fetch(`${URL_BASE}/rest/v1/channels`, {
    method: "POST",
    headers: { ...CABECERAS, Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      platform: "whatsapp",          // único valor de WhatsApp del check de la 00016
      provider: "evolution",
      instance_name: nombre,
      display_name: nombre,
      late_account_id: null,          // un canal de Evolution no tiene cuenta de Zernio
      is_active: false,               // se activa recién al final
      // `webhook_secret` NO se toca: esa columna es del camino de Zernio. El
      // secreto de Evolution vive solo en Vault.
    }),
  });

  const cuerpo = await r.text();
  if (!r.ok) throw new Error(`no se pudo crear la fila del canal: ${r.status} ${cuerpo.slice(0, 300)}`);

  const canal = JSON.parse(cuerpo)[0];
  ok(`fila creada, inactiva todavía: ${canal.id}`);
  return canal.id;
}

/**
 * Lee el token de una instancia existente, sin tocar nada.
 *
 * ── DE DÓNDE SALE ESTE CAMINO ───────────────────────────────────────────────
 *
 * Antes, encontrar la instancia ya creada era un callejón: el script decía que
 * el token no se podía recuperar y mandaba a borrar la instancia y empezar de
 * nuevo. Esa afirmación era falsa —`fetchInstances` devuelve el `token` con el
 * valor real, medido el 17/09/2026— así que la salida propuesta era destructiva
 * de más.
 *
 * ── SOBRE QUÉ SE APOYA ESTE CAMINO, Y POR QUÉ ES FRÁGIL ─────────────────────
 *
 * **Se apoya en que una variable siga sin funcionar como está documentada.**
 * `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` debería, según la
 * documentación de Evolution, ocultar ese token; hoy no lo hace porque la
 * variable se lee y no se consume en ese camino en la 2.3.7.
 *
 * Si una versión futura la arregla, `fetchInstances` va a dejar de traer el
 * token y **esto se rompe**. Por eso devuelve `null` en vez de tirar, el camino
 * destructivo se conserva abajo como respaldo explícito, y la dependencia está
 * anotada en el bloque de `lib/evolution-version.mjs`, junto a la de `jwt_key`:
 * las dos obligan a revisar algo antes de subir de versión.
 */
async function leerTokenDeInstanciaExistente(clave, instancias) {
  const fila = instancias.find((i) => (i?.name ?? i?.instance?.instanceName) === nombre) ?? instancias[0];
  const token = fila?.token ?? fila?.instance?.apikey ?? fila?.apikey ?? null;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Crea la instancia, o recupera la que ya existe. Devuelve el token, que NO se imprime. */
async function crearInstancia(clave) {
  const yaExiste = await evolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(nombre)}`, { clave });
  if (yaExiste.ok && Array.isArray(yaExiste.json) && yaExiste.json.length > 0) {
    // Camino NO destructivo primero.
    const token = await leerTokenDeInstanciaExistente(clave, yaExiste.json);
    if (token) {
      ok(`la instancia "${nombre}" ya existía y su token se recuperó sin recrearla`);
      return token;
    }

    // Respaldo: solo si la lectura no lo trajo, que es lo que va a pasar el día
    // que Evolution empiece a respetar EXPOSE_IN_FETCH_INSTANCES.
    throw new FalloDePaso(
      `La instancia "${nombre}" ya existe y su token NO se pudo leer con fetchInstances.\n` +
      `\n` +
      `Esto es esperable si Evolution empezó a respetar\n` +
      `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: hasta la 2.3.7 esa variable se leía\n` +
      `y no se consumía en ese camino, y la recuperación no destructiva se apoya en\n` +
      `eso. Si es el caso, revisá lib/evolution-version.mjs antes de seguir.\n` +
      `\n` +
      `Salida de respaldo, que SÍ es destructiva: borrar la instancia y recrearla.\n` +
      `  node scripts/setup-evolution-channel.mjs ${nombre} --borrar-instancia\n` +
      `\n` +
      `Si en cambio ya está bien configurada y solo querés rehacer el webhook, usá --solo-webhook.`
    );
  }

  const r = await evolution("/instance/create", {
    method: "POST",
    clave,
    body: {
      instanceName: nombre,
      integration: "WHATSAPP-BAILEYS",
      // EL QR APAGADO ES LA REGLA, ESCRITA EN EL CÓDIGO Y NO EN LA MEMORIA DE
      // NADIE. Sin F27, un número vinculado pierde mensajes en silencio.
      qrcode: false,
      syncFullHistory: true,
      groupsIgnore: true,
    },
  });

  if (!r.ok) {
    throw new FalloDePaso(`/instance/create devolvió ${r.status}: ${r.texto.slice(0, 300)}`);
  }

  // La 2.x devolvió el token con dos formas distintas según la versión: `hash`
  // como string suelto, o `hash.apikey`. Se aceptan las dos y se falla FUERTE si
  // no aparece ninguna, porque un token vacío guardado en Vault es peor que un
  // error: parece que salió bien.
  const hash = r.json?.hash;
  const token = typeof hash === "string" ? hash : hash?.apikey;

  if (!token || typeof token !== "string") {
    throw new FalloDePaso(
      `la instancia se creó pero la respuesta no trae el token donde se lo esperaba\n` +
      `(se probó \`hash\` y \`hash.apikey\`). Claves recibidas: ${Object.keys(r.json ?? {}).join(", ")}`,
      { instanciaCreada: true }
    );
  }

  ok(`instancia "${nombre}" creada, sin QR y sin número vinculado`);
  return token;
}

/**
 * El secreto del webhook: se REUSA si ya existe.
 *
 * NO SE REGENERA, Y ESTE ES EL PUNTO MÁS FÁCIL DE ROMPER SIN DARSE CUENTA. El
 * secreto es por workspace, no por canal (ver lib/vault.ts). Si un segundo canal
 * generara uno nuevo, el webhook del primero quedaría firmando con un secreto
 * que ya no está en Vault y TODOS sus mensajes entrantes empezarían a dar 401,
 * que Evolution no reintenta. Regenerar es siempre explícito, con
 * `set-evolution-secret.mjs --rotar`.
 */
async function resolverSecretoDelWebhook(workspaceId) {
  const actual = await rpc("read_secret", {
    secret_name: "evolution_webhook_secret",
    workspace_id: workspaceId,
  });

  if (actual) {
    ok("el secreto del webhook ya estaba en Vault: se reusa, no se regenera");
    return actual;
  }

  const nuevo = randomBytes(32).toString("hex");
  await rpc("store_secret", {
    secret_name: "evolution_webhook_secret",
    secret_value: nuevo,
    workspace_id: workspaceId,
  });
  ok(`secreto del webhook generado y guardado en Vault, ${nuevo.length} caracteres`);
  return nuevo;
}

/**
 * Registra el webhook y LO LEE DE VUELTA.
 *
 * La lectura de vuelta no es una formalidad. El cuerpo va anidado bajo `webhook`
 * (verificado en `event.dto.ts` de la 2.3.7), y si la forma fuera la equivocada
 * Evolution podría contestar 200 sin guardar nada: el script cantaría éxito
 * sobre un webhook que no existe, y nos enteraríamos con la bandeja vacía.
 */
async function registrarWebhook(clave, secreto) {
  console.log(`  URL que se va a registrar: ${WEBHOOK_URL}`);
  console.log(`  Eventos: ${EVENTOS.join(", ")}`);

  const r = await evolution(`/webhook/set/${encodeURIComponent(nombre)}`, {
    method: "POST",
    clave,
    body: {
      webhook: {
        enabled: true,
        url: WEBHOOK_URL,
        // El secreto con el que Evolution firma cada entrega. Lo borra del
        // objeto de headers antes de enviar, así que nunca viaja por el cable:
        // lo que viaja es un JWT HS256 en `Authorization: Bearer`.
        headers: { jwt_key: secreto },
        // EN FALSE A PROPÓSITO: en true, Evolution le agrega el nombre del
        // evento al final de la URL y nuestro receptor es una ruta sola.
        byEvents: false,
        base64: false,
        events: EVENTOS,
      },
    },
  });

  if (!r.ok) throw new FalloDePaso(`/webhook/set devolvió ${r.status}: ${r.texto.slice(0, 300)}`, { instanciaCreada: true });
  ok("webhook registrado");

  // ── La lectura de vuelta ──────────────────────────────────────────────────
  const leido = await evolution(`/webhook/find/${encodeURIComponent(nombre)}`, { clave });
  if (!leido.ok) {
    throw new FalloDePaso(
      `el registro respondió ${r.status} pero /webhook/find devolvió ${leido.status}: ` +
      `no se puede confirmar que haya quedado guardado`,
      { instanciaCreada: true }
    );
  }

  const w = leido.json ?? {};
  const problemas = [];
  if (w.enabled !== true) problemas.push(`enabled es ${JSON.stringify(w.enabled)}, se esperaba true`);
  if (w.url !== WEBHOOK_URL) problemas.push(`url es ${JSON.stringify(w.url)}, se esperaba ${WEBHOOK_URL}`);

  const guardados = Array.isArray(w.events) ? w.events : [];
  const faltan = EVENTOS.filter((e) => !guardados.includes(e));
  const sobran = guardados.filter((e) => !EVENTOS.includes(e));
  if (faltan.length > 0) problemas.push(`faltan eventos: ${faltan.join(", ")}`);
  if (sobran.length > 0) {
    problemas.push(
      `hay eventos de más: ${sobran.join(", ")}. Si son 31, el array llegó vacío y ` +
      `Evolution lo reemplazó por la lista completa.`
    );
  }

  if (problemas.length > 0) {
    throw new FalloDePaso(
      `la lectura de vuelta no coincide con lo que se mandó:\n  · ${problemas.join("\n  · ")}`,
      { instanciaCreada: true }
    );
  }

  ok(`leído de vuelta: habilitado, la URL correcta y los ${EVENTOS.length} eventos`);
  // El `headers` no se compara: Evolution no devuelve el jwt_key, y está bien
  // que no lo devuelva. Que la firma funciona lo prueba
  // verify-evolution-webhook.mjs con un evento real.
}

// ── Principal ───────────────────────────────────────────────────────────────

async function main() {
  const ws = await resolverWorkspace();
  const workspaceId = ws.id ?? ws;

  console.log(`\nCanal de Evolution: "${nombre}"`);
  console.log(`  Evolution: ${EVOLUTION_URL}`);
  console.log(`  Receptor:  ${WEBHOOK_URL}`);
  if (ws.name) console.log(`  Workspace: ${ws.name} (${workspaceId})`);

  paso(1, "Clave global de Evolution");
  const clave = await rpc("read_secret", { secret_name: "evolution_api_key", workspace_id: workspaceId });
  if (!clave) {
    throw new Error(
      "no hay `evolution_api_key` en Vault.\n" +
      "Correr: node scripts/set-evolution-secret.mjs evolution_api_key"
    );
  }
  ok("leída de Vault");

  // ── Camino corto: borrar la instancia ─────────────────────────────────────
  //
  // POR QUÉ ESTO ES UNA OPCIÓN DEL SCRIPT Y NO UN `curl` EN LA DOCUMENTACIÓN.
  // El borrado necesita la clave global, y un `curl` con la clave en la línea de
  // comandos la deja en el scrollback, en el historial del shell y en la
  // transcripción de la sesión. La primera versión de este archivo sugería
  // exactamente eso en su mensaje de recuperación, que es la clase de atajo que
  // convierte un procedimiento de emergencia en una filtración.
  //
  // El único modo de rotar el token de una instancia es borrarla y volver a
  // crearla: Evolution lo genera en el `create` y no lo vuelve a entregar.
  if (borrarInstancia) {
    paso(2, `Borrar la instancia "${nombre}"`);
    const r = await evolution(`/instance/delete/${encodeURIComponent(nombre)}`, {
      method: "DELETE",
      clave,
    });
    if (!r.ok) throw new Error(`/instance/delete devolvió ${r.status}: ${r.texto.slice(0, 300)}`);
    ok("instancia borrada en Evolution");

    // El secreto del token queda huérfano: se borra para que no quede en Vault
    // un valor que ya no autoriza nada y que alguien pueda confundir con vigente.
    const { data: filas } = await fetch(
      `${URL_BASE}/rest/v1/channels?select=id&instance_name=eq.${encodeURIComponent(nombre)}`,
      { headers: CABECERAS }
    ).then(async (res) => ({ data: await res.json() }));

    for (const c of Array.isArray(filas) ? filas : []) {
      await rpc("delete_secret", {
        secret_name: `evolution_instance_token:${c.id}`,
        workspace_id: workspaceId,
      }).catch(() => { /* si no estaba, no hay nada que borrar */ });
      await fetch(`${URL_BASE}/rest/v1/channels?id=eq.${c.id}`, {
        method: "PATCH",
        headers: CABECERAS,
        body: JSON.stringify({ is_active: false }),
      });
      ok(`token borrado de Vault y canal ${c.id} desactivado`);
    }

    console.log(
      `\nLa fila de \`channels\` se conserva, inactiva. Para volver a crear la instancia\n` +
      `con un token nuevo:\n` +
      `  node scripts/setup-evolution-channel.mjs ${nombre}\n`
    );
    return;
  }

  // ── Camino corto: solo rehacer el webhook (rotación) ──────────────────────
  if (soloWebhook) {
    paso(2, "Registro del webhook (--solo-webhook)");
    const secreto = await resolverSecretoDelWebhook(workspaceId);
    await registrarWebhook(clave, secreto);
    console.log(
      `\nListo. Ahora confirmá que Evolution ya firma con el secreto nuevo:\n` +
      `  node scripts/verify-evolution-webhook.mjs\n` +
      `Hasta que eso pase, NO borres evolution_webhook_secret_previous.\n`
    );
    return;
  }

  paso(2, "Fila en `channels`, inactiva");
  const canalId = await asegurarCanal(workspaceId);

  paso(3, "Instancia en Evolution (paso irreversible)");
  const token = await crearInstancia(clave);

  paso(4, "Token de la instancia a Vault");
  try {
    await rpc("store_secret", {
      secret_name: `evolution_instance_token:${canalId}`,
      secret_value: token,
      workspace_id: workspaceId,
    });
  } catch (err) {
    throw new FalloDePaso(err.message, { instanciaCreada: true });
  }
  ok(`guardado como evolution_instance_token:${canalId}`);

  paso(5, "Secreto y registro del webhook");
  const secreto = await resolverSecretoDelWebhook(workspaceId);
  await registrarWebhook(clave, secreto);

  paso(6, "Activar el canal");
  const r = await fetch(`${URL_BASE}/rest/v1/channels?id=eq.${canalId}`, {
    method: "PATCH",
    headers: { ...CABECERAS, Prefer: "return=representation" },
    body: JSON.stringify({ is_active: true }),
  });
  const filas = await r.json();
  if (!r.ok || !Array.isArray(filas) || filas.length !== 1) {
    throw new FalloDePaso(
      `el canal quedó inactivo: el PATCH afectó ${Array.isArray(filas) ? filas.length : "?"} filas. ` +
      `El receptor filtra por is_active, así que con esto los avisos se rechazan.`,
      { instanciaCreada: true }
    );
  }
  ok("canal activo");

  console.log(
    `\nCanal listo, SIN número vinculado.\n` +
    `\nLo que sigue:\n` +
    `  node scripts/verify-evolution-webhook.mjs\n` +
    `\nY lo que NO sigue todavía: escanear el QR. F27 (guardado de mensajes entrantes)\n` +
    `no está construido, así que un número conectado hoy pierde los mensajes de los\n` +
    `leads en silencio y con acuse de éxito.\n`
  );
}

main().catch((err) => {
  console.error(`\nFalló: ${err.message}`);

  if (err instanceof FalloDePaso && err.instanciaCreada) {
    console.error(
      `\n── RECUPERACIÓN ─────────────────────────────────────────────────────\n` +
      `La instancia "${nombre}" YA EXISTE en Evolution. Su token se puede leer con\n` +
      `fetchInstances —devuelve el campo token pese a\n` +
      `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false, medido el 17/09/2026— pero\n` +
      `este script todavía no lo recupera solo.\n` +
      `\n` +
      `Borrala y volvé a correr este script. La fila de \`channels\` queda como está:\n` +
      `está inactiva y el reintento la vuelve a encontrar por el índice único.\n` +
      `\n` +
      `  node scripts/setup-evolution-channel.mjs ${nombre} --borrar-instancia\n` +
      `  node scripts/setup-evolution-channel.mjs ${nombre}\n` +
      `\n` +
      `El borrado lee la clave global de Vault y no la imprime. NO uses un curl con\n` +
      `la clave en la línea de comandos: queda en el scrollback y en el historial.\n`
    );
  }
  process.exit(1);
});
