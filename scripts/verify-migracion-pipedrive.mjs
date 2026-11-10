#!/usr/bin/env node
/**
 * F38: la migración desde Pipedrive, de punta a punta, con DATOS SINTÉTICOS
 * (nunca los exports reales), contra `POST /api/v1/contacts/importar` de
 * PRODUCCIÓN, en un espacio fantasma que el script crea y borra. Nunca en el
 * espacio real.
 *
 * EL ESCENARIO. Un export de Personas y uno de Tratos chicos, escritos acá:
 *   P1: Móvil con apóstrofe inicial y código; trato abierto con valor.
 *   P2: Trabajo con invisibles de dirección y sin código; trato perdido con
 *       motivo y fecha con hora.
 *   P3: sin teléfono ni correo; trato ganado. Entra por el id de persona.
 *   P4: Trabajo «8856-12», que no se puede normalizar; trato perdido.
 *   P6: Móvil limpio; su único trato es «IG DM - …», que se descarta.
 * Y una fila agregada después de la unión, como una planilla editada a mano,
 * con la etapa «99. Inventada»: el script de unión no la habría dejado pasar
 * (se comprueba en el paso 1), así que llega a la base y la base la rechaza.
 *
 * LO QUE SE MIRA, en orden, sin nada en el medio que altere lo que se lee:
 *   1. La unión: 1 «IG DM» descartado, 4 tratos en la ficha y 1 como nota
 *      (P1 tiene un trato viejo perdido además del abierto: decisión de Marcos
 *      del 10/11); con una etapa o un estado inválidos, el script frena.
 *   2. Primera importación: 4 creados, 2 con error (P4 y la etapa), 1 con el
 *      código por defecto. La presencia: 3 contactos con trato en el espacio,
 *      con sus datos.
 *   3. El control: «3 de 5 tratos», faltan 2.
 *   4. Dos notas con la marca de la migración: el motivo de P2 y el trato
 *      anterior de P1.
 *   5. Segunda importación igual: 0 creados, mismos contactos, la nota sigue
 *      siendo dos, el control da lo mismo.
 *
 * EL ROJO, antes del código: la ruta de producción rechaza los campos nuevos
 * con 400 («Pedido inválido.»). Es un rojo de carga y no cuenta por su motivo
 * (regla del 03/11); los rojos por su motivo son los de Vitest.
 *
 * Uso: node scripts/verify-migracion-pipedrive.mjs
 */
import { admin, check, correr, crearUsuario, noConcluyente, sufijo, URL_BASE } from "./lib-verificador.mjs";
import { escribirCsv, unir } from "./pipedrive-unir.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const REF = new URL(URL_BASE).hostname.split(".")[0];
const MARCA = "Migración de Pipedrive";
const MAPEO_BASE = ["nombre", "correo", "telefono", "pipedrive", "etapa", "estado_trato", "valor", "moneda", "fecha_cierre", "pipedrive_trato"];
let MAPEO = [];

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

async function importar(u, espacio, filas) {
  const res = await fetch(`${APP_URL}/api/v1/contacts/importar`, {
    method: "POST",
    headers: { Cookie: cookieDe(u, espacio), "Content-Type": "application/json", Origin: APP_URL },
    body: JSON.stringify({ nombreArchivo: `verify-pd-${sufijo}.csv`, codigoPais: "+506", asignarA: null, etiquetaOrigen: `Migrado de Pipedrive verify ${sufijo}`, mapeo: MAPEO, filas }),
    redirect: "manual",
  });
  return { status: res.status, cuerpo: await res.json().catch(() => null) };
}

const contar = async (q) => (await admin(q)).data?.length ?? -1;
const id = (n) => `${n}-${sufijo}`;

