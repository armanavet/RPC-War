/* ============================================================
   Slipstream's computer player.

   Negamax with alpha-beta and a time budget. The branching factor
   is small — four pieces, at most eight directions each — so it
   sees a long way for very little work.

   Depends only on the rules. No DOM, no network.
   ============================================================ */
import {SZ, BLUE, RED, col, isWall, rowOf, colOf, ringOf, ringsClosed,
        untilShrink, SHRINK_EVERY, genMoves, apply, count, moveFrom, moveTo} from './rules.js';

const WIN = 1e6;
const ABORT = {};
let _nodes = 0;
let _deadline = Infinity;

/* Positive is good for blue. Material dominates — a piece is the
   whole game here — with a nudge toward the middle, where a piece
   has more directions available and fewer dead ends. */
function evalBlue(board, ply){
  let s = 0;
  for(let i = 0; i < SZ; i++){
    const p = board[i];
    if(!p || isWall(p)) continue;
    const c = col(p), r = rowOf(i), f = colOf(i);
    let v = 1000;
    v += (4 - Math.abs(4 - f)) * 3;
    v += (4 - Math.abs(4 - r)) * 3;

    /* Standing on the ring that is about to fall is close to losing the
       piece. Without this the search happily lets both sides get crushed
       together, which turned a third of self-play games into draws. */
    const soon = untilShrink(ply);
    if(soon !== null && ringOf(i) === ringsClosed(ply)){
      v -= (SHRINK_EVERY - soon + 1) * 70;
    }
    s += c === BLUE ? v : -v;
  }
  // being able to move at all is worth something
  s += (genMoves(board, BLUE, ply).length - genMoves(board, RED, ply).length) * 4;
  return s;
}

/* Captures first: they are the only thing that ends a game. */
function order(board, moves){
  const sc = moves.map(mv => board[moveTo(mv)] ? 1000 : 0);
  return moves.map((m, k) => [sc[k], m]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

/* Did that move just end it for `mover`? */
function terminal(board, mover){
  return count(board, 1 - mover) === 0 ? mover : null;
}

function negamax(board, c, depth, alpha, beta, ply){
  if((++_nodes & 511) === 0 && Date.now() > _deadline) throw ABORT;
  const moves = order(board, genMoves(board, c, ply));
  if(!moves.length) return -WIN;               // jammed: you lose
  let best = -Infinity;
  for(const mv of moves){
    const res = apply(board, mv, ply);
    const won = terminal(res.bd, c);
    const s = won !== null ? WIN + depth
            : depth <= 1 ? (c === BLUE ? 1 : -1) * evalBlue(res.bd, ply + 1)
            : -negamax(res.bd, 1 - c, depth - 1, -beta, -alpha, ply + 1);
    if(s > best) best = s;
    if(best > alpha) alpha = best;
    if(alpha >= beta) break;
  }
  return best;
}

export function bestMove(board, c, depth, sloppy, ply = 0){
  let ms = genMoves(board, c, ply);
  if(!ms.length) return null;
  for(let i = ms.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [ms[i], ms[j]] = [ms[j], ms[i]];
  }
  if(sloppy && Math.random() < 0.3) return ms[0];
  ms = order(board, ms);

  let best = -Infinity, cand = [], alpha = -Infinity;
  for(const mv of ms){
    const res = apply(board, mv, ply);
    const won = terminal(res.bd, c);
    const s = won !== null ? WIN + depth
            : depth <= 1 ? (c === BLUE ? 1 : -1) * evalBlue(res.bd, ply + 1)
            : -negamax(res.bd, 1 - c, depth - 1, -Infinity, -alpha, ply + 1);
    if(s > best + 1e-9){ best = s; cand = [mv]; alpha = Math.max(alpha, s); }
    else if(s > best - 1e-9) cand.push(mv);
  }
  return cand[(Math.random() * cand.length) | 0];
}

export function bestMoveTimed(board, c, maxDepth, budgetMs, sloppy, ply = 0){
  let best = null;
  _nodes = 0; _deadline = Date.now() + budgetMs;
  try{
    for(let d = 2; d <= maxDepth; d++){
      const m = bestMove(board, c, d, sloppy, ply);
      if(m != null) best = m;
      if(Date.now() > _deadline) break;
    }
  }catch(e){
    if(e !== ABORT){ _deadline = Infinity; throw e; }
  }
  _deadline = Infinity;
  return best != null ? best : bestMove(board, c, 2, sloppy, ply);
}
