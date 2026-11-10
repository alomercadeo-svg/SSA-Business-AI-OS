#!/usr/bin/env node
/**
 * F37, parte 2 (ítem 2 de la sesión de cierre, 10/11/2026): la subida por
 * tandas y el proceso en segundo plano de PRODUCCIÓN.
 *
 * DOS PARTES.
 *   A. En un espacio fantasma que el script crea y borra. Un Member recibe 403
 *      (control: el Owner empieza). Una tanda de más de 500 filas y un total de
 *      más de 10.000 se rechazan. «procesar» con una tanda sin subir da 409.
 *      Una importación de 1.200 filas (3 tandas) con dos repetidas por correo
 *      y una sin identificador: responde 202 enseguida, la barra avanza, y al
 *      terminar da 1.199 contactos (1.197 creados, 2 actualizados, 1 con
 *      error en la fila 1.201), sin duplicados. El aviso pasa por F23: el
 *      Owner fantasma es `@ssa-test.local`, así que el correo queda
 *      «omitido_prueba» (presencia del aviso, sin mandar nada).
 *   B. Solo con `--pruebas <id del espacio «Pruebas de correo»>`: 10.000 filas
 *      sintéticas con un Admin fantasma cuyo correo es `delivered+…@resend.dev`
 *      (la dirección de prueba de Resend: simula una entrega y no le llega a
 *      nadie; documentación de Resend, «Send test emails»). Se mide con la
 *      hora del reloj desde «procesar» hasta «terminada», y el correo tiene
 *      que quedar «enviado». Después se borran esos contactos, la etiqueta, la
 *      membresía y el usuario. Lo que queda en `audit_log` no se puede borrar
 *      (F31): son las altas de esos 10.000 contactos, en ese espacio de prueba.
 *
 * Nunca toca el espacio real. Se niega si el id de `--pruebas` no es de un
 * espacio llamado «Pruebas de correo».
 *
 * Uso: node scripts/verify-importacion-segundo-plano.mjs [--pruebas <workspace_id>]
 */
import { randomUUID } from "node:crypto";
import { admin, check, correr, crearUsuario, limpiar, noConcluyente, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const REF = new URL(URL_BASE).hostname.split(".")[0];
const i = process.argv.indexOf("--pruebas");
const PRUEBAS = i >= 0 ? process.argv[i + 1] : null;

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);
const hora = () => new Date().toLocaleTimeString("es-CR", { timeZone: "America/Costa_Rica", hour12: false });

function cookieDe(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let k = 0; k * 3180 < valor.length; k++) partes.push(`${nombre}.${k}=${valor.slice(k * 3180, (k + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacio}`);
  return partes.join("; ");
}

