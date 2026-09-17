#!/usr/bin/env node
/**
 * Verifica qué secretos de Evolution están guardados en Vault. Sin mostrarlos.
 *
 * Imprime, por cada uno: si está presente y cuántos caracteres tiene. Con eso
 * alcanza para responder "¿lo guardé?" y "¿guardé lo que creía?", que son las
 * dos preguntas reales, sin convertir la verificación en una fuga.
 *
 * Uso:
 *   node scripts/verify-evolution-secrets.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, "../.env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const CABECERAS = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

const ESPERADOS = [
  {
    nombre: "evolution_api_key",
    para: "clave global del servidor de Evolution (AUTHENTICATION_API_KEY)",
    obligatorio: true,
  },
  {
    nombre: "evolution_webhook_secret",
    para: "el jwt_key con el que Evolution firma cada entrega",
    obligatorio: true,
  },
  {
    nombre: "evolution_webhook_secret_previous",
    para: "el anterior. Solo durante una rotación: fuera de ella debería estar ausente",
    obligatorio: false,
  },
];

async function leer(nombre, workspaceId) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/read_secret`, {
    method: "POST",
    headers: CABECERAS,
    body: JSON.stringify({ secret_name: nombre, workspace_id: workspaceId }),
  });
  if (!r.ok) return { error: `${r.status}` };
  const texto = await r.text();
  const valor = texto ? JSON.parse(texto) : null;
  return { largo: typeof valor === "string" ? valor.length : null };
}

async function main() {
  const r = await fetch(`${URL_BASE}/rest/v1/workspaces?select=id,name`, { headers: CABECERAS });
  const workspaces = await r.json();
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    console.error("No hay ningún workspace en la base.");
    process.exit(1);
  }

  let faltan = 0;

  for (const ws of workspaces) {
    console.log(`\nWorkspace: ${ws.name} (${ws.id})\n`);

    for (const { nombre, para, obligatorio } of ESPERADOS) {
      const { largo, error } = await leer(nombre, ws.id);

      if (error) {
        console.log(`  ERROR ${nombre}: la consulta falló con ${error}`);
        faltan++;
        continue;
      }
      if (largo === null) {
        console.log(`  ${obligatorio ? "FALTA" : "  --  "} ${nombre}: ausente`);
        console.log(`        ${para}`);
        if (obligatorio) faltan++;
        continue;
      }
      console.log(`  ok    ${nombre}: presente, ${largo} caracteres`);
      if (!obligatorio) {
        console.log(
          `        OJO: hay una rotación a medio terminar. Si Evolution ya firma\n` +
          `        con el nuevo, borrá este. Si no, todavía no.`
        );
      }
    }

    // Los tokens de instancia se nombran por canal, así que se listan aparte.
    const canales = await fetch(
      `${URL_BASE}/rest/v1/channels?select=id,instance_name&provider=eq.evolution&workspace_id=eq.${ws.id}`,
      { headers: CABECERAS }
    ).then((res) => res.json());

    if (Array.isArray(canales) && canales.length > 0) {
      console.log("");
      for (const canal of canales) {
        const nombre = `evolution_instance_token:${canal.id}`;
        const { largo } = await leer(nombre, ws.id);
        const etiqueta = canal.instance_name ?? "(sin nombre de instancia)";
        if (largo === null) {
          console.log(`  FALTA token de la instancia "${etiqueta}": ausente`);
          faltan++;
        } else {
          console.log(`  ok    token de la instancia "${etiqueta}": presente, ${largo} caracteres`);
        }
      }
    } else {
      console.log(`\n  --    todavía no hay ningún canal de Evolution en este workspace`);
    }
  }

  console.log(
    faltan === 0
      ? "\nTodos los secretos obligatorios están guardados.\n"
      : `\n${faltan} secreto(s) obligatorio(s) sin guardar.\n`
  );
  process.exit(faltan === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`Falló: ${err.message}`);
  process.exit(1);
});
