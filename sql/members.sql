-- CineAura members (Sign Up)
-- Run this in the Supabase SQL editor.

create table if not exists public.members (
  member_id text primary key,
  full_name text not null,
  username text not null,
  status text not null default 'active',
  email text not null,
  password text not null,
  country text not null,
  created_at timestamptz not null default now(),
  birth_date date not null,
  recovery_code text,
  constraint members_id_format check (member_id ~ '^ID[0-9]+$'),
  constraint members_status_check check (status in ('active', 'disabled', 'banned'))
);

alter table public.members add column if not exists recovery_code text;
alter table public.members add column if not exists gender text;
alter table public.members add column if not exists membership_type text default 'Free';
alter table public.members add column if not exists membership_duration text default '1 month';
alter table public.members add column if not exists membership_expires_at timestamptz;
alter table public.members add column if not exists watch_minutes integer default 0;

alter table public.members drop constraint if exists members_gender_check;
alter table public.members add constraint members_gender_check
  check (gender is null or gender in ('male', 'female'));

alter table public.members drop constraint if exists members_type_check;
alter table public.members add constraint members_type_check
  check (membership_type is null or membership_type in ('Free', 'Silver', 'Gold', 'Diamond'));

update public.members
set membership_type = coalesce(membership_type, 'Free'),
    membership_duration = coalesce(membership_duration, '1 month'),
    watch_minutes = coalesce(watch_minutes, 0)
where membership_type is null
   or membership_duration is null
   or watch_minutes is null;

update public.members
set membership_expires_at = created_at + interval '1 month'
where membership_expires_at is null;

create unique index if not exists members_username_lower_idx on public.members (lower(username));
create unique index if not exists members_email_lower_idx on public.members (lower(email));
create unique index if not exists members_recovery_code_idx on public.members (recovery_code);

comment on table public.members is 'CineAura registered members';
comment on column public.members.member_id is 'Unique member id, ID followed by digits';
comment on column public.members.status is 'active | disabled | banned';
comment on column public.members.password is 'SHA-256 hex of the password';
comment on column public.members.recovery_code is '16-character recovery code used on the Rest page';
comment on column public.members.gender is 'male | female';
comment on column public.members.membership_type is 'Free | Silver | Gold | Diamond';
comment on column public.members.membership_duration is 'Plan length, e.g. 1 month, 3 months, 6 months, 12 months';
comment on column public.members.membership_expires_at is 'When the current membership ends';
comment on column public.members.watch_minutes is 'Total minutes watched';

alter table public.members enable row level security;

drop policy if exists "Members can be checked at signup" on public.members;
create policy "Members can be checked at signup"
  on public.members
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone can register" on public.members;
create policy "Anyone can register"
  on public.members
  for insert
  to anon, authenticated
  with check (true);

drop function if exists public.register_member(text, text, text, text, text, date);
drop function if exists public.register_member(text, text, text, text, text, date, text);

create or replace function public.register_member(
  p_full_name text,
  p_username text,
  p_email text,
  p_password text,
  p_country text,
  p_birth_date date,
  p_recovery_code text default null,
  p_gender text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id text;
  recovery text;
  i int;
  has_banned boolean;
  has_disabled boolean;
  has_existing boolean;
begin
  if p_full_name is null or length(trim(p_full_name)) < 2 then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_username is null or p_username !~ '^[A-Za-z0-9._]{3,24}$' then
    return json_build_object('ok', false, 'reason', 'invalid_username');
  end if;
  if p_email is null or position('@' in p_email) = 0 then
    return json_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  select
    exists (
      select 1 from members
      where (lower(username) = lower(p_username) or lower(email) = lower(p_email))
        and status = 'banned'
    ),
    exists (
      select 1 from members
      where (lower(username) = lower(p_username) or lower(email) = lower(p_email))
        and status = 'disabled'
    ),
    exists (
      select 1 from members
      where lower(username) = lower(p_username) or lower(email) = lower(p_email)
    )
  into has_banned, has_disabled, has_existing;

  if has_banned then
    return json_build_object('ok', false, 'reason', 'banned');
  end if;
  if has_disabled then
    return json_build_object('ok', false, 'reason', 'disabled');
  end if;
  if has_existing then
    return json_build_object('ok', false, 'reason', 'exists');
  end if;

  for i in 1..12 loop
    new_id := 'ID' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
    exit when not exists (select 1 from members where member_id = new_id);
  end loop;

  recovery := upper(regexp_replace(coalesce(p_recovery_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(recovery) <> 16 then
    recovery := '';
    for i in 1..16 loop
      recovery := recovery || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz',
        1 + floor(random() * 54)::int, 1);
    end loop;
  end if;

  insert into members (
    member_id, full_name, username, status, email, password, country, birth_date,
    recovery_code, gender, membership_type, membership_duration, membership_expires_at, watch_minutes
  ) values (
    new_id,
    trim(p_full_name),
    trim(p_username),
    'disabled',
    lower(trim(p_email)),
    p_password,
    p_country,
    p_birth_date,
    recovery,
    case
      when lower(coalesce(p_gender, '')) in ('male', 'female') then lower(p_gender)
      else null
    end,
    'Free',
    '1 month',
    now() + interval '1 month',
    0
  );

  return json_build_object(
    'ok', true,
    'reason', 'created',
    'member_id', new_id,
    'recovery_code', recovery
  );
end;
$$;

grant execute on function public.register_member(text, text, text, text, text, date, text, text)
  to anon, authenticated;

drop policy if exists "Update password via recovery" on public.members;
create policy "Update password via recovery"
  on public.members
  for update
  to anon, authenticated
  using (true)
  with check (true);

create or replace function public.login_member(
  p_login text,
  p_password text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rec members%rowtype;
begin
  select * into rec
  from members
  where lower(username) = lower(trim(p_login))
     or lower(email) = lower(trim(p_login))
  limit 1;

  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if rec.status = 'banned' then
    return json_build_object('ok', false, 'reason', 'banned');
  end if;

  if rec.password is distinct from p_password then
    return json_build_object('ok', false, 'reason', 'bad_password');
  end if;

  return json_build_object(
    'ok', true,
    'reason', 'ok',
    'member', json_build_object(
      'member_id', rec.member_id,
      'full_name', rec.full_name,
      'username', rec.username,
      'email', rec.email,
      'status', rec.status,
      'country', rec.country,
      'birth_date', rec.birth_date,
      'recovery_code', rec.recovery_code,
      'created_at', rec.created_at
    )
  );
end;
$$;

create or replace function public.reset_password_with_recovery(
  p_recovery_code text,
  p_password text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rec members%rowtype;
  cleaned text;
begin
  cleaned := regexp_replace(coalesce(p_recovery_code, ''), '[^A-Za-z0-9]', '', 'g');
  if length(cleaned) <> 16 then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into rec
  from members
  where lower(recovery_code) = lower(cleaned)
  limit 1;

  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  update members
  set password = p_password
  where member_id = rec.member_id;

  return json_build_object(
    'ok', true,
    'reason', 'updated',
    'member', json_build_object(
      'member_id', rec.member_id,
      'full_name', rec.full_name,
      'username', rec.username,
      'email', rec.email,
      'status', rec.status,
      'country', rec.country,
      'birth_date', rec.birth_date,
      'recovery_code', rec.recovery_code
    )
  );
end;
$$;

grant execute on function public.login_member(text, text) to anon, authenticated;
grant execute on function public.reset_password_with_recovery(text, text) to anon, authenticated;
