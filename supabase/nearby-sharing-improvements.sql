alter table public.food_shares
  add column if not exists closed_reason text not null default '';

alter table public.food_shares
  drop constraint if exists food_shares_closed_reason_check;

alter table public.food_shares
  add constraint food_shares_closed_reason_check
  check (closed_reason in ('', 'claimed', 'withdrawn'));

alter table public.food_shares enable row level security;

drop policy if exists "Anyone can view open unexpired shares" on public.food_shares;
drop policy if exists "Public can view available shares and owners can view their own" on public.food_shares;
create policy "Public can view available shares and owners can view their own"
  on public.food_shares for select
  using ((status = 'open' and expires_at > now()) or owner_id = auth.uid());

create or replace function public.claim_food_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.food_shares
  set status = 'closed', closed_reason = 'claimed'
  where id = p_share_id
    and status = 'open'
    and expires_at > now()
    and owner_id <> auth.uid();

  return found;
end;
$$;

revoke all on function public.claim_food_share(uuid) from public, anon;
grant execute on function public.claim_food_share(uuid) to authenticated;