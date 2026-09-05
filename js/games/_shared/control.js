/* ============================================================
   The control field — the one idea three games are built on.

   Every piece projects force onto the squares around it, falling off
   with distance. Add up both sides on every square and whoever
   projects more owns it. The frontline is not drawn by any rule and
   is not stored anywhere: it is simply the contour where the sums
   cross. Salients, pockets, no-man's-land and encirclement all fall
   out of that arithmetic for free.

   Pure functions only — no DOM, no network. The edge functions import
   a copy of this file to verify finished games, so it has to stay
   that way. See tools/sync-rules.py.

   Two things were tried first and are worth recording:

     * Projection as max() rather than sum(). That makes the field a
       weighted Voronoi diagram: the front sits exactly halfway
       between the nearest two pieces and *cannot* be moved by
       bringing up more force. Massing did nothing, which killed the
       entire point. Sum is what makes concentration mean something.

     * Chebyshev distance, so projection footprints were squares.
       Fronts came out with 45-degree staircase edges that read as a
       rendering bug rather than a battle line. Manhattan gives
       diamonds, and diamonds overlap into something that looks like
       ground being contested.

   ============================================================ */

/* ---------- geometry ----------
   Games differ in board size, so geometry is made once per game and
   passed around rather than being module-level constants. */
export function makeGeo(W, H){
  const SZ = W * H;
  const rowOf = i => (i / W) | 0;
  const colOf = i => i % W;
  const at = (r, c) => r * W + c;
  const inB = (r, c) => r >= 0 && r < H && c >= 0 && c < W;

  /* Files are letters, ranks count up from the bottom, as on a board.
     Row 0 is the top of the array and therefore the highest rank. */
  const sq = i => String.fromCharCode(97 + colOf(i)) + (H - rowOf(i));

  const dist = (a, b) =>
    Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));

  /* Orthogonal neighbours, precomputed. Every game walks these
     constantly — supply, flood fills, adjacency — and rebuilding the
     bounds checks each time was the single hottest thing in the
     first profile. */
  const N4 = new Array(SZ), N8 = new Array(SZ);
  for(let i = 0; i < SZ; i++){
    const r = rowOf(i), c = colOf(i), a4 = [], a8 = [];
    for(const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]])
      if(inB(r + dr, c + dc)) a4.push(at(r + dr, c + dc));
    for(const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
      if(inB(r + dr, c + dc)) a8.push(at(r + dr, c + dc));
    N4[i] = a4; N8[i] = a8;
  }

  return {W, H, SZ, rowOf, colOf, at, inB, sq, dist, N4, N8};
}

/* ---------- terrain ----------
   Five kinds of ground and two kinds of line on it. Each does exactly
   one thing, because a wargame's terrain table is where complexity
   goes to become unreadable.

     move  steps of movement allowance the square costs; 0 = impassable
     proj  what it does to the strength of a piece standing here
     hold  extra control for whoever is standing here, and nobody else

   `proj` is reach: a hill sees further as well as harder, and woods
   both blind the piece in them and shelter it. That single pair of
   numbers is most of what makes ground worth arguing over. */
export const OPEN = 0, WOODS = 1, HILL = 2, TOWN = 3,
             RIVER = 4, FORD = 5, ROAD = 6, MARSH = 7,
             WALL = 8, TOWER = 9, GATE = 10, RUBBLE = 11, KEEP = 12;

/* Open ground costs two, not one, so that a road costing one is
   worth something. With both at one the road network was decoration:
   nothing ever routed along it, because there was nothing to gain.
   Doubling the base made lateral roads behind a front into the
   redeployment lines they are in life — the reason you can answer a
   breakthrough on the far flank at all — and it costs nothing but
   larger movement allowances. */
export const TERRAIN = [
  {key: 'open',  move: 2, proj:  0, hold:  0},
  {key: 'woods', move: 3, proj: -1, hold:  2},
  {key: 'hill',  move: 3, proj:  1, hold:  1},
  {key: 'town',  move: 2, proj:  0, hold:  2},
  {key: 'river', move: 0, proj:  0, hold:  0},
  {key: 'ford',  move: 3, proj:  0, hold: -1},
  {key: 'road',  move: 1, proj:  0, hold:  0},
  {key: 'marsh', move: 4, proj: -1, hold:  0},

  /* Fortification, for the siege game. Walls are *passable* here and
     blocked for the besieger in that game's move generation instead,
     because a rampart the garrison cannot stand on is not a rampart,
     it is a fence — and height is most of what a castle is worth.

     Nothing blocks projection. A wall stops men, not trebuchet stones
     or arrows dropping into a courtyard, and making it stop force as
     well would have meant line-of-sight in the hot path of the
     search. The siege is won by standing in the keep, not by
     out-projecting it, so nothing rests on the approximation. */
  {key: 'wall',   move: 3, proj:  2, hold:  3},
  {key: 'tower',  move: 3, proj:  3, hold:  4},
  {key: 'gate',   move: 2, proj:  1, hold:  2},
  {key: 'rubble', move: 3, proj:  0, hold:  1},
  {key: 'keep',   move: 2, proj:  2, hold:  5},
];

