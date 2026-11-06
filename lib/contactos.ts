/**
 * La lista de Contactos en el servidor (F43, tramo B de S9).
 *
 * Hasta el 05/11/2026 la lista traía los primeros 100 por interacción y
 * buscaba en el navegador, sobre esos 100. Ahora la búsqueda, los cinco
 * filtros de la fila y las páginas numeradas los calculan las funciones de la
 * 00049 (con el arreglo de la 00050) sobre todos los contactos que quien mira
 * puede ver. Son `security invoker`: la seguridad por filas decide igual que
 * en una lectura directa.
 *
 * La usan la página de Contactos (la primera carga, en el servidor) y la ruta
 * `GET /api/v1/contacts` (los cambios de búsqueda, filtro o página). No es
 * `"use client"` ni importa nada de servidor: recibe el cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./types/database";
import { filtroDeAsignacion, type FiltroDeAsignacion } from "./asignacion";

export const CONTACTOS_POR_PAGINA = 50;
/** Lo buscado se corta acá, como en la bandeja. */
export const LARGO_MAXIMO_DE_BUSQUEDA = 100;

/** Las etapas heredadas de Pipedrive, en el orden del `check` de la 00030 (sin la 10). */
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

export type SeguimientoDeContactos = "hoy" | "semana" | "vencido";
const SEGUIMIENTOS: SeguimientoDeContactos[] = ["hoy", "semana", "vencido"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FiltrosDeContactos {
  q: string;
  seguimiento: SeguimientoDeContactos | null;
  etapa: string | null;
  setter: FiltroDeAsignacion;
  vendedor: FiltroDeAsignacion;
  /** El id de una etiqueta. */
  etiqueta: string | null;
  /**
   * F43 (criterio del 05/11/2026, 00051): solo los que escribieron al menos una
   * vez. Arranca apagado: cuando entren los de Pipedrive (F38), ninguno escribió
   * en el sistema, y con el filtro puesto de entrada parecerían perdidos.
   */
  escribieron: boolean;
}

export const SIN_FILTROS_DE_CONTACTOS: FiltrosDeContactos = {
  q: "",
  seguimiento: null,
  etapa: null,
  setter: { tipo: "todos" },
  vendedor: { tipo: "todos" },
  etiqueta: null,
  escribieron: false,
};

export type Contacto = Database["public"]["Tables"]["contacts"]["Row"];
export type ContactoDeLaLista = Contacto & {
  contact_tags: { tag_id: string; tags: Database["public"]["Tables"]["tags"]["Row"] | null }[];
  contact_channels: { platform_sender_id: string; platform_username: string | null }[];
};

type Parametros = URLSearchParams | Record<string, string | string[] | undefined>;
const primero = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const leer = (p: Parametros, clave: string): string | undefined => {
  const v = p instanceof URLSearchParams ? p.get(clave) ?? undefined : primero(p[clave]);
  return typeof v === "string" ? v : undefined;
};

/** Los filtros, de la dirección. Lo que no se entiende se descarta. */
export function filtrosDeContactos(p: Parametros): FiltrosDeContactos {
  const seguimiento = leer(p, "seguimiento");
  const etapa = leer(p, "etapa");
  const etiqueta = leer(p, "etiqueta");
  return {
    q: (leer(p, "q") ?? "").trim().slice(0, LARGO_MAXIMO_DE_BUSQUEDA),
    seguimiento: SEGUIMIENTOS.includes(seguimiento as SeguimientoDeContactos) ? (seguimiento as SeguimientoDeContactos) : null,
    etapa: etapa && ETAPAS.includes(etapa) ? etapa : null,
    setter: filtroDeAsignacion(leer(p, "setter")),
    vendedor: filtroDeAsignacion(leer(p, "vendedor")),
    etiqueta: etiqueta && UUID.test(etiqueta) ? etiqueta.toLowerCase() : null,
    escribieron: leer(p, "escribieron") === "si",
  };
}

/** La página pedida: un entero desde 1. Lo demás es la 1. */
export function paginaDeContactos(v: unknown): number {
  const s = primero(v);
  if (typeof s !== "string" || !/^\d+$/.test(s)) return 1;
  return Math.max(1, Number(s));
}

/**
 * Un Member con el id de otro miembro en setter o vendedor: se ignora, como en
 * la bandeja (`filtrosParaElRol`, lib/filtros-bandeja.ts). Su propio id y
 * «sin asignar» quedan.
 */
export function filtrosDeContactosParaElRol(f: FiltrosDeContactos, esManager: boolean, yo: string): FiltrosDeContactos {
  if (esManager) return f;
  const limpiar = (a: FiltroDeAsignacion): FiltroDeAsignacion => (a.tipo === "persona" && a.id !== yo ? { tipo: "todos" } : a);
  return { ...f, setter: limpiar(f.setter), vendedor: limpiar(f.vendedor) };
}

const asignacionParaLaBase = (a: FiltroDeAsignacion) => (a.tipo === "sin" ? "sin" : a.tipo === "persona" ? a.id : null);

/** El jsonb de `contactos_filtrados`. Nunca lleva `ahora`: el reloj fijo es del verificador. */
export function paraLaBaseDeContactos(f: FiltrosDeContactos): Record<string, string> {
  const j: Record<string, string> = {};
  if (f.q) j.q = f.q;
  if (f.seguimiento) j.seguimiento = f.seguimiento;
  if (f.etapa) j.etapa = f.etapa;
  const setter = asignacionParaLaBase(f.setter);
  if (setter) j.setter = setter;
  const vendedor = asignacionParaLaBase(f.vendedor);
  if (vendedor) j.vendedor = vendedor;
  if (f.etiqueta) j.etiqueta = f.etiqueta;
  if (f.escribieron) j.escribieron = "si";
  return j;
}

export function hayFiltrosDeContactos(f: FiltrosDeContactos): boolean {
  return Object.keys(paraLaBaseDeContactos(f)).length > 0;
}

/** La dirección de la página con esos filtros, para compartirla. La página 1 no se escribe. */
export function direccionDeContactos(f: FiltrosDeContactos, pagina: number): string {
  const p = new URLSearchParams(paraLaBaseDeContactos(f));
  if (pagina > 1) p.set("pagina", String(pagina));
  const q = p.toString();
  return q ? `/dashboard/contacts?${q}` : "/dashboard/contacts";
}

export function paginasDe(cantidad: number): number {
  return Math.max(1, Math.ceil(cantidad / CONTACTOS_POR_PAGINA));
}

/** Los números de la navegación: la primera, la última y dos a cada lado de la actual. */
export function numerosDePagina(actual: number, paginas: number): Array<number | "…"> {
  const numeros: Array<number | "…"> = [];
  for (let n = 1; n <= paginas; n++) {
    if (n === 1 || n === paginas || Math.abs(n - actual) <= 2) numeros.push(n);
    else if (numeros[numeros.length - 1] !== "…") numeros.push("…");
  }
  return numeros;
}

export const SELECCION_DE_LA_LISTA = "*, contact_tags(tag_id, tags(*)), contact_channels(platform_sender_id, platform_username)";

export interface ListaDeContactos {
  contactos: ContactoDeLaLista[];
  /** Los que pasan la búsqueda y los filtros. */
  cantidad: number;
  /** Todos los del alcance de quien mira, sin filtros. */
  total: number;
  pagina: number;
  paginas: number;
  error: string | null;
}

type Cliente = SupabaseClient<Database>;

async function cantidad(supabase: Cliente, workspaceId: string, filtros: Record<string, string>) {
  const { data, error } = await supabase.rpc("contactos_cantidad", { p_workspace: workspaceId, p_filtros: filtros as Json });
  return { n: Number(data ?? 0), error: error?.message ?? null };
}

async function pagina(supabase: Cliente, workspaceId: string, filtros: Record<string, string>, n: number) {
  const { data, error } = await supabase
    .rpc("contactos_pagina", { p_workspace: workspaceId, p_filtros: filtros as Json, p_pagina: n, p_por_pagina: CONTACTOS_POR_PAGINA })
    .select(SELECCION_DE_LA_LISTA)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  return { filas: (data ?? []) as unknown as ContactoDeLaLista[], error: error?.message ?? null };
}

/**
 * Una página, la cantidad con filtros y el total del alcance, a la vez. Sin
 * filtros, la cantidad es el total y se pide una sola vez. Una página más
 * allá de la última muestra la última.
 */
export async function leerContactos(supabase: Cliente, workspaceId: string, f: FiltrosDeContactos, n: number): Promise<ListaDeContactos> {
  const filtros = paraLaBaseDeContactos(f);
  const conFiltros = Object.keys(filtros).length > 0;
  const [p, c, t] = await Promise.all([
    pagina(supabase, workspaceId, filtros, n),
    cantidad(supabase, workspaceId, filtros),
    conFiltros ? cantidad(supabase, workspaceId, {}) : Promise.resolve(null),
  ]);
  const error = p.error ?? c.error ?? t?.error ?? null;
  const paginas = paginasDe(c.n);
  let actual = n;
  let filas = p.filas;
  if (!error && n > paginas) {
    actual = paginas;
    const ultima = await pagina(supabase, workspaceId, filtros, paginas);
    if (ultima.error) return { contactos: [], cantidad: c.n, total: t?.n ?? c.n, pagina: actual, paginas, error: ultima.error };
    filas = ultima.filas;
  }
  return { contactos: filas, cantidad: c.n, total: t?.n ?? c.n, pagina: actual, paginas, error };
}
