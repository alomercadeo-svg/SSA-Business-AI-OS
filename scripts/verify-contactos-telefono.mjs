#!/usr/bin/env node
/**
 * Retrabajo de Contactos del 10/11/2026, (b): en el teléfono, con la página
 * recién abierta, el primer contacto de la lista se ve sin desplazar. Contra
 * PRODUCCIÓN, con el WebKit de Playwright de `herramientas-locales/` y el
 * perfil «iPhone 15», en un espacio fantasma (nunca el real). La sesión entra
 * como en `verify-hilo-telefono.mjs`: la cookie de `@supabase/ssr` puesta con
 * `context.addCookies`. No escribe nada más que los tres contactos fantasma.
 *
 * El control: el contacto está en la página (presencia); lo que se mide es si
 * está dentro de la parte visible sin desplazar.
 *
 * Uso: node scripts/verify-contactos-telefono.mjs
 */
import { createRequire } from "node:module";
import { check, correr, crearContacto, crearUsuario, noConcluyente, sufijo, URL_BASE } from "./lib-verificador.mjs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
if (!APP_URL.startsWith("https://")) {
  console.error("NEXT_PUBLIC_APP_URL tiene que ser la dirección https de producción.");
  process.exit(1);
}
const REF = new URL(URL_BASE).hostname.split(".")[0];
let playwright;
try {
  playwright = createRequire(new URL("../herramientas-locales/playwright/package.json", import.meta.url))("playwright");
} catch {
  console.error("Falta Playwright en herramientas-locales/playwright/.");
  process.exit(1);
}
const { webkit, devices } = playwright;

function cookies(u, espacio) {
  const valor = `base64-${Buffer.from(JSON.stringify(u.sesion)).toString("base64url")}`;
  const nombre = `sb-${REF}-auth-token`;
  const partes = [];
  if (valor.length <= 3180) partes.push({ name: nombre, value: valor });
  else for (let i = 0; i * 3180 < valor.length; i++) partes.push({ name: `${nombre}.${i}`, value: valor.slice(i * 3180, (i + 1) * 3180) });
  partes.push({ name: "zernflow_workspace_id", value: espacio });
  return partes.map((c) => ({ ...c, url: APP_URL, sameSite: "Lax", httpOnly: false }));
}

await correr(async () => {
  const u = await crearUsuario("contactos-tel");
  const primero = `Telefono Uno ${sufijo}`;
  const ahora = Date.now();
  await crearContacto(u.espacio, { display_name: primero, last_interaction_at: new Date(ahora - 60_000).toISOString() });
  await crearContacto(u.espacio, { display_name: `Telefono Dos ${sufijo}`, last_interaction_at: new Date(ahora - 120_000).toISOString() });
  await crearContacto(u.espacio, { display_name: `Telefono Tres ${sufijo}`, last_interaction_at: new Date(ahora - 180_000).toISOString() });

  const navegador = await webkit.launch();
  try {
    const ctx = await navegador.newContext({ ...devices["iPhone 15"] });
    await ctx.addCookies(cookies(u, u.espacio));
    const page = await ctx.newPage();
    await page.goto(`${APP_URL}/dashboard/contacts`, { waitUntil: "networkidle" });
    const alto = page.viewportSize()?.height ?? 0;
    const caja = await page.getByText(primero, { exact: true }).first().boundingBox();
    const desplazado = await page.evaluate(() => window.scrollY);
    console.log(`  alto visible ${alto}px · el primer contacto en ${caja ? `${Math.round(caja.y)}–${Math.round(caja.y + caja.height)}px` : "ningún lugar"} · desplazado ${desplazado}px`);
    const presente = check(caja !== null, "presencia: el primer contacto está en la página");
    if (!presente) noConcluyente("el primer contacto se ve sin desplazar", "no está en la página");
    else check(desplazado === 0 && caja.y >= 0 && caja.y + caja.height <= alto, "con la página recién abierta, el primer contacto se ve sin desplazar");
    const filtros = await page.getByRole("button", { name: /^Filtros/ }).first().isVisible().catch(() => false);
    check(filtros, "el botón «Filtros» se ve");
    const orden = await page.getByLabel("Ordenar por").isVisible().catch(() => false);
    check(orden, "«Ordenar por» se ve sin abrir los filtros");
  } finally {
    await navegador.close();
  }
});