export const passable = t => TERRAIN[t].move > 0;

/* ---------- projection stamps ----------
   A piece of strength s reaches s squares and contributes s - d at
   distance d. That footprint depends only on (strength, hole), so it
   is computed once per distinct pair and reused for the rest of the
   process. `hole` is the minimum range: artillery contributes nothing
   to the squares next to it, which is the whole reason infantry has
   to screen it.

   Stamps are stored as flat [dr, dc, value] triples rather than
   objects. This function is called tens of thousands of times a
   second inside the search and allocating there is what turns a
   200ms move into a 2s one. */
const stampCache = new Map();

export function stamp(strength, hole){
  const key = strength * 16 + hole;
  let s = stampCache.get(key);
  if(s) return s;
  const out = [];
  for(let dr = -strength; dr <= strength; dr++){
    for(let dc = -strength; dc <= strength; dc++){
      const d = Math.abs(dr) + Math.abs(dc);
      if(d < hole) continue;
      const v = strength - d;
      if(v > 0) out.push(dr, dc, v);
    }
  }
  s = new Int16Array(out);
  stampCache.set(key, s);
  return s;
}

/* ---------- the field ----------
   Positive means the first side projects more, negative the second,
   zero is contested ground that belongs to nobody.

   `units` is a flat parallel-array structure rather than a list of
   objects, for the same allocation reason as stamps:
     units.sq[k]  square        units.side[k]  0 or 1
     units.str[k] strength      units.hole[k]  minimum range
     units.live[k] 0 or 1       units.hold[k]  worth on its own square
   Games keep their own richer piece records and project a view of
   them into this shape once per node.

   `terrain` may be null for a bare board. `extra` is an optional
   per-square control bonus for whoever stands there — entrenchments,
   in the one game that has them. */
export function field(geo, units, terrain, out, extra){
  const {W, H, SZ, rowOf, colOf} = geo;
  const f = out || new Int16Array(SZ);
  f.fill(0);

  for(let k = 0; k < units.n; k++){
    if(!units.live[k]) continue;
    const i = units.sq[k];
    const bonus = terrain ? TERRAIN[terrain[i]].proj : 0;
    const s = units.str[k] + bonus;
    if(s <= 0) continue;
    const sign = units.side[k] === 0 ? 1 : -1;
    const st = stamp(s, units.hole[k]);
    const r0 = rowOf(i), c0 = colOf(i);
    for(let p = 0; p < st.length; p += 3){
      const r = r0 + st[p], c = c0 + st[p + 1];
      if(r < 0 || r >= H || c < 0 || c >= W) continue;
      f[r * W + c] += sign * st[p + 2];
    }
  }

  /* Standing on a square is worth something on top of reaching it —
     otherwise a piece could be projected off ground it physically
     occupies, which reads as nonsense however defensible the maths.
     Terrain's `hold` rides along here: a town is hard to take not
     because it projects further but because whoever is in it is
     very hard to out-vote on that one square. */
  for(let k = 0; k < units.n; k++){
    if(!units.live[k]) continue;
    const i = units.sq[k];
    const hold = (units.hold ? units.hold[k] : GARRISON)
               + (terrain ? TERRAIN[terrain[i]].hold : 0)
               + (extra ? extra[i] : 0);
    f[i] += units.side[k] === 0 ? hold : -hold;
  }

  return f;
}

/* What a piece is worth on the square it is actually standing on.
   Small: it should tip a close contest, not win an open one. */
export const GARRISON = 2;

/* The same sum, kept apart. Most games only ever need the difference,
   but one of them asks a question the difference cannot answer: how
   hard are you leaning on ground that is still theirs? That is your
   own projection onto a square you do not hold, and it is invisible
   once the two totals have been subtracted. Fills two arrays and
   returns nothing. */
export function fieldSplit(geo, units, terrain, blueOut, redOut, extra){
  const {W, H, SZ, rowOf, colOf} = geo;
  blueOut.fill(0); redOut.fill(0);
  for(let pass = 0; pass < 2; pass++){
    for(let k = 0; k < units.n; k++){
      if(!units.live[k]) continue;
      const out = units.side[k] === 0 ? blueOut : redOut;
      const i = units.sq[k];
      if(pass === 0){
        const bonus = terrain ? TERRAIN[terrain[i]].proj : 0;
        const s = units.str[k] + bonus;
        if(s <= 0) continue;
        const st = stamp(s, units.hole[k]);
        const r0 = rowOf(i), c0 = colOf(i);
        for(let p = 0; p < st.length; p += 3){
          const r = r0 + st[p], c = c0 + st[p + 1];
          if(r < 0 || r >= H || c < 0 || c >= W) continue;
          out[r * W + c] += st[p + 2];
        }
      }else{
        out[i] += (units.hold ? units.hold[k] : GARRISON)
                + (terrain ? TERRAIN[terrain[i]].hold : 0)
                + (extra ? extra[i] : 0);
      }
    }
  }
}

