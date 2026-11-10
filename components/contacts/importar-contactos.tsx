"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_BYTES, MAX_FILAS_PARTE_1, leerCsv, sugerirCampo, type Campo, type Planilla } from "@/lib/importacion-csv";
import type { Miembro } from "@/lib/miembros";

/**
 * F37, parte 1 (09/11/2026): la pantalla de cinco pasos de §11 (Archivo,
 * Columnas, Opciones, Importando, Resumen), hasta 500 filas en el momento.
 * El archivo se lee en el navegador para la vista previa y el mapeo; el
 * servidor vuelve a preparar cada fila (`POST /api/v1/contacts/importar`).
 */
const PASOS = ["Archivo", "Columnas", "Opciones", "Importando", "Resumen"] as const;

const OPCIONES_FIJAS: { valor: Campo; texto: string }[] = [
  { valor: "nombre", texto: "Nombre" },
  { valor: "correo", texto: "Correo" },
  { valor: "telefono", texto: "Teléfono" },
  { valor: "pipedrive", texto: "Id de Pipedrive" },
  { valor: "setter", texto: "Setter" },
  { valor: "vendedor", texto: "Vendedor" },
  { valor: "etiquetas", texto: "Etiquetas" },
];

interface Resultado {
  filas: number;
  creados: number;
  actualizados: number;
  conError: number;
  usaronCodigo: number;
  lineas: { numero: number; nombre: string; que: string }[];
}

