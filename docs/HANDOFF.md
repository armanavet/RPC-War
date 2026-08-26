# Oddboards — handoff

Everything a fresh session needs to pick this up. Read this first, then
[SETUP.md](../SETUP.md) for running it and [accounts.md](accounts.md) for the
design of the backend.

---

## 1. What it is

A site for two-player board games — "chess.com for odd little games". One game
exists: **RPS Chess** (9×9, every piece moves like a king, captures are settled
with rock-paper-scissors). Static files, no build step, ES modules, deployed on
GitHub Pages at <https://oddboards.com>. Backend is Supabase.

Repo: `armanavet/RPC-War`. Branch `main`.

## 2. State of play

| area | state |
|---|---|
| Game (local + vs computer) | done |
| Drag-and-drop + click-to-move | done |
| Accounts (Google, GitHub) | done, live |
| Guest sessions (anonymous auth) | done, live |
| Matches on Supabase + Realtime | done, live |
| Result verification (edge function) | done, live |
| Elo | done, live |
| Abandon / resign | done, live |
| Matchmaking + leaderboard | done, live |
| Match history / player pages | done, live |
| Online counts (site + per game) | **written, 0010 not applied** |

### Applied on the live project

`0001` through `0009`. The edge function is deployed.

### NOT yet applied

```
supabase/migrations/0010_presence.sql
```

Until it is, the online counters simply stay hidden — `presence.js` swallows
the 404 and no page breaks.

Verify what is actually live rather than trusting this table — probe the REST
API (see §7). The table goes stale; the database does not. Everything above was
last checked against the live project by probing it, not by reading this file.

## 3. Running it

```bash
python tools/serve.py 8000
```

Do **not** use `python -m http.server`. It sends no `Cache-Control`, so the
browser serves a stale ES module graph after every edit and your change appears
to do nothing. `tools/serve.py` is the same thing with caching off and threading
on. This has already cost one long debugging detour — do not undo it.

Whatever port you use must be in Supabase → Authentication → URL Configuration,
or OAuth redirects land on the production site instead.

## 4. Layout

```
index.html                  homepage: profile + game list
leaderboard/index.html      top rated, per game
player/index.html           a player's rating and finished games (?h=handle)
games/rps-chess/index.html  the game

css/    tokens · base · home · leaderboard · player · games/rps-chess
js/
  site/     catalog · profile · authbar · home · leaderboard · player
  net/      config · supabase · auth · session · transport      (game-agnostic)
            presence   online counts, plain fetch, no SDK
  games/rps-chess/
            rules · ai · state · ui · sync · icons · main
  vendor/   supabase-js, self-contained (~284 KB, 6 files)
supabase/
  migrations/*.sql            0001-0009 applied; 0010 pending
  functions/finish-match/index.ts
  functions/_shared/rps-chess-rules.js   GENERATED — see §6
tools/    serve.py · sync-rules.py
```

**Adding a game:** create `js/games/<slug>/`, `css/games/<slug>.css`,
`games/<slug>/index.html`, then add an entry to `js/site/catalog.js`. `js/net/`
is reusable as-is; a new game only needs its own `sync.js`.

## 5. Invariants — do not break these

1. **`rules.js` has no DOM and no network imports.** The edge function imports
   it to verify games server-side. It is infrastructure, not just tidy code.
2. **Clients hold no insert/update/delete grant on any table.** Every write is a
   `security definer` RPC. Check with §7's probe if unsure.
3. **`ratings` has no write policy or grant at all.** Ratings move only inside
   `apply_elo`, called from a result the server established itself.
4. **Two gates, not one.** Grants decide whether a table is reachable; policies
   decide which rows. The project runs with *automatically expose new tables*
   **off**, so every migration must state its grants explicitly — **and that
   includes `service_role`, not just `anon` and `authenticated`.** With the
   setting off there is no default privilege for anybody, so the server has
   exactly the rights you wrote down and no others. Forgetting this is what
   broke `finish-match` for every ranked game; see §8. Note also that
   `service_role` has `BYPASSRLS` — that opens the row gate, never the table
   gate, so a service-role query can still be refused outright.
