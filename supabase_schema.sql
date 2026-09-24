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
  location text not null default 'Location A'
    check (location in ('Location A', 'Location B')),
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
