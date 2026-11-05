"use client";

import { useEffect, useState } from "react";

/**
 * La hora de ahora, que se actualiza sola (F40): con ella, la ventana de
 * Instagram de la lista y del hilo cambia mientras se mira, y el campo se
 * deshabilita al cerrarse sin recargar. Es el reloj del navegador: la guardia
 * de verdad es la del servidor (POST /api/v1/messages), así que un reloj
 * corrido solo puede mostrar mal unos minutos, nunca dejar enviar fuera de la
 * ventana. Un solo intervalo para toda la bandeja (inbox-view.tsx).
 */
export function useAhora(cadaMs = 30_000): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora;
}
