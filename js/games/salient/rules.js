/* ============================================================
   Salient — the rules, and nothing else.

   Pure functions: no DOM, no network. The edge functions import this
   file to verify finished games and to play the bots' moves, so it
   must stay that way.

   THE IDEA

   You do not take a unit by landing on it. You take it by owning the
   ground behind it. Every unit projects force (see _shared/control.js)
   and every square belongs to whoever projects more. A unit that can
   no longer trace a path home through ground the enemy does not hold
   is cut off, and two turns later it surrenders. A unit that is
   simply out-gunned where it stands is overwhelmed and breaks at
   once. Those are the only two ways anything dies, and they are the
   same arithmetic seen from two angles.

   COMMAND IS THE REAL CONSTRAINT

   You may only activate a unit that is within your general's command
   radius, or within the shorter radius of one of your two staff
   officers. On a board this wide the general cannot reach both
   flanks, so the staff are what make an army of nineteen units into
   something you can actually direct — and killing a staff officer
   puts a whole wing to sleep, which is a far more interesting thing
   to attack than a piece.

   That restriction is also what makes the game computable. Without
   it move generation returns three hundred legal moves a turn and no
   search can see far enough to spot the encirclement it is walking
   into.

   ONE ACTIVATION PER TURN

   An early draft gave each side three command points a turn. It read
   well and was unplayable: the search space is cubed, and a human
   could not hold three half-finished plans in their head either. One
   unit, one turn. Depth lives in the field, not in the bookkeeping.

   ENCODING

   Squares are 0..208 on a board 19 wide and 11 high, index 0 at the
   top-left. Blue's baseline is the bottom row, red's the top.
   A move packs as from * 209 + to.
     from === to                  entrench (engineers)
     to is an adjacent river      bridge it (engineers)
     PASS = 209 * 209             legal only when nothing else is
   ============================================================ */
import {makeGeo, field, supply, reachable, zoneOfControl, TERRAIN,
        OPEN, WOODS, HILL, TOWN, RIVER, FORD, ROAD, MARSH, owner} from '../_shared/control.js';

export const W = 19, H = 11;
export const geo = makeGeo(W, H);
export const SZ = geo.SZ;
export const BLUE = 0, RED = 1;
export const {rowOf, colOf, at, sq, dist} = geo;

/* ---------- units ---------- */
export const GEN = 0, STF = 1, INF = 2, ARM = 3, ART = 4, ENG = 5, REC = 6, DEP = 7;

/* str   force projected, and therefore also how far it reaches
   hole  minimum range: artillery contributes nothing close in
   mp    movement allowance, spent against TERRAIN[].move
   hold  what it is worth on the square it stands on
   free  ignores enemy zones of control
   cmd   command radius it projects, 0 for units that carry no orders */
export const TYPES = [
  {key:'gen', name:'General',   str:5, hole:0, mp:6,  hold:3, free:0, cmd:7},
  {key:'stf', name:'Staff',     str:2, hole:0, mp:6,  hold:1, free:0, cmd:5},
  {key:'inf', name:'Infantry',  str:3, hole:0, mp:4,  hold:3, free:0, cmd:0},
  {key:'arm', name:'Armour',    str:4, hole:0, mp:10, hold:1, free:1, cmd:0},
  {key:'art', name:'Artillery', str:6, hole:2, mp:4,  hold:0, free:0, cmd:0},
  {key:'eng', name:'Engineer',  str:2, hole:0, mp:4,  hold:2, free:0, cmd:0},
  {key:'rec', name:'Recon',     str:2, hole:0, mp:10, hold:0, free:1, cmd:0},
  {key:'dep', name:'Depot',     str:1, hole:0, mp:2,  hold:1, free:0, cmd:0},
];

/* ---------- the map ----------
   Rotationally symmetric through the centre square, so neither side
   has better ground. Two river bars with a ford apiece cut the board
   into three corridors — left, centre, right — which gives a front
   something to anchor on and a flank worth turning. A lateral road
   behind each baseline plus three north-south routes are what let a
   defender answer a breakthrough two corridors away. */
export const OBJECTIVES = [
  at(5,9),                     // the crossroads
  at(4,4),  at(6,14),          // the inner pair
  at(4,14), at(6,4),
  at(2,8),  at(8,10),          // the home pair, deep in each half
  at(2,10), at(8,8),
];
export const OBJ_VALUE = [3, 2, 2, 2, 2, 1, 1, 1, 1];

