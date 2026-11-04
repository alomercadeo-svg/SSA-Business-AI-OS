/**
 * Los filtros de la bandeja (F35, tramo B de S8), entre la dirección de la
 * página y la base.
 *
 * La dirección es lo que se comparte (`?etiquetas=…&canal=…`), así que se lee
 * con desconfianza: lo que no se entiende se descarta, nunca se manda a la
 * base. Lo que sí se entiende va a la 00044 como un solo jsonb
 * (`filtrosParaLaBase`), con las claves que lee `bandeja_filtrada`.
 *
 * «Hoy» no se calcula acá: lo calcula la base, en `workspaces.zona_horaria`.
 * `ahora` (el reloj fijo que usa solo `scripts/verify-filtros-bandeja.mjs`)
 * nunca sale de la dirección.
 *
 * Lo usan la página de la bandeja (servidor), la ruta de la lista y la lista
 * (navegador): no es `"use client"` ni importa nada de servidor.
 */

export type Plataforma = "instagram" | "whatsapp";
export const PLATAFORMAS: readonly Plataforma[] = ["instagram", "whatsapp"];

export type RangoDeFechas = { desde: string; hasta: string };
export type FechaDelUltimo = "hoy" | "7" | "30" | ({ tipo: "rango" } & RangoDeFechas);
export type Seguimiento = "hoy" | "semana" | "vencido" | ({ tipo: "rango" } & RangoDeFechas);

export type FiltrosDeBandeja = {
  /** Ids de etiqueta: el contacto tiene cualquiera de estas. */
  etiquetas: string[];
  /** `null` es «Todas»; `"sin"`, sin setter ni vendedor; si no, el id de un miembro. */
  asignacion: null | "sin" | string;
  canal: Plataforma[];
  ultimo: null | FechaDelUltimo;
  telefonoSinResolver: boolean;
  seguimiento: null | Seguimiento;
};

/** Lo que el panel ofrece, leído en el servidor (`inbox/page.tsx`). */
export interface OpcionesDeFiltros {
  etiquetas: Array<{ id: string; name: string }>;
  /** Owner y Admin: el equipo; un Member: solo él (`lib/miembros-bandeja.ts`). */
  miembros: Array<{ id: string; etiqueta: string }>;
  /** Las plataformas con algún canal activo en el espacio. */
  plataformas: readonly Plataforma[];
}

export const SIN_OPCIONES: OpcionesDeFiltros = { etiquetas: [], miembros: [], plataformas: [] };

