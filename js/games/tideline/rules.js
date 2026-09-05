/* ============================================================
   Tideline — the rules, and nothing else.

   Pure functions: no DOM, no network. The edge functions import this
   file to verify finished games and play the bots.

   THE IDEA

   Ground you take stays taken. At the end of your turn every square
   you control that touches ground you already own becomes yours, for
   good, until somebody takes it back. The border between the two
   colours is the tideline, and the whole game is moving it.

   THE LEASH

   A unit may only end its move on your own ground or on a square
   touching it. An army physically cannot outrun its territory, so
   there are no cavalry raids into the enemy rear and no clever
   teleporting spearheads — there is a line, and it moves at the
   speed ground can be converted. That single restriction is what
   makes this a different game from Salient rather than a reskin of
   it, and it is why this one has no supply rule: the leash already
   does that job, without any bookkeeping.

   THE RISK

   Step onto ground the enemy owns and you must take it that same
   turn. A unit still standing on their ground when your next turn
   begins is thrown back to the nearest ground of your own.

   It used to be destroyed instead. That version produced fifteen
   deaths a side per game and every single test ended with somebody's
   general killed rather than any ground being won — an assault was
   simply never worth making, so the machine made them anyway and
   bled to death. Costing a failed attack its tempo and its position,
   rather than the unit, is what turned attacking into a decision
   instead of a mistake.

   ENCODING

   Squares 0..186 on a board 17 wide and 11 high, index 0 top-left.
   A move packs as from * 187 + to.
   A build packs as BUILD + type * 187 + square.
   PASS is legal only when nothing else is.
   ============================================================ */
import {makeGeo, field, reachable, zoneOfControl, TERRAIN,
        OPEN, WOODS, HILL, TOWN, RIVER, FORD, ROAD, MARSH, owner} from '../_shared/control.js';

export const W = 17, H = 11;
export const geo = makeGeo(W, H);
export const SZ = geo.SZ;
export const BLUE = 0, RED = 1, NEUTRAL = 2;
export const {rowOf, colOf, at, sq, dist} = geo;

/* ---------- units ---------- */
export const GEN = 0, INF = 1, ARM = 2, ART = 3, MIL = 4;

export const TYPES = [
  {key:'gen', name:'General',   str:5, hole:0, mp:6,  hold:3, free:0, cost:0},
  {key:'inf', name:'Infantry',  str:3, hole:0, mp:4,  hold:3, free:0, cost:3},
  {key:'arm', name:'Armour',    str:4, hole:0, mp:10, hold:1, free:1, cost:5},
  {key:'art', name:'Artillery', str:6, hole:2, mp:4,  hold:0, free:0, cost:5},
  {key:'mil', name:'Militia',   str:2, hole:0, mp:4,  hold:4, free:0, cost:2},
];
export const BUILDABLE = [INF, ARM, ART, MIL];

/* ---------- the map ---------- */
export const OBJECTIVES = [
  at(5,8),                    // the centre
  at(3,3),  at(7,13),
  at(3,13), at(7,3),
  at(5,1),  at(5,15),
];

function buildTerrain(){
  const t = new Uint8Array(SZ).fill(OPEN);
  const put = (k, l) => { for(const i of l) t[i] = k; };
  for(let c = 0; c < W; c++){ t[at(1,c)] = ROAD; t[at(9,c)] = ROAD; }
  for(let r = 1; r <= 9; r++){ t[at(r,4)] = ROAD; t[at(r,12)] = ROAD; }
  /* Two river bars either side of the centre town, so the most
     valuable square on the map is an island reached by two fords.
     Everything about the middle game is those two crossings. */
  for(let c = 6; c <= 10; c++){ t[at(4,c)] = RIVER; t[at(6,c)] = RIVER; }
  put(FORD, [at(4,8), at(6,8)]);
  put(HILL,  [at(5,5),at(5,11), at(2,8),at(8,8)]);
  put(WOODS, [at(3,6),at(7,10), at(3,10),at(7,6), at(1,2),at(9,14)]);
  put(MARSH, [at(6,2),at(4,14), at(2,5),at(8,11)]);
  put(TOWN,  OBJECTIVES);
  return t;
}
export const TERRAIN_MAP = buildTerrain();

