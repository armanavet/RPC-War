/* ============================================================
   Cairn — the rules, and nothing else.

   Pure functions: no DOM, no network. The edge function imports
   this file to verify finished games, so it must stay that way.

   A stack moves as far as it is tall, and whoever lands on top owns
   everything underneath. Height is your engine and your liability at
   the same time: it reaches further, but it is one landing away from
   changing hands, and every piece you bury is a hostage.

   Board representation
     A square holds a stack, bottom-first, as an array of 0 (seat A)
     and 1 (seat B). `[]` is empty. The top of the stack is the last
     element, and its colour owns the whole pile.

     The board is therefore an array of arrays, not an array of ints.
     Everything that clones it must clone the inner arrays too — see
     cloneBoard.

   Moves still pack into one integer: from * 49 + to on a 7x7.
   ============================================================ */
export const N = 7;
export const SZ = 49;
export const BLUE = 0, RED = 1;

export const rowOf = i => (i / N) | 0;
export const colOf = i => i % N;
export const sq = i => String.fromCharCode(97 + colOf(i)) + (N - rowOf(i));

export const packMove = (from, to) => from * SZ + to;
export const moveFrom = mv => (mv / SZ) | 0;
export const moveTo   = mv => mv % SZ;

export const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

/* Taller than this and the bottom falls off, permanently.

   Three, not five. At five, captures were almost always reversible —
   you take a stack, they take it back — and only a spill removed
   anything for good. Half of all self-play games ran to the cap. At
   three, most landings spill something, so the board actually
   drains. */
export const MAX_HEIGHT = 3;

/* You are out when you have this many pieces left on the board.
   Counting what remains rather than what has spilled keeps the whole
   result derivable from the board alone, which is what lets the
   server verify a game without replaying any extra state.

   Note the computer needs to look three plies ahead to convert an
   advantage here — at two it shuffles and the game caps out. The
   easy level is deliberately the only one that searches shallower. */
export const LOSE_AT = 6;

/* Insurance: two players who never commit still have to stop. */
export const PLY_CAP = 150;

export const owner = stack => stack.length ? stack[stack.length - 1] : -1;
export const heightOf = stack => stack.length;

export const cloneBoard = b => b.map(s => s.slice());

/* Twelve each, interleaved so both sides start entangled. Separate
   camps would just mean a long march before anything happened. */
export function startBoard(){
  const b = Array.from({length: SZ}, () => []);
  let n = 0;
  for(let i = 0; i < SZ; i++){
    const r = rowOf(i), f = colOf(i);
    if((r + f) % 2 !== 0) continue;            // every other square
    if(r === 3 && f === 3) continue;           // leave the middle clear
    b[i] = [n % 2 === 0 ? BLUE : RED];
    n++;
  }
  return {b};
}

const inBounds = (r, f) => r >= 0 && r < N && f >= 0 && f < N;

/* A stack moves exactly its own height, in a straight line, and may
   pass over anything on the way. Only the landing square matters. */
export function genMoves(board, c){
  const out = [];
  for(let i = 0; i < SZ; i++){
    const st = board[i];
    if(!st.length || owner(st) !== c) continue;
    const d = heightOf(st);
    const r = rowOf(i), f = colOf(i);
    for(const [dr, df] of DIRS){
      const nr = r + dr * d, nf = f + df * d;
      if(!inBounds(nr, nf)) continue;
      out.push(packMove(i, nr * N + nf));
    }
  }
  return out;
}

export function outcome(board, from, to){
  const there = board[to];
  if(!there.length) return 'move';
  return owner(there) === owner(board[from]) ? 'merge' : 'capture';
}

/* Returns a new board; never mutates the one passed in.

   `spilled` is what fell off the bottom — those pieces are out of the
   game for good, and they are what the win condition counts. */
export function apply(board, mv){
  const from = moveFrom(mv), to = moveTo(mv);
  const nb = cloneBoard(board);
  const moving = nb[from];
  nb[from] = [];

  const landed = nb[to].concat(moving);        // ours goes on top
  const spilled = [];
  while(landed.length > MAX_HEIGHT) spilled.push(landed.shift());
  nb[to] = landed;

  const o = outcome(board, from, to);
  return {bd: nb, from, to, o, spilled, height: landed.length};
}

/* How many of `c`'s pieces are on the board at all, buried or not. */
export function count(board, c){
  let n = 0;
  for(const st of board) for(const p of st) if(p === c) n++;
  return n;
}

/* Stacks `c` controls. Lose them all and you cannot move. */
export function controls(board, c){
  let n = 0;
  for(const st of board) if(st.length && owner(st) === c) n++;
  return n;
}
