"use client";

/**
 * La pantalla de error de §11.1, con sus textos. Nunca el error técnico crudo:
 * ese queda en el log del servidor.
 */
export default function ErrorVigilancia({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <h1 className="text-lg font-semibold">No pudimos cargar esta pantalla</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Se perdió la conexión con el servidor. Revisá tu internet y volvé a intentar.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Reintentar
      </button>
    </div>
  );
}
