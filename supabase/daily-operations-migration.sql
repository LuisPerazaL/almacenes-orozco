alter table public.orders drop constraint if exists orders_status_check;
update public.orders set status='Listo' where status='Completado';
alter table public.orders add constraint orders_status_check check (status in ('Pendiente','Parcial','Listo','Entregado','Cancelado'));

create or replace function public.create_order(p_customer text, p_items jsonb)
returns bigint language plpgsql security invoker as $$
declare new_order_id bigint; requested jsonb; requested_product_id bigint; available integer; reserve_now integer; total_reserved integer := 0; total_requested integer := 0;
begin
  if jsonb_array_length(p_items) < 1 then raise exception 'El pedido debe incluir productos'; end if;
  insert into public.orders(owner_id,customer,status) values(auth.uid(),p_customer,'Pendiente') returning id into new_order_id;
  for requested in select * from jsonb_array_elements(p_items) loop
    if (requested->>'quantity')::integer < 1 then raise exception 'Cantidad inválida'; end if;
    requested_product_id := nullif(requested->>'product_id','')::bigint;
    if requested_product_id is null then
      if nullif(trim(requested->>'product_name'),'') is null then raise exception 'Captura el nombre del producto'; end if;
      insert into public.products(owner_id,name,sku,category,stock,min_stock,price)
      values(auth.uid(),trim(requested->>'product_name'),coalesce(nullif(upper(trim(requested->>'sku')),''),'PEND-'||upper(substr(md5(random()::text),1,8))),'Por catalogar',0,1,0) returning id into requested_product_id;
    end if;
    select stock into available from public.products where id=requested_product_id and owner_id=auth.uid() for update;
    if not found then raise exception 'Producto no encontrado'; end if;
    reserve_now:=least(available,(requested->>'quantity')::integer);
    update public.products set stock=stock-reserve_now,updated_at=now() where id=requested_product_id and owner_id=auth.uid();
    insert into public.order_items(owner_id,order_id,product_id,quantity,reserved_quantity) values(auth.uid(),new_order_id,requested_product_id,(requested->>'quantity')::integer,reserve_now);
    total_reserved:=total_reserved+reserve_now; total_requested:=total_requested+(requested->>'quantity')::integer;
  end loop;
  update public.orders set status=case when total_reserved=total_requested then 'Listo' when total_reserved>0 then 'Parcial' else 'Pendiente' end where id=new_order_id;
  return new_order_id;
end; $$;

create or replace function public.restock_and_fulfill(p_product_id bigint,p_amount integer)
returns void language plpgsql security invoker as $$
declare pending record; available integer; assign_now integer;
begin
  if p_amount < 0 then raise exception 'La entrada no puede ser negativa'; end if;
  update public.products set stock=stock+p_amount,updated_at=now() where id=p_product_id and owner_id=auth.uid();
  if not found then raise exception 'Producto no encontrado'; end if;
  for pending in select i.* from public.order_items i join public.orders o on o.id=i.order_id where i.product_id=p_product_id and i.owner_id=auth.uid() and i.reserved_quantity<i.quantity and o.status in ('Pendiente','Parcial') order by o.created_at,i.id loop
    select stock into available from public.products where id=p_product_id and owner_id=auth.uid() for update; exit when available<=0;
    assign_now:=least(available,pending.quantity-pending.reserved_quantity);
    update public.products set stock=stock-assign_now,updated_at=now() where id=p_product_id and owner_id=auth.uid();
    update public.order_items set reserved_quantity=reserved_quantity+assign_now where id=pending.id and owner_id=auth.uid();
    update public.orders o set status=case when not exists(select 1 from public.order_items i where i.order_id=o.id and i.reserved_quantity<i.quantity) then 'Listo' when exists(select 1 from public.order_items i where i.order_id=o.id and i.reserved_quantity>0) then 'Parcial' else 'Pendiente' end where o.id=pending.order_id and o.owner_id=auth.uid();
  end loop;
end; $$;

create or replace function public.deliver_order(p_order_id bigint)
returns void language plpgsql security invoker as $$
begin
  update public.orders set status='Entregado',completed_at=now() where id=p_order_id and owner_id=auth.uid() and status='Listo';
  if not found then raise exception 'El pedido todavía tiene productos pendientes'; end if;
end; $$;

create or replace function public.cancel_order(p_order_id bigint)
returns void language plpgsql security invoker as $$
declare item record;
begin
  if not exists(select 1 from public.orders where id=p_order_id and owner_id=auth.uid() and status not in ('Entregado','Cancelado')) then raise exception 'El pedido no se puede cancelar'; end if;
  update public.orders set status='Cancelado' where id=p_order_id and owner_id=auth.uid();
  for item in select * from public.order_items where order_id=p_order_id and owner_id=auth.uid() loop
    update public.products set stock=stock+item.reserved_quantity,updated_at=now() where id=item.product_id and owner_id=auth.uid();
    update public.order_items set reserved_quantity=0 where id=item.id and owner_id=auth.uid();
  end loop;
  for item in select distinct product_id from public.order_items where order_id=p_order_id and owner_id=auth.uid() loop
    perform public.restock_and_fulfill(item.product_id,0);
  end loop;
end; $$;

grant execute on function public.deliver_order(bigint) to authenticated;
grant execute on function public.cancel_order(bigint) to authenticated;
