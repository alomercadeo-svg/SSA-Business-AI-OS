import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/**
 * La frontera entre servidor y cliente de Next.js.
 *
 * Un archivo de servidor (sin `"use client"`) que importa de un archivo
 * `"use client"` recibe, en vez de cada valor, una referencia de cliente. Para
 * un componente eso es lo que se quiere: se renderiza en el navegador. Para
 * cualquier otro valor (una constante, una función) es una trampa: en el
 * servidor la referencia tira «Attempted to call X() from the server but X is
 * on the client» al usarla.
 *
 * Pasó el 02/11/2026: `inbox/page.tsx` importó la constante
 * `COLUMNAS_DEL_AVISO` de `aviso-sesion-whatsapp.tsx` (F32) y la bandeja se
 * rompió en producción para todos. Ni Vitest ni `next build` lo ven: Vitest no
 * aplica la frontera y el build compila. Este test sí.
 *
 * La regla: desde un archivo de servidor, de un módulo `"use client"` solo se
 * importan componentes o tipos. Un componente se nombra en PascalCase
 * (mayúscula y después minúscula): `COLUMNAS_DEL_AVISO` empieza con mayúscula y
 * no es un componente. La primera versión de este test lo dejó pasar por eso.
 */

/** ¿Este nombre puede ser un componente? PascalCase, no MAYÚSCULAS_CON_GUIONES. */
export const esComponente = (nombre: string) => /^[A-Z][a-z]/.test(nombre);

const RAIZ = process.cwd();
const CARPETAS = ["app", "components", "lib"];

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const esCliente = (codigo: string) => /^\s*["']use client["']/.test(codigo);

function resolver(desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(RAIZ, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(desde), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Los nombres importados que no son tipos, de cada `import { … } from "…"`. */
function importaciones(codigo: string): Array<{ spec: string; nombres: string[] }> {
  const salida: Array<{ spec: string; nombres: string[] }> = [];
  for (const m of codigo.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const clausula = m[2];
    const nombres: string[] = [];
    const llaves = clausula.match(/\{([\s\S]*)\}/);
    if (llaves) {
      for (const parte of llaves[1].split(",")) {
        const p = parte.trim();
        if (!p || p.startsWith("type ")) continue;
        nombres.push(p.split(/\s+as\s+/).pop()!.trim());
      }
    }
    const porDefecto = clausula.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    if (porDefecto && !porDefecto.startsWith("*")) nombres.push(porDefecto);
    salida.push({ spec: m[3], nombres });
  }
  return salida;
}

export function violaciones(): string[] {
  const malas: string[] = [];
  for (const archivo of CARPETAS.flatMap((c) => archivos(join(RAIZ, c)))) {
    const codigo = readFileSync(archivo, "utf8");
    if (esCliente(codigo)) continue;
    for (const { spec, nombres } of importaciones(codigo)) {
      const destino = resolver(archivo, spec);
      if (!destino || !esCliente(readFileSync(destino, "utf8"))) continue;
      for (const n of nombres) {
        if (!esComponente(n)) malas.push(`${archivo.slice(RAIZ.length + 1)} importa «${n}» de ${spec}`);
      }
    }
  }
  return malas;
}

describe("la frontera entre servidor y cliente", () => {
  it("ningún archivo de servidor importa un valor que no sea componente de un módulo \"use client\"", () => {
    expect(violaciones()).toEqual([]);
  });

  /** Control positivo: el detector marca el caso del 02/11/2026, y solo ese nombre. */
  it("el detector reconoce la forma del error", () => {
    const ej = importaciones('import { AvisoSesionWhatsapp, COLUMNAS_DEL_AVISO, type CanalDeSesion } from "@/components/inbox/aviso-sesion-whatsapp";');
    expect(ej).toEqual([{ spec: "@/components/inbox/aviso-sesion-whatsapp", nombres: ["AvisoSesionWhatsapp", "COLUMNAS_DEL_AVISO"] }]);
    expect(ej[0].nombres.filter((n) => !esComponente(n))).toEqual(["COLUMNAS_DEL_AVISO"]);
    expect(esCliente('"use client";\nexport const X = 1;')).toBe(true);
  });
});
