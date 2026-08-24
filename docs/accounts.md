# Accounts, Elo and matchmaking — plan

Target: **Supabase** (Postgres + Auth + Realtime + RLS), **OAuth** sign-in
(Google and GitHub), and **verify-on-finish** anti-cheat — the server replays a
finished game through `rules.js` before it awards any rating.

**All five phases are built.** Accounts, guest sessions, matches on
Supabase, Realtime, result verification, Elo, abandon handling, random
matchmaking and the leaderboard are all in. Match history per player is the
obvious next thing and is not built.

Sending or accepting a challenge does **not** need an account — guests get a
Supabase anonymous session, which still carries a real `auth.uid()`, so
`play_move` enforces turn authorship for them exactly as for anyone else.
Guests are flagged `profiles.is_guest` so rated play can exclude them.

### Known gap to close before phase 3

A guest who signs in with Google today gets a **new** user; the guest identity
is abandoned rather than upgraded. Harmless while guest games are unrated, but
it must become `linkIdentity()` before ratings exist, or converting a guest
throws away their record.

---

## 1. The thing that has to change first

Today every client is fully trusted. `rooms/*` is world-readable and
world-writable, and the result of a game is whatever the two browsers agree on.
That is fine for casual link games and completely unusable the moment a number
is attached to winning.

The rule for everything below: **clients may never write a rating.** Ratings
move only inside a `security definer` function that runs after the server has
replayed the game itself.

## 2. Why `rules.js` matters here

Supabase Edge Functions run on Deno, so they import
`js/games/rps-chess/rules.js` **directly** — same file, no port, no build step,
one source of truth for legality on both sides.

That works only because `rules.js` has zero DOM and zero network dependencies.
Keep it that way. It is now load-bearing infrastructure, not just tidy code.

---

## 3. Schema

```sql
create extension if not exists citext;

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        citext unique not null check (handle ~ '^[a-z0-9_]{3,16}$'),
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- one rating per player per game
create table ratings (
  user_id  uuid not null references profiles(id) on delete cascade,
  game     text not null,
  rating   int  not null default 1200,
  played   int  not null default 0,
  wins     int  not null default 0,
  losses   int  not null default 0,
  draws    int  not null default 0,
  peak     int  not null default 1200,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);

create type match_state as enum ('live','finished','aborted');

create table matches (
  id        uuid primary key default gen_random_uuid(),
  game      text not null,
  blue      uuid references profiles(id),
  red       uuid references profiles(id),
  rated     boolean not null default false,
  state     match_state not null default 'live',
  moves     int[] not null default '{}',   -- packed from*81 + to, same as the client
  result    text,                           -- 'blue' | 'red' | 'draw'
  reason    text,                           -- backrow | wipeout | nomoves | resign | abandon | invalid
  blue_delta int, red_delta int,
  blue_seen timestamptz, red_seen timestamptz,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index on matches (blue, created_at desc);
create index on matches (red,  created_at desc);

create table queue (
  user_id   uuid primary key references profiles(id) on delete cascade,
  game      text not null,
  rating    int  not null,
  joined_at timestamptz not null default now()
);
create index on queue (game, rating);
```

`moves int[]` matches the client exactly — moves are already packed integers, so
appending is `moves = moves || $1` and replaying is a loop.

## 4. RLS

| table | read | write |
|---|---|---|
| `profiles` | everyone | owner only, via `auth.uid() = id` |
| `ratings` | everyone | **nobody** — `security definer` functions only |
| `matches` | participants always; anyone once `state = 'finished'` | no direct writes; RPC only |
| `queue` | own row only | own row delete; insert via RPC |

`ratings` having no client write policy at all is the whole security model.
The Supabase anon key is public by design — RLS is what protects the data, not
the key.

**Grants are the outer gate.** The project runs with *automatically expose new
tables* off, so a table is unreachable through the Data API until a migration
grants it. Postgres checks grants before it ever evaluates a policy, which means
a table nobody remembered to lock down is invisible rather than public. Every
migration states its grants explicitly — `select` where reading is fine, column
grants where only one field should be editable, and no `insert`/`delete` grant
at all on anything a `security definer` function owns.

