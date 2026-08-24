# Setup

Oddboard is plain static files — no build step, no dependencies.

Picking this up cold? Read [docs/HANDOFF.md](docs/HANDOFF.md) first.

## Running it locally

The code is split into ES modules, so it has to be served over HTTP.
Opening `index.html` straight off disk (`file://`) will not work.

```bash
python tools/serve.py 8000
```

Then open <http://localhost:8000>.

It is `http.server` with caching switched off — the stock one lets browsers
hold on to a stale ES module graph after an edit, which looks exactly like
your change having no effect.

## Layout

```
index.html                     the homepage — profile and game list
leaderboard/index.html         top rated players, per game
player/index.html              a player's rating and finished games
games/<slug>/index.html        one page per game

css/
  tokens.css                   palette, type, shape, motion — change it here
  base.css                     reset + shared furniture (top bar, buttons, panels)
  home.css                     homepage
  games/<slug>.css             one per game

js/
  site/
    catalog.js                 the game list — add a game here
    leaderboard.js             leaderboard page
    player.js                  player page and match history
    profile.js                 the player profile
    authbar.js                 sign-in control in the top bar
    home.js                    homepage behaviour
  net/                         shared by every game
    config.js                  Supabase URL + publishable key
    supabase.js                the client, loaded lazily
    auth.js                    sign-in, guest sessions, session state
    transport.js               Supabase matches + the offline mock
    session.js                 online session state
  vendor/                      the Supabase SDK, self-contained
  games/<slug>/
    rules.js                   pure rules — no DOM, no network
    ai.js                      the computer player — no DOM, no network
    state.js                   live game state, history, win detection
    ui.js                      everything that touches the DOM
    sync.js                    online play for this game
    main.js                    wiring
```

## Adding a game

1. Create `js/games/<slug>/` and `css/games/<slug>.css`.
2. Create `games/<slug>/index.html`.
3. Add an entry to `js/site/catalog.js` pointing `href` at that page.

`js/net/` is game-agnostic — a new game can reuse the whole room/transport
layer and only needs its own `sync.js` to decide what a move means.

## Playing without a backend

Add `?mock=1` to a game URL and the whole online flow — hosting, joining,
moves, chat — runs between two tabs of the same browser using
`localStorage` + `BroadcastChannel`. No database, no network.

Open <http://localhost:8000/games/rps-chess/?mock=1>, create a link, and
paste it into a second tab.

## Online play (Supabase)

Online play runs on Supabase: Postgres for match rows, Realtime for
updates, and RLS plus table grants for security. Config lives in
[`js/net/config.js`](js/net/config.js) — the URL and publishable key are
public by design.

Dashboard settings this depends on:

| setting | value |
|---|---|
| Data API | on |
| Automatically expose new tables | **off** |
| Automatic RLS | on |
| Providers | Google, GitHub, Anonymous — all on; Email off |
| Redirect URLs | your dev origin plus the production site |

Migrations in `supabase/migrations/` are applied in order, either through
the SQL editor or `supabase db push`.

### Ranked vs friendly

**Play ranked** puts you in a queue and pairs you with a random opponent
near your rating; the search band widens from ±50 to ±400 over about a
minute. Those games move Elo.

**Create a game link** is always friendly and never touches rating — which
is what stops two friends trading wins into the leaderboard.

Ranked needs an account. Friendly games do not.

If a player disappears mid-game, the other may claim the win after sixty
seconds of silence. Presence is a heartbeat into `match_presence`, kept out
of the Realtime publication so it does not broadcast every fifteen seconds.

### Accounts and guests

Sending or accepting a challenge needs no account: a guest gets a Supabase
anonymous session, which still carries a real `auth.uid()`, so the server
can enforce whose turn it is. Guests are flagged `profiles.is_guest`.

Signing in with Google or GitHub gives a permanent profile. Ratings and
matchmaking are not built yet — see [docs/accounts.md](docs/accounts.md).

### The finish-match edge function

Results are not reported by players. When a client's board says the game
is over it asks `finish-match`, which replays the whole move list through
the same `rules.js` the browser used and records what *it* found. A
modified client can claim any result and simply be ignored.

It needs the Supabase CLI:

```bash
npx supabase login
```

then link the project and deploy:

```bash
npx supabase link --project-ref gderpmkfszmlrqhfmhvg
```

```bash
python tools/sync-rules.py && npx supabase functions deploy finish-match
```

`sync-rules.py` copies `js/games/rps-chess/rules.js` into
`supabase/functions/_shared/`, because the edge runtime bundles only what
sits under the function directory. The browser file is the source; the
copy is generated and carries a banner saying so. `--check` fails if it
has gone stale, which is worth wiring into any deploy script.

### Why every write is an RPC

Clients hold no insert, update or delete grant on any table. Everything
goes through `security definer` functions, so the rules live in one place
and a modified client cannot write a move on your behalf.

## How a game stays in sync

A match row holds the move list as `int[]`, packed exactly as the client
packs them (`from * 81 + to`). Both clients replay it from index 0, so the
two boards cannot drift apart. If what a client holds locally is no longer
a prefix of what the server holds, it throws its board away and replays
the server's list.

Updates arrive over a Realtime subscription, with a slow ten-second
re-read as insurance against a dropped websocket.
