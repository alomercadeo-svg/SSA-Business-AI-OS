/**
 * «Editar datos» de la ficha (F30): leer el pedido y calcular qué cambió.
 *
 * La escritura va por `PATCH /api/v1/contacts/[contactId]`, con el cliente del
 * usuario: la seguridad por filas decide qué contacto puede tocar (la 00019, y
 * desde la 00038 nunca uno eliminado). Lo que vive acá no depende de la base.
 *
 * Los campos son los datos del criterio de F30 que se escriben a mano: nombre,
 * correo, correo secundario, teléfono, país, temperatura y próximo
 * seguimiento. Setter y vendedor van por su propia ruta (F41). Las redes son
 * el usuario de cada canal: las escribe el proveedor, no una persona (F25).
 *
 * El teléfono no se escribe acá: pasa por `reconciliar_telefono` en la vía
 * manual (00031), que lo normaliza, detecta si ya es de otro contacto y deja
 * su propia fila en el historial.
 */
import { normalizarTelefono } from "./telefono";

export const TEMPERATURAS = ["frio", "tibio", "caliente"] as const;
export type Temperatura = (typeof TEMPERATURAS)[number];

export interface CamposEditables {
  display_name: string;
  email: string | null;
  secondary_email: string | null;
  country: string | null;
  lead_temperature: Temperatura | null;
  next_followup_date: string | null;
}
export type PedidoDeEdicion = Partial<CamposEditables> & { phone?: string };

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

type Lectura = { ok: true; pedido: PedidoDeEdicion } | { ok: false; error: string };

const vacioANulo = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** Valida y normaliza. Rechaza cualquier clave que no sea editable desde la ficha. */
export function leerPedidoDeEdicion(cuerpo: unknown): Lectura {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return { ok: false, error: "Pedido inválido." };
  const entrada = cuerpo as Record<string, unknown>;
  const permitidas = ["display_name", "email", "secondary_email", "phone", "country", "lead_temperature", "next_followup_date"];
  if (Object.keys(entrada).length === 0 || Object.keys(entrada).some((k) => !permitidas.includes(k))) {
    return { ok: false, error: "Pedido inválido." };
  }
  const pedido: PedidoDeEdicion = {};

  if ("display_name" in entrada) {
    const v = entrada.display_name;
    if (typeof v !== "string" || v.trim().length === 0) return { ok: false, error: "El nombre no puede quedar vacío." };
    if (v.trim().length > 200) return { ok: false, error: "El nombre es demasiado largo." };
    pedido.display_name = v.trim();
  }
  for (const campo of ["email", "secondary_email"] as const) {
    if (!(campo in entrada)) continue;
    const v = vacioANulo(entrada[campo]);
    if (v === null) pedido[campo] = null;
    else if (typeof v !== "string" || !CORREO.test(v.trim())) return { ok: false, error: "Ese correo no tiene un formato válido." };
    else pedido[campo] = v.trim().toLowerCase();
  }
  if ("phone" in entrada) {
    const v = entrada.phone;
    if (typeof v !== "string" || v.trim() === "") return { ok: false, error: "El teléfono no se puede borrar desde acá." };
    const tel = normalizarTelefono(v);
    if (!tel) return { ok: false, error: "Escribilo con el signo + y el código de país, por ejemplo +506 7034 9182." };
    pedido.phone = tel;
  }
  if ("country" in entrada) {
    const v = vacioANulo(entrada.country);
    if (v !== null && (typeof v !== "string" || v.trim().length > 80)) return { ok: false, error: "El país no es válido." };
    pedido.country = v === null ? null : (v as string).trim();
  }
  if ("lead_temperature" in entrada) {
    const v = vacioANulo(entrada.lead_temperature);
    if (v !== null && !TEMPERATURAS.includes(v as Temperatura)) return { ok: false, error: "La temperatura no es válida." };
    pedido.lead_temperature = v as Temperatura | null;
  }
  if ("next_followup_date" in entrada) {
    const v = vacioANulo(entrada.next_followup_date);
    if (v !== null && (typeof v !== "string" || !FECHA.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) {
      return { ok: false, error: "La fecha de seguimiento no es válida." };
    }
    pedido.next_followup_date = v as string | null;
  }
  return { ok: true, pedido };
}

export type Cambios = Record<string, { antes: unknown; despues: unknown }>;

/** Lo que cambia de verdad, sin el teléfono (que va por su función). */
export function cambiosDeEdicion(actual: Record<string, unknown>, pedido: PedidoDeEdicion): Cambios {
  const cambios: Cambios = {};
  for (const [campo, despues] of Object.entries(pedido)) {
    if (campo === "phone") continue;
    const antes = actual[campo] ?? null;
    if (antes !== despues) cambios[campo] = { antes, despues };
  }
  return cambios;
}
