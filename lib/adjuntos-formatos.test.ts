import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectarFormato, FORMATOS_PERMITIDOS } from "./adjuntos-formatos";

const MIGRACION = readFileSync(join(__dirname, "..", "supabase", "migrations", "00034_adjuntos.sql"), "utf8");

function bytes(...partes: Array<string | number[]>): Uint8Array {
  const todos: number[] = [];
  for (const p of partes) {
    if (typeof p === "string") for (const c of p) todos.push(c.charCodeAt(0));
    else todos.push(...p);
  }
  while (todos.length < 16) todos.push(0);
  return Uint8Array.from(todos);
}

describe("la lista de formatos de F28", () => {
  it("es la misma en el detector y en allowed_mime_types del bucket", () => {
    const m = MIGRACION.match(/allowed_mime_types\)\s*values\s*\([\s\S]*?array\[([\s\S]*?)\]/i);
    expect(m, "la 00034 no tiene allowed_mime_types").not.toBeNull();
    const delBucket = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(delBucket).toEqual(FORMATOS_PERMITIDOS.map((f) => f.mime).sort());
  });

  it("el bucket es privado y la migración no abre ninguna política de storage", () => {
    expect(MIGRACION).toMatch(/'message-media',\s*'message-media',\s*false,/);
    expect(MIGRACION).not.toMatch(/create\s+policy/i);
    expect(MIGRACION).not.toMatch(/grant\s+[\s\S]*?storage\./i);
  });

  it("media_intentos no tiene valor por defecto: los históricos quedan en nulo", () => {
    expect(MIGRACION).toMatch(/add column if not exists media_intentos integer,/);
    expect(MIGRACION).not.toMatch(/media_intentos[^\n,]*default/i);
  });
});

describe("detectarFormato, por los primeros bytes", () => {
  it.each([
    ["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["image/png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/gif", bytes("GIF89a")],
    ["image/webp", bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")],
    ["image/heic", bytes([0, 0, 0, 0x18], "ftypheic")],
    ["video/mp4", bytes([0, 0, 0, 0x20], "ftypisom")],
    ["video/quicktime", bytes([0, 0, 0, 0x14], "ftypqt  ")],
    ["video/webm", bytes([0x1a, 0x45, 0xdf, 0xa3])],
    ["audio/mp4", bytes([0, 0, 0, 0x20], "ftypM4A ")],
    ["audio/mpeg", bytes("ID3", [4, 0])],
    ["audio/mpeg", bytes([0xff, 0xfb, 0x90, 0x64])],
    ["audio/aac", bytes([0xff, 0xf1, 0x50, 0x80])],
    ["audio/ogg", bytes("OggS", [0])],
    ["application/pdf", bytes("%PDF-1.7")],
  ])("%s", (mime, b) => {
    expect(detectarFormato(b)?.mime).toBe(mime);
  });

  it("cada formato de la lista se reconoce con algún contenido (ninguno queda de adorno)", () => {
    const reconocidos = new Set(
      [
        bytes([0xff, 0xd8, 0xff]), bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bytes("GIF87a"),
        bytes("RIFF", [0, 0, 0, 0], "WEBP"), bytes([0, 0, 0, 0], "ftypmif1"), bytes([0, 0, 0, 0], "ftypmp42"),
        bytes([0, 0, 0, 0], "ftypqt  "), bytes([0x1a, 0x45, 0xdf, 0xa3]), bytes([0, 0, 0, 0], "ftypM4B "),
        bytes("ID3"), bytes("OggS"), bytes([0xff, 0xf9]), bytes("%PDF-"),
      ].map((b) => detectarFormato(b)?.mime),
    );
    expect([...reconocidos].sort()).toEqual(FORMATOS_PERMITIDOS.map((f) => f.mime).sort());
  });

  it("no cree en la extensión: un HTML o un ZIP no pasan", () => {
    expect(detectarFormato(bytes("<!doctype html>"))).toBeNull();
    expect(detectarFormato(bytes([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(detectarFormato(new Uint8Array(0))).toBeNull();
  });
});
