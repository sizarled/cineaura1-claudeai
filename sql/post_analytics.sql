-- CineAura post analytics: impressions, link clicks and shares per post.
-- Recommendations (up) and "don't recommend" (down) already live in
-- public.post_votes, and watched minutes in public.views (post_id), so this
-- table only holds the three events nothing else records.
-- Run once in the Supabase SQL editor (safe to re-run).

create table if not exists public.post_events (
  id bigint generated always as identity primary key,
  post_id text not null,
  owner_id text default '',
  kind text not null,
  network text default '',
  member_id text default '',
  username text default '',
  created_at timestamptz not null default now(),
  constraint post_events_kind_check check (kind in ('impression', 'click', 'share'))
);

comment on table public.post_events is 'Per-post events: an impression each time a card is seen, a click on a link inside the post, a share on a network';
comment on column public.post_events.kind is 'impression | click | share';
comment on column public.post_events.network is 'Share network (facebook, pinterest, telegram, whatsapp, reddit) or copy';
comment on column public.post_events.member_id is 'Member who triggered it, empty for a signed-out visitor';

create index if not exists post_events_post_idx on public.post_events (post_id, kind, created_at desc);
create index if not exists post_events_owner_idx on public.post_events (owner_id, created_at desc);

alter table public.post_events enable row level security;

do $$
declare t text := 'post_events';
begin
  execute format('drop policy if exists "open select" on public.%I', t);
  execute format('create policy "open select" on public.%I for select to anon, authenticated using (true)', t);
  execute format('drop policy if exists "open insert" on public.%I', t);
  execute format('create policy "open insert" on public.%I for insert to anon, authenticated with check (true)', t);
  execute format('drop policy if exists "open update" on public.%I', t);
  execute format('create policy "open update" on public.%I for update to anon, authenticated using (true) with check (true)', t);
  execute format('drop policy if exists "open delete" on public.%I', t);
  execute format('create policy "open delete" on public.%I for delete to anon, authenticated using (true)', t);
end $$;

-- Ask PostgREST to pick up the new table right away.
notify pgrst, 'reload schema';
