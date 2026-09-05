# The four wargames

Salient, Tideline, Breakthrough and Barbican are one engine and four games. Read
[HANDOFF.md](HANDOFF.md) first for the site as a whole; this file is about
what these three are and why they are the shape they are.

---

## 1. The one idea underneath all three

`js/games/_shared/control.js`.

Every unit projects force onto the squares around it, falling off with
distance. Add both sides up on every square and whoever projects more owns
it. **The frontline is not drawn by any rule and is not stored anywhere** —
it is the contour where the two sums cross. Salients, pockets, no-man's-land
and encirclement all fall out of that arithmetic for nothing.

Two things were tried first and are recorded in the file itself:

- **Projection as `max()` rather than `sum()`.** That makes the field a
  weighted Voronoi diagram — the front sits halfway between the nearest two
  units and cannot be moved by bringing up more force. Massing did nothing,
  which killed the whole point.
- **Chebyshev distance**, so footprints were squares. Fronts came out with
  45-degree staircase edges that read as a rendering bug. Manhattan gives
  diamonds, and diamonds overlap into something that looks like contested
  ground.

Everything else in `_shared/` builds on it: `supply()` (flood fill through
ground the enemy does not hold), `reachable()` (Dijkstra over movement
allowance, with zones of control), `fieldSplit()` (the same sums kept apart,
which only Breakthrough needs), `counters.js` (the art) and `board.js` (the
renderer).

## 2. What makes each one a different game

| | Salient | Tideline | Breakthrough | Barbican |
|---|---|---|---|---|
| board | 19 × 11 | 17 × 11 | 15 × 13 | 15 × 13 |
| sides | mirrored | mirrored | mirrored | **asymmetric** |
| the constraint | command radius | the leash | zones of control | the wall |
| how ground changes | instantly, with the field | converts and **stays** | only where a sector cracks | it does not — masonry does |
| how units die | encircled, or overwhelmed | overwhelmed; failed assaults fall back | routed by a crack | cut down, or lost to the camp |
| you win by | a points race on five towns | owning two thirds of the board | taking both their rear depots | standing in the keep / outlasting |
| length | ~106 plies | ~188 plies | ~187 plies | ~203 plies |
| skin | rendered counters | painted tokens | flat poster | woodcut |

- **Salient** is about *command*. You may only order units within your
  general's radius or a staff officer's shorter one, so you cannot fight
  everywhere and shifting your general's weight is a commitment telegraphed a
  turn in advance. Killing a staff officer puts a wing to sleep.
- **Tideline** is about *the leash*. A unit may only finish its move on your
  ground or touching it, so an army physically cannot outrun its territory.
  There are no raids; there is a line, and it moves at the speed ground can
  be converted.
- **Breakthrough** is about *pressure*. Control does not move the line. You
  lean on their line, pressure accumulates visibly, and three connected
  squares at breaking point crack the sector open — routing its defenders and
  buying three free moves that only armour and recon may take.
- **Barbican** is about *asymmetry*. It is the only one of the four where the
  two players are not doing the same job. The besieger has nineteen men,
  engines and a camp that kills one of them every eighth turn; he wins by
  physically standing in the keep. The garrison has nine men and a wall, and
  wins by still being there when the relief column arrives. Neither side's
  win condition is available to the other.

## 3. Four skins, one renderer

The four look nothing like each other, and that is deliberate rather than
decorative — they are four candidate directions, meant to be compared.

| game | skin | medium |
|---|---|---|
| Salient | `map` | pre-rendered PNG counters with baked lighting, on a raster tileset |
| Tideline | `painted` | moulded domes lit in CSS, on a lacquered board |
| Breakthrough | `flat` | solid silhouettes, four inks on paper, no gradient anywhere |
| Barbican | `woodcut` | heraldic shields and drawn masonry, hatched, on parchment |

`js/games/_shared/board.js` knows none of this. A game passes a `skin` with
`name`, `unit(u)` and `terrain(kind, links, i)`, and the renderer asks it for
markup — so a fifth style is a new `skin.js` and a new stylesheet, and nothing
in the shared code has to move.

