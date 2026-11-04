import { describe, it, expect, vi } from "vitest";
import { conConversacion, crearVigiaDeLaDireccion, direccionDeLaBandeja, direccionDistinta, vistaDeLaDireccion, type VistaDeLaBandeja } from "./direccion-bandeja";
import { SIN_FILTROS, filtrosDeLaDireccion, type FiltrosDeBandeja } from "./filtros-bandeja";
import { busquedaDeBandeja, estadoDeBandeja } from "./bandeja";
import { enlaceAFicha, volverDe } from "./ficha";

/**
 * Volver de la ficha a la bandeja como estaba (F35, tramo C de S8, decidido
 * por Marcos el 04/11/2026). Comprobado por Marcos en pantalla ese día, a las
 * 15:47: después de abrir la ficha desde la bandeja con una búsqueda y volver
 * con el atrás del navegador, la dirección decía `?q=marcos+pitti+music` y la
 * bandeja se veía entera, con el buscador vacío. Next restaura la página
 * guardada de la primera vez, porque la lista escribe la dirección sin pedirle
 * la página al servidor.
 *
 * El arreglo: al montarse, la vista compara la dirección con lo que armó el
 * servidor y, si no coinciden, le pide la página otra vez, una sola vez por
 * montaje. Lo que importa es que cada dirección que escribe la propia bandeja
 * dé «igual» contra lo que el servidor arma con ella (si no, se refrescaría al
 * entrar siempre), y que lo que ve el atrás del navegador dé «distinta».
 */

const BASE = "https://app.alomercadeo.com/dashboard/inbox";
const CONV = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ETQ = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const MIEMBRO = "16fd2706-8baf-433b-82eb-8c7fada847da";

/** Lo que arma la página del servidor con una dirección (inbox/page.tsx), con conversacionInicial visible. */
function loQueArmaElServidor(direccion: string): VistaDeLaBandeja {
  const p = new URL(direccion, BASE).searchParams;
  const c = p.get("conversacion");
  return {
    estado: estadoDeBandeja(p.get("estado") ?? undefined),
    busqueda: busquedaDeBandeja(p.get("q") ?? undefined),
    filtros: filtrosDeLaDireccion(Object.fromEntries(p.entries())),
    conversacion: c,
  };
}

const f = (campos: Partial<FiltrosDeBandeja>): FiltrosDeBandeja => ({ ...SIN_FILTROS, ...campos });
const CASOS: Array<[string, string]> = [
  ["los valores por defecto, sin nada escrito", direccionDeLaBandeja(BASE, "open", "", SIN_FILTROS)],
  ["la pestaña «Cerradas»", direccionDeLaBandeja(BASE, "closed", "", SIN_FILTROS)],
  ["la pestaña «Todas»", direccionDeLaBandeja(BASE, "all", "", SIN_FILTROS)],
  ["una búsqueda con espacios y tildes", direccionDeLaBandeja(BASE, "open", "marcos pitti músic", SIN_FILTROS)],
  ["etiquetas", direccionDeLaBandeja(BASE, "open", "", f({ etiquetas: [ETQ] }))],
  ["asignación a un miembro", direccionDeLaBandeja(BASE, "open", "", f({ asignacion: MIEMBRO }))],
  ["sin asignar", direccionDeLaBandeja(BASE, "open", "", f({ asignacion: "sin" }))],
  ["canal", direccionDeLaBandeja(BASE, "open", "", f({ canal: ["instagram", "whatsapp"] }))],
  ["último mensaje hoy", direccionDeLaBandeja(BASE, "open", "", f({ ultimo: "hoy" }))],
  ["último mensaje en un rango", direccionDeLaBandeja(BASE, "open", "", f({ ultimo: { tipo: "rango", desde: "2026-11-01", hasta: "2026-11-03" } }))],
  ["teléfono sin resolver", direccionDeLaBandeja(BASE, "open", "", f({ telefonoSinResolver: true }))],
  ["seguimiento «Vence esta semana»", direccionDeLaBandeja(BASE, "open", "", f({ seguimiento: "semana" }))],
  ["seguimiento en un rango", direccionDeLaBandeja(BASE, "open", "", f({ seguimiento: { tipo: "rango", desde: "2026-11-07", hasta: "2026-11-07" } }))],
  ["la conversación abierta", conConversacion(BASE, CONV)],
  [
    "todo junto, con la conversación",
    conConversacion(
      new URL(direccionDeLaBandeja(BASE, "all", "tania", f({ canal: ["whatsapp"], seguimiento: "hoy", telefonoSinResolver: true })), BASE).href,
      CONV,
    ),
  ],
];

