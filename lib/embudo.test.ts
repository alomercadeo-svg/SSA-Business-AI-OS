import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ETAPAS_DEL_EMBUDO, armarEmbudo, filtroDeEmbudo, type ContactoDelEmbudo } from "./embudo";

/**
 * El Embudo (10/11/2026): pantalla fuera del plano, decidida por Marcos para
 * la entrega; criterios a escribir después. Solo lectura.
 */
const c = (id: string, etapa: string, estado: string | null, valor: number | null = null, moneda: string | null = null): ContactoDelEmbudo => ({
  id,
  display_name: id,
  pipeline_stage: etapa,
  deal_status: estado,
  deal_value: valor,
  deal_currency: moneda,
  deal_closed_at: null,
});

describe("las columnas del embudo", () => {
  it("son las etapas de la base, en su orden y con su nombre tal como está (00030)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/00030_contacto_estado_comercial.sql"), "utf8");
    const bloque = sql.slice(sql.indexOf("add constraint contacts_pipeline_stage_check"), sql.indexOf("));", sql.indexOf("add constraint contacts_pipeline_stage_check")));
    const deLaBase = [...bloque.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(deLaBase).toHaveLength(13);
    expect(ETAPAS_DEL_EMBUDO).toEqual(deLaBase);
    expect(armarEmbudo([], "todos").columnas.map((col) => col.etapa)).toEqual(deLaBase);
  });

  it("la suma del valor va por moneda: USD y CRC nunca se suman entre sí; el valor cero o vacío no suma", () => {
    const e = armarEmbudo(
      [c("a", "3. Respondió", "abierto", 100, "USD"), c("b", "3. Respondió", "perdido", 50.5, "USD"), c("d", "3. Respondió", "ganado", 25000, "CRC"), c("f", "3. Respondió", "abierto", 0, "USD"), c("g", "3. Respondió", "abierto")],
      "todos",
    );
    const col = e.columnas.find((x) => x.etapa === "3. Respondió")!;
    expect(col.contactos).toHaveLength(5);
    expect(col.sumas).toEqual([
      { moneda: "CRC", total: 25000 },
      { moneda: "USD", total: 150.5 },
    ]);
  });

  it("el filtro deja ver solo un estado, y las cantidades del filtro cuentan sobre todos", () => {
    const todos = [c("a", "1. Nuevo contacto", "abierto"), c("b", "14. Repesca", "perdido"), c("d", "14. Repesca", "perdido"), c("f", "13. ¡Cerrada!", "ganado")];
    const e = armarEmbudo(todos, "perdido");
    expect(e.cantidades).toEqual({ todos: 4, abierto: 1, ganado: 1, perdido: 2 });
    expect(e.columnas.flatMap((x) => x.contactos.map((y) => y.id))).toEqual(["b", "d"]);
    expect(e.columnas.find((x) => x.etapa === "1. Nuevo contacto")!.contactos).toEqual([]);
  });

  it("el filtro de la dirección: Todos por defecto, y un valor desconocido también es Todos", () => {
    expect(filtroDeEmbudo(undefined)).toBe("todos");
    expect(filtroDeEmbudo("ganado")).toBe("ganado");
    expect(filtroDeEmbudo("cualquiera")).toBe("todos");
    expect(filtroDeEmbudo(["abierto", "perdido"])).toBe("abierto");
  });

  it("sin contactos con etapa, el embudo está vacío pero las 13 columnas siguen ahí", () => {
    const e = armarEmbudo([], "todos");
    expect(e.vacio).toBe(true);
    expect(e.columnas).toHaveLength(13);
    expect(e.cantidades).toEqual({ todos: 0, abierto: 0, ganado: 0, perdido: 0 });
    expect(armarEmbudo([c("a", "6. Agendó", "abierto")], "ganado").vacio).toBe(false);
  });
});