const PERSONAS = escribirCsv(
  ["Persona - ID", "Persona - Nombre", "Persona - Teléfono - Móvil", "Persona - Teléfono - Trabajo", "Persona - Correo electrónico - Trabajo"],
  [
    [id("p1"), `P1 ${sufijo}`, "'+506 8800 0001", "", ""],
    [id("p2"), `P2 ${sufijo}`, "", "‪8800-0002‬", ""],
    [id("p3"), `P3 ${sufijo}`, "", "", ""],
    [id("p4"), `P4 ${sufijo}`, "", "8856-12", ""],
    [id("p6"), `P6 ${sufijo}`, "+506 8800 0006", "", `p6-${sufijo}@ejemplo.invalid`],
  ],
);
const COLS_TRATOS = ["Trato - ID", "Trato - Título", "Trato - ID de persona", "Trato - Etapa", "Trato - Estado", "Trato - Valor", "Trato - Moneda", "Trato - Fecha de cierre", "Trato - Motivo de pérdida", "Trato - Trato creado"];
const TRATOS_FILAS = [
  [id("d1"), "Trato P1", id("p1"), "3. Respondió", "Abierto", "1500", "USD", "", "", "2025-02-01 09:00:00"],
  [id("d0"), "Trato viejo P1", id("p1"), "8. No llegó", "Perdido", "", "", "2024-11-05 10:00:00", "No llegó", "2024-10-01 09:00:00"],
  [id("d2"), "Trato P2", id("p2"), "14. Repesca", "Perdido", "", "", "2025-03-14 10:00:00", "Precio", "2025-01-01 09:00:00"],
  [id("d3"), "Trato P3", id("p3"), "13. ¡Cerrada!", "Ganado", "900", "USD", "2025-01-10", "", "2024-12-01 09:00:00"],
  [id("d4"), "Trato P4", id("p4"), "2. Le escribí", "Perdido", "", "", "2025-02-01", "No respondió", "2025-01-01 09:00:00"],
  [id("d6"), "IG DM - Fulano ✨", id("p6"), "4. ¿Es mi cliente?", "Abierto", "", "", "", "", "2025-01-01 09:00:00"],
];
const TRATOS = escribirCsv(COLS_TRATOS, TRATOS_FILAS);

