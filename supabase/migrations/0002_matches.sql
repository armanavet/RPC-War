-- ============================================================
-- Phase 2: matches on Supabase.
--
-- Online play moves off Firebase. A match row is the single source
-- of truth; both clients replay `moves` from the start, exactly as
-- they did before, but now the server decides who may append.
--
-- Still unrated. Verification and Elo are phase 3.
--
-- Apply: paste into the Supabase SQL editor, or `supabase db push`.
-- ============================================================

create type match_state as enum ('lobby','live','finished','aborted');

create table public.matches (
  id      uuid primary key default gen_random_uuid(),
  code    text unique,                        -- invite code; null once matchmaking exists
  game    text not null,
  blue    uuid not null references public.profiles(id) on delete cascade,
  red     uuid references public.profiles(id) on delete cascade,
  rated   boolean not null default false,     -- phase 3
  state   match_state not null default 'lobby',
  moves   int[] not null default '{}',        -- packed from*81 + to, same as the client
  result  text,                               -- 'blue' | 'red' | 'draw'
  reason  text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index on public.matches (blue, created_at desc);
create index on public.matches (red,  created_at desc);
create index on public.matches (code) where code is not null;

create table public.match_chat (
  id       bigserial primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  author   uuid not null references public.profiles(id) on delete cascade,
  body     text not null check (length(body) between 1 and 200),
  created_at timestamptz not null default now()
);

create index on public.match_chat (match_id, id);

-- ------------------------------------------------------------
-- Row level security
--
-- Reads are for participants. There are no write policies at all —
-- every mutation goes through a security-definer function below.
-- ------------------------------------------------------------
alter table public.matches    enable row level security;
alter table public.match_chat enable row level security;

create policy "participants read their match"
  on public.matches for select
  using (blue = auth.uid() or red = auth.uid());

create policy "participants read their chat"
  on public.match_chat for select
  using (exists (
    select 1 from public.matches m
     where m.id = match_chat.match_id
       and (m.blue = auth.uid() or m.red = auth.uid())));

grant select on public.matches    to authenticated;
grant select on public.match_chat to authenticated;
-- deliberately no insert / update / delete to anyone

-- Realtime needs the full row on the wire for RLS to be applied to
-- update events reliably. These rows are small.
alter table public.matches    replica identity full;
alter table public.match_chat replica identity full;

alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_chat;

-- ------------------------------------------------------------
-- Invite codes
-- ------------------------------------------------------------
create or replace function public.gen_match_code()
returns text language sql volatile as $$
  -- no look-alike characters: I, O, 0 and 1 are all absent
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32)::int + 1, 1), '')
  from generate_series(1, 6);
$$;

-- ------------------------------------------------------------
-- create_match — you are blue, and you wait in the lobby
-- ------------------------------------------------------------
create or replace function public.create_match(p_game text)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches%rowtype;
  c text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  for i in 1..10 loop                     -- unique() is the real guard; this just retries
    c := gen_match_code();
    begin
      insert into matches (code, game, blue, state)
      values (c, p_game, auth.uid(), 'lobby')
      returning * into m;
      return m;
    exception when unique_violation then
      -- try another code
    end;
  end loop;
  raise exception 'could not allocate a match code';
end $$;

-- ------------------------------------------------------------
-- join_match — you are red, and the game starts
-- ------------------------------------------------------------
create or replace function public.join_match(p_code text)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select * into m from matches where code = upper(p_code) for update;
  if not found then raise exception 'no such game'; end if;

  -- rejoining your own match is fine; it is how a refresh recovers
  if m.blue = auth.uid() or m.red = auth.uid() then return m; end if;

  if m.red is not null then raise exception 'that game is full'; end if;

  update matches set red = auth.uid(), state = 'live'
   where id = m.id returning * into m;
  return m;
end $$;

-- ------------------------------------------------------------
-- play_move — authorship and ordering only
--
-- This does NOT check that the move is legal. Legality is settled
-- once, by replaying the whole game server-side, in phase 3. What
-- it does guarantee is that only you can move on your turn, which
-- is what stops an opponent writing your moves for you.
-- ------------------------------------------------------------
create or replace function public.play_move(p_match uuid, p_move int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m    public.matches%rowtype;
  seat int;
  n    int;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_move < 0 or p_move > 6560 then raise exception 'move out of range'; end if;

  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.state <> 'live' then raise exception 'match is not live'; end if;

  seat := case when m.blue = auth.uid() then 0
               when m.red  = auth.uid() then 1 end;
  if seat is null then raise exception 'you are not in this match'; end if;

  n := coalesce(array_length(m.moves, 1), 0);   -- blue plays the even indices
  if (n % 2) <> seat then raise exception 'not your turn'; end if;

  update matches set moves = moves || p_move where id = p_match;
end $$;

-- ------------------------------------------------------------
-- rematch — same room, same seats, empty board
-- ------------------------------------------------------------
create or replace function public.rematch(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype;
begin
  select * into m from matches where id = p_match for update;
  if not found then raise exception 'no such match'; end if;
  if m.blue <> auth.uid() and m.red <> auth.uid() then
    raise exception 'you are not in this match';
  end if;
  if m.red is null then raise exception 'nobody has joined yet'; end if;

  update matches
     set moves = '{}', result = null, reason = null,
         state = 'live', finished_at = null
   where id = p_match;
end $$;

-- ------------------------------------------------------------
-- send_chat
-- ------------------------------------------------------------
create or replace function public.send_chat(p_match uuid, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select * into m from matches where id = p_match;
  if not found then raise exception 'no such match'; end if;
  if m.blue <> auth.uid() and m.red <> auth.uid() then
    raise exception 'you are not in this match';
  end if;

  insert into match_chat (match_id, author, body)
  values (p_match, auth.uid(), left(btrim(p_body), 200));
end $$;

-- ------------------------------------------------------------
-- Only signed-in callers, and only through these functions.
-- ------------------------------------------------------------
revoke execute on function public.create_match(text) from public, anon;
revoke execute on function public.join_match(text)   from public, anon;
revoke execute on function public.play_move(uuid,int) from public, anon;
revoke execute on function public.rematch(uuid)      from public, anon;
revoke execute on function public.send_chat(uuid,text) from public, anon;
revoke execute on function public.gen_match_code()   from public, anon, authenticated;

grant execute on function public.create_match(text)   to authenticated;
grant execute on function public.join_match(text)     to authenticated;
grant execute on function public.play_move(uuid,int)  to authenticated;
grant execute on function public.rematch(uuid)        to authenticated;
grant execute on function public.send_chat(uuid,text) to authenticated;