---

## 5. Elo

Standard Elo, per game.

```
E_a  = 1 / (1 + 10^((R_b - R_a) / 400))
R_a' = round(R_a + K_a * (S_a - E_a))        S = 1 win, 0.5 draw, 0 loss
```

| condition | K |
|---|---|
| `played < 20` (provisional) | 40 |
| `rating >= 2100` | 16 |
| otherwise | 24 |

Start 1200, floor 100. Both players' `K` are evaluated from their own
pre-match state, and both updates apply in one transaction.

**A match is rated only when all of these hold:**

- both seats are signed-in accounts, and they are different accounts
- neither is a guest
- the server's replay reproduced the recorded result

Invite links are **always friendly**. That closes the farming hole: two
friends passing a link back and forth cannot move each other's rating, because
only matchmade games are rated. `join_match` hard-codes `rated = false`.

Draws are real in RPS Chess (mutual wipeout, no legal moves) and score 0.5.

Applying Elo must be idempotent — guard on `state <> 'finished'` inside the
transaction so a retried finish call cannot pay out twice.

**Later:** Glicko-2 handles infrequent players far better than Elo. The
`ratings` table can grow `rd` and `volatility` columns without touching
anything else, so this is a swap, not a rewrite. Not worth it until there are
enough players for rating uncertainty to matter.

---

## 6. Matchmaking

Client calls `find_match(game)`. Either it returns a match id immediately, or it
enqueues you and you wait on a Realtime subscription.

```sql
create function find_match(p_game text) returns uuid
language plpgsql security definer as $$
declare
  my_rating int;
  opp       queue%rowtype;
  m_id      uuid;
begin
  select rating into my_rating from ratings
    where user_id = auth.uid() and game = p_game;
  my_rating := coalesce(my_rating, 1200);

  select * into opp from queue
   where game = p_game
     and user_id <> auth.uid()
     and abs(rating - my_rating) <= greatest(band(now()), band(joined_at))
   order by abs(rating - my_rating)
   for update skip locked
   limit 1;

  if not found then
    insert into queue (user_id, game, rating)
    values (auth.uid(), p_game, my_rating)
    on conflict (user_id) do update set joined_at = now();
    return null;
  end if;

  delete from queue where user_id in (opp.user_id, auth.uid());

  -- random seats: blue moves first, so the seat is worth something
  if random() < 0.5 then
    insert into matches (game, blue, red, rated) values (p_game, auth.uid(), opp.user_id, true)
      returning id into m_id;
  else
    insert into matches (game, blue, red, rated) values (p_game, opp.user_id, auth.uid(), true)
      returning id into m_id;
  end if;
  return m_id;
end $$;
```

`FOR UPDATE SKIP LOCKED` is the important line. Without it, two players hitting
the queue at the same instant can both claim the same third player and you get a
duplicated or orphaned match. This is the classic race and Postgres solves it
outright — a large part of why Supabase is the right call here.

**Widening band** — start tight, relax while you wait:

```sql
create function band(since timestamptz) returns int
language sql immutable as $$
  select least(50 + 25 * (extract(epoch from now() - since)::int / 5), 400);
$$;
```

±50 at 0s, ±400 by ~70s. After that, offer the computer instead of matching
wildly mismatched players.

Stale rows get swept by `pg_cron` every minute (`joined_at < now() - interval
'5 minutes'`), plus a lazy sweep at the top of `find_match`.

**Abandon.** No clocks today, so presence substitutes: each client touches
`blue_seen` / `red_seen` every ~10s. If your opponent has been silent for 60s
you may call `claim_abandon(match_id)`; the server checks the timestamp itself
rather than believing the caller. An abandon still gets replayed for legality
before it pays out.

---

## 7. Finishing a game

An Edge Function, because it needs `rules.js`:

