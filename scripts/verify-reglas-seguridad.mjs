#!/usr/bin/env node
/**
 * F33: `channels.safety_config` (00055) en PRODUCCIÓN, en un espacio fantasma
 * que el script crea y borra. No envía nada (el motor es de la Fase 2).
 *
 * LO QUE SE MIRA, contra la base con la sesión de cada usuario:
 *   1. Un canal de WhatsApp nuevo nace con los valores por defecto aprobados
 *      (presencia de la columna y de su valor).
 *   2. El Owner cambia el corte con el silencio a 4 y se relee (control
 *      positivo de que la escritura con sesión funciona).
 *   3. Un Member intenta cambiarlo: la política «channels: editar solo
 *      manager» lo frena (cero filas) y el valor sigue en 4.
 *   4. La base rechaza un valor que no es un objeto (el `check` de la 00055).
 *
 * LO QUE NO MIRA, y por qué: la validación de cada regla y el registro en el
 * historial los hace la acción de servidor de la pantalla, que Next expone con
 * un identificador interno que un script no puede llamar. Los prueban
 * `lib/actions/reglas-seguridad.test.ts` y Marcos en la pantalla.
 *
 * EL ROJO, antes de la 00055: la columna no existe (rojo de carga, no cuenta);
 * el rojo por su motivo se vio en `lib/reglas-seguridad.test.ts` y en los tests
 * de la acción y de la pantalla.
 *
 * Uso: node scripts/verify-reglas-seguridad.mjs
 */
import { admin, check, comoUsuario, correr, crearUsuario, limpiar, noConcluyente, sufijo, sumarAlEspacio } from "./lib-verificador.mjs";

const DEFECTO = {
  corte_silencio: { activo: true, seguimientos: 3 },
  texto_variable: { rotar: true, aviso_desde: 20 },
  espaciado: { activo: true, min_segundos: 45, max_segundos: 180 },
  horario: { activo: true, desde: "08:00", hasta: "20:00", dias: [1, 2, 3, 4, 5, 6] },
  proporcion: { umbral_porcentaje: 15, muestra: 50 },
};

let paso = 0;
const titulo = (t) => console.log(`\n${++paso}. ${t}`);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await correr(async () => {
  const owner = await crearUsuario("f33-owner");
  const member = await crearUsuario("f33-member");
  const espacio = owner.espacio;
  await sumarAlEspacio(espacio, member, "member");

  titulo("Un canal de WhatsApp nuevo nace con los valores por defecto");
  const canal = (
    await admin("channels", {
      method: "POST",
      body: JSON.stringify({ workspace_id: espacio, platform: "whatsapp", provider: "evolution", instance_name: `v-f33-${sufijo}`, is_active: false, umbral_silencio_horas: null }),
    })
  ).data?.[0];
  if (!canal?.id) throw new Error("no se pudo crear el canal fantasma");
  limpiar.canales.push(canal.id);
  const leer = async () => (await admin(`channels?select=safety_config&id=eq.${canal.id}`)).data?.[0]?.safety_config;
  const presencia = check(igual(await leer(), DEFECTO), "safety_config con los valores por defecto aprobados", JSON.stringify(await leer()));

  titulo("El Owner cambia el corte con el silencio a 4 (control positivo)");
  const cuatro = { ...DEFECTO, corte_silencio: { activo: true, seguimientos: 4 } };
  const rO = await comoUsuario(owner.token, `channels?id=eq.${canal.id}`, { method: "PATCH", body: JSON.stringify({ safety_config: cuatro }) });
  const okOwner = check(rO.status < 300 && (rO.data ?? []).length === 1 && igual(await leer(), cuatro), "el Owner guardó y se relee 4", `HTTP ${rO.status}`);

  titulo("Un Member no puede cambiarlo");
  const rM = await comoUsuario(member.token, `channels?id=eq.${canal.id}`, { method: "PATCH", body: JSON.stringify({ safety_config: DEFECTO }) });
  if (!okOwner || !presencia) noConcluyente("el Member no puede cambiarlo", "falló el control positivo del Owner o la presencia");
  else check((rM.data ?? []).length === 0 && igual(await leer(), cuatro), "cero filas para el Member, y sigue en 4", `HTTP ${rM.status} ${JSON.stringify(rM.data)}`);

  titulo("La base rechaza un valor que no es un objeto");
  const rX = await admin(`channels?id=eq.${canal.id}`, { method: "PATCH", body: JSON.stringify({ safety_config: "no es un objeto" }) });
  check(rX.status >= 400 && igual(await leer(), cuatro), "rechazado por el check, y sigue en 4", `HTTP ${rX.status}`);
});
