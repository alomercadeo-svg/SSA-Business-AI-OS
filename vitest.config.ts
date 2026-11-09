import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    // `herramientas-locales/` guarda herramientas que no son del proyecto
    // (Playwright, con su propio node_modules), ignoradas por git.
    exclude: ["node_modules/**", "herramientas-locales/**"],
    environment: "node",
  },
});
