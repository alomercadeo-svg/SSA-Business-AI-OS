/**
 * La lectura de la lista de la bandeja (F35, tramo A de S8), en el servidor.
 *
 * Hasta el 03/11/2026 la bandeja cargaba un tope fijo de 50 conversaciones y
 * buscaba solo entre esas, en el navegador. Ahora la lista, la búsqueda y las
 * cantidades de las pestañas las calculan las funciones de la 00043 sobre
 * todas las conversaciones que quien mira puede ver; desde el tramo B
 * (04/11/2026), las de la 00044, con los filtros. Son `security invoker`,
 * así que la seguridad por filas decide igual que en una lectura directa.
 *
 * La usan la página de la bandeja (la primera página, en el servidor) y la
 * ruta `GET /api/v1/conversations` (las siguientes, la búsqueda y Realtime).
 * No es `"use client"` ni importa nada de servidor: recibe el cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./types/database";
import { SIN_FILTROS, filtrosParaLaBase, type FiltrosDeBandeja } from "./filtros-bandeja";

export const CONVERSACIONES_POR_PAGINA = 50;
/** Lo buscado se corta acá: más largo no identifica mejor a nadie. */
export const LARGO_MAXIMO_DE_BUSQUEDA = 100;

/** Las pestañas: «Abiertas», «Cerradas» y «Todas». `snoozed` no tiene pestaña (F35). */
export type EstadoDeBandeja = "open" | "closed" | "all";

export interface CursorDeBandeja {
  /** `last_message_at`, o `-infinity` si no tiene: la base ordena así. */
  orden: string;
  id: string;
}

export interface CantidadesDeBandeja {
  abiertas: number;
  cerradas: number;
  todas: number;
}

export type ConversacionDeBandeja = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: Database["public"]["Tables"]["contacts"]["Row"] | null;
};

type Cliente = SupabaseClient<Database>;

const primero = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export function estadoDeBandeja(v: unknown): EstadoDeBandeja {
  const e = primero(v);
  return e === "closed" || e === "all" ? e : "open";
}

export function busquedaDeBandeja(v: unknown): string {
  const q = primero(v);
  return typeof q === "string" ? q.trim().slice(0, LARGO_MAXIMO_DE_BUSQUEDA) : "";
}

export function cursorDe(c: { id: string; last_message_at: string | null }): CursorDeBandeja {
  return { orden: c.last_message_at ?? "-infinity", id: c.id };
}

export interface PedidoDeBandeja {
  estado: EstadoDeBandeja;
  busqueda: string;
  cursor: CursorDeBandeja | null;
  /** Los filtros (tramo B). Sin filtros si no viene. */
  filtros?: FiltrosDeBandeja;
  /** Una sola conversación, con los mismos filtros (la que avisa Realtime). */
  id?: string;
}

export interface PaginaDeBandeja {
  conversaciones: ConversacionDeBandeja[];
  hayMas: boolean;
  error: string | null;
}

/**
 * Una página, o una sola por id, con `bandeja_pagina_filtros` (00044). Por id
 * va a la misma función con `p_id`, que filtra por id antes del límite: así
 * una conversación lejana vuelve igual, si cumple los filtros.
 */
export async function leerPaginaDeBandeja(supabase: Cliente, workspaceId: string, pedido: PedidoDeBandeja): Promise<PaginaDeBandeja> {
  const { data, error } = await supabase
    .rpc("bandeja_pagina_filtros", {
      p_workspace: workspaceId,
      p_estado: pedido.estado,
      p_filtros: filtrosParaLaBase(pedido.filtros ?? SIN_FILTROS, pedido.busqueda) as Json,
      p_antes_orden: pedido.cursor?.orden ?? null,
      p_antes_id: pedido.cursor?.id ?? null,
      p_limite: CONVERSACIONES_POR_PAGINA + 1,
      p_id: pedido.id ?? null,
    })
    .select("*, contacts(*)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  if (error) return { conversaciones: [], hayMas: false, error: error.message };
  const filas = (data ?? []) as unknown as ConversacionDeBandeja[];
  return { conversaciones: filas.slice(0, CONVERSACIONES_POR_PAGINA), hayMas: filas.length > CONVERSACIONES_POR_PAGINA, error: null };
}

export async function leerCantidades(
  supabase: Cliente,
  workspaceId: string,
  busqueda: string,
  filtros: FiltrosDeBandeja = SIN_FILTROS,
): Promise<CantidadesDeBandeja | null> {
  const { data, error } = await supabase.rpc("bandeja_cantidades_filtros", {
    p_workspace: workspaceId,
    p_filtros: filtrosParaLaBase(filtros, busqueda) as Json,
  });
  const fila = Array.isArray(data) ? data[0] : null;
  if (error || !fila) return null;
  return { abiertas: Number(fila.abiertas), cerradas: Number(fila.cerradas), todas: Number(fila.todas) };
}

type Ordenable = { id: string; last_message_at: string | null };

/**
 * El orden de la base (00043), en el navegador: último mensaje del más nuevo
 * al más viejo, las que no tienen al final, y el id de mayor a menor para
 * desempatar. Postgres ordena los uuid como su texto en minúsculas.
 */
export function compararDeBandeja(a: Ordenable, b: Ordenable): number {
  const ta = a.last_message_at ? Date.parse(a.last_message_at) : -Infinity;
  const tb = b.last_message_at ? Date.parse(b.last_message_at) : -Infinity;
  if (ta !== tb) return tb > ta ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/**
 * Suma filas a la lista sin repetir: la versión nueva de una fila reemplaza a
 * la vieja (Realtime), y todo queda en el orden de la base. «Cargar más» puede
 * traer una que Realtime ya había sumado.
 */
export function fusionarDeBandeja<T extends Ordenable>(previas: T[], nuevas: T[]): T[] {
  const porId = new Map(previas.map((f) => [f.id, f]));
  for (const f of nuevas) porId.set(f.id, { ...porId.get(f.id), ...f });
  return [...porId.values()].sort(compararDeBandeja);
}
