import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * El hook de pre-commit corre la guardia de la foto cuando el plano está en el
 * commit, y corta por el código de salida, no por el texto impreso.
 *
 * Por qué existe: el 05/10/2026 se commiteó `334c236` con la guardia negándose
 * y la suite en rojo, porque la cadena de comandos miraba si un filtro de la
 * salida encontraba texto, no si los tests pasaban. Un hook que corta por
 * código de salida no depende de cómo se escriba la cadena.
 *
 * Se prueba con commits de verdad, en un repo de git temporal con un plano
 * chico, el hook y la guardia copiados del repo. Se vio en rojo antes de
 * escribir el hook.
 */

const RAIZ = join(__dirname, "..");
let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@ssa-test.local", ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const commitear = (mensaje: string) =>
  spawnSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@ssa-test.local", "commit", "-q", "-m", mensaje], {
    cwd: repo,
    encoding: "utf8",
  });

const PLANO = ["# Plano", "", "#### F1: Uno", "", "- [ ] Criterio uno", "- [ ] Criterio dos", ""].join("\n");

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ssa-precommit-"));
  for (const d of ["docs", "scripts", ".githooks"]) mkdirSync(join(repo, d));
  copyFileSync(join(RAIZ, "scripts/foto-criterios.mjs"), join(repo, "scripts/foto-criterios.mjs"));
  if (existsSync(join(RAIZ, ".githooks/pre-commit"))) {
    copyFileSync(join(RAIZ, ".githooks/pre-commit"), join(repo, ".githooks/pre-commit"));
    chmodSync(join(repo, ".githooks/pre-commit"), 0o755);
  }
  writeFileSync(join(repo, "docs/requerimientos-fase1.md"), PLANO);
  writeFileSync(join(repo, "docs/criterios-bajas.json"), "[]\n");
  git("init", "-q");
  git("config", "core.hooksPath", ".githooks");
  execFileSync("node", ["scripts/foto-criterios.mjs", "--escribir"], { cwd: repo, stdio: "ignore" });
  git("add", "-A");
  // El primer commit va sin hook: es la base contra la que se prueba.
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@ssa-test.local", "commit", "-q", "--no-verify", "-m", "base"], { cwd: repo });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("el hook de pre-commit con la guardia de la foto", () => {
  it("existe y es ejecutable", () => {
    expect(existsSync(join(RAIZ, ".githooks/pre-commit"))).toBe(true);
  });

  it("corta un commit del plano con una línea de criterio faltante", () => {
    writeFileSync(join(repo, "docs/requerimientos-fase1.md"), PLANO.replace("- [ ] Criterio dos\n", ""));
    git("add", "docs/requerimientos-fase1.md");
    const r = commitear("saca un criterio");
    expect(r.status, r.stderr + r.stdout).not.toBe(0);
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(1);
  });

  /** Control positivo: sin esto, "corta" pasaría también con un hook que corta todo. */
  it("deja pasar un commit del plano que no rompe la foto", () => {
    writeFileSync(join(repo, "docs/requerimientos-fase1.md"), PLANO + "\nProsa nueva, sin tocar criterios.\n");
    git("add", "docs/requerimientos-fase1.md");
    const r = commitear("prosa");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(2);
  });

  it("corta un criterio nuevo que no está en la foto: es lo que deja la suite en rojo", () => {
    writeFileSync(join(repo, "docs/requerimientos-fase1.md"), PLANO.replace("- [ ] Criterio dos\n", "- [ ] Criterio dos\n- [ ] Criterio tres\n"));
    git("add", "docs/requerimientos-fase1.md");
    expect(commitear("agrega sin foto").status).not.toBe(0);
  });

  it("mira lo que está en el commit, no el disco: el arreglo sin agregar no salva el commit", () => {
    writeFileSync(join(repo, "docs/requerimientos-fase1.md"), PLANO.replace("- [ ] Criterio dos\n", ""));
    git("add", "docs/requerimientos-fase1.md");
    writeFileSync(join(repo, "docs/requerimientos-fase1.md"), PLANO);
    expect(commitear("disco arreglado, índice roto").status).not.toBe(0);
  });

  it("no corre si el plano no está en el commit", () => {
    writeFileSync(join(repo, "otro.txt"), "hola\n");
    git("add", "otro.txt");
    expect(commitear("otro archivo").status).toBe(0);
    expect(readFileSync(join(repo, "otro.txt"), "utf8")).toBe("hola\n");
  });
});
