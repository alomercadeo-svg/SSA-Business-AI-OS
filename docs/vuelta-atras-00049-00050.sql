-- ============================================================
-- VUELTA ATRÁS DE LA 00049 Y LA 00050 (F43, S9 tramo B, 05/11/2026)
-- ============================================================
-- NO SE APLICÓ. Queda escrita por si hiciera falta deshacer la lista de
-- contactos en el servidor: borra las tres funciones que crea la 00049
-- (contactos_filtrados, contactos_pagina y contactos_cantidad), y con eso
-- deshace también la 00050, que solo reemplaza contactos_filtrados.
--
-- Vive en docs/ y no en supabase/migrations/ a propósito: ahí la aplicaría
-- el próximo `supabase db push`. Antes de aplicarla, el código que llama a
-- estas funciones (lib/contactos.ts, la página de Contactos y
-- GET /api/v1/contacts) tiene que haber vuelto atrás, o la lista se cae.
-- ============================================================
drop function if exists public.contactos_cantidad(uuid, jsonb);
drop function if exists public.contactos_pagina(uuid, jsonb, integer, integer);
drop function if exists public.contactos_filtrados(uuid, jsonb);