/* Objectives sit in the contested band on purpose. An earlier map put
   them two rows off each baseline, so both sides began holding two of
   their own and only the centre was ever in doubt — neither army had
   a reason to go anywhere, and a traced game sat unchanged from ply
   thirty to ply ninety. Objectives belong where the front is, or they
   are scenery. */

function buildTerrain(){
  const t = new Uint8Array(SZ).fill(OPEN);
  const put = (kind, list) => { for(const i of list) t[i] = kind; };

  /* lateral roads behind each line, three routes joining them */
  for(let c = 0; c < W; c++){ t[at(1,c)] = ROAD; t[at(9,c)] = ROAD; }
  for(let r = 1; r <= 9; r++){ t[at(r,2)] = ROAD; t[at(r,9)] = ROAD; t[at(r,16)] = ROAD; }

  put(RIVER, [at(3,6),at(4,6),at(6,6),at(7,6), at(3,12),at(4,12),at(6,12),at(7,12)]);
  put(FORD,  [at(5,6), at(5,12)]);
  put(HILL,  [at(5,2),at(5,16), at(3,9),at(7,9)]);
  put(WOODS, [at(2,4),at(8,14), at(2,14),at(8,4),
              at(4,11),at(6,7), at(4,7),at(6,11), at(9,1),at(1,17)]);
  put(MARSH, [at(6,2),at(4,16), at(3,3),at(7,15)]);
  put(TOWN,  OBJECTIVES);
  return t;
}
export const TERRAIN_MAP = buildTerrain();

/* ---------- dials ----------
   Every one of these moved at least once against self-play. */
export const CMD_CUT    = 4;      // the general's reach when he is himself cut off
export const BREAK      = 5;      // local superiority that shatters a unit
export const CUT_LIMIT  = 2;      // turns out of supply before surrender
export const VP_WIN     = 520;    // the race
export const MIN_UNITS  = 4;      // reduced to this and you are finished
export const ENT_MAX    = 4;      // an engineer digs +2, twice
export const PLY_CAP    = 400;

/* ---------- replacements ----------
   Every few turns a side is given a replacement battalion it may
   spend an activation to put on a baseline square it still holds.

   This exists because the first version of the game snowballed. A
   traced game had one side down to seven units and one point of
   income by ply ninety, with twenty-seven plies of formality still to
   play — the result had been settled long before the game ended.
   Replacements give a losing side a way to rebuild a line and cost a
   winning side a tempo to use, so a lead still has to be converted.
   The pool caps, so nobody banks an army. */
export const REINFORCE_EVERY = 5;    // own turns per replacement
export const POOL_CAP        = 3;
export const RESERVE         = 8;    // replacement slots a side can ever use

export const PASS = SZ * SZ;
export const PLACE = SZ * SZ + 1;                  // + the square placed on
export const isPlace = mv => mv >= PLACE;
export const placeAt = mv => mv - PLACE;
export const packMove = (from, to) => from * SZ + to;
export const moveFrom = mv => (mv / SZ) | 0;
export const moveTo   = mv => mv % SZ;
export const isPass   = mv => mv === PASS;
export const isEntrench = mv => mv !== PASS && moveFrom(mv) === moveTo(mv);
export const isBridge = mv =>
  mv !== PASS && moveFrom(mv) !== moveTo(mv) && TERRAIN_MAP[moveTo(mv)] === RIVER;

/* ---------- opening position ----------
   Nineteen units a side, red's being blue's rotated through half a
   turn. Depots start on the back row: they are slow, and a depot that
   begins on the line is a depot captured before it was ever useful. */
const BLUE_SETUP = [
  [ART, at(10,2)], [ENG, at(10,6)], [GEN, at(10,9)], [DEP, at(10,12)], [ART, at(10,16)],
  [REC, at(9,0)],  [STF, at(9,4)],  [STF, at(9,14)], [ARM, at(9,18)],
  [ARM, at(8,2)],  [INF, at(8,5)],  [INF, at(8,8)],  [INF, at(8,10)],
  [INF, at(8,13)], [ARM, at(8,16)],
  [INF, at(7,3)],  [INF, at(7,9)],  [INF, at(7,15)], [DEP, at(10,7)],
];

