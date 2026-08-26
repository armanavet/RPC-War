/* ============================================================
   Anvil — the rules, and nothing else.

   Pure functions: no DOM, no network. The edge function imports
   this file to verify finished games, so it must stay that way.

   The anvil is the middle of the board. Hold three of its four
   squares through your opponent's reply and you win. Nothing is
   captured by landing on it — you move people by shoving, and you
   can only shove with more pieces than they have in the line.

   Three failed designs are worth recording, because they all failed
   the same way:

     * Capture by sandwiching, as Tafl does. Zero captures in twenty
       self-play games. With one-step moves, making contact is always
       locally losing, so neither side ever does. Armies started
       *touching* still managed barely one capture a game.

     * Shove pieces off the edge to win. Nothing was ever pushed off
       in thirty-two games. A defender can always retreat, so a push
       can never be forced, and the centre is a safe haven.

     * The same on a small board, so the rim is always near. Better
       — 0.3 a game — but still every game a draw.

   Making the centre the prize is what fixed it. Now there is
   somewhere both players have to be, so contact is not a choice, and
   shoving is how you evict. Eighteen of twenty games decided.

   Encoding: 0 empty, 1 = seat A (blue), 2 = seat B (red).
   Moves pack as from * 64 + to, where `from` is the front piece of
   your line and `to` is the square it steps into. If `to` is empty
   that is a plain step; if it holds an enemy it is a shove.
   ============================================================ */
export const N = 6;
export const SZ = 36;
export const BLUE = 0, RED = 1;

export const col = p => p === 1 ? BLUE : RED;
export const mk = c => c === BLUE ? 1 : 2;
export const rowOf = i => (i / N) | 0;
export const colOf = i => i % N;
export const sq = i => String.fromCharCode(97 + colOf(i)) + (N - rowOf(i));

export const packMove = (from, to) => from * SZ + to;
export const moveFrom = mv => (mv / SZ) | 0;
export const moveTo   = mv => mv % SZ;

/* Orthogonal only. */
export const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/* At most three push, at most two get pushed — the Abalone numbers,
   because they are the ones that keep a shoving game from becoming a
   single unstoppable battering ram. */
export const MAX_PUSH = 3;
export const MAX_PUSHED = 2;

/* The anvil: the middle four squares. Hold three at the start of your
   turn — that is, after your opponent has had a move to break it —
   and the game is yours. */
export const CENTRE = [2 * 6 + 2, 2 * 6 + 3, 3 * 6 + 2, 3 * 6 + 3];
export const HOLD_TO_WIN = 3;

export const holds = (board, c) =>
  CENTRE.filter(i => board[i] && col(board[i]) === c).length;

/* Insurance against two players who will not commit. */
export const PLY_CAP = 160;

/* Six each; you also lose if three end up in the sea.

   The board is six squares across on purpose. The first version used
   eight and nothing was ever pushed off in thirty-two self-play games
   — the rim was simply too far away to threaten, so both sides parked
   in the middle and shuffled. On six, the sea is two steps from
   anywhere and every position is under pressure. */
export const LOSE_AT = 3;

export function startBoard(){
  const b = new Array(SZ).fill(0);
  for(let f = 0; f < N; f++){
    b[0 * N + f] = mk(RED);
    b[(N - 1) * N + f] = mk(BLUE);
  }
  return {b};
}

const inBounds = (r, f) => r >= 0 && r < N && f >= 0 && f < N;
const at = (r, f) => r * N + f;

/* How many of `c`'s pieces line up behind `from`, counting `from`
   itself, walking against the push direction. */
function lineBehind(board, from, dr, df, c){
  let n = 0, r = rowOf(from), f = colOf(from);
  while(inBounds(r, f) && board[at(r, f)] && col(board[at(r, f)]) === c && n < MAX_PUSH){
    n++; r -= dr; f -= df;
  }
  return n;
}

/* Describes a shove, or null if it is not legal.
   { pushed: [squares], off: how many go over the edge } */
export function shove(board, from, dr, df){
  const c = col(board[from]);
  const mine = lineBehind(board, from, dr, df, c);
  if(!mine) return null;

  const pushed = [];
  let r = rowOf(from) + dr, f = colOf(from) + df;
  while(inBounds(r, f) && board[at(r, f)] && col(board[at(r, f)]) !== c){
    pushed.push(at(r, f));
    if(pushed.length > MAX_PUSHED) return null;      // too many to move
    r += dr; f += df;
  }
  if(!pushed.length) return null;                    // nothing to shove
  if(pushed.length >= mine) return null;             // not enough weight

  // the square past the enemy line: empty means they slide, off-board
  // means the last one goes over
  if(inBounds(r, f) && board[at(r, f)]) return null; // blocked by anybody
  return {pushed, off: inBounds(r, f) ? 0 : 1};
}

export function genMoves(board, c){
  const out = [];
  for(let i = 0; i < SZ; i++){
    const p = board[i];
    if(!p || col(p) !== c) continue;
    const r = rowOf(i), f = colOf(i);
    for(const [dr, df] of DIRS){
      const nr = r + dr, nf = f + df;
      if(!inBounds(nr, nf)) continue;
      const j = at(nr, nf);
      if(!board[j]){ out.push(packMove(i, j)); continue; }         // plain step
      if(col(board[j]) === c) continue;                            // own back
      if(shove(board, i, dr, df)) out.push(packMove(i, j));        // shove
    }
  }
  return out;
}

export const outcome = (board, from, to) => board[to] ? 'push' : 'move';

/* Returns a new board; never mutates the one passed in.

   `off` is how many enemy pieces went over the edge. `moved` lists
   every [from, to] a piece travelled, including the shoved ones, so
   the interface can animate a whole line without having to work out
   for itself what a shove did. */
export function apply(board, mv){
  const from = moveFrom(mv), to = moveTo(mv);
  const nb = board.slice();
  const dr = Math.sign(rowOf(to) - rowOf(from));
  const df = Math.sign(colOf(to) - colOf(from));
  const o = outcome(board, from, to);
  const moved = [];
  let off = 0;

  if(o === 'push'){
    const s = shove(board, from, dr, df);
    // walk the shoved line from the back so nothing overwrites itself
    for(let k = s.pushed.length - 1; k >= 0; k--){
      const j = s.pushed[k];
      const nr = rowOf(j) + dr, nf = colOf(j) + df;
      if(inBounds(nr, nf)){
        nb[at(nr, nf)] = nb[j];
        moved.push([j, at(nr, nf)]);
      }else{
        off++;                                      // over the edge, gone
        moved.push([j, -1]);
      }
      nb[j] = 0;
    }
  }

  nb[to] = board[from];
  nb[from] = 0;
  moved.push([from, to]);

  return {bd: nb, from, to, o, off, moved};
}

export function count(board, c){
  let n = 0;
  for(let i = 0; i < SZ; i++){ const p = board[i]; if(p && col(p) === c) n++; }
  return n;
}
