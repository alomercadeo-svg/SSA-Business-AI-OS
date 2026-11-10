/**
 * F37, parte 1 (09/11/2026): importar las filas ya preparadas
 * (`lib/importacion-csv.ts`) como contactos, sin duplicar.
 *
 * La deduplicación sigue §14: id de Pipedrive, después correo, después
 * teléfono E.164, en ese orden de confianza, contra los contactos del espacio.
 * Si existe, se actualiza solo con lo que trae la fila (nunca se borra un dato
 * con una celda vacía). Si el que coincide está en Eliminados, no se restaura
 * ni se duplica: la fila lo dice.
 *
 * Esta noche importar es solo de Owner y Admin (decidido por Marcos el
 * 09/11/2026): ven todos los contactos del espacio, así que buscar con su
 * sesión ve lo mismo que buscar en todo el espacio. La importación del Member
 * (el choque de §11 con la 00038 y los duplicados fuera de su alcance) queda
 * para después de la entrega.
 *
 * El almacén se inyecta: la ruta le pasa uno sobre Supabase; los tests, uno en
 * memoria.
 */
import type { FilaPreparada } from "./importacion-csv";

export interface DatosDeContacto {
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  phone_resolved?: boolean;
  pipedrive_person_id?: string | null;
  setter_id?: string | null;
  vendedor_id?: string | null;
}

export interface AlmacenDeContactos {
  buscarPor(campo: "pipedrive_person_id" | "email" | "phone", valor: string): Promise<{ id: string; eliminado: boolean } | null>;
  crear(datos: DatosDeContacto): Promise<string>;
  actualizar(id: string, datos: DatosDeContacto): Promise<void>;
  ponerEtiquetas(id: string, tagIds: string[]): Promise<void>;
  ponerCampos(id: string, valores: { fieldId: string; value: string }[]): Promise<void>;
}

export interface Catalogos {
  /** Nombre de la etiqueta en minúsculas → id. */
  etiquetas: Map<string, string>;
  /** `slug` del campo propio → su id y su tipo. */
  campos: Map<string, { id: string; tipo: string }>;
  /** Nombre o correo del miembro en minúsculas → id. */
  miembros: Map<string, string>;
}

export interface LineaDelResumen {
  numero: number;
  nombre: string;
  que: string;
}

export interface Resumen {
  creados: number;
  actualizados: number;
  conError: number;
  usaronCodigo: number;
  lineas: LineaDelResumen[];
  /** Para el historial: los contactos creados y actualizados, con su nombre. */
  creadosIds: { id: string; nombre: string }[];
  actualizadosIds: { id: string; nombre: string }[];
}

export const ELIMINADO = "Ese contacto está en Eliminados: restauralo desde ahí y volvé a importar.";

/** El valor de un campo propio según su tipo; null si no es válido. */
export function valorDeCampo(tipo: string, valor: string): string | null {
  const v = valor.trim();
  if (!v) return null;
  switch (tipo) {
    case "number":
      return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
    case "boolean": {
      const b = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (["si", "true", "1", "verdadero"].includes(b)) return "true";
      if (["no", "false", "0", "falso"].includes(b)) return "false";
      return null;
    }
    case "date": {
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      const [a, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2].padStart(2, "0"), dmy[1].padStart(2, "0")] : [];
      if (!a) return null;
      const f = new Date(`${a}-${m}-${d}T00:00:00Z`);
      return Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== `${a}-${m}-${d}` ? null : `${a}-${m}-${d}`;
    }
    case "url":
      return /^https?:\/\/\S+\.\S+$/i.test(v) ? v : null;
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
    default:
      return v;
  }
}

const TEXTO_DE_TIPO: Record<string, string> = {
  number: "un número",
  boolean: "sí o no",
  date: "una fecha (día/mes/año)",
  url: "una dirección web",
  email: "un correo",
};

