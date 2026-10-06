import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Qué pasa con cada tabla cuando se borra un canal, calculado leyendo todas las
 * migraciones en orden, como las aplica el CLI.
 *
 * Desde la 00025, las tablas con historia tienen su clave hacia `channels` en
 * RESTRICT: la base rechaza borrar un canal que tiene conversaciones, mensajes,
 * identidad de contacto, comentarios, inscripciones, destinatarios o sesiones.
 * El historial vive en la base local por decisión cerrada del proyecto, y esta
 * es la protección que no depende de la interfaz ni de una ruta.
 *
 * Lo que NO cambia, a propósito: las claves de `contact_id`. La purga de F30
 * borra contactos y se lleva su historia en cascada, y eso es intencional.
 *
 * Esto no prueba la base: lo prueba `scripts/verify-channels-restrict.mjs`
 * contra la base, con su control positivo. Este test atrapa, sin base, que una
 * migración futura vuelva a poner CASCADE. Se vio en rojo antes de la 00025.
 */

const DIR = join(__dirname, "..", "supabase", "migrations");
const archivos = readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

type Accion = "cascade" | "restrict" | "set null" | "no action";

/** La acción ON DELETE vigente de la clave channel_id -> channels, por tabla. */
function accionesVigentes(): Record<string, Accion> {
  const vigente: Record<string, Accion> = {};
  const accion = (s: string | undefined): Accion => (s ? (s.toLowerCase().replace(/\s+/g, " ") as Accion) : "no action");
  for (const f of archivos) {
    const sql = readFileSync(join(DIR, f), "utf8").replace(/--[^\n]*/g, "");
    const eventos: { pos: number; tabla: string; accion: Accion }[] = [];
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const col = m[2].match(/\bchannel_id\s+uuid[^,\n]*?references\s+(?:public\.)?channels\s*\(id\)(?:\s+on delete (cascade|restrict|set null|no action))?/i);
      if (col) eventos.push({ pos: m.index!, tabla: m[1].toLowerCase(), accion: accion(col[1]) });
    }
    for (const m of sql.matchAll(
      /alter table (?:only )?(?:public\.)?(\w+)[^;]*?add constraint \w+\s+foreign key \(channel_id\) references (?:public\.)?channels\s*\(id\)(?:\s+on delete (cascade|restrict|set null|no action))?/gi
    )) {
      eventos.push({ pos: m.index!, tabla: m[1].toLowerCase(), accion: accion(m[2]) });
    }
    for (const e of eventos.sort((a, b) => a.pos - b.pos)) vigente[e.tabla] = e.accion;
  }
  return vigente;
}

const CON_HISTORIA = [
  "broadcast_recipients",
  "comment_logs",
  "contact_channels",
  "conversations",
  "flow_sessions",
  "sequence_enrollments",
];

describe("borrar un canal, según las migraciones", () => {
  const vigente = accionesVigentes();

  /** Control positivo del lector: encuentra las ocho claves, incluida la que cambió la 00013. */
  it("encuentra las ocho claves hacia channels", () => {
    expect(Object.keys(vigente).sort()).toEqual([...CON_HISTORIA, "triggers", "webhook_alerts"].sort());
  });

  it("las tablas con historia rechazan el borrado (RESTRICT)", () => {
    const mal = CON_HISTORIA.filter((t) => vigente[t] !== "restrict").map((t) => `${t}: ${vigente[t]}`);
    expect(mal, "Borrar un canal arrastraría su historial con estas claves").toEqual([]);
  });

  it("las que no guardan historia siguen en SET NULL", () => {
    expect(vigente.triggers).toBe("set null");
    expect(vigente.webhook_alerts).toBe("set null");
  });
});
