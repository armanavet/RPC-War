/* ============================================================
   Slipstream — the rules, and nothing else.

   Pure functions: no DOM, no network. The edge function imports
   this file to verify finished games, so it must stay that way.

   A piece slides in a straight line until something stops it. You
   never choose the distance, only the direction — so the whole
   game is about where the blockers are.

   Two design notes, both learned the hard way:

     * Winning by reaching the far side does not work here. With
       unlimited sliding a piece crosses the whole board in one
       move, so the first player simply wins on move one. Games
       are decided by capture instead.

     * Walls exist so that long lanes are not free. They are fixed,
       cannot be captured, and are placed with 180-degree symmetry
       so neither seat starts better off.

     * The board closes in. Without it, two careful players simply
       never enter each other's lanes and the game does not end —
       half of a twenty-game self-play run ran past 200 plies. A
       ring falls in every 12 plies, which forces contact and puts
       a hard ceiling on length. It is a pure function of the move
       count, so both clients and the server agree without being
       told anything.

     * A falling ring *pushes* pieces inward rather than killing
       them. Sliding naturally parks you against a wall, which is
       exactly where the ring lands, so crushing made half the
       games turn on a rim piece at move six. Pushing keeps the
       pressure without deciding the game by accident. A piece is
       only lost if there is nowhere inward to go.

   Encoding: 0 empty, 1 = seat A (blue), 2 = seat B (red), 3 = wall.
   Moves pack as from * 81 + to, same as every other game here.
   ============================================================ */
export const SZ = 81;
export const BLUE = 0, RED = 1;
export const WALL = 3;

export const isWall = p => p === WALL;
export const col = p => p === 1 ? BLUE : RED;
export const mk = c => c === BLUE ? 1 : 2;
export const rowOf = i => (i / 9) | 0;
export const colOf = i => i % 9;
export const sq = i => String.fromCharCode(97 + colOf(i)) + (rowOf(i) + 1);

export const packMove = (from, to) => from * 81 + to;
export const moveFrom = mv => (mv / 81) | 0;
export const moveTo   = mv => mv % 81;

export const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

/* Four walls, in rotationally symmetric pairs. Enough to break the
   open board without turning it into a maze. */
export const WALLS = [3 * 9 + 2, 5 * 9 + 6, 2 * 9 + 6, 6 * 9 + 2];

/* How many rings have fallen after `ply` moves. */
export const SHRINK_EVERY = 12;
export const MAX_RINGS = 3;

/* Insurance. Once the board is down to its middle three-by-three a
   game is all but forced, but one self-play run in thirty still went
   round in circles. A deterministic cap keeps a match from sitting
   `live` for ever. */
export const PLY_CAP = 120;
export const ringsClosed = ply => Math.min(MAX_RINGS, Math.floor(ply / SHRINK_EVERY));

/* Which ring a square sits on: 0 is the outer border. */
export const ringOf = i => Math.min(rowOf(i), colOf(i), 8 - rowOf(i), 8 - colOf(i));

/* Closed squares behave exactly like walls. */
export const isClosed = (i, ply) => ringOf(i) < ringsClosed(ply);

/* Plies until the next ring falls, or null once the board is done. */
export const untilShrink = ply =>
  ringsClosed(ply) >= MAX_RINGS ? null : SHRINK_EVERY - (ply % SHRINK_EVERY);

/* Armies start on ring 1, not on the rim. That way the first ring to
   fall is a warning rather than an execution — you watch the board
   shrink once before it can cost you anything. Starting on the rim
   made a third of games end in a simultaneous crush. */
export function startBoard(){
  const b = new Array(SZ).fill(0);
  for(const w of WALLS) b[w] = WALL;
  for(const f of [1, 3, 5, 7]){
    b[1 * 9 + f] = mk(RED);
    b[7 * 9 + f] = mk(BLUE);
  }
  return {b};
}

/* Exactly one destination per direction — you cannot stop short.
   Slide over empties; hit an enemy and you take its square; hit a
   friend, a wall or the edge and you stop on the last empty square. */
export function genMoves(board, c, ply = 0){
  const out = [];
  for(let i = 0; i < SZ; i++){
    const p = board[i];
    if(!p || isWall(p) || col(p) !== c) continue;
    const r = rowOf(i), f = colOf(i);
    for(const [dr, df] of DIRS){
      let rr = r + dr, ff = f + df, dest = -1;
      while(rr >= 0 && rr < 9 && ff >= 0 && ff < 9){
        const j = rr * 9 + ff;
        if(isClosed(j, ply)) break;                  // a fallen ring stops you
        if(board[j]){
          // an enemy is a landing square; a wall or a friend is not
          if(!isWall(board[j]) && col(board[j]) !== c) dest = j;
          break;
        }
        dest = j;
        rr += dr; ff += df;
      }
      if(dest >= 0) out.push(packMove(i, dest));
    }
  }
  return out;
}

/* 'move' or 'capture', from the mover's point of view. */
export function outcome(board, from, to){
  return board[to] ? 'capture' : 'move';
}

/* Where a piece standing on a falling ring gets pushed to: straight
   toward the middle if that is free, otherwise the first free square
   further in, scanned in index order so it is deterministic. */
function pushTarget(nb, i, safeRing){
  const r = rowOf(i), f = colOf(i);
  const dr = r < 4 ? 1 : r > 4 ? -1 : 0;
  const df = f < 4 ? 1 : f > 4 ? -1 : 0;
  const straight = (r + dr) * 9 + (f + df);
  if(ringOf(straight) >= safeRing && !nb[straight]) return straight;
  for(let j = 0; j < SZ; j++){
    if(ringOf(j) >= safeRing && !nb[j]) return j;
  }
  return -1;
}

/* Returns a new board; never mutates the one passed in.

   `ply` is the index of this move. If it is the move that brings a
   ring down, pieces on that ring are pushed inward; one with nowhere
   to go is lost. `crushed` reports how many were actually lost. */
export function apply(board, mv, ply = 0){
  const from = moveFrom(mv), to = moveTo(mv);
  const nb = board.slice();
  const o = outcome(board, from, to);
  nb[to] = board[from];
  nb[from] = 0;

  let crushed = 0;
  const before = ringsClosed(ply), after = ringsClosed(ply + 1);
  if(after > before){
    // clear the walls off the closing rings first, then rehome the pieces
    const displaced = [];
    for(let i = 0; i < SZ; i++){
      const ring = ringOf(i);
      if(ring >= before && ring < after && nb[i]){
        if(!isWall(nb[i])) displaced.push([i, nb[i]]);
        nb[i] = 0;
      }
    }
    for(const [i, p] of displaced){
      const t = pushTarget(nb, i, after);
      if(t < 0) crushed++;
      else nb[t] = p;
    }
  }
  return {bd: nb, from, to, o, crushed, shrank: after > before};
}

export function count(board, c){
  let n = 0;
  for(let i = 0; i < SZ; i++){
    const p = board[i];
    if(p && !isWall(p) && col(p) === c) n++;
  }
  return n;
}

/* The squares a move passes over — the UI draws the trail with it. */
export function pathOf(from, to){
  const dr = Math.sign(rowOf(to) - rowOf(from));
  const df = Math.sign(colOf(to) - colOf(from));
  const out = [];
  let r = rowOf(from) + dr, f = colOf(from) + df;
  while(r !== rowOf(to) || f !== colOf(to)){
    out.push(r * 9 + f);
    r += dr; f += df;
  }
  return out;
}
