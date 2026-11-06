"use client";

/**
 * La lista de Contactos (F43, tramo B de S9).
 *
 * La primera página llega del servidor (page.tsx). Lo demás (la búsqueda, los
 * cinco filtros de la fila y las páginas numeradas) se pide a
 * `GET /api/v1/contacts`, de a un pedido por vez (lib/un-pedido-a-la-vez.ts,
 * como la bandeja): la búsqueda 300 ms después de la última tecla; los filtros
 * y las páginas, enseguida. La dirección se actualiza con lo elegido, para
 * poder compartirla.
 *
 * Las columnas son las de antes, en voseo (decidido por Marcos el 05/11/2026):
 * las de §11 quedan pendientes, sin dueño.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Users, Mail, Calendar, CheckCircle, XCircle, Loader2 } from "lucide-react";
import type { Miembro } from "@/lib/miembros";
import type { Database } from "@/lib/types/database";
import {
  ETAPAS,
  SIN_FILTROS_DE_CONTACTOS,
  direccionDeContactos,
  hayFiltrosDeContactos,
  numerosDePagina,
  type ContactoDeLaLista,
  type FiltrosDeContactos,
  type ListaDeContactos,
} from "@/lib/contactos";
import type { FiltroDeAsignacion } from "@/lib/asignacion";
import { crearUnPedidoALaVez } from "@/lib/un-pedido-a-la-vez";
import { inicialDe, nombreVisible } from "@/lib/nombre-visible";
import { etiquetaDeMiembro } from "@/lib/etiqueta-miembro";
import { ultimaInteraccion } from "@/lib/fechas-contactos";
import { cn } from "@/lib/utils";

type Tag = Database["public"]["Tables"]["tags"]["Row"];
type Lista = Omit<ListaDeContactos, "error">;
interface Pedido {
  filtros: FiltrosDeContactos;
  pagina: number;
}

const mismoPedido = (a: Pedido, b: Pedido) => JSON.stringify(a) === JSON.stringify(b);
const conTotal = (n: number) => `${n} contacto${n === 1 ? "" : "s"}`;
const valorDeAsignacion = (a: FiltroDeAsignacion) => (a.tipo === "persona" ? a.id : a.tipo);
const asignacionDe = (v: string): FiltroDeAsignacion => (v === "todos" ? { tipo: "todos" } : v === "sin" ? { tipo: "sin" } : { tipo: "persona", id: v });
const claseDelSelector =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function ContactsView({
  inicial,
  filtros: filtrosIniciales,
  tags,
  miembros,
  equipoCompleto,
  ahora,
  recienEliminado = false,
}: {
  inicial: Lista;
  filtros: FiltrosDeContactos;
  tags: Tag[];
  /** Owner y Admin: el equipo entero. Un Member: solo él mismo (F43, pendiente de S8). */
  miembros: Miembro[];
  equipoCompleto: boolean;
  /** El reloj del pedido, para que el servidor y el navegador dibujen las mismas fechas. */
  ahora: string;
  /** F30: se vuelve de eliminar uno desde su ficha. */
  recienEliminado?: boolean;
}) {
  const [lista, setLista] = useState<Lista>(inicial);
  const [filtros, setFiltros] = useState<FiltrosDeContactos>(filtrosIniciales);
  const [search, setSearch] = useState(filtrosIniciales.q);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lo elegido ahora, para armar el pedido sin esperar a que React vuelva a dibujar.
  const elegidos = useRef<FiltrosDeContactos>(filtrosIniciales);
  const reloj = new Date(ahora);

  const [pedidos] = useState(() =>
    crearUnPedidoALaVez<Pedido, Lista>({
      esperaMs: 300,
      inicial: { filtros: filtrosIniciales, pagina: inicial.pagina },
      igual: mismoPedido,
      ejecutar: async (p) => {
        const direccion = direccionDeContactos(p.filtros, p.pagina).replace("/dashboard/contacts", "/api/v1/contacts");
        const res = await fetch(direccion);
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data?.contactos)) throw new Error(String(res.status));
        return data as Lista;
      },
      aplicar: (p, data) => {
        setError(null);
        setLista(data);
        window.history.replaceState(null, "", direccionDeContactos(p.filtros, data.pagina));
      },
      alFallar: () => setError("No se pudo cargar la lista. Probá de nuevo."),
      alCambiarOcupado: setBuscando,
    }),
  );

  // La búsqueda, 300 ms después de la última tecla, desde la página 1.
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    const nuevos = { ...elegidos.current, q: search.trim() };
    elegidos.current = nuevos;
    setFiltros(nuevos);
    pedidos.escribir({ filtros: nuevos, pagina: 1 });
  }, [search, pedidos]);
  useEffect(() => () => pedidos.cancelar(), [pedidos]);

  function filtrar(cambio: Partial<FiltrosDeContactos>) {
    const nuevos = { ...elegidos.current, ...cambio };
    elegidos.current = nuevos;
    setFiltros(nuevos);
    pedidos.pedirYa({ filtros: nuevos, pagina: 1 });
  }

  function limpiar() {
    elegidos.current = SIN_FILTROS_DE_CONTACTOS;
    setFiltros(SIN_FILTROS_DE_CONTACTOS);
    setSearch("");
    pedidos.pedirYa({ filtros: SIN_FILTROS_DE_CONTACTOS, pagina: 1 });
  }

  function irA(n: number, e: React.MouseEvent) {
    e.preventDefault();
    pedidos.pedirYa({ filtros: elegidos.current, pagina: n });
  }

  const conFiltros = hayFiltrosDeContactos(filtros);
  const nombreDe = (id: string | null) => etiquetaDeMiembro(id, miembros, equipoCompleto);

  const asignacion = (campo: "setter" | "vendedor", titulo: string) => (
    <select
      aria-label={titulo}
      value={valorDeAsignacion(filtros[campo])}
      onChange={(e) => filtrar({ [campo]: asignacionDe(e.target.value) })}
      className={claseDelSelector}
    >
      <option value="todos">{`${titulo}: todos`}</option>
      {miembros.map((m) => (
        <option key={m.id} value={m.id}>
          {m.etiqueta}
        </option>
      ))}
      <option value="sin">Sin asignar</option>
    </select>
  );

  const enlaceDePagina = (n: number, texto: React.ReactNode, deshabilitado = false, actual = false) =>
    deshabilitado ? (
      <span className="rounded-md px-2.5 py-1 text-sm text-muted-foreground/50">{texto}</span>
    ) : (
      <a
        href={direccionDeContactos(filtros, n)}
        onClick={(e) => irA(n, e)}
        aria-current={actual ? "page" : undefined}
        className={cn(
          "rounded-md px-2.5 py-1 text-sm transition-colors",
          actual ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {texto}
      </a>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Contactos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {conFiltros ? `${lista.cantidad} de ${conTotal(lista.total)}` : conTotal(lista.total)}
            </p>
            {recienEliminado && (
              <p className="mt-2 text-sm text-green-700 dark:text-green-400">Contacto eliminado. Podés restaurarlo durante 30 días.</p>
            )}
          </div>
          <Link
            href="/dashboard/contacts?vista=eliminados"
            className="shrink-0 rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Eliminados
          </Link>
        </div>

        {/* Ítem 5 del plan maestro (06/11/2026): el buscador ocupa el ancho que
            sobra, con un mínimo para que no corte el texto, y los filtros pasan
            abajo cuando no entran. En el teléfono, el buscador a todo el ancho
            y los filtros debajo, en dos columnas. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-auto sm:min-w-[20rem] sm:flex-[1_1_20rem]">
            {buscando ? (
              <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            )}
            <input
              type="text"
              aria-label="Buscar contactos"
              placeholder="Buscar por nombre, teléfono o correo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3">
          <select
            aria-label="Seguimiento"
            value={filtros.seguimiento ?? ""}
            onChange={(e) => filtrar({ seguimiento: (e.target.value || null) as FiltrosDeContactos["seguimiento"] })}
            className={claseDelSelector}
          >
            <option value="">Seguimiento: todos</option>
            <option value="hoy">Vence hoy</option>
            <option value="semana">Vence esta semana</option>
            <option value="vencido">Vencido</option>
          </select>
          <select aria-label="Etapa" value={filtros.etapa ?? ""} onChange={(e) => filtrar({ etapa: e.target.value || null })} className={claseDelSelector}>
            <option value="">Etapa: todas</option>
            {ETAPAS.map((etapa) => (
              <option key={etapa} value={etapa}>
                {etapa}
              </option>
            ))}
          </select>
          {asignacion("setter", "Setter")}
          {asignacion("vendedor", "Vendedor")}
          <select aria-label="Etiqueta" value={filtros.etiqueta ?? ""} onChange={(e) => filtrar({ etiqueta: e.target.value || null })} className={claseDelSelector}>
            <option value="">Etiqueta: todas</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          {/* F43, criterio del 05/11/2026: arranca apagado (lib/contactos.ts). */}
          <select
            aria-label="Mostrar"
            value={filtros.escribieron ? "si" : ""}
            onChange={(e) => filtrar({ escribieron: e.target.value === "si" })}
            className={claseDelSelector}
          >
            <option value="">Mostrar: todos</option>
            <option value="si">Solo los que escribieron</option>
          </select>
          </div>
          {conFiltros && (
            <button onClick={limpiar} className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Limpiar filtros
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="flex-1 overflow-auto">
        {lista.contactos.length === 0 ? (
          <Vacia total={lista.total} filtros={filtros} conFiltros={conFiltros} limpiar={limpiar} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem]">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground sm:px-8">Nombre</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Correo</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Última interacción</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Etiquetas</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Suscripto</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Setter</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.contactos.map((contact) => (
                    <Fila key={contact.id} contact={contact} setter={nombreDe(contact.setter_id)} reloj={reloj} />
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-8">
              <p className="text-sm text-muted-foreground">{`Página ${lista.pagina} de ${lista.paginas}`}</p>
              <div className="flex flex-wrap items-center gap-1">
                {enlaceDePagina(lista.pagina - 1, "← Anterior", lista.pagina <= 1)}
                {numerosDePagina(lista.pagina, lista.paginas).map((n, i) =>
                  n === "…" ? (
                    <span key={`s${i}`} className="px-1.5 text-sm text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <span key={n}>{enlaceDePagina(n, String(n), false, n === lista.pagina)}</span>
                  ),
                )}
                {enlaceDePagina(lista.pagina + 1, "Siguiente →", lista.pagina >= lista.paginas)}
              </div>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}

function Fila({ contact, setter, reloj }: { contact: ContactoDeLaLista; setter: string; reloj: Date }) {
  const nombre = nombreVisible(contact, contact.contact_channels);
  const etiquetas = contact.contact_tags.map((ct) => ct.tags).filter(Boolean) as Tag[];
  return (
    <tr className="border-b border-border transition-colors hover:bg-accent/50">
      <td className="px-4 py-3 sm:px-8">
        <Link href={`/dashboard/contacts/${contact.id}`} className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {contact.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={contact.avatar_url} alt={nombre} className="h-8 w-8 rounded-full object-cover" />
            ) : (
              inicialDe(nombre)
            )}
          </div>
          <span className="text-sm font-medium hover:underline">{nombre}</span>
          {/* F26: WhatsApp entregó este contacto sin su número. */}
          {!contact.phone_resolved && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Sin resolver</span>
          )}
        </Link>
      </td>
      <td className="px-4 py-3">
        {contact.email ? (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Mail className="h-3 w-3" />
            {contact.email}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/50">Sin correo</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {ultimaInteraccion(contact.last_interaction_at, reloj)}
        </span>
      </td>
      <td className="px-4 py-3">
        {etiquetas.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {etiquetas.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-medium"
                style={tag.color ? { backgroundColor: `${tag.color}20`, borderColor: `${tag.color}40`, color: tag.color } : undefined}
              >
                {tag.name}
              </span>
            ))}
            {etiquetas.length > 3 && <span className="text-[10px] text-muted-foreground">+{etiquetas.length - 3}</span>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/50">Sin etiquetas</span>
        )}
      </td>
      <td className="px-4 py-3">
        {contact.is_subscribed ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
            <CheckCircle className="h-3.5 w-3.5" />
            Sí
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <XCircle className="h-3.5 w-3.5" />
            No
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{setter}</td>
    </tr>
  );
}

function Vacia({ total, filtros, conFiltros, limpiar }: { total: number; filtros: FiltrosDeContactos; conFiltros: boolean; limpiar: () => void }) {
  if (total === 0 && !conFiltros) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
        <Users className="h-10 w-10 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium text-muted-foreground">Todavía no hay contactos</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Los contactos se crean solos cuando alguien escribe por Instagram o WhatsApp.</p>
        <Link href="/dashboard/inbox" className="mt-4 rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent">
          Ir a la bandeja
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
      <Users className="h-10 w-10 text-muted-foreground/40" />
      <p className="mt-3 text-sm font-medium text-muted-foreground">
        {filtros.q ? `Ningún contacto coincide con «${filtros.q}»` : "Ningún contacto con estos filtros"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground/70">Probá con otros filtros o limpialos para ver todos.</p>
      <button onClick={limpiar} className="mt-4 rounded-lg border border-input px-3 py-2 text-sm font-medium hover:bg-accent">
        Limpiar filtros
      </button>
    </div>
  );
}
