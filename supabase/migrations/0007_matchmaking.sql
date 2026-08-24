-- ============================================================
-- Phase 4: random matchmaking.
--
-- And with it, the fix for the farming hole: rated play now means
-- matchmade play. An invite link is always a friendly game, so two
-- friends can no longer trade wins into the leaderboard.
--
-- Apply after 0006_abandon.sql.
-- ============================================================

create table if not exists public.queue (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  game      text not null,
  rating    int  not null,
  joined_at timestamptz not null default now()
);

create index if not exists queue_game_rating on public.queue (game, rating);

alter table public.queue enable row level security;

drop policy if exists "you see your own queue row" on public.queue;
create policy "you see your own queue row"
  on public.queue for select using (user_id = auth.uid());

grant select on public.queue to authenticated;
-- inserts and deletes go through the functions below

-- ------------------------------------------------------------
-- Invite links are never rated any more.
-- ------------------------------------------------------------
create or replace function public.join_match(p_code text)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select * into m from matches where code = upper(p_code) for update;
  if not found then raise exception 'no such game'; end if;

  if m.blue = auth.uid() or m.red = auth.uid() then return m; end if;
  if m.red is not null then raise exception 'that game is full'; end if;

  update matches set red = auth.uid(), state = 'live', rated = false
   where id = m.id returning * into m;
  return m;
end $$;

-- ------------------------------------------------------------
-- The search window, widening while you wait.
-- ±50 at 0s, ±400 by about seventy seconds.
-- ------------------------------------------------------------
create or replace function public.band(p_since timestamptz)
returns int language sql stable as $$
  select least(50 + 25 * ((extract(epoch from now() - p_since))::int / 5), 400);
$$;

-- ------------------------------------------------------------
-- find_match — call it, then keep calling it.
--
-- Returns a match id once you are paired, null while you wait. The
-- first call puts you in the queue; later ones do not reset your
-- joined_at, so your band keeps widening while you poll.
-- ------------------------------------------------------------
create or replace function public.find_match(p_game text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  my_rating int;
  guest     boolean;
  opp       public.queue%rowtype;
  m_id      uuid;
  c         text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select is_guest into guest from profiles where id = auth.uid();
  if guest then raise exception 'ranked play needs an account'; end if;

  delete from queue where joined_at < now() - interval '5 minutes';

  select rating into my_rating from ratings
   where user_id = auth.uid() and game = p_game;
  my_rating := coalesce(my_rating, 1200);

  -- SKIP LOCKED is the whole trick: two players hitting this at the same
  -- instant cannot both claim the same third player.
  select * into opp from queue
   where game = p_game
     and user_id <> auth.uid()
     and abs(rating - my_rating) <= greatest(band(now()), band(joined_at))
   order by abs(rating - my_rating), joined_at
   for update skip locked
   limit 1;

  if not found then
    insert into queue (user_id, game, rating)
    values (auth.uid(), p_game, my_rating)
    on conflict (user_id) do update set game = excluded.game, rating = excluded.rating;
    return null;
  end if;

  delete from queue where user_id in (opp.user_id, auth.uid());

  for i in 1..10 loop
    c := gen_match_code();
    begin
      -- seats at random: moving first is worth something
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
end $$;

create or replace function public.leave_queue()
returns void
language sql security definer set search_path = public as $$
  delete from queue where user_id = auth.uid();
$$;

/* While you are queued, this is how you learn you were paired by
   somebody else's call to find_match. */
create or replace function public.my_live_match(p_game text)
returns uuid
language sql security definer set search_path = public as $$
  select id from matches
   where game = p_game
     and state = 'live'
     and rated
     and (blue = auth.uid() or red = auth.uid())
   order by created_at desc
   limit 1;
$$;

revoke execute on function public.find_match(text)     from public, anon;
revoke execute on function public.leave_queue()        from public, anon;
revoke execute on function public.my_live_match(text)  from public, anon;
revoke execute on function public.band(timestamptz)    from public, anon, authenticated;

grant execute on function public.find_match(text)    to authenticated;
grant execute on function public.leave_queue()       to authenticated;
grant execute on function public.my_live_match(text) to authenticated;
