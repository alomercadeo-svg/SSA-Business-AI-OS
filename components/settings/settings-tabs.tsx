import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Las pestañas de Configuración (§11, «Pantalla: Configuración»). Están solo
 * las que existen: General, Equipo y Correos enviados (F23). Frases de baja,
 * Vigilancia de canales, Alertas e Historial de cambios se suman con su
 * funcionalidad (F34, F39, F22 y F31).
 *
 * Cada pestaña es una ruta propia y no un estado del cliente: así cada una
 * hace su propio control de rol en el servidor (`getWorkspaceAsManager`).
 */
export const PESTANAS_CONFIGURACION = [
  { clave: "general", etiqueta: "General", href: "/dashboard/settings" },
  { clave: "equipo", etiqueta: "Equipo", href: "/dashboard/settings/team" },
  { clave: "correos", etiqueta: "Correos enviados", href: "/dashboard/settings/correos" },
] as const;

export type PestanaConfiguracion = (typeof PESTANAS_CONFIGURACION)[number]["clave"];

export function SettingsTabs({ actual }: { actual: PestanaConfiguracion }) {
  return (
    <nav className="border-b border-border px-8" aria-label="Pestañas de Configuración">
      <div className="-mb-px flex gap-6 overflow-x-auto">
        {PESTANAS_CONFIGURACION.map((p) => (
          <Link
            key={p.clave}
            href={p.href}
            aria-current={p.clave === actual ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 py-3 text-sm font-medium transition-colors",
              p.clave === actual
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {p.etiqueta}
          </Link>
        ))}
      </div>
    </nav>
  );
}
