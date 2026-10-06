-- CineAura access codes
-- Run this in the Supabase SQL editor if the table has not been created yet.

create table if not exists public.codes (
  id bigint generated always as identity primary key,
  owner text not null,
  code text not null unique,
  status text not null default 'active',
  duration text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  ip text,
  constraint codes_owner_format check (owner ~ '^ID[0-9]+$'),
  constraint codes_code_format check (code ~ '^[0-9]{6}$'),
  constraint codes_status_check check (
    status in ('active', 'disabled', 'banned', 'expired')
  )
);

comment on table public.codes is 'CineAura membership access codes';
comment on column public.codes.owner is 'Account id of the code creator, formatted as ID followed by digits';
comment on column public.codes.code is 'Six-digit access code';
comment on column public.codes.status is 'active | disabled | banned | expired';
comment on column public.codes.duration is 'Plan length, e.g. 1 month, 3 months, 6 months, 12 months';
comment on column public.codes.ip is 'Public IP bound to this access code';

alter table public.codes add column if not exists ip text;
alter table public.codes add column if not exists duration text;
alter table public.codes add column if not exists owner text;

create index if not exists codes_code_idx on public.codes (code);
create index if not exists codes_owner_idx on public.codes (owner);

alter table public.codes enable row level security;

drop policy if exists "Verify access codes" on public.codes;
create policy "Verify access codes"
  on public.codes
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Owners insert codes" on public.codes;
drop policy if exists "Codes insert" on public.codes;
create policy "Codes insert"
  on public.codes
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Codes update" on public.codes;
create policy "Codes update"
  on public.codes
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Codes delete" on public.codes;
create policy "Codes delete"
  on public.codes
  for delete
  to anon, authenticated
  using (true);
