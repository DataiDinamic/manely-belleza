-- =====================================================================
-- Manely Belleza · Esquema fase 1 (negocio, clientas, servicios, agenda)
-- Pegar entero en Supabase > SQL Editor > New query > Run.
-- Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Negocio y personas que trabajan en él
-- (hoy solo Eli; preparado para añadir a su socia sin rehacer nada)
-- ---------------------------------------------------------------------
create table if not exists public.negocios (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  razon_social text,
  nif         text,
  direccion   text,
  cp          text,
  poblacion   text,
  provincia   text,
  telefono    text,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.miembros (
  negocio_id  uuid not null references public.negocios(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rol         text not null default 'propietaria' check (rol in ('propietaria','colaboradora')),
  nombre      text,
  created_at  timestamptz not null default now(),
  primary key (negocio_id, user_id)
);

-- ¿El usuario conectado pertenece a este negocio?
create or replace function public.es_miembro(p_negocio uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.miembros
    where negocio_id = p_negocio and user_id = auth.uid()
  );
$$;

-- Primer acceso: crea el negocio y deja a quien lo crea como propietaria.
create or replace function public.crear_negocio(p_nombre text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión';
  end if;
  select negocio_id into v_id from public.miembros where user_id = auth.uid() limit 1;
  if v_id is not null then
    return v_id;  -- ya tenía negocio
  end if;
  insert into public.negocios (nombre) values (coalesce(nullif(trim(p_nombre),''), 'Mi centro'))
    returning id into v_id;
  insert into public.miembros (negocio_id, user_id, rol) values (v_id, auth.uid(), 'propietaria');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Clientas
-- ---------------------------------------------------------------------
create table if not exists public.clientas (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.negocios(id) on delete cascade,
  nombre        text not null,
  apellidos     text,
  telefono      text,
  email         text,
  nif           text,
  direccion     text,
  cp            text,
  poblacion     text,
  fecha_nacimiento date,
  color         text,                 -- color de la clienta en la agenda
  preferencias  text,                 -- p. ej. "Esmalte Rosa Nude 112, uña almendra corta"
  notas         text,                 -- notas internas
  notas_salud   text,                 -- alergias, sensibilidad… solo con consentimiento
  consentimiento_datos      boolean not null default false,
  consentimiento_salud      boolean not null default false,
  consentimiento_comunicaciones boolean not null default false,
  consentimiento_fecha      timestamptz,
  archivada     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint notas_salud_con_consentimiento
    check (notas_salud is null or notas_salud = '' or consentimiento_salud)
);
create index if not exists clientas_negocio_idx on public.clientas (negocio_id, archivada, nombre);

-- ---------------------------------------------------------------------
-- Servicios (catálogo). Precio con IVA incluido.
-- No se borran: se desactivan, para no romper el histórico.
-- ---------------------------------------------------------------------
create table if not exists public.servicios (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  nombre       text not null,
  categoria    text,
  duracion_min integer not null default 30 check (duracion_min > 0 and duracion_min <= 600),
  precio       numeric(10,2) not null default 0 check (precio >= 0),
  iva_pct      numeric(5,2) not null default 21,
  descripcion  text,
  activo       boolean not null default true,
  orden        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists servicios_negocio_idx on public.servicios (negocio_id, activo, orden);

-- ---------------------------------------------------------------------
-- Citas. La fecha y la hora se guardan "de pared" (hora local del salón),
-- así no hay desfases por zona horaria.
-- ---------------------------------------------------------------------
create table if not exists public.citas (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.negocios(id) on delete cascade,
  clienta_id    uuid not null references public.clientas(id) on delete restrict,
  fecha         date not null,
  hora_inicio   time not null,
  duracion_min  integer not null check (duracion_min > 0 and duracion_min <= 720),
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','confirmada','realizada','anulada','no_presentada')),
  notas         text,
  motivo_anulacion text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists citas_negocio_fecha_idx on public.citas (negocio_id, fecha, hora_inicio);
create index if not exists citas_clienta_idx on public.citas (clienta_id, fecha desc);

-- Servicios de cada cita, con nombre/precio/duración COPIADOS en el momento:
-- si mañana cambia una tarifa, las citas antiguas no cambian.
create table if not exists public.cita_servicios (
  id           uuid primary key default gen_random_uuid(),
  cita_id      uuid not null references public.citas(id) on delete cascade,
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  servicio_id  uuid references public.servicios(id) on delete set null,
  nombre       text not null,
  precio       numeric(10,2) not null default 0,
  iva_pct      numeric(5,2) not null default 21,
  duracion_min integer not null default 0,
  orden        integer not null default 0
);
create index if not exists cita_servicios_cita_idx on public.cita_servicios (cita_id);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['negocios','clientas','servicios','citas'] loop
    execute format('drop trigger if exists %I_updated on public.%I', t, t);
    execute format('create trigger %I_updated before update on public.%I
                    for each row execute function public.tocar_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Guardar una cita con sus servicios de una vez (todo o nada)
-- p_cita:      {"id": null|uuid, "clienta_id":…, "fecha":"2026-10-19",
--               "hora_inicio":"10:30", "estado":"pendiente", "notas":"…"}
-- p_servicios: [{"servicio_id":uuid|null, "nombre":"…", "precio":25,
--               "iva_pct":21, "duracion_min":45}, …]
-- ---------------------------------------------------------------------
create or replace function public.guardar_cita(p_negocio uuid, p_cita jsonb, p_servicios jsonb)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_id   uuid := nullif(p_cita->>'id','')::uuid;
  v_dur  integer;
  s      jsonb;
  i      integer := 0;
begin
  if not public.es_miembro(p_negocio) then
    raise exception 'Sin permiso sobre este negocio';
  end if;
  if jsonb_array_length(coalesce(p_servicios,'[]'::jsonb)) = 0 then
    raise exception 'La cita necesita al menos un servicio';
  end if;

  select coalesce(sum((x->>'duracion_min')::int), 0) into v_dur
  from jsonb_array_elements(p_servicios) x;
  v_dur := coalesce(nullif(p_cita->>'duracion_min','')::int, v_dur);
  if v_dur <= 0 then v_dur := 30; end if;

  if v_id is null then
    insert into public.citas (negocio_id, clienta_id, fecha, hora_inicio, duracion_min, estado, notas)
    values (p_negocio,
            (p_cita->>'clienta_id')::uuid,
            (p_cita->>'fecha')::date,
            (p_cita->>'hora_inicio')::time,
            v_dur,
            coalesce(nullif(p_cita->>'estado',''),'pendiente'),
            nullif(p_cita->>'notas',''))
    returning id into v_id;
  else
    update public.citas set
      clienta_id   = (p_cita->>'clienta_id')::uuid,
      fecha        = (p_cita->>'fecha')::date,
      hora_inicio  = (p_cita->>'hora_inicio')::time,
      duracion_min = v_dur,
      estado       = coalesce(nullif(p_cita->>'estado',''), estado),
      notas        = nullif(p_cita->>'notas','')
    where id = v_id and negocio_id = p_negocio;
    if not found then raise exception 'Cita no encontrada'; end if;
    delete from public.cita_servicios where cita_id = v_id;
  end if;

  for s in select * from jsonb_array_elements(p_servicios) loop
    insert into public.cita_servicios (cita_id, negocio_id, servicio_id, nombre, precio, iva_pct, duracion_min, orden)
    values (v_id, p_negocio,
            nullif(s->>'servicio_id','')::uuid,
            coalesce(s->>'nombre','Servicio'),
            coalesce((s->>'precio')::numeric, 0),
            coalesce((s->>'iva_pct')::numeric, 21),
            coalesce((s->>'duracion_min')::int, 0),
            i);
    i := i + 1;
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Seguridad: cada fila solo la ve y toca quien pertenece a su negocio
-- ---------------------------------------------------------------------
alter table public.negocios       enable row level security;
alter table public.miembros       enable row level security;
alter table public.clientas       enable row level security;
alter table public.servicios      enable row level security;
alter table public.citas          enable row level security;
alter table public.cita_servicios enable row level security;

drop policy if exists negocios_ver on public.negocios;
create policy negocios_ver on public.negocios for select to authenticated using (public.es_miembro(id));
drop policy if exists negocios_editar on public.negocios;
create policy negocios_editar on public.negocios for update to authenticated
  using (public.es_miembro(id)) with check (public.es_miembro(id));

drop policy if exists miembros_ver on public.miembros;
create policy miembros_ver on public.miembros for select to authenticated using (public.es_miembro(negocio_id));

do $$
declare t text;
begin
  foreach t in array array['clientas','servicios','citas','cita_servicios'] loop
    execute format('drop policy if exists %I_todo on public.%I', t, t);
    execute format('create policy %I_todo on public.%I for all to authenticated
                    using (public.es_miembro(negocio_id))
                    with check (public.es_miembro(negocio_id))', t, t);
  end loop;
end $$;

-- Nadie sin sesión puede leer ni escribir nada
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.clientas, public.servicios, public.citas, public.cita_servicios to authenticated;
grant select, update on public.negocios to authenticated;
grant select on public.miembros to authenticated;
grant execute on function public.crear_negocio(text), public.guardar_cita(uuid, jsonb, jsonb), public.es_miembro(uuid) to authenticated;
revoke execute on function public.crear_negocio(text), public.guardar_cita(uuid, jsonb, jsonb) from anon, public;
