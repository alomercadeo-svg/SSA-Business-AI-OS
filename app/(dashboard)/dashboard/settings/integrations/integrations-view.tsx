"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle, Plug, Mail, Bot } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  ETIQUETA_ESTADO,
  TITULO_TIPO,
  agruparPorTipo,
  modeloDe,
  detalleDe,
  type Tarjeta,
} from "@/lib/integraciones";
import {
  guardarClave,
  borrarClave,
  guardarModelo,
  desconectarCuentaInstagram,
  verificarIntegraciones,
} from "@/lib/actions/integraciones";
import type { IntegrationEstado, IntegrationTipo } from "@/lib/types/database";

interface CuentaInstagram {
  id: string;
  username: string;
  activa: boolean;
}

const ICONO_TIPO: Record<IntegrationTipo, typeof Plug> = { canal: Plug, correo: Mail, ia: Bot };

const COLOR_ESTADO: Record<IntegrationEstado, string> = {
  conectado: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  desconectado: "bg-red-500/10 text-red-700 dark:text-red-400",
  sin_verificar: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  sin_configurar: "bg-muted text-muted-foreground",
};

const claseInput =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring";
const claseBoton =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

function fecha(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" });
}

export function IntegrationsView({
  workspaceId,
  tarjetas: iniciales,
  cuentasInstagram,
  errorDeCarga = false,
}: {
  workspaceId: string;
  tarjetas: Tarjeta[];
  cuentasInstagram: CuentaInstagram[];
  errorDeCarga?: boolean;
}) {
  const [tarjetas, setTarjetas] = useState(iniciales);
  const [base, setBase] = useState(iniciales);

  // Si el servidor vuelve a renderizar (después de guardar), se toma lo nuevo.
  if (base !== iniciales) {
    setBase(iniciales);
    setTarjetas(iniciales);
  }

  // Realtime: el estado que escribe el servidor llega sin recargar. La RLS de
  // `integration_configs` hace que solo Owner y Admin reciban estos eventos.
  // Del evento se toma solo lo que ya es público en la tarjeta: nunca trae
  // claves, porque la tabla no las tiene.
  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`integraciones-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "integration_configs", filter: `workspace_id=eq.${workspaceId}` },
        (p) => {
          if (p.eventType === "DELETE") {
            const id = (p.old as { id?: string })?.id;
            setTarjetas((ts) => ts.filter((t) => t.id !== id));
            return;
          }
          const n = p.new as {
            id: string; tipo: IntegrationTipo; proveedor: string; nombre: string; orden: number;
            estado: IntegrationEstado; verificado_el: string | null; ultimo_error: string | null; config: unknown;
          };
          setTarjetas((ts) => {
            const existe = ts.find((t) => t.id === n.id);
            if (existe) {
              return ts.map((t) =>
                t.id === n.id
                  ? { ...t, nombre: n.nombre, estado: n.estado, verificado_el: n.verificado_el, ultimo_error: n.ultimo_error, modelo: modeloDe(n.config), detalle: detalleDe(n.config) }
                  : t
              );
            }
            // Una fila nueva aparece sin tocar código, con los datos genéricos.
            return [
              ...ts,
              {
                id: n.id, tipo: n.tipo, proveedor: n.proveedor, nombre: n.nombre, orden: n.orden,
                estado: n.estado, verificado_el: n.verificado_el, ultimo_error: n.ultimo_error,
                modelo: modeloDe(n.config), detalle: detalleDe(n.config), configurada: false, mascara: null, editable: true, conModelo: false, prefijo: null,
              },
            ];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [workspaceId]);

  // Al abrir la pantalla, el servidor le pregunta a cada proveedor. El
  // resultado no vuelve por acá: llega por Realtime, arriba.
  const [verificando, iniciarVerificacion] = useTransition();
  useEffect(() => {
    if (errorDeCarga) return;
    iniciarVerificacion(async () => {
      await verificarIntegraciones();
    });
  }, [errorDeCarga]);

  const secciones = agruparPorTipo(tarjetas);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-bold">Integraciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Los servicios externos que usa el sistema: canales, correo e inteligencia artificial.
        </p>
        {verificando && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Preguntándole a cada proveedor…
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          {errorDeCarga && (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                No se pudieron cargar las integraciones. Si la migración 00024 todavía no está aplicada en la base,
                ese es el motivo: la tabla <code>integration_configs</code> no existe aún.
              </p>
            </div>
          )}

          {!errorDeCarga && secciones.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no hay integraciones. Al recargar la página se crean las de Instagram, WhatsApp, correo y los
              tres proveedores de IA.
            </p>
          )}

          {secciones.map((s) => {
            const Icono = ICONO_TIPO[s.tipo];
            return (
              <section key={s.tipo} className="space-y-4">
                <div className="flex items-center gap-2">
                  <Icono className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{TITULO_TIPO[s.tipo]}</h2>
                </div>
                {s.filas.map((t) => (
                  <TarjetaView key={t.id} t={t} cuentasInstagram={cuentasInstagram} />
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TarjetaView({ t, cuentasInstagram }: { t: Tarjeta; cuentasInstagram: CuentaInstagram[] }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t.nombre}</h3>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", COLOR_ESTADO[t.estado])}>
          {ETIQUETA_ESTADO[t.estado]}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.verificado_el ? `Verificado el ${fecha(t.verificado_el)}.` : "Todavía no se verificó."}
        {t.estado === "sin_verificar" && " No se pudo preguntarle al proveedor, así que no sabemos si está conectado."}
      </p>
      {t.detalle && <p className="mt-1 text-xs text-muted-foreground">{t.detalle}</p>}
      {t.ultimo_error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t.ultimo_error}</p>}

      <div className="mt-4 space-y-4">
        {t.proveedor === "zernio" && <Instagram t={t} cuentas={cuentasInstagram} />}
        {t.proveedor === "evolution" && <WhatsApp t={t} />}
        {t.proveedor !== "zernio" && t.proveedor !== "evolution" && t.editable && <ClaveEditable t={t} />}
        {t.conModelo && <Modelo t={t} />}
      </div>
    </div>
  );
}

function EstadoClave({ t }: { t: Tarjeta }) {
  if (!t.configurada) return <p className="text-xs text-muted-foreground">Sin clave cargada.</p>;
  if (!t.mascara) return <p className="text-xs text-muted-foreground">Clave configurada.</p>;
  return (
    <p className="text-xs text-muted-foreground">
      Clave configurada: {t.mascara.largo} caracteres
      {t.mascara.ultimos4 ? `, termina en …${t.mascara.ultimos4}` : ""}.
    </p>
  );
}

function ClaveEditable({ t }: { t: Tarjeta }) {
  const [valor, setValor] = useState("");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-2">
      <EstadoClave t={t} />
      <input
        type="password"
        autoComplete="off"
        value={valor}
        onChange={(e) => {
          setValor(e.target.value);
          setMensaje(null);
        }}
        placeholder={t.configurada ? "Pegá una clave nueva para reemplazar la actual" : `Pegá la clave${t.prefijo ? ` (empieza con ${t.prefijo})` : ""}`}
        className={claseInput}
      />
      <div className="flex items-center gap-2">
        <button
          className={claseBoton}
          disabled={!valor.trim() || pendiente}
          onClick={() =>
            iniciar(async () => {
              const r = await guardarClave(t.proveedor, valor);
              setMensaje(r.ok ? { ok: true, texto: "Clave guardada en Vault." } : { ok: false, texto: r.error });
              if (r.ok) {
                setValor("");
                router.refresh();
              }
            })
          }
        >
          {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar clave
        </button>
        {t.configurada && (
          <button
            className={claseBoton}
            disabled={pendiente}
            onClick={() => {
              if (!window.confirm(`¿Borrar la clave de ${t.nombre}? La integración queda sin configurar.`)) return;
              iniciar(async () => {
                const r = await borrarClave(t.proveedor);
                setMensaje(r.ok ? { ok: true, texto: "Clave borrada." } : { ok: false, texto: r.error });
                if (r.ok) router.refresh();
              });
            }}
          >
            Borrar clave
          </button>
        )}
      </div>
      {mensaje && <p className={cn("text-xs", mensaje.ok ? "text-emerald-600" : "text-red-600")}>{mensaje.texto}</p>}
    </div>
  );
}

function Modelo({ t }: { t: Tarjeta }) {
  const [modelo, setModelo] = useState(t.modelo ?? "");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">Modelo por defecto</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={modelo}
          onChange={(e) => {
            setModelo(e.target.value);
            setMensaje(null);
          }}
          placeholder="Sin definir"
          className={claseInput}
        />
        <button
          className={claseBoton}
          disabled={pendiente || modelo.trim() === (t.modelo ?? "")}
          onClick={() =>
            iniciar(async () => {
              const r = await guardarModelo(t.proveedor, modelo);
              setMensaje(r.ok ? { ok: true, texto: "Modelo guardado." } : { ok: false, texto: r.error });
            })
          }
        >
          Guardar
        </button>
      </div>
      {mensaje && <p className={cn("text-xs", mensaje.ok ? "text-emerald-600" : "text-red-600")}>{mensaje.texto}</p>}
    </div>
  );
}

function WhatsApp({ t }: { t: Tarjeta }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>{t.configurada ? "Conexión con Evolution configurada." : "La conexión con Evolution no está configurada."}</p>
      <p>
        La clave de Evolution se configura con el despliegue y no se muestra nunca. El estado de la sesión de
        WhatsApp y la reconexión con código QR están en{" "}
        <Link href="/dashboard/channels" className="text-primary underline underline-offset-2">
          Canales
        </Link>
        .
      </p>
    </div>
  );
}

function Instagram({ t, cuentas }: { t: Tarjeta; cuentas: CuentaInstagram[] }) {
  const [valor, setValor] = useState("");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [probando, setProbando] = useState(false);
  const [aDesconectar, setADesconectar] = useState<CuentaInstagram | null>(null);
  const router = useRouter();

  async function probarYGuardar() {
    setProbando(true);
    setMensaje(null);
    try {
      // La misma ruta que usa Settings: valida la clave contra Zernio antes de
      // guardarla, y sincroniza las cuentas.
      const res = await fetch("/api/v1/channels/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: valor.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensaje({ ok: false, texto: `Zernio rechazó la clave: ${data.error ?? `HTTP ${res.status}`}` });
      } else {
        setMensaje({ ok: true, texto: `Clave guardada. Zernio devolvió ${data.accounts?.length ?? 0} cuentas.` });
        setValor("");
        router.refresh();
      }
    } finally {
      setProbando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <EstadoClave t={t} />
        <input
          type="password"
          autoComplete="off"
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            setMensaje(null);
          }}
          placeholder={t.configurada ? "Pegá una clave de Zernio nueva para reemplazar la actual" : "Pegá la clave de Zernio"}
          className={claseInput}
        />
        <button className={claseBoton} disabled={!valor.trim() || probando} onClick={probarYGuardar}>
          {probando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Probar y guardar
        </button>
        {mensaje && <p className={cn("text-xs", mensaje.ok ? "text-emerald-600" : "text-red-600")}>{mensaje.texto}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Cuentas</p>
        {cuentas.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No hay cuentas de Instagram. Se conectan desde{" "}
            <Link href="/dashboard/channels" className="text-primary underline underline-offset-2">
              Canales
            </Link>
            .
          </p>
        )}
        {cuentas.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">
              @{c.username} {!c.activa && <span className="text-xs text-muted-foreground">(inactiva)</span>}
            </span>
            {c.activa && (
              <button className={claseBoton} onClick={() => setADesconectar(c)}>
                Desconectar
              </button>
            )}
          </div>
        ))}
      </div>

      {aDesconectar && (
        <ConfirmarDesconexion
          cuenta={aDesconectar}
          onCerrar={() => setADesconectar(null)}
          onHecho={() => {
            setADesconectar(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Confirmación explícita que nombra la cuenta y advierte que los mensajes
 * entrantes dejan de llegar (criterio de F24). Hay que escribir el nombre: la
 * cuenta es la del negocio y un clic no puede cortar el único canal vivo. El
 * servidor vuelve a comparar el nombre; esto es la mitad de la pantalla.
 */
function ConfirmarDesconexion({
  cuenta,
  onCerrar,
  onHecho,
}: {
  cuenta: CuentaInstagram;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const coincide = texto.trim().replace(/^@/, "").toLowerCase() === cuenta.username.toLowerCase();

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-background p-6">
        <h3 className="text-base font-semibold">Desconectar @{cuenta.username}</h3>
        <div className="flex gap-2 rounded-md bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Si desconectás <strong>@{cuenta.username}</strong>, los mensajes entrantes de esa cuenta dejan de llegar a
            la bandeja hasta que se vuelva a conectar. Las conversaciones que ya están guardadas no se borran.
          </p>
        </div>
        <label className="block text-xs font-medium text-muted-foreground">
          Para confirmar, escribí el nombre de la cuenta: @{cuenta.username}
        </label>
        <input
          type="text"
          autoComplete="off"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setError(null);
          }}
          className={claseInput}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={claseBoton} onClick={onCerrar} disabled={pendiente}>
            Cancelar
          </button>
          <button
            className={cn(claseBoton, "border-red-500/50 text-red-700 dark:text-red-400")}
            disabled={!coincide || pendiente}
            onClick={() =>
              iniciar(async () => {
                const r = await desconectarCuentaInstagram(cuenta.id, texto);
                if (r.ok) onHecho();
                else setError(r.error);
              })
            }
          >
            {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Desconectar @{cuenta.username}
          </button>
        </div>
      </div>
    </div>
  );
}