export function startState(){
  const n = (BLUE_SETUP.length + RESERVE) * 2;
  const s = {
    n,
    sq:   new Int16Array(n),
    side: new Uint8Array(n),
    type: new Uint8Array(n),
    live: new Uint8Array(n),
    cut:  new Uint8Array(n),
    ent:  new Uint8Array(SZ),
    ter:  TERRAIN_MAP.slice(),      // engineers can edit it
    turn: BLUE,
    ply:  0,
    vp:   [0, 0],
    pool: [0, 0],
    turns:[0, 0],
  };
  let k = 0;
  for(const [t, i] of BLUE_SETUP){
    s.sq[k] = i; s.side[k] = BLUE; s.type[k] = t; s.live[k] = 1; k++;
    s.sq[k] = (SZ - 1) - i; s.side[k] = RED; s.type[k] = t; s.live[k] = 1; k++;
  }
  /* Reserve slots: real entries in every array, simply not on the
     board yet. Keeping the arrays a fixed size is what lets clone()
     stay a handful of slice() calls in the hot path of the search. */
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
    live: s.live.slice(), cut: s.cut.slice(),
    ent: s.ent.slice(), ter: s.ter.slice(),
    turn: s.turn, ply: s.ply, vp: [s.vp[0], s.vp[1]],
    pool: [s.pool[0], s.pool[1]], turns: [s.turns[0], s.turns[1]],
  };
}

/* ---------- views over the state ----------
   control.js wants flat arrays of strength and reach; the game keeps
   units. Build the view into scratch buffers rather than allocating,
   because this runs at every node of the search.

   A cut-off unit projects at half strength. That is what makes a
   pocket collapse rather than sit there holding ground it has no
   business holding. */
const _view = {n: 0, sq: null, side: null, str: null, hole: null, live: null, hold: null};

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
    _view.hole[k] = t.hole;
    const weak = s.cut[k] > 0;
    _view.str[k]  = weak ? (t.str >> 1) : t.str;
    _view.hold[k] = weak ? (t.hold >> 1) : t.hold;
  }
  return _view;
}

/* The field is asked for three or four times per search node — by
   move generation, by the evaluation, by win detection — and
   recomputing it each time was most of the cost of the whole search.

   One slot of memo, keyed on object identity, is all that is needed.
   The search is depth-first, so every read of a state happens before
   its children are built and a state is never revisited once the
   buffer has moved on. Anything that mutates a state must call
   soil() — and resolve() genuinely does mutate mid-computation, which
   is exactly the bug this comment exists to stop being reintroduced. */
const _field = new Int16Array(SZ);
let _fieldFor = null;

export function controlOf(s){
  if(_fieldFor === s) return _field;
  field(geo, viewOf(s), s.ter, _field, s.ent);
  _fieldFor = s;
  return _field;
}
export function soil(s){ if(_fieldFor === s) _fieldFor = null; }

/* Where a side's supply comes from: its own baseline, its general and
   every depot it still has. Losing every depot does not cut you off —
   it shortens your reach, which is the point of pushing one forward. */
export function supplySources(s, side){
  const out = [];
  const home = side === BLUE ? H - 1 : 0;
  for(let c = 0; c < W; c++) out.push(at(home, c));
  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== side) continue;
    const t = s.type[k];
    if(t === GEN || t === DEP) out.push(s.sq[k]);
  }
  return out;
}

const _supplyB = new Uint8Array(SZ), _supplyR = new Uint8Array(SZ);
export function supplyOf(s, side, f){
  return supply(geo, f || controlOf(s), side, supplySources(s, side),
                side === BLUE ? _supplyB : _supplyR);
}

export function generalOf(s, side){
  for(let k = 0; k < s.n; k++)
    if(s.live[k] && s.side[k] === side && s.type[k] === GEN) return k;
  return -1;
}

/* ---------- command ----------
   A unit can be given an order if it stands inside the general's
   radius or inside a staff officer's shorter one. A command node that
   is itself out of supply shouts a good deal less far. */
const _cmd = new Uint8Array(SZ);

