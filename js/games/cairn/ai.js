/* ============================================================
   Cairn's computer player.

   Negamax with alpha-beta and a time budget. The branching factor
   is the largest of any game here — every stack has up to eight
   directions — so the ordering matters more than usual.

   Depends only on the rules. No DOM, no network.
   ============================================================ */
import {SZ, BLUE, RED, owner, heightOf, MAX_HEIGHT, LOSE_AT,
        genMoves, apply, count, controls, moveTo} from './rules.js';

const WIN = 1e6;
const ABORT = {};
let _nodes = 0;
let _deadline = Infinity;

/* Positive is good for blue.

   A piece sitting in a stack its own colour controls is fully yours.
   The same piece buried under an enemy is a hostage: still countable,
   but they decide when it comes back. Height is worth something for
   reach and costs something for being a target. */
function evalBlue(board){
  let s = 0;
  for(const st of board){
    if(!st.length) continue;
    const own = owner(st);
    const h = heightOf(st);
    s += own === BLUE ? 70 : -70;               // controlling a stack
    for(const p of st){
      const v = (p === own) ? 100 : 55;
      s += p === BLUE ? v : -v;
    }
    if(h >= MAX_HEIGHT - 1){                    // one landing from spilling
      s += own === BLUE ? -45 * (h - (MAX_HEIGHT - 2)) : 45 * (h - (MAX_HEIGHT - 2));
    }
  }
  return s;
}

/* Taking a stack flips everything under it, so size the shot by how
   much it flips. */
function order(board, moves){
  const sc = moves.map(mv => {
    const to = moveTo(mv);
    const there = board[to];
    if(!there.length) return 0;
    return heightOf(there) * 300;
  });
  return moves.map((m, k) => [sc[k], m]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

const beaten = (board, c) => count(board, c) <= LOSE_AT || controls(board, c) === 0;

function negamax(board, c, depth, alpha, beta){
  if((++_nodes & 511) === 0 && Date.now() > _deadline) throw ABORT;
  const moves = order(board, genMoves(board, c));
  if(!moves.length) return -WIN;
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
  ms = order(board, ms);

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
