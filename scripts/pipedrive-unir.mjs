#!/usr/bin/env node
/**
 * F38, criterio 2 (10/11/2026): la unión de los dos exports de Pipedrive
 * (Personas y Tratos), FUERA del sistema. Produce los archivos que se importan
 * desde «Contactos › Importar CSV», con una fila por persona.
 *
 * Está en `scripts/` (versionado, fuera de `app/`, `lib/` y del
 * `package.json`), pero los datos reales viven y se quedan en
 * `herramientas-locales/pipedrive/`, que git ignora. **Nunca imprime filas de
 * datos:** solo conteos, nombres de columna y, cuando algo no se puede leer,
 * la forma del valor (cada dígito como 9, cada letra como «a»), que no es dato.
 *
 * Lo que hace:
 *   - Descarta los tratos con «IG DM» en el título (los trae Instagram).
 *   - Frena si una persona tiene más de un trato que no es «IG DM» (el plano
 *     supone uno por persona y el control depende de eso).
 *   - Aplana el trato en la persona: etapa, estado (abierto, ganado o perdido),
 *     valor, moneda, fecha de cierre (AAAA-MM-DD), id del trato, y el motivo de
 *     pérdida como «Nota del contacto».
 *   - El teléfono sale de «Móvil» y, si está vacío, de «Trabajo». La limpieza
 *     (apóstrofe e invisibles) la hace el importador, no este script.
 *   - Antes de escribir, compara cada etapa y cada estado con las listas de la
 *     base (`00030`, líneas 41 a 60) y frena si alguno no coincide; lo mismo si
 *     un valor no es un número o una fecha no se puede leer. No mapea nada que
 *     no esté en la lista: un estado como «eliminado» frena y se pregunta.
 *   - Escribe dos archivos de 500 filas o menos: A con todas las personas con
 *     trato (así el control de A es el del plano) más las sin trato que entren,
 *     y B con el resto.
 *
 * Uso:
 *   node scripts/pipedrive-unir.mjs
 *   node scripts/pipedrive-unir.mjs --personas <csv> --tratos <csv> --salida <carpeta>
 * Por defecto busca en `herramientas-locales/pipedrive/` un archivo con
 * «person» o «persona» en el nombre y otro con «deal» o «trato», y escribe ahí
 * `migracion-A.csv` y `migracion-B.csv`. Sale con 1 si frena.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** `00030_contacto_estado_comercial.sql`, líneas 41 a 54. */
export const ETAPAS = [
  "1. Nuevo contacto",
  "2. Le escribí",
  "3. Respondió",
  "4. ¿Es mi cliente?",
  "5. Le ofrecí una cita",
  "6. Agendó",
  "7. Confirmó asistencia",
  "8. No llegó",
  "9. Reagendó",
  "11. Seguimiento intensivo",
  "12. En espera de pago",
  "13. ¡Cerrada!",
  "14. Repesca",
];
/** El estado de Pipedrive → el de `00030`, línea 59. Solo estos; cualquier otro frena. */
const ESTADOS = new Map([
  ["abierto", "abierto"],
  ["open", "abierto"],
  ["ganado", "ganado"],
  ["won", "ganado"],
  ["perdido", "perdido"],
  ["lost", "perdido"],
]);

export const MAX_FILAS = 500;
export const COLUMNAS_DE_SALIDA = [
  "Nombre",
  "Correo",
  "Teléfono",
  "Id de persona de Pipedrive",
  "Etapa",
  "Estado del trato",
  "Valor del trato",
  "Moneda",
  "Fecha de cierre",
  "Id de trato de Pipedrive",
  "Nota del contacto",
];

// ---------- CSV ----------

function detectarSeparador(texto) {
  let comas = 0;
  let pyc = 0;
  let enComillas = false;
  for (const c of texto) {
    if (c === '"') enComillas = !enComillas;
    else if (!enComillas && (c === "\n" || c === "\r")) break;
    else if (!enComillas && c === ",") comas++;
    else if (!enComillas && c === ";") pyc++;
  }
  return pyc > comas ? ";" : ",";
}

