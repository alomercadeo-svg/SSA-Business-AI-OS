import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AVISO_NO_CONTACTAR, FRASES_POR_DEFECTO, fraseDeBaja } from "./no-contactar";

/** F34, ítem 8 del plan maestro (06/11/2026). */
const leer = (r: string) => readFileSync(resolve(__dirname, "..", r), "utf8");

describe("las frases de baja por defecto", () => {
  it("son las siete del criterio, iguales a las de la migración", () => {
    const criterio = ["no me escribas más", "dejá de mandar mensajes", "no quiero recibir mensajes", "stop", "unsubscribe", "basta", "no me contactes"];
    expect(FRASES_POR_DEFECTO).toEqual(criterio);
    const sql = leer("supabase/migrations/00053_no_contactar.sql");
    for (const f of criterio) expect(sql).toContain(`'${f}'`);
  });
});

describe("fraseDeBaja: si un mensaje del lead pide no recibir más", () => {
  const F = ["no me escribas más", "dejá de mandar mensajes", "stop", "basta"];
  it("la reconoce sin mayúsculas ni tildes, y dentro de una oración", () => {
    expect(fraseDeBaja("Hola, por favor NO ME ESCRIBAS MAS, gracias", F)).toBe("no me escribas más");
    expect(fraseDeBaja("deja de mandar mensajes!!", F)).toBe("dejá de mandar mensajes");
    expect(fraseDeBaja("STOP", F)).toBe("stop");
    expect(fraseDeBaja("Ya basta.", F)).toBe("basta");
  });
  it("por palabras enteras: «bastante» o «stopper» no cuentan", () => {
    expect(fraseDeBaja("Me gustó bastante la propuesta", F)).toBeNull();
    expect(fraseDeBaja("el stopper de la puerta", F)).toBeNull();
  });
  it("control: un mensaje común no marca", () => {
    expect(fraseDeBaja("Quiero agendar una reunión", F)).toBeNull();
    expect(fraseDeBaja(null, F)).toBeNull();
    expect(fraseDeBaja("", F)).toBeNull();
  });
  it("una frase vacía de la lista no marca todo", () => {
    expect(fraseDeBaja("cualquier cosa", ["", "  "])).toBeNull();
  });
});

describe("el aviso del bloqueo", () => {
  it("dice por qué no se envía, en voseo, sin opción de forzarlo", () => {
    expect(AVISO_NO_CONTACTAR).toMatch(/pidió no recibir más mensajes/);
    expect(AVISO_NO_CONTACTAR).not.toMatch(/forzar|igual/i);
  });
});

describe("dónde se aplica (por la fuente)", () => {
  it("el envío de la bandeja bloquea a un marcado con 409 antes de la ventana y del proveedor", () => {
    const r = leer("app/api/v1/messages/route.ts");
    const bloqueo = r.indexOf('code: "no_contactar"');
    expect(bloqueo).toBeGreaterThan(0);
    expect(bloqueo).toBeLessThan(r.indexOf('code: "ventana_cerrada"'));
    expect(bloqueo).toBeLessThan(r.indexOf("createZernioClient("));
  });
  it("los dos receptores pasan el texto del lead a la detección", () => {
    expect(leer("app/api/webhooks/late/route.ts")).toMatch(/alEscribirElLead\([\s\S]*?texto: mensaje\.text/);
    expect(leer("lib/evolution-guardado.ts")).toMatch(/alEscribirElLead\([\s\S]*?texto: mensaje\.text/);
    expect(leer("lib/estado-por-mensaje.ts")).toMatch(/marcarSiPideBaja\(/);
  });
});

describe("las pantallas (por la fuente)", () => {
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  it("la lista de la bandeja marca en rojo «No contactar»", () => {
    const l = sinComentarios(leer("components/inbox/conversation-list.tsx"));
    expect(l).toMatch(/conversation\.contacts\?\.do_not_contact[\s\S]{0,300}No contactar/);
  });
  it("el encabezado del chat marca en rojo, y en lugar del campo va el aviso, sin forma de escribir", () => {
    const h = sinComentarios(leer("components/inbox/message-thread.tsx"));
    expect(h).toMatch(/noContactar &&[\s\S]{0,300}No contactar/);
    expect(h).toMatch(/noContactar \? \([\s\S]{0,400}AVISO_NO_CONTACTAR/);
  });
  it("la ficha deja revertir solo a Owner y Admin", () => {
    const f = sinComentarios(leer("app/(dashboard)/dashboard/contacts/[contactId]/page.tsx"));
    expect(f).toMatch(/\{manager && <RevertirNoContactar contactoId=\{contact\.id\} \/>\}/);
    const a = leer("lib/actions/contactos.ts");
    expect(a).toMatch(/export async function revertirNoContactar[\s\S]{0,400}if \(!esManager\(contexto\.role\)\)/);
    expect(a).toMatch(/accion: "contacto\.no_contactar_revertido"/);
  });
  it("Configuración tiene la pestaña «Frases de baja», solo para managers", () => {
    const t = leer("components/settings/settings-tabs.tsx");
    expect(t).toMatch(/etiqueta: "Frases de baja", href: "\/dashboard\/settings\/frases-de-baja"/);
    const p = leer("app/(dashboard)/dashboard/settings/frases-de-baja/page.tsx");
    expect(p).toMatch(/getWorkspaceAsManager\(/);
    const a = leer("lib/actions/frases-de-baja.ts");
    expect(a).toMatch(/if \(!esManager\(contexto\.role\)\)/);
    expect(a).toMatch(/accion: "configuracion\.cambiada"/);
  });
});
