create table if not exists public.products (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, sku text not null, category text not null,
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id, sku)
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer text not null,
  product_id bigint not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'Pendiente' check (status in ('Pendiente','Completado')),
  created_at timestamptz not null default now(), completed_at timestamptz
);

alter table public.products enable row level security;
alter table public.orders enable row level security;
create policy "products_owner" on public.products for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "orders_owner" on public.orders for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.create_order(p_customer text, p_product_id bigint, p_quantity integer)
returns void language plpgsql security invoker as $$
begin
  if p_quantity < 1 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  update public.products set stock = stock - p_quantity, updated_at = now()
    where id = p_product_id and owner_id = auth.uid() and stock >= p_quantity;
  if not found then raise exception 'No hay stock suficiente para este pedido'; end if;
  insert into public.orders(owner_id, customer, product_id, quantity, status, completed_at)
    values (auth.uid(), p_customer, p_product_id, p_quantity, 'Completado', now());
end; $$;

create or replace function public.restock_and_fulfill(p_product_id bigint, p_amount integer)
returns void language plpgsql security invoker as $$
declare pending record; available integer;
begin
  if p_amount < 1 then raise exception 'La entrada debe ser mayor a cero'; end if;
  update public.products set stock = stock + p_amount, updated_at = now() where id = p_product_id and owner_id = auth.uid();
  if not found then raise exception 'Producto no encontrado'; end if;
  for pending in select * from public.orders where product_id = p_product_id and owner_id = auth.uid() and status = 'Pendiente' order by created_at loop
    select stock into available from public.products where id = p_product_id and owner_id = auth.uid() for update;
    exit when available < pending.quantity;
    update public.products set stock = stock - pending.quantity, updated_at = now() where id = p_product_id and owner_id = auth.uid();
    update public.orders set status = 'Completado', completed_at = now() where id = pending.id and owner_id = auth.uid();
  end loop;
end; $$;

grant execute on function public.create_order(text,bigint,integer) to authenticated;
grant execute on function public.restock_and_fulfill(bigint,integer) to authenticated;
