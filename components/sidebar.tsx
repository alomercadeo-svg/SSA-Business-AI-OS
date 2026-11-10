"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  GitBranch,
  MessageSquare,
  MessageSquareText,
  Users,
  Radio,
  ListOrdered,
  BarChart3,
  Plug,
  Settings,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
  Columns3,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { Database } from "@/lib/types/database";

// Solo las columnas que getWorkspace() trae a la UI: la fila completa incluye
// `webhook_secret`, que no debe serializarse a un Client Component. Las dos
// columnas de API keys que este Omit también excluía las borró la 00021.
type Workspace = Omit<
  Database["public"]["Tables"]["workspaces"]["Row"],
  "webhook_secret"
>;

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

function subscribeToThemeClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/**
 * El menú de §11.1 (escrito el 07/10/2026, del prototipo aprobado el 06/10):
 * Bandeja y Contactos para todos; Canales, Integraciones y Configuración solo
 * para Owner y Admin, con Respuestas rápidas (F36). Esconderlas es
 * comodidad: el control real es la guarda del servidor en cada página
 * (`getWorkspaceAsManager`). Growth, del fork, no aparece.
 */
const navigation = [
  { name: "Bandeja", href: "/dashboard/inbox", icon: MessageSquare },
  { name: "Contactos", href: "/dashboard/contacts", icon: Users },
  // 10/11/2026: pantalla fuera del plano, decidida por Marcos para la entrega. Para todos: cada uno ve lo suyo.
  { name: "Embudo", href: "/dashboard/embudo", icon: Columns3 },
  { name: "Canales", href: "/dashboard/channels", icon: Plug, soloManagers: true },
  { name: "Integraciones", href: "/dashboard/settings/integrations", icon: KeyRound, soloManagers: true },
  { name: "Respuestas rápidas", href: "/dashboard/settings/response-templates", icon: MessageSquareText, soloManagers: true },
  { name: "Configuración", href: "/dashboard/settings", icon: Settings, soloManagers: true },
];

/**
 * «Llegan más adelante» (§11.1): en gris, y tocarlos abre un aviso con un botón
 * para volver a la bandeja. No llevan a las pantallas del fork. Los textos son
 * los del prototipo (`docs/diseno/prototipo-fase1.html`, «Fase 2»), con la
 * fase de Analíticas que pone §1.
 */
export const LLEGAN_MAS_ADELANTE = [
  {
    name: "Flujos",
    fase: "Fase 2",
    icon: GitBranch,
    texto:
      "Flujos de conversación: qué pasa cuando alguien escribe una palabra clave o comenta una publicación, y cómo llevar al lead de Instagram a WhatsApp.",
  },
  {
    name: "Secuencias",
    fase: "Fase 2",
    icon: ListOrdered,
    texto:
      "Seguimientos automáticos por WhatsApp (a los 3 días, a la semana, a las dos semanas) que se detienen cuando la persona responde o agenda.",
  },
  {
    name: "Difusiones",
    fase: "Fase 2",
    icon: Radio,
    texto:
      "Envíos a muchas personas a la vez. Está pendiente de decidir si se usan: en un número de WhatsApp conectado de esta forma, son la causa más común de bloqueo.",
  },
  {
    name: "Analíticas",
    fase: "Fase 3",
    icon: BarChart3,
    texto: "Mensajes por canal y por día, conversaciones sin responder y respuestas más comunes. Llega en la Fase 3.",
  },
] as const;

type Proxima = (typeof LLEGAN_MAS_ADELANTE)[number];

/** Las entradas del menú que ve un rol: las de `soloManagers`, solo Owner y Admin. */
export function entradasVisibles(rol: string | undefined) {
  const esManager = rol === "owner" || rol === "admin";
  return navigation.filter((item) => !("soloManagers" in item) || esManager);
}

export function Sidebar({
  workspace,
  workspaces,
}: {
  workspace: Workspace;
  user: { id: string; email?: string };
  workspaces: WorkspaceItem[];
}) {
  const pathname = usePathname();
  const rol = workspaces.find((w) => w.id === workspace.id)?.role;
  const visibles = entradasVisibles(rol);
  // La entrada activa es la de href más largo que coincide: sin esto,
  // /dashboard/settings/integrations marcaría también a Settings.
  const activa = visibles
    .filter((item) => pathname.startsWith(item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const router = useRouter();
  const supabase = createClient();
  const dark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // F35, criterio del teléfono: por debajo de `md` el menú se oculta detrás de
  // un botón y se abre encima. Se cierra al elegir una sección, al tocar
  // afuera o con Escape.
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<Proxima | null>(null);
  useEffect(() => {
    if (!abierto && !aviso) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAviso(null);
        setAbierto(false);
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto, aviso]);

  const contenido = (
    <>
      <div className="border-b border-sidebar-border px-3 py-3">
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibles.map((item) => {
          const isActive = item.href === activa;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => setAbierto(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}

        <p className="px-3 pt-4 pb-1 text-xs font-medium text-sidebar-foreground/50">Llegan más adelante</p>
        {LLEGAN_MAS_ADELANTE.map((item) => (
          <button
            key={item.name}
            type="button"
            onClick={() => {
              setAbierto(false);
              setAviso(item);
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/40 hover:bg-sidebar-accent/50"
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1 text-left">{item.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{item.fase}</span>
          </button>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-1">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? "Modo claro" : "Modo oscuro"}
        </button>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Teléfono: una barra arriba con el botón del menú. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 md:hidden">
        <button
          type="button"
          aria-label="Abrir el menú"
          onClick={() => setAbierto(true)}
          className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="truncate text-sm font-medium">{workspace.name}</span>
      </div>

      {/* Computadora: el menú fijo a la izquierda. */}
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">{contenido}</aside>

      {/* Teléfono, menú abierto: encima de todo, con el fondo que lo cierra. */}
      {abierto && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <aside className="flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-sidebar">
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                aria-label="Cerrar el menú"
                onClick={() => setAbierto(false)}
                className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {contenido}
          </aside>
          <button type="button" aria-label="Cerrar el menú tocando afuera" onClick={() => setAbierto(false)} className="flex-1 bg-black/40" />
        </div>
      )}

      {/* «Llegan más adelante»: el aviso, sin ir a las pantallas del fork. */}
      {aviso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`${aviso.name} llega más adelante`}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-6 text-center shadow-lg">
            <h2 className="text-base font-semibold">{aviso.name} llega más adelante</h2>
            <p className="mt-2 text-sm text-muted-foreground">{aviso.texto}</p>
            <div className="mt-5 flex justify-center gap-2">
              <button type="button" onClick={() => setAviso(null)} className="rounded-lg border border-border px-4 py-2 text-sm">
                Cerrar
              </button>
              <Link
                href="/dashboard/inbox"
                onClick={() => setAviso(null)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Volver a la bandeja
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
