/* ============================================================
   Anvil's computer player.

   Negamax with alpha-beta and a time budget. Up to eight pieces
   times four directions, so the branching factor is modest.

   Depends only on the rules. No DOM, no network.
   ============================================================ */
import {SZ, N, BLUE, RED, col, rowOf, colOf, LOSE_AT, CENTRE, HOLD_TO_WIN,
        holds, genMoves, apply, count, moveTo} from './rules.js';

const WIN = 1e6;
const ABORT = {};
let _nodes = 0;
let _deadline = Infinity;

/* Positive is good for blue. The middle is the game, so it dominates;
   after that, material, and then not standing on the rim where a shove
   puts you in the sea. */
function evalBlue(board){
  let s = (holds(board, BLUE) - holds(board, RED)) * 900;
  for(let i = 0; i < SZ; i++){
    const p = board[i]; if(!p) continue;
    const c = col(p), r = rowOf(i), f = colOf(i);
    const edge = Math.min(r, N - 1 - r, f, N - 1 - f);   // 0 on the rim
    let v = 1000 + edge * 60;
    // being next to the middle is worth something: that is where you
    // shove from
    const near = CENTRE.some(k =>
      Math.abs(rowOf(k) - r) + Math.abs(colOf(k) - f) === 1);
    if(near) v += 90;
    s += c === BLUE ? v : -v;
  }
  s += (genMoves(board, BLUE).length - genMoves(board, RED).length) * 3;
  return s;
}

/* Anything that puts a piece in the sea comes first. */
function order(board, moves, c){
  const sc = moves.map(mv => {
    const res = apply(board, mv);
    return res.off * 5000 + (res.o === 'push' ? 60 : 0);
  });
  return moves.map((m, k) => [sc[k], m]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

/* `c` has lost: too few pieces, or the other side is sitting on the
   anvil at the moment `c` would move. */
const beaten = (board, c) =>
  count(board, c) <= LOSE_AT || holds(board, 1 - c) >= HOLD_TO_WIN;

function negamax(board, c, depth, alpha, beta){
  if((++_nodes & 511) === 0 && Date.now() > _deadline) throw ABORT;
  const moves = order(board, genMoves(board, c), c);
  if(!moves.length) return -WIN;                 // no move at all: you lose
  let best = -Infinity;
  for(const mv of moves){
    const res = apply(board, mv);
    const s = beaten(res.bd, 1 - c) ? WIN + depth
            : depth <= 1 ? (c === BLUE ? 1 : -1) * evalBlue(res.bd)
            : -negamax(res.bd, 1 - c, depth - 1, -beta, -alpha);
    if(s > best) best = s;
    if(best > alpha) alpha = best;
    if(alpha >= beta) break;
  }
  return best;
}

export function bestMove(board, c, depth, sloppy){
  let ms = genMoves(board, c);
  if(!ms.length) return null;
  for(let i = ms.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [ms[i], ms[j]] = [ms[j], ms[i]];
  }
  if(sloppy && Math.random() < 0.3) return ms[0];
  ms = order(board, ms, c);

  let best = -Infinity, cand = [], alpha = -Infinity;
  for(const mv of ms){
    const res = apply(board, mv);
    const s = beaten(res.bd, 1 - c) ? WIN + depth
            : depth <= 1 ? (c === BLUE ? 1 : -1) * evalBlue(res.bd)
            : -negamax(res.bd, 1 - c, depth - 1, -Infinity, -alpha);
    if(s > best + 1e-9){ best = s; cand = [mv]; alpha = Math.max(alpha, s); }
    else if(s > best - 1e-9) cand.push(mv);
  }
  return cand[(Math.random() * cand.length) | 0];
}

export function bestMoveTimed(board, c, maxDepth, budgetMs, sloppy){
  let best = null;
  _nodes = 0; _deadline = Date.now() + budgetMs;
  try{
    for(let d = 2; d <= maxDepth; d++){
      const m = bestMove(board, c, d, sloppy);
      if(m != null) best = m;
      if(Date.now() > _deadline) break;
    }
  }catch(e){
    if(e !== ABORT){ _deadline = Infinity; throw e; }
  }
  _deadline = Infinity;
  return best != null ? best : bestMove(board, c, 2, sloppy);
}
