import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

/**
 * La otra mitad de la frontera (`app/frontera-cliente.test.ts` mira la de
 * servidor a cliente): un archivo `"use client"` que importa, directo o en
 * cadena, `lib/supabase/server.ts` o `next/headers`.
 *
 * Pasó el 04/11/2026: el panel del contacto (`"use client"`) importó
 * `nombreDePlataforma` de `lib/auditoria.ts`, que trae `lib/supabase/server.ts`
 * y con él `next/headers`. **`next build` falló** en el cierre del tramo C de
 * S8, con la suite y `tsc` en verde (`93a9e10`, arreglado en `ff824e8`).
 * Vitest no aplica la frontera; este test sí, sin esperar al build.
 *
 * LA CADENA SE CORTA EN LOS ARCHIVOS `"use server"`. Desde el cliente, una
 * acción de servidor llega como una referencia, no como su código: es lo que
 * hacen hoy `lib/actions/*` (18 cadenas el 04/11/2026, con `next build` en
 * verde). Sin ese corte, este test nacería en rojo por algo que funciona.
 *
 * Qué sigue: `import … from`, `export … from`, `import()` y los imports sin
 * nombres. Qué no sigue: lo que es solo de tipos (`import type`, o un `{ … }`
 * donde todos los nombres llevan `type`), que el compilador borra.
 *
 * Para verlo en rojo sin tocar el repo, `RAIZ_FRONTERA` apunta a otra copia
 * (por ejemplo, `git archive 93a9e10` extraído en un directorio temporal).
 */

const PROHIBIDOS = ["lib/supabase/server.ts", "next/headers"];
const CARPETAS = ["app", "components", "lib"];

function archivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre !== "node_modules") salida.push(...archivos(ruta));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const directiva = (codigo: string, d: "client" | "server") => new RegExp(`^\\s*["']use ${d}["']`).test(codigo);

function resolver(raiz: string, desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(raiz, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(desde), spec);
  else return spec; // un paquete: se compara por nombre (`next/headers`)
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Lo que un archivo trae en tiempo de ejecución: sin lo que es solo de tipos. */
export function importados(codigo: string): string[] {
  const salida: string[] = [];
  for (const m of codigo.matchAll(/(?:^|[\s;])(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const llaves = m[2].match(/\{([\s\S]*)\}/);
    const resto = m[2].replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    if (llaves && !resto) {
      const partes = llaves[1].split(",").map((p) => p.trim()).filter(Boolean);
      if (partes.length > 0 && partes.every((p) => p.startsWith("type "))) continue;
    }
    salida.push(m[3]);
  }
  for (const m of codigo.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) salida.push(m[1]);
  for (const m of codigo.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) salida.push(m[1]);
  return salida;
}

/** Cada archivo `"use client"` que llega a algo prohibido, con la cadena. */
export function cadenasAlServidor(raiz: string): { clientes: number; cadenas: string[] } {
  const prohibidos = new Set(PROHIBIDOS.map((p) => (p.includes("/") && p.endsWith(".ts") ? join(raiz, p) : p)));
  const leer = (f: string) => readFileSync(f, "utf8");
  const nombre = (x: string) => (x.startsWith("/") ? relative(raiz, x) : x);
  let clientes = 0;
  const cadenas: string[] = [];
  for (const archivo of CARPETAS.flatMap((c) => archivos(join(raiz, c)))) {
    if (!directiva(leer(archivo), "client")) continue;
    clientes++;
    const vino = new Map<string, string | null>([[archivo, null]]);
    const cola = [archivo];
    while (cola.length > 0) {
      const x = cola.shift()!;
      if (prohibidos.has(x)) {
        const cadena: string[] = [];
        for (let y: string | null = x; y; y = vino.get(y) ?? null) cadena.unshift(nombre(y));
        cadenas.push(cadena.join(" → "));
        break;
      }
      if (!x.startsWith("/")) continue;
      const codigo = leer(x);
      if (x !== archivo && directiva(codigo, "server")) continue;
      for (const spec of importados(codigo)) {
        const destino = resolver(raiz, x, spec);
        if (destino && !vino.has(destino)) {
          vino.set(destino, x);
          cola.push(destino);
        }
      }
    }
  }
  return { clientes, cadenas };
}

const RAIZ = process.env.RAIZ_FRONTERA || process.cwd();

describe("la frontera de cliente a servidor", () => {
  it("ningún archivo \"use client\" trae, directo o en cadena, lib/supabase/server.ts ni next/headers", () => {
    const r = cadenasAlServidor(RAIZ);
    // Control: si no encontrara ningún archivo de cliente, el cero no probaría nada.
    expect(r.clientes).toBeGreaterThan(0);
    expect(r.cadenas).toEqual([]);
  });

  it("el detector reconoce la forma de los imports", () => {
    expect(importados('import { nombreDePlataforma } from "@/lib/auditoria";')).toEqual(["@/lib/auditoria"]);
    expect(importados('import type { Actor } from "@/lib/auditoria";')).toEqual([]);
    expect(importados('import { type Actor, type Otro } from "@/lib/auditoria";')).toEqual([]);
    expect(importados('import { type Actor, registrar } from "@/lib/auditoria";')).toEqual(["@/lib/auditoria"]);
    expect(importados('export { nombreDePlataforma } from "./nombre-de-plataforma";')).toEqual(["./nombre-de-plataforma"]);
    expect(importados('const m = await import("./correo");')).toEqual(["./correo"]);
    expect(importados('import "./estilos";')).toEqual(["./estilos"]);
  });
});