**The artwork itself is common to all four**: real drawn icons from
[Game Icons](https://game-icons.net) (CC BY 3.0 — see `CREDITS.md`), vendored
as path data into `js/games/_shared/icons.js` by `tools/build-art.mjs`. What
changes between the skins is entirely the presentation. An earlier pass drew
its own line art and then its own pixel art; both were worse than using
artwork drawn by illustrators, and neither survived.

## 4. Invariants

1. **`rules.js` has no DOM and no network imports**, in all three, exactly as
   in the older games. The edge functions import copies.
2. **Everything is deterministic and perfect-information.** No dice, no fog.
   The server verifies by replaying the move list, so hidden information
   would be visible to a modified client and randomness would break replay.
   This is not a stylistic choice; it is what the security model requires.
3. **Turns alternate strictly.** `play_move` in `0002_matches.sql` identifies
   the mover by the parity of the move list. Breakthrough's exploitation
   originally let one side move three times in a row and would have been
   rejected by the server as the wrong player's turn; the defender now passes
   instead. See the long note in `breakthrough/rules.js`.
4. **Every move packs into one `int4`.** `matches.moves` is `int[]`. The
   largest code in use is Tideline's build move at about 35,900.
5. **`tools/sync-rules.py --check` must pass before deploying.** It now
   copies `_shared/control.js` as well as five games' rules and engines. A
   stale copy is not a theoretical problem: it produced three replay
   mismatches during this build and the check is what caught them.

## 5. Why the AI is written the way it is

All three use negamax with alpha-beta, iterative deepening, a time budget and
**hard forward pruning** — each node ranks its moves statically and searches
only the best handful, narrowing with depth.

That is theoretically unsound and it is the whole reason these games are
playable. A turn offers 200–300 legal moves. Searching them all bought two
plies, and two plies cannot see an encirclement coming. With pruning, depth 4
takes about 150 ms on a 223-move position. The move ranking is therefore load
bearing: anything it fails to surface is a move the AI will never consider.

The other decision worth knowing: **the evaluation is almost entirely
ground, not material.** An early version scored units at chess-like weights
and played like a miser — it declined every attack, because attacking risks a
unit, and lost on points while holding a full army.

The control field is memoised on one slot keyed by object identity, because
it is asked for three or four times per node and recomputing it was most of
the cost of the search. Anything that mutates a state must call `soil()`.

## 6. Balance, as measured

Self-play, engine against itself, depth 4:

| game | games | result | plies | notes |
|---|---|---|---|---|
| Salient | 26 | blue 15 / red 11, no draws | 106 | 17 on points, 9 by decapitation |
| Tideline | 20 | blue 13 / red 7, no draws | 188 | after komi — see below |
| Breakthrough | 10 | blue 4 / red 5 / 1 draw | 187 | 8 of 10 by actual breakthrough |
| Barbican | 22 | besieger 11 / garrison 11 | 203 | every game decided; no draws possible |

**Tideline is the one that needed a handicap.** Without one it ran blue 18 /
red 6 over 24 games — a real first-move advantage, not noise, and it has an
obvious cause: blue converts ground one turn before red ever does, and in
this game a ground lead compounds through build points into more ground.
`RED_KOMI` gives the second player five build points to open with, which
brought it to 13–7 over 20 games.

13–7 is no longer statistically distinguishable from even at that sample
size (p ≈ 0.13), so the honest position is that the handicap fixed the
measurable problem and the residual lean is unproven. It has deliberately
**not** been tuned further: moving komi again on the strength of a result
that is within noise would be fitting the dial to twenty games rather than
to the game. If it is still leaning after a few hundred, raise it.

A caution on small samples, learned here twice: Salient showed an apparent
8–2 *second*-player advantage at n=10 that vanished completely at n=26
(15–11), and Tideline's first n=10 read 8–2 the other way. Ten games tells
you almost nothing.

**Barbican came out even at 11–11**, which for an asymmetric game is the
number that matters most and was not the first number it produced. Three
things were wrong to begin with and each is recorded in the source: the camp
killed thirteen of nineteen besiegers on its own, so the clock *was* the
result rather than pressure on it; the levy was strength two, so eight of them
surrounding a guard in the open produced exactly what the guard produced alone
and the besieger's whole numerical advantage came to nothing; and the garrison
carried a personal hold of four, which made a breach lead nowhere.

Everything else has been verified: twelve full games across the four, played
with the browser modules and then replayed through the generated `_shared/`
copies exactly as `finish-match` does, agreed on the result in every case.

## 7. Failures worth not repeating

Each of these cost a tuning round and is recorded in the source at the point
where it matters.

- **Supply through contested ground only** (Salient). A front line *is* a
  band of contested squares, so a unit standing on the front was cut off from
  home almost every turn without anybody having encircled anything. Six games
  produced 53 surrenders and exactly one unit overwhelmed in a fight.
- **A threshold win condition** (Salient). "Hold four of five objectives"
  produced a game with no pressure in it: neither side could reach four, so
  neither had a reason to attack, and every traced game drifted to the ply
  cap. A running score fixes it structurally — whoever is behind is losing
  *now*.
- **Objectives off the front** (Salient). With them two rows off each
  baseline, both sides began holding two of their own and nothing ever
  changed hands between ply 30 and ply 90.
- **Destroying a failed assault** (Tideline). Fifteen deaths a side per game
  and every test ending with a general killed. Costing an attack its tempo
  and position, rather than the unit, turned attacking into a decision.
- **A road across the middle** (Breakthrough). Armour covered ten squares of
  it a turn and won in eleven plies before the lines had touched. Roads move
  reserves *along* a front; they must never cross one.
- **"Reach their back row"** (Breakthrough). A footrace — both armies ran
  past each other down opposite flanks. A goal you have to *hold* cannot be
  raced for.
- **One signed pressure array** (Breakthrough). Each side's step overwrote
  the other's build-up on exactly the squares where both were leaning.
- **A hand-kept list of terrain names** in the renderer (all four). The day
  fortification was added to the engine, every wall, tower, gate and keep
  resolved to `undefined` and Barbican rendered a castle made of nothing. It
  is derived from the terrain table now.
- **`background-image` does not clear `background-color`** (Barbican). The
  woodcut draws territory as dot hatching over parchment; the flat colour the
  shared stylesheet sets underneath was still there, and two opaque slabs
  buried the entire castle.
- **Generals killed by crack routs** (Breakthrough). Eight games in ten ended
  on a headquarters destroyed by a rout rather than by anything either player
  planned. A headquarters now displaces.

## 8. Open

- **Tideline's balance at a larger sample**, as above.
- **Online play.** The three games have `rules`, `ai`, `state`, `ui` and
  `main`, but no `sync.js` — they are local and versus-computer only. Adding
  online play is a matter of writing that one adapter against
  `js/net/matchsync.js`, exactly as the older two games do; nothing in the
  net layer needs to change.
- **Ply caps under weak play.** At Easy level, games drift to the cap more
  often than they should. The caps are generous rather than tuned.
- **Mobile.** The boards are wide. They fit and they scroll, but a 19-column
  board on a phone is small, and no one has held one in their hand yet.
