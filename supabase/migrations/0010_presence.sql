-- ============================================================
-- Who is around right now.
--
-- Two numbers: how many people are on the site, and how many are
-- on each game's screen. Both come out of one small table of
-- heartbeats that expire on their own.
--
-- Design notes, because this one breaks a pattern on purpose:
--
--  * Keyed by a browser-generated `client` uuid, NOT auth.uid().
--    Presence has to count the person playing the computer and the
--    person just reading the rules, and neither of those has a
--    session. Minting an anonymous auth user per visitor merely to
--    colour in a counter would be a much worse trade.
--
--  * Therefore the counts are advisory. A determined caller can
--    post a spray of made-up uuids and inflate them. That is
--    acceptable *here* and nowhere else in this schema: nothing
--    reads this table to decide anything — not results, not
--    ratings, not matchmaking. It is decoration. Keep it that way.
--
--  * The table itself is unreachable: RLS on, no policy, no grant.
--    Both entry points are security definer functions, and the read
--    one returns aggregates only. Nobody can enumerate who is here,
--    which is the property that matters.
--
-- Apply after 0009_service_role_grants.sql.
-- ============================================================

create table if not exists public.presence (
  client  uuid primary key,
  room    text not null,
  seen_at timestamptz not null default now()
);

create index if not exists presence_seen on public.presence (seen_at desc);

-- On, with no policy at all: the table is reachable only through the
-- two functions below, which run as their owner.
alter table public.presence enable row level security;

-- ------------------------------------------------------------
-- heartbeat — "I am still here, and I am on this screen"
-- ------------------------------------------------------------
create or replace function public.heartbeat(p_client uuid, p_room text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_client is null then raise exception 'client required'; end if;
  if p_room is null or btrim(p_room) = '' then raise exception 'room required'; end if;

  insert into presence (client, room, seen_at)
  values (p_client, left(btrim(p_room), 40), now())
  on conflict (client) do update
    set room = excluded.room, seen_at = now();

  -- the table stays small enough that sweeping it here is cheaper
  -- than owning a scheduled job
  delete from presence where seen_at < now() - interval '5 minutes';
end $$;

-- ------------------------------------------------------------
-- online_counts — aggregates only, never rows
--
--   {"total": 12, "rooms": {"rps-chess": 3}}
--
-- A client counts as present for 60s after its last heartbeat, so
-- the browser beating every ~25s survives one dropped request.
-- ------------------------------------------------------------
create or replace function public.online_counts()
returns json
language sql stable security definer set search_path = public as $$
  with live as (
    select room from presence where seen_at > now() - interval '60 seconds'
  )
  select json_build_object(
    'total', (select count(*) from live),
    'rooms', coalesce(
      (select json_object_agg(room, n)
         from (select room, count(*) as n from live group by room) s),
      '{}'::json)
  );
$$;

-- ------------------------------------------------------------
-- Grants, spelled out — including service_role.
--
-- This project runs with *automatically expose new tables* off, so
-- nothing is granted by default to anyone, service_role included.
-- Forgetting that is what broke finish-match; see 0009. Nothing
-- server-side reads presence today, so service_role is deliberately
-- given execute on the read function only, and no table rights.
-- ------------------------------------------------------------
revoke execute on function public.heartbeat(uuid, text) from public;
revoke execute on function public.online_counts()       from public;

grant execute on function public.heartbeat(uuid, text) to anon, authenticated;
grant execute on function public.online_counts()       to anon, authenticated, service_role;
