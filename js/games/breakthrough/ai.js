/* ============================================================
   The computer player for Breakthrough.

   Negamax, alpha-beta, iterative deepening, hard forward pruning —
   the same skeleton as the other two — over a quite different idea
   of what is worth having.

   The evaluation has to understand three things the other games do
   not. Depth is the win condition, so a unit two rows into their
   half is worth more than the same unit at home. Pressure is stored
   progress, so a build-up is an asset even though it has changed
   nothing on the board yet. And an exploitation in hand is worth a
   great deal, because those moves are free.

   The hardest part was teaching it to mass. A first version scored
   pressure per square and spread its army evenly along the front to
   collect as much of it as possible, which is exactly wrong: a crack
   needs three *connected* squares at breaking point, and nine
   scattered ones are worth nothing at all. The pressure term is
   therefore scored on the best connected run, not on the total.
   ============================================================ */
import {BLUE, RED, SZ, geo, OBJECTIVES, REAR, TYPES, GEN, INF, ARM, ART, REC, MIL,
        PRESS_CAP, CRACK_LEN, BREAK, EXPLOIT, LODGE_MIN,
        genMoves, apply, controlOf, splitOf, pressOf, cracks, rearHeld,
        countUnits, deepest, verdict, rowOf, colOf, H,
        isPass, moveFrom, moveTo, PASS} from './rules.js';
import {owner} from '../_shared/control.js';

const WIN = 1e6;
const ABORT = {};
let _nodes = 0, _deadline = Infinity;

const VALUE = [];
VALUE[GEN] = 900; VALUE[INF] = 105; VALUE[ARM] = 175;
VALUE[ART] = 150; VALUE[REC] = 85;  VALUE[MIL] = 65;

const REAR_W    = 420;   // their rear depots — the win condition itself
const DEFEND_W  = 150;   // and keeping them off yours
const DEPTH_W   = 14;    // depth still matters, but only as a means
const PRESS_W   = 34;    // the best connected run, not the total
const EXPLOIT_W = 130;
const TERR_W    = 3;

/* The longest connected run of squares at or near breaking point.
   This is the number that actually predicts a crack. */
function bestRun(s, side){
  const p = pressOf(s, side);
  const hot = new Uint8Array(SZ);
  let sum = 0;
  for(let i = 0; i < SZ; i++){
    if(p[i] > 0) sum += p[i];
    if(p[i] >= PRESS_CAP - 1) hot[i] = 1;
  }
  const seen = new Uint8Array(SZ);
  let best = 0;
  for(let i = 0; i < SZ; i++){
    if(!hot[i] || seen[i]) continue;
    const comp = [i]; seen[i] = 1;
    for(let h = 0; h < comp.length; h++)
      for(const j of geo.N4[comp[h]])
        if(hot[j] && !seen[j]){ seen[j] = 1; comp.push(j); }
    if(comp.length > best) best = comp.length;
  }
  return {run: best, sum};
}

export function evalBlue(s){
  const f = controlOf(s);
  let score = 0;

  /* Their depots are what you win with; yours are what you lose by.
     Weighting only the first made the machine abandon its own rear
     and trade breakthroughs, which is a draw at best. */
  score += rearHeld(s, BLUE, f) * REAR_W - rearHeld(s, RED, f) * DEFEND_W;
  score -= rearHeld(s, RED, f) * REAR_W - rearHeld(s, BLUE, f) * DEFEND_W;
  score += (deepest(s, BLUE) - deepest(s, RED)) * DEPTH_W;

  const rb = bestRun(s, BLUE), rr = bestRun(s, RED);
  /* A run is worth its length squared: two connected squares are
     more than twice as close to a crack as one isolated one. */
  score += (rb.run * rb.run - rr.run * rr.run) * PRESS_W;
  score += (rb.sum - rr.sum) * 3;

  if(s.exploit > 0 && s.expSide >= 0)
    score += (s.expSide === BLUE ? 1 : -1) * s.exploit * EXPLOIT_W;

  let bt = 0, rt = 0;
  for(let i = 0; i < SZ; i++){ const v = f[i]; if(v > 0) bt++; else if(v < 0) rt++; }
  score += (bt - rt) * TERR_W;

  for(let k = 0; k < s.n; k++){
    if(!s.live[k]) continue;
    const sign = s.side[k] === BLUE ? 1 : -1;
    score += sign * VALUE[s.type[k]];
    const v = s.side[k] === BLUE ? f[s.sq[k]] : -f[s.sq[k]];
    if(v <= -(BREAK - 2)) score -= sign * VALUE[s.type[k]] * 0.5;
  }
  return score;
}

