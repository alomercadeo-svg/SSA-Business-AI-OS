"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_BYTES, leerCsv, sugerirCampo, type Campo, type Planilla } from "@/lib/importacion-csv";
import { FILAS_POR_TANDA, LIMITE_EN_EL_MOMENTO, MAX_FILAS } from "@/lib/importacion-segundo-plano";
import type { ResumenDeImportacion } from "@/lib/importacion-progreso";
import type { Miembro } from "@/lib/miembros";

/**
 * F37 (09/11/2026, y la parte 2 del 10/11/2026): la pantalla de cinco pasos
 * de §11 (Archivo, Columnas, Opciones, Importando, Resumen), hasta 10 MB y
 * 10.000 filas. El archivo se lee en el navegador para la vista previa y el
 * mapeo, y se sube en tandas de 500 filas (`POST
 * /api/v1/contacts/importar/tandas`); el servidor vuelve a preparar cada fila.
 * Hasta 500 filas se procesa en el momento; con más, en segundo plano, y llega
 * un correo al terminar. La barra sale de lo que el servidor ya procesó
 * (`GET /api/v1/contacts/importar/<id>`).
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
  // F38: la migración desde Pipedrive (§11, paso 2: «etapa, estado del trato,
  // valor, identificador de Pipedrive»; el motivo de pérdida, a la nota).
  { valor: "etapa", texto: "Etapa" },
  { valor: "estado_trato", texto: "Estado del trato" },
  { valor: "valor", texto: "Valor del trato" },
  { valor: "moneda", texto: "Moneda" },
  { valor: "fecha_cierre", texto: "Fecha de cierre" },
  { valor: "pipedrive_trato", texto: "Id de trato de Pipedrive" },
  { valor: "nota", texto: "Nota del contacto" },
];

type Resultado = ResumenDeImportacion & {
  control?: { medido: true; enArchivo: number; encontrados: number; enEspacio: number } | { medido: false } | null;
};

const TANDAS_URL = "/api/v1/contacts/importar/tandas";

async function pedir(cuerpo: Record<string, unknown>): Promise<{ ok: boolean; status: number; datos: Record<string, unknown> | null }> {
  const res = await fetch(TANDAS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  return { ok: res.ok, status: res.status, datos: await res.json().catch(() => null) };
}

export function ImportarContactos({
  camposPropios,
  miembros,
  importacionInicial = null,
}: {
  camposPropios: { slug: string; name: string }[];
  miembros: Miembro[];
  /** Desde el correo de fin de importación: `?importacion=<id>`. */
  importacionInicial?: string | null;
}) {
  const [paso, setPaso] = useState(importacionInicial ? 3 : 0);
  const [archivo, setArchivo] = useState<string>("");
  const [planilla, setPlanilla] = useState<Planilla | null>(null);
  const [mapeo, setMapeo] = useState<Campo[]>([]);
  const [codigoPais, setCodigoPais] = useState("+506");
  const [etiquetaOrigen, setEtiquetaOrigen] = useState(() => `Importado ${new Date().toLocaleDateString("es-CR")}`);
  const [asignarA, setAsignarA] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [avance, setAvance] = useState<Resultado | null>(null);
  const [subiendo, setSubiendo] = useState<{ hecho: number; total: number } | null>(null);
  const [segundoPlano, setSegundoPlano] = useState(false);
  const seguido = useRef<string | null>(null);

  /** Pregunta el avance cada 2 segundos hasta que termina (o falla). */
  function seguir(id: string) {
    seguido.current = id;
    const vuelta = async () => {
      if (seguido.current !== id) return;
      try {
        const res = await fetch(`/api/v1/contacts/importar/${encodeURIComponent(id)}`, { cache: "no-store" });
        const datos = (await res.json().catch(() => null)) as Resultado | null;
        if (res.ok && datos) {
          setAvance(datos);
          setSegundoPlano(datos.enSegundoPlano);
          if (datos.terminada || datos.fallida) {
            seguido.current = null;
            setResultado(datos);
            setPaso(4);
            return;
          }
        } else if (res.status === 404) {
          seguido.current = null;
          setError("Esa importación no existe.");
          setPaso(0);
          return;
        }
      } catch {
        // Sin red por un momento: se vuelve a preguntar.
      }
      setTimeout(vuelta, 2000);
    };
    void vuelta();
  }

  useEffect(() => {
    if (importacionInicial) seguir(importacionInicial);
    return () => {
      seguido.current = null;
    };
    // Solo al abrir la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function elegir(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("El archivo pasa de 10 MB.");
    const p = leerCsv(await f.text());
    if (p.columnas.length === 0 || p.filas.length === 0) return setError("La planilla no tiene filas para importar.");
    if (p.filas.length > MAX_FILAS) return setError(`Tiene ${p.filas.length} filas. Hasta 10.000 filas por importación.`);
    setArchivo(f.name);
    setPlanilla(p);
    setMapeo(p.columnas.map((c) => sugerirCampo(c, camposPropios)));
    setPaso(1);
  }

  async function importar() {
    if (!planilla) return;
    setPaso(3);
    setError(null);
    setAvance(null);
    const volver = (texto: string) => {
      seguido.current = null;
      setSubiendo(null);
      setError(texto);
      setPaso(2);
    };
    const filas = planilla.filas.map((f) => planilla.columnas.map((_, i) => f[i] ?? ""));
    try {
      const inicio = await pedir({
        accion: "empezar",
        nombreArchivo: archivo,
        codigoPais,
        asignarA: asignarA || null,
        etiquetaOrigen: etiquetaOrigen.trim() || null,
        mapeo,
        total: filas.length,
      });
      const id = inicio.datos?.importacion;
      if (!inicio.ok || typeof id !== "string") return volver(String(inicio.datos?.error ?? "No se pudo importar. Probá de nuevo."));
      setSegundoPlano(Boolean(inicio.datos?.enSegundoPlano));
      const tandas = Math.ceil(filas.length / FILAS_POR_TANDA);
      for (let n = 0; n < tandas; n++) {
        setSubiendo({ hecho: n, total: tandas });
        const cuerpo = { accion: "tanda", importacion: id, numero: n, filas: filas.slice(n * FILAS_POR_TANDA, (n + 1) * FILAS_POR_TANDA) };
        // Un reintento por tanda: repetirla la reemplaza, no la duplica.
        let r = await pedir(cuerpo);
        if (!r.ok && r.status >= 500) r = await pedir(cuerpo);
        if (!r.ok) return volver(String(r.datos?.error ?? "No se pudo subir el archivo. Probá de nuevo."));
      }
      setSubiendo(null);
      // Hasta 500 filas el pedido espera el proceso; la barra se sigue igual.
      seguir(id);
      const fin = await pedir({ accion: "procesar", importacion: id });
      if (!fin.ok && fin.status !== 202) {
        // Si el pedido se cortó pero la importación sigue en el servidor, la
        // barra lo va a mostrar; solo un rechazo claro vuelve atrás.
        if (fin.status < 500 && fin.status !== 0) return volver(String(fin.datos?.error ?? "No se pudo importar. Probá de nuevo."));
      }
    } catch {
      // Un corte de red mientras procesa no quiere decir que falló: la barra
      // sigue preguntando. Si todavía no había empezado, vuelve atrás.
      if (!seguido.current) volver("No se pudo importar. Probá de nuevo.");
    }
  }

  const filasValidas = planilla?.filas.length ?? 0;
  /** Lo que el servidor ya procesó, de 0 a 100. */
  const porcentaje = avance?.porcentaje ?? 0;

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
          <span className="mt-1 text-xs text-muted-foreground">CSV de hasta 10 MB. Hasta 10.000 filas por importación; con más de {LIMITE_EN_EL_MOMENTO}, se importa en segundo plano y te avisamos por correo.</span>
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
            <span className="mt-1 block text-xs text-muted-foreground">Se pone en todos los contactos importados. Si no existe, se crea.</span>
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
        <div className="mt-6" role="status" aria-live="polite">
          {subiendo ? (
            <>
              <p className="text-sm font-medium">
                Subiendo el archivo: parte {subiendo.hecho + 1} de {subiendo.total}…
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.floor((subiendo.hecho / subiendo.total) * 100)}%` }} />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">
                {avance ? `Importando: ${avance.procesadas} de ${avance.filas} filas (${avance.porcentaje} %)` : `Importando ${filasValidas || ""} filas…`}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${porcentaje}%` }} />
              </div>
              {avance && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {avance.creados} creados · {avance.actualizados} actualizados · {avance.conError} con error
                </p>
              )}
            </>
          )}
          {(segundoPlano || (filasValidas > LIMITE_EN_EL_MOMENTO && !importacionInicial)) && (
            <p className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Son más de {LIMITE_EN_EL_MOMENTO} filas: se importan en segundo plano. Podés cerrar esta pantalla; te avisamos por correo cuando termine.
            </p>
          )}
        </div>
      )}

      {paso === 4 && resultado && (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Creados", resultado.creados],
              ["Actualizados", resultado.actualizados],
              ["Con error", resultado.conError],
              ["Usaron el código de país por defecto", resultado.usaronCodigo],
            ].map(([t, n]) => (
              <div key={String(t)} className="rounded-lg border border-border p-3">
                <div className="text-2xl font-bold">{n}</div>
                <div className="text-xs text-muted-foreground">{t}</div>
              </div>
            ))}
          </div>
          {resultado.fallida && (
            <p className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive" role="alert">
              {resultado.error ?? "La importación no se pudo terminar."} Hasta ahí quedó lo que dicen los números. Podés volver a importar el mismo archivo: no duplica.
            </p>
          )}
          {resultado.control && !resultado.control.medido && (
            <p className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              No se pudo contar el control de la migración. La importación se hizo; volvé a importar el mismo archivo para medirlo (no duplica).
            </p>
          )}
          {resultado.control?.medido && (
            <div
              className={cn(
                "mt-3 rounded-lg border p-3 text-sm",
                resultado.control.encontrados === resultado.control.enArchivo ? "border-border" : "border-destructive/40",
              )}
            >
              <p className="font-medium">
                Control de la migración: {resultado.control.encontrados} de {resultado.control.enArchivo} tratos
                {resultado.control.encontrados < resultado.control.enArchivo && (
                  <span className="text-destructive"> · Faltan {resultado.control.enArchivo - resultado.control.encontrados}</span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Los contactos con identificador de trato de Pipedrive coinciden con los tratos del archivo (sin contar los «IG DM»). Si no coincidieran, la
                migración no se da por buena: la tabla de abajo dice qué filas no entraron y por qué.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">En todo el espacio hay {resultado.control.enEspacio} contactos con un trato de Pipedrive.</p>
            </div>
          )}
          {resultado.etiquetasCreadas?.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">Etiquetas creadas: {resultado.etiquetasCreadas.join(", ")}</p>
          )}
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
