-- ============================================================
-- Phase 3a: ratings.
--
-- Standard Elo, one rating per player per game. Nothing here is
-- callable by a client — ratings move only inside apply_elo, which
-- runs from a result the server established for itself.
--
-- Apply: paste into the Supabase SQL editor, or `supabase db push`.
-- ============================================================

create table if not exists public.ratings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game    text not null,
  rating  int  not null default 1200,
  played  int  not null default 0,
  wins    int  not null default 0,
  losses  int  not null default 0,
  draws   int  not null default 0,
  peak    int  not null default 1200,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);

create index if not exists ratings_leaderboard
  on public.ratings (game, rating desc);

alter table public.ratings enable row level security;

-- Ratings are public to read...
drop policy if exists "ratings are readable by everyone" on public.ratings;
create policy "ratings are readable by everyone"
  on public.ratings for select using (true);

-- ...and writable by nobody. There is no insert/update/delete policy and
-- no such grant. This is the whole security model for the leaderboard.
grant select on public.ratings to anon, authenticated;

-- ------------------------------------------------------------
-- K-factor: generous while provisional, tight at the top
-- ------------------------------------------------------------
create or replace function public.k_factor(p_rating int, p_played int)
returns int language sql immutable as $$
  select case
           when p_played < 20  then 40
           when p_rating >= 2100 then 16
           else 24
         end;
$$;

-- ------------------------------------------------------------
-- apply_elo — both sides, one transaction, idempotent by caller
--
-- The caller must already have set matches.result and must only call
-- this once (record_result and resign guard on state).
-- ------------------------------------------------------------
create or replace function public.apply_elo(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m   public.matches%rowtype;
  rb  int; rr  int;      -- ratings before
  pb  int; pr  int;      -- games played before
  eb  numeric;           -- blue's expected score
  s   numeric;           -- blue's actual score
  nb  int; nr  int;      -- ratings after
begin
  select * into m from matches where id = p_match;
  if not found or not m.rated or m.result is null then return; end if;
  if m.blue is null or m.red is null then return; end if;

  insert into ratings (user_id, game) values (m.blue, m.game) on conflict do nothing;
  insert into ratings (user_id, game) values (m.red,  m.game) on conflict do nothing;

  -- lock both rows in a stable order so two matches finishing at once
  -- cannot deadlock against each other
  perform 1 from ratings
   where game = m.game and user_id in (m.blue, m.red)
   order by user_id
     for update;

  select rating, played into rb, pb from ratings where user_id = m.blue and game = m.game;
  select rating, played into rr, pr from ratings where user_id = m.red  and game = m.game;

  eb := 1.0 / (1.0 + power(10.0, (rr - rb)::numeric / 400.0));
  s  := case m.result when 'blue' then 1.0 when 'draw' then 0.5 else 0.0 end;

  nb := greatest(100, round(rb + k_factor(rb, pb) * (s - eb)));
  nr := greatest(100, round(rr + k_factor(rr, pr) * ((1.0 - s) - (1.0 - eb))));

  update ratings set
    rating = nb,
    played = played + 1,
    wins   = wins   + (case when m.result = 'blue' then 1 else 0 end),
    losses = losses + (case when m.result = 'red'  then 1 else 0 end),
    draws  = draws  + (case when m.result = 'draw' then 1 else 0 end),
    peak   = greatest(peak, nb),
    updated_at = now()
  where user_id = m.blue and game = m.game;

  update ratings set
    rating = nr,
    played = played + 1,
    wins   = wins   + (case when m.result = 'red'  then 1 else 0 end),
    losses = losses + (case when m.result = 'blue' then 1 else 0 end),
    draws  = draws  + (case when m.result = 'draw' then 1 else 0 end),
    peak   = greatest(peak, nr),
    updated_at = now()
  where user_id = m.red and game = m.game;

  update matches
     set blue_delta = nb - rb,
         red_delta  = nr - rr
   where id = p_match;
end $$;

alter table public.matches
  add column if not exists blue_delta int,
  add column if not exists red_delta  int;

revoke execute on function public.apply_elo(uuid)     from public, anon, authenticated;
revoke execute on function public.k_factor(int, int)  from public, anon, authenticated;
