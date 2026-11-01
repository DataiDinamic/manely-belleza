-- =====================================================================
-- Manely Belleza · Fase 2: CAJA (productos, cobros, cierres de caja)
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- Solo AÑADE tablas y funciones nuevas: no toca ni borra los datos
-- existentes (clientas, servicios, citas). Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Productos que se venden (esmaltes, cremas…). Precio con IVA incluido.
-- stock vacío = no se controla el stock de ese producto.
-- ---------------------------------------------------------------------
create table if not exists public.productos (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references public.negocios(id) on delete cascade,
  nombre      text not null,
  marca       text,
  categoria   text,
  codigo      text,
  precio      numeric(10,2) not null default 0 check (precio >= 0),
  iva_pct     numeric(5,2)  not null default 21,
  coste       numeric(10,2) check (coste is null or coste >= 0),
  stock       integer,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists productos_negocio_idx on public.productos (negocio_id, activo, nombre);

drop trigger if exists productos_updated on public.productos;
create trigger productos_updated before update on public.productos
  for each row execute function public.tocar_updated_at();

-- ---------------------------------------------------------------------
-- Cobros. Una vez registrados NO se modifican ni se borran: si hay un
-- error se ANULAN (queda constancia de quién, cuándo y por qué).
-- ---------------------------------------------------------------------
create table if not exists public.cobros (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.negocios(id) on delete cascade,
  fecha         date not null,
  hora          time not null,
  clienta_id    uuid references public.clientas(id) on delete restrict,
  cita_id       uuid references public.citas(id) on delete restrict,
  subtotal      numeric(10,2) not null,
  descuento     numeric(10,2) not null default 0 check (descuento >= 0),
  total         numeric(10,2) not null check (total >= 0),
  notas         text,
  creado_por    uuid default auth.uid(),
  anulado       boolean not null default false,
  motivo_anulacion text,
  anulado_en    timestamptz,
  anulado_por   uuid,
  created_at    timestamptz not null default now()
);
create index if not exists cobros_negocio_fecha_idx on public.cobros (negocio_id, fecha, hora);
create index if not exists cobros_clienta_idx on public.cobros (clienta_id, fecha desc);
-- Una cita solo puede tener un cobro válido
create unique index if not exists cobros_una_por_cita on public.cobros (cita_id)
  where cita_id is not null and not anulado;

-- Conceptos cobrados (servicios, productos u otros), con nombre y precio copiados
create table if not exists public.cobro_lineas (
  id           uuid primary key default gen_random_uuid(),
  cobro_id     uuid not null references public.cobros(id) on delete cascade,
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  tipo         text not null check (tipo in ('servicio','producto','otro')),
  servicio_id  uuid references public.servicios(id) on delete set null,
  producto_id  uuid references public.productos(id) on delete set null,
  nombre       text not null,
  cantidad     numeric(10,2) not null default 1 check (cantidad > 0),
  precio_unit  numeric(10,2) not null check (precio_unit >= 0),
  importe      numeric(10,2) not null,
  iva_pct      numeric(5,2)  not null default 21,
  orden        integer not null default 0
);
create index if not exists cobro_lineas_cobro_idx on public.cobro_lineas (cobro_id);

-- Formas de pago de cada cobro (puede ser mixto: parte tarjeta, parte efectivo)
create table if not exists public.cobro_pagos (
  id          uuid primary key default gen_random_uuid(),
  cobro_id    uuid not null references public.cobros(id) on delete cascade,
  negocio_id  uuid not null references public.negocios(id) on delete cascade,
  metodo      text not null check (metodo in ('datafono','efectivo','bizum','otro')),
  importe     numeric(10,2) not null check (importe > 0)
);
create index if not exists cobro_pagos_cobro_idx on public.cobro_pagos (cobro_id);

-- ---------------------------------------------------------------------
-- Cierre de caja diario: lo que se ha contado en efectivo frente a lo
-- que dice la app que se ha cobrado.
-- ---------------------------------------------------------------------
create table if not exists public.cierres_caja (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references public.negocios(id) on delete cascade,
  fecha              date not null,
  fondo_inicial      numeric(10,2) not null default 0,
  total_datafono     numeric(10,2) not null default 0,
  total_efectivo     numeric(10,2) not null default 0,
  total_bizum        numeric(10,2) not null default 0,
  total_otro         numeric(10,2) not null default 0,
  total              numeric(10,2) not null default 0,
  num_cobros         integer not null default 0,
  efectivo_contado   numeric(10,2),
  diferencia         numeric(10,2),
  notas              text,
  cerrado_por        uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (negocio_id, fecha)
);
drop trigger if exists cierres_caja_updated on public.cierres_caja;
create trigger cierres_caja_updated before update on public.cierres_caja
  for each row execute function public.tocar_updated_at();

-- ---------------------------------------------------------------------
-- Registrar un cobro (todo o nada)
-- p_cobro:  {"fecha":"2026-11-01","hora":"10:45","clienta_id":uuid|null,
--            "cita_id":uuid|null,"descuento":2,"notas":"…"}
-- p_lineas: [{"tipo":"servicio","servicio_id":uuid,"nombre":"…","cantidad":1,"precio_unit":20,"iva_pct":21}, …]
-- p_pagos:  [{"metodo":"datafono","importe":18}, …]
-- ---------------------------------------------------------------------
create or replace function public.registrar_cobro(p_negocio uuid, p_cobro jsonb, p_lineas jsonb, p_pagos jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_sub     numeric(10,2);
  v_desc    numeric(10,2);
  v_total   numeric(10,2);
  v_pagado  numeric(10,2);
  v_cita    uuid := nullif(p_cobro->>'cita_id','')::uuid;
  v_clienta uuid := nullif(p_cobro->>'clienta_id','')::uuid;
  v_ahora   timestamp := now() at time zone 'Europe/Madrid';
  l         jsonb;
  p         jsonb;
  i         integer := 0;
  v_cant    numeric(10,2);
  v_prod    uuid;
begin
  if auth.uid() is null or not public.es_miembro(p_negocio) then
    raise exception 'Sin permiso sobre este negocio';
  end if;
  if jsonb_array_length(coalesce(p_lineas,'[]'::jsonb)) = 0 then
    raise exception 'El cobro necesita al menos un concepto';
  end if;
  if jsonb_array_length(coalesce(p_pagos,'[]'::jsonb)) = 0 then
    raise exception 'Indica cómo se ha pagado';
  end if;

  select coalesce(sum(round(coalesce(nullif(x->>'cantidad','')::numeric, 1) * (x->>'precio_unit')::numeric, 2)), 0)
    into v_sub from jsonb_array_elements(p_lineas) x;
  v_desc := coalesce(nullif(p_cobro->>'descuento','')::numeric, 0);
  if v_desc < 0 or v_desc > v_sub then
    raise exception 'El descuento no puede ser mayor que el importe';
  end if;
  v_total := v_sub - v_desc;

  select coalesce(sum((x->>'importe')::numeric), 0) into v_pagado from jsonb_array_elements(p_pagos) x;
  if abs(v_pagado - v_total) > 0.009 then
    raise exception 'Los pagos (% €) no suman el total (% €)', v_pagado, v_total;
  end if;

  if v_cita is not null then
    if not exists (select 1 from public.citas where id = v_cita and negocio_id = p_negocio) then
      raise exception 'Cita no encontrada';
    end if;
    if exists (select 1 from public.cobros where cita_id = v_cita and not anulado) then
      raise exception 'Esta cita ya está cobrada';
    end if;
    if v_clienta is null then
      select clienta_id into v_clienta from public.citas where id = v_cita;
    end if;
  end if;
  if v_clienta is not null and not exists (select 1 from public.clientas where id = v_clienta and negocio_id = p_negocio) then
    raise exception 'Clienta no encontrada';
  end if;

  insert into public.cobros (negocio_id, fecha, hora, clienta_id, cita_id, subtotal, descuento, total, notas, creado_por)
  values (p_negocio,
          coalesce(nullif(p_cobro->>'fecha','')::date, v_ahora::date),
          coalesce(nullif(p_cobro->>'hora','')::time, v_ahora::time),
          v_clienta, v_cita, v_sub, v_desc, v_total, nullif(p_cobro->>'notas',''), auth.uid())
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lineas) loop
    v_cant := coalesce(nullif(l->>'cantidad','')::numeric, 1);
    v_prod := nullif(l->>'producto_id','')::uuid;
    if v_prod is not null and not exists (select 1 from public.productos where id = v_prod and negocio_id = p_negocio) then
      raise exception 'Producto no encontrado';
    end if;
    insert into public.cobro_lineas (cobro_id, negocio_id, tipo, servicio_id, producto_id, nombre, cantidad, precio_unit, importe, iva_pct, orden)
    values (v_id, p_negocio,
            coalesce(nullif(l->>'tipo',''), 'otro'),
            nullif(l->>'servicio_id','')::uuid,
            v_prod,
            coalesce(nullif(trim(l->>'nombre'),''), 'Concepto'),
            v_cant,
            (l->>'precio_unit')::numeric,
            round(v_cant * (l->>'precio_unit')::numeric, 2),
            coalesce(nullif(l->>'iva_pct','')::numeric, 21),
            i);
    -- Descontar stock si ese producto lo controla
    if v_prod is not null then
      update public.productos set stock = stock - v_cant::integer
      where id = v_prod and stock is not null;
    end if;
    i := i + 1;
  end loop;

  for p in select * from jsonb_array_elements(p_pagos) loop
    if (p->>'importe')::numeric > 0 then
      insert into public.cobro_pagos (cobro_id, negocio_id, metodo, importe)
      values (v_id, p_negocio, p->>'metodo', (p->>'importe')::numeric);
    end if;
  end loop;

  -- La cita queda como realizada
  if v_cita is not null then
    update public.citas set estado = 'realizada'
    where id = v_cita and estado in ('pendiente','confirmada');
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Anular un cobro (no se borra: queda marcado y se devuelve el stock)
-- ---------------------------------------------------------------------
create or replace function public.anular_cobro(p_cobro uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_neg uuid; v_anulado boolean;
begin
  select negocio_id, anulado into v_neg, v_anulado from public.cobros where id = p_cobro;
  if v_neg is null or auth.uid() is null or not public.es_miembro(v_neg) then
    raise exception 'Cobro no encontrado';
  end if;
  if v_anulado then
    raise exception 'Este cobro ya estaba anulado';
  end if;
  update public.cobros
    set anulado = true, motivo_anulacion = nullif(trim(p_motivo),''), anulado_en = now(), anulado_por = auth.uid()
    where id = p_cobro;
  update public.productos pr set stock = pr.stock + l.cantidad::integer
    from public.cobro_lineas l
    where l.cobro_id = p_cobro and l.producto_id = pr.id and pr.stock is not null;
end;
$$;

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
alter table public.productos     enable row level security;
alter table public.cobros        enable row level security;
alter table public.cobro_lineas  enable row level security;
alter table public.cobro_pagos   enable row level security;
alter table public.cierres_caja  enable row level security;

do $$
declare t text;
begin
  -- productos y cierres: se pueden crear y editar desde la app
  foreach t in array array['productos','cierres_caja'] loop
    execute format('drop policy if exists %I_todo on public.%I', t, t);
    execute format('create policy %I_todo on public.%I for all to authenticated
                    using (public.es_miembro(negocio_id))
                    with check (public.es_miembro(negocio_id))', t, t);
  end loop;
  -- cobros: desde la app solo se pueden LEER (se crean y anulan con las funciones)
  foreach t in array array['cobros','cobro_lineas','cobro_pagos'] loop
    execute format('drop policy if exists %I_ver on public.%I', t, t);
    execute format('create policy %I_ver on public.%I for select to authenticated
                    using (public.es_miembro(negocio_id))', t, t);
  end loop;
end $$;

revoke all on public.productos, public.cobros, public.cobro_lineas, public.cobro_pagos, public.cierres_caja from anon;
grant select, insert, update, delete on public.productos, public.cierres_caja to authenticated;
grant select on public.cobros, public.cobro_lineas, public.cobro_pagos to authenticated;
revoke insert, update, delete on public.cobros, public.cobro_lineas, public.cobro_pagos from authenticated;

revoke execute on function public.registrar_cobro(uuid, jsonb, jsonb, jsonb), public.anular_cobro(uuid, text) from anon, public;
grant execute on function public.registrar_cobro(uuid, jsonb, jsonb, jsonb), public.anular_cobro(uuid, text) to authenticated;