export function leerCsv(texto) {
  const limpio = texto.replace(/^﻿/, "");
  const sep = detectarSeparador(limpio);
  const registros = [];
  let registro = [];
  let campo = "";
  let enComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') enComillas = true;
    else if (c === sep) {
      registro.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      registro.push(campo);
      registros.push(registro);
      registro = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || registro.length) {
    registro.push(campo);
    registros.push(registro);
  }
  const conDatos = registros.filter((r) => r.some((v) => v.trim() !== ""));
  const [columnas = [], ...filas] = conDatos;
  return { columnas: columnas.map((c) => c.trim()), filas };
}

const celda = (v) => (/[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const escribirCsv = (columnas, filas) => [columnas, ...filas].map((f) => f.map((v) => celda(v ?? "")).join(",")).join("\n") + "\n";

// ---------- Columnas ----------

const clave = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(persona|person|trato|deal)\s*-\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** El índice de la primera columna cuyo nombre (sin prefijo «Persona - » ni «Trato - ») está en la lista. */
function columna(columnas, candidatos) {
  const claves = columnas.map(clave);
  for (const c of candidatos) {
    const i = claves.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

const forma = (v) => v.replace(/[0-9]/g, "9").replace(/[A-Za-zÀ-ÿ]/g, "a").slice(0, 30);

class Freno extends Error {}

/** Lee una fecha de Pipedrive y la devuelve como AAAA-MM-DD, o null. */
function fecha(v) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(v);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$/.exec(v);
  const [a, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2].padStart(2, "0"), dmy[1].padStart(2, "0")] : [];
  if (!a) return null;
  const f = new Date(`${a}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== `${a}-${m}-${d}` ? null : `${a}-${m}-${d}`;
}

/**
 * La unión. Recibe el texto de los dos CSV y devuelve las filas de salida y
 * los conteos; tira `Freno` con el motivo (sin datos) si algo no cuadra.
 */
export function unir(textoPersonas, textoTratos) {
  const P = leerCsv(textoPersonas);
  const T = leerCsv(textoTratos);
  const falta = (archivo, cols, que) => {
    throw new Freno(`En ${archivo} no encuentro la columna de ${que}. Columnas del archivo: ${cols.join(" | ")}`);
  };

  const p = {
    id: columna(P.columnas, ["id", "person id", "id de persona"]),
    nombre: columna(P.columnas, ["nombre", "name"]),
    movil: columna(P.columnas, ["telefono movil", "phone mobile", "movil", "mobile"]),
    trabajo: columna(P.columnas, ["telefono trabajo", "phone work", "trabajo", "work"]),
    correos: P.columnas.map((c, i) => [clave(c), i]).filter(([k]) => /^(correo electronico|email|e mail|correo)\b/.test(k)).map(([, i]) => i),
  };
  if (p.id < 0) falta("Personas", P.columnas, "id");
  if (p.nombre < 0) falta("Personas", P.columnas, "nombre");
  if (p.movil < 0) falta("Personas", P.columnas, "teléfono «Móvil»");
  if (p.trabajo < 0) falta("Personas", P.columnas, "teléfono «Trabajo»");

  const t = {
    id: columna(T.columnas, ["id", "deal id", "id de trato"]),
    titulo: columna(T.columnas, ["titulo", "title"]),
    persona: columna(T.columnas, ["id de persona", "persona de contacto id", "person id", "contact person id", "persona id"]),
    etapa: columna(T.columnas, ["etapa", "stage"]),
    estado: columna(T.columnas, ["estado", "status"]),
    valor: columna(T.columnas, ["valor", "value"]),
    moneda: columna(T.columnas, ["moneda", "currency", "moneda del valor"]),
    cierre: columna(T.columnas, ["fecha de cierre", "close time", "fecha de cierre real"]),
    motivo: columna(T.columnas, ["motivo de perdida", "lost reason", "razon de perdida"]),
  };
  for (const [k, que] of [
    ["id", "id del trato"],
    ["titulo", "título"],
    ["persona", "id de la persona"],
    ["etapa", "etapa"],
    ["estado", "estado"],
    ["valor", "valor"],
    ["moneda", "moneda"],
    ["cierre", "fecha de cierre"],
    ["motivo", "motivo de pérdida"],
  ]) {
    if (t[k] < 0) falta("Tratos", T.columnas, que);
  }

  const c = { personas: P.filas.length, tratos: T.filas.length, igdm: 0, sinPersona: 0, personaInexistente: 0, aplanados: 0, conLosDosTelefonos: 0, sinTelefonoNiCorreo: 0 };
  const idsDePersona = new Set(P.filas.map((f) => (f[p.id] ?? "").trim()));
  const tratosPorPersona = new Map();
  for (const f of T.filas) {
    const v = (i) => (f[i] ?? "").trim();
    if (/ig\s*dm/i.test(v(t.titulo))) {
      c.igdm++;
      continue;
    }
    const persona = v(t.persona);
    if (!persona) {
      c.sinPersona++;
      continue;
    }
    if (!idsDePersona.has(persona)) {
      c.personaInexistente++;
      continue;
    }
    if (!tratosPorPersona.has(persona)) tratosPorPersona.set(persona, []);
    tratosPorPersona.get(persona).push(f);
  }
  const conVarios = [...tratosPorPersona.values()].filter((l) => l.length > 1).length;
  if (conVarios > 0) {
    throw new Freno(`${conVarios} personas tienen más de un trato que no es «IG DM». El plano supone uno por persona y el control depende de eso: hay que decidir qué hacer antes de seguir.`);
  }

  // Etapas, estados, valores y fechas: todo se compara antes de escribir.
  const malas = { etapa: new Map(), estado: new Map(), valor: new Map(), fecha: new Map() };
  const sumar = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const salida = [];
  for (const f of P.filas) {
    const v = (i) => (i >= 0 ? (f[i] ?? "").trim() : "");
    const id = v(p.id);
    const movil = v(p.movil);
    const trabajo = v(p.trabajo);
    if (movil && trabajo) c.conLosDosTelefonos++;
    const telefono = movil || trabajo;
    const correo = p.correos.map((i) => v(i)).find(Boolean) ?? "";
    if (!telefono && !correo) c.sinTelefonoNiCorreo++;
    const fila = [v(p.nombre), correo, telefono, id, "", "", "", "", "", "", ""];
    const trato = tratosPorPersona.get(id)?.[0];
    if (trato) {
      const w = (i) => (trato[i] ?? "").trim();
      const etapa = w(t.etapa);
      if (etapa && !ETAPAS.includes(etapa)) sumar(malas.etapa, etapa);
      const estadoCrudo = w(t.estado);
      const estado = ESTADOS.get(estadoCrudo.toLowerCase());
      if (estadoCrudo && !estado) sumar(malas.estado, estadoCrudo);
      const valor = w(t.valor);
      if (valor && !/^-?\d+(\.\d+)?$/.test(valor)) sumar(malas.valor, forma(valor));
      const cierreCrudo = w(t.cierre);
      const cierre = cierreCrudo ? fecha(cierreCrudo) : "";
      if (cierreCrudo && !cierre) sumar(malas.fecha, forma(cierreCrudo));
      const motivo = w(t.motivo);
      fila[4] = etapa;
      fila[5] = estado ?? "";
      fila[6] = valor;
      fila[7] = w(t.moneda);
      fila[8] = cierre ?? "";
      fila[9] = w(t.id);
      fila[10] = motivo ? `Motivo de pérdida en Pipedrive: ${motivo}` : "";
      c.aplanados++;
    }
    salida.push(fila);
  }
  const problemas = [];
  for (const [k, l] of malas.etapa) problemas.push(`la etapa «${k}» no está en la lista de la base (${l} filas)`);
  for (const [k, l] of malas.estado) problemas.push(`el estado «${k}» no es abierto, ganado ni perdido (${l} filas): ¿cómo se mapea?`);
  for (const [k, l] of malas.valor) problemas.push(`un valor con la forma «${k}» no se lee como número (${l} filas)`);
  for (const [k, l] of malas.fecha) problemas.push(`una fecha de cierre con la forma «${k}» no se puede leer (${l} filas)`);
  if (problemas.length) throw new Freno(`No escribo los archivos:\n  - ${problemas.join("\n  - ")}`);

  // A: todas las personas con trato y las sin trato que entren; B: el resto.
  const conTrato = salida.filter((f) => f[9]);
  const sinTrato = salida.filter((f) => !f[9]);
  if (conTrato.length > MAX_FILAS) throw new Freno(`Hay ${conTrato.length} personas con trato: no entran en un archivo de ${MAX_FILAS}.`);
  const a = [...conTrato, ...sinTrato.slice(0, MAX_FILAS - conTrato.length)];
  const b = sinTrato.slice(MAX_FILAS - conTrato.length);
  if (b.length > MAX_FILAS) throw new Freno(`El archivo B tendría ${b.length} filas, más de ${MAX_FILAS}.`);
  return { a, b, conteos: c, columnasPersonas: P.columnas, columnasTratos: T.columnas };
}

// ---------- Uso desde la terminal ----------

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function buscar(carpeta, patron) {
  const candidatos = readdirSync(carpeta).filter((n) => n.toLowerCase().endsWith(".csv") && patron.test(n.toLowerCase()) && !n.startsWith("migracion-"));
  if (candidatos.length !== 1) throw new Freno(`En ${carpeta} esperaba un solo CSV que coincida con ${patron} y hay ${candidatos.length}. Pasalo con --personas / --tratos.`);
  return join(carpeta, candidatos[0]);
}

async function principal() {
  const carpeta = resolve(argumento("salida") ?? "herramientas-locales/pipedrive");
  const personas = argumento("personas") ?? buscar(carpeta, /person|persona/);
  const tratos = argumento("tratos") ?? buscar(carpeta, /deal|trato/);
  const r = unir(readFileSync(personas, "utf8"), readFileSync(tratos, "utf8"));
  const k = r.conteos;
  console.log(`Columnas de Personas: ${r.columnasPersonas.join(" | ")}`);
  console.log(`Columnas de Tratos: ${r.columnasTratos.join(" | ")}`);
  console.log(`Personas: ${k.personas} (el plano espera 526)`);
  console.log(`Tratos: ${k.tratos} (el plano espera 517)`);
  console.log(`«IG DM» descartados: ${k.igdm} (el plano espera 118)`);
  console.log(`Tratos aplanados: ${k.aplanados} (el plano espera 399)`);
  console.log(`Tratos que no son «IG DM» sin persona: ${k.sinPersona}; con una persona que no está en el export: ${k.personaInexistente}`);
  console.log(`Personas con Móvil y Trabajo a la vez: ${k.conLosDosTelefonos} (se usó Móvil); sin teléfono ni correo: ${k.sinTelefonoNiCorreo}`);
  const rutaA = join(carpeta, "migracion-A.csv");
  const rutaB = join(carpeta, "migracion-B.csv");
  writeFileSync(rutaA, escribirCsv(COLUMNAS_DE_SALIDA, r.a));
  writeFileSync(rutaB, escribirCsv(COLUMNAS_DE_SALIDA, r.b));
  console.log(`Escrito: ${rutaA} (${r.a.length} filas, ${r.a.filter((f) => f[9]).length} con trato) y ${rutaB} (${r.b.length} filas)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  principal().catch((e) => {
    console.error(e instanceof Freno ? `FRENO: ${e.message}` : e);
    process.exit(1);
  });
}