/* ---------- dials ---------- */
export const BREAK      = 8;     // local superiority that shatters a unit
/* Ground only changes hands where somebody actually dominates it.
   Without this the tide converted every square it merely touched:
   thirty-nine squares changed hands in the first three turns of the
   very first test, which is not a tide, it is a flood. Requiring a
   real margin makes the line move at the speed of massed force. */
export const CONVERT_MIN = 4;
/* Of 187. Lowered from 122: better than a third of games were
   reaching the ply cap and being awarded on a ground count, which is
   a limp way to end a game somebody spent twenty minutes on. */
export const WIN_GROUND = 116;
export const BASE_BP    = 2;     // every turn, however badly it is going
/* Compensation for moving second, in the manner of komi.

   Blue converts ground one turn before red ever does, and in this
   game that lead compounds: ground buys build points, build points
   buy units, units take ground. Over twenty-four self-play games the
   first player won eighteen. Five points is one armour, or an
   infantryman and a militia — enough to answer the opening tempo
   without handing red an army. */
export const RED_KOMI   = 5;
export const BP_CAP     = 14;
export const MAX_UNITS  = 20;
export const PLY_CAP    = 320;

export const PASS  = SZ * SZ;
export const BUILD = SZ * SZ + 1;
export const packMove = (from, to) => from * SZ + to;
export const moveFrom = mv => (mv / SZ) | 0;
export const moveTo   = mv => mv % SZ;
export const isPass   = mv => mv === PASS;
export const isBuild  = mv => mv >= BUILD;
export const buildType = mv => (((mv - BUILD) / SZ) | 0);
export const buildAt   = mv => (mv - BUILD) % SZ;
export const packBuild = (type, i) => BUILD + type * SZ + i;

/* ---------- opening position ----------
   Each side owns its own three rows outright; the five in the middle
   belong to nobody and are what the game is played over. */
const BLUE_SETUP = [
  [GEN, at(10,8)],
  [ART, at(10,4)], [ART, at(10,12)],
  [ARM, at(9,1)],  [ARM, at(9,15)],
  [INF, at(8,3)],  [INF, at(8,6)], [INF, at(8,10)], [INF, at(8,13)],
  [MIL, at(9,7)],  [MIL, at(9,9)],
  [INF, at(7,8)],
];
export const RESERVE = 10;

export function startState(){
  const n = (BLUE_SETUP.length + RESERVE) * 2;
  const own = new Uint8Array(SZ).fill(NEUTRAL);
  for(let r = 0; r <= 2; r++) for(let c = 0; c < W; c++) own[at(r,c)] = RED;
  for(let r = 8; r <= 10; r++) for(let c = 0; c < W; c++) own[at(r,c)] = BLUE;

  const s = {
    n,
    sq: new Int16Array(n), side: new Uint8Array(n), type: new Uint8Array(n),
    live: new Uint8Array(n),
    own, ter: TERRAIN_MAP.slice(),
    turn: BLUE, ply: 0,
    bp: [0, RED_KOMI],
  };
  let k = 0;
  for(const [t, i] of BLUE_SETUP){
    s.sq[k] = i; s.side[k] = BLUE; s.type[k] = t; s.live[k] = 1; k++;
    s.sq[k] = (SZ - 1) - i; s.side[k] = RED; s.type[k] = t; s.live[k] = 1; k++;
  }
  for(let r = 0; r < RESERVE; r++){
    s.sq[k] = 0; s.side[k] = BLUE; s.type[k] = INF; s.live[k] = 0; k++;
    s.sq[k] = 0; s.side[k] = RED;  s.type[k] = INF; s.live[k] = 0; k++;
  }
  return s;
}

export function clone(s){
  return {
    n: s.n,
    sq: s.sq.slice(), side: s.side.slice(), type: s.type.slice(),
    live: s.live.slice(), own: s.own.slice(), ter: s.ter.slice(),
    turn: s.turn, ply: s.ply, bp: [s.bp[0], s.bp[1]],
  };
}