export function commandMask(s, side, f){
  _cmd.fill(0);
  const sup = supplyOf(s, side, f || controlOf(s));
  let any = false;
  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== side) continue;
    const t = TYPES[s.type[k]];
    if(!t.cmd) continue;
    any = true;
    const here = s.sq[k];
    const r = sup[here] ? t.cmd : Math.min(t.cmd, CMD_CUT);
    for(let i = 0; i < SZ; i++) if(dist(here, i) <= r) _cmd[i] = 1;
  }
  return any ? _cmd : _cmd;
}

/* A copy, for the interface — the shared buffer is reused constantly. */
export function commandOverlay(s, side){
  return commandMask(s, side).slice();
}

/* ---------- moves ---------- */
const _blocked = new Uint8Array(SZ);
const _zoc = new Uint8Array(SZ);
const _reach = new Int16Array(SZ);

export function genMoves(s, side){
  const out = [];
  if(generalOf(s, side) < 0) return out;      // no general, no orders, no game

  const f = controlOf(s);
  const cmd = commandMask(s, side, f);

  _blocked.fill(0);
  for(let k = 0; k < s.n; k++) if(s.live[k]) _blocked[s.sq[k]] = 1;
  zoneOfControl(geo, viewOf(s), side, _zoc);

  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== side) continue;
    const from = s.sq[k];
    if(!cmd[from]) continue;                  // out of command, out of the fight

    const t = TYPES[s.type[k]];
    if(s.type[k] === ENG){
      if(s.ent[from] < ENT_MAX) out.push(packMove(from, from));
      for(const j of geo.N4[from]) if(s.ter[j] === RIVER) out.push(packMove(from, j));
    }

    _blocked[from] = 0;                       // a unit does not block itself
    const best = reachable(geo, from, t.mp, s.ter, _blocked,
                           t.free ? null : _zoc, _reach);
    _blocked[from] = 1;
    for(let j = 0; j < SZ; j++) if(best[j] >= 0) out.push(packMove(from, j));
  }
  /* Feeding the line. Only a baseline square you still control, and
     only an empty one — a side being overrun loses this option
     exactly when it is being overrun, which is the point. */
  if(s.pool[side] > 0){
    const home = side === BLUE ? H - 1 : 0;
    for(let c = 0; c < W; c++){
      const i = at(home, c);
      if(_blocked[i]) continue;
      if(owner(f[i]) !== side) continue;
      out.push(PLACE + i);
    }
  }

  if(!out.length) out.push(PASS);
  return out;
}

function freeSlot(s, side){
  for(let k = 0; k < s.n; k++)
    if(!s.live[k] && s.side[k] === side && s.type[k] === INF) return k;
  return -1;
}

export function unitAt(s, i){
  for(let k = 0; k < s.n; k++) if(s.live[k] && s.sq[k] === i) return k;
  return -1;
}

/* ---------- resolution ----------
   Casualties are settled at the start of a side's own turn, so every
   loss is one the owner had a turn to see coming and a turn to
   prevent. Settling them the instant an enemy moved would make the
   game feel arbitrary; this way a closing pocket is visible for a
   whole turn before it costs anything. */
export function resolve(s, side){
  const f = controlOf(s);
  const sup = supplyOf(s, side, f);
  const lost = [];
  for(let k = 0; k < s.n; k++){
    if(!s.live[k] || s.side[k] !== side) continue;
    const i = s.sq[k];
    const v = side === BLUE ? f[i] : -f[i];   // positive = we hold this square

    if(v <= -BREAK){ s.live[k] = 0; lost.push({k, sq: i, why: 'overwhelmed'}); continue; }

    if(!sup[i]){
      s.cut[k]++;
      if(s.cut[k] > CUT_LIMIT){ s.live[k] = 0; lost.push({k, sq: i, why: 'surrendered'}); }
    }else{
      s.cut[k] = 0;
    }
  }
  if(lost.length) soil(s);                    // the field just changed underneath us
  return lost;
}

export function objectivesHeld(s, side, f){
  const ff = f || controlOf(s);
  let n = 0;
  for(const i of OBJECTIVES) if(owner(ff[i]) === side) n++;
  return n;
}

/* Points a side earns per turn as the board stands. */
export function income(s, side, f){
  const ff = f || controlOf(s);
  let n = 0;
  for(let m = 0; m < OBJECTIVES.length; m++)
    if(owner(ff[OBJECTIVES[m]]) === side) n += OBJ_VALUE[m];
  return n;
}

