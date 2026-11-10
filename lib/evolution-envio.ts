/**
 * F42: el envío de un texto por Evolution, desde el servidor.
 *
 * Verificado en el código público de Evolution 2.3.7 (etiqueta `2.3.7`):
 *   - `POST {EVOLUTION_API_URL}/message/sendText/{instancia}`
 *     (`index.router.ts:218`, `sendMessage.router.ts:54`,
 *     `abstract.router.ts:22-26`), responde 201.
 *   - Encabezado `apikey`: la clave global o el token de la instancia
 *     (`auth.guard.ts:10-35`). Acá, el token de la instancia, de Vault.
 *   - Cuerpo `{ number, text }` (`sendMessage.dto.ts:39-52`). Un JID entero
 *     (`@s.whatsapp.net` o `@lid`) se usa tal cual (`createJid.ts`).
 *   - Responde el mensaje armado, con `key.id` (`whatsapp.baileys.service.ts`
 *     `:2557`, `prepareMessage` `:4652-4657`); el aviso `send.message` de ese
 *     envío trae el mismo `key.id`.
 *
 * El token nunca va a un log.
 */

export const ESPERA_DEL_ENVIO_MS = 15_000;

/** `rechazo`: Evolution respondió con un error, o no se pudo conectar. `sin_respuesta`: no respondió a tiempo, o respondió sin id. */
export type FalloDeEnvio = "rechazo" | "sin_respuesta";

export class ErrorDeEnvioEvolution extends Error {
  constructor(
    public readonly tipo: FalloDeEnvio,
    public readonly status: number | null,
  ) {
    super(`envío por Evolution: ${tipo}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ErrorDeEnvioEvolution";
  }
}

export async function enviarTextoPorEvolution(o: {
  base: string;
  instancia: string;
  token: string;
  numero: string;
  texto: string;
  esperaMs?: number;
  fetch?: typeof fetch;
}): Promise<{ id: string }> {
  const url = `${o.base.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(o.instancia)}`;
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), o.esperaMs ?? ESPERA_DEL_ENVIO_MS);
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(url, {
      method: "POST",
      headers: { apikey: o.token, "Content-Type": "application/json" },
      body: JSON.stringify({ number: o.numero, text: o.texto }),
      signal: corte.signal,
    });
  } catch (err) {
    const nombre = err instanceof Error ? err.name : "";
    // Se cortó por tiempo: puede haber salido. Cualquier otro fallo de red
    // (sin conexión, DNS) no llegó a Evolution: no salió.
    throw new ErrorDeEnvioEvolution(corte.signal.aborted || nombre === "AbortError" || nombre === "TimeoutError" ? "sin_respuesta" : "rechazo", null);
  } finally {
    clearTimeout(reloj);
  }
  if (!res.ok) throw new ErrorDeEnvioEvolution("rechazo", res.status);
  const datos = (await res.json().catch(() => null)) as { key?: { id?: unknown } } | null;
  const id = typeof datos?.key?.id === "string" && datos.key.id ? datos.key.id : null;
  // Respondió bien pero sin id: el mensaje puede haber salido; lo guarda el aviso.
  if (!id) throw new ErrorDeEnvioEvolution("sin_respuesta", res.status);
  return { id };
}
