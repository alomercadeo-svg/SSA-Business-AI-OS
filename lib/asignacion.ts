/**
 * Asignación de setter y vendedor (F41).
 *
 * La escritura va por `PATCH /api/v1/contacts/[contactId]/asignacion`, con el
 * cliente del usuario: la RLS de la 00019 decide qué contacto puede tocar.
 * Lo que vive acá es lo que no depende de la base: leer el pedido, calcular
 * qué cambió y el control de origen.
 */

export type CampoDeAsignacion = "setter_id" | "vendedor_id";
export type PedidoDeAsignacion = Partial<Record<CampoDeAsignacion, string | null>>;
export type Asignacion = Record<CampoDeAsignacion, string | null>;

const CAMPOS: CampoDeAsignacion[] = ["setter_id", "vendedor_id"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El control de origen que las acciones de servidor traen solas y una ruta
 * propia no. Las barreras que ya había, verificadas el 19/10/2026: la cookie
 * de sesión va con `SameSite=Lax` (`DEFAULT_COOKIE_OPTIONS` de `@supabase/ssr`
 * 0.8.0, y el proyecto no lo pisa), y un PATCH de otro origen necesita una
 * consulta previa que Next 16.1.6 contesta sin `Access-Control-Allow-Origin`
 * (`auto-implement-methods.js`). Esto suma una tercera, que además cubre un
 * subdominio hermano, para el que `SameSite` no cuenta.
 *
 * Se acepta el origen de `NEXT_PUBLIC_APP_URL` o el que coincide con el host
 * de la petición (`x-forwarded-host` detrás del proxy de Railway, `host` en
 * desarrollo). Sin `Origin`, no: un navegador lo manda siempre en un PATCH.
 */
export function origenPermitido(cabeceras: Headers, appUrl: string | undefined): boolean {
  const origen = cabeceras.get("origin");
  if (!origen || origen === "null") return false;
  let hostDelOrigen: string;
  try {
    hostDelOrigen = new URL(origen).host;
  } catch {
    return false;
  }
  if (appUrl) {
    try {
      if (new URL(appUrl).host === hostDelOrigen) return true;
    } catch {
      // Una NEXT_PUBLIC_APP_URL rota no habilita nada: queda el host.
    }
  }
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host");
  return !!host && host.split(",")[0].trim() === hostDelOrigen;
}

/** Nulo si el pedido no es exactamente `{ setter_id?, vendedor_id? }` con ids o null. */
export function leerPedidoDeAsignacion(cuerpo: unknown): PedidoDeAsignacion | null {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return null;
  const claves = Object.keys(cuerpo);
  if (claves.length === 0) return null;
  const pedido: PedidoDeAsignacion = {};
  for (const clave of claves) {
    if (!CAMPOS.includes(clave as CampoDeAsignacion)) return null;
    const v = (cuerpo as Record<string, unknown>)[clave];
    if (v !== null && (typeof v !== "string" || !UUID.test(v))) return null;
    pedido[clave as CampoDeAsignacion] = v as string | null;
  }
  return pedido;
}

/** Solo los campos pedidos que de verdad cambian. */
export function cambiosDeAsignacion(
  actual: Asignacion,
  pedido: PedidoDeAsignacion,
): Partial<Record<CampoDeAsignacion, { antes: string | null; despues: string | null }>> {
  const cambios: Partial<Record<CampoDeAsignacion, { antes: string | null; despues: string | null }>> = {};
  for (const campo of CAMPOS) {
    if (!(campo in pedido)) continue;
    const despues = pedido[campo] ?? null;
    if (actual[campo] !== despues) cambios[campo] = { antes: actual[campo], despues };
  }
  return cambios;
}

/**
 * El filtro de la lista de contactos por setter o vendedor (F41), tal como
 * viene en la dirección: `?setter=<id>` o `?setter=sin`. Va al servidor y se
 * aplica ANTES del tope de la lista: filtrar en el navegador miraría solo los
 * contactos ya cargados y escondería sin avisar a los que están más abajo.
 * Cualquier otro valor es «todos».
 */
export type FiltroDeAsignacion = { tipo: "todos" } | { tipo: "sin" } | { tipo: "persona"; id: string };

export function filtroDeAsignacion(valor: string | string[] | undefined): FiltroDeAsignacion {
  const v = Array.isArray(valor) ? valor[0] : valor;
  if (v === "sin") return { tipo: "sin" };
  if (typeof v === "string" && UUID.test(v)) return { tipo: "persona", id: v };
  return { tipo: "todos" };
}