```
POST /functions/v1/finish-match  { matchId }

  1. load the match; reject unless state = 'live'
  2. replay moves[] from the opening position through rules.js
  3. derive the terminal state and winner from the replay
  4. if the replay disagrees with the claim, or a move was illegal:
        state = 'aborted', reason = 'invalid', no Elo
  5. otherwise state = 'finished' and, if rated, call apply_elo(...)
     inside one transaction
```

Because the server derives the winner rather than being told it, a client can
lie about the outcome and simply be ignored.

**Poisoning.** A player losing on the board could try to inject an illegal move
so the game voids instead of counting. Two things stop that being worthwhile:
`play_move` only lets you append on your own turn (checked by move-count
parity against your seat), and when a replay fails, **the player who made the
first illegal move is recorded as the loser** rather than the match being
thrown away. Voiding must never be the profitable option.

`play_move` is deliberately not full validation — it enforces authorship and
ordering only, which is cheap. Legality is settled once, at the end.

---

## 8. Client changes

| file | change |
|---|---|
| `js/net/config.js` | Supabase URL + anon key replace `DB_URL` |
| `js/net/auth.js` | **new** — OAuth sign in/out, current user |
| `js/net/api.js` | **new** — `findMatch`, `cancelQueue`, `playMove`, `finishMatch`, `claimAbandon` |
| `js/net/transport.js` | add a Supabase transport beside `FireT`/`MockT`; Realtime replaces the 700/1000 ms polling |
| `js/net/session.js` | carries match id, seat and both ratings |
| `js/site/profile.js` | `load()` and `recordResult()` become async and hit the server |
| `js/games/rps-chess/sync.js` | talks to `matches` instead of `rooms` |
| `js/games/rps-chess/rules.js` | unchanged, but now also runs server-side — keep it dependency-free |
| `games/rps-chess/index.html` | unchanged |

New pages: `account/` (profile, rating, match history) and `leaderboard/`.
The homepage gains a "Play ranked" button and sign-in state in the top bar.

`profile.js` was already written with `load()` and `recordResult()` as the two
seams to a backend, so most of the swap lands in one file.

**Guest migration.** The local display name carries over as the initial
`display_name`. The local win/loss count does **not** become Elo — it is
unverifiable. Everyone starts at 1200. Keep showing the local record separately
as casual, or drop it.

`MockT` stays. Being able to run the whole flow in two tabs with no backend is
worth keeping.

---

## 9. Phases

Each ships on its own, and the casual invite-link flow keeps working throughout.

1. **Auth** — OAuth, `profiles`, sign-in state in the top bar. No ratings yet.
2. **Matches on Supabase** — invite games move to `matches` with `rated = false`;
   Realtime replaces polling. Biggest single UX win, independent of ratings.
3. **Verification + Elo** — the Edge Function and `apply_elo`. Ratings appear.
4. **Matchmaking** — `queue`, `find_match`, "Play ranked".
5. **Leaderboard + history** — trivial once 1–4 exist.

Phase 2 is worth doing early even if ratings slip; it removes the polling and
the wide-open database rules regardless.

---

## 10. How a match ends

Three ways, and none of them is "one player presses a button":

| route | who decides | rated |
|---|---|---|
| played out | `finish-match` replays it and records what it found | yes, if the match is |
| resign | the resigning player, immediately | yes, if the match is |
| illegal move | replay catches it; whoever played it loses | yes, if the match is |

A rematch is an **offer the other player accepts**, and it creates a new
match with the seats swapped rather than erasing the old one. `offer_rematch`
and `accept_rematch` both refuse unless the match is already `finished`, so a
losing player cannot reset a live board — which the first version allowed.

## 11. Still open

- **Handles** — reserved words, profanity, whether they can be changed
- **Match history** — the rows exist; there is no page that lists them
- **Repeat pairings** — matchmaking can hand you the same opponent repeatedly
  in a small pool. Damping is worth it once there are more than a handful of
  players.
- **Rating decay** for inactivity — probably not until there is a population
- **Time controls** — none today; abandon detection is standing in for them
- **Free-tier pause** — Supabase pauses a free project after 7 days idle. Fine
  now, but it means the first visitor after a quiet week waits for a cold start.
