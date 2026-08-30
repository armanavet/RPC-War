-- ============================================================
-- Free bots from matches that stopped.
--
-- pick_bot will not choose a bot that is already in a live match —
-- correctly, since nobody should be playing two games at once. But
-- nothing ever ended a match that simply stalled: a tab closed
-- mid-game, or a nudge that never arrived, leaves the row `live`
-- forever and takes that bot out of the pool permanently.
--
-- Every abandoned test game therefore cost one opponent, and the
-- symptom of a drained pool is exactly the symptom of a broken bot:
-- you get matched with nobody, or with someone who never moves.
--
-- This reaps them. A match is stale when it is old *and* neither
-- player has touched it recently, so a genuinely slow game is never
-- interrupted. Results are voided rather than awarded — a game that
-- nobody finished should not move anyone's rating.
--
-- Apply after 0013_bot_ladder.sql.
-- ============================================================

create or replace function public.bot_reap(p_minutes int default 25)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select mt.id
      from matches mt
      join bots b on b.user_id in (mt.blue, mt.red)
     where mt.state = 'live'
       and mt.created_at < now() - make_interval(mins => p_minutes)
       /* quiet on both sides: no presence at all, or none for a while.
          A long think is minutes, not tens of minutes. */
       and coalesce(
             (select max(mp.seen_at) from match_presence mp where mp.match_id = mt.id),
             mt.created_at
           ) < now() - make_interval(mins => 10)
  loop
    perform void_match(r.id, 'abandon');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.bot_reap(int) from public, anon, authenticated;
grant  execute on function public.bot_reap(int) to service_role;

-- ------------------------------------------------------------
-- Every ten minutes is plenty: the cost of a stalled match is a bot
-- out of the pool, not a player waiting.
-- ------------------------------------------------------------
do $$
begin
  perform cron.unschedule('oddboards-reap');
exception when others then
  null;
end $$;

select cron.schedule(
  'oddboards-reap',
  '*/10 * * * *',
  $$select public.bot_reap(25)$$
);

-- Free whatever is stuck right now.
select public.bot_reap(25) as freed_now;
