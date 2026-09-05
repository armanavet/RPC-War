-- ============================================================
-- Four wargames join the site: salient, tideline, breakthrough, barbican.
--
-- Almost nothing is needed. matches.game, ratings.game, queue.game
-- and bots.game are all plain `text` with no check constraint, and
-- create_match, find_match, pick_bot and my_live_match all take
-- `p_game text`, so a new slug works the moment the client asks for
-- it. That was a deliberate property of 0002 and it has now paid for
-- itself three times over.
--
-- The one thing that does hardcode the list of games is the synthetic
-- online counter, which splits an invented crowd between named rooms.
-- Without this migration the three new games show an online count of
-- zero for ever, which is worse than showing nothing.
--
-- Apply after 0014_bot_reap.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Spread the crowd across five games instead of two.
--
-- Each game's share drifts on its own clock so the split never sits
-- at a fixed ratio, which is as much of a tell as a fixed total. The
-- three wargames get a smaller share than the two quick games, and
-- deservedly: a twenty-minute game has fewer people in it at any
-- instant than a five-minute one, and a counter that says otherwise
-- is a counter nobody believes.
-- ------------------------------------------------------------
create or replace function public.bot_presence_tick(target int)
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  i int;
  h int;
  bucket int := (extract(epoch from now()) / 60)::int;
  home_pct int;
  cuts int[];
  rooms text[] := array['rps-chess','anvil','salient','tideline','breakthrough','barbican'];
  weights numeric[];
  total numeric;
  acc numeric;
  rm text;
begin
  home_pct := 12 + (5 * sin(extract(epoch from now()) / 1700))::int;

  /* Relative popularity, each drifting on its own period. The quick
     games carry most of it; the wargames share what is left. */
  weights := array[
    34 + 9 * sin(extract(epoch from now()) / 1103),
    24 + 7 * sin(extract(epoch from now()) / 1487),
    12 + 5 * sin(extract(epoch from now()) / 1291),
    10 + 4 * sin(extract(epoch from now()) / 1621),
    10 + 4 * sin(extract(epoch from now()) / 1913),
    10 + 4 * sin(extract(epoch from now()) / 1741)
  ];
  total := 0;
  for i in 1..array_length(weights,1) loop total := total + weights[i]; end loop;

  /* Cumulative cut points across the non-home share, as percentages. */
  cuts := array[]::int[];
  acc := 0;
  for i in 1..array_length(weights,1) loop
    acc := acc + weights[i];
    cuts := cuts || (home_pct + ((100 - home_pct) * acc / total))::int;
  end loop;

  for i in 1..target loop
    h := abs(hashtext(i::text || ':' || bucket::text)) % 100;
    if h < home_pct then
      rm := 'home';
    else
      rm := rooms[array_length(rooms,1)];
      for n in 1..array_length(cuts,1) loop
        if h < cuts[n] then rm := rooms[n]; exit; end if;
      end loop;
    end if;
    insert into presence (client, room, seen_at)
    values (bot_client_id(i), rm, now())
    on conflict (client) do update set seen_at = now(), room = excluded.room;
    n := n + 1;
  end loop;

  return n;
end $$;

revoke all on function public.bot_presence_tick(int) from public, anon, authenticated;
grant execute on function public.bot_presence_tick(int) to service_role;
