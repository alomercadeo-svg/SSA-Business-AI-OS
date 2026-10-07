import { describe, it, expect, vi } from "vitest";
import { extraerIdentificador, verificarDespliegue, INTERVALO_MS, PLAZO_MS } from "./verificar-despliegue.mjs";

/**
 * `scripts/verificar-despliegue.mjs`, sin red, sin git y sin esperar.
 *
 * Estos tests prueban la lógica. La prueba de que funciona contra producción
 * son sus dos corridas del 06/10/2026: la positiva, al subir el arreglo de la
 * sincronización, y la negativa, corrida sin nada para subir, que tiene que
 * fallar a los 5 minutos. Ver `docs/estado-fase1.md`.
 */

// Fragmento real del HTML de `/login`, leído el 06/10/2026.
const HTML_REAL =
  '<script>self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"7-mf8UMn5aAmAqAq29sm4\\",\\"c\\":[\\"\\",\\"login\\"],\\"q\\":\\"\\"'
  + "\"])</script>";

describe("extraerIdentificador", () => {
  it("lo saca de la forma escapada que Next escribe hoy", () => {
    expect(extraerIdentificador(HTML_REAL)).toBe("7-mf8UMn5aAmAqAq29sm4");
  });

  it("y de la forma sin escapar", () => {
    expect(extraerIdentificador('{"P":null,"b":"abc_123-X","c":[]}')).toBe("abc_123-X");
  });

  it("devuelve null si no está", () => {
    expect(extraerIdentificador("<html>mantenimiento</html>")).toBeNull();
    expect(extraerIdentificador("")).toBeNull();
  });
});

/** Arma un escenario: una secuencia de lecturas y un reloj que avanza al esperar. */
function escenario(lecturas: { status: number; id: string | null }[], subida = { ok: true, nadaParaSubir: false }) {
  let reloj = 0;
  let i = 0;
  const leer = vi.fn(async () => lecturas[Math.min(i++, lecturas.length - 1)]);
  const subir = vi.fn(async () => subida);
  const mensajes: string[] = [];
  return {
    leer,
    subir,
    mensajes,
    opciones: {
      leer,
      subir,
      esperar: async (ms: number) => {
        reloj += ms;
      },
      ahora: () => reloj,
      log: (m: string) => mensajes.push(m),
    },
  };
}

const ok = (id: string) => ({ status: 200, id });
const caida = { status: 502, id: null };

describe("verificarDespliegue", () => {
  it("sale con 0 cuando el build cambia y /login responde 200", async () => {
    const e = escenario([ok("viejo"), ok("viejo"), ok("viejo"), ok("nuevo")]);
    expect(await verificarDespliegue(e.opciones)).toBe(0);
    expect(e.subir).toHaveBeenCalledTimes(1);
  });

  it("sale con 1 si en 5 minutos no cambió, y manda a mirar Railway", async () => {
    const e = escenario([ok("viejo")]);
    expect(await verificarDespliegue(e.opciones)).toBe(1);
    // Una lectura previa más una cada 10 segundos durante 5 minutos.
    expect(e.leer).toHaveBeenCalledTimes(1 + PLAZO_MS / INTERVALO_MS);
    expect(e.mensajes.at(-1)).toContain("Railway");
  });

  it("un build nuevo que no responde 200 todavía no cuenta", async () => {
    const e = escenario([ok("viejo"), { status: 503, id: "nuevo" }, ok("nuevo")]);
    expect(await verificarDespliegue(e.opciones)).toBe(0);
    expect(e.leer).toHaveBeenCalledTimes(3);
  });

  it("si git push falla, sale con 1 sin esperar", async () => {
    const e = escenario([ok("viejo")], { ok: false, nadaParaSubir: false });
    expect(await verificarDespliegue(e.opciones)).toBe(1);
    expect(e.leer).toHaveBeenCalledTimes(1);
  });

  it("sin nada para subir lo dice y espera igual (el control negativo)", async () => {
    const e = escenario([ok("viejo")], { ok: true, nadaParaSubir: true });
    expect(await verificarDespliegue(e.opciones)).toBe(1);
    expect(e.mensajes.some((m) => m.includes("No había nada para subir"))).toBe(true);
  });

  describe("sin lectura previa", () => {
    for (const [nombre, lectura] of [
      ["/login caído", caida],
      ["sin identificador", { status: 200, id: null }],
      ["sin respuesta", { status: 0, id: null }],
    ] as const) {
      it(`${nombre}: no sube`, async () => {
        const e = escenario([lectura]);
        expect(await verificarDespliegue(e.opciones)).toBe(1);
        expect(e.subir).not.toHaveBeenCalled();
      });
    }
  });

  describe("salida de emergencia, --sin-verificar-antes", () => {
    it("sube igual, y si producción vuelve sale con 2, nunca con 0", async () => {
      const e = escenario([caida, caida, ok("nuevo")]);
      expect(await verificarDespliegue({ ...e.opciones, sinVerificarAntes: true })).toBe(2);
      expect(e.subir).toHaveBeenCalledTimes(1);
      expect(e.mensajes.some((m) => m.includes("no hubo lectura previa"))).toBe(true);
      expect(e.mensajes.at(-1)).toContain("Railway");
    });

    it("si producción no vuelve, sale con 1 y manda a Railway", async () => {
      const e = escenario([caida]);
      expect(await verificarDespliegue({ ...e.opciones, sinVerificarAntes: true })).toBe(1);
      expect(e.mensajes.at(-1)).toContain("Railway");
    });

    it("con lectura previa válida no cambia nada: sale con 0 si el build cambia", async () => {
      const e = escenario([ok("viejo"), ok("nuevo")]);
      expect(await verificarDespliegue({ ...e.opciones, sinVerificarAntes: true })).toBe(0);
    });
  });
});