export function countUnits(s, side){
  let n = 0;
  for(let k = 0; k < s.n; k++) if(s.live[k] && s.side[k] === side) n++;
  return n;
}

export function territory(s, side, f){
  const ff = f || controlOf(s);
  let n = 0;
  for(let i = 0; i < SZ; i++) if(owner(ff[i]) === side) n++;
  return n;
}

/* Win detection, for the side about to move, after that side's
   casualties are settled and its points banked.

   Victory is a race rather than a threshold. A threshold — hold most
   of the objectives at the start of your turn — produced a game with
   no pressure in it: neither side could reach the number, so neither
   had a reason to attack, and traced games drifted to the ply cap to
   be awarded on a territory count nobody was playing for. A running
   score fixes that structurally: whoever is behind is losing *now*,
   and a player one objective up wins on their own if left alone. */
export function verdict(s, side){
  if(generalOf(s, side) < 0)               return {w: 1 - side, why: 'the general is lost'};
  if(generalOf(s, 1 - side) < 0)           return {w: side,     why: 'the general is lost'};
  if(countUnits(s, side) <= MIN_UNITS)     return {w: 1 - side, why: 'the army is destroyed'};
  if(countUnits(s, 1 - side) <= MIN_UNITS) return {w: side,     why: 'the army is destroyed'};
  if(s.vp[side] >= VP_WIN && s.vp[side] > s.vp[1 - side])
    return {w: side, why: 'won the ground on points'};
  if(s.vp[1 - side] >= VP_WIN && s.vp[1 - side] > s.vp[side])
    return {w: 1 - side, why: 'won the ground on points'};
  if(s.ply >= PLY_CAP){
    if(s.vp[BLUE] !== s.vp[RED])
      return {w: s.vp[BLUE] > s.vp[RED] ? BLUE : RED, why: 'ahead when time ran out'};
    const f = controlOf(s);
    const ta = territory(s, BLUE, f), tb = territory(s, RED, f);
    if(ta !== tb) return {w: ta > tb ? BLUE : RED, why: 'more ground at the close'};
    return {w: -1, why: 'neither side could break the line'};
  }
  return null;
}

/* ---------- apply ----------
   Never mutates the state passed in. Returns the new state plus what
   the interface needs to animate and narrate what happened. */
export function apply(s, mv){
  const ns = clone(s);
  const side = s.turn;
  let from = -1, to = -1, kind = 'pass', k = -1;

  if(isPlace(mv)){
    const i = placeAt(mv);
    const k2 = freeSlot(ns, side);
    if(k2 >= 0){
      ns.live[k2] = 1; ns.sq[k2] = i; ns.cut[k2] = 0;
      ns.pool[side]--;
      kind = 'place'; to = i; k = k2;
      soil(ns);
    }
  }else if(!isPass(mv)){
    from = moveFrom(mv); to = moveTo(mv);
    k = unitAt(ns, from);
    if(k < 0) return {st: ns, kind: 'void', from, to, lost: [], side};
    if(from === to){
      ns.ent[from] = Math.min(ENT_MAX, ns.ent[from] + 2);
      kind = 'entrench';
    }else if(ns.ter[to] === RIVER){
      ns.ter[to] = FORD;                      // the engineer stays put and bridges
      kind = 'bridge';
    }else{
      ns.sq[k] = to; kind = 'move';
    }
    soil(ns);
  }

  ns.turn = 1 - side;
  ns.ply++;
  ns.turns[ns.turn]++;
  if(ns.turns[ns.turn] % REINFORCE_EVERY === 0)
    ns.pool[ns.turn] = Math.min(POOL_CAP, ns.pool[ns.turn] + 1);
  /* The mover's turn is over; their opponent's begins, and it begins
     with their own losses counted and their points banked — in that
     order, because a unit that surrenders this turn should not be
     holding a town while it does so. */
  const lost = resolve(ns, ns.turn);
  const gained = income(ns, ns.turn);
  ns.vp[ns.turn] += gained;
  return {st: ns, kind, from, to, k, lost, gained, side};
}

export function legal(s, mv){
  return genMoves(s, s.turn).includes(mv);
}
