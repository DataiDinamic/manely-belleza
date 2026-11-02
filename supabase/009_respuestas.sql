-- =====================================================================
-- Manely Belleza · Confirmación de la clienta (versión 0.9)
-- Cada cita tiene un enlace propio (secreto) que se manda por WhatsApp.
-- Con él, la clienta ve su cita, responde «Asistiré» o «No podré ir» y
-- la añade a su calendario, sin entrar en la app.
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================

-- Enlace secreto de cada cita (las que ya existen también reciben uno)
alter table public.citas add column if not exists token uuid not null default gen_random_uuid();
create unique index if not exists citas_token_idx on public.citas (token);
-- (al recuperar una copia antigua sin enlace, se crea uno)
create or replace function public.poner_token_cita()
returns trigger language plpgsql as $$
begin
  if new.token is null then new.token := gen_random_uuid(); end if;
  return new;
end; $$;
drop trigger if exists citas_token on public.citas;
create trigger citas_token before insert on public.citas
  for each row execute function public.poner_token_cita();

-- Respuesta de la clienta
alter table public.citas add column if not exists respuesta text;
alter table public.citas drop constraint if exists citas_respuesta_check;
alter table public.citas add constraint citas_respuesta_check check (respuesta is null or respuesta in ('si','no'));
alter table public.citas add column if not exists respuesta_en timestamptz;

-- Si la cita cambia de día u hora, la respuesta anterior deja de valer
create or replace function public.borrar_respuesta_si_cambia()
returns trigger language plpgsql as $$
begin
  if new.fecha is distinct from old.fecha or new.hora_inicio is distinct from old.hora_inicio then
    new.respuesta := null;
    new.respuesta_en := null;
  end if;
  return new;
end; $$;
drop trigger if exists citas_respuesta_cambio on public.citas;
create trigger citas_respuesta_cambio before update on public.citas
  for each row execute function public.borrar_respuesta_si_cambia();

-- ---------------------------------------------------------------------
-- Lo que ve la clienta con su enlace (solo lo imprescindible)
-- ---------------------------------------------------------------------
create or replace function public.ver_cita_publica(p_token uuid)
returns jsonb
language sql security definer stable
set search_path = public
as $$
  select jsonb_build_object(
    'fecha', c.fecha,
    'hora', to_char(c.hora_inicio, 'HH24:MI'),
    'duracion_min', c.duracion_min,
    'estado', c.estado,
    'respuesta', c.respuesta,
    'nombre', cl.nombre,
    'servicios', coalesce((select jsonb_agg(cs.nombre order by cs.orden) from public.cita_servicios cs where cs.cita_id = c.id), '[]'::jsonb),
    'negocio', n.nombre,
    'direccion', nullif(concat_ws(', ', nullif(n.direccion,''), nullif(trim(concat_ws(' ', n.cp, n.poblacion)),'')), ''),
    'telefono', n.telefono)
  from public.citas c
  join public.clientas cl on cl.id = c.clienta_id
  join public.negocios n on n.id = c.negocio_id
  where c.token = p_token;
$$;

-- La clienta responde: «si» confirma la cita; «no» avisa a Eli (la cita no se anula sola)
create or replace function public.responder_cita(p_token uuid, p_respuesta text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if p_respuesta not in ('si','no') then
    raise exception 'Respuesta no válida';
  end if;
  update public.citas set
    respuesta = p_respuesta,
    respuesta_en = now(),
    estado = case when p_respuesta = 'si' and estado = 'pendiente' then 'confirmada' else estado end
  where token = p_token
    and estado in ('pendiente','confirmada')
    and fecha >= (now() at time zone 'Europe/Madrid')::date;
  if not found then
    raise exception 'Esta cita ya no se puede cambiar. Escríbenos por WhatsApp.';
  end if;
  return public.ver_cita_publica(p_token);
end;
$$;

revoke all on function public.ver_cita_publica(uuid), public.responder_cita(uuid, text) from public;
grant execute on function public.ver_cita_publica(uuid), public.responder_cita(uuid, text) to anon, authenticated;
