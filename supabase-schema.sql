-- TJC ELECTRIC Cost Price Stock Web App realtime snapshot table
-- Run this in Supabase SQL Editor once per project.

create table if not exists public.authorized_emails (
  email text primary key,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table public.authorized_emails from public;
revoke all on table public.authorized_emails from anon;
revoke all on table public.authorized_emails from authenticated;

create or replace function public.is_authorized_email(input_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.authorized_emails ae
    where ae.active
      and lower(ae.email) = lower(coalesce(input_email, ''))
  );
$$;

revoke all on function public.is_authorized_email(text) from public;
grant execute on function public.is_authorized_email(text) to authenticated;

create table if not exists public.app_state (
  workspace_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Only signed-in, allowed email addresses can read/write app state.
drop policy if exists "Allow authenticated app state read" on public.app_state;
drop policy if exists "Allow authenticated app state write" on public.app_state;
drop policy if exists "Allow anonymous shared app state read" on public.app_state;
drop policy if exists "Allow anonymous shared app state write" on public.app_state;

create policy "Allow authenticated app state read"
on public.app_state
for select
to authenticated
using (public.is_authorized_email(auth.email()));

create policy "Allow authenticated app state write"
on public.app_state
for all
to authenticated
using (public.is_authorized_email(auth.email()))
with check (public.is_authorized_email(auth.email()));

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