5. **`record_result` and `void_match` are service-role only.** They are how a
   result gets written; a player must never be able to call them.
6. **Never commit the `sb_secret_...` key or the database password.** The
   publishable key in `js/net/config.js` is public by design.

## 6. Backend

Project ref `gderpmkfszmlrqhfmhvg`. URL and publishable key live in
`js/net/config.js` and are meant to be public.

**Dashboard settings this depends on:**

| setting | value |
|---|---|
| Data API | on |
| Automatically expose new tables | **off** |
| Automatic RLS | on |
| Providers | Google, GitHub, Anonymous on; Email off |
| Redirect URLs | dev origin + `https://oddboards.com/**` |

**The edge function** replays a finished game through `rules.js` and records
what it finds, ignoring whatever the client claimed. It cannot import from
outside its own directory, so `tools/sync-rules.py` copies
`js/games/rps-chess/rules.js` into `supabase/functions/_shared/`. The browser
file is the source; the copy carries a generated banner.
`python tools/sync-rules.py --check` fails if it has drifted — worth wiring
into any deploy script.

**How a match ends** — three routes, none of them "press a button":

| route | who decides |
|---|---|
| played out | `finish-match` replays and records |
| resign | the resigning player, immediately |
| abandon | 60s of silence, server re-checks the clock |
| illegal move | replay catches it; whoever played it loses |

A rematch is an **offer the other player accepts**, and creates a new match with
swapped seats. Both RPCs refuse unless the match is already `finished`.

**Rated** means matchmade. Invite links are always friendly — that is what stops
two friends farming rating off each other. Guests can never play ranked.

## 7. How to verify things

Probe the live API rather than guessing. `401` on a table means it exists and is
protected; `404` means the migration has not run.

```bash
curl -s -H "apikey: $KEY" "$URL/rest/v1/queue?select=user_id&limit=1"
```

```bash
curl -s -H "apikey: $KEY" "$URL/auth/v1/settings"
```

**Offline flow, no backend:** add `?mock=1` to a game URL. `MockT` in
`transport.js` implements the whole transport interface over
`localStorage` + `BroadcastChannel`, including a queue, presence and rematch.
Identity is in `sessionStorage`, so **two tabs are two players**.

**Two real accounts in one browser:** `localhost:8001` and `127.0.0.1:8001` are
different origins with separate storage, so they hold separate sessions. Same
server. (This does *not* work for `?mock=1`, whose state is per-origin
`localStorage` — mock tabs must share an origin.)

**Driving the board from a script:** the board listens for Pointer Events. Stub
`board.setPointerCapture = () => {}` first, then dispatch
`pointerdown → pointermove (past 4px) → pointermove → pointerup`.

**Verifying the rules engine:** `rules.js` and `ai.js` run in plain Node. Copy
to `.mjs` and import. There is a harness pattern in the history that played 12
AI-vs-AI games and checked the edge function's `replay()` reproduced every
result — worth re-running after any rules change.

## 8. Traps already hit

- **Stale module graph.** Fixed by `tools/serve.py`. If an edit "does nothing",
  suspect this before suspecting the code.
- **Single-threaded dev server.** A page pulls a dozen modules in parallel;
  `TCPServer` stalls. Must be `ThreadingHTTPServer`.
- **`.mjs` served as `text/plain`.** Browsers refuse it as a module. Vendored
  files were renamed to `.js`.
- **`onAuthStateChange`** can deadlock if you call Supabase inside the callback.
  `auth.js` defers with `setTimeout(…, 0)`. Keep it.
- **`auth.onAuth` fires repeatedly.** Guard re-runs on identity, as `player.js`
  does.
- **Bash tool cannot reach some localhost ports** even when the server is fine.
  Use the browser tools to check the dev server; `curl` works for Supabase.
- **Supabase JS SDK is lazy.** A signed-out visitor loads zero vendor bytes.
  Do not import `supabase.js` at the top level of anything on the hot path.
  `js/net/presence.js` is deliberately written on plain `fetch` for exactly
  this reason — the online counter runs on the homepage, so reaching for the
  SDK there would have cost every visitor 284 KB.

