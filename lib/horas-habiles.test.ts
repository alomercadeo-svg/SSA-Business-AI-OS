import { describe, it, expect } from "vitest";
import { horasHabiles, HORARIO_POR_DEFECTO, validarHorario, zonaValida, type Horario } from "./horas-habiles";

/**
 * Las horas hábiles de F39. Las marcas se escriben con su desfase de Costa Rica
 * (-06:00) para que se lean como hora local. El 09/10/2026 es viernes.
 */
const CR = "America/Costa_Rica";
const h = (iso: string) => new Date(iso);

const TODO_EL_DIA: Horario = {
  lun: [["00:00", "24:00"]],
  mar: [["00:00", "24:00"]],
  mie: [["00:00", "24:00"]],
  jue: [["00:00", "24:00"]],
  vie: [["00:00", "24:00"]],
  sab: [["00:00", "24:00"]],
  dom: [["00:00", "24:00"]],
};

describe("horas hábiles (F39)", () => {
  it("todo dentro de una franja: miércoles de 9:00 a 11:30 son 2,5", () => {
    expect(horasHabiles(h("2026-10-07T09:00:00-06:00"), h("2026-10-07T11:30:00-06:00"), CR, HORARIO_POR_DEFECTO)).toBe(2.5);
  });

  it("cruzar una noche: martes 17:00 a miércoles 9:00 son 2 (1 + 1)", () => {
    expect(horasHabiles(h("2026-10-06T17:00:00-06:00"), h("2026-10-07T09:00:00-06:00"), CR, HORARIO_POR_DEFECTO)).toBe(2);
  });

  it("cruzar un fin de semana: viernes 17:00 a lunes 12:00 son 8 (1 + 3 + 4)", () => {
    expect(horasHabiles(h("2026-10-09T17:00:00-06:00"), h("2026-10-12T12:00:00-06:00"), CR, HORARIO_POR_DEFECTO)).toBe(8);
  });

  it("una marca de domingo: domingo 10:00 a lunes 10:00 son 2 (el domingo no tiene franja)", () => {
    expect(horasHabiles(h("2026-10-11T10:00:00-06:00"), h("2026-10-12T10:00:00-06:00"), CR, HORARIO_POR_DEFECTO)).toBe(2);
  });

  it("una marca en el futuro da 0, nunca negativo", () => {
    expect(horasHabiles(h("2026-10-12T12:00:00-06:00"), h("2026-10-09T17:00:00-06:00"), CR, HORARIO_POR_DEFECTO)).toBe(0);
  });

  it("un día sin franja no suma: con el miércoles vacío, martes 17:00 a jueves 9:00 son 2", () => {
    const sinMiercoles: Horario = { ...HORARIO_POR_DEFECTO, mie: [] };
    expect(horasHabiles(h("2026-10-06T17:00:00-06:00"), h("2026-10-08T09:00:00-06:00"), CR, sinMiercoles)).toBe(2);
  });

  it("de 0:00 a 24:00 todos los días, las horas hábiles son las de reloj", () => {
    expect(horasHabiles(h("2026-10-09T17:00:00-06:00"), h("2026-10-10T23:00:00-06:00"), CR, TODO_EL_DIA)).toBe(30);
  });

  it("usa la zona IANA y no un desfase fijo: en Nueva York, el domingo del cambio de hora tiene 25 horas", () => {
    // El 01/11/2026 Nueva York pasa de -04:00 a -05:00 a las 2:00. Solo el
    // domingo tiene franja, así que nada de otro día se mezcla. Con el desfase
    // de la primera marca (-04:00) aplicado a todo, serían 24.
    const soloDomingo: Horario = { lun: [], mar: [], mie: [], jue: [], vie: [], sab: [], dom: [["00:00", "24:00"]] };
    const desde = h("2026-10-31T00:00:00-04:00");
    const hasta = h("2026-11-02T00:00:00-05:00");
    expect(horasHabiles(desde, hasta, "America/New_York", soloDomingo)).toBe(25);
  });

  it("en Nueva York, la franja del lunes después del cambio se cuenta en la hora local nueva", () => {
    // Viernes 30/10 18:00 (-04:00) a lunes 02/11 8:30 (-05:00): el sábado de
    // 9:00 a 12:00 (3) y el lunes de 8:00 a 8:30 (0,5). Con el desfase viejo,
    // el lunes empezaría una hora antes y sumaría 1,5.
    const desde = h("2026-10-30T18:00:00-04:00");
    const hasta = h("2026-11-02T08:30:00-05:00");
    expect(horasHabiles(desde, hasta, "America/New_York", HORARIO_POR_DEFECTO)).toBe(3.5);
  });
});

describe("validación del horario y la zona", () => {
  it("acepta el horario por defecto", () => {
    expect(validarHorario(HORARIO_POR_DEFECTO)).toEqual(HORARIO_POR_DEFECTO);
  });

  it("rechaza franjas al revés, horas inválidas y franjas que se pisan", () => {
    expect(validarHorario({ ...HORARIO_POR_DEFECTO, lun: [["18:00", "08:00"]] })).toBeNull();
    expect(validarHorario({ ...HORARIO_POR_DEFECTO, lun: [["8", "18:00"]] })).toBeNull();
    expect(validarHorario({ ...HORARIO_POR_DEFECTO, lun: [["08:00", "24:30"]] })).toBeNull();
    expect(validarHorario({ ...HORARIO_POR_DEFECTO, lun: [["08:00", "12:00"], ["11:00", "13:00"]] })).toBeNull();
    expect(validarHorario({ lun: [] })).toBeNull();
    expect(validarHorario(null)).toBeNull();
  });

  it("reconoce una zona IANA y rechaza un texto cualquiera", () => {
    expect(zonaValida("America/Costa_Rica")).toBe(true);
    expect(zonaValida("America/Nowhere")).toBe(false);
    expect(zonaValida("")).toBe(false);
  });
});
