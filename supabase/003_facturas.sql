-- =====================================================================
-- Manely Belleza · Facturas (versión 0.3)
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- Requiere haber ejecutado antes 001 y 002. Solo AÑADE: no toca datos.
-- Se puede ejecutar más de una vez.
--
-- Cada factura guarda una COPIA de todo (datos del centro, de la clienta,
-- conceptos e IVA) tal como estaban al emitirla. Las facturas no se
-- modifican ni se borran, y su número es correlativo por serie y año:
--   F2026-0001, F2026-0002…  (facturas completas, con datos de la clienta)
--   T2026-0001, T2026-0002…  (facturas simplificadas / tique)
-- =====================================================================

create table if not exists public.facturas (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  cobro_id     uuid not null references public.cobros(id) on delete restrict,
  tipo         text not null check (tipo in ('completa','simplificada')),
  serie        text not null,
  anio         integer not null,
  numero       integer not null,
  codigo       text not null,
  fecha        date not null,          -- fecha de expedición
  fecha_operacion date not null,       -- fecha del cobro
  emisor       jsonb not null,
  receptor     jsonb,
  lineas       jsonb not null,
  desglose_iva jsonb not null,
  base_total   numeric(10,2) not null,
  cuota_total  numeric(10,2) not null,
  total        numeric(10,2) not null,
  creado_por   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (negocio_id, serie, anio, numero),
  unique (cobro_id)
);
create index if not exists facturas_negocio_fecha_idx on public.facturas (negocio_id, fecha);

