create table if not exists public.food_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  food_name text not null check (char_length(food_name) between 1 and 80),
  quantity numeric not null check (quantity > 0 and quantity <= 100000),
  unit text not null check (unit in ('g', 'piece', 'ml')),
  expires_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 120),
  latitude numeric(5,2) not null check (latitude between -90 and 90),
  longitude numeric(5,2) not null check (longitude between -180 and 180),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_reason text not null default '' check (closed_reason in ('', 'claimed', 'withdrawn')),
  created_at timestamptz not null default now()
);
create index if not exists food_shares_open_expiry_idx on public.food_shares (status, expires_at);
create index if not exists food_shares_location_idx on public.food_shares (latitude, longitude);
alter table public.food_shares enable row level security;
revoke all on public.food_shares from anon, authenticated;
grant select on public.food_shares to anon, authenticated;
grant insert, update, delete on public.food_shares to authenticated;
drop policy if exists "Anyone can view open unexpired shares" on public.food_shares;
drop policy if exists "Public can view available shares and owners can view their own" on public.food_shares;
create policy "Public can view available shares and owners can view their own" on public.food_shares for select using ((status = 'open' and expires_at > now()) or owner_id = auth.uid());
drop policy if exists "Signed-in users can publish their own shares" on public.food_shares;
create policy "Signed-in users can publish their own shares" on public.food_shares for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "Owners can update their own shares" on public.food_shares;
create policy "Owners can update their own shares" on public.food_shares for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Owners can delete their own shares" on public.food_shares;
create policy "Owners can delete their own shares" on public.food_shares for delete to authenticated using (owner_id = auth.uid());


create or replace function public.claim_food_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.food_shares set status = 'closed', closed_reason = 'claimed'
  where id = p_share_id and status = 'open' and expires_at > now() and owner_id <> auth.uid();
  return found;
end;
$$;
revoke all on function public.claim_food_share(uuid) from public, anon;
grant execute on function public.claim_food_share(uuid) to authenticated;
