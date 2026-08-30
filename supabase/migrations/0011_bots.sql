-- ============================================================
-- Bots: a lobby that is never empty, and a ranked game that is
-- always available.
--
-- Two independent halves, on purpose:
--
--   1. The online count. Synthetic presence rows on a daily curve.
--      Needs no accounts and no scheduling beyond one cron job, so
--      the number is real the moment this migration is applied.
--
--   2. Playable opponents. These DO need real profiles, because
--      matches.blue/red are foreign keys to profiles, and profiles.id
--      is a foreign key to auth.users. Seeding them therefore has to
--      happen through the Auth admin API — see tools/seed-bots.mjs.
--      Until that has run, find_match behaves exactly as it does now.
--
-- Indistinguishability is enforced by the database, not by
-- remembering to filter a column. A bot's profile row is an ordinary
-- profile; everything that marks it as a bot lives in a table with no
-- grants to anon or authenticated, so no client can read it at all.
--
-- Apply after 0010_presence.sql.
-- ============================================================

-- ------------------------------------------------------------
-- The registry. No policy, no grant: unreachable from any client.
-- ------------------------------------------------------------
create table if not exists public.bots (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  game      text not null,
  -- search depth and time budget, tuned to sit near the displayed rating
  depth     int  not null default 3,
  budget_ms int  not null default 700,
  -- chance of taking the second- or third-best move instead of the best
  blunder   numeric not null default 0.10 check (blunder >= 0 and blunder <= 1),
  -- think time, log-normal-ish: base seconds and spread
  tempo_ms  int  not null default 2600,
  tempo_var numeric not null default 0.7,
  -- how far behind before it considers resigning, and how often it does
  resign_at int  not null default -900,
  resign_p  numeric not null default 0.5,
  -- which hours (UTC) this persona tends to be around, as a 24-bit mask
  hours     int  not null default 16777215,
  created_at timestamptz not null default now()
);

create index if not exists bots_game on public.bots (game);

alter table public.bots enable row level security;
-- deliberately no policy and no grant

-- ------------------------------------------------------------
-- 1. The online count.
--
-- presence is keyed by a browser-generated uuid rather than a user,
-- which is what makes this possible without accounts. The cohort is
-- derived from a fixed seed so the same "people" persist between
-- ticks instead of the whole crowd being replaced every minute.
--
-- The shape matters more than the number. A count pinned at exactly
-- 100, or one that never moves, is the tell.
-- ------------------------------------------------------------
create or replace function public.bot_cohort_size()
returns int
language sql volatile set search_path = public as $$
  /* Four components, none of them in step with the others:

       - the daily curve, quiet around 04:00 UTC and busiest near 20:00.
         Fed by hour *plus minutes* so it slides continuously instead of
         stepping once an hour.
       - a ~15 minute swell, the shape a room full of people has.
       - a ~4 minute ripple on top of that.
       - a couple of players of pure jitter each tick.

     Periods are deliberately not multiples of each other, so the sum
     never repeats a recognisable pattern. */
  select greatest(100, (
      195
    -- -cos, not sin: this has to bottom out at 04:00 and peak at 16:00.
    -- With sin it peaked in the morning and troughed at night, which
    -- put the whole evening on the floor and froze the number solid.
    - (52 * cos(((extract(hour from now() at time zone 'utc')
                  + extract(minute from now()) / 60.0) - 4) * pi() / 12))::int
    + (21 * sin(extract(epoch from now()) / 911))::int
    + (11 * sin(extract(epoch from now()) / 233))::int
    + (random() * 9 - 4)::int
  ))::int;
$$;

/* Deterministic uuid for cohort member n, so the same clients stay
   present across ticks. */
create or replace function public.bot_client_id(n int)
returns uuid
language sql immutable as $$
  select md5('oddboards-presence-' || n::text)::uuid;
$$;

create or replace function public.bot_presence_tick()
returns int
language plpgsql security definer set search_path = public as $$
declare
  target   int := bot_cohort_size();
  -- Membership of a room is stable inside a three-minute bucket and
  -- reshuffles at the boundary, so people drift between pages rather
  -- than teleporting every thirty seconds.
  bucket   int := (extract(epoch from now()) / 180)::int;
  home_pct int;
  rps_pct  int;
  i int; h int; rm text; n int := 0;