-- ---------------------------------------------------------------------
-- Emitir la factura de un cobro
-- p_tipo: 'completa' o 'simplificada'
-- p_receptor (completa): {"nombre":"…","nif":"…","direccion":"…","cp":"…","poblacion":"…","email":"…"}
-- ---------------------------------------------------------------------
create or replace function public.emitir_factura(p_cobro uuid, p_tipo text, p_receptor jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  c        public.cobros%rowtype;
  n        public.negocios%rowtype;
  v_hoy    date := (now() at time zone 'Europe/Madrid')::date;
  v_serie  text := case when p_tipo = 'completa' then 'F' else 'T' end;
  v_anio   integer;
  v_num    integer;
  v_id     uuid;
  v_factor numeric;
  v_lineas jsonb := '[]'::jsonb;
  v_resto  numeric(10,2);
  v_imp    numeric(10,2);
  v_base   numeric(10,2);
  v_iva    numeric(5,2);
  v_desg   jsonb;
  l        record;
  i        integer := 0;
  v_count  integer;
begin
  select * into c from public.cobros where id = p_cobro;
  if c.id is null or auth.uid() is null or not public.es_miembro(c.negocio_id) then
    raise exception 'Cobro no encontrado';
  end if;
  if c.anulado then raise exception 'No se puede facturar un cobro anulado'; end if;
  if exists (select 1 from public.facturas where cobro_id = p_cobro) then
    raise exception 'Este cobro ya tiene factura';
  end if;
  if p_tipo not in ('completa','simplificada') then raise exception 'Tipo de factura no válido'; end if;

  select * into n from public.negocios where id = c.negocio_id;
  if coalesce(trim(n.nif),'') = '' or coalesce(trim(coalesce(n.razon_social, n.nombre)),'') = '' then
    raise exception 'Faltan los datos fiscales del centro (titular y NIF) en Ajustes';
  end if;
  if p_tipo = 'completa' then
    if coalesce(trim(n.direccion),'') = '' then
      raise exception 'Falta la dirección del centro en Ajustes';
    end if;
    if coalesce(trim(p_receptor->>'nombre'),'') = '' or coalesce(trim(p_receptor->>'nif'),'') = ''
       or coalesce(trim(p_receptor->>'direccion'),'') = '' then
      raise exception 'Para una factura completa hacen falta nombre, NIF y dirección de la clienta';
    end if;
  end if;

  -- Reparto del descuento entre los conceptos, proporcional a su importe
  select count(*) into v_count from public.cobro_lineas where cobro_id = p_cobro;
  v_factor := case when c.subtotal > 0 then c.total / c.subtotal else 0 end;
  v_resto := c.total;
  for l in select * from public.cobro_lineas where cobro_id = p_cobro order by orden loop
    i := i + 1;
    v_imp := case when i = v_count then v_resto else round(l.importe * v_factor, 2) end;
    v_resto := v_resto - v_imp;
    v_iva := l.iva_pct;
    v_base := round(v_imp / (1 + v_iva / 100), 2);
    v_lineas := v_lineas || jsonb_build_object(
      'nombre', l.nombre, 'cantidad', l.cantidad, 'precio_unit', l.precio_unit,
      'importe_bruto', l.importe, 'importe', v_imp, 'iva_pct', v_iva,
      'base', v_base, 'cuota', v_imp - v_base);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('iva_pct', iva, 'base', base, 'cuota', cuota) order by iva desc), '[]'::jsonb)
    into v_desg
    from (select (x->>'iva_pct')::numeric as iva, sum((x->>'base')::numeric) as base, sum((x->>'cuota')::numeric) as cuota
          from jsonb_array_elements(v_lineas) x group by 1) t;

  -- Número correlativo (bloqueo para que dos dispositivos no cojan el mismo)
  v_anio := extract(year from v_hoy)::integer;
  perform pg_advisory_xact_lock(hashtext(c.negocio_id::text || v_serie || v_anio::text));
  select coalesce(max(numero), 0) + 1 into v_num
    from public.facturas where negocio_id = c.negocio_id and serie = v_serie and anio = v_anio;

  insert into public.facturas (negocio_id, cobro_id, tipo, serie, anio, numero, codigo, fecha, fecha_operacion,
                               emisor, receptor, lineas, desglose_iva, base_total, cuota_total, total, creado_por)
  values (c.negocio_id, p_cobro, p_tipo, v_serie, v_anio, v_num,
          v_serie || v_anio::text || '-' || lpad(v_num::text, 4, '0'),
          v_hoy, c.fecha,
          jsonb_build_object('nombre', n.nombre, 'razon_social', coalesce(n.razon_social, n.nombre), 'nif', n.nif,
                             'direccion', n.direccion, 'cp', n.cp, 'poblacion', n.poblacion, 'provincia', n.provincia,
                             'telefono', n.telefono, 'email', n.email),
          case when p_tipo = 'completa' then p_receptor else nullif(p_receptor, '{}'::jsonb) end,
          v_lineas, v_desg,
          (select coalesce(sum((x->>'base')::numeric), 0) from jsonb_array_elements(v_lineas) x),
          (select coalesce(sum((x->>'cuota')::numeric), 0) from jsonb_array_elements(v_lineas) x),
          c.total, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Un cobro con factura no se anula sin más (haría falta una factura rectificativa)
create or replace function public.anular_cobro(p_cobro uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_neg uuid; v_anulado boolean; v_fac text;
begin
  select negocio_id, anulado into v_neg, v_anulado from public.cobros where id = p_cobro;
  if v_neg is null or auth.uid() is null or not public.es_miembro(v_neg) then
    raise exception 'Cobro no encontrado';
  end if;
  if v_anulado then
    raise exception 'Este cobro ya estaba anulado';
  end if;
  select codigo into v_fac from public.facturas where cobro_id = p_cobro;
  if v_fac is not null then
    raise exception 'Este cobro tiene la factura %. Para anularlo hace falta una factura rectificativa (aún no disponible): consúltalo con el gestor.', v_fac;
  end if;
  update public.cobros
    set anulado = true, motivo_anulacion = nullif(trim(p_motivo),''), anulado_en = now(), anulado_por = auth.uid()
    where id = p_cobro;
  update public.productos pr set stock = pr.stock + l.cantidad::integer
    from public.cobro_lineas l
    where l.cobro_id = p_cobro and l.producto_id = pr.id and pr.stock is not null;
end;
$$;

alter table public.facturas enable row level security;
drop policy if exists facturas_ver on public.facturas;
create policy facturas_ver on public.facturas for select to authenticated using (public.es_miembro(negocio_id));

revoke all on public.facturas from anon;
grant select on public.facturas to authenticated;
revoke insert, update, delete on public.facturas from authenticated;

revoke execute on function public.emitir_factura(uuid, text, jsonb) from anon, public;
grant execute on function public.emitir_factura(uuid, text, jsonb) to authenticated;
revoke execute on function public.anular_cobro(uuid, text) from anon, public;
grant execute on function public.anular_cobro(uuid, text) to authenticated;
