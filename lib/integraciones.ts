/**
 * Las integraciones de F24: qué proveedores hay, cómo se valida una clave y qué
 * se le muestra al navegador de ella. Todo puro, sin red ni base: lo usan la
 * página, las acciones de servidor y la detección de estado.
 *
 * EL CATÁLOGO NO ARMA LA PANTALLA. La pantalla se arma leyendo
 * `integration_configs` (decidido el 22 de septiembre de 2026, plano §0): un
 * proveedor que aparece como fila y no está acá igual se muestra, con una
 * definición genérica. El catálogo solo dice qué filas se crean por defecto y
 * cómo se comporta cada proveedor conocido.
 *
 * Facebook y X no están, a propósito: quedan fuera de F24 por la misma decisión.
 */
import { SECRET_NAMES } from "@/lib/vault";
import type { IntegrationEstado, IntegrationTipo } from "@/lib/types/database";

export interface DefinicionProveedor {
  proveedor: string;
  tipo: IntegrationTipo;
  nombre: string;
  orden: number;
  /** Nombre del secreto en Vault. */
  secreto: string;
  /** Si la clave se carga desde esta pantalla. */
  editable: boolean;
  /** Si se muestra el largo y los últimos cuatro de la clave. */
  mostrarMascara: boolean;
  /** Si la integración lleva un modelo por defecto (los proveedores de IA). */
  conModelo: boolean;
  largoMinimo: number;
  /** Solo donde está documentado. Hoy, Resend (`re_`, en su referencia de la API). */
  prefijo?: string;
}

/**
 * Los largos mínimos son un supuesto, no un dato de los proveedores: ninguno
 * documenta el largo de sus claves. Sirven para atajar un pegado incompleto,
 * no para validar la clave, que se valida preguntándole al proveedor.
 */
export const PROVEEDORES: Record<string, DefinicionProveedor> = {
  zernio: {
    proveedor: "zernio", tipo: "canal", nombre: "Instagram", orden: 10,
    secreto: SECRET_NAMES.zernio, editable: true, mostrarMascara: true, conModelo: false, largoMinimo: 16,
  },
  evolution: {
    // La clave global de Evolution y el token de instancia nunca se muestran ni
    // se cargan desde acá: se configuran con el despliegue (docs/despliegue-evolution.md).
    proveedor: "evolution", tipo: "canal", nombre: "WhatsApp", orden: 20,
    secreto: SECRET_NAMES.evolutionApiKey, editable: false, mostrarMascara: false, conModelo: false, largoMinimo: 16,
  },
  resend: {
    proveedor: "resend", tipo: "correo", nombre: "Correo (Resend)", orden: 30,
    secreto: SECRET_NAMES.resend, editable: true, mostrarMascara: true, conModelo: false, largoMinimo: 16, prefijo: "re_",
  },
  openai: {
    proveedor: "openai", tipo: "ia", nombre: "OpenAI", orden: 40,
    secreto: SECRET_NAMES.openai, editable: true, mostrarMascara: true, conModelo: true, largoMinimo: 20,
  },
  anthropic: {
    proveedor: "anthropic", tipo: "ia", nombre: "Anthropic", orden: 50,
    secreto: SECRET_NAMES.anthropic, editable: true, mostrarMascara: true, conModelo: true, largoMinimo: 20,
  },
  google: {
    proveedor: "google", tipo: "ia", nombre: "Google", orden: 60,
    secreto: SECRET_NAMES.google, editable: true, mostrarMascara: true, conModelo: true, largoMinimo: 20,
  },
};

/** La definición de un proveedor, o una genérica si no está en el catálogo. */
export function definicionDe(proveedor: string, tipo: IntegrationTipo = "canal", nombre?: string): DefinicionProveedor {
  return (
    PROVEEDORES[proveedor] ?? {
      proveedor, tipo, nombre: nombre ?? proveedor, orden: 1000,
      secreto: `integracion_${proveedor}`, editable: true, mostrarMascara: true, conModelo: false, largoMinimo: 8,
    }
  );
}

/** Las filas que se crean si faltan. Ninguna lleva clave: las claves van a Vault. */
export function filasPorDefecto(workspaceId: string) {
  return Object.values(PROVEEDORES).map((d) => ({
    workspace_id: workspaceId,
    tipo: d.tipo,
    proveedor: d.proveedor,
    nombre: d.nombre,
    orden: d.orden,
  }));
}

/** null si la clave tiene un formato aceptable; si no, el motivo en lenguaje claro. */
export function validarFormatoClave(d: DefinicionProveedor, valor: string): string | null {
  const v = valor.trim();
  if (!v) return "La clave está vacía.";
  if (/\s/.test(v)) return "La clave tiene espacios adentro. Probablemente se pegó de más.";
  if (v.length < d.largoMinimo) return `La clave es demasiado corta: tiene ${v.length} caracteres y se esperan al menos ${d.largoMinimo}.`;
  if (d.prefijo && !v.startsWith(d.prefijo)) return `Las claves de ${d.nombre} empiezan con "${d.prefijo}".`;
  return null;
}