begin
  /* How the crowd is spread right now. Each share drifts on its own
     clock, so the two games do not rise and fall together — a split
     that stays at a fixed ratio is as much of a tell as a fixed total.

     Most of them are in a game. People do not linger on a landing page;
     they arrive, pick something and play it, so home is a small slice
     of passers-by rather than the majority. */
  home_pct := 14 + (6 * sin(extract(epoch from now()) / 1700))::int;
  rps_pct  := home_pct + (((100 - home_pct)
              * (52 + (14 * sin(extract(epoch from now()) / 1103))::int)) / 100)::int;

  for i in 1..target loop
    h  := abs(hashtext(i::text || ':' || bucket::text)) % 100;
    rm := case when h < home_pct then 'home'
               when h < rps_pct  then 'rps-chess'
               else 'anvil' end;
    insert into presence (client, room, seen_at)
    values (bot_client_id(i), rm, now())
    on conflict (client) do update set seen_at = now(), room = excluded.room;
    n := n + 1;
  end loop;

  -- anyone above the current target ages out on their own (60s window)
  return n;
end $$;

/* All three are lockable and all three should be locked: bot_cohort_size
   returns the manufactured target, which is exactly the thing a curious
   visitor should not be able to ask for. */
revoke execute on function public.bot_presence_tick() from public, anon, authenticated;
revoke execute on function public.bot_cohort_size()   from public, anon, authenticated;
revoke execute on function public.bot_client_id(int)  from public, anon, authenticated;
grant  execute on function public.bot_presence_tick() to service_role;

