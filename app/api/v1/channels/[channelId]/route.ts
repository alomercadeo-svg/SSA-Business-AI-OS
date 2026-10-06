import { NextResponse } from "next/server";

/**
 * DELETE /api/v1/channels/[channelId]: deshabilitada, responde 405.
 *
 * La versión heredada del fork desconectaba la cuenta en Zernio y después
 * borraba la fila del canal, que arrastraba en cascada sus conversaciones,
 * sus mensajes, la identidad del contacto en ese canal y el resto de su
 * historia. El historial vive en la base local por decisión cerrada del
 * proyecto, así que esta ruta no puede existir así.
 *
 * El único camino para desconectar es la acción de F24
 * (`desconectarCuentaInstagram`, en la pantalla de integraciones), que marca
 * el canal inactivo y no borra nada.
 *
 * Quitada el 5 de octubre de 2026. Lo cuida `route.test.ts`.
 */
export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error:
        "Borrar un canal no está permitido: borraría su historial. Para desconectar una cuenta, usá la pantalla de integraciones, que marca el canal como inactivo.",
    },
    { status: 405, headers: { Allow: "" } }
  );
}
