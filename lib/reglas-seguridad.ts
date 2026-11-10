/**
 * F33 (ítem 10 del plan maestro, 09/11/2026): las reglas de seguridad de
 * secuencia de WhatsApp. Son configuración del canal (`channels.safety_config`,
 * 00055) y estas funciones deciden cada una. **El motor que las consume es de
 * la Fase 2** (§4.8): esto no envía nada.
 *
 * Sin React ni nada de servidor.
 *
 * Los valores por defecto los aprobó Marcos el 09/11/2026. **Suposiciones para
 * confirmar con Alejandra después de la entrega:** el horario (08:00 a 20:00,
 * lunes a sábado) y el umbral de la proporción de respuesta (15 % sobre los
 * últimos 50).
 *
 * La zona horaria: el `CLAUDE.md` pide la del contacto, y el contacto no tiene
 * una (solo `workspaces.zona_horaria`, 00033). Quien llame pasa la del
 * espacio; por eso el criterio 4 de F33 queda parcial.
 */

export interface ReglasDeSeguridad {
  corte_silencio: { activo: boolean; seguimientos: number };
  texto_variable: { rotar: boolean; aviso_desde: number };
  espaciado: { activo: boolean; min_segundos: number; max_segundos: number };
  horario: { activo: boolean; desde: string; hasta: string; dias: number[] };
  proporcion: { umbral_porcentaje: number; muestra: number };
}

export const REGLAS_POR_DEFECTO: ReglasDeSeguridad = {
  corte_silencio: { activo: true, seguimientos: 3 },
  texto_variable: { rotar: true, aviso_desde: 20 },
  espaciado: { activo: true, min_segundos: 45, max_segundos: 180 },
  horario: { activo: true, desde: "08:00", hasta: "20:00", dias: [1, 2, 3, 4, 5, 6] },
  proporcion: { umbral_porcentaje: 15, muestra: 50 },
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const entero = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const dias = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((d) => entero(d, 0, 6) !== null) ? [...new Set(v as number[])].sort((a, b) => a - b) : null;

/** Lo guardado, con lo que falte o no sirva reemplazado por el valor por defecto. */
export function leerConfiguracion(guardado: unknown): ReglasDeSeguridad {
  const g = obj(guardado);
  const d = REGLAS_POR_DEFECTO;
  const cs = obj(g.corte_silencio);
  const tv = obj(g.texto_variable);
  const es = obj(g.espaciado);
  const ho = obj(g.horario);
  const pr = obj(g.proporcion);
  const min = entero(es.min_segundos, 0, 3600) ?? d.espaciado.min_segundos;
  const max = entero(es.max_segundos, 0, 3600) ?? d.espaciado.max_segundos;
  const desde = typeof ho.desde === "string" && HORA.test(ho.desde) ? ho.desde : d.horario.desde;
  const hasta = typeof ho.hasta === "string" && HORA.test(ho.hasta) ? ho.hasta : d.horario.hasta;
  return {
    corte_silencio: { activo: bool(cs.activo) ?? d.corte_silencio.activo, seguimientos: entero(cs.seguimientos, 1, 10) ?? d.corte_silencio.seguimientos },
    texto_variable: { rotar: bool(tv.rotar) ?? d.texto_variable.rotar, aviso_desde: entero(tv.aviso_desde, 2, 10000) ?? d.texto_variable.aviso_desde },
    espaciado: min <= max ? { activo: bool(es.activo) ?? d.espaciado.activo, min_segundos: min, max_segundos: max } : { ...d.espaciado },
    horario:
      desde < hasta
        ? { activo: bool(ho.activo) ?? d.horario.activo, desde, hasta, dias: dias(ho.dias)?.length ? dias(ho.dias)! : [...d.horario.dias] }
        : { ...d.horario, dias: [...d.horario.dias] },
    proporcion: { umbral_porcentaje: entero(pr.umbral_porcentaje, 1, 100) ?? d.proporcion.umbral_porcentaje, muestra: entero(pr.muestra, 10, 1000) ?? d.proporcion.muestra },
  };
}

/** Para guardar desde la pantalla: o la configuración entera y válida, o el motivo en lenguaje claro. */
export function validarConfiguracion(pedido: unknown): { ok: true; reglas: ReglasDeSeguridad } | { ok: false; error: string } {
  const p = obj(pedido);
  const cs = obj(p.corte_silencio);
  const tv = obj(p.texto_variable);
  const es = obj(p.espaciado);
  const ho = obj(p.horario);
  const pr = obj(p.proporcion);
  if (bool(cs.activo) === null || entero(cs.seguimientos, 1, 10) === null) return { ok: false, error: "El corte con el silencio va de 1 a 10 seguimientos." };
  if (bool(tv.rotar) === null || entero(tv.aviso_desde, 2, 10000) === null) return { ok: false, error: "El aviso de texto idéntico va desde 2 personas." };
  if (bool(es.activo) === null || entero(es.min_segundos, 0, 3600) === null || entero(es.max_segundos, 0, 3600) === null)
    return { ok: false, error: "El espaciado va de 0 a 3600 segundos." };
  if ((es.min_segundos as number) > (es.max_segundos as number)) return { ok: false, error: "En el espaciado, el mínimo no puede ser mayor que el máximo." };
  if (bool(ho.activo) === null || typeof ho.desde !== "string" || !HORA.test(ho.desde) || typeof ho.hasta !== "string" || !HORA.test(ho.hasta))
    return { ok: false, error: "El horario va con horas como 08:00." };
  if (ho.desde >= ho.hasta) return { ok: false, error: "El horario tiene que empezar antes de terminar." };
  const losDias = dias(ho.dias);
  if (!losDias || losDias.length === 0) return { ok: false, error: "Elegí al menos un día del horario." };
  if (entero(pr.umbral_porcentaje, 1, 100) === null) return { ok: false, error: "El umbral de la proporción de respuesta va de 1 % a 100 %." };
  if (entero(pr.muestra, 10, 1000) === null) return { ok: false, error: "La proporción de respuesta se mide sobre 10 a 1000 seguimientos." };
  return { ok: true, reglas: leerConfiguracion(pedido) };
}

/** La hora local de `zona` en ese instante: día de la semana (0 domingo) y minutos desde la medianoche. */
function enLaZona(instante: Date, zona: string): { anio: number; mes: number; dia: number; semana: number; minutos: number } {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  const semana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.weekday);
  return { anio: +partes.year, mes: +partes.month, dia: +partes.day, semana, minutos: +partes.hour * 60 + +partes.minute };
}