/* ---------- the field ---------- */
const _view = {n: 0};
export function viewOf(s){
  if(_view.n !== s.n){
    _view.n = s.n;
    _view.sq = new Int16Array(s.n); _view.side = new Uint8Array(s.n);
    _view.str = new Int16Array(s.n); _view.hole = new Uint8Array(s.n);
    _view.live = new Uint8Array(s.n); _view.hold = new Int16Array(s.n);
  }
  for(let k = 0; k < s.n; k++){
    const t = TYPES[s.type[k]];
    _view.sq[k] = s.sq[k]; _view.side[k] = s.side[k]; _view.live[k] = s.live[k];
    _view.hole[k] = t.hole; _view.str[k] = t.str; _view.hold[k] = t.hold;
  }
  return _view;
}

const _field = new Int16Array(SZ);
let _fieldFor = null;
export function controlOf(s){
  if(_fieldFor === s) return _field;
  field(geo, viewOf(s), s.ter, _field, null);
  _fieldFor = s;
  return _field;
}
export function soil(s){ if(_fieldFor === s) _fieldFor = null; }

/* ---------- ground ---------- */
export const groundCount = (s, side) => {
  let n = 0;
  for(let i = 0; i < SZ; i++) if(s.own[i] === side) n++;
  return n;
};

/* A square is inside the leash if you own it or it touches ground you
   own. Everything a unit may do is bounded by this. */
export function leash(s, side, out){
  const m = out || new Uint8Array(SZ);
  m.fill(0);
  for(let i = 0; i < SZ; i++){
    if(s.own[i] === side){ m[i] = 1; continue; }
    for(const j of geo.N4[i]) if(s.own[j] === side){ m[i] = 1; break; }
  }
  return m;
}
const _leash = new Uint8Array(SZ);

/* Squares that would convert to `side` if their turn ended now. Shown
   in the interface, because a tide you cannot see coming is just a
   rule that keeps surprising you. */
export function pending(s, side, f){
  const ff = f || controlOf(s);
  const out = new Uint8Array(SZ);
  for(let i = 0; i < SZ; i++){
    if(s.own[i] === side) continue;
    const v = side === BLUE ? ff[i] : -ff[i];
    if(v < CONVERT_MIN) continue;
    let touch = false;
    for(const j of geo.N4[i]) if(s.own[j] === side){ touch = true; break; }
    if(touch) out[i] = 1;
  }
  return out;
}

function convert(s, side, f){
  const p = pending(s, side, f);
  let n = 0;
  for(let i = 0; i < SZ; i++) if(p[i]){ s.own[i] = side; n++; }
  return n;
}

export function objectivesOwned(s, side){
  let n = 0;
  for(const i of OBJECTIVES) if(s.own[i] === side) n++;
  return n;
}

export function countUnits(s, side){
  let n = 0;
  for(let k = 0; k < s.n; k++) if(s.live[k] && s.side[k] === side) n++;
  return n;
}
export function generalOf(s, side){
  for(let k = 0; k < s.n; k++)
    if(s.live[k] && s.side[k] === side && s.type[k] === GEN) return k;
  return -1;
}

/* ---------- moves ---------- */
const _blocked = new Uint8Array(SZ);
const _zoc = new Uint8Array(SZ);
const _reach = new Int16Array(SZ);

export function genMoves(s, side){
  const out = [];
  const f = controlOf(s);
  const lea = leash(s, side, _leash);

  _blocked.fill(0);
  for(let k = 0; k < s.n; k++) if(s.live[k]) _blocked[s.sq[k]] = 1;
  zoneOfControl(geo, viewOf(s), side, _zoc);

  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== side) continue;
    const from = s.sq[k];
    const t = TYPES[s.type[k]];
    _blocked[from] = 0;
    const best = reachable(geo, from, t.mp, s.ter, _blocked,
                           t.free ? null : _zoc, _reach);
    _blocked[from] = 1;
    for(let j = 0; j < SZ; j++)
      if(best[j] >= 0 && lea[j]) out.push(packMove(from, j));
  }

  /* Building. Anywhere on your own ground that is empty — which is
     why a wide front is worth having even where it is quiet. */
  if(countUnits(s, side) < MAX_UNITS){
    for(const ty of BUILDABLE){
      const cost = TYPES[ty].cost;
      if(cost > s.bp[side]) continue;
      for(let i = 0; i < SZ; i++){
        if(s.own[i] !== side || _blocked[i]) continue;
        if(TERRAIN[s.ter[i]].move <= 0) continue;
        out.push(packBuild(ty, i));
      }
    }
  }

  if(!out.length) out.push(PASS);
  return out;
}

