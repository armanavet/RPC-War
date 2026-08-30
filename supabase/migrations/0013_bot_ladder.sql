-- ============================================================
-- A leaderboard that is populated, and that moves.
--
-- Two problems this solves.
--
-- First: the leaderboard query filters on `played > 0`, and
-- bot_register seeds a rating with no games behind it — so a freshly
-- seeded bot is invisible on the board it is supposed to populate.
-- bot_seed_history() gives every one of them a plausible record.
--
-- Second: a ladder where nothing ever changes is as obvious as an
-- online count that never moves. bot_ladder_tick() plays a handful of
-- bot-against-bot results every few minutes and settles them with the
-- same Elo maths apply_elo uses, so positions shift, win counts climb
-- and the board looks alive between visits.
--
-- Nothing here touches a human's rating. Every statement joins through
-- `bots`, and a real player's row is never in that set — their ratings
-- move only through apply_elo, from a result the server established.
--
-- Apply after 0012_bot_schedule.sql.
-- ============================================================

-- ------------------------------------------------------------
-- One-shot: give every bot a record to stand on.
--
-- Win rate follows rating, so the board is internally consistent —
-- a 1700 with a losing record is the sort of thing people notice.
-- ------------------------------------------------------------
create or replace function public.bot_seed_history()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  /* v_ prefixes are not decoration. plpgsql resolves a bare `played`
     in `set played = played` against the column, not the variable, and
     raises on the ambiguity — so a local must never share a name with
     a column it is about to write. */
  v_played int; v_wins int; v_draws int; v_losses int;
  v_rate   numeric;
  n        int := 0;
begin
  for r in
    select rt.user_id, rt.game, rt.rating
      from ratings rt
      join bots b on b.user_id = rt.user_id and b.game = rt.game
     where rt.played = 0
  loop
    -- a long tail: most bots have played a bit, a few a great deal
    v_played := 8 + (random() * random() * 230)::int;
    v_rate   := least(0.72, greatest(0.28, 0.5 + (r.rating - 1200) / 2600.0));
    v_draws  := (v_played * 0.05)::int;
    v_wins   := least(v_played - v_draws,
                      greatest(0, round((v_played - v_draws) * v_rate)::int));
    v_losses := v_played - v_draws - v_wins;

    update ratings
       set played = v_played, wins = v_wins, losses = v_losses, draws = v_draws,
           peak = greatest(peak, r.rating + (random() * 40)::int),
           updated_at = now() - make_interval(mins => (random() * 4000)::int)
     where user_id = r.user_id and game = r.game;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------
-- Ongoing: bots play each other, quietly, and the board moves.
--
-- No match rows are written. These are not games anybody could have
-- watched or joined — only the ladder standings move, which is the
-- part a visitor sees.
-- ------------------------------------------------------------
create or replace function public.bot_ladder_tick(p_rounds int default 7)
returns int
language plpgsql security definer set search_path = public as $$
declare
  g   text;
  a   record;
  b   record;
  ea  numeric;   -- a's expected score
  sa  numeric;   -- a's actual score
  na  int; nb int;
  i   int;
  n   int := 0;
begin
  for i in 1..p_rounds loop
    select bb.game into g from bots bb order by random() limit 1;
    if not found then return n; end if;

    select rt.user_id, rt.rating, rt.played into a
      from ratings rt join bots bb
        on bb.user_id = rt.user_id and bb.game = rt.game
     where rt.game = g
     order by random() limit 1;
    if not found then continue; end if;

    -- an opponent close enough that the pairing is plausible
    select rt.user_id, rt.rating, rt.played into b
      from ratings rt join bots bb
        on bb.user_id = rt.user_id and bb.game = rt.game
     where rt.game = g and rt.user_id <> a.user_id
       and abs(rt.rating - a.rating) < 220
     order by random() limit 1;
    if not found then continue; end if;

    ea := 1.0 / (1.0 + power(10.0, (b.rating - a.rating)::numeric / 400.0));
    if random() < 0.06 then sa := 0.5;                 -- draws happen
    elsif random() < ea then sa := 1.0;
    else sa := 0.0;
    end if;

    na := greatest(100, round(a.rating + k_factor(a.rating, a.played) * (sa - ea)));
    nb := greatest(100, round(b.rating + k_factor(b.rating, b.played) * ((1.0 - sa) - (1.0 - ea))));

    update ratings set
      rating = na, played = played + 1,
      wins   = wins   + (case when sa = 1.0 then 1 else 0 end),
      losses = losses + (case when sa = 0.0 then 1 else 0 end),
      draws  = draws  + (case when sa = 0.5 then 1 else 0 end),
      peak = greatest(peak, na), updated_at = now()
     where user_id = a.user_id and game = g;

    update ratings set
      rating = nb, played = played + 1,
      wins   = wins   + (case when sa = 0.0 then 1 else 0 end),
      losses = losses + (case when sa = 1.0 then 1 else 0 end),
      draws  = draws  + (case when sa = 0.5 then 1 else 0 end),
      peak = greatest(peak, nb), updated_at = now()
     where user_id = b.user_id and game = g;

    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.bot_seed_history()   from public, anon, authenticated;
revoke execute on function public.bot_ladder_tick(int) from public, anon, authenticated;
grant  execute on function public.bot_seed_history()   to service_role;
grant  execute on function public.bot_ladder_tick(int) to service_role;

-- ------------------------------------------------------------
-- Schedule. Slower than presence: a ladder that visibly churns every
-- thirty seconds looks stranger than one that never moves.
-- ------------------------------------------------------------
do $$
begin
  perform cron.unschedule('oddboards-ladder');
exception when others then
  null;
end $$;

select cron.schedule(
  'oddboards-ladder',
  '*/4 * * * *',
  $$select public.bot_ladder_tick(7)$$
);

-- Populate whatever is already seeded. Safe to re-run: it only touches
-- rows still sitting at played = 0.
select public.bot_seed_history();
