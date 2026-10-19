alter table public.food_shares
  drop constraint if exists food_shares_unit_check;

alter table public.food_shares
  add constraint food_shares_unit_check
  check (unit in ('g', 'piece', 'ml'));
