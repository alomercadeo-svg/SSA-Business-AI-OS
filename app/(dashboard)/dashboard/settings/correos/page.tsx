import Link from "next/link";
import { Mail } from "lucide-react";
import { getWorkspaceAsManager } from "@/lib/workspace";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { dominioDeRemitente, remitenteDe } from "@/lib/integraciones";
import { estadoDeCorreo, cuandoSeEnvio, ESTADOS_VISIBLES, type TonoPastilla } from "@/lib/correos-enviados";
import { cn } from "@/lib/utils";

/**
 * Configuración › Correos enviados (F23, §11). Solo Owner y Admin: la guarda es
 * `getWorkspaceAsManager`, en el servidor, y la RLS de `email_log` (00027) dice
 * lo mismo en la base.
 *
 * Las omisiones (`omitido_techo`, `omitido_prueba`) no se muestran: no son
 * correos enviados. Quedan en la tabla como prueba de que el techo actuó.
 */
const TONO: Record<TonoPastilla, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export default async function CorreosEnviadosPage() {
  const { workspace, supabase } = await getWorkspaceAsManager();

  const [{ data: correos, error }, { data: resend }] = await Promise.all([
    supabase
      .from("email_log")
      .select("id, created_at, para_etiqueta, asunto, estado, intentos, ultimo_error")
      .eq("workspace_id", workspace.id)
      .in("estado", ESTADOS_VISIBLES)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("integration_configs")
      .select("config")
      .eq("workspace_id", workspace.id)
      .eq("proveedor", "resend")
      .maybeSingle(),
  ]);

  // Lo atrapa `error.tsx`, que muestra la pantalla de error de §11.1. El
  // detalle técnico queda en el log del servidor, no en la pantalla.
  if (error) {
    console.error("correos enviados: no se pudo leer email_log:", error.message);
    throw new Error("No se pudo leer el registro de correos.");
  }

  const dominio = dominioDeRemitente(remitenteDe(resend?.config));

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-bold">Configuración</h1>
      </div>
      <SettingsTabs actual="correos" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-8 py-8">
          {!correos || correos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <Mail className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Todavía no salió ningún correo.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Acá van a aparecer las invitaciones al equipo y los avisos del sistema, como una alerta de un canal.
              </p>
              <Link
                href="/dashboard/settings/team"
                className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Invitar por correo
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Cuándo</th>
                    <th className="px-4 py-2 font-medium">Para</th>
                    <th className="px-4 py-2 font-medium">Asunto</th>
                    <th className="px-4 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {correos.map((c) => {
                    const e = estadoDeCorreo(c.estado, c.intentos);
                    return (
                      <tr key={c.id} className="border-t border-border align-top">
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums">{cuandoSeEnvio(c.created_at)}</td>
                        <td className="px-4 py-2">{c.para_etiqueta}</td>
                        <td className="px-4 py-2">{c.asunto}</td>
                        <td className="px-4 py-2">
                          <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONO[e.tono])}>
                            {e.texto}
                          </span>
                          {c.estado === "fallido" && c.ultimo_error && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{c.ultimo_error}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {dominio
              ? `Salen desde ${dominio}. Si un envío falla, se reintenta hasta 3 veces.`
              : "Todavía no hay remitente: se configura en Integraciones, en la tarjeta de Resend. Si un envío falla, se reintenta hasta 3 veces."}
          </p>
        </div>
      </div>
    </div>
  );
}
