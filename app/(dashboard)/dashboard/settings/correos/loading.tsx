/** Esqueleto de la pestaña Correos enviados (§11.1: estructura, no un círculo girando). */
export default function CargandoCorreos() {
  return (
    <div className="px-8 py-6">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="mt-6 flex gap-6">
        {[16, 14, 32].map((w, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div className="mx-auto mt-8 max-w-4xl space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
