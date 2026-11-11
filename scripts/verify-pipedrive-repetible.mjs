#!/usr/bin/env node
/**
 * Ítem 1 de la sesión de cierre (10/11/2026): la migración desde Pipedrive es
 * repetible con las personas que comparten correo o teléfono. Importa
 * `migracion-A.csv` y `migracion-B.csv` (los regenerados con la fusión) DOS
 * veces en «Pruebas de correo», por la subida por tandas de producción, con un
 * Admin fantasma que se suma a ese espacio y se quita al final.
 *
 * LO QUE SE MIRA, SOLO CANTIDADES Y HUELLAS (nunca filas ni nombres):
 *   - Después de la primera y de la segunda vuelta: los ids de persona de
 *     Pipedrive del espacio (cantidad y huella md5 de la lista ordenada), el
 *     control de tratos, las notas con la marca de la migración y las que
 *     dicen «Otra persona de Pipedrive…». Tienen que ser iguales.
 *   - La segunda vuelta: 0 creados.
 *   - Control positivo: las filas de A sin conflicto (su id de persona no
 *     estaba en otro contacto) quedan con su id; se cuentan.
 *
 * Nunca toca el espacio real. Se niega si el id no es de «Pruebas de correo».
 * Los contactos que crea quedan en «Pruebas de correo», como los de la
 * importación de Marcos de las 12:52: es el ensayo de la migración.
 *
 * Uso: node scripts/verify-pipedrive-repetible.mjs <id de «Pruebas de correo»>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admin, check, correr, crearUsuario, noConcluyente, sumarAlEspacio, URL_BASE } from "./lib-verificador.mjs";
import { leerCsv } from "./pipedrive-unir.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
const PRUEBAS = process.argv[2];
const REF = new URL(URL_BASE).hostname.split(".")[0];
const MAPA = {
  Nombre: "nombre",
  Correo: "correo",
  "Teléfono": "telefono",
  "Id de persona de Pipedrive": "pipedrive",
  Etapa: "etapa",
  "Estado del trato": "estado_trato",
  "Valor del trato": "valor",
  Moneda: "moneda",
  "Fecha de cierre": "fecha_cierre",
  "Id de trato de Pipedrive": "pipedrive_trato",
};

function cookieDe(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push(`${nombre}=${valor}`);
  else for (let k = 0; k * 3180 < valor.length; k++) partes.push(`${nombre}.${k}=${valor.slice(k * 3180, (k + 1) * 3180)}`);
  partes.push(`zernflow_workspace_id=${espacio}`);
  return partes.join("; ");
}
const pedir = async (u, cuerpo, ruta = "tandas", metodo = "POST") => {
  const res = await fetch(`${APP_URL}/api/v1/contacts/importar/${ruta}`, {
    method: metodo,
    headers: { Cookie: cookieDe(u, PRUEBAS), "Content-Type": "application/json", Origin: APP_URL },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
};

async function importar(u, archivo) {
  const { columnas, filas } = leerCsv(readFileSync(resolve("herramientas-locales/pipedrive", archivo), "utf8"));
  const mapeo = columnas.map((c) => MAPA[c] ?? (c.startsWith("Nota del contacto") ? "nota" : "no_importar"));
  const celdas = filas.map((f) => columnas.map((_, i) => f[i] ?? ""));
  const ini = await pedir(u, { accion: "empezar", nombreArchivo: archivo, codigoPais: "+506", asignarA: null, etiquetaOrigen: "Migrado de Pipedrive 10/11/2026", mapeo, total: celdas.length });
  if (ini.status !== 200) throw new Error(`empezar ${archivo}: HTTP ${ini.status}`);
  const id = ini.cuerpo.importacion;
  for (let n = 0; n * 500 < celdas.length; n++) {
    const r = await pedir(u, { accion: "tanda", importacion: id, numero: n, filas: celdas.slice(n * 500, (n + 1) * 500) });
    if (r.status !== 200) throw new Error(`tanda ${n} de ${archivo}: HTTP ${r.status}`);
  }
  await pedir(u, { accion: "procesar", importacion: id });
  for (let k = 0; k < 200; k++) {
    const a = await pedir(u, null, id, "GET");
    if (a.cuerpo?.terminada || a.cuerpo?.fallida) return { ...a.cuerpo, idsDePersona: celdas.map((f) => f[mapeo.indexOf("pipedrive")]).filter(Boolean) };
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw new Error(`${archivo} no terminó en 10 minutos`);
}

async function todos(ruta) {
  let filas = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await admin(`${ruta}&order=id&limit=1000&offset=${off}`);
    if (!Array.isArray(data)) throw new Error("lectura fallida");
    filas = filas.concat(data);
    if (data.length < 1000) return filas;
  }
}

async function foto() {
  const contactos = await todos(`contacts?select=id,pipedrive_person_id&workspace_id=eq.${PRUEBAS}&deleted_at=is.null`);
  const pp = contactos.map((c) => c.pipedrive_person_id).filter(Boolean).sort();
  const notas = await todos(`contact_notes?select=id,body&workspace_id=eq.${PRUEBAS}&author_label=eq.${encodeURIComponent("Migración de Pipedrive")}`);
  return {
    contactos: contactos.length,
    conIdDePersona: pp.length,
    huellaIds: createHash("md5").update(pp.join(",")).digest("hex").slice(0, 12),
    notas: notas.length,
    notasOtraPersona: notas.filter((n) => String(n.body).startsWith("Otra persona de Pipedrive")).length,
    pp: new Set(pp),
  };
}

await correr(async () => {
  if (!PRUEBAS || !APP_URL.startsWith("https://")) throw new Error("Uso: node scripts/verify-pipedrive-repetible.mjs <id de «Pruebas de correo»>, con NEXT_PUBLIC_APP_URL https");
  const ws = await admin(`workspaces?select=name&id=eq.${PRUEBAS}`);
  if (ws.data?.[0]?.name !== "Pruebas de correo") {
    noConcluyente("la prueba", "el id no es de «Pruebas de correo»: no se corre nada");
    return;
  }
  const u = await crearUsuario("pd-admin");
  await sumarAlEspacio(PRUEBAS, u, "admin");
  try {
    const antes = await foto();
    console.log(`Antes: ${antes.contactos} contactos, ${antes.conIdDePersona} con id de persona, ${antes.notas} notas de la migración`);

    console.log("\n1. Primera vuelta (A y B)");
    const a1 = await importar(u, "migracion-A.csv");
    const b1 = await importar(u, "migracion-B.csv");
    const f1 = await foto();
    console.log(`  A: ${a1.creados} creados, ${a1.actualizados} actualizados, ${a1.conError} con error; control ${JSON.stringify(a1.control)}`);
    console.log(`  B: ${b1.creados} creados, ${b1.actualizados} actualizados, ${b1.conError} con error`);
    console.log(`  Después: ${f1.contactos} contactos, ${f1.conIdDePersona} con id de persona (huella ${f1.huellaIds}), ${f1.notas} notas, ${f1.notasOtraPersona} «Otra persona…»`);
    const sinConflicto = a1.idsDePersona.filter((id) => f1.pp.has(id)).length;
    check(sinConflicto > 0, `control positivo: ${sinConflicto} de ${a1.idsDePersona.length} filas de A quedaron con su propio id de persona`);

    console.log("\n2. Segunda vuelta (A y B otra vez)");
    const a2 = await importar(u, "migracion-A.csv");
    const b2 = await importar(u, "migracion-B.csv");
    const f2 = await foto();
    console.log(`  A: ${a2.creados} creados, ${a2.actualizados} actualizados, ${a2.conError} con error; control ${JSON.stringify(a2.control)}`);
    console.log(`  Después: ${f2.contactos} contactos, ${f2.conIdDePersona} con id de persona (huella ${f2.huellaIds}), ${f2.notas} notas, ${f2.notasOtraPersona} «Otra persona…»`);
    check(a2.creados === 0 && b2.creados === 0, `la segunda vuelta no crea nada (A ${a2.creados}, B ${b2.creados})`);
    check(f2.contactos === f1.contactos, `mismos contactos (${f1.contactos} y ${f2.contactos})`);
    check(f2.huellaIds === f1.huellaIds && f2.conIdDePersona === f1.conIdDePersona, `mismos ids de persona (${f1.huellaIds} y ${f2.huellaIds})`);
    check(JSON.stringify(a2.control) === JSON.stringify(a1.control), `mismo control (${JSON.stringify(a2.control)})`);
    check(f2.notas === f1.notas && f2.notasOtraPersona === f1.notasOtraPersona, `mismas notas, sin duplicados (${f1.notas} y ${f2.notas})`);
    check(a1.control?.medido && a1.control.encontrados === a1.control.enArchivo, `el control da completo (${a1.control?.encontrados} de ${a1.control?.enArchivo})`);
  } finally {
    await admin(`workspace_members?workspace_id=eq.${PRUEBAS}&user_id=eq.${u.id}`, { method: "DELETE" });
  }
});