describe("cada dirección que escribe la bandeja da «igual» contra lo que arma el servidor", () => {
  for (const [nombre, direccion] of CASOS) {
    it(nombre, () => {
      expect(direccionDistinta(new URL(direccion, BASE).searchParams, loQueArmaElServidor(direccion))).toBe(false);
    });
  }
});

describe("lo que ve el atrás del navegador da «distinta»", () => {
  it("la dirección con la búsqueda y la página guardada sin ella (lo que vio Marcos el 04/11)", () => {
    const direccion = direccionDeLaBandeja(BASE, "open", "marcos pitti music", SIN_FILTROS);
    expect(direccionDistinta(new URL(direccion, BASE).searchParams, loQueArmaElServidor(BASE))).toBe(true);
  });

  it("un filtro, la pestaña o la conversación que la página guardada no tiene", () => {
    const vieja = loQueArmaElServidor(BASE);
    for (const d of [direccionDeLaBandeja(BASE, "open", "", f({ seguimiento: "hoy" })), direccionDeLaBandeja(BASE, "all", "", SIN_FILTROS), conConversacion(BASE, CONV)]) {
      expect(direccionDistinta(new URL(d, BASE).searchParams, vieja)).toBe(true);
    }
  });

  it("vistaDeLaDireccion lee la dirección igual que el servidor (control)", () => {
    const d = conConversacion(new URL(direccionDeLaBandeja(BASE, "closed", "ana", f({ canal: ["instagram"] })), BASE).href, CONV);
    expect(vistaDeLaDireccion(new URL(d, BASE).searchParams)).toEqual(loQueArmaElServidor(d));
  });
});

describe("la vista se refresca como mucho una vez por montaje", () => {
  it("con la dirección distinta, una vez, aunque se le avise de nuevo", () => {
    const refrescar = vi.fn();
    const vigia = crearVigiaDeLaDireccion(refrescar);
    const p = new URL(direccionDeLaBandeja(BASE, "open", "ana", SIN_FILTROS), BASE).searchParams;
    vigia.alMontar(p, loQueArmaElServidor(BASE));
    vigia.alMontar(p, loQueArmaElServidor(BASE));
    expect(refrescar).toHaveBeenCalledTimes(1);
  });

  it("con la dirección igual, ninguna", () => {
    const refrescar = vi.fn();
    const d = direccionDeLaBandeja(BASE, "all", "ana", SIN_FILTROS);
    crearVigiaDeLaDireccion(refrescar).alMontar(new URL(d, BASE).searchParams, loQueArmaElServidor(d));
    expect(refrescar).not.toHaveBeenCalled();
  });
});

describe("la dirección de vuelta de la ficha", () => {
  it("acepta la bandeja, sola o con su dirección", () => {
    expect(volverDe("/dashboard/inbox")).toBe("/dashboard/inbox");
    expect(volverDe("/dashboard/inbox?q=ana&estado=all&conversacion=" + CONV)).toBe("/dashboard/inbox?q=ana&estado=all&conversacion=" + CONV);
  });

  it("ignora cualquier otra cosa: la flecha vuelve a «Contactos»", () => {
    for (const v of [
      "https://evil.example/dashboard/inbox",
      "//evil.example/dashboard/inbox",
      "/dashboard/inboxx",
      "/dashboard/inbox/../settings",
      "/\\evil.example",
      "/dashboard/inbox?q=a#x",
      "/dashboard/inbox?q=a b",
      "javascript:alert(1)",
      "/dashboard/inbox?" + "a".repeat(2001),
      ["/dashboard/inbox"],
      "",
      undefined,
    ]) {
      expect(volverDe(v)).toBeNull();
    }
  });

  it("el enlace a la ficha lleva la vuelta solo si es válida", () => {
    expect(enlaceAFicha("ct-1", "/dashboard/inbox?q=ana")).toBe("/dashboard/contacts/ct-1?volver=%2Fdashboard%2Finbox%3Fq%3Dana");
    expect(enlaceAFicha("ct-1", "https://evil.example")).toBe("/dashboard/contacts/ct-1");
    expect(enlaceAFicha("ct-1")).toBe("/dashboard/contacts/ct-1");
  });
});