export function unitAt(s, i){
  for(let k = 0; k < s.n; k++) if(s.live[k] && s.sq[k] === i) return k;
  return -1;
}

function freeSlot(s, side){
  for(let k = 0; k < s.n; k++) if(!s.live[k] && s.side[k] === side) return k;
  return -1;
}

/* ---------- resolution ---------- */
/* The nearest empty square of your own ground, breadth-first from
   where the unit stands. Deterministic — neighbours are walked in a
   fixed order and the first hit wins — because the edge function
   replays this and has to reach the same square the browser did. */
function fallBack(s, side, from, blocked){
  const seen = new Uint8Array(SZ);
  const q = [from]; seen[from] = 1;
  for(let h = 0; h < q.length; h++){
    const i = q[h];
    if(i !== from && s.own[i] === side && !blocked[i]) return i;
    for(const j of geo.N4[i]){
      if(seen[j]) continue;
      if(TERRAIN[s.ter[j]].move <= 0) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return -1;
}

export function resolve(s, side){
  const f = controlOf(s);
  const lost = [], pushed = [];
  const blocked = new Uint8Array(SZ);
  for(let k = 0; k < s.n; k++) if(s.live[k]) blocked[s.sq[k]] = 1;

  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== side) continue;
    const i = s.sq[k];
    const v = side === BLUE ? f[i] : -f[i];
    if(v <= -BREAK){
      s.live[k] = 0; blocked[i] = 0;
      lost.push({k, sq: i, why: 'overwhelmed'});
      continue;
    }
    /* Still on their ground when your turn came round: the assault
       did not stick, and the unit falls back to its own line. */
    if(s.own[i] === (1 - side)){
      blocked[i] = 0;
      const back = fallBack(s, side, i, blocked);
      if(back >= 0){
        s.sq[k] = back; blocked[back] = 1;
        pushed.push({k, from: i, to: back, why: 'thrown back'});
      }else{
        s.live[k] = 0;
        lost.push({k, sq: i, why: 'cut off'});
      }
    }
  }
  if(lost.length || pushed.length) soil(s);
  return lost.concat(pushed);
}

export function verdict(s, side){
  if(generalOf(s, side) < 0)     return {w: 1 - side, why: 'the general is lost'};
  if(generalOf(s, 1 - side) < 0) return {w: side,     why: 'the general is lost'};
  const gb = groundCount(s, BLUE), gr = groundCount(s, RED);
  if(gb >= WIN_GROUND) return {w: BLUE, why: 'the tide came in'};
  if(gr >= WIN_GROUND) return {w: RED,  why: 'the tide came in'};
  if(s.ply >= PLY_CAP){
    if(gb !== gr) return {w: gb > gr ? BLUE : RED, why: 'more ground at the close'};
    return {w: -1, why: 'the line never moved'};
  }
  return null;
}

/* ---------- apply ---------- */
export function apply(s, mv){
  const ns = clone(s);
  const side = s.turn;
  let from = -1, to = -1, kind = 'pass', k = -1, built = -1;

  if(isBuild(mv)){
    const ty = buildType(mv), i = buildAt(mv);
    const k2 = freeSlot(ns, side);
    if(k2 >= 0){
      ns.live[k2] = 1; ns.sq[k2] = i; ns.type[k2] = ty;
      ns.bp[side] -= TYPES[ty].cost;
      kind = 'build'; to = i; k = k2; built = ty;
    }
  }else if(!isPass(mv)){
    from = moveFrom(mv); to = moveTo(mv);
    k = unitAt(ns, from);
    if(k < 0) return {st: ns, kind: 'void', from, to, lost: [], side};
    ns.sq[k] = to; kind = 'move';
  }
  soil(ns);

  /* The tide comes in at the end of the turn that moved it. */
  const gained = convert(ns, side, controlOf(ns));
  soil(ns);

  ns.turn = 1 - side;
  ns.ply++;
  /* Their turn begins: their losses, then their build points. */
  const lost = resolve(ns, ns.turn);
  ns.bp[ns.turn] = Math.min(BP_CAP,
    ns.bp[ns.turn] + BASE_BP + objectivesOwned(ns, ns.turn));

  return {st: ns, kind, from, to, k, built, lost, gained, side};
}

export function legal(s, mv){ return genMoves(s, s.turn).includes(mv); }
