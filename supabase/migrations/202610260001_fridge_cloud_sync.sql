-- Personal cloud-sync tables. Run this migration after enabling Supabase Auth.
-- Every row belongs to one Auth user and is deleted with that user.

create schema if not exists private;

create or replace function private.bump_fridge_sync_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.bump_fridge_sync_revision() from public, anon, authenticated;

create table if not exists public.fridge_inventory (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  food_name text not null check (char_length(btrim(food_name)) between 1 and 80),
  -- Quantity is expressed in the selected unit. For "piece", clients convert
  -- to the app's internal gram weight using the food's piece_grams metadata.
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 100000000),
  unit text not null check (unit in ('g', 'ml', 'piece')),
  shelf_life_days integer not null default 3 check (shelf_life_days between 0 and 3650),
  added_at timestamptz not null,
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default pg_catalog.now()
);
create index if not exists fridge_inventory_owner_updated_idx
  on public.fridge_inventory (owner_id, updated_at desc);

create table if not exists public.fridge_custom_foods (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  category text not null check (category in ('蔬菜','水果','肉类','鱼类','海鲜','豆制品','蛋奶','饮料','主食','调味品','其他')),
  kcal numeric(10,2) not null check (kcal between 0 and 100000),
  calorie_basis text not null default 'per100' check (calorie_basis in ('per100','package')),
  calorie_reference_amount numeric(12,3),
  calorie_reference_unit text check (calorie_reference_unit in ('g','kg','ml')),
  piece_grams numeric(10,3) not null default 0 check (piece_grams between 0 and 10000),
  default_unit text not null default 'g' check (default_unit in ('g','kg','ml')),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint fridge_custom_food_calorie_reference_check check (
    (calorie_basis = 'per100' and calorie_reference_amount is null)
    or (calorie_basis = 'package' and calorie_reference_amount > 0 and calorie_reference_unit is not null)
  )
);
create unique index if not exists fridge_custom_foods_owner_name_active_idx
  on public.fridge_custom_foods (owner_id, lower(btrim(name)))
  where deleted_at is null;
create index if not exists fridge_custom_foods_owner_updated_idx
  on public.fridge_custom_foods (owner_id, updated_at desc);

create table if not exists public.fridge_diet_meals (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id text not null check (char_length(recipe_id) between 1 and 100),
  recipe_name text not null check (char_length(btrim(recipe_name)) between 1 and 100),
  emoji text not null default '🍽️' check (char_length(emoji) <= 16),
  consumed_on date not null,
  recorded_at timestamptz not null,
  kcal numeric(10,2) not null check (kcal between 0 and 100000),
  carbs_g numeric(10,2) not null check (carbs_g between 0 and 100000),
  protein_g numeric(10,2) not null check (protein_g between 0 and 100000),
  fat_g numeric(10,2) not null check (fat_g between 0 and 100000),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default pg_catalog.now()
);
create index if not exists fridge_diet_meals_owner_date_idx
  on public.fridge_diet_meals (owner_id, consumed_on desc, recorded_at desc);

create table if not exists public.fridge_profiles (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 20),
  height_cm numeric(6,2) not null default 0 check (height_cm between 0 and 250),
  weight_kg numeric(6,2) not null default 0 check (weight_kg between 0 and 500),
  age_years smallint not null default 0 check (age_years between 0 and 130),
  gender text not null default 'male' check (gender in ('male','female')),
  activity numeric(4,3) not null default 1.55 check (activity between 1 and 2.5),
  goal text not null default 'maintain' check (goal in ('cut','maintain','bulk')),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default pg_catalog.now()
);

-- A client updates a row only when its last-seen revision still matches. The
-- trigger advances the version so stale writes can be detected as conflicts.
drop trigger if exists fridge_inventory_bump_revision on public.fridge_inventory;
create trigger fridge_inventory_bump_revision before update on public.fridge_inventory
  for each row execute function private.bump_fridge_sync_revision();
drop trigger if exists fridge_custom_foods_bump_revision on public.fridge_custom_foods;
create trigger fridge_custom_foods_bump_revision before update on public.fridge_custom_foods
  for each row execute function private.bump_fridge_sync_revision();
drop trigger if exists fridge_diet_meals_bump_revision on public.fridge_diet_meals;
create trigger fridge_diet_meals_bump_revision before update on public.fridge_diet_meals
  for each row execute function private.bump_fridge_sync_revision();
drop trigger if exists fridge_profiles_bump_revision on public.fridge_profiles;
create trigger fridge_profiles_bump_revision before update on public.fridge_profiles
  for each row execute function private.bump_fridge_sync_revision();

-- Expose only the operations needed by a signed-in client. Anonymous Auth users
-- also use the authenticated Postgres role, so their rows remain device-owned
-- until they link an identity to another sign-in method.
revoke all on public.fridge_inventory, public.fridge_custom_foods,
  public.fridge_diet_meals, public.fridge_profiles from anon, authenticated;
grant select, insert, update on public.fridge_inventory,
  public.fridge_custom_foods, public.fridge_diet_meals, public.fridge_profiles to authenticated;

alter table public.fridge_inventory enable row level security;
alter table public.fridge_custom_foods enable row level security;
alter table public.fridge_diet_meals enable row level security;
alter table public.fridge_profiles enable row level security;

create policy "Users read their fridge inventory"
  on public.fridge_inventory for select to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users add their fridge inventory"
  on public.fridge_inventory for insert to authenticated
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users update their fridge inventory"
  on public.fridge_inventory for update to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create policy "Users read their custom foods"
  on public.fridge_custom_foods for select to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users add their custom foods"
  on public.fridge_custom_foods for insert to authenticated
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users update their custom foods"
  on public.fridge_custom_foods for update to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create policy "Users read their diet meals"
  on public.fridge_diet_meals for select to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users add their diet meals"
  on public.fridge_diet_meals for insert to authenticated
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users update their diet meals"
  on public.fridge_diet_meals for update to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create policy "Users read their profile"
  on public.fridge_profiles for select to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users add their profile"
  on public.fridge_profiles for insert to authenticated
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));
create policy "Users update their profile"
  on public.fridge_profiles for update to authenticated
  using ((select auth.uid()) is not null and owner_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

comment on table public.fridge_inventory is 'Private per-user fridge stock; soft deletes preserve sync tombstones.';
comment on table public.fridge_custom_foods is 'Private per-user custom food catalog; soft deletes preserve sync tombstones.';
comment on table public.fridge_diet_meals is 'Private per-user meal log; stable IDs make append sync idempotent.';
comment on table public.fridge_profiles is 'Private per-user nutrition profile.';