const normalizarCuenta = (s: string | null | undefined) => (s ?? "").trim().replace(/^@/, "").toLowerCase();

/**
 * ¿Lo que se escribió para confirmar «Desconectar» es el nombre de la cuenta?
 * Acepta «@» adelante, mayúsculas y espacios alrededor. Una cuenta sin nombre
 * no coincide con nada. Es la misma comparación en el diálogo y en la acción
 * del servidor (criterio de F24 del 07/10/2026).
 */
export function confirmacionCoincide(escrito: string | null | undefined, cuenta: string | null | undefined): boolean {
  const esperado = normalizarCuenta(cuenta);
  return esperado !== "" && normalizarCuenta(escrito) === esperado;
}

export interface Mascara {
  largo: number;
  /** Nulo si la clave es tan corta que mostrar cuatro caracteres sería mostrar demasiado. */
  ultimos4: string | null;
}

/** Lo único que el navegador llega a ver de una clave. */
export function mascaraDeClave(valor: string | null | undefined): Mascara | null {
  if (!valor) return null;
  return { largo: valor.length, ultimos4: valor.length >= 16 ? valor.slice(-4) : null };
}

export const ETIQUETA_ESTADO: Record<IntegrationEstado, string> = {
  conectado: "Conectado",
  desconectado: "Desconectado",
  sin_verificar: "Sin verificar",
  sin_configurar: "Sin configurar",
};

export const TITULO_TIPO: Record<IntegrationTipo, string> = {
  canal: "Canales de mensajería",
  correo: "Correo",
  ia: "Proveedores de IA",
};

const ORDEN_TIPOS: IntegrationTipo[] = ["canal", "correo", "ia"];

/** Agrupa las filas en secciones, en el orden de la pantalla. */
export function agruparPorTipo<T extends { tipo: IntegrationTipo; orden: number }>(filas: T[]) {
  return ORDEN_TIPOS.map((tipo) => ({
    tipo,
    filas: filas.filter((f) => f.tipo === tipo).sort((a, b) => a.orden - b.orden),
  })).filter((s) => s.filas.length > 0);
}

/** Lo que la página lee de cada fila de `integration_configs`. */
export interface FilaIntegracion {
  id: string;
  tipo: IntegrationTipo;
  proveedor: string;
  nombre: string;
  orden: number;
  config: unknown;
  estado: IntegrationEstado;
  verificado_el: string | null;
  ultimo_error: string | null;
}

/** Lo que viaja al navegador por cada integración. Nunca la clave. */
export interface Tarjeta {
  id: string;
  tipo: IntegrationTipo;
  proveedor: string;
  nombre: string;
  orden: number;
  estado: IntegrationEstado;
  verificado_el: string | null;
  ultimo_error: string | null;
  modelo: string | null;
  /** Dato no secreto que escribió la detección: el dominio verificado, cuántas cuentas. */
  detalle: string | null;
  /** El registro del webhook de Zernio, si es la integración de Zernio y ya se leyó. */
  webhook: EstadoWebhook | null;
  /** El remitente de Resend (F23). No es secreto: va en `config`. */
  remitente: string | null;
  configurada: boolean;
  mascara: Mascara | null;
  editable: boolean;
  conModelo: boolean;
  prefijo: string | null;
}

function textoDeConfig(config: unknown, campo: string): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const v = (config as Record<string, unknown>)[campo];
  return typeof v === "string" && v ? v : null;
}

export const modeloDe = (config: unknown) => textoDeConfig(config, "modelo");
export const detalleDe = (config: unknown) => textoDeConfig(config, "detalle");

/**
 * Arma la tarjeta de una fila. Recibe la clave para saber si existe y calcular
 * la máscara, y la clave no sale de acá: la tarjeta la lleva un Client
 * Component, y todo lo que se le pasa termina en el HTML.
 */
/** El remitente de Resend guardado en `config` (F23). */
export function remitenteDe(config: unknown): string | null {
  return textoDeConfig(config, "remitente");
}

export function aTarjeta(fila: FilaIntegracion, valorClave: string | null): Tarjeta {
  const d = definicionDe(fila.proveedor, fila.tipo, fila.nombre);
  return {
    id: fila.id,
    tipo: fila.tipo,
    proveedor: fila.proveedor,
    nombre: fila.nombre,
    orden: fila.orden,
    estado: fila.estado,
    verificado_el: fila.verificado_el,
    ultimo_error: fila.ultimo_error,
    modelo: modeloDe(fila.config),
    detalle: detalleDe(fila.config),
    webhook: webhookDe(fila.config),
    remitente: remitenteDe(fila.config),
    configurada: Boolean(valorClave),
    mascara: d.mostrarMascara ? mascaraDeClave(valorClave) : null,
    editable: d.editable,
    conModelo: d.conModelo,
    prefijo: d.prefijo ?? null,
  };
}

