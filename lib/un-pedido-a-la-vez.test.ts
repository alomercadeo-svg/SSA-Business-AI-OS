import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crearUnPedidoALaVez } from "./un-pedido-a-la-vez";

/**
 * Un solo pedido de la lista de la bandeja en curso por pestaña (retrabajo de
 * F35, 04/11/2026, decidido por Marcos). Medido ese día en su navegador:
 * buscar «catalina vasquez» disparó cuatro pedidos, uno por cada pausa de más
 * de 300 ms mientras escribía, que no se cancelaban, y tardaron de 4,2 a 6,2 s.
 * Ahora: mientras uno está en curso no sale otro; cuando vuelve, si el texto
 * cambió, su respuesta se ignora y sale uno solo con el último texto.
 */

type Args = { q: string; estado: string };
const DURA = 2000;

function armar(inicial: Args = { q: "", estado: "open" }) {
  let enCurso = 0;
  let maximo = 0;
  const pedidos: Args[] = [];
  const aplicados: Args[] = [];
  const c = crearUnPedidoALaVez<Args, string>({
    esperaMs: 300,
    inicial,
    igual: (a, b) => a.q === b.q && a.estado === b.estado,
    ejecutar: (args) => {
      pedidos.push(args);
      enCurso++;
      maximo = Math.max(maximo, enCurso);
      return new Promise((r) =>
        setTimeout(() => {
          enCurso--;
          r(args.q);
        }, DURA),
      );
    },
    aplicar: (args) => aplicados.push(args),
  });
  return { c, pedidos, aplicados, maximo: () => maximo };
}

/** Una tanda de teclas: las letras con 80 ms entre una y otra, y después la pausa. */
async function tanda(c: ReturnType<typeof armar>["c"], textos: string[], pausa: number) {
  for (const q of textos) {
    c.escribir({ q, estado: "open" });
    await vi.advanceTimersByTimeAsync(80);
  }
  await vi.advanceTimersByTimeAsync(pausa);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("un solo pedido a la vez", () => {
  it("cuatro tandas de teclas con pausas de más de 300 ms nunca tienen dos pedidos a la vez", async () => {
    const a = armar();
    await tanda(a.c, ["c", "ca", "cat"], 400);
    await tanda(a.c, ["cata", "catal"], 400);
    await tanda(a.c, ["catali", "catalin", "catalina"], 400);
    await tanda(a.c, ["catalina ", "catalina v", "catalina vasquez"], 400);
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.maximo()).toBe(1);
  });

  it("salen solo dos pedidos: el primero y uno con el último texto, que es el que queda", async () => {
    const a = armar();
    await tanda(a.c, ["c", "ca", "cat"], 400);
    await tanda(a.c, ["cata", "catal"], 400);
    await tanda(a.c, ["catali", "catalin", "catalina"], 400);
    await tanda(a.c, ["catalina ", "catalina v", "catalina vasquez"], 400);
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.pedidos.map((p) => p.q)).toEqual(["cat", "catalina vasquez"]);
    expect(a.aplicados.map((p) => p.q)).toEqual(["catalina vasquez"]);
  });

  it("si el texto no cambió mientras estaba en curso, se usa su respuesta y no sale otro (control)", async () => {
    const a = armar();
    await tanda(a.c, ["a", "an", "ana"], 400);
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.pedidos.map((p) => p.q)).toEqual(["ana"]);
    expect(a.aplicados.map((p) => p.q)).toEqual(["ana"]);
  });

  it("un cambio de pestaña con una búsqueda en curso espera a que vuelva y sale una sola vez", async () => {
    const a = armar();
    await tanda(a.c, ["ana"], 400);
    a.c.pedirYa({ q: "ana", estado: "closed" });
    await vi.advanceTimersByTimeAsync(100);
    expect(a.pedidos.length).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.pedidos.map((p) => p.estado)).toEqual(["open", "closed"]);
    expect(a.maximo()).toBe(1);
    expect(a.aplicados.map((p) => p.estado)).toEqual(["closed"]);
  });

  it("volver al texto que ya se ve mientras hay un pedido en curso: queda lo que se ve, no la respuesta vieja", async () => {
    const a = armar({ q: "", estado: "open" });
    await tanda(a.c, ["a"], 400);
    await tanda(a.c, [""], 400);
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.aplicados.map((p) => p.q)).toEqual([""]);
    expect(a.maximo()).toBe(1);
  });

  it("escribir lo mismo que ya se ve, sin nada en curso, no pide nada", async () => {
    const a = armar({ q: "ana", estado: "open" });
    await tanda(a.c, ["ana"], 400);
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.pedidos).toEqual([]);
  });
});

describe("si el pedido falla", () => {
  it("avisa, y volver a pedir lo mismo lo vuelve a intentar", async () => {
    const pedidos: string[] = [];
    const fallas: string[] = [];
    let falla = true;
    const c = crearUnPedidoALaVez<Args, string>({
      esperaMs: 300,
      inicial: { q: "", estado: "open" },
      igual: (a, b) => a.q === b.q && a.estado === b.estado,
      ejecutar: (args) => {
        pedidos.push(args.q);
        return falla ? Promise.reject(new Error("500")) : Promise.resolve(args.q);
      },
      aplicar: () => {},
      alFallar: (args) => fallas.push(args.q),
    });
    c.pedirYa({ q: "ana", estado: "open" });
    await vi.advanceTimersByTimeAsync(10);
    falla = false;
    c.pedirYa({ q: "ana", estado: "open" });
    await vi.advanceTimersByTimeAsync(10);
    expect(fallas).toEqual(["ana"]);
    expect(pedidos).toEqual(["ana", "ana"]);
  });
});

/**
 * Volver a pedir lo mismo (F35, tramo C de S8): después de guardar el próximo
 * seguimiento desde el panel, la lista se vuelve a pedir con la pestaña, la
 * búsqueda y los filtros de ahora, para que la conversación entre o salga del
 * filtro sin recargar. `pedirYa` no sirve: con lo mismo que ya se ve no pide
 * nada, y si hay uno en curso usa su respuesta, que puede ser de antes del
 * cambio.
 */
describe("volver a pedir lo mismo", () => {
  it("con lo mismo que ya se ve y nada en curso, pide igual", async () => {
    const a = armar();
    a.c.volverAPedir({ q: "", estado: "open" });
    await vi.advanceTimersByTimeAsync(2 * DURA);
    expect(a.pedidos).toHaveLength(1);
    expect(a.aplicados).toEqual([{ q: "", estado: "open" }]);
  });

  it("con uno en curso, su respuesta se descarta y sale uno solo después, de a uno", async () => {
    const a = armar();
    a.c.pedirYa({ q: "x", estado: "open" });
    await vi.advanceTimersByTimeAsync(100);
    a.c.volverAPedir({ q: "x", estado: "open" });
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.pedidos).toHaveLength(2);
    expect(a.aplicados).toHaveLength(1);
    expect(a.maximo()).toBe(1);
  });

  it("si mientras tanto cambió lo pedido, sale uno solo con lo último (control)", async () => {
    const a = armar();
    a.c.pedirYa({ q: "x", estado: "open" });
    await vi.advanceTimersByTimeAsync(100);
    a.c.volverAPedir({ q: "x", estado: "open" });
    a.c.pedirYa({ q: "y", estado: "open" });
    await vi.advanceTimersByTimeAsync(10 * DURA);
    expect(a.pedidos.map((p) => p.q)).toEqual(["x", "y"]);
    expect(a.aplicados.map((p) => p.q)).toEqual(["y"]);
  });
});
