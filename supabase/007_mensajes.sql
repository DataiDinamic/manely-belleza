-- =====================================================================
-- Manely Belleza · Mensajes de WhatsApp (versión 0.8.1)
-- Guarda los mensajes predefinidos en el negocio, para que sean iguales
-- en la tablet, el móvil y el ordenador.
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
alter table public.negocios add column if not exists mensajes jsonb not null default '{}'::jsonb;