function rank(s, moves, side){
  const f = controlOf(s);
  const sp = splitOf(s);
  const mine = side === BLUE ? sp.b : sp.r;
  const p = pressOf(s, side);
  const sc = new Float64Array(moves.length);
  const home = side === BLUE ? H - 1 : 0;
  const targets = REAR[side], mineRear = REAR[1 - side];

  for(let k = 0; k < moves.length; k++){
    const mv = moves[k];
    if(isPass(mv)){ sc[k] = -1e9; continue; }
    const from = moveFrom(mv), to = moveTo(mv);
    let v = 0;
    /* forward is good, and forward is the whole game */
    const dFrom = Math.abs(rowOf(from) - home), dTo = Math.abs(rowOf(to) - home);
    v += (dTo - dFrom) * 30;
    v += dTo * 4;
    /* moving next to ground you are already pressing extends a run */
    let near = 0;
    for(const j of geo.N8[to]) if(p[j] > 0) near += p[j];
    v += near * 12;
    /* and moving where you already lean adds weight to it */
    for(const j of geo.N4[to]){
      const theirs = side === BLUE ? f[j] < 0 : f[j] > 0;
      if(theirs && mine[j] > 0) v += 9;
    }
    /* toward one of their depots, or back to cover one of yours */
    for(const t of targets) v += Math.max(0, 12 - geo.dist(to, t)) * 14;
    for(const t of mineRear){
      const threat = side === BLUE ? -f[t] : f[t];
      if(threat > 0) v += Math.max(0, 10 - geo.dist(to, t)) * 9;
    }
    if(s.exploit > 0) v += (dTo - dFrom) * 40;    // in a breakthrough, run
    sc[k] = v;
  }
  const idx = new Array(moves.length);
  for(let k = 0; k < moves.length; k++) idx[k] = k;
  idx.sort((a, b) => sc[b] - sc[a]);
  const out = new Array(moves.length);
  for(let k = 0; k < moves.length; k++) out[k] = moves[idx[k]];
  return out;
}

const WIDTH = [1, 6, 10, 14, 18, 22];
const widthAt = d => WIDTH[Math.min(d, WIDTH.length - 1)];

function negamax(s, depth, alpha, beta){
  if((++_nodes & 127) === 0 && Date.now() > _deadline) throw ABORT;
  const side = s.turn;
  const v = verdict(s, side);
  if(v) return v.w === -1 ? 0 : (v.w === side ? WIN + depth : -(WIN + depth));
  if(depth <= 0) return (side === BLUE ? 1 : -1) * evalBlue(s);

  const all = rank(s, genMoves(s, side), side);
  const width = Math.min(all.length, widthAt(depth));
  let best = -Infinity;
  for(let i = 0; i < width; i++){
    const r = apply(s, all[i]);
    const sc = -negamax(r.st, depth - 1, -beta, -alpha);
    if(sc > best) best = sc;
    if(best > alpha) alpha = best;
    if(alpha >= beta) break;
  }
  return best === -Infinity ? 0 : best;
}

export function bestMove(s, depth, sloppy){
  const side = s.turn;
  const all = genMoves(s, side);
  if(!all.length) return PASS;
  if(all.length === 1) return all[0];
  const moves = rank(s, all, side);
  if(sloppy && Math.random() < 0.18)
    return moves[(Math.random() * Math.min(8, moves.length)) | 0];

  const width = Math.min(moves.length, 26);
  let best = -Infinity, cand = [], alpha = -Infinity;
  for(let i = 0; i < width; i++){
    const r = apply(s, moves[i]);
    const sc = -negamax(r.st, depth - 1, -Infinity, -alpha);
    if(sc > best + 1e-9){ best = sc; cand = [moves[i]]; alpha = Math.max(alpha, sc); }
    else if(sc > best - 1e-9) cand.push(moves[i]);
  }
  return cand[(Math.random() * cand.length) | 0];
}

export function bestMoveTimed(s, maxDepth, budgetMs, sloppy){
  let best = null;
  _nodes = 0; _deadline = Date.now() + budgetMs;
  try{
    for(let d = 2; d <= maxDepth; d++){
      const m = bestMove(s, d, sloppy);
      if(m != null) best = m;
      if(Date.now() > _deadline) break;
    }
  }catch(e){ if(e !== ABORT){ _deadline = Infinity; throw e; } }
  _deadline = Infinity;
  return best != null ? best : bestMove(s, 2, sloppy);
}
export const nodes = () => _nodes;
