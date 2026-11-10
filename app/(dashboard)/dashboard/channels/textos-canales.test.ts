import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Canales en español (10/11/2026, revisión liviana): solo textos de la pantalla, sin tocar lógica ni lo que llama a Zernio. */
const vista = readFileSync(join(process.cwd(), "app/(dashboard)/dashboard/channels/channels-view.tsx"), "utf8");

describe("los textos de Canales", () => {
  it("no queda ninguno de los textos en inglés de la pantalla", () => {
    for (const t of [
      ">Channels<",
      "Your connected social media accounts",
      '"Sync"',
      "Syncing...",
      "Connect Channel",
      "No channels yet",
      "Connect a social media account",
      '"Active"',
      '"Inactive"',
      "Copied!",
      "Copy DM link",
      "Failed to connect",
      "Failed to start connection",
      "Sync failed",
      "Could not save some channels",
      "Nothing to connect",
      "All channels up to date",
      " added`",
      " updated`",
      " deactivated`",
      " conversations imported`",
      "Failed to sync",
    ]) {
      expect(vista, t).not.toContain(t);
    }
  });
  it("están los textos en español aprobados", () => {
    for (const t of [
      ">Canales<",
      "Las cuentas conectadas al sistema.",
      '"Sincronizar"',
      "Sincronizando…",
      "Conectar canal",
      "Todavía no hay canales",
      "Conectá una cuenta para empezar a recibir sus mensajes en la bandeja.",
      '"Activo"',
      '"Inactivo"',
      "¡Copiado!",
      "Copiar el enlace para escribirle",
      "No se pudo conectar.",
      "No se pudo empezar la conexión.",
      "No se pudo sincronizar.",
      "No se pudieron guardar algunos canales:",
      "No hay nada para conectar: el sistema no admite",
      "Los canales están al día.",
    ]) {
      expect(vista, t).toContain(t);
    }
  });
});
