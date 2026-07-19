alter table public.orders alter column product_id drop not null;
alter table public.orders alter column quantity drop not null;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('Pendiente','Parcial','Completado'));

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0 and reserved_quantity <= quantity),
  created_at timestamptz not null default now()
);

insert into public.order_items(owner_id, order_id, product_id, quantity, reserved_quantity)
select owner_id, id, product_id, quantity, case when status = 'Completado' then quantity else 0 end
from public.orders o where product_id is not null and quantity is not null
and not exists (select 1 from public.order_items i where i.order_id = o.id);

alter table public.order_items enable row level security;
drop policy if exists "order_items_owner" on public.order_items;
create policy "order_items_owner" on public.order_items for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop function if exists public.create_order(text,bigint,integer);
create or replace function public.create_order(p_customer text, p_items jsonb)
returns bigint language plpgsql security invoker as $$
declare new_order_id bigint; requested jsonb; available integer; reserve_now integer; total_reserved integer := 0; total_requested integer := 0;
begin
  if jsonb_array_length(p_items) < 1 then raise exception 'El pedido debe incluir productos'; end if;
  insert into public.orders(owner_id, customer, status) values (auth.uid(), p_customer, 'Pendiente') returning id into new_order_id;
  for requested in select * from jsonb_array_elements(p_items) loop
    if (requested->>'quantity')::integer < 1 then raise exception 'Cantidad inválida'; end if;
    select stock into available from public.products where id = (requested->>'product_id')::bigint and owner_id = auth.uid() for update;
    if not found then raise exception 'Producto no encontrado'; end if;
    reserve_now := least(available, (requested->>'quantity')::integer);
    update public.products set stock = stock - reserve_now, updated_at = now() where id = (requested->>'product_id')::bigint and owner_id = auth.uid();
    insert into public.order_items(owner_id, order_id, product_id, quantity, reserved_quantity) values (auth.uid(), new_order_id, (requested->>'product_id')::bigint, (requested->>'quantity')::integer, reserve_now);
    total_reserved := total_reserved + reserve_now; total_requested := total_requested + (requested->>'quantity')::integer;
  end loop;
  update public.orders set status = case when total_reserved = total_requested then 'Completado' when total_reserved > 0 then 'Parcial' else 'Pendiente' end,
    completed_at = case when total_reserved = total_requested then now() else null end where id = new_order_id;
  return new_order_id;
end; $$;

create or replace function public.restock_and_fulfill(p_product_id bigint, p_amount integer)
returns void language plpgsql security invoker as $$
declare pending record; available integer; assign_now integer;
begin
  if p_amount < 1 then raise exception 'La entrada debe ser mayor a cero'; end if;
  update public.products set stock = stock + p_amount, updated_at = now() where id = p_product_id and owner_id = auth.uid();
  if not found then raise exception 'Producto no encontrado'; end if;
  for pending in select i.* from public.order_items i join public.orders o on o.id=i.order_id where i.product_id=p_product_id and i.owner_id=auth.uid() and i.reserved_quantity<i.quantity order by o.created_at, i.id loop
    select stock into available from public.products where id=p_product_id and owner_id=auth.uid() for update;
    exit when available <= 0;
    assign_now := least(available, pending.quantity - pending.reserved_quantity);
    update public.products set stock=stock-assign_now, updated_at=now() where id=p_product_id and owner_id=auth.uid();
    update public.order_items set reserved_quantity=reserved_quantity+assign_now where id=pending.id and owner_id=auth.uid();
    update public.orders o set status = case
      when not exists(select 1 from public.order_items i where i.order_id=o.id and i.reserved_quantity<i.quantity) then 'Completado'
      when exists(select 1 from public.order_items i where i.order_id=o.id and i.reserved_quantity>0) then 'Parcial' else 'Pendiente' end,
      completed_at = case when not exists(select 1 from public.order_items i where i.order_id=o.id and i.reserved_quantity<i.quantity) then now() else null end
      where o.id=pending.order_id and o.owner_id=auth.uid();
  end loop;
end; $$;

grant execute on function public.create_order(text,jsonb) to authenticated;
grant execute on function public.restock_and_fulfill(bigint,integer) to authenticated;
