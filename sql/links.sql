-- CineAura member watch links
-- MovieLink / TVLink — run in the Supabase SQL editor.

create table if not exists public.movielink (
  id bigint generated always as identity primary key,
  tmdb_id integer not null,
  member_id text not null,
  username text not null,
  watch_url text not null,
  title text default '',
  added_at timestamptz not null default now()
);

create table if not exists public.tvlink (
  id bigint generated always as identity primary key,
  tmdb_id integer not null,
  member_id text not null,
  username text not null,
  watch_url text not null,
  season integer not null,
  episode integer not null,
  title text default '',
  added_at timestamptz not null default now()
);

alter table public.movielink add column if not exists quality text default '';
alter table public.movielink add column if not exists original_language text default '';
alter table public.movielink add column if not exists has_subtitles boolean not null default false;
alter table public.movielink add column if not exists subtitle_languages text default '';

alter table public.tvlink add column if not exists quality text default '';
alter table public.tvlink add column if not exists original_language text default '';
alter table public.tvlink add column if not exists has_subtitles boolean not null default false;
alter table public.tvlink add column if not exists subtitle_languages text default '';

alter table public.movielink add column if not exists banned boolean not null default false;
alter table public.tvlink add column if not exists banned boolean not null default false;

create unique index if not exists movielink_unique_url on public.movielink (tmdb_id, watch_url);
create unique index if not exists tvlink_unique_url on public.tvlink (tmdb_id, watch_url);

comment on table public.movielink is 'MovieLink: member-submitted movie watch URLs';
comment on table public.tvlink is 'TVLink: member-submitted episode watch URLs';
comment on column public.movielink.quality is 'Playback quality (CAM, HD, 1080p, 4K, …)';
comment on column public.movielink.has_subtitles is 'Whether translation / subtitles are available';
comment on column public.movielink.subtitle_languages is 'all, or comma-separated language names';

create index if not exists movielink_tmdb_idx on public.movielink (tmdb_id, added_at desc);
create index if not exists tvlink_tmdb_ep_idx on public.tvlink (tmdb_id, season, episode, added_at desc);

alter table public.movielink enable row level security;
alter table public.tvlink enable row level security;

drop policy if exists "MovieLink select" on public.movielink;
create policy "MovieLink select" on public.movielink for select to anon, authenticated using (true);
drop policy if exists "MovieLink insert" on public.movielink;
create policy "MovieLink insert" on public.movielink for insert to anon, authenticated with check (true);
drop policy if exists "MovieLink update" on public.movielink;
create policy "MovieLink update" on public.movielink for update to anon, authenticated using (true) with check (true);
drop policy if exists "MovieLink delete" on public.movielink;
create policy "MovieLink delete" on public.movielink for delete to anon, authenticated using (true);

drop policy if exists "TVLink select" on public.tvlink;
create policy "TVLink select" on public.tvlink for select to anon, authenticated using (true);
drop policy if exists "TVLink insert" on public.tvlink;
create policy "TVLink insert" on public.tvlink for insert to anon, authenticated with check (true);
drop policy if exists "TVLink update" on public.tvlink;
create policy "TVLink update" on public.tvlink for update to anon, authenticated using (true) with check (true);
drop policy if exists "TVLink delete" on public.tvlink;
create policy "TVLink delete" on public.tvlink for delete to anon, authenticated using (true);
