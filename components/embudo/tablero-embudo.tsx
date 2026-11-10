import Link from "next/link";
import { cn } from "@/lib/utils";
import type { armarEmbudo, FiltroDeEmbudo } from "@/lib/embudo";

/**
 * El tablero del Embudo (10/11/2026), de solo lectura: una columna por etapa,
 * de costado en el teléfono (cada una casi del ancho) y en la computadora
 * (todas las que entren). Sin JavaScript en el navegador: el filtro son
 * enlaces y queda en la dirección, como en Contactos.
 */
const FILTROS: { valor: FiltroDeEmbudo; texto: string }[] = [
  { valor: "todos", texto: "Todos" },
  { valor: "abierto", texto: "Abiertos" },
  { valor: "ganado", texto: "Ganados" },
  { valor: "perdido", texto: "Perdidos" },
];

const ESTADO: Record<string, { texto: string; clase: string }> = {
  abierto: { texto: "Abierto", clase: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  ganado: { texto: "Ganado", clase: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  perdido: { texto: "Perdido", clase: "bg-muted text-muted-foreground" },
};

const numero = (n: number) => new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 }).format(n);
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function TableroEmbudo({
  embudo,
  filtro,
  total,
  limite,
}: {
  embudo: ReturnType<typeof armarEmbudo>;
  filtro: FiltroDeEmbudo;
  total: number;
  limite: number;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-6 sm:px-8">
        <h1 className="text-2xl font-bold">Embudo</h1>
        <p className="mt-1 text-sm text-muted-foreground">Los contactos por etapa. Solo lectura.</p>
        {total > limite && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Hay {total} contactos con etapa. Se muestran los primeros {limite}, por nombre.
          </p>
        )}
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Filtrar por estado">
          {FILTROS.map((f) => (
            <Link
              key={f.valor}
              href={f.valor === "todos" ? "/dashboard/embudo" : `/dashboard/embudo?estado=${f.valor}`}
              aria-current={filtro === f.valor ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                filtro === f.valor ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent/50",
              )}
            >
              {f.texto} · {f.valor === "todos" ? embudo.cantidades.todos : embudo.cantidades[f.valor]}
            </Link>
          ))}
        </nav>
      </div>

      {embudo.vacio ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="text-sm text-muted-foreground">Todavía no hay contactos con etapa. Las etapas llegan con la importación desde Pipedrive.</p>
        </div>
      ) : (
        <div className="flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 sm:snap-none sm:px-8">
          {embudo.columnas.map((col) => (
            <section key={col.etapa} className="flex w-[85vw] flex-shrink-0 snap-start flex-col rounded-lg border border-border bg-muted/30 sm:w-72">
              <header className="border-b border-border p-3">
                <h2 className="text-sm font-semibold">{col.etapa}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {col.contactos.length} {col.contactos.length === 1 ? "contacto" : "contactos"}
                  {col.sumas.map((s) => (
                    <span key={s.moneda}>
                      {" · "}
                      {numero(s.total)} {s.moneda}
                    </span>
                  ))}
                </p>
              </header>
              <ul className="flex-1 space-y-2 overflow-y-auto p-2">
                {col.contactos.length === 0 && <li className="p-2 text-xs text-muted-foreground">Sin contactos</li>}
                {col.contactos.map((contacto) => {
                  const estado = contacto.deal_status ? ESTADO[contacto.deal_status] : null;
                  const valor = Number(contacto.deal_value ?? 0);
                  return (
                    <li key={contacto.id}>
                      <Link href={`/dashboard/contacts/${contacto.id}`} className="block rounded-md border border-border bg-background p-2 hover:bg-accent/50">
                        <span className="block truncate text-sm font-medium">{contacto.display_name || "Sin nombre"}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {estado && <span className={cn("rounded px-1.5 py-0.5", estado.clase)}>{estado.texto}</span>}
                          {valor > 0 && (
                            <span>
                              {numero(valor)} {contacto.deal_currency ?? ""}
                            </span>
                          )}
                          {contacto.deal_closed_at && <span>Cierre: {dia(contacto.deal_closed_at)}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