export function ImportarContactos({ camposPropios, miembros }: { camposPropios: { slug: string; name: string }[]; miembros: Miembro[] }) {
  const [paso, setPaso] = useState(0);
  const [archivo, setArchivo] = useState<string>("");
  const [planilla, setPlanilla] = useState<Planilla | null>(null);
  const [mapeo, setMapeo] = useState<Campo[]>([]);
  const [codigoPais, setCodigoPais] = useState("+506");
  const [etiquetaOrigen, setEtiquetaOrigen] = useState(() => `Importado ${new Date().toLocaleDateString("es-CR")}`);
  const [asignarA, setAsignarA] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function elegir(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("El archivo pasa de 10 MB.");
    const p = leerCsv(await f.text());
    if (p.columnas.length === 0 || p.filas.length === 0) return setError("La planilla no tiene filas para importar.");
    if (p.filas.length > MAX_FILAS_PARTE_1) return setError(`Tiene ${p.filas.length} filas. Por ahora, hasta 500 filas por importación.`);
    setArchivo(f.name);
    setPlanilla(p);
    setMapeo(p.columnas.map((c) => sugerirCampo(c, camposPropios)));
    setPaso(1);
  }

  async function importar() {
    if (!planilla) return;
    setPaso(3);
    setError(null);
    // La etiqueta de origen va como una columna más de etiquetas, si existe.
    const conOrigen = etiquetaOrigen.trim();
    const mapeoFinal: Campo[] = conOrigen ? [...mapeo, "etiquetas"] : mapeo;
    const filas = planilla.filas.map((f) => {
      const celdas = planilla.columnas.map((_, i) => f[i] ?? "");
      if (!conOrigen) return celdas;
      const iEtiquetas = mapeo.indexOf("etiquetas");
      const previas = iEtiquetas >= 0 ? celdas[iEtiquetas] : "";
      return [...celdas.map((v, i) => (i === iEtiquetas ? "" : v)), [previas, conOrigen].filter(Boolean).join(", ")];
    });
    try {
      const res = await fetch("/api/v1/contacts/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreArchivo: archivo, codigoPais, asignarA: asignarA || null, mapeo: mapeoFinal, filas }),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok) {
        setError(datos?.error ?? "No se pudo importar. Probá de nuevo.");
        setPaso(2);
        return;
      }
      setResultado(datos as Resultado);
      setPaso(4);
    } catch {
      setError("No se pudo importar. Probá de nuevo.");
      setPaso(2);
    }
  }

  const filasValidas = planilla?.filas.length ?? 0;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <Link href="/dashboard/contacts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Contactos
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Importar contactos</h1>
      <p className="mt-1 text-sm text-muted-foreground">Desde una planilla CSV, sin duplicar a nadie.</p>

      <ol className="mt-4 flex flex-wrap gap-2 text-xs">
        {PASOS.map((p, i) => (
          <li
            key={p}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1",
              i === paso ? "border-primary text-foreground" : "border-border text-muted-foreground",
            )}
          >
            {i < paso && <Check className="h-3 w-3" />} {p}
          </li>
        ))}
      </ol>

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100" role="alert">
          {error}
        </p>
      )}

      {paso === 0 && (
        <label
          className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border px-4 py-12 text-center hover:bg-accent/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void elegir(e.dataTransfer.files?.[0]);
          }}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <span className="mt-2 text-sm font-medium">Arrastrá la planilla acá o elegila</span>
          <span className="mt-1 text-xs text-muted-foreground">CSV de hasta 10 MB y {MAX_FILAS_PARTE_1} filas por ahora</span>
          <span className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium">Elegir archivo</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void elegir(e.target.files?.[0])} />
        </label>
      )}

      {paso === 1 && planilla && (
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">Revisamos las primeras 5 filas y sugerimos a qué campo va cada columna. Podés cambiarlo.</p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {planilla.columnas.map((c, i) => (
                    <th key={i} className="p-2 text-left align-top font-medium">
                      <div>{c || `Columna ${i + 1}`}</div>
                      <select
                        aria-label={`Campo de la columna ${c}`}
                        value={mapeo[i]}
                        onChange={(e) => setMapeo((m) => m.map((v, j) => (j === i ? (e.target.value as Campo) : v)))}
                        className="mt-1 w-full rounded border border-input bg-background px-1.5 py-1 text-xs"
                      >
                        {OPCIONES_FIJAS.map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.texto}
                          </option>
                        ))}
                        {camposPropios.map((c) => (
                          <option key={c.slug} value={`campo:${c.slug}`}>
                            Campo propio: {c.name}
                          </option>
                        ))}
                        <option value="no_importar">No importar</option>
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planilla.filas.slice(0, 5).map((f, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {planilla.columnas.map((_, j) => (
                      <td key={j} className="max-w-48 truncate p-2 text-muted-foreground">
                        {f[j] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setPaso(0)} className="rounded-lg border border-input px-3 py-2 text-sm">
              Atrás
            </button>
            <button type="button" onClick={() => setPaso(2)} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              Siguiente
            </button>
          </div>
        </div>
      )}

      {paso === 2 && planilla && (
        <div className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="font-medium">Código de país para los teléfonos sin código</span>
            <input value={codigoPais} onChange={(e) => setCodigoPais(e.target.value.trim())} className="mt-1 block w-32 rounded-lg border border-input bg-background px-3 py-2" />
            <span className="mt-1 block text-xs text-muted-foreground">Solo para esta importación. Las filas que lo usen quedan señaladas en el resumen.</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Etiqueta de origen</span>
            <input value={etiquetaOrigen} onChange={(e) => setEtiquetaOrigen(e.target.value)} className="mt-1 block w-full max-w-sm rounded-lg border border-input bg-background px-3 py-2" />
            <span className="mt-1 block text-xs text-muted-foreground">Se aplica si ya existe una etiqueta con ese nombre; si no, el resumen lo dice.</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Asignar los contactos importados a</span>
            <select value={asignarA} onChange={(e) => setAsignarA(e.target.value)} className="mt-1 block w-full max-w-sm rounded-lg border border-input bg-background px-3 py-2">
              <option value="">Nadie por ahora</option>
              {miembros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.etiqueta}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">Los contactos sin asignar los ven Owner y Admin.</span>
          </label>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium">Cómo se evita duplicar</p>
            <p className="mt-1 text-muted-foreground">
              Si ya existe un contacto con el mismo identificador de Pipedrive, correo o teléfono, se actualiza en lugar de crear otro. Si una fila no tiene ninguno de esos datos, no se importa y se explica por qué.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPaso(1)} className="rounded-lg border border-input px-3 py-2 text-sm">
              Atrás
            </button>
            <button type="button" onClick={() => void importar()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              Importar {filasValidas} filas
            </button>
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="mt-6" role="status">
          <p className="text-sm font-medium">Importando {filasValidas} filas…</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      )}

      {paso === 4 && resultado && (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Creados", resultado.creados],
              ["Actualizados", resultado.actualizados],
              ["Con error", resultado.conError],
              [`Usaron ${codigoPais} por defecto`, resultado.usaronCodigo],
            ].map(([t, n]) => (
              <div key={String(t)} className="rounded-lg border border-border p-3">
                <div className="text-2xl font-bold">{n}</div>
                <div className="text-xs text-muted-foreground">{t}</div>
              </div>
            ))}
          </div>
          {resultado.lineas.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="p-2 font-medium">Fila</th>
                    <th className="p-2 font-medium">Nombre</th>
                    <th className="p-2 font-medium">Qué pasó</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.lineas.map((l) => (
                    <tr key={l.numero} className="border-b border-border last:border-0 align-top">
                      <td className="p-2">{l.numero}</td>
                      <td className="p-2">{l.nombre}</td>
                      <td className="p-2 text-muted-foreground">{l.que}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Se puede repetir: importar el mismo archivo otra vez actualiza, no duplica.</p>
            <Link href="/dashboard/contacts" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              Ver contactos
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