export async function importarFilas(
  filas: FilaPreparada[],
  catalogos: Catalogos,
  almacen: AlmacenDeContactos,
  opciones: { asignarA: string | null },
): Promise<Resumen> {
  const r: Resumen = { creados: 0, actualizados: 0, conError: 0, usaronCodigo: 0, lineas: [], creadosIds: [], actualizadosIds: [] };
  for (const f of filas) {
    const nombre = f.nombre ?? f.correo ?? f.telefono ?? f.pipedrive ?? `Fila ${f.numero}`;
    if (f.error) {
      r.conError++;
      r.lineas.push({ numero: f.numero, nombre, que: f.error });
      continue;
    }

    let existente: { id: string; eliminado: boolean } | null = null;
    for (const [campo, valor] of [
      ["pipedrive_person_id", f.pipedrive],
      ["email", f.correo],
      ["phone", f.telefono],
    ] as const) {
      if (!valor) continue;
      existente = await almacen.buscarPor(campo, valor);
      if (existente) break;
    }
    if (existente?.eliminado) {
      r.conError++;
      r.lineas.push({ numero: f.numero, nombre, que: ELIMINADO });
      continue;
    }

    const avisos: string[] = [];
    const datos: DatosDeContacto = {};
    if (f.nombre) datos.display_name = f.nombre;
    if (f.correo) datos.email = f.correo;
    if (f.telefono) {
      datos.phone = f.telefono;
      datos.phone_resolved = true;
    }
    if (f.pipedrive) datos.pipedrive_person_id = f.pipedrive;
    const miembro = (texto: string | null, rol: string) => {
      if (!texto) return undefined;
      const id = catalogos.miembros.get(texto.toLowerCase());
      if (!id) avisos.push(`El ${rol} «${texto}» no es del equipo: quedó sin ${rol}.`);
      return id;
    };
    const setter = miembro(f.setter, "setter");
    const vendedor = miembro(f.vendedor, "vendedor");
    if (setter) datos.setter_id = setter;
    else if (!f.setter && !existente && opciones.asignarA) datos.setter_id = opciones.asignarA;
    if (vendedor) datos.vendedor_id = vendedor;

    let id: string;
    if (existente) {
      id = existente.id;
      if (Object.keys(datos).length) await almacen.actualizar(id, datos);
      r.actualizados++;
      r.actualizadosIds.push({ id, nombre });
    } else {
      if (!datos.display_name) datos.display_name = nombre;
      id = await almacen.crear(datos);
      r.creados++;
      r.creadosIds.push({ id, nombre });
    }
    if (f.usoCodigoPorDefecto) r.usaronCodigo++;

    const tagIds: string[] = [];
    for (const t of f.etiquetas) {
      const tagId = catalogos.etiquetas.get(t.toLowerCase());
      if (tagId) tagIds.push(tagId);
      else avisos.push(`La etiqueta «${t}» no existe: no se creó. Creala en Configuración y volvé a importar.`);
    }
    if (tagIds.length) await almacen.ponerEtiquetas(id, tagIds);

    const valores: { fieldId: string; value: string }[] = [];
    for (const [slug, crudo] of Object.entries(f.campos)) {
      const campo = catalogos.campos.get(slug);
      if (!campo) continue;
      const valor = valorDeCampo(campo.tipo, crudo);
      if (valor === null) avisos.push(`«${crudo}» no es ${TEXTO_DE_TIPO[campo.tipo] ?? "un valor válido"}: ese campo no se cargó.`);
      else valores.push({ fieldId: campo.id, value: valor });
    }
    if (valores.length) await almacen.ponerCampos(id, valores);

    const base = existente ? "Actualizado." : "Creado.";
    const codigo = f.usoCodigoPorDefecto ? " Usó el código de país por defecto." : "";
    if (avisos.length || f.usoCodigoPorDefecto) r.lineas.push({ numero: f.numero, nombre, que: `${base}${codigo}${avisos.length ? ` ${avisos.join(" ")}` : ""}` });
  }
  return r;
}
