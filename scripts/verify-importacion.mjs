#!/usr/bin/env node
/**
 * F37, parte 1: `POST /api/v1/contacts/importar` de PRODUCCIÓN, en un espacio
 * fantasma que el script crea y borra. Nunca en el espacio real.
 *
 * EL ESCENARIO. Un Owner (con su espacio fantasma) y un Member; tres contactos
 * previos: A (con correo), B (con teléfono) y C (con correo, eliminado); la
 * etiqueta «vip». Las filas van ya separadas en celdas, como las manda la
 * pantalla: leer el CSV (punto y coma, BOM, comillas) lo prueban los tests de
 * `lib/importacion-csv.test.ts`, no este script.
 *
 * LO QUE SE MIRA. El Member recibe 403 (control positivo: el Owner importa).
 * Siete filas: una nueva, una con el correo de A (actualiza), una con el
 * teléfono de B (actualiza), una con id de Pipedrive (nueva), una sin
 * identificador, una con «8856-12» (no normaliza) y una con el correo de C
 * (está en Eliminados): 2 creados, 2 actualizados, 3 con error, y los
 * contactos del espacio pasan de 3 a 5. Importar lo mismo otra vez: 0
 * creados. La fila de `csv_imports` terminada, y `importacion.completada` en
 * el historial.
 *
 * EL ROJO, antes del código: la ruta no existe (404). Es un rojo de carga y no
 * cuenta por su motivo (regla del 03/11); el rojo por su motivo se vio en los
 * tests de `lib/importacion-csv.test.ts`, `lib/importacion-contactos.test.ts` y
 * la guarda de rol de `route.test.ts`.
 *
 * Uso: node scripts/verify-importacion.mjs
 */
