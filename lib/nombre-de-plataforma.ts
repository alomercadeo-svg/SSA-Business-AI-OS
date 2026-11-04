/**
 * El nombre de cada plataforma para mostrar: «WhatsApp», no «whatsapp».
 *
 * Vivía en `lib/auditoria.ts`, que importa el cliente de Supabase del servidor
 * (`next/headers`). Se sacó acá en el tramo C de S8, cuando el panel del
 * contacto de la bandeja (que corre en el navegador) lo empezó a usar: el
 * import rompía `next build`, y ni Vitest ni `tsc` lo veían. `lib/auditoria.ts`
 * lo vuelve a exportar, así nada más cambia.
 *
 * Sin nada de servidor: lo pueden usar el navegador y el servidor.
 */
const NOMBRE_DE_PLATAFORMA: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  telegram: "Telegram",
  twitter: "X",
  bluesky: "Bluesky",
  reddit: "Reddit",
};

export function nombreDePlataforma(p: string | null | undefined): string {
  return (p && NOMBRE_DE_PLATAFORMA[p]) || p || "canal";
}
