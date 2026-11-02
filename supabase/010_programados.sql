-- =====================================================================
-- Manely Belleza · Mensajes programados (versión 0.10)
-- «Añadir aviso»: la app avisa (con sonido) a la hora elegida para mandar
-- un mensaje ya preparado a una clienta. Lista de tareas en Avisos.
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
create table if not exists public.mensajes_programados (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references public.negocios(id) on delete cascade,
  clienta_id  uuid not null references public.clientas(id) on delete cascade,
  cita_id     uuid references public.citas(id) on delete cascade,
  texto       text not null,
  medio       text not null default 'whatsapp' check (medio in ('whatsapp','sms')),
  avisar_en   timestamptz not null,
  activo      boolean not null default true,
  enviado_en  timestamptz,
  creado_por  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists mensajes_programados_idx on public.mensajes_programados (negocio_id, avisar_en);

alter table public.mensajes_programados enable row level security;
drop policy if exists mensajes_programados_todo on public.mensajes_programados;
create policy mensajes_programados_todo on public.mensajes_programados for all to authenticated
  using (public.es_miembro(negocio_id)) with check (public.es_miembro(negocio_id));
revoke all on public.mensajes_programados from anon;
grant select, insert, update, delete on public.mensajes_programados to authenticated;