await correr(async () => {
  console.log(`App: ${APP_URL} · espacio fantasma nuevo`);

  titulo("La unión, fuera del sistema (scripts/pipedrive-unir.mjs)");
  const u = unir(PERSONAS, TRATOS);
  check(u.conteos.personas === 5 && u.conteos.tratos === 6, "5 personas y 6 tratos leídos", JSON.stringify(u.conteos));
  check(u.conteos.igdm === 1 && u.conteos.aplanados === 4 && u.conteos.comoNota === 1, "1 «IG DM» descartado, 4 tratos en la ficha, 1 como nota (el viejo de P1)", JSON.stringify(u.conteos));
  check(u.conteos.desempates.unAbiertoEntreVarios === 1, "P1: a la ficha va el abierto", JSON.stringify(u.conteos.desempates));
  MAPEO = u.columnas.map((c, i) => (i < MAPEO_BASE.length ? MAPEO_BASE[i] : "nota"));
  check(u.a.length === 5 && u.b.length === 0 && u.a.slice(0, 4).every((f) => f[9]), "un solo archivo: primero las 4 personas con trato", JSON.stringify(u.a.map((f) => f[9])));
  let frena = null;
  try {
    unir(PERSONAS, escribirCsv(COLS_TRATOS, [[id("d9"), "Trato", id("p1"), "99. Inventada", "Abierto", "", "", "", "", "2025-01-01"]]));
  } catch (e) {
    frena = e.message;
  }
  check(frena !== null && frena.includes("«99. Inventada»"), "con una etapa fuera de la lista, el script frena y dice cuál", frena);
  let frenaEstado = null;
  try {
    unir(PERSONAS, escribirCsv(COLS_TRATOS, [[id("d9"), "Trato", id("p1"), "3. Respondió", "Eliminado", "", "", "", "", "2025-01-01"]]));
  } catch (e) {
    frenaEstado = e.message;
  }
  check(frenaEstado !== null && frenaEstado.includes("«Eliminado»"), "con un estado que no es abierto, ganado ni perdido, frena y pregunta", frenaEstado);

  // La planilla editada a mano: una fila con una etapa que la base rechaza.
  const filas = [...u.a, [`P5 ${sufijo}`, `p5-${sufijo}@ejemplo.invalid`, "", id("p5"), "99. Inventada", "abierto", "", "", "", id("d5"), ...MAPEO.slice(MAPEO_BASE.length).map(() => "")]];

  const owner = await crearUsuario("f38-owner");
  const espacio = owner.espacio;
  const vivos = () => contar(`contacts?select=id&workspace_id=eq.${espacio}&deleted_at=is.null`);
  const conTrato = () => admin(`contacts?select=display_name,phone,email,pipedrive_person_id,pipeline_stage,deal_status,deal_value,deal_currency,deal_closed_at,pipedrive_deal_id&workspace_id=eq.${espacio}&deleted_at=is.null&pipedrive_deal_id=not.is.null&order=pipedrive_deal_id.asc`);
  const notas = () => admin(`contact_notes?select=contact_id,author_label,body&workspace_id=eq.${espacio}`);

  titulo("Primera importación (6 filas)");
  const r1 = await importar(owner, espacio, filas);
  if (!check(r1.status === 200, "200", `HTTP ${r1.status} ${JSON.stringify(r1.cuerpo)}`)) {
    noConcluyente("la importación, el control y las notas", "la importación no respondió 200");
    return;
  }
  check(r1.cuerpo.creados === 4 && r1.cuerpo.actualizados === 0 && r1.cuerpo.conError === 2, "4 creados, 2 con error", JSON.stringify(r1.cuerpo));
  check(r1.cuerpo.usaronCodigo === 1, "1 usó el código por defecto (P2, con invisibles y sin código)", JSON.stringify(r1.cuerpo));
  const lineas = r1.cuerpo.lineas ?? [];
  check(lineas.some((l) => l.que.includes("«8856-12» no se puede normalizar")), "P4: el teléfono no se inventa");
  check(lineas.some((l) => l.que.includes("«99. Inventada»") && l.que.includes("la base la rechazó")), "la etapa inválida: la base la rechaza y la fila lo dice", JSON.stringify(lineas));
  check((await vivos()) === 4, "4 contactos vivos en el espacio");

  const presentes = (await conTrato()).data ?? [];
  check(presentes.length === 3, "presencia: 3 contactos con trato de Pipedrive en el espacio (antes de leer el control)", JSON.stringify(presentes));
  const [c1, c2, c3] = presentes;
  check(c1?.phone === "+50688000001" && c1?.pipeline_stage === "3. Respondió" && c1?.deal_status === "abierto" && Number(c1?.deal_value) === 1500 && c1?.deal_currency === "USD", "P1: el apóstrofe se limpió y el trato quedó en el contacto", JSON.stringify(c1));
  check(c2?.phone === "+50688000002" && c2?.deal_status === "perdido" && c2?.deal_closed_at === "2025-03-14", "P2: los invisibles se limpiaron, tomó +506, y la fecha con hora quedó como día", JSON.stringify(c2));
  check(c3?.phone === null && c3?.email === null && c3?.pipedrive_person_id === id("p3") && c3?.deal_status === "ganado", "P3: sin teléfono ni correo, entró por el id de persona", JSON.stringify(c3));

  titulo("El control afirmativo");
  const k1 = r1.cuerpo.control;
  check(k1?.medido === true && k1.enArchivo === 5 && k1.encontrados === 3 && k1.enEspacio === 3, "«3 de 5 tratos»: faltan 2 (P4 y la etapa inválida)", JSON.stringify(k1));

  titulo("Las notas, con la marca de la migración: el motivo de P2 y el trato anterior de P1");
  const n1 = (await notas()).data ?? [];
  const cuerpos = n1.map((n) => n.body).sort();
  check(
    n1.length === 2 && n1.every((n) => n.author_label === MARCA) && cuerpos[0] === "Motivo de pérdida en Pipedrive: Precio" && cuerpos[1] === "Trato anterior en Pipedrive: perdido, 8. No llegó, cerrado el 05/11/2024. Motivo de pérdida: No llegó",
    "dos notas con la marca",
    JSON.stringify(n1),
  );

  titulo("Segunda importación, el mismo archivo: actualiza, no duplica");
  const r2 = await importar(owner, espacio, filas);
  check(r2.status === 200 && r2.cuerpo?.creados === 0 && r2.cuerpo?.actualizados === 4 && r2.cuerpo?.conError === 2, "0 creados, 4 actualizados, 2 con error", JSON.stringify(r2.cuerpo));
  check((await vivos()) === 4, "siguen 4 contactos vivos");
  const n2 = (await notas()).data ?? [];
  check(n2.length === 2, "siguen siendo dos notas", JSON.stringify(n2));
  check(JSON.stringify(r2.cuerpo?.control) === JSON.stringify(k1), "el control da lo mismo", JSON.stringify(r2.cuerpo?.control));
}, async () => {
  // La limpieza de `correr` borra el espacio: contactos y notas se van en cascada.
});
