create table if not exists public.visual_catalog(
 id bigint generated always as identity primary key,
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null,
 category text not null default 'Cortinas',
 color text not null default '',
 presentation text not null default '',
 image_url text not null,
 active boolean not null default true,
 created_at timestamptz not null default now()
);

alter table public.visual_catalog enable row level security;
drop policy if exists visual_catalog_owner on public.visual_catalog;
create policy visual_catalog_owner on public.visual_catalog for all to authenticated
 using(owner_id=auth.uid()) with check(owner_id=auth.uid());