import { admin, check, correr, crearContacto, crearUsuario, noConcluyente, sufijo, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const REF = new URL(URL_BASE).hostname.split(".")[0];

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

async function importar(u, espacio, filas, etiquetaOrigen = null) {
  const res = await fetch(`${APP_URL}/api/v1/contacts/importar`, {
    method: "POST",
    headers: { Cookie: cookieDe(u, espacio), "Content-Type": "application/json", Origin: APP_URL },
    body: JSON.stringify({ nombreArchivo: `verify-${sufijo}.csv`, codigoPais: "+506", asignarA: null, etiquetaOrigen, mapeo: ["nombre", "correo", "telefono", "pipedrive", "etiquetas"], filas }),
    redirect: "manual",
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}

const contar = async (q) => (await admin(q)).data?.length ?? -1;

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo`);
  const owner = await crearUsuario("f37-owner");
  const member = await crearUsuario("f37-member");
  const espacio = owner.espacio;
  await sumarAlEspacio(espacio, member, "member");

  const telB = `+5067${String(Date.now()).slice(-7)}`;
  await crearContacto(espacio, { display_name: `A ${sufijo}`, email: `a-${sufijo}@ejemplo.invalid` });
  await crearContacto(espacio, { display_name: `B ${sufijo}`, phone: telB });
  await crearContacto(espacio, { display_name: `C ${sufijo}`, email: `c-${sufijo}@ejemplo.invalid`, deleted_at: new Date().toISOString() });
  await admin("tags", { method: "POST", body: JSON.stringify({ workspace_id: espacio, name: "vip" }) });
  const vivos = () => contar(`contacts?select=id&workspace_id=eq.${espacio}&deleted_at=is.null`);
  const antes = await vivos();
  check(antes === 2, `presencia: el espacio arranca con 2 contactos vivos y 1 eliminado (${antes})`);

  const filas = [
    [`Nueva ${sufijo}`, `nueva-${sufijo}@ejemplo.invalid`, "", "", "vip"],
    [`A nombre nuevo ${sufijo}`, `A-${sufijo}@ejemplo.invalid`, "", "", ""],
    ["", "", telB.replace("+506", ""), "", ""],
    [`Pipedrive ${sufijo}`, "", "", `pd-${sufijo}`, ""],
    ["Sin datos", "", "", "", ""],
    ["Teléfono malo", "", "8856-12", "", ""],
    [`C de nuevo ${sufijo}`, `c-${sufijo}@ejemplo.invalid`, "", "", ""],
  ];

  titulo("Un Member no importa (esta noche, solo Owner y Admin)");
  const rM = await importar(member, espacio, filas);
  check(rM.status === 403 && rM.cuerpo?.code === "solo_managers", "403 solo_managers", `HTTP ${rM.status} ${JSON.stringify(rM.cuerpo)}`);
  check((await vivos()) === antes, "no se creó ningún contacto");

  titulo("El Owner importa siete filas (control positivo del rol)");
  const r1 = await importar(owner, espacio, filas);
  const ok1 = check(r1.status === 200, "200", `HTTP ${r1.status} ${JSON.stringify(r1.cuerpo)}`);
  if (!ok1) {
    noConcluyente("lo que importó", "la importación no respondió 200");
    return;
  }
  check(r1.cuerpo.creados === 2 && r1.cuerpo.actualizados === 2 && r1.cuerpo.conError === 3, "2 creados, 2 actualizados, 3 con error", JSON.stringify(r1.cuerpo));
  check(r1.cuerpo.usaronCodigo === 1, "1 usó el código de país por defecto (el teléfono de B sin código)", JSON.stringify(r1.cuerpo));
  check((await vivos()) === antes + 2, "los contactos vivos pasan de 2 a 4");
  const lineas = r1.cuerpo.lineas ?? [];
  check(lineas.some((l) => l.que.startsWith("No tiene correo, teléfono ni id de Pipedrive")), "la fila sin identificador dice por qué");
  check(lineas.some((l) => l.que.includes("«8856-12» no se puede normalizar")), "el teléfono malo, con el texto de §11");
  check(lineas.some((l) => l.que.includes("está en Eliminados")), "el que coincide con un eliminado no se restaura ni se duplica");
  const a = (await admin(`contacts?select=display_name,email&workspace_id=eq.${espacio}&email=eq.a-${sufijo}@ejemplo.invalid`)).data ?? [];
  check(a.length === 1 && a[0].display_name === `A nombre nuevo ${sufijo}`, "A se actualizó por su correo (sin distinguir mayúsculas), sin duplicarse", JSON.stringify(a));
  check((await contar(`contacts?select=id&workspace_id=eq.${espacio}&phone=eq.${encodeURIComponent(telB)}`)) === 1, "B no se duplicó por su teléfono");
  check((await contar(`contact_tags?select=contact_id,contacts!inner(workspace_id)&contacts.workspace_id=eq.${espacio}`)) === 1, "la etiqueta «vip» quedó en la nueva");

  titulo("Importar lo mismo otra vez: 0 creados");
  const r2 = await importar(owner, espacio, filas);
  check(r2.status === 200 && r2.cuerpo?.creados === 0, "0 creados", JSON.stringify(r2.cuerpo));
  check((await vivos()) === antes + 2, "siguen 4 contactos vivos");

  titulo("La etiqueta de origen se crea la primera vez y va en cada importado (retrabajo del 09/11, a)");
  const ORIGEN = `Origen ${sufijo}`;
  const tagsAntes = await contar(`tags?select=id&workspace_id=eq.${espacio}`);
  const r3 = await importar(owner, espacio, filas, ORIGEN);
  const tagOrigen = (await admin(`tags?select=id&workspace_id=eq.${espacio}&name=eq.${encodeURIComponent(ORIGEN)}`)).data ?? [];
  check(r3.status === 200 && tagOrigen.length === 1 && (await contar(`tags?select=id&workspace_id=eq.${espacio}`)) === tagsAntes + 1, "se creó una sola etiqueta, la de origen", JSON.stringify({ status: r3.status, tagOrigen }));
  check(tagOrigen.length === 1 && (await contar(`contact_tags?select=contact_id&tag_id=eq.${tagOrigen[0]?.id}`)) === 4, "va en los 4 importados (no en las 3 filas con error)");
  const r4 = await importar(owner, espacio, filas, ORIGEN);
  check(r4.status === 200 && (await contar(`tags?select=id&workspace_id=eq.${espacio}`)) === tagsAntes + 1, "la segunda vez no crea otra");

  titulo("El registro y el historial");
  const imp = (await admin(`csv_imports?select=estado,filas,creados,actualizados,con_error&workspace_id=eq.${espacio}&order=created_at.asc`)).data ?? [];
  check(imp.length === 4 && imp[0].estado === "terminada" && imp[0].filas === 7 && imp[0].creados === 2, "cuatro importaciones en csv_imports, la primera terminada con sus totales", JSON.stringify(imp));
  check((await contar(`audit_log?select=id&workspace_id=eq.${espacio}&action=eq.importacion.completada`)) === 4, "importacion.completada en el historial, una por importación");
  check((await contar(`audit_log?select=id&workspace_id=eq.${espacio}&action=eq.contacto.creado`)) === 2, "contacto.creado por cada creado");
}, async () => {
  // La limpieza de `correr` borra los espacios: `csv_imports` se va en cascada.
});
