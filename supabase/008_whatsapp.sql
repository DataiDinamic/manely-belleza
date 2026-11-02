-- =====================================================================
-- Manely Belleza · ¿Tiene WhatsApp? (versión 0.8.2)
-- Marca en cada clienta si tiene WhatsApp. Las que ya existen quedan
-- como que sí lo tienen; se cambia desde «Editar ficha».
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
alter table public.clientas add column if not exists whatsapp boolean default true;
