-- =====================================================================
-- Manely Belleza · Inventario de material (versión 0.5)
-- Material que se gasta y NO se cobra a la clienta: algodones, servilletas,
-- acetona, guantes… para controlar el stock y el gasto.
-- Pegar entero en Supabase > SQL Editor > + (pestaña nueva) > Run.
-- Solo AÑADE tablas nuevas. Se puede ejecutar más de una vez.
-- =====================================================================

create table if not exists public.consumibles (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references public.negocios(id) on delete cascade,
  nombre           text not null,
  marca            text,
  categoria        text,
  proveedor        text,
  unidad           text not null default 'ud' check (unidad in ('ud','g','kg','ml','l')),
  contenido_envase numeric(12,3) not null default 1 check (contenido_envase > 0),  -- p. ej. 500 (ml por botella)
  precio_envase    numeric(10,2) not null default 0 check (precio_envase >= 0),    -- lo que cuesta un envase, IVA incluido
  stock_actual     numeric(12,3) not null default 0,                               -- en la unidad elegida
  stock_minimo     numeric(12,3) not null default 0,                               -- por debajo, a la lista de la compra
  notas            text,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists consumibles_negocio_idx on public.consumibles (negocio_id, activo, categoria, nombre);

drop trigger if exists consumibles_updated on public.consumibles;
create trigger consumibles_updated before update on public.consumibles
  for each row execute function public.tocar_updated_at();

-- Cada entrada o salida de material. El stock se recalcula solo.
--   compra: cantidad positiva (lo que entra) y coste = lo pagado
--   uso:    cantidad negativa (lo que se gasta); el coste se calcula solo
--   ajuste: corrección tras un recuento (positiva o negativa)
create table if not exists public.consumible_movimientos (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  consumible_id  uuid not null references public.consumibles(id) on delete cascade,
  fecha          date not null,
  tipo           text not null check (tipo in ('compra','uso','ajuste')),
  cantidad       numeric(12,3) not null,
  envases        numeric(10,2),
  coste          numeric(10,2),
  proveedor      text,
  notas          text,
  creado_por     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint signo_correcto check (
    (tipo = 'compra' and cantidad > 0) or (tipo = 'uso' and cantidad < 0) or tipo = 'ajuste')
);
create index if not exists consumible_mov_idx on public.consumible_movimientos (negocio_id, fecha);
create index if not exists consumible_mov_art_idx on public.consumible_movimientos (consumible_id, fecha desc);

-- Antes de guardar: comprobar el negocio y calcular el coste de lo usado
create or replace function public.preparar_movimiento()
returns trigger language plpgsql as $$
declare c public.consumibles%rowtype;
begin
  select * into c from public.consumibles where id = new.consumible_id;
  if c.id is null or c.negocio_id <> new.negocio_id then
    raise exception 'Artículo de inventario no encontrado';
  end if;
  if new.coste is null and new.tipo in ('uso','ajuste') then
    new.coste := round(abs(new.cantidad) * c.precio_envase / c.contenido_envase, 2);
  end if;
  return new;
end; $$;

-- Después: actualizar el stock (y deshacerlo si se borra el movimiento)
create or replace function public.aplicar_movimiento()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.consumibles set stock_actual = stock_actual + new.cantidad where id = new.consumible_id;
    return new;
  else
    update public.consumibles set stock_actual = stock_actual - old.cantidad where id = old.consumible_id;
    return old;
  end if;
end; $$;

drop trigger if exists consumible_mov_preparar on public.consumible_movimientos;
create trigger consumible_mov_preparar before insert on public.consumible_movimientos
  for each row execute function public.preparar_movimiento();
drop trigger if exists consumible_mov_aplicar on public.consumible_movimientos;
create trigger consumible_mov_aplicar after insert or delete on public.consumible_movimientos
  for each row execute function public.aplicar_movimiento();

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
alter table public.consumibles enable row level security;
alter table public.consumible_movimientos enable row level security;

drop policy if exists consumibles_todo on public.consumibles;
create policy consumibles_todo on public.consumibles for all to authenticated
  using (public.es_miembro(negocio_id)) with check (public.es_miembro(negocio_id));

drop policy if exists consumible_mov_ver on public.consumible_movimientos;
create policy consumible_mov_ver on public.consumible_movimientos for select to authenticated
  using (public.es_miembro(negocio_id));
drop policy if exists consumible_mov_crear on public.consumible_movimientos;
create policy consumible_mov_crear on public.consumible_movimientos for insert to authenticated
  with check (public.es_miembro(negocio_id));
drop policy if exists consumible_mov_borrar on public.consumible_movimientos;
create policy consumible_mov_borrar on public.consumible_movimientos for delete to authenticated
  using (public.es_miembro(negocio_id));

revoke all on public.consumibles, public.consumible_movimientos from anon;
grant select, insert, update, delete on public.consumibles to authenticated;
-- Los movimientos no se modifican: si hay un error, se borra y se apunta bien
grant select, insert, delete on public.consumible_movimientos to authenticated;
revoke update on public.consumible_movimientos from authenticated;
