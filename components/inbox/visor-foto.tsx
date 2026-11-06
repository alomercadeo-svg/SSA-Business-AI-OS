"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { conectarVisor } from "@/lib/visor-foto";

/**
 * F44, criterio 4: tocar una foto del hilo la abre a pantalla completa. Usa la
 * misma dirección firmada que ya tiene la burbuja (`archivo.url` de
 * `GET /api/v1/messages`): no baja ni guarda nada nuevo. Vale para Instagram y
 * WhatsApp, que pasan por la misma burbuja. El cierre está en
 * `lib/visor-foto.ts`.
 */
export function FotoDelHilo({ url }: { url: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" aria-label="Ampliar la foto" onClick={() => setAbierta(true)} className="mt-1 block cursor-zoom-in">
        {/* eslint-disable-next-line @next/next/no-img-element -- dirección firmada de Storage, de vida corta */}
        <img src={url} alt="Imagen recibida" loading="lazy" className="max-h-80 max-w-full rounded-lg" />
      </button>
      {abierta && <VisorConHistorial url={url} onCerrado={() => setAbierta(false)} />}
    </>
  );
}

function VisorConHistorial({ url, onCerrado }: { url: string; onCerrado: () => void }) {
  const conexion = useRef<{ cerrar(): void } | null>(null);
  useEffect(() => {
    const c = conectarVisor(window, onCerrado);
    conexion.current = c;
    return () => c.desconectar();
    // Se conecta una vez por apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <VisorDeFoto url={url} onCerrar={() => conexion.current?.cerrar()} />;
}

export function VisorDeFoto({ url, onCerrar }: { url: string; onCerrar: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Foto a pantalla completa"
      // Retrabajo del ítem 4 (06/11/2026), punto e: arriba queda lugar para la
      // «X», así la foto, que entra entera en lo que sobra, nunca la tapa.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-3 pb-3 pt-16"
      onClick={onCerrar}
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={(e) => {
          // Sin esto el clic sube al fondo, que también cierra: dos cierres.
          e.stopPropagation();
          onCerrar();
        }}
        className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- dirección firmada de Storage, de vida corta */}
      <img src={url} alt="Imagen recibida" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
