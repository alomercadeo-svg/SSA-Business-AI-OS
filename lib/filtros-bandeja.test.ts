import { describe, it, expect } from "vitest";
import {
  SIN_FILTROS,
  cuantosFiltros,
  filtrosDeLaDireccion,
  filtrosParaElRol,
  filtrosParaLaBase,
  parametrosDeFiltros,
  type FiltrosDeBandeja,
} from "./filtros-bandeja";

/**
 * Los filtros de la bandeja (F35, tramo B de S8) entre la dirección de la
 * página y la base. La dirección es lo que se comparte: lo que no se entiende
 * se descarta, nunca se manda a la base. `ahora` (el reloj fijo del
 * verificador) nunca sale de la dirección.
 */

const T1 = "6f1c3d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const T2 = "7a2b3c4d-5e6f-4a1b-9c8d-1e2f3a4b5c6d";
const YO = "11111111-2222-4333-8444-555555555555";
const OTRO = "99999999-8888-4777-8666-555555555555";

const con = (cambios: Partial<FiltrosDeBandeja>): FiltrosDeBandeja => ({ ...SIN_FILTROS, ...cambios });

describe("filtrosDeLaDireccion", () => {
  it("sin parámetros, sin filtros", () => {
    expect(filtrosDeLaDireccion({})).toEqual(SIN_FILTROS);
  });

  it("lee los seis grupos con sus nombres en castellano", () => {
    const f = filtrosDeLaDireccion({
      etiquetas: `${T1},${T2}`,
      asignacion: YO,
      canal: "whatsapp,instagram",
      ultimo: "7",
      telefono: "sin-resolver",
      seguimiento: "semana",
    });
    expect(f).toEqual({
      etiquetas: [T1, T2],
      asignacion: YO,
      canal: ["instagram", "whatsapp"],
      ultimo: "7",
      telefonoSinResolver: true,
      seguimiento: "semana",
      ventana: null,
    });
  });

  it("también desde URLSearchParams (la ruta)", () => {
    const f = filtrosDeLaDireccion(new URLSearchParams(`canal=instagram&asignacion=sin&seguimiento=vencido`));
    expect(f).toEqual(con({ canal: ["instagram"], asignacion: "sin", seguimiento: "vencido" }));
  });

  it("los rangos necesitan las dos fechas, válidas; con una sola, el grupo no filtra", () => {
    expect(filtrosDeLaDireccion({ ultimo: "rango", ultimo_desde: "2026-10-01", ultimo_hasta: "2026-10-31" }).ultimo).toEqual({ tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" });
    expect(filtrosDeLaDireccion({ seguimiento: "rango", seguimiento_desde: "2026-11-04", seguimiento_hasta: "2026-11-06" }).seguimiento).toEqual({ tipo: "rango", desde: "2026-11-04", hasta: "2026-11-06" });
    expect(filtrosDeLaDireccion({ ultimo: "rango", ultimo_desde: "2026-10-01" }).ultimo).toBeNull();
    expect(filtrosDeLaDireccion({ seguimiento: "rango", seguimiento_desde: "2026-02-30", seguimiento_hasta: "2026-03-01" }).seguimiento).toBeNull();
  });

  it("un rango al revés se da vuelta", () => {
    expect(filtrosDeLaDireccion({ ultimo: "rango", ultimo_desde: "2026-10-31", ultimo_hasta: "2026-10-01" }).ultimo).toEqual({ tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" });
  });

  it("descarta lo que no entiende: ids que no son uuid, canales y opciones desconocidas", () => {
    const f = filtrosDeLaDireccion({ etiquetas: `x,${T1},'; drop`, asignacion: "todas", canal: "facebook,whatsapp", ultimo: "90", telefono: "si", seguimiento: "manana" });
    expect(f).toEqual(con({ etiquetas: [T1], canal: ["whatsapp"] }));
    expect(filtrosDeLaDireccion({ asignacion: "no-es-uuid" }).asignacion).toBeNull();
  });

  it("no repite etiquetas", () => {
    expect(filtrosDeLaDireccion({ etiquetas: `${T1},${T1}` }).etiquetas).toEqual([T1]);
  });

  it("`ahora` en la dirección no llega a ningún lado", () => {
    const f = filtrosDeLaDireccion({ ahora: "2026-11-05T00:30:00Z", seguimiento: "hoy" });
    expect(JSON.stringify(f)).not.toContain("2026-11-05");
    expect(filtrosParaLaBase(f, "")).not.toHaveProperty("ahora");
  });
});

describe("parametrosDeFiltros: de vuelta a la dirección", () => {
  it("ida y vuelta da lo mismo", () => {
    const f = con({ etiquetas: [T1, T2], asignacion: "sin", canal: ["whatsapp"], ultimo: { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" }, telefonoSinResolver: true, seguimiento: "hoy" });
    const vuelta = filtrosDeLaDireccion(new URLSearchParams(parametrosDeFiltros(f)));
    expect(vuelta).toEqual(f);
  });

  it("sin filtros no escribe nada", () => {
    expect(parametrosDeFiltros(SIN_FILTROS)).toEqual([]);
  });

  it("los nombres son los de la dirección", () => {
    expect(parametrosDeFiltros(con({ telefonoSinResolver: true, seguimiento: { tipo: "rango", desde: "2026-11-04", hasta: "2026-11-06" } }))).toEqual([
      ["telefono", "sin-resolver"],
      ["seguimiento", "rango"],
      ["seguimiento_desde", "2026-11-04"],
      ["seguimiento_hasta", "2026-11-06"],
    ]);
  });
});

describe("cuantosFiltros: el «Filtros · N»", () => {
  it("cuenta los grupos con algo elegido, incluida la fecha del último mensaje", () => {
    expect(cuantosFiltros(SIN_FILTROS)).toBe(0);
    expect(cuantosFiltros(con({ etiquetas: [T1, T2] }))).toBe(1);
    expect(cuantosFiltros(con({ ultimo: "hoy" }))).toBe(1);
    expect(cuantosFiltros(con({ etiquetas: [T1], asignacion: "sin", canal: ["instagram"], ultimo: "30", telefonoSinResolver: true, seguimiento: "vencido" }))).toBe(6);
  });
});

describe("filtrosParaLaBase: el jsonb de la 00044", () => {
  it("arma las claves que lee bandeja_filtrada", () => {
    expect(filtrosParaLaBase(con({ etiquetas: [T1], asignacion: YO, canal: ["instagram"], ultimo: { tipo: "rango", desde: "2026-10-01", hasta: "2026-10-31" }, telefonoSinResolver: true, seguimiento: "semana" }), "ana")).toEqual({
      q: "ana",
      etiquetas: [T1],
      asignacion: YO,
      canal: ["instagram"],
      ultimo: "rango",
      ultimo_desde: "2026-10-01",
      ultimo_hasta: "2026-10-31",
      sin_telefono: true,
      seguimiento: "semana",
    });
  });

  it("sin filtros, solo lo buscado", () => {
    expect(filtrosParaLaBase(SIN_FILTROS, "")).toEqual({ q: "" });
  });
});

describe("filtrosParaElRol: «Asignación» de un Member", () => {
  it("un Member puede filtrarse a sí mismo y por «Sin asignar»", () => {
    expect(filtrosParaElRol(con({ asignacion: YO }), false, YO).asignacion).toBe(YO);
    expect(filtrosParaElRol(con({ asignacion: "sin" }), false, YO).asignacion).toBe("sin");
  });

  it("el id de otro miembro en la dirección de un Member se ignora, sin error, y no cuenta", () => {
    const f = filtrosParaElRol(con({ asignacion: OTRO, canal: ["whatsapp"] }), false, YO);
    expect(f.asignacion).toBeNull();
    expect(f.canal).toEqual(["whatsapp"]);
    expect(cuantosFiltros(f)).toBe(1);
  });

  it("Owner y Admin filtran por cualquiera", () => {
    expect(filtrosParaElRol(con({ asignacion: OTRO }), true, YO).asignacion).toBe(OTRO);
  });
});

describe("F40: el filtro de la ventana de Instagram (F35)", () => {
  it("la dirección lee ventana=abierta, por-vencer y cerrada; lo demás se descarta", () => {
    expect(filtrosDeLaDireccion({ ventana: "abierta" }).ventana).toBe("abierta");
    expect(filtrosDeLaDireccion({ ventana: "por-vencer" }).ventana).toBe("por_vencer");
    expect(filtrosDeLaDireccion({ ventana: "cerrada" }).ventana).toBe("cerrada");
    expect(filtrosDeLaDireccion({ ventana: "por_vencer" }).ventana).toBeNull();
    expect(filtrosDeLaDireccion({ ventana: "x" }).ventana).toBeNull();
  });
  it("vuelve a la dirección con el guion, y cuenta uno en «Filtros · N»", () => {
    expect(parametrosDeFiltros(con({ ventana: "por_vencer" }))).toEqual([["ventana", "por-vencer"]]);
    expect(cuantosFiltros(con({ ventana: "cerrada" }))).toBe(1);
    expect(cuantosFiltros(con({ ventana: "cerrada", canal: ["instagram"] }))).toBe(2);
  });
  it("va a la base como la clave `ventana` del jsonb, con guion bajo", () => {
    expect(filtrosParaLaBase(con({ ventana: "por_vencer" }), "")).toEqual({ q: "", ventana: "por_vencer" });
    expect(filtrosParaLaBase(con({ ventana: "abierta" }), "ana")).toEqual({ q: "ana", ventana: "abierta" });
  });
  it("ida y vuelta por la dirección", () => {
    for (const v of ["abierta", "por_vencer", "cerrada"] as const) {
      expect(filtrosDeLaDireccion(new URLSearchParams(parametrosDeFiltros(con({ ventana: v })))).ventana).toBe(v);
    }
  });
});
