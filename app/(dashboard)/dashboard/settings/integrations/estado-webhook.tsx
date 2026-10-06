import { cn } from "@/lib/utils";
import type { EstadoWebhook as Estado } from "@/lib/integraciones";

/**
 * El estado del registro del webhook de Zernio, en la tarjeta de Instagram
 * (F24). Si está registrado, contra qué dirección y cuándo se verificó.
 *
 * Recibe el registro ya pasado por `webhookDe`, que deja afuera todo lo que no
 * está en su lista de campos. Del secreto de firma solo llega la máscara.
 * Sin hooks a propósito: así se puede convertir a HTML en un test.
 */
export function EstadoWebhook({ webhook }: { webhook: Estado | null }) {
  if (!webhook) {
    return <p className="text-xs text-muted-foreground">Todavía no se leyó el registro del webhook.</p>;
  }

  const verificado = webhook.verificado_el
    ? new Date(webhook.verificado_el).toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <div className="space-y-1 rounded-md border border-border px-3 py-2 text-xs">
      <p className="font-medium">Webhook de Zernio</p>
      {webhook.error ? (
        <p className="text-red-600 dark:text-red-400">{webhook.error}</p>
      ) : webhook.registrado ? (
        <>
          <p>
            Registrado hacia <span className="font-mono">{webhook.url}</span>{" "}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                webhook.activo
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-500/10 text-red-700 dark:text-red-400"
              )}
            >
              {webhook.activo ? "Activo" : "Inactivo"}
            </span>
          </p>
          {webhook.eventos.length > 0 && (
            <p className="text-muted-foreground">Eventos: {webhook.eventos.join(", ")}</p>
          )}
          {webhook.secreto && (
            <p className="text-muted-foreground">
              Secreto de firma: {webhook.secreto.largo} caracteres
              {webhook.secreto.ultimos4 ? `, termina en …${webhook.secreto.ultimos4}` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="text-red-600 dark:text-red-400">
          No hay ningún webhook registrado hacia el receptor: la bandeja no recibe los mensajes de Instagram.
          {webhook.otros > 0 && ` Hay ${webhook.otros} registrado${webhook.otros === 1 ? "" : "s"} hacia otra dirección.`}
        </p>
      )}
      {verificado && <p className="text-muted-foreground">Última verificación: {verificado}</p>}
    </div>
  );
}
