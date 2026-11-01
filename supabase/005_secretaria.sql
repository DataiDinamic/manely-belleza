-- =====================================================================
-- Manely Belleza · Secretaria (versión 0.6)
-- Gastos fijos y obligaciones del negocio (luz, alquiler, cuota de
-- autónomos, papeles al gestor…) que se repiten, con su aviso previo,
-- y aviso previo en las citas.
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- Solo AÑADE: no borra datos. Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Aviso previo en las citas (minutos antes; vacío = sin aviso)
-- ---------------------------------------------------------------------
alter table public.citas add column if not exists aviso_min integer
  check (aviso_min is null or aviso_min between 0 and 43200);

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
    insert into public.citas (negocio_id, clienta_id, fecha, hora_inicio, duracion_min, estado, notas, aviso_min)
    values (p_negocio,
            (p_cita->>'clienta_id')::uuid,
            (p_cita->>'fecha')::date,
            (p_cita->>'hora_inicio')::time,
            v_dur,
            coalesce(nullif(p_cita->>'estado',''),'pendiente'),
            nullif(p_cita->>'notas',''),
            nullif(p_cita->>'aviso_min','')::int)
    returning id into v_id;
  else
    update public.citas set
      clienta_id   = (p_cita->>'clienta_id')::uuid,
      fecha        = (p_cita->>'fecha')::date,
      hora_inicio  = (p_cita->>'hora_inicio')::time,
      duracion_min = v_dur,
      estado       = coalesce(nullif(p_cita->>'estado',''), estado),
      notas        = nullif(p_cita->>'notas',''),
      aviso_min    = case when p_cita ? 'aviso_min' then nullif(p_cita->>'aviso_min','')::int else aviso_min end
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
-- Gastos fijos y obligaciones
--   tipo gasto: se paga (luz, alquiler…), con importe aproximado
--   tipo tarea: hay que hacerlo (llevar papeles al gestor, revisar…)
--   repetición: una_vez, dias, semanas, meses o anios, «cada» N
--   La primera fecha marca el día (p. ej. el 5 de cada mes)
-- ---------------------------------------------------------------------
create table if not exists public.obligaciones (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  nombre         text not null,
  tipo           text not null default 'gasto' check (tipo in ('gasto','tarea')),
  categoria      text,
  proveedor      text,
  importe        numeric(10,2) check (importe is null or importe >= 0),   -- aproximado, IVA incluido
  repeticion     text not null default 'meses' check (repeticion in ('una_vez','dias','semanas','meses','anios')),
  cada           integer not null default 1 check (cada between 1 and 365),
  fecha_inicio   date not null,
  fecha_fin      date,
  hora           time not null default '10:00',
  aviso_cantidad integer check (aviso_cantidad is null or aviso_cantidad between 0 and 1000),  -- vacío = sin aviso
  aviso_unidad   text not null default 'dias' check (aviso_unidad in ('minutos','horas','dias','semanas')),
  notas          text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists obligaciones_negocio_idx on public.obligaciones (negocio_id, activo);

drop trigger if exists obligaciones_updated on public.obligaciones;
create trigger obligaciones_updated before update on public.obligaciones
  for each row execute function public.tocar_updated_at();

-- Cada vez que se paga o se hace (o se salta) una de las fechas
create table if not exists public.obligacion_registros (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references public.negocios(id) on delete cascade,
  obligacion_id   uuid not null references public.obligaciones(id) on delete restrict,
  fecha_prevista  date not null,                 -- la fecha que tocaba
  fecha           date not null,                 -- cuándo se pagó o se hizo
  estado          text not null default 'hecho' check (estado in ('hecho','omitido')),
  importe         numeric(10,2) check (importe is null or importe >= 0),
  notas           text,
  creado_por      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (obligacion_id, fecha_prevista)
);
create index if not exists obligacion_reg_idx on public.obligacion_registros (negocio_id, fecha);

-- El registro tiene que ser del mismo negocio que su obligación
create or replace function public.comprobar_registro_obligacion()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.obligaciones o where o.id = new.obligacion_id and o.negocio_id = new.negocio_id) then
    raise exception 'Gasto u obligación no encontrado';
  end if;
  return new;
end; $$;
drop trigger if exists obligacion_reg_comprobar on public.obligacion_registros;
create trigger obligacion_reg_comprobar before insert or update on public.obligacion_registros
  for each row execute function public.comprobar_registro_obligacion();

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
alter table public.obligaciones enable row level security;
alter table public.obligacion_registros enable row level security;

drop policy if exists obligaciones_todo on public.obligaciones;
create policy obligaciones_todo on public.obligaciones for all to authenticated
  using (public.es_miembro(negocio_id)) with check (public.es_miembro(negocio_id));
drop policy if exists obligacion_reg_todo on public.obligacion_registros;
create policy obligacion_reg_todo on public.obligacion_registros for all to authenticated
  using (public.es_miembro(negocio_id)) with check (public.es_miembro(negocio_id));

revoke all on public.obligaciones, public.obligacion_registros from anon;
grant select, insert, update, delete on public.obligaciones, public.obligacion_registros to authenticated;
