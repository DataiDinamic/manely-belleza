-- =====================================================================
-- Manely Belleza · Copias de seguridad (versión 0.7)
-- Permite «Introducir datos» desde una copia descargada con «Descargar datos».
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- Necesita haber ejecutado antes 001 a 005. No borra nada.
-- =====================================================================

-- Avisos con antelación en meses (para los trimestrales y anuales)
alter table public.obligaciones drop constraint if exists obligaciones_aviso_unidad_check;
alter table public.obligaciones add constraint obligaciones_aviso_unidad_check
  check (aviso_unidad in ('minutos','horas','dias','semanas','meses'));

-- Al restaurar, el stock del material ya viene calculado en la copia:
-- los movimientos que se recuperan no deben volver a sumarlo.
create or replace function public.aplicar_movimiento()
returns trigger language plpgsql as $$
begin
  if current_setting('manely.restaurando', true) = '1' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    update public.consumibles set stock_actual = stock_actual + new.cantidad where id = new.consumible_id;
    return new;
  else
    update public.consumibles set stock_actual = stock_actual - old.cantidad where id = old.consumible_id;
    return old;
  end if;
end; $$;

-- ---------------------------------------------------------------------
-- restaurar_copia: añade lo que falte de una copia. Lo que ya existe
-- (mismo identificador) no se toca ni se duplica. Todo entra en el
-- negocio de quien restaura, y solo se enlaza con datos de ese negocio.
-- Devuelve cuántas filas ha añadido de cada tabla.
-- ---------------------------------------------------------------------
create or replace function public.restaurar_copia(p_negocio uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  n integer;
  neg jsonb := jsonb_build_object('negocio_id', p_negocio);
  -- jsonb de una tabla de la copia
  t jsonb;
begin
  if auth.uid() is null or not public.es_miembro(p_negocio) then
    raise exception 'Sin permiso sobre este negocio';
  end if;
  if coalesce(p_datos->>'app','') <> 'Manely Belleza' then
    raise exception 'El archivo no es una copia de Manely Belleza';
  end if;
  perform set_config('manely.restaurando', '1', true);

  -- Datos del centro: solo se rellenan los que estén vacíos
  t := p_datos->'negocio';
  if t is not null then
    update public.negocios set
      razon_social = coalesce(nullif(razon_social,''), t->>'razon_social'),
      nif          = coalesce(nullif(nif,''), t->>'nif'),
      direccion    = coalesce(nullif(direccion,''), t->>'direccion'),
      cp           = coalesce(nullif(cp,''), t->>'cp'),
      poblacion    = coalesce(nullif(poblacion,''), t->>'poblacion'),
      provincia    = coalesce(nullif(provincia,''), t->>'provincia'),
      telefono     = coalesce(nullif(telefono,''), t->>'telefono'),
      email        = coalesce(nullif(email,''), t->>'email')
    where id = p_negocio;
  end if;

  insert into public.clientas select x.* from jsonb_array_elements(coalesce(p_datos->'clientas','[]')) e,
    jsonb_populate_record(null::public.clientas, e || neg) x on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('clientas', n);

  insert into public.servicios select x.* from jsonb_array_elements(coalesce(p_datos->'servicios','[]')) e,
    jsonb_populate_record(null::public.servicios, e || neg) x on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('servicios', n);

  insert into public.productos select x.* from jsonb_array_elements(coalesce(p_datos->'productos','[]')) e,
    jsonb_populate_record(null::public.productos, e || neg) x on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('productos', n);

  insert into public.citas select x.* from jsonb_array_elements(coalesce(p_datos->'citas','[]')) e,
    jsonb_populate_record(null::public.citas, e || neg) x
    where exists (select 1 from public.clientas c where c.id = x.clienta_id and c.negocio_id = p_negocio)
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('citas', n);

  insert into public.cita_servicios select x.* from jsonb_array_elements(coalesce(p_datos->'cita_servicios','[]')) e,
    jsonb_populate_record(null::public.cita_servicios, e || neg || jsonb_build_object('servicio_id',
      case when exists (select 1 from public.servicios s where s.id = (e->>'servicio_id')::uuid and s.negocio_id = p_negocio) then e->'servicio_id' else 'null'::jsonb end)) x
    where exists (select 1 from public.citas c where c.id = x.cita_id and c.negocio_id = p_negocio)
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('cita_servicios', n);

  insert into public.cobros select x.* from jsonb_array_elements(coalesce(p_datos->'cobros','[]')) e,
    jsonb_populate_record(null::public.cobros, e || neg || jsonb_build_object(
      'clienta_id', case when exists (select 1 from public.clientas c where c.id = (e->>'clienta_id')::uuid and c.negocio_id = p_negocio) then e->'clienta_id' else 'null'::jsonb end,
      'cita_id', case when exists (select 1 from public.citas c where c.id = (e->>'cita_id')::uuid and c.negocio_id = p_negocio) then e->'cita_id' else 'null'::jsonb end)) x
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('cobros', n);

  insert into public.cobro_lineas select x.* from jsonb_array_elements(coalesce(p_datos->'cobro_lineas','[]')) e,
    jsonb_populate_record(null::public.cobro_lineas, e || neg || jsonb_build_object(
      'servicio_id', case when exists (select 1 from public.servicios s where s.id = (e->>'servicio_id')::uuid and s.negocio_id = p_negocio) then e->'servicio_id' else 'null'::jsonb end,
      'producto_id', case when exists (select 1 from public.productos p where p.id = (e->>'producto_id')::uuid and p.negocio_id = p_negocio) then e->'producto_id' else 'null'::jsonb end)) x
    where exists (select 1 from public.cobros c where c.id = x.cobro_id and c.negocio_id = p_negocio)
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('cobro_lineas', n);

  insert into public.cobro_pagos select x.* from jsonb_array_elements(coalesce(p_datos->'cobro_pagos','[]')) e,
    jsonb_populate_record(null::public.cobro_pagos, e || neg) x
    where exists (select 1 from public.cobros c where c.id = x.cobro_id and c.negocio_id = p_negocio)
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('cobro_pagos', n);

  insert into public.facturas select x.* from jsonb_array_elements(coalesce(p_datos->'facturas','[]')) e,
    jsonb_populate_record(null::public.facturas, e || neg) x
    where exists (select 1 from public.cobros c where c.id = x.cobro_id and c.negocio_id = p_negocio)
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('facturas', n);

  insert into public.cierres_caja select x.* from jsonb_array_elements(coalesce(p_datos->'cierres_caja','[]')) e,
    jsonb_populate_record(null::public.cierres_caja, e || neg) x on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('cierres_caja', n);

  insert into public.consumibles select x.* from jsonb_array_elements(coalesce(p_datos->'consumibles','[]')) e,
    jsonb_populate_record(null::public.consumibles, e || neg) x on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('consumibles', n);

  insert into public.consumible_movimientos select x.* from jsonb_array_elements(coalesce(p_datos->'consumible_movimientos','[]')) e,
    jsonb_populate_record(null::public.consumible_movimientos, e || neg) x
    where exists (select 1 from public.consumibles c where c.id = x.consumible_id and c.negocio_id = p_negocio)
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('consumible_movimientos', n);

  insert into public.obligaciones select x.* from jsonb_array_elements(coalesce(p_datos->'obligaciones','[]')) e,
    jsonb_populate_record(null::public.obligaciones, e || neg) x on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('obligaciones', n);

  insert into public.obligacion_registros select x.* from jsonb_array_elements(coalesce(p_datos->'obligacion_registros','[]')) e,
    jsonb_populate_record(null::public.obligacion_registros, e || neg) x
    where exists (select 1 from public.obligaciones o where o.id = x.obligacion_id and o.negocio_id = p_negocio)
    on conflict do nothing;
  get diagnostics n = row_count; r := r || jsonb_build_object('obligacion_registros', n);

  return r;
end;
$$;

revoke execute on function public.restaurar_copia(uuid, jsonb) from public, anon;
grant execute on function public.restaurar_copia(uuid, jsonb) to authenticated;
