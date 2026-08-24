-- ============================================================
-- Abandon.
--
-- Now that resigning costs rating, closing the tab is the obvious
-- dodge — the match would otherwise sit `live` forever and neither
-- rating would move.
--
-- Presence lives in its own table on purpose: a heartbeat on
-- `matches` would broadcast over Realtime every few seconds to both
-- clients, for nothing. This table is NOT in the publication.
--
-- Apply after 0005_lifecycle.sql.
-- ============================================================

create table if not exists public.match_presence (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  seen_at  timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.match_presence enable row level security;

drop policy if exists "participants read presence" on public.match_presence;
create policy "participants read presence"
  on public.match_presence for select
  using (exists (
    select 1 from public.matches m
     where m.id = match_presence.match_id
       and (m.blue = auth.uid() or m.red = auth.uid())));

grant select on public.match_presence to authenticated;
-- writes go through touch_match only

-- how long a player may be silent before the other may claim the win
create or replace function public.abandon_seconds() returns int
language sql immutable as $$ select 60 $$;

-- ------------------------------------------------------------
-- touch_match — "I am still here"
-- ------------------------------------------------------------
create or replace function public.touch_match(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype;
begin
  if auth.uid() is null then return; end if;
  select * into m from matches where id = p_match;
  if not found or m.state <> 'live' then return; end if;
  if m.blue <> auth.uid() and m.red <> auth.uid() then return; end if;

  insert into match_presence (match_id, user_id, seen_at)
  values (p_match, auth.uid(), now())
  on conflict (match_id, user_id) do update set seen_at = now();
end $$;

-- ------------------------------------------------------------
-- claim_abandon — the server checks the clock, not the caller
-- ------------------------------------------------------------
create or replace function public.claim_abandon(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m        public.matches%rowtype;
  opponent uuid;
  last_seen timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.state <> 'live' then raise exception 'match is not live'; end if;

  opponent := case when m.blue = auth.uid() then m.red
                   when m.red  = auth.uid() then m.blue end;
  if opponent is null then raise exception 'you are not in this match'; end if;

  -- you have to have been present yourself to claim
  perform 1 from match_presence
   where match_id = p_match and user_id = auth.uid()
     and seen_at > now() - make_interval(secs => abandon_seconds());
  if not found then raise exception 'you have not been here either'; end if;

  select seen_at into last_seen from match_presence
   where match_id = p_match and user_id = opponent;

  -- never seen at all still needs the grace period, measured from the start
  if coalesce(last_seen, m.created_at) > now() - make_interval(secs => abandon_seconds()) then
    raise exception 'they are still here';
  end if;

  update matches
     set state = 'finished',
         result = case when m.blue = auth.uid() then 'blue' else 'red' end,
         reason = 'abandon',
         finished_at = now()
   where id = p_match;

  perform apply_elo(p_match);
end $$;

revoke execute on function public.touch_match(uuid)    from public, anon;
revoke execute on function public.claim_abandon(uuid)  from public, anon;
grant  execute on function public.touch_match(uuid)    to authenticated;
grant  execute on function public.claim_abandon(uuid)  to authenticated;

-- the columns from the first sketch were never used; presence lives in its own table
alter table public.matches drop column if exists blue_seen;
alter table public.matches drop column if exists red_seen;
