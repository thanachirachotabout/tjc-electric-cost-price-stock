-- TJC ELECTRIC Cost Price Stock Web App realtime snapshot table
-- Run this in Supabase SQL Editor once per project.

create table if not exists public.app_state (
  workspace_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Simple shared-workspace policy.
-- Anyone with the Supabase anon key and workspace_id can read/write app state.
-- For private per-user access, replace this with Supabase Auth policies.
drop policy if exists "Allow anonymous shared app state read" on public.app_state;
drop policy if exists "Allow anonymous shared app state write" on public.app_state;

create policy "Allow anonymous shared app state read"
on public.app_state
for select
to anon
using (true);

create policy "Allow anonymous shared app state write"
on public.app_state
for all
to anon
using (true)
with check (true);

-- Enable Realtime for this table. Safe to run more than once.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end $$;
