import { describe, it, expect, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * El script `prepare` de package.json no puede hacer fallar `npm install`.
 *
 * El 05/10/2026 se agregó `"prepare": "git config core.hooksPath .githooks"`
 * para instalar el hook de pre-commit. `npm install` corre `prepare` siempre,
 * también en el build de Railway, y fuera de un repositorio de git ese comando
 * sale con 128. Después de subirlo, producción no cambió de build en ocho
 * minutos (inferencia: el build de Railway falló en la instalación). Se vio en
 * rojo con el prepare de ese día.
 */

const prepare: string = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).scripts.prepare;
const carpetas: string[] = [];
const carpeta = () => {
  const d = mkdtempSync(join(tmpdir(), "ssa-prepare-"));
  carpetas.push(d);
  return d;
};

afterEach(() => {
  for (const d of carpetas.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("el script prepare", () => {
  it("fuera de un repositorio de git sale con 0", () => {
    const r = spawnSync("sh", ["-c", prepare], { cwd: carpeta(), encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });

  /** Control positivo: sin esto, "sale con 0" pasaría también con un prepare que no hace nada. */
  it("dentro de un repositorio instala el hook", () => {
    const d = carpeta();
    execFileSync("git", ["init", "-q"], { cwd: d });
    const r = spawnSync("sh", ["-c", prepare], { cwd: d, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: d, encoding: "utf8" }).trim()).toBe(".githooks");
  });
});
