/**
 * B del 09/11/2026: la lista de la bandeja se entera de los cambios solo por
 * Realtime, y un aviso que llega mientras la conexión está caída se pierde (el
 * teléfono que pausa la conexión mientras se está en el chat). Al reconectarse,
 * la lista tiene que volver a pedir sus datos.
 *
 * Recibe cada estado de `channel.subscribe((estado) => …)`. Verificado en
 * `@supabase/realtime-js` 2.95.3: al reconectarse el canal vuelve a avisar
 * `SUBSCRIBED`, porque los avisos de la suscripción no se borran al
 * reenviarla (`dist/main/lib/push.js:25-33`, `RealtimeChannel.js:148-182`).
 * Cerrado, error o tiempo agotado cuentan como corte.
 *
 * Sin React: la usa `components/inbox/conversation-list.tsx`.
 */
export function crearAvisoDeReconexion(alReconectar: () => void): (estado: string) => void {
  let suscriptaAlgunaVez = false;
  let cortada = false;
  return (estado) => {
    if (estado === "SUBSCRIBED") {
      if (suscriptaAlgunaVez && cortada) alReconectar();
      suscriptaAlgunaVez = true;
      cortada = false;
    } else if (estado === "CLOSED" || estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") {
      cortada = true;
    }
  };
}
