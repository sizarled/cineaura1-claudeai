-- ============================================================
-- Points: what a member can spend on prizes
-- Run once in the Supabase SQL editor (safe to run again).
--
-- A member earns points from five sources, each at its own rate:
--
--   1 watch minute — watched by the member, or watched by someone
--                    through a link the member published   = 1 point
--   5 link shares done by the member                        = 1 point
--   10 public or exclusive playlists created by the member  = 1 point
--   50 public or exclusive recommendations created by the
--      member (including the ones posted in a recommendation
--      list)                                                = 1 point
--   100 comments written by the member                      = 1 point
--
-- Fractions are dropped: 12 shares are worth 2 points, not 2.4.
--
-- Nothing is stored per source. Every count is read live from the table that
-- already records the activity, so there is no ledger to keep in sync:
--
--   minutes          profiles.private_minutes + profiles.public_minutes
--   shares           post_events      where kind = 'share' and member_id = me
--   playlists        playlists        where owner_id = me
--                                     and visibility in ('public','exclusive')
--   recommendations  posts            where owner_id = me
--                                     and kind in ('recommendation','reclist')
--                                     and visibility in ('public','exclusive')
--   comments         comments         where member_id = me
--
-- Only what has already been spent is stored, so the same bonus points cannot
-- be spent twice and the watch minutes themselves are never destroyed:
--
--   available points = earned points - points_spent
--
-- js/common.js holds the formula (CineAura.POINT_RATES, CineAura.memberPoints,
-- CineAura.spendPoints); the prize page and the dashboard both read it.
-- ============================================================

-- 1) The spending ledger.
alter table public.profiles add column if not exists points_spent integer default 0;

update public.profiles set points_spent = 0 where points_spent is null;

comment on column public.profiles.points_spent is
  'Points already spent on prizes. Available points = earned points - points_spent.';

-- 2) Carry what members already paid onto the new ledger.
--
-- Before this, a prize was paid by shrinking the watch minutes: the dashboard
-- recomputed the minutes from public.views and subtracted winners.minutes_paid.
-- js/dashboard.js no longer does that subtraction (otherwise every claim would
-- be charged twice — once here and once through the minutes), so the history
-- has to move into points_spent or those members would get their points back.
--
-- Only runs for members that have not spent anything on the new ledger yet.
update public.profiles p
set points_spent = coalesce(w.paid, 0)
from (
  select member_id, sum(coalesce(minutes_paid, 0)) as paid
  from public.winners
  group by member_id
) w
where p.member_id = w.member_id
  and coalesce(p.points_spent, 0) = 0
  and coalesce(w.paid, 0) > 0;

-- 3) The share counter reads post_events, so make sure a share always carries
--    the member who did it (a signed-out visitor cannot earn points).
comment on column public.post_events.member_id is
  'Member who triggered the event; 5 shares by one member earn that member 1 point.';

-- 4) Indexes for the five counters, so counting a member stays cheap.
create index if not exists post_events_share_member_idx
  on public.post_events (member_id) where kind = 'share';
create index if not exists playlists_owner_vis_idx
  on public.playlists (owner_id, visibility);
create index if not exists posts_owner_kind_vis_idx
  on public.posts (owner_id, kind, visibility);
create index if not exists comments_member_idx
  on public.comments (member_id);

-- Ask PostgREST to pick up the new column right away.
notify pgrst, 'reload schema';
