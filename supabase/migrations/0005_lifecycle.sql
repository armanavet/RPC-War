-- ============================================================
-- Phase 3b: how a match actually ends.
--
-- Three ways out, and none of them is "one player presses a button
-- and the board resets":
--
--   played out  the client asks the finish-match edge function, which
--               replays the moves itself and records what it found
--   resign      immediate, and it counts as a loss
--   rematch     an offer the other player has to accept, which starts
--               a NEW match rather than erasing the old one
--
-- Apply after 0004_ratings.sql.
-- ============================================================

alter table public.matches
  add column if not exists rematch_offer uuid references public.profiles(id),
  add column if not exists next_match    uuid references public.matches(id);

-- ------------------------------------------------------------
-- A match is rated only between two distinct real accounts.
-- Guests never affect anyone's rating.
-- ------------------------------------------------------------
create or replace function public.join_match(p_code text)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  both_real boolean;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select * into m from matches where code = upper(p_code) for update;
  if not found then raise exception 'no such game'; end if;

  -- rejoining your own match is fine; it is how a refresh recovers
  if m.blue = auth.uid() or m.red = auth.uid() then return m; end if;
  if m.red is not null then raise exception 'that game is full'; end if;
  if m.blue = auth.uid() then raise exception 'you cannot join your own game'; end if;

  select count(*) = 2 into both_real
    from profiles where id in (m.blue, auth.uid()) and not is_guest;

  update matches
     set red = auth.uid(),
         state = 'live',
         rated = both_real
   where id = m.id returning * into m;
  return m;
end $$;

-- ------------------------------------------------------------
-- record_result — the edge function's way in.
--
-- Deliberately NOT callable by a player: it is the one place a
-- result can be written, and the caller has to be trusted to have
-- verified it. The edge function uses the service role.
-- ------------------------------------------------------------
create or replace function public.record_result(
  p_match uuid, p_result text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype;
begin
  if p_result not in ('blue','red','draw') then
    raise exception 'bad result %', p_result;
  end if;

  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.state <> 'live' then return; end if;      -- idempotent: both clients may call

  update matches
     set state = 'finished', result = p_result, reason = p_reason,
         finished_at = now()
   where id = p_match;

  perform apply_elo(p_match);
end $$;

-- The edge function may also void a game whose moves do not replay.
create or replace function public.void_match(p_match uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update matches
     set state = 'aborted', reason = p_reason, finished_at = now()
   where id = p_match and state = 'live';
end $$;

-- ------------------------------------------------------------
-- resign — no verification needed to concede
-- ------------------------------------------------------------
create or replace function public.resign(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  loser_is_blue boolean;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.state <> 'live' then raise exception 'match is not live'; end if;

  loser_is_blue := (m.blue = auth.uid());
  if not loser_is_blue and m.red <> auth.uid() then
    raise exception 'you are not in this match';
  end if;

  update matches
     set state = 'finished',
         result = case when loser_is_blue then 'red' else 'blue' end,
         reason = 'resign',
         finished_at = now()
   where id = p_match;

  perform apply_elo(p_match);
end $$;

-- ------------------------------------------------------------
-- Rematch, by consent.
--
-- The old, broken one reset a live board on one player's say-so.
-- It is replaced, not patched.
-- ------------------------------------------------------------
drop function if exists public.rematch(uuid);

create or replace function public.offer_rematch(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.blue <> auth.uid() and m.red <> auth.uid() then
    raise exception 'you are not in this match';
  end if;
  if m.state <> 'finished' then raise exception 'the game is not over'; end if;

  update matches set rematch_offer = auth.uid() where id = p_match;
end $$;

create or replace function public.accept_rematch(p_match uuid)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m   public.matches%rowtype;
  new_m public.matches%rowtype;
  c   text;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.state <> 'finished' then raise exception 'the game is not over'; end if;
  if m.blue <> auth.uid() and m.red <> auth.uid() then
    raise exception 'you are not in this match';
  end if;
  if m.rematch_offer is null then raise exception 'nobody offered a rematch'; end if;
  if m.rematch_offer = auth.uid() then raise exception 'wait for them to accept'; end if;

  -- someone accepted a moment ago: send both players to the same place
  if m.next_match is not null then
    select * into new_m from matches where id = m.next_match;
    return new_m;
  end if;

  for i in 1..10 loop
    c := gen_match_code();
    begin
      -- seats swap, so nobody keeps whatever edge moving first is worth
      insert into matches (code, game, blue, red, rated, state)
      values (c, m.game, m.red, m.blue, m.rated, 'live')
      returning * into new_m;
      exit;
    exception when unique_violation then
    end;
  end loop;
  if new_m.id is null then raise exception 'could not allocate a match code'; end if;

  update matches set next_match = new_m.id, rematch_offer = null where id = p_match;
  return new_m;
end $$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
revoke execute on function public.record_result(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.void_match(uuid,text)         from public, anon, authenticated;
revoke execute on function public.resign(uuid)                  from public, anon;
revoke execute on function public.offer_rematch(uuid)           from public, anon;
revoke execute on function public.accept_rematch(uuid)          from public, anon;

grant execute on function public.record_result(uuid,text,text) to service_role;
grant execute on function public.void_match(uuid,text)         to service_role;
grant execute on function public.resign(uuid)                  to authenticated;
grant execute on function public.offer_rematch(uuid)           to authenticated;
grant execute on function public.accept_rematch(uuid)          to authenticated;
