/* ============================================================
   Board encoding and the rules of the game. Pure functions only —
   nothing here touches the DOM, the network or the running game.

   Encoding: 0 = empty. 1..3 = blue R,P,S. 4..6 = red R,P,S.
   type: 0=Rock 1=Paper 2=Scissors ; colour: 0=blue 1=red
   beats(a,b)  <=>  (a+2)%3 === b
   Blue starts at the bottom (rows 6-8) and wins on row 0.
   ============================================================ */
export const SZ = 81;
export const BLUE = 0, RED = 1;
export const T_R = 0, T_P = 1, T_S = 2;

export const col = p => p > 3 ? RED : BLUE;
export const typ = p => (p - 1) % 3;
export const mk = (c, t) => c * 3 + t + 1;
export const beats = (a, b) => ((a + 2) % 3) === b;
export const goalRow = c => c === BLUE ? 0 : 8;
export const rowOf = i => (i / 9) | 0;
export const colOf = i => i % 9;

/* "d7" style name for a square, for the move log. */
export const sq = i => String.fromCharCode(97 + colOf(i)) + (rowOf(i) + 1);

export const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

/* A move is packed into one integer: from*81 + to. */
export const packMove = (from, to) => from * 81 + to;
export const moveFrom = mv => (mv / 81) | 0;
export const moveTo   = mv => mv % 81;

/* Opening setup: three of each type on files d-f. The row nearest the enemy
   holds rock, then scissors, then paper tucked in behind on the back row. */
const RED_ROWS  = [[0, T_P], [1, T_S], [2, T_R]];
const BLUE_ROWS = [[8, T_P], [7, T_S], [6, T_R]];

export function startBoard(){
  const b = new Array(SZ).fill(0), id = new Array(SZ).fill(0);
  let n = 1;
  const place = (rows, side) => {
    for(const [r, t] of rows)
      for(let f = 3; f <= 5; f++){ const i = r * 9 + f; b[i] = mk(side, t); id[i] = n++; }
  };
  place(RED_ROWS, RED);
  place(BLUE_ROWS, BLUE);
  return {b, id};
}

/* Every piece moves one square in any direction, like a chess king. */
export function genMoves(board, c){
  const out = [];
  for(let i = 0; i < SZ; i++){
    const p = board[i]; if(!p || col(p) !== c) continue;
    const r = rowOf(i), cc = colOf(i);
    for(const d of DIRS){
      const nr = r + d[0], nc = cc + d[1];
      if(nr < 0 || nr > 8 || nc < 0 || nc > 8) continue;
      const j = nr * 9 + nc, q = board[j];
      if(q && col(q) === c) continue;
      out.push(packMove(i, j));
    }
  }
  return out;
}

/* 'move' | 'win' | 'lose' | 'trade', from the mover's point of view. */
export function outcome(board, from, to){
  const q = board[to]; if(!q) return 'move';
  const a = typ(board[from]), d = typ(q);
  if(a === d) return 'trade';
  return beats(a, d) ? 'win' : 'lose';
}

/* Returns a new board; never mutates the one passed in. */
export function apply(board, mv){
  const from = moveFrom(mv), to = moveTo(mv);
  const nb = board.slice(), p = board[from], o = outcome(board, from, to);
  nb[from] = 0;
  if(o === 'move' || o === 'win') nb[to] = p;
  else if(o === 'lose') nb[to] = board[to];
  else nb[to] = 0;
  return {bd: nb, from, to, o};
}

export function count(board, c){
  let n = 0;
  for(let i = 0; i < SZ; i++){ const p = board[i]; if(p && col(p) === c) n++; }
  return n;
}
