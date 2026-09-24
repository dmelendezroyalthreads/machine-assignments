create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.machine_assignment_config (
  id boolean primary key default true check (id),
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

insert into private.machine_assignment_config (id, pin_hash)
values (true, '$2a$12$kyutRoFr4C2uSKZwEqPzketZwDBT0dl9yNHyDcoMOmyV65eVoAmq2')
on conflict (id) do update
set pin_hash = excluded.pin_hash,
    updated_at = now();

create table if not exists private.machine_assignment_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);

revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.verify_machine_assignment_pin(pin_input text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  stored_hash text;
begin
  if current_user_id is null then
    return false;
  end if;

  select pin_hash into stored_hash
  from private.machine_assignment_config
  where id = true;

  if stored_hash is null
     or extensions.crypt(pin_input, stored_hash) <> stored_hash then
    perform pg_catalog.pg_sleep(0.35);
    return false;
  end if;

  insert into private.machine_assignment_access (user_id, verified_at, expires_at)
  values (current_user_id, now(), now() + interval '12 hours')
  on conflict (user_id) do update
  set verified_at = excluded.verified_at,
      expires_at = excluded.expires_at;

  return true;
end;
$$;

create or replace function public.has_machine_assignment_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.machine_assignment_access
    where user_id = (select auth.uid())
      and expires_at > now()
  );
$$;

create or replace function public.revoke_machine_assignment_access()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.machine_assignment_access
  where user_id = (select auth.uid());
$$;

revoke all on function public.verify_machine_assignment_pin(text) from public, anon;
revoke all on function public.has_machine_assignment_access() from public, anon;
revoke all on function public.revoke_machine_assignment_access() from public, anon;
grant execute on function public.verify_machine_assignment_pin(text) to authenticated;
grant execute on function public.has_machine_assignment_access() to authenticated;
grant execute on function public.revoke_machine_assignment_access() to authenticated;