/**
 * El texto de la tarjeta de WhatsApp, según el estado. No según que exista la
 * clave: con la clave cargada y `EVOLUTION_API_URL` faltando, el estado es
 * "sin configurar" y la tarjeta tiene que decirlo (visto en producción el
 * 05/10/2026, cuando decía "configurada").
 */
export function textoConexionEvolution(estado: IntegrationEstado): string {
  switch (estado) {
    case "conectado":
      return "Evolution responde y acepta la clave.";
    case "desconectado":
      return "Evolution rechazó la clave.";
    case "sin_verificar":
      return "No se pudo preguntarle a Evolution, así que no sabemos si responde.";
    case "sin_configurar":
      return "La conexión con Evolution no está configurada.";
  }
}

/** La ruta del receptor de Zernio. El webhook "nuestro" es el que apunta acá. */
export const RUTA_WEBHOOK_ZERNIO = "/api/webhooks/late";

/** El registro del webhook de Zernio, resumido. Nunca el secreto: a lo sumo su máscara. */
export interface EstadoWebhook {
  registrado: boolean;
  url: string | null;
  activo: boolean | null;
  eventos: string[];
  secreto: Mascara | null;
  /** Cuántos webhooks más hay registrados, que no apuntan al receptor. */
  otros: number;
  /** Cuándo se leyó. */
  verificado_el: string | null;
  /** Si no se pudo leer, el motivo. */
  error: string | null;
}

/**
 * Resume la respuesta de `GET /v1/webhooks/settings`. El webhook que cuenta es
 * el que apunta a la ruta del receptor; el host no se compara contra
 * `NEXT_PUBLIC_APP_URL`, que en desarrollo puede ser localhost.
 */
export function resumenWebhook(cuerpo: unknown): Omit<EstadoWebhook, "verificado_el" | "error"> {
  const lista = Array.isArray((cuerpo as { webhooks?: unknown })?.webhooks)
    ? ((cuerpo as { webhooks: unknown[] }).webhooks as Record<string, unknown>[])
    : [];
  const rutaDe = (u: unknown) => {
    try {
      return typeof u === "string" ? new URL(u).pathname : null;
    } catch {
      return null;
    }
  };
  const nuestro = lista.find((w) => rutaDe(w?.url) === RUTA_WEBHOOK_ZERNIO);
  if (!nuestro) return { registrado: false, url: null, activo: null, eventos: [], secreto: null, otros: lista.length };
  return {
    registrado: true,
    url: typeof nuestro.url === "string" ? nuestro.url : null,
    activo: typeof nuestro.isActive === "boolean" ? nuestro.isActive : null,
    eventos: Array.isArray(nuestro.events) ? nuestro.events.filter((e): e is string => typeof e === "string") : [],
    secreto: mascaraDeClave(typeof nuestro.secret === "string" ? nuestro.secret : null),
    otros: lista.length - 1,
  };
}

/**
 * Lee el registro del webhook de `config`, campo por campo. Lo que no está en
 * esta lista no sale, aunque esté en la base: `config` viaja al navegador por
 * Realtime y en la tarjeta.
 */
export function webhookDe(config: unknown): EstadoWebhook | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const w = (config as Record<string, unknown>).webhook;
  if (!w || typeof w !== "object" || Array.isArray(w)) return null;
  const v = w as Record<string, unknown>;
  const s = v.secreto as Record<string, unknown> | null | undefined;
  return {
    registrado: v.registrado === true,
    url: typeof v.url === "string" ? v.url : null,
    activo: typeof v.activo === "boolean" ? v.activo : null,
    eventos: Array.isArray(v.eventos) ? v.eventos.filter((e): e is string => typeof e === "string") : [],
    secreto:
      s && typeof s === "object" && typeof s.largo === "number"
        ? { largo: s.largo, ultimos4: typeof s.ultimos4 === "string" && s.ultimos4.length === 4 ? s.ultimos4 : null }
        : null,
    otros: typeof v.otros === "number" ? v.otros : 0,
    verificado_el: typeof v.verificado_el === "string" ? v.verificado_el : null,
    error: typeof v.error === "string" ? v.error : null,
  };
}

/**
 * El remitente de Resend (F23): `Nombre <local@dominio>` o `local@dominio`. El
 * dominio no se puede comprobar contra Resend con una clave de solo envío (no
 * deja consultar dominios): si no es el verificado, el envío falla y el error
 * queda registrado en `email_log`.
 */
export function validarRemitente(valor: string): string | null {
  const v = valor.trim();
  if (!v) return "Falta el remitente.";
  const m = v.match(/^(?:[^<>@]+<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>|([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+))$/);
  if (!m) return "El remitente tiene que ser una dirección, como «ALO Mercadeo <avisos@notificaciones.alomercadeo.com>».";
  return null;
}

/** El dominio desde el que sale el correo, para mostrarlo. */
export function dominioDeRemitente(remitente: string | null | undefined): string | null {
  const m = (remitente ?? "").match(/@([^>\s]+)>?\s*$/);
  return m ? m[1].toLowerCase() : null;
}
