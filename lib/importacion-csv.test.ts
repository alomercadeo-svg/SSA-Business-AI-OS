import { describe, it, expect } from "vitest";
import { detectarSeparador, leerCsv, prepararFila, sugerirCampo, type Campo } from "./importacion-csv";

describe("leerCsv (F37): lo que guarda Excel en español y lo que manda cualquier planilla", () => {
  it("punto y coma, como Excel en español", () => {
    const p = leerCsv("Nombre;Correo\nAna;ana@x.com\n");
    expect(p.separador).toBe(";");
    expect(p.columnas).toEqual(["Nombre", "Correo"]);
    expect(p.filas).toEqual([["Ana", "ana@x.com"]]);
  });

  it("coma (control)", () => {
    expect(leerCsv("Nombre,Correo\r\nAna,ana@x.com\r\n").filas).toEqual([["Ana", "ana@x.com"]]);
  });

  it("la marca BOM de UTF-8 al principio no queda pegada al primer encabezado", () => {
    expect(leerCsv("﻿Nombre;Correo\nAna;a@x.com").columnas[0]).toBe("Nombre");
  });

  it("comillas, comillas escapadas, separador y salto de línea dentro de comillas", () => {
    const p = leerCsv('Nombre;Nota\n"Pérez; Ana";"dijo ""hola""\ny se fue"\nLuis;ok');
    expect(p.filas).toEqual([
      ["Pérez; Ana", 'dijo "hola"\ny se fue'],
      ["Luis", "ok"],
    ]);
  });

  it("las líneas vacías no son filas", () => {
    expect(leerCsv("Nombre\nAna\n\n\nLuis\n").filas).toEqual([["Ana"], ["Luis"]]);
  });

  it("el separador lo decide la primera línea, fuera de comillas", () => {
    expect(detectarSeparador('"a,b";c;d\n1,2,3')).toBe(";");
  });
});

describe("sugerirCampo (F37, paso 2)", () => {
  it("sugiere por el encabezado, sin importar tildes ni mayúsculas", () => {
    expect(sugerirCampo("Nombre")).toBe("nombre");
    expect(sugerirCampo("E-mail")).toBe("correo");
    expect(sugerirCampo("Teléfono")).toBe("telefono");
    expect(sugerirCampo("Person - ID")).toBe("pipedrive");
    expect(sugerirCampo("Etiquetas")).toBe("etiquetas");
    expect(sugerirCampo("Ciudad", [{ slug: "ciudad", name: "Ciudad" }])).toBe("campo:ciudad");
    expect(sugerirCampo("Cualquier cosa")).toBe("no_importar");
  });
});

describe("prepararFila (F37): identificadores de §14 y el teléfono", () => {
  const mapeo: Campo[] = ["nombre", "correo", "telefono", "pipedrive", "etiquetas"];
  const op = { codigoPais: "+506", numero: 2 };

  it("un teléfono sin código toma el código por defecto y queda señalado", () => {
    const f = prepararFila(["Ana", "", "7034 9182", "", ""], mapeo, op);
    expect(f.telefono).toBe("+50670349182");
    expect(f.usoCodigoPorDefecto).toBe(true);
    expect(f.error).toBeNull();
  });

  it("con código no usa el por defecto; 00 vale como +", () => {
    expect(prepararFila(["Ana", "", "+54 9 11 5555 1234", "", ""], mapeo, op)).toMatchObject({ telefono: "+5491155551234", usoCodigoPorDefecto: false });
    expect(prepararFila(["Ana", "", "0034 600 000 000", "", ""], mapeo, op).telefono).toBe("+34600000000");
  });

  it("una fila sin ningún identificador se rechaza con su motivo", () => {
    const f = prepararFila(["Sin datos", "", "", "", ""], mapeo, op);
    expect(f.error).toBe("No tiene correo, teléfono ni id de Pipedrive: sin eso no se puede saber si ya existe, así que no se importó.");
  });

  it("un teléfono que no se puede normalizar no se inventa (texto de §11)", () => {
    const f = prepararFila(["Ana", "ana@x.com", "8856-12x", "", ""], mapeo, op);
    expect(f.error).toBe("El teléfono «8856-12x» no se puede normalizar. No se inventó un número: corregilo en la planilla y volvé a importar.");
  });

  it("el ejemplo de §11, «8856-12», tampoco: le faltan dígitos", () => {
    expect(prepararFila(["Ana", "", "8856-12", "", ""], mapeo, op).error).toBe("El teléfono «8856-12» no se puede normalizar. No se inventó un número: corregilo en la planilla y volvé a importar.");
  });

  it("un correo mal escrito es un error de la fila", () => {
    expect(prepararFila(["Ana", "ana@", "", "", ""], mapeo, op).error).toBe("El correo «ana@» no es válido. Corregilo en la planilla y volvé a importar.");
  });

  it("el correo se guarda en minúsculas; las etiquetas se separan por coma", () => {
    expect(prepararFila(["Ana", " Ana@X.com ", "", "", "vip, Pauta octubre"], mapeo, op)).toMatchObject({ correo: "ana@x.com", etiquetas: ["vip", "Pauta octubre"], error: null });
  });

  it("solo el id de Pipedrive alcanza como identificador", () => {
    expect(prepararFila(["Ana", "", "", "1234", ""], mapeo, op)).toMatchObject({ pipedrive: "1234", error: null });
  });
});