create table if not exists public.machine_assignments (
  id uuid primary key default gen_random_uuid(),
  location text not null default '1st Shift'
    check (location in ('1st Shift', '2nd Shift', '3rd Shift')),
  machine text not null check (char_length(trim(machine)) between 1 and 40),
  category text not null
    check (category in ('P2S', 'Events', 'Rush/MST', 'FIFO', 'Special Project')),
  category_detail text not null default '' check (char_length(category_detail) <= 20),
  operator_name text not null default '',
  quantity integer not null default 0 check (quantity between 0 and 360),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_machine_assignments_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists machine_assignments_set_updated_at on public.machine_assignments;
create trigger machine_assignments_set_updated_at
before update on public.machine_assignments
for each row execute function public.set_machine_assignments_updated_at();

alter table public.machine_assignments enable row level security;

drop policy if exists "PIN users can read assignments" on public.machine_assignments;
create policy "PIN users can read assignments" on public.machine_assignments
for select to authenticated
using ((select public.has_machine_assignment_access()));

drop policy if exists "PIN users can add assignments" on public.machine_assignments;
create policy "PIN users can add assignments" on public.machine_assignments
for insert to authenticated
with check ((select public.has_machine_assignment_access()));

drop policy if exists "PIN users can update assignments" on public.machine_assignments;
create policy "PIN users can update assignments" on public.machine_assignments
for update to authenticated
using ((select public.has_machine_assignment_access()))
with check ((select public.has_machine_assignment_access()));

drop policy if exists "PIN users can delete assignments" on public.machine_assignments;
create policy "PIN users can delete assignments" on public.machine_assignments
for delete to authenticated
using ((select public.has_machine_assignment_access()));

revoke all on table public.machine_assignments from anon;
grant select, insert, update, delete on table public.machine_assignments to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.machine_assignments;
exception when duplicate_object then null;
end;
$$;

create table if not exists public.machine_assignment_imports (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.machine_assignments(id) on delete cascade,
  file_name text not null,
  source_type text not null check (source_type in ('pmstats', 'logistiview', 'generic')),
  import_mode text not null check (import_mode in ('replace', 'merge')),
  order_count integer not null default 0,
  unit_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.machine_assignment_orders (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.machine_assignments(id) on delete cascade,
  order_key text not null,
  order_number text not null default '',
  customer_name text not null default '',
  units integer not null check (units between 0 and 360),
  category text not null default '',
  due_date text not null default '',
  source_location text not null default '',
  status text not null default 'pending' check (status in ('pending', 'completed', 'removed')),
  completed_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  last_import_id uuid references public.machine_assignment_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, order_key)
);

create index if not exists machine_assignment_orders_assignment_status_idx
on public.machine_assignment_orders (assignment_id, status);

create index if not exists machine_assignment_imports_assignment_idx
on public.machine_assignment_imports (assignment_id);

create index if not exists machine_assignment_orders_last_import_idx
on public.machine_assignment_orders (last_import_id);

create or replace function public.set_machine_assignment_orders_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists machine_assignment_orders_set_updated_at on public.machine_assignment_orders;
create trigger machine_assignment_orders_set_updated_at
before update on public.machine_assignment_orders
for each row execute function public.set_machine_assignment_orders_updated_at();

alter table public.machine_assignment_imports enable row level security;
alter table public.machine_assignment_orders enable row level security;

drop policy if exists "PIN users can manage imports" on public.machine_assignment_imports;
create policy "PIN users can manage imports" on public.machine_assignment_imports
for all to authenticated
using ((select public.has_machine_assignment_access()))
with check ((select public.has_machine_assignment_access()));

drop policy if exists "PIN users can manage orders" on public.machine_assignment_orders;
create policy "PIN users can manage orders" on public.machine_assignment_orders
for all to authenticated
using ((select public.has_machine_assignment_access()))
with check ((select public.has_machine_assignment_access()));

revoke all on table public.machine_assignment_imports from anon;
revoke all on table public.machine_assignment_orders from anon;
grant select, insert, update, delete on table public.machine_assignment_imports to authenticated;
grant select, insert, update, delete on table public.machine_assignment_orders to authenticated;

drop function if exists public.import_machine_assignment_orders(uuid, text, text, text, jsonb);

create or replace function public.import_machine_assignment_orders(
  p_assignment_id uuid,
  p_file_name text,
  p_source_type text,
  p_import_mode text,
  p_orders jsonb,
  p_confirm_replace boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  import_id uuid;
  item jsonb;
  imported_units integer;
  active_units integer;
begin
  if p_import_mode not in ('replace', 'merge') then
    raise exception 'Import mode must be replace or merge.';
  end if;
  if p_import_mode = 'replace' and not p_confirm_replace then
    raise exception 'Replacing active orders requires explicit confirmation.';
  end if;
  if p_source_type not in ('pmstats', 'logistiview', 'generic') then
    raise exception 'Unsupported source type.';
  end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'No valid orders were found in the file.';
  end if;

  select coalesce(sum((value ->> 'units')::integer), 0)
  into imported_units
  from jsonb_array_elements(p_orders);

  if imported_units > 360 then
    raise exception 'Imported open orders total % units; the machine limit is 360.', imported_units;
  end if;

  insert into public.machine_assignment_imports (
    assignment_id, file_name, source_type, import_mode, order_count, unit_count
  ) values (
    p_assignment_id, left(p_file_name, 255), p_source_type, p_import_mode,
    jsonb_array_length(p_orders), imported_units
  ) returning id into import_id;

  if p_import_mode = 'replace' then
    update public.machine_assignment_orders
    set status = 'removed', completed_at = null, updated_at = now()
    where assignment_id = p_assignment_id
      and status = 'pending'
      and order_key not in (
        select value ->> 'order_key' from jsonb_array_elements(p_orders)
      );
  end if;

  for item in select value from jsonb_array_elements(p_orders)
  loop
    if coalesce(item ->> 'order_key', '') = '' then
      raise exception 'Every imported order requires a pick ticket or order key.';
    end if;

    insert into public.machine_assignment_orders (
      assignment_id, order_key, order_number, customer_name, units, category,
      due_date, source_location, status, details, last_import_id
    ) values (
      p_assignment_id,
      item ->> 'order_key',
      coalesce(item ->> 'order_number', ''),
      coalesce(item ->> 'customer_name', ''),
      (item ->> 'units')::integer,
      coalesce(item ->> 'category', ''),
      coalesce(item ->> 'due_date', ''),
      coalesce(item ->> 'source_location', ''),
      'pending',
      coalesce(item -> 'details', '{}'::jsonb),
      import_id
    )
    on conflict (assignment_id, order_key) do update
    set order_number = excluded.order_number,
        customer_name = excluded.customer_name,
        units = excluded.units,
        category = excluded.category,
        due_date = excluded.due_date,
        source_location = excluded.source_location,
        status = case
          when public.machine_assignment_orders.status = 'completed' then 'completed'
          else 'pending'
        end,
        details = excluded.details,
        last_import_id = excluded.last_import_id,
        updated_at = now();
  end loop;

  select coalesce(sum(units), 0)
  into active_units
  from public.machine_assignment_orders
  where assignment_id = p_assignment_id and status = 'pending';

  if active_units > 360 then
    raise exception 'Active orders total % units; the machine limit is 360.', active_units;
  end if;

  update public.machine_assignments
  set quantity = active_units
  where id = p_assignment_id;

  return jsonb_build_object(
    'import_id', import_id,
    'order_count', jsonb_array_length(p_orders),
    'active_units', active_units
  );
end;
$$;

create or replace function public.set_machine_assignment_order_status(
  p_order_id uuid,
  p_status text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  target_assignment_id uuid;
  active_units integer;
begin
  if p_status not in ('pending', 'completed') then
    raise exception 'Order status must be pending or completed.';
  end if;

  update public.machine_assignment_orders
  set status = p_status,
      completed_at = case when p_status = 'completed' then now() else null end,
      updated_at = now()
  where id = p_order_id
  returning assignment_id into target_assignment_id;

  if target_assignment_id is null then
    raise exception 'Order not found.';
  end if;

  select coalesce(sum(units), 0)
  into active_units
  from public.machine_assignment_orders
  where assignment_id = target_assignment_id and status = 'pending';

  update public.machine_assignments
  set quantity = active_units
  where id = target_assignment_id;

  return jsonb_build_object('assignment_id', target_assignment_id, 'active_units', active_units);
end;
$$;

revoke all on function public.import_machine_assignment_orders(uuid, text, text, text, jsonb, boolean) from public, anon;
revoke all on function public.set_machine_assignment_order_status(uuid, text) from public, anon;
grant execute on function public.import_machine_assignment_orders(uuid, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.set_machine_assignment_order_status(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.machine_assignment_orders;
exception when duplicate_object then null;
end;
$$;