-- ------------------------------------------------------------
-- 2. Playable opponents.
--
-- Pick a bot for this game near the caller's rating, that is not
-- already mid-game and was not their last opponent.
-- ------------------------------------------------------------
create or replace function public.pick_bot(p_game text, p_rating int, p_avoid uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select b.user_id
    from bots b
    join ratings r on r.user_id = b.user_id and r.game = b.game
   where b.game = p_game
     and (p_avoid is null or b.user_id <> p_avoid)
     -- present at this hour, so a persona is not on call around the clock
     and (b.hours & (1 << extract(hour from now() at time zone 'utc')::int)) <> 0
     -- never two games at once
     and not exists (
       select 1 from matches m
        where m.state = 'live' and (m.blue = b.user_id or m.red = b.user_id))
   order by abs(r.rating - p_rating), random()
   limit 1;
$$;

revoke execute on function public.pick_bot(text, int, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- The queue row now remembers when this player stops waiting for a
-- human. Randomised: an instant pairing at four in the morning is the
-- most obvious tell there is.
-- ------------------------------------------------------------
alter table public.queue
  add column if not exists bot_after timestamptz;

create or replace function public.find_match(p_game text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  my_rating int;
  guest     boolean;
  opp       public.queue%rowtype;
  m_id      uuid;
  c         text;
  waited    timestamptz;
  bot       uuid;
  last_opp  uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select is_guest into guest from profiles where id = auth.uid();
  if guest then raise exception 'ranked play needs an account'; end if;

  delete from queue where joined_at < now() - interval '5 minutes';

  select rating into my_rating from ratings
   where user_id = auth.uid() and game = p_game;
  my_rating := coalesce(my_rating, 1200);

  -- A human first, always. SKIP LOCKED is the whole trick: two players
  -- hitting this at the same instant cannot both claim the same third.
  select * into opp from queue
   where game = p_game
     and user_id <> auth.uid()
     and abs(rating - my_rating) <= greatest(band(now()), band(joined_at))
   order by abs(rating - my_rating), joined_at
   for update skip locked
   limit 1;

  if found then
    delete from queue where user_id in (opp.user_id, auth.uid());
    for i in 1..10 loop
      c := gen_match_code();
      begin
        if random() < 0.5 then
          insert into matches (code, game, blue, red, rated, state)
          values (c, p_game, auth.uid(), opp.user_id, true, 'live') returning id into m_id;
        else
          insert into matches (code, game, blue, red, rated, state)
          values (c, p_game, opp.user_id, auth.uid(), true, 'live') returning id into m_id;
        end if;
        exit;
      exception when unique_violation then
      end;
    end loop;
    if m_id is null then raise exception 'could not allocate a match code'; end if;
    return m_id;
  end if;

  -- No human. Are we still willing to wait for one?
  select bot_after into waited from queue where user_id = auth.uid();
  if waited is null then
    /* 1.2-2.8s. The client polls every 1.2s, so the longest anyone
       actually waits is about 3.6 seconds — still randomised, because
       a pairing that always lands on the same beat is its own tell. */
    insert into queue (user_id, game, rating, bot_after)
    values (auth.uid(), p_game, my_rating,
            now() + make_interval(secs => 1.2 + random() * 1.6))
    on conflict (user_id) do update
      set game = excluded.game,
          rating = excluded.rating,
          bot_after = coalesce(queue.bot_after, excluded.bot_after);
    return null;
  end if;
  if now() < waited then return null; end if;

  -- Waited long enough. Take whoever is around.
  select case when m.blue = auth.uid() then m.red else m.blue end into last_opp
    from matches m
   where m.game = p_game and (m.blue = auth.uid() or m.red = auth.uid())
   order by m.created_at desc limit 1;

  bot := pick_bot(p_game, my_rating, last_opp);
  if bot is null then return null; end if;      -- none seeded: keep waiting

  delete from queue where user_id = auth.uid();

  for i in 1..10 loop
    c := gen_match_code();
    begin
      if random() < 0.5 then
        insert into matches (code, game, blue, red, rated, state)
        values (c, p_game, auth.uid(), bot, true, 'live') returning id into m_id;
      else
        insert into matches (code, game, blue, red, rated, state)
        values (c, p_game, bot, auth.uid(), true, 'live') returning id into m_id;
      end if;
      exit;
    exception when unique_violation then
    end;
  end loop;
  if m_id is null then raise exception 'could not allocate a match code'; end if;
  return m_id;
end $$;

revoke execute on function public.find_match(text) from public, anon;
grant  execute on function public.find_match(text) to authenticated;

-- ------------------------------------------------------------
-- Registration, used once by tools/seed-bots.mjs.
--
-- ratings has no write policy and no write grant to anybody, and that
-- is the whole security model for the leaderboard — so a starting
-- rating goes in through a definer function, exactly as every later
-- change goes through apply_elo.
-- ------------------------------------------------------------
create or replace function public.bot_register(
  p_user uuid, p_game text, p_rating int,
  p_depth int, p_budget_ms int, p_blunder numeric,
  p_tempo_ms int, p_tempo_var numeric,
  p_resign_at int, p_resign_p numeric, p_hours int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into bots (user_id, game, depth, budget_ms, blunder,
                    tempo_ms, tempo_var, resign_at, resign_p, hours)
  values (p_user, p_game, p_depth, p_budget_ms, p_blunder,
          p_tempo_ms, p_tempo_var, p_resign_at, p_resign_p, p_hours)
  on conflict (user_id) do update set
    game = excluded.game, depth = excluded.depth, budget_ms = excluded.budget_ms,
    blunder = excluded.blunder, tempo_ms = excluded.tempo_ms,
    tempo_var = excluded.tempo_var, resign_at = excluded.resign_at,
    resign_p = excluded.resign_p, hours = excluded.hours;

  insert into ratings (user_id, game, rating, peak)
  values (p_user, p_game, p_rating, p_rating)
  on conflict (user_id, game) do nothing;
end $$;

revoke execute on function public.bot_register(uuid,text,int,int,int,numeric,int,numeric,int,numeric,int)
  from public, anon, authenticated;
grant execute on function public.bot_register(uuid,text,int,int,int,numeric,int,numeric,int,numeric,int)
  to service_role;

-- ------------------------------------------------------------
-- Server-side helpers for the move runner.
--
-- is_bot_turn returns the work item the edge function needs, or
-- nothing at all — so the function never has to read the bots table
-- itself and no bot identity travels outside the database.
-- ------------------------------------------------------------
create or replace function public.bot_pending(p_match uuid)
returns table (bot uuid, game text, moves int[], seat int,
               depth int, budget_ms int, blunder numeric,
               tempo_ms int, tempo_var numeric,
               resign_at int, resign_p numeric)
language sql security definer set search_path = public as $$
  select b.user_id, m.game, coalesce(m.moves, '{}'),
         case when m.blue = b.user_id then 0 else 1 end,
         b.depth, b.budget_ms, b.blunder, b.tempo_ms, b.tempo_var,
         b.resign_at, b.resign_p
    from matches m
    join bots b on b.user_id in (m.blue, m.red)
   where m.id = p_match
     and m.state = 'live'
     -- whose turn is it? blue plays the even indices
     and (coalesce(array_length(m.moves, 1), 0) % 2)
         = (case when m.blue = b.user_id then 0 else 1 end)
   limit 1;
$$;

/* Every live match with a bot to move — the cron backstop for when a
   client never nudges (tab closed, bot moves first). */
create or replace function public.bot_pending_all()
returns table (match uuid)
language sql security definer set search_path = public as $$
  select m.id
    from matches m
    join bots b on b.user_id in (m.blue, m.red)
   where m.state = 'live'
     and (coalesce(array_length(m.moves, 1), 0) % 2)
         = (case when m.blue = b.user_id then 0 else 1 end)
   order by m.created_at
   limit 40;
$$;

/* Play as the bot. Mirrors play_move's checks rather than trusting the
   caller: still the bot's turn, still live, still its seat. */
create or replace function public.bot_play(p_match uuid, p_move int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m    public.matches%rowtype;
  bot  uuid;
  seat int;
  n    int;
begin
  if p_move < 0 or p_move > 6560 then raise exception 'move out of range'; end if;

  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.state <> 'live' then raise exception 'match is not live'; end if;

  select b.user_id into bot from bots b where b.user_id in (m.blue, m.red);
  if bot is null then raise exception 'no bot in this match'; end if;

  seat := case when m.blue = bot then 0 else 1 end;
  n := coalesce(array_length(m.moves, 1), 0);
  /* Quietly, not an exception: the nudge is fire-and-forget and two of
     them can land on the same turn. The second one has nothing to do,
     which is a no-op rather than a failure. */
  if (n % 2) <> seat then return; end if;

  update matches set moves = moves || p_move where id = p_match;

  -- Sixty seconds of silence and the human is offered "opponent left,
  -- claim the win". A bot that thinks for twenty seconds must still be
  -- visibly present, so it touches every time it moves.
  insert into match_presence (match_id, user_id, seen_at)
  values (p_match, bot, now())
  on conflict (match_id, user_id) do update set seen_at = now();
end $$;

/* Keep a thinking bot present without moving. */
create or replace function public.bot_touch(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare bot uuid;
begin
  select b.user_id into bot
    from matches m join bots b on b.user_id in (m.blue, m.red)
   where m.id = p_match and m.state = 'live';
  if bot is null then return; end if;
  insert into match_presence (match_id, user_id, seen_at)
  values (p_match, bot, now())
  on conflict (match_id, user_id) do update set seen_at = now();
end $$;

/* The bot concedes. Reuses record_result so the result is written the
   one way results are ever written. */
create or replace function public.bot_resign(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype; bot uuid;
begin
  select * into m from matches where id = p_match for update;
  if not found or m.state <> 'live' then return; end if;
  select b.user_id into bot from bots b where b.user_id in (m.blue, m.red);
  if bot is null then return; end if;
  perform record_result(p_match, case when m.blue = bot then 'red' else 'blue' end, 'resign');
end $$;

revoke execute on function public.bot_pending(uuid)     from public, anon, authenticated;
revoke execute on function public.bot_pending_all()     from public, anon, authenticated;
revoke execute on function public.bot_play(uuid, int)   from public, anon, authenticated;
revoke execute on function public.bot_touch(uuid)       from public, anon, authenticated;
revoke execute on function public.bot_resign(uuid)      from public, anon, authenticated;

grant execute on function public.bot_pending(uuid)      to service_role;
grant execute on function public.bot_pending_all()      to service_role;
grant execute on function public.bot_play(uuid, int)    to service_role;
grant execute on function public.bot_touch(uuid)        to service_role;
grant execute on function public.bot_resign(uuid)       to service_role;

-- The move runner reads these two directly with the service role, and
-- 0009 taught us that nothing is granted by default here.
grant select on public.matches  to service_role;
grant select on public.bots     to service_role;
grant select on public.ratings  to service_role;