describe("F38: la migración desde Pipedrive", () => {
  it("sugiere los encabezados del script de unión; el id de trato no se confunde con el de persona", () => {
    expect(sugerirCampo("Id de persona de Pipedrive")).toBe("pipedrive");
    expect(sugerirCampo("Id de trato de Pipedrive")).toBe("pipedrive_trato");
    expect(sugerirCampo("Etapa")).toBe("etapa");
    expect(sugerirCampo("Estado del trato")).toBe("estado_trato");
    expect(sugerirCampo("Valor")).toBe("valor");
    expect(sugerirCampo("Moneda")).toBe("moneda");
    expect(sugerirCampo("Fecha de cierre")).toBe("fecha_cierre");
    expect(sugerirCampo("Nota del contacto")).toBe("nota");
    expect(sugerirCampo("Nota del contacto 2")).toBe("nota");
  });

  it("el teléfono se limpia antes de normalizar: el apóstrofe inicial y los invisibles de dirección", () => {
    const m: Campo[] = ["nombre", "telefono"];
    const conApostrofe = prepararFila(["Ana", "'+506 8888 1111"], m, { codigoPais: "+506", numero: 2 });
    expect(conApostrofe).toMatchObject({ telefono: "+50688881111", usoCodigoPorDefecto: false, error: null });
    const invisibles = prepararFila(["Luis", "‪8888-2222‬"], m, { codigoPais: "+506", numero: 3 });
    expect(invisibles).toMatchObject({ telefono: "+50688882222", usoCodigoPorDefecto: true, error: null });
    const ambos = prepararFila(["Eva", "‎'88883333"], m, { codigoPais: "+506", numero: 4 });
    expect(ambos).toMatchObject({ telefono: "+50688883333", error: null });
  });

  it("los datos del trato llegan a la fila; el estado en minúsculas", () => {
    const m: Campo[] = ["pipedrive", "etapa", "estado_trato", "valor", "moneda", "fecha_cierre", "pipedrive_trato", "nota"];
    const f = prepararFila(["77", "3. Respondió", "Perdido", "1500", "USD", "2025-03-14", "901", "Motivo de pérdida en Pipedrive: precio"], m, { codigoPais: "+506", numero: 2 });
    expect(f).toMatchObject({
      pipedrive: "77",
      etapa: "3. Respondió",
      estadoTrato: "perdido",
      valor: "1500",
      moneda: "USD",
      fechaCierre: "2025-03-14",
      pipedriveTrato: "901",
      notas: ["Motivo de pérdida en Pipedrive: precio"],
      error: null,
    });
  });

  it("el id de trato queda en la fila aunque la fila tenga error (el control la cuenta como faltante)", () => {
    const f = prepararFila(["8856-12", "905"], ["telefono", "pipedrive_trato"], { codigoPais: "+506", numero: 2 });
    expect(f.error).not.toBeNull();
    expect(f.pipedriveTrato).toBe("905");
  });
});
