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
 *   - Una persona con más de un trato que no es «IG DM» (decisión de Marcos del
 *     10/11/2026): a la ficha va el abierto; entre varios abiertos, el creado
 *     más recientemente; sin abiertos, el cerrado más reciente según «Trato
 *     cerrado el» (o la creación, si falta). Los demás van como notas «Trato
 *     anterior en Pipedrive: …», en columnas «Nota del contacto 2», 3…, y la
 *     cuenta tiene que cerrar: ficha + nota + sin persona = no «IG DM».
 *   - Aplana el trato en la persona: etapa, estado (abierto, ganado o perdido),
 *     valor, moneda, fecha de cierre (AAAA-MM-DD), id del trato, y el motivo de
 *     pérdida como «Nota del contacto».
 *   - El teléfono sale de «Móvil» y, si está vacío, de «Trabajo». La limpieza
 *     (apóstrofe e invisibles) la hace el importador, no este script.
 *   - Personas que comparten correo o teléfono (ítem 1 de la sesión de cierre,
 *     decisión de Marcos del 10/11/2026): gana la primera, la del ID de
 *     Pipedrive más bajo. El correo se compara sin mayúsculas y el teléfono ya
 *     limpio y normalizado con el mismo código de país por defecto que usa la
 *     importación (`telefonoParaComparar`, con un test que lo compara contra
 *     `prepararFila`). La unión es transitiva. El grupo queda en una sola
 *     fila con el ID de la primera; el trato de la ficha sale con la regla de
 *     arriba entre los tratos de todo el grupo, los demás son notas «Trato
 *     anterior en Pipedrive: …», y por cada persona fusionada va una nota
 *     «Otra persona de Pipedrive con el mismo correo o teléfono: <nombre>, ID
 *     <id>». El correo y el teléfono de la fila son los de la primera; si le
 *     faltan, los de la siguiente del grupo que los tenga.
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
 *   node scripts/pipedrive-unir.mjs --personas <csv> --tratos <csv> --salida <carpeta> [--codigo-pais +506]
 * Por defecto busca en `herramientas-locales/pipedrive/` un archivo con
 * «person», «persona» o «people» en el nombre y otro con «deal» o «trato», y escribe ahí
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
/** Las columnas fijas de salida; después van «Nota del contacto», «Nota del contacto 2», … */
export const COLUMNAS_BASE = [
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

// ---------- Teléfono, igual que la importación ----------
// Copia de `limpiarTelefono` y de la rama del teléfono de `prepararFila`
// (`lib/importacion-csv.ts`) y de `normalizarTelefono` (`lib/telefono.ts`).
// Está copiada porque este script corre con `node` sin compilar TypeScript; el
// test «el teléfono se normaliza igual que en la importación» la compara
// contra `prepararFila` y se pone en rojo si una de las dos cambia.
const INVISIBLES_DE_DIRECCION = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const SEPARADORES = /[\s\-.()]/g;
const E164 = /^\+[1-9][0-9]{0,14}$/;

/** El teléfono E.164 que guardaría la importación con ese código por defecto, o null. */
export function telefonoParaComparar(entrada, codigoPais) {
  if (typeof entrada !== "string" || !entrada.trim()) return null;
  const crudo = entrada.trim().replace(INVISIBLES_DE_DIRECCION, "").trim().replace(/^'+/, "").trim();
  const sinEspacios = crudo.replace(/[\s\-.()]/g, "");
  let candidato = sinEspacios;
  let usoCodigo = false;
  if (candidato.startsWith("00")) candidato = `+${candidato.slice(2)}`;
  else if (!candidato.startsWith("+")) {
    candidato = `${codigoPais}${candidato}`;
    usoCodigo = true;
  }
  const limpio = candidato.replace(SEPARADORES, "");
  const normalizado = E164.test(limpio) ? limpio : null;
  const nacional = usoCodigo ? sinEspacios.replace(/^\+/, "") : null;
  const corto = nacional !== null ? nacional.length < 7 : (normalizado ?? "").length - 1 < 8;
  if (!normalizado || corto || !/^\+?[0-9\s\-.()]+$/.test(crudo)) return null;
  return normalizado;
}

/** El orden de los ID de Pipedrive: numérico si los dos son números («9» antes que «10»). */
const compararId = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0);

/** Lee una fecha de Pipedrive y la devuelve como AAAA-MM-DD, o null. */
function fecha(v) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(v);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$/.exec(v);
  const [a, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2].padStart(2, "0"), dmy[1].padStart(2, "0")] : [];
  if (!a) return null;
  const f = new Date(`${a}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== `${a}-${m}-${d}` ? null : `${a}-${m}-${d}`;
}

/** Un momento de Pipedrive como «AAAA-MM-DD HH:MM:SS», que se ordena como texto; o null. */
function instante(v) {
  const dia = fecha(v);
  if (!dia) return null;
  const hora = /(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  return `${dia} ${hora ? `${hora[1].padStart(2, "0")}:${hora[2]}:${hora[3] ?? "00"}` : "00:00:00"}`;
}

/**
 * La unión. Recibe el texto de los dos CSV y devuelve las filas de salida y
 * los conteos; tira `Freno` con el motivo (sin datos) si algo no cuadra.
 */
export function unir(textoPersonas, textoTratos, { codigoPais = "+506" } = {}) {
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
    persona: columna(T.columnas, ["id de la persona de contacto", "id de persona", "persona de contacto id", "person id", "contact person id", "persona id"]),
    etapa: columna(T.columnas, ["etapa", "stage"]),
    estado: columna(T.columnas, ["estado", "status"]),
    valor: columna(T.columnas, ["valor", "value"]),
    moneda: columna(T.columnas, ["moneda de valor", "moneda", "currency", "moneda del valor"]),
    cierre: columna(T.columnas, ["trato cerrado el", "fecha de cierre", "close time", "fecha de cierre real"]),
    motivo: columna(T.columnas, ["motivo de la perdida", "motivo de perdida", "lost reason", "razon de perdida"]),
    creado: columna(T.columnas, ["trato creado", "creado", "add time", "fecha de creacion"]),
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
    ["creado", "fecha de creación"],
  ]) {
    if (t[k] < 0) falta("Tratos", T.columnas, que);
  }

  const c = {
    personas: P.filas.length,
    tratos: T.filas.length,
    igdm: 0,
    igdmPorVariante: {},
    prefijos: {},
    noIgdm: 0,
    porEstado: { abierto: 0, ganado: 0, perdido: 0 },
    sinPersona: 0,
    personaInexistente: 0,
    aplanados: 0,
    comoNota: 0,
    conLosDosTelefonos: 0,
    sinTelefonoNiCorreo: 0,
    conVarios: { personas: 0, conUnAbierto: 0, conVariosAbiertos: 0, conAbiertoYCerrado: 0, sinAbiertos: 0 },
    desempates: { unAbiertoEntreVarios: 0, variosAbiertosPorCreacion: 0, cerradoMasReciente: 0, cierreFaltanteUsoCreacion: 0 },
    fusion: { grupos: 0, personasFusionadas: 0 },
  };
  const sumar = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  const idsDePersona = new Set(P.filas.map((f) => (f[p.id] ?? "").trim()));
  const prefijos = new Map();
  const tratosPorPersona = new Map();
  for (const f of T.filas) {
    const v = (i) => (i >= 0 ? (f[i] ?? "").trim() : "");
    const titulo = v(t.titulo);
    const prefijo = /^([^-–]{1,15}?)\s*[-–]\s/.exec(titulo)?.[1]?.trim();
    if (prefijo) sumar(prefijos, prefijo);
    const ig = /ig\s*-?\s*dm/i.exec(titulo);
    if (ig) {
      c.igdm++;
      c.igdmPorVariante[ig[0]] = (c.igdmPorVariante[ig[0]] ?? 0) + 1;
      continue;
    }
    c.noIgdm++;
    const estado = ESTADOS.get(v(t.estado).toLowerCase());
    if (estado) c.porEstado[estado]++;
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
  // Solo los prefijos que se repiten 5 veces o más: uno que aparece una vez
  // puede ser un nombre, y el script no imprime datos.
  for (const [k, n] of prefijos) if (n >= 5) c.prefijos[k] = n;

  // Etapas, estados, valores y fechas: todo se compara antes de escribir,
  // también en los tratos que van como nota.
  const malas = { etapa: new Map(), estado: new Map(), valor: new Map(), fecha: new Map(), creado: new Map() };
  const leerTrato = (trato) => {
    const w = (i) => (i >= 0 ? (trato[i] ?? "").trim() : "");
    const etapa = w(t.etapa);
    if (etapa && !ETAPAS.includes(etapa)) sumar(malas.etapa, etapa);
    const estadoCrudo = w(t.estado);
    const estado = ESTADOS.get(estadoCrudo.toLowerCase()) ?? "";
    if (estadoCrudo && !estado) sumar(malas.estado, estadoCrudo);
    const valor = w(t.valor);
    if (valor && !/^-?\d+(\.\d+)?$/.test(valor)) sumar(malas.valor, forma(valor));
    const cierreCrudo = w(t.cierre);
    const cierre = cierreCrudo ? instante(cierreCrudo) : "";
    if (cierreCrudo && !cierre) sumar(malas.fecha, forma(cierreCrudo));
    const creadoCrudo = w(t.creado);
    const creado = creadoCrudo ? instante(creadoCrudo) : "";
    if (creadoCrudo && !creado) sumar(malas.creado, forma(creadoCrudo));
    return { id: w(t.id), etapa, estado, valor, moneda: w(t.moneda), cierre, creado, motivo: w(t.motivo) };
  };
  const masReciente = (lista, clave) => lista.reduce((a, b) => (clave(b) > clave(a) ? b : a));

  /** Decisión de Marcos del 10/11/2026: cuál va a la ficha. */
  const elegir = (tratos) => {
    if (tratos.length === 1) return tratos[0];
    c.conVarios.personas++;
    const abiertos = tratos.filter((x) => x.estado === "abierto");
    const cerrados = tratos.filter((x) => x.estado !== "abierto");
    if (abiertos.length === 1) c.conVarios.conUnAbierto++;
    if (abiertos.length > 1) c.conVarios.conVariosAbiertos++;
    if (abiertos.length >= 1 && cerrados.length >= 1) c.conVarios.conAbiertoYCerrado++;
    if (abiertos.length === 0) c.conVarios.sinAbiertos++;
    if (abiertos.length === 1) {
      c.desempates.unAbiertoEntreVarios++;
      return abiertos[0];
    }
    if (abiertos.length > 1) {
      c.desempates.variosAbiertosPorCreacion++;
      return masReciente(abiertos, (x) => x.creado);
    }
    c.desempates.cerradoMasReciente++;
    if (tratos.some((x) => !x.cierre)) c.desempates.cierreFaltanteUsoCreacion++;
    return masReciente(tratos, (x) => x.cierre || x.creado);
  };
  const dia = (inst) => (inst ? `${inst.slice(8, 10)}/${inst.slice(5, 7)}/${inst.slice(0, 4)}` : "");
  const notaDeTratoAnterior = (x) => {
    const partes = [x.estado, x.etapa, x.valor ? `${x.valor} ${x.moneda}`.trim() : "", x.cierre ? `cerrado el ${dia(x.cierre)}` : ""].filter(Boolean);
    return `Trato anterior en Pipedrive: ${partes.join(", ")}${x.motivo ? `. Motivo de pérdida: ${x.motivo}` : ""}`;
  };

  // Las personas que comparten correo o teléfono (ítem 1): unión transitiva.
  const personas = P.filas.map((f) => {
    const v = (i) => (i >= 0 ? (f[i] ?? "").trim() : "");
    const movil = v(p.movil);
    const trabajo = v(p.trabajo);
    if (movil && trabajo) c.conLosDosTelefonos++;
    const telefono = movil || trabajo;
    const correo = p.correos.map((i) => v(i)).find(Boolean) ?? "";
    if (!telefono && !correo) c.sinTelefonoNiCorreo++;
    const claves = [];
    if (correo) claves.push(`c:${correo.toLowerCase()}`);
    const tel = telefonoParaComparar(telefono, codigoPais);
    if (tel) claves.push(`t:${tel}`);
    return { id: v(p.id), nombre: v(p.nombre), correo, telefono, claves };
  });
  const padre = personas.map((_, i) => i);
  const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const duenoDeClave = new Map();
  personas.forEach((x, i) => {
    for (const k of x.claves) {
      if (duenoDeClave.has(k)) padre[raiz(i)] = raiz(duenoDeClave.get(k));
      else duenoDeClave.set(k, i);
    }
  });
  const grupos = new Map();
  personas.forEach((x, i) => {
    const r = raiz(i);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(x);
  });

  const salida = [];
  for (const grupo of grupos.values()) {
    grupo.sort((a, b) => compararId(a.id, b.id));
    const [primera, ...otras] = grupo;
    if (otras.length) {
      c.fusion.grupos++;
      c.fusion.personasFusionadas += otras.length;
    }
    const correo = grupo.map((x) => x.correo).find(Boolean) ?? "";
    const telefono = grupo.map((x) => x.telefono).find(Boolean) ?? "";
    const fila = [primera.nombre, correo, telefono, primera.id, "", "", "", "", "", ""];
    const notas = [];
    const tratos = grupo.flatMap((x) => tratosPorPersona.get(x.id) ?? []).map(leerTrato);
    if (tratos.length) {
      const ficha = elegir(tratos);
      fila[4] = ficha.etapa;
      fila[5] = ficha.estado;
      fila[6] = ficha.valor;
      fila[7] = ficha.moneda;
      fila[8] = ficha.cierre.slice(0, 10);
      fila[9] = ficha.id;
      if (ficha.motivo) notas.push(`Motivo de pérdida en Pipedrive: ${ficha.motivo}`);
      c.aplanados++;
      for (const x of tratos) {
        if (x === ficha) continue;
        notas.push(notaDeTratoAnterior(x));
        c.comoNota++;
      }
    }
    for (const x of otras) notas.push(`Otra persona de Pipedrive con el mismo correo o teléfono: ${x.nombre}, ID ${x.id}`);
    salida.push({ fila, notas });
  }
  const problemas = [];
  for (const [k, l] of malas.etapa) problemas.push(`la etapa «${k}» no está en la lista de la base (${l} tratos)`);
  for (const [k, l] of malas.estado) problemas.push(`el estado «${k}» no es abierto, ganado ni perdido (${l} tratos): ¿cómo se mapea?`);
  for (const [k, l] of malas.valor) problemas.push(`un valor con la forma «${k}» no se lee como número (${l} tratos)`);
  for (const [k, l] of malas.fecha) problemas.push(`una fecha de cierre con la forma «${k}» no se puede leer (${l} tratos)`);
  for (const [k, l] of malas.creado) problemas.push(`una fecha de creación con la forma «${k}» no se puede leer (${l} tratos)`);
  if (problemas.length) throw new Freno(`No escribo los archivos:\n  - ${problemas.join("\n  - ")}`);

  // La cuenta tiene que cerrar (decisión del 10/11, punto 3).
  if (c.aplanados + c.comoNota + c.sinPersona + c.personaInexistente !== c.noIgdm) {
    throw new Freno(`La cuenta no cierra: ${c.aplanados} en la ficha + ${c.comoNota} como nota + ${c.sinPersona} sin persona + ${c.personaInexistente} con persona inexistente ≠ ${c.noIgdm} que no son «IG DM».`);
  }

  // Tantas columnas de nota como la persona que más tiene (al menos una).
  const cuantasNotas = Math.max(1, ...salida.map((s) => s.notas.length));
  const columnas = [...COLUMNAS_BASE, ...Array.from({ length: cuantasNotas }, (_, i) => (i === 0 ? "Nota del contacto" : `Nota del contacto ${i + 1}`))];
  const filas = salida.map((s) => [...s.fila, ...Array.from({ length: cuantasNotas }, (_, i) => s.notas[i] ?? "")]);

  // A: todas las personas con trato y las sin trato que entren; B: el resto.
  const conTrato = filas.filter((f) => f[9]);
  const sinTrato = filas.filter((f) => !f[9]);
  if (conTrato.length > MAX_FILAS) throw new Freno(`Hay ${conTrato.length} personas con trato: no entran en un archivo de ${MAX_FILAS}.`);
  const a = [...conTrato, ...sinTrato.slice(0, MAX_FILAS - conTrato.length)];
  const b = sinTrato.slice(MAX_FILAS - conTrato.length);
  if (b.length > MAX_FILAS) throw new Freno(`El archivo B tendría ${b.length} filas, más de ${MAX_FILAS}.`);
  return { a, b, columnas, conteos: c, columnasPersonas: P.columnas, columnasTratos: T.columnas };
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
  const personas = argumento("personas") ?? buscar(carpeta, /person|persona|people/);
  const tratos = argumento("tratos") ?? buscar(carpeta, /deal|trato/);
  const codigoPais = argumento("codigo-pais") ?? "+506";
  if (!/^\+[1-9][0-9]{0,3}$/.test(codigoPais)) throw new Freno("El código de país tiene que ser como +506.");
  const r = unir(readFileSync(personas, "utf8"), readFileSync(tratos, "utf8"), { codigoPais });
  const k = r.conteos;
  console.log(`Columnas de Personas: ${r.columnasPersonas.join(" | ")}`);
  console.log(`Columnas de Tratos: ${r.columnasTratos.join(" | ")}`);
  console.log(`Personas: ${k.personas} (el plano espera 526)`);
  console.log(`Tratos: ${k.tratos} (el plano espera 517)`);
  console.log(`«IG DM» descartados: ${k.igdm} (el plano espera 118), por variante: ${JSON.stringify(k.igdmPorVariante)}`);
  console.log(`Prefijos de título (antes de « - », los que se repiten 5 veces o más): ${JSON.stringify(k.prefijos)}`);
  console.log(`Tratos que no son «IG DM»: ${k.noIgdm} (el plano espera 399); abiertos ${k.porEstado.abierto}, ganados ${k.porEstado.ganado}, perdidos ${k.porEstado.perdido}`);
  console.log(`Personas con varios tratos: ${JSON.stringify(k.conVarios)}`);
  console.log(`Desempates usados: ${JSON.stringify(k.desempates)}`);
  console.log(`Sin persona: ${k.sinPersona}; con una persona que no está en el export: ${k.personaInexistente}`);
  console.log(`La cuenta: ${k.aplanados} en la ficha + ${k.comoNota} como nota + ${k.sinPersona} sin persona + ${k.personaInexistente} con persona inexistente = ${k.aplanados + k.comoNota + k.sinPersona + k.personaInexistente} (no «IG DM»: ${k.noIgdm})`);
  console.log(`Personas que comparten correo o teléfono (código por defecto ${codigoPais}): ${k.fusion.grupos} grupos, ${k.fusion.personasFusionadas} personas fusionadas en la primera de su grupo`);
  console.log(`Personas con Móvil y Trabajo a la vez: ${k.conLosDosTelefonos} (se usó Móvil); sin teléfono ni correo: ${k.sinTelefonoNiCorreo}`);
  const rutaA = join(carpeta, "migracion-A.csv");
  const rutaB = join(carpeta, "migracion-B.csv");
  writeFileSync(rutaA, escribirCsv(r.columnas, r.a));
  writeFileSync(rutaB, escribirCsv(r.columnas, r.b));
  console.log(`Escrito: ${rutaA} (${r.a.length} filas, ${r.a.filter((f) => f[9]).length} con trato) y ${rutaB} (${r.b.length} filas); columnas de nota: ${r.columnas.length - COLUMNAS_BASE.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  principal().catch((e) => {
    console.error(e instanceof Freno ? `FRENO: ${e.message}` : e);
    process.exit(1);
  });
}