export const owner = v => v > 0 ? 0 : v < 0 ? 1 : -1;

/* ---------- supply ----------
   A flood fill from a side's sources through ground the enemy does
   not hold. Anything it fails to reach is cut off.

   The first version required the path to run through ground you
   positively controlled, on the theory that it would make pockets
   easy to close. It made them far too easy: a front line is a band
   of contested squares by definition, so a unit standing *on* the
   front was cut off from home almost every turn without anybody
   having encircled anything. Six self-play games produced fifty-three
   surrenders and exactly one unit actually overwhelmed in a fight —
   the whole game had collapsed into an accident of the supply rule.

   Conducting through contested ground sets the bar where it belongs:
   to cut someone off you must own a closed ring of ground behind
   them, which is what encirclement means and what it should cost.
   `strict` keeps the old behaviour for games that want it.

   Returns a Uint8Array mask over squares, not over pieces, because
   two of the three games ask about ground as well as units. */
export function supply(geo, f, side, sources, out, strict){
  const mask = out || new Uint8Array(geo.SZ);
  mask.fill(0);
  const mine = strict
    ? (side === 0 ? (v => v > 0)  : (v => v < 0))
    : (side === 0 ? (v => v >= 0) : (v => v <= 0));

  const q = [];
  for(const s of sources){
    if(mask[s] || !mine(f[s])) continue;
    mask[s] = 1; q.push(s);
  }
  while(q.length){
    const i = q.pop();
    const nb = geo.N4[i];
    for(let k = 0; k < nb.length; k++){
      const j = nb[k];
      if(mask[j] || !mine(f[j])) continue;
      mask[j] = 1; q.push(j);
    }
  }
  return mask;
}

/* ---------- movement ----------
   Dijkstra over movement allowance, since terrain costs differ. A
   piece may not pass through anybody, friend or enemy — armies do not
   drive through each other — and may not end on an occupied square.

   `blocked` is a Uint8Array of squares holding any piece.
   `zoc` is optional: squares adjacent to an enemy, which cost the
   piece its whole remaining allowance to leave. That is the classic
   zone-of-control rule and it is what stops cavalry from skating
   along a front line untouched. */
export function reachable(geo, from, mp, terrain, blocked, zoc, out){
  const {SZ, N4} = geo;
  const best = out || new Int16Array(SZ);
  best.fill(-1);
  best[from] = mp;
  /* A tiny bucket queue beats a binary heap here: allowances are
     single digits, so there are never more than a handful of levels. */
  const buckets = [];
  const push = (i, left) => {
    (buckets[left] || (buckets[left] = [])).push(i);
  };
  push(from, mp);

  for(let left = mp; left >= 0; left--){
    const b = buckets[left];
    if(!b) continue;
    for(let bi = 0; bi < b.length; bi++){
      const i = b[bi];
      if(best[i] !== left) continue;              // superseded by a cheaper route
      if(left <= 0) continue;
      const inZoc = zoc && zoc[i] && i !== from;
      const nb = N4[i];
      for(let k = 0; k < nb.length; k++){
        const j = nb[k];
        if(blocked[j]) continue;
        const cost = TERRAIN[terrain ? terrain[j] : OPEN].move;
        if(cost <= 0) continue;                   // river
        /* Leaving an enemy's zone of control ends the move. */
        const after = inZoc ? 0 : left - cost;
        if(left - cost < 0) continue;
        if(after > best[j]){ best[j] = after; push(j, after); }
      }
    }
  }
  best[from] = -1;                                 // staying put is not a move
  return best;
}

/* Squares adjacent to a live enemy piece. */
export function zoneOfControl(geo, units, side, out){
  const z = out || new Uint8Array(geo.SZ);
  z.fill(0);
  for(let k = 0; k < units.n; k++){
    if(!units.live[k] || units.side[k] === side) continue;
    const nb = geo.N4[units.sq[k]];
    for(let m = 0; m < nb.length; m++) z[nb[m]] = 1;
  }
  return z;
}

/* ---------- a readable dump, for tests and design work ----------
   Not used by the site. Every balance decision in these three games
   was argued over one of these printouts, so it stays. */
export function render(geo, f, units, glyphs){
  const {W, H} = geo;
  const occ = new Map();
  if(units) for(let k = 0; k < units.n; k++){
    if(!units.live[k]) continue;
    const g = glyphs ? glyphs(k) : (units.side[k] === 0 ? 'B' : 'r');
    occ.set(units.sq[k], g);
  }
  let out = '    ' + [...Array(W).keys()].map(c => String.fromCharCode(97 + c)).join(' ') + '\n';
  for(let r = 0; r < H; r++){
    let line = String(H - r).padStart(2) + '  ';
    for(let c = 0; c < W; c++){
      const i = r * W + c;
      line += (occ.get(i) || (f[i] > 0 ? '+' : f[i] < 0 ? '-' : '.')) + ' ';
    }
    out += line + '\n';
  }
  return out;
}
