/* ============================================================
   The computer player for Barbican.

   Negamax with alpha-beta, iterative deepening and hard forward
   pruning, as the other three use. What is different is the
   evaluation, and it is different in a way worth stating plainly:

   THE SCORE IS NOT SYMMETRICAL

   Negamax needs one number that both sides read in opposite
   directions, so everything below is scored from the besieger's
   point of view and the garrison simply wants it small. But the two
   sides are not doing the same job, so the terms are not mirrored:
   the besieger is paid for breaking walls, getting men inside and
   standing in the keep, and the garrison is paid for none of those —
   it is paid, entirely, by the clock running down.

   That last term is what makes the garrison play like a garrison. An
   early version had no clock in the evaluation at all, and the
   defence sallied out to fight in the open fields on turn three,
   because trading evenly looked fine to it. Once every ply that
   passes is worth something to the defender, it does what a garrison
   actually does: stands on the wall and refuses.
   ============================================================ */
import {BESIEGER, GARRISON, SZ, geo, TYPES, KEEP_SQ, GATE_SQ,
        CAPTAIN, LEVY, SERJEANT, RAM, TREB, LADDER, MINER,
        CASTELLAN, ARCHER, GUARD, KNIGHT,
        PLY_CAP, MIN_BESIEGER, isWallKind,
        genMoves, apply, controlOf, countUnits, unitAt, inKeep,
        siegeTargets, breaches, verdict,
        isPass, moveFrom, moveTo, PASS} from './rules.js';
import {RUBBLE, owner} from '../_shared/control.js';

const WIN = 1e6;
const ABORT = {};
let _nodes = 0, _deadline = Infinity;

const VALUE = [];
VALUE[CAPTAIN] = 300; VALUE[LEVY] = 80;  VALUE[SERJEANT] = 130;
VALUE[RAM] = 260;     VALUE[TREB] = 300; VALUE[LADDER] = 200; VALUE[MINER] = 240;
VALUE[CASTELLAN] = 340; VALUE[ARCHER] = 190; VALUE[GUARD] = 200; VALUE[KNIGHT] = 210;

/* Breaching used to outscore everything the besieger could do with
   the hole afterwards, so it knocked the castle flat and stood in the
   fields admiring it. Masonry is now worth rather less than men in
   the courtyard. */
const WALL_W    = 16;    // every point of masonry knocked down
const BREACH_W  = 130;   // and more for a hole
const INSIDE_W  = 220;   // a man in the courtyard
const KEEP_W    = 2200;  // a man in the keep
const CLOCK_W   = 5.5;   // every ply that passes belongs to the garrison
const NEAR_W    = 26;

/* Distance to the keep from everywhere, once. */
const D_KEEP = new Int16Array(SZ);
const D_GATE = new Int16Array(SZ);
for(let i = 0; i < SZ; i++){ D_KEEP[i] = geo.dist(KEEP_SQ, i); D_GATE[i] = geo.dist(GATE_SQ, i); }

/* Inside the curtain: the courtyard the besieger has to reach. */
const INSIDE = new Uint8Array(SZ);
for(let r = 2; r <= 5; r++) for(let c = 5; c <= 9; c++) INSIDE[geo.at(r, c)] = 1;

/* Positive is good for the besieger. */
export function evalBesieger(s){
  let score = 0;

  for(let k = 0; k < s.n; k++){
    if(!s.live[k]) continue;
    score += (s.side[k] === BESIEGER ? 1 : -1) * VALUE[s.type[k]];
  }

  /* the masonry */
  let hp = 0;
  for(let i = 0; i < SZ; i++) if(isWallKind(s.ter[i])) hp += s.hp[i];
  score -= hp * WALL_W;
  score += breaches(s) * BREACH_W;

  /* men where they need to be */
  let best = 99;
  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== BESIEGER) continue;
    const i = s.sq[k];
    if(INSIDE[i]) score += INSIDE_W;
    const d = D_KEEP[i];
    if(d < best) best = d;
  }
  score -= best * NEAR_W;
  if(inKeep(s, BESIEGER)) score += KEEP_W;

  /* Engines want to be in range and alive; a trebuchet that has
     nothing to shoot at is a wagon. */
  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== BESIEGER) continue;
    const t = s.type[k];
    if(t === TREB || t === RAM || t === MINER)
      if(siegeTargets(s, k).length) score += 45;
    if(t === LADDER && D_GATE[s.sq[k]] < 9) score += 20;
  }

  /* the clock */
  score -= (PLY_CAP - s.ply) * -CLOCK_W;
  score -= s.ply * CLOCK_W * 2;

  return score;
}

function rank(s, moves, side){
  const f = controlOf(s);
  const sc = new Float64Array(moves.length);
  for(let k = 0; k < moves.length; k++){
    const mv = moves[k];
    if(isPass(mv)){ sc[k] = -1e9; continue; }
    const from = moveFrom(mv), to = moveTo(mv);
    const u = unitAt(s, from);
    const ty = u >= 0 ? s.type[u] : -1;
    let v = 0;

    if(isWallKind(s.ter[to])){
      /* siege work: always worth looking at, and worth more the
         closer that stretch of wall is to falling */
      v = 500 - s.hp[to] * 12;
    }else if(side === BESIEGER){
      v = (D_KEEP[from] - D_KEEP[to]) * 26 - D_KEEP[to] * 2;
      if(INSIDE[to]) v += 160;
      if(s.ter[to] === RUBBLE) v += 90;
      if(ty === TREB || ty === RAM || ty === MINER) v += 30;
      if(ty === CAPTAIN) v -= 30;
    }else{
      /* the garrison: hold the breach, hold the keep, and only leave
         the wall to kill something that is knocking it down */
      v = -D_KEEP[to] * 3;
      if(s.ter[to] === RUBBLE) v += 150;
      if(INSIDE[to]) v += 40;
      if(isWallKind(s.ter[from]) && !isWallKind(s.ter[to])) v -= 70;
      const enemy = f[to];
      if(enemy > 0) v += 40;
      if(ty === KNIGHT) v += 25;
    }
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
  if(v) return v.w === side ? WIN + depth : -(WIN + depth);
  if(depth <= 0){
    const e = evalBesieger(s);
    return (side === BESIEGER ? 1 : -1) * e;
  }
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