export const SIN_FILTROS: FiltrosDeBandeja = {
  etiquetas: [],
  asignacion: null,
  canal: [],
  ultimo: null,
  telefonoSinResolver: false,
  seguimiento: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

type Entrada = URLSearchParams | Record<string, string | string[] | undefined>;

function leer(p: Entrada, clave: string): string {
  const v = p instanceof URLSearchParams ? p.get(clave) : p[clave];
  const uno = Array.isArray(v) ? v[0] : v;
  return typeof uno === "string" ? uno.trim() : "";
}

const lista = (texto: string) => [...new Set(texto.split(",").map((s) => s.trim()).filter(Boolean))];

/** Un día del calendario que existe (el 30/02 no). */
function diaValido(texto: string): boolean {
  if (!DIA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function rango(p: Entrada, prefijo: string): RangoDeFechas | null {
  const desde = leer(p, `${prefijo}_desde`);
  const hasta = leer(p, `${prefijo}_hasta`);
  if (!diaValido(desde) || !diaValido(hasta)) return null;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

export function filtrosDeLaDireccion(p: Entrada): FiltrosDeBandeja {
  const etiquetas = lista(leer(p, "etiquetas")).filter((id) => UUID.test(id));
  const asig = leer(p, "asignacion");
  const pedidos = lista(leer(p, "canal"));
  const canal = PLATAFORMAS.filter((pl) => pedidos.includes(pl));

  const u = leer(p, "ultimo");
  let ultimo: FiltrosDeBandeja["ultimo"] = null;
  if (u === "hoy" || u === "7" || u === "30") ultimo = u;
  else if (u === "rango") {
    const r = rango(p, "ultimo");
    ultimo = r ? { tipo: "rango", ...r } : null;
  }

  const s = leer(p, "seguimiento");
  let seguimiento: FiltrosDeBandeja["seguimiento"] = null;
  if (s === "hoy" || s === "semana" || s === "vencido") seguimiento = s;
  else if (s === "rango") {
    const r = rango(p, "seguimiento");
    seguimiento = r ? { tipo: "rango", ...r } : null;
  }

  return {
    etiquetas,
    asignacion: asig === "sin" ? "sin" : UUID.test(asig) ? asig.toLowerCase() : null,
    canal,
    ultimo,
    telefonoSinResolver: leer(p, "telefono") === "sin-resolver",
    seguimiento,
  };
}

/** Los filtros como parámetros de la dirección, en un orden fijo. */
export function parametrosDeFiltros(f: FiltrosDeBandeja): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (f.etiquetas.length) out.push(["etiquetas", f.etiquetas.join(",")]);
  if (f.asignacion) out.push(["asignacion", f.asignacion]);
  if (f.canal.length) out.push(["canal", f.canal.join(",")]);
  if (f.ultimo) {
    if (typeof f.ultimo === "string") out.push(["ultimo", f.ultimo]);
    else out.push(["ultimo", "rango"], ["ultimo_desde", f.ultimo.desde], ["ultimo_hasta", f.ultimo.hasta]);
  }
  if (f.telefonoSinResolver) out.push(["telefono", "sin-resolver"]);
  if (f.seguimiento) {
    if (typeof f.seguimiento === "string") out.push(["seguimiento", f.seguimiento]);
    else out.push(["seguimiento", "rango"], ["seguimiento_desde", f.seguimiento.desde], ["seguimiento_hasta", f.seguimiento.hasta]);
  }
  return out;
}

/** Las claves de la dirección que son de los filtros (para borrarlas al reescribirla). */
export const CLAVES_DE_FILTROS = [
  "etiquetas",
  "asignacion",
  "canal",
  "ultimo",
  "ultimo_desde",
  "ultimo_hasta",
  "telefono",
  "seguimiento",
  "seguimiento_desde",
  "seguimiento_hasta",
] as const;

/** Cuántos grupos tienen algo elegido: el «Filtros · N». La fecha cuenta. */
export function cuantosFiltros(f: FiltrosDeBandeja): number {
  return (
    (f.seguimiento ? 1 : 0) +
    (f.canal.length ? 1 : 0) +
    (f.asignacion ? 1 : 0) +
    (f.etiquetas.length ? 1 : 0) +
    (f.ultimo ? 1 : 0) +
    (f.telefonoSinResolver ? 1 : 0)
  );
}

export const hayFiltros = (f: FiltrosDeBandeja) => cuantosFiltros(f) > 0;

/** El jsonb que lee `bandeja_filtrada` (00044). Nunca lleva `ahora`. */
export function filtrosParaLaBase(f: FiltrosDeBandeja, busqueda: string): Record<string, unknown> {
  const out: Record<string, unknown> = { q: busqueda };
  if (f.etiquetas.length) out.etiquetas = f.etiquetas;
  if (f.asignacion) out.asignacion = f.asignacion;
  if (f.canal.length) out.canal = f.canal;
  if (f.ultimo) {
    if (typeof f.ultimo === "string") out.ultimo = f.ultimo;
    else Object.assign(out, { ultimo: "rango", ultimo_desde: f.ultimo.desde, ultimo_hasta: f.ultimo.hasta });
  }
  if (f.telefonoSinResolver) out.sin_telefono = true;
  if (f.seguimiento) {
    if (typeof f.seguimiento === "string") out.seguimiento = f.seguimiento;
    else Object.assign(out, { seguimiento: "rango", seguimiento_desde: f.seguimiento.desde, seguimiento_hasta: f.seguimiento.hasta });
  }
  return out;
}

/**
 * «Asignación» de un Member (decidido por Marcos el 04/11/2026): «Todas»,
 * «Sin asignar» y él mismo. El id de otro miembro que venga en la dirección se
 * ignora, sin error: queda «Todas» y no cuenta. No se lee nada de ese id.
 */
export function filtrosParaElRol(f: FiltrosDeBandeja, esManager: boolean, usuarioId: string): FiltrosDeBandeja {
  if (esManager || !f.asignacion || f.asignacion === "sin" || f.asignacion === usuarioId.toLowerCase()) return f;
  return { ...f, asignacion: null };
}