/** El instante en que en `zona` es esa fecha y hora local. */
function instanteLocal(anio: number, mes: number, dia: number, minutos: number, zona: string): Date {
  const supuesto = Date.UTC(anio, mes - 1, dia, Math.floor(minutos / 60), minutos % 60);
  const visto = enLaZona(new Date(supuesto), zona);
  const vistoUtc = Date.UTC(visto.anio, visto.mes - 1, visto.dia, Math.floor(visto.minutos / 60), visto.minutos % 60);
  return new Date(supuesto - (vistoUtc - supuesto));
}

const aMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export type Decision =
  | { tipo: "enviar" }
  | { tipo: "posponer"; hasta: Date; motivo: "fuera_de_horario" }
  | { tipo: "cortar"; motivo: "no_contactar" | "silencio" };

/**
 * Qué hacer con el próximo seguimiento. El orden: el opt-out corta siempre
 * (no se puede apagar); el silencio corta; fuera de horario se pospone, no se
 * cancela.
 */
export function decidirEnvio(e: {
  reglas: ReglasDeSeguridad;
  noContactar: boolean;
  seguimientosSinRespuesta: number;
  ahora: Date;
  zona: string;
}): Decision {
  if (e.noContactar) return { tipo: "cortar", motivo: "no_contactar" };
  const { corte_silencio, horario } = e.reglas;
  if (corte_silencio.activo && e.seguimientosSinRespuesta >= corte_silencio.seguimientos) return { tipo: "cortar", motivo: "silencio" };
  if (!horario.activo) return { tipo: "enviar" };
  const desde = aMinutos(horario.desde);
  const hasta = aMinutos(horario.hasta);
  const ahora = enLaZona(e.ahora, e.zona);
  if (horario.dias.includes(ahora.semana) && ahora.minutos >= desde && ahora.minutos < hasta) return { tipo: "enviar" };
  for (let salto = 0; salto <= 7; salto++) {
    const fecha = new Date(Date.UTC(ahora.anio, ahora.mes - 1, ahora.dia + salto));
    const semana = fecha.getUTCDay();
    if (!horario.dias.includes(semana)) continue;
    if (salto === 0 && ahora.minutos >= desde) continue;
    return {
      tipo: "posponer",
      hasta: instanteLocal(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate(), desde, e.zona),
      motivo: "fuera_de_horario",
    };
  }
  return { tipo: "enviar" };
}

/** La variante para un contacto y un paso: estable (el mismo contacto recibe siempre la misma) y repartida entre todas. */
export function elegirVariante(variantes: string[], clave: string, rotar: boolean): string {
  if (!rotar || variantes.length <= 1) return variantes[0] ?? "";
  let h = 2166136261;
  for (const c of clave) h = Math.imul(h ^ c.codePointAt(0)!, 16777619) >>> 0;
  return variantes[h % variantes.length];
}

/** El aviso de huella de envío masivo: el mismo texto a muchas personas. */
export function avisoDeTextoIdentico(variantes: string[], destinatarios: number, avisoDesde: number): string | null {
  const distintas = new Set(variantes.map((v) => v.trim()).filter(Boolean)).size || 1;
  const porTexto = Math.ceil(destinatarios / distintas);
  if (porTexto < avisoDesde) return null;
  return distintas === 1
    ? `El mismo texto va a ${destinatarios} personas. Sumá variantes: un texto idéntico a muchos es la huella de un envío masivo.`
    : `Cada variante va a unas ${porTexto} personas. Sumá más variantes: un texto idéntico a muchos es la huella de un envío masivo.`;
}

/** La demora aleatoria antes del próximo envío de un grupo, en segundos. */
export function demoraEspaciada(reglas: ReglasDeSeguridad, azar: () => number = Math.random): number {
  const { activo, min_segundos, max_segundos } = reglas.espaciado;
  if (!activo) return 0;
  return min_segundos + Math.floor(azar() * (max_segundos - min_segundos + 1));
}

/** La proporción de seguimientos con respuesta, sobre la muestra; null sin datos. */
export function proporcionDeRespuesta(
  ultimos: { respondido: boolean }[],
  reglas: ReglasDeSeguridad,
): { porcentaje: number | null; aviso: boolean } {
  const muestra = ultimos.slice(-reglas.proporcion.muestra);
  if (muestra.length === 0) return { porcentaje: null, aviso: false };
  const porcentaje = Math.round((muestra.filter((u) => u.respondido).length / muestra.length) * 100);
  return { porcentaje, aviso: porcentaje < reglas.proporcion.umbral_porcentaje };
}