async function tandas(u, espacio, cuerpo) {
  const res = await fetch(`${APP_URL}/api/v1/contacts/importar/tandas`, {
    method: "POST",
    headers: { Cookie: cookieDe(u, espacio), "Content-Type": "application/json", Origin: APP_URL },
    body: JSON.stringify(cuerpo),
    redirect: "manual",
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}

async function avance(u, espacio, id) {
  const res = await fetch(`${APP_URL}/api/v1/contacts/importar/${id}`, { headers: { Cookie: cookieDe(u, espacio) }, redirect: "manual" });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}

/** Espera por condición (no con un sleep fijo) hasta que termina o se pasa el plazo. */
async function esperarFin(u, espacio, id, minutos) {
  const limite = Date.now() + minutos * 60_000;
  const vistos = new Set();
  let ultimo = null;
  while (Date.now() < limite) {
    const r = await avance(u, espacio, id);
    if (r.status === 200) {
      ultimo = r.cuerpo;
      vistos.add(ultimo.procesadas);
      if (ultimo.terminada || ultimo.fallida) return { fin: ultimo, vistos };
    }
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  return { fin: ultimo, vistos };
}

const MAPEO = ["nombre", "correo", "telefono", "etiquetas"];
const filasSinteticas = (n, prefijo) =>
  Array.from({ length: n }, (_, k) => [`${prefijo} ${k}`, `${prefijo.toLowerCase()}-${sufijo}-${k}@ejemplo.invalid`, "", ""]);

async function importarTodo(u, espacio, filas, etiquetaOrigen) {
  const ini = await tandas(u, espacio, { accion: "empezar", nombreArchivo: `verify-${sufijo}.csv`, codigoPais: "+506", asignarA: null, etiquetaOrigen, mapeo: MAPEO, total: filas.length });
  if (ini.status !== 200) return { ini };
  const id = ini.cuerpo.importacion;
  for (let n = 0; n * 500 < filas.length; n++) {
    const r = await tandas(u, espacio, { accion: "tanda", importacion: id, numero: n, filas: filas.slice(n * 500, (n + 1) * 500) });
    if (r.status !== 200) return { ini, id, fallaTanda: r };
  }
  const t0 = Date.now();
  const proc = await tandas(u, espacio, { accion: "procesar", importacion: id });
  return { ini, id, proc, msProcesar: Date.now() - t0 };
}

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo${PRUEBAS ? ` · y «Pruebas de correo» (${PRUEBAS.slice(0, 8)})` : ""}`);
  const owner = await crearUsuario("f37b-owner");
  const member = await crearUsuario("f37b-member");
  const espacio = owner.espacio;
  await sumarAlEspacio(espacio, member, "member");
  const vivos = async (ws, patron) =>
    (await admin(`contacts?select=id&workspace_id=eq.${ws}&deleted_at=is.null&email=ilike.${encodeURIComponent(patron)}`, { headers: { Prefer: "count=exact" } })).data?.length ?? -1;

  titulo("El rol y los límites");
  const m = await tandas(member, espacio, { accion: "empezar", mapeo: MAPEO, total: 10, codigoPais: "+506" });
  check(m.status === 403, `un Member no puede empezar una importación (HTTP ${m.status})`);
  const grande = await tandas(owner, espacio, { accion: "empezar", mapeo: MAPEO, total: 10_001, codigoPais: "+506" });
  check(grande.status === 400 && /10\.000/.test(grande.cuerpo?.error ?? ""), `más de 10.000 filas se rechaza con el motivo (HTTP ${grande.status})`);
  const chica = await tandas(owner, espacio, { accion: "empezar", nombreArchivo: "x.csv", mapeo: MAPEO, total: 600, codigoPais: "+506" });
  check(chica.status === 200 && chica.cuerpo?.tandas === 2 && chica.cuerpo?.enSegundoPlano === true, `control: el Owner sí empieza, 600 filas son 2 tandas en segundo plano (HTTP ${chica.status})`);
  if (chica.status === 200) {
    const id = chica.cuerpo.importacion;
    const t501 = await tandas(owner, espacio, { accion: "tanda", importacion: id, numero: 0, filas: filasSinteticas(501, "X") });
    check(t501.status === 400, `una tanda de 501 filas se rechaza (HTTP ${t501.status})`);
    const t0 = await tandas(owner, espacio, { accion: "tanda", importacion: id, numero: 0, filas: filasSinteticas(500, "X") });
    check(t0.status === 200, `control: una tanda de 500 filas entra (HTTP ${t0.status})`);
    const sinTodas = await tandas(owner, espacio, { accion: "procesar", importacion: id });
    check(sinTodas.status === 409, `«procesar» con una tanda sin subir da 409 y no procesa (HTTP ${sinTodas.status})`);
    const ajena = await tandas(member, espacio, { accion: "tanda", importacion: id, numero: 1, filas: filasSinteticas(10, "X") });
    check(ajena.status === 403, `un Member no puede subir tandas a la importación del Owner (HTTP ${ajena.status})`);
    check((await vivos(espacio, `x-${sufijo}-%`)) === 0, "nada de esa importación sin procesar llegó a contactos");
  }

  titulo("1.200 filas en segundo plano, con repetidas y una sin identificador");
  const filas = filasSinteticas(1200, "S");
  filas[700][1] = filas[3][1].toUpperCase(); // repetida por correo (otra tanda)
  filas[1100][1] = filas[1099][1]; // repetida en la misma tanda
  filas[1200 - 1] = ["Sin datos", "", "", ""]; // la última: número de fila 1.201 (la 2 es la primera de datos)
  const imp = await importarTodo(owner, espacio, filas, `Verify F37 ${sufijo}`);
  check(imp.proc?.status === 202, `«procesar» responde 202 sin esperar (HTTP ${imp.proc?.status}, ${imp.msProcesar} ms)`);
  if (imp.proc?.status !== 202) return;
  const { fin, vistos } = await esperarFin(owner, espacio, imp.id, 15);
  check(Boolean(fin?.terminada), `termina (estado ${fin?.estado})`);
  check([...vistos].some((v) => v > 0 && v < 1200), `la barra pasó por valores intermedios (${[...vistos].sort((a, b) => a - b).join(", ")})`);
  check(fin?.creados === 1197 && fin?.actualizados === 2 && fin?.conError === 1, `1.197 creados, 2 actualizados, 1 con error (${fin?.creados}, ${fin?.actualizados}, ${fin?.conError})`);
  check(fin?.lineas?.some((l) => l.numero === 1201), `la fila sin identificador se informa con su número de fila del archivo (${JSON.stringify(fin?.lineas?.map((l) => l.numero))})`);
  const enBase = await vivos(espacio, `s-${sufijo}-%`);
  check(enBase === 1197, `en la base, 1.197 contactos con correo de la prueba: sin duplicados (${enBase})`);
  const correo = await admin(`email_log?select=estado,tipo,para&workspace_id=eq.${espacio}&tipo=eq.importacion`);
  check(correo.data?.length === 1 && correo.data[0].estado === "omitido_prueba", `el aviso de F23 pasó una vez (a una dirección de prueba: ${JSON.stringify(correo.data?.map((c) => c.estado))})`);
  const reimp = await tandas(owner, espacio, { accion: "procesar", importacion: imp.id });
  await new Promise((ok) => setTimeout(ok, 5000));
  const correo2 = await admin(`email_log?select=id&workspace_id=eq.${espacio}&tipo=eq.importacion`);
  check(correo2.data?.length === 1, `pedir «procesar» otra vez no vuelve a avisar (HTTP ${reimp.status}; avisos ${correo2.data?.length})`);

  if (!PRUEBAS) {
    console.log("\n(Sin --pruebas: la prueba de 10.000 filas en «Pruebas de correo» no corrió.)");
    return;
  }

  titulo("10.000 filas en «Pruebas de correo», con el correo real al que importa");
  const ws = await admin(`workspaces?select=id,name&id=eq.${PRUEBAS}`);
  if (ws.data?.[0]?.name !== "Pruebas de correo") {
    noConcluyente("la prueba de 10.000 filas", "el id de --pruebas no es de un espacio llamado «Pruebas de correo»: no se corre nada ahí");
    return;
  }
  // Un Admin fantasma con la dirección de prueba de Resend.
  const email = `delivered+f37-${sufijo}@resend.dev`;
  const password = `Probe-${randomUUID()}`;
  const alta = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Verify F37 ${sufijo}` } }),
  }).then((r) => r.json());
  if (!alta?.id) throw new Error("no se pudo crear el Admin fantasma");
  limpiar.usuarios.push(alta.id);
  for (let k = 0; k < 10; k++) {
    const { data } = await admin(`workspace_members?select=workspace_id&user_id=eq.${alta.id}`);
    if (data?.[0]) {
      limpiar.workspaces.push(data[0].workspace_id);
      break;
    }
    await new Promise((ok) => setTimeout(ok, 400));
  }
  const ses = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  const adminF = { id: alta.id, email, sesion: ses };
  await sumarAlEspacio(PRUEBAS, adminF, "admin");
  const etiqueta = `Verify F37 10k ${sufijo}`;
  const grandes = filasSinteticas(10_000, "D");
  console.log(`  subiendo 20 tandas desde las ${hora()}`);
  const imp10 = await importarTodo(adminF, PRUEBAS, grandes, etiqueta);
  const desde = hora();
  const t0 = Date.now();
  check(imp10.proc?.status === 202, `«procesar» responde 202 (HTTP ${imp10.proc?.status})`);
  try {
    if (imp10.proc?.status === 202) {
      const r = await esperarFin(adminF, PRUEBAS, imp10.id, 45);
      const min = ((Date.now() - t0) / 60_000).toFixed(1);
      console.log(`  medición: de las ${desde} a las ${hora()} (hora de Costa Rica), ${min} min`);
      check(Boolean(r.fin?.terminada), `termina (estado ${r.fin?.estado})`);
      check((Date.now() - t0) < 30 * 60_000, `en menos de 30 minutos (${min} min)`);
      check(r.fin?.creados === 10_000 && r.fin?.conError === 0, `10.000 creados, 0 con error (${r.fin?.creados}, ${r.fin?.conError})`);
      let enviado = null;
      for (let k = 0; k < 20 && !enviado; k++) {
        const c = await admin(`email_log?select=estado,para&workspace_id=eq.${PRUEBAS}&tipo=eq.importacion&order=created_at.desc&limit=5`);
        enviado = c.data?.find((x) => (x.para ?? []).includes(email) && x.estado === "enviado") ?? null;
        if (!enviado) await new Promise((ok) => setTimeout(ok, 3000));
      }
      check(Boolean(enviado), "el correo de fin salió por Resend a quien importó, y a nadie más");
    }
  } finally {
    // Limpieza de lo de esta prueba en «Pruebas de correo»: los contactos con el
    // correo de la prueba, la etiqueta y la membresía del Admin fantasma.
    let borrados = 0;
    for (;;) {
      const { data } = await admin(`contacts?select=id&workspace_id=eq.${PRUEBAS}&email=ilike.${encodeURIComponent(`d-${sufijo}-%`)}&limit=500`);
      if (!data?.length) break;
      await admin(`contacts?id=in.(${data.map((c) => c.id).join(",")})`, { method: "DELETE" });
      borrados += data.length;
    }
    await admin(`tags?workspace_id=eq.${PRUEBAS}&name=eq.${encodeURIComponent(etiqueta)}`, { method: "DELETE" });
    await admin(`workspace_members?workspace_id=eq.${PRUEBAS}&user_id=eq.${alta.id}`, { method: "DELETE" });
    const quedan = (await admin(`contacts?select=id&workspace_id=eq.${PRUEBAS}&email=ilike.${encodeURIComponent(`d-${sufijo}-%`)}`)).data?.length;
    check(quedan === 0, `se borraron los ${borrados} contactos de la prueba de «Pruebas de correo» (quedan ${quedan})`);
  }
});
