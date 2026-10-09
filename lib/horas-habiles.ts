/**
 * Las horas hábiles de F39: cuántas horas del horario de atención del negocio
 * pasaron entre dos marcas.
 *
 * El horario sale de `workspaces.horario_atencion` y la zona de
 * `workspaces.zona_horaria` (00033). Las franjas están en hora LOCAL del
 * negocio, y cada una se convierte al instante real con la zona IANA, día por
 * día. No se usa un desfase fijo: Costa Rica no cambia de hora, pero otra zona
 * sí, y un día de cambio tiene 23 o 25 horas.
 *
 * Es una función pura: no lee la base ni el reloj. Quien llama le pasa «ahora».
 */

export const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
export type Dia = (typeof DIAS)[number];

/** Una franja en hora local, «HH:MM» a «HH:MM». «24:00» es el final del día. */
export type Franja = [string, string];
export type Horario = Record<Dia, Franja[]>;

/**
 * El valor por defecto de la 00033: el del prototipo aprobado el 06/10/2026
 * (`docs/diseno/prototipo-fase1.html:844`). No lo confirmó la clienta.
 */
export const HORARIO_POR_DEFECTO: Horario = {
  lun: [["08:00", "18:00"]],
  mar: [["08:00", "18:00"]],
  mie: [["08:00", "18:00"]],
  jue: [["08:00", "18:00"]],
  vie: [["08:00", "18:00"]],
  sab: [["09:00", "12:00"]],
  dom: [],
};

export const ZONA_POR_DEFECTO = "America/Costa_Rica";

const HORA = /^([01]\d|2[0-4]):([0-5]\d)$/;

/** Minutos desde la medianoche, o null si no es «HH:MM» entre 00:00 y 24:00. */
export function minutosDe(hhmm: unknown): number | null {
  if (typeof hhmm !== "string") return null;
  const m = HORA.exec(hhmm);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total <= 24 * 60 ? total : null;
}

/**
 * El horario si está bien formado, o null. Exige los siete días; cada franja
 * con inicio antes que el fin; y franjas del mismo día que no se pisen, porque
 * una hora contada dos veces adelantaría la alerta.
 */
export function validarHorario(valor: unknown): Horario | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const v = valor as Record<string, unknown>;
  const salida = {} as Horario;
  for (const dia of DIAS) {
    const franjas = v[dia];
    if (!Array.isArray(franjas)) return null;
    const limpias: Array<[number, number, Franja]> = [];
    for (const f of franjas) {
      if (!Array.isArray(f) || f.length !== 2) return null;
      const a = minutosDe(f[0]);
      const b = minutosDe(f[1]);
      if (a === null || b === null || a >= b) return null;
      limpias.push([a, b, [f[0], f[1]] as Franja]);
    }
    limpias.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < limpias.length; i++) if (limpias[i][0] < limpias[i - 1][1]) return null;
    salida[dia] = limpias.map((x) => x[2]);
  }
  return salida;
}

/** ¿La zona existe para `Intl`? */
export function zonaValida(zona: unknown): boolean {
  if (typeof zona !== "string" || !zona) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

const formateadores = new Map<string, Intl.DateTimeFormat>();
function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formateadores.set(zona, f);
  }
  return f;
}

/** Fecha y hora locales de un instante, en la zona. */
function partesLocales(ms: number, zona: string) {
  const p: Record<string, number> = {};
  for (const x of formateador(zona).formatToParts(new Date(ms))) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** Cuánto adelanta la hora local a UTC en ese instante, en milisegundos. */
function desfase(ms: number, zona: string): number {
  const l = partesLocales(ms, zona);
  const comoUtc = Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi, l.s);
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

/** El instante de una hora local. `minutos` puede ser 1440 (las 24:00). */
function instanteLocal(y: number, m: number, d: number, minutos: number, zona: string): number {
  const ingenuo = Date.UTC(y, m - 1, d, 0, minutos);
  const primero = ingenuo - desfase(ingenuo, zona);
  const segundo = desfase(primero, zona);
  return ingenuo - segundo;
}

/** Lunes = 0 … domingo = 6, para una fecha del calendario. */
function diaDeLaSemana(y: number, m: number, d: number): Dia {
  return DIAS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/**
 * Horas hábiles entre `desde` y `hasta`, en la zona y con el horario dados.
 * Si `desde` es posterior a `hasta` (una marca en el futuro), devuelve 0.
 */
export function horasHabiles(desde: Date, hasta: Date, zona: string, horario: Horario): number {
  const ini = desde.getTime();
  const fin = hasta.getTime();
  if (!(fin > ini)) return 0;

  const a = partesLocales(ini, zona);
  const b = partesLocales(fin, zona);
  const ultimo = Date.UTC(b.y, b.m - 1, b.d);

  let total = 0;
  for (let dia = Date.UTC(a.y, a.m - 1, a.d); dia <= ultimo; dia += 86_400_000) {
    const f = new Date(dia);
    const y = f.getUTCFullYear();
    const m = f.getUTCMonth() + 1;
    const d = f.getUTCDate();
    for (const [x, z] of horario[diaDeLaSemana(y, m, d)] ?? []) {
      const desdeMin = minutosDe(x);
      const hastaMin = minutosDe(z);
      if (desdeMin === null || hastaMin === null || desdeMin >= hastaMin) continue;
      const s = Math.max(ini, instanteLocal(y, m, d, desdeMin, zona));
      const e = Math.min(fin, instanteLocal(y, m, d, hastaMin, zona));
      if (e > s) total += e - s;
    }
  }
  return total / 3_600_000;
}