### The three bugs that hid behind each other

Finishing a ranked match failed for weeks, and fixing it meant peeling three
separate faults apart in order. Worth reading before touching that path.

- **`service_role` had no grant on `matches`.** *This was the real one.* The
  edge function reads the match row directly before replaying it, and the read
  was refused with `permission denied for table matches`, so the function
  returned 500 before it ever reached `record_result`. Every played-out ranked
  game stayed `live` for good. Cause: *automatically expose new tables* is off,
  so `service_role` gets nothing by default, and migrations `0001`-`0008` only
  ever named `anon` and `authenticated`. Fixed by `0009`, which is one line.
  The tell that it is a *grant* problem and not an RLS one: RLS failures either
  return no rows or say `violates row-level security policy`, never
  `permission denied for table`.

- **The CORS allow-list was too narrow**, and it masked the bug above. The
  function answered preflights with `authorization, content-type`, but
  supabase-js also sends `x-client-info` and `apikey`. The browser therefore
  failed the preflight and never sent the POST at all. Two things to know:
  `curl` will *not* reproduce this unless you pass
  `Access-Control-Request-Headers` with the full set, so the function looks
  perfectly healthy from a terminal; and the SDK's error text tells you which
  layer you are on — *"Failed to send a request to the Edge Function"*
  (`FunctionsFetchError`) means the request never left, while *"Edge Function
  returned a non-2xx status code"* (`FunctionsHttpError`) means it arrived and
  the function answered.

- **The retry latch never released.** `sync.js` sets `finishing = true` before
  calling `finish()`, and the failure path did not reset it — so one dropped
  request stranded that match forever, because the 10s safety poll skipped the
  retry from then on. Any transient blip would have done it.

A note on diagnosis, because it cost most of the time: supabase-js reports
every non-2xx as the same sentence and hides the function's own message on
`error.context`, an unread `Response`. `transport.js` now unwraps it and
throws `finish-match <status>: <message>`. Keep that — the entire investigation
collapsed into one reload once the real message was on screen.

## 9. Decisions and why

- **Supabase over staying on Firebase** — matchmaking pairing needs
  `FOR UPDATE SKIP LOCKED`, leaderboards need `ORDER BY`, and RLS gives real
  per-row permissions. Firebase is fully removed; the project can be deleted.
- **Verify-on-finish over validating every move** — RPS Chess is
  perfect-information, so replaying at the end catches fabricated results *and*
  illegal moves at a fraction of the cost. `play_move` still enforces turn
  authorship so an opponent cannot write your moves.
- **Whoever plays an illegal move loses**, rather than the match being voided —
  otherwise poisoning a losing game would be profitable.
- **Guests via anonymous auth** rather than a token scheme — a guest gets a real
  `auth.uid()`, so nothing about the security model changes.
- **Vendored SDK** rather than a CDN — no third-party host in the page load
  path. The user rejected a Google Fonts dependency for the same reason.
- **Light theme by default, system dark** — an earlier dark/gold/grain design
  was rejected as over-designed. Keep it plain. Text should be scarce;
  instructions belong in menus, not on the page.

## 10. Open

- **Repeat pairings** — a small pool means the queue hands you the same opponent
  over and over. Damping is worth it as the player base grows.
- **Game replay** — moves are stored and finished matches are public, so a board
  replay from the history page is straightforward and not built.
- **Guest → account upgrade** — signing in as a guest today creates a *new*
  user and abandons the guest. Should be `linkIdentity()`. Harmless while guest
  games are unrated; fix before that changes.
- **Handle changes** — handles are immutable (no column grant). No UI to change
  one, deliberately, until the rules are decided.
- **The online count is spoofable.** `presence` is keyed by a browser uuid, not
  `auth.uid()`, so two tabs count once but two browsers count twice, and a
  caller who posts made-up uuids can inflate it. Accepted deliberately —
  nothing reads that table to decide anything. Keep it decorative
  (see `0010_presence.sql`).

Of these, **guest → account upgrade** is the one worth doing first.
