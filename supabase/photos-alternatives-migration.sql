alter table public.order_items add column if not exists presentation text not null default '';
alter table public.order_items add column if not exists notes text not null default '';

create table if not exists public.order_item_alternatives(
 id bigint generated always as identity primary key,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 order_item_id bigint not null references public.order_items(id) on delete cascade,
 label text not null default 'Opción', image_url text not null,
 is_selected boolean not null default false, created_at timestamptz not null default now()
);
alter table public.order_item_alternatives enable row level security;
drop policy if exists alternatives_owner on public.order_item_alternatives;
create policy alternatives_owner on public.order_item_alternatives for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());

insert into storage.buckets(id,name,public) values('order-alternatives','order-alternatives',true) on conflict(id) do update set public=true;
drop policy if exists "owners upload alternatives" on storage.objects;
create policy "owners upload alternatives" on storage.objects for insert to authenticated with check(bucket_id='order-alternatives' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "public reads alternatives" on storage.objects;
create policy "public reads alternatives" on storage.objects for select to public using(bucket_id='order-alternatives');

create or replace function public.create_order_with_options(p_customer text,p_items jsonb) returns bigint language plpgsql security invoker as $$
declare oid bigint; req jsonb; alt jsonb; pid bigint; iid bigint; available int; reserve_now int; total_r int:=0; total_q int:=0;
begin
 if trim(p_customer)='' or jsonb_array_length(p_items)<1 then raise exception 'Pedido incompleto'; end if;
 insert into public.orders(owner_id,customer,status) values(auth.uid(),trim(p_customer),'Pendiente') returning id into oid;
 for req in select * from jsonb_array_elements(p_items) loop
  pid:=nullif(req->>'product_id','')::bigint;
  if pid is null then
   if nullif(trim(req->>'product_name'),'') is null then raise exception 'Captura el producto'; end if;
   insert into public.products(owner_id,name,sku,category,stock,min_stock,price) values(auth.uid(),trim(req->>'product_name'),coalesce(nullif(upper(trim(req->>'sku')),''),'PEND-'||upper(substr(md5(random()::text),1,8))),'Por catalogar',0,1,0) returning id into pid;
  end if;
  select stock into available from public.products where id=pid and owner_id=auth.uid() for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  reserve_now:=least(available,(req->>'quantity')::int);
  update public.products set stock=stock-reserve_now,updated_at=now() where id=pid;
  insert into public.order_items(owner_id,order_id,product_id,quantity,reserved_quantity,presentation,notes) values(auth.uid(),oid,pid,(req->>'quantity')::int,reserve_now,coalesce(req->>'presentation',''),coalesce(req->>'notes','')) returning id into iid;
  for alt in select * from jsonb_array_elements(coalesce(req->'alternatives','[]'::jsonb)) loop insert into public.order_item_alternatives(owner_id,order_item_id,label,image_url) values(auth.uid(),iid,coalesce(nullif(trim(alt->>'label'),''),'Opción'),alt->>'image_url'); end loop;
  total_r:=total_r+reserve_now;total_q:=total_q+(req->>'quantity')::int;
 end loop;
 update public.orders set status=case when total_r=total_q then 'Listo' when total_r>0 then 'Parcial' else 'Pendiente' end where id=oid;
 return oid;
end$$;
create or replace function public.select_order_alternative(p_item_id bigint,p_alternative_id bigint) returns void language plpgsql security invoker as $$
begin
 if not exists(select 1 from public.order_items where id=p_item_id and owner_id=auth.uid()) then raise exception 'Artículo no encontrado'; end if;
 if not exists(select 1 from public.order_item_alternatives where id=p_alternative_id and order_item_id=p_item_id and owner_id=auth.uid()) then raise exception 'Opción no encontrada'; end if;
 update public.order_item_alternatives set is_selected=(id=p_alternative_id) where order_item_id=p_item_id and owner_id=auth.uid();
end$$;
grant execute on function public.create_order_with_options(text,jsonb) to authenticated;
grant execute on function public.select_order_alternative(bigint,bigint) to authenticated;
