/* ============================================================
   Tideline: the live game. Knows nothing about the DOM, the AI or
   the network.
     on('reset'|'move'|'change', fn)
   ============================================================ */
import * as R from './rules.js';

export const game = {
  st: null, over: null,
  sel: -1, targets: new Set(),
  buildType: R.INF,            // what the build buttons are set to
  busy: false,
  log: [], hist: [], moveList: [], lastLost: [],
};

const listeners = {reset: [], move: [], change: []};
export function on(e, fn){ listeners[e].push(fn); }
const emit = (e, d) => { for(const fn of listeners[e]) fn(d); };
export function changed(){ emit('change'); }
export function setBusy(v){ game.busy = v; emit('change'); }

export function reset(){
  game.st = R.startState();
  game.over = null; game.sel = -1; game.targets = new Set();
  game.log = []; game.hist = []; game.moveList = []; game.lastLost = [];
  game.busy = false;
  emit('reset'); emit('change');
}

const SHORT = ['HQ', 'Inf', 'Arm', 'Art', 'Mil'];

function describe(st, mv, res){
  const side = res.side === R.BLUE ? 'side-b' : 'side-r';
  const n = Math.floor(st.ply / 2) + 1;
  let body;
  if(R.isPass(mv)) body = 'no move possible';
  else if(R.isBuild(mv)) body = 'raise ' + SHORT[R.buildType(mv)] + ' at ' + R.sq(R.buildAt(mv));
  else body = (res.k >= 0 ? SHORT[st.type[res.k]] : '') + ' ' +
              R.sq(res.from) + '&rarr;' + R.sq(res.to);
  let tag = res.gained ? ' <b class="w">+' + res.gained + '</b>' : '';
  const back = (res.lost || []).filter(l => l.why === 'thrown back').length;
  const dead = (res.lost || []).length - back;
  if(back) tag += ' <b class="t">' + back + ' thrown back</b>';
  if(dead) tag += ' <b class="l">&times;' + dead + '</b>';
  return n + '. <span class="' + side + '">' + body + '</span>' + tag;
}

export function move(mv){
  if(game.over) return;
  game.hist.push({st: R.clone(game.st), log: game.log.slice()});
  const res = R.apply(game.st, mv);
  game.log.push(describe(game.st, mv, res));
  game.st = res.st;
  game.lastLost = res.lost || [];
  game.moveList.push(mv);
  game.sel = -1; game.targets = new Set();
  game.over = R.verdict(game.st, game.st.turn);
  emit('move', {mv, res}); emit('change');
}

export function undo(steps){
  if(game.busy || !game.hist.length) return;
  while(steps-- && game.hist.length){
    const h = game.hist.pop();
    game.st = h.st; game.log = h.log; game.moveList.pop();
  }
  game.over = null; game.sel = -1; game.targets = new Set();
  emit('change');
}

/* Where the currently-chosen unit type could be raised. */
export function buildTargets(){
  const out = new Set();
  if(game.over || !game.st) return out;
  for(const mv of R.genMoves(game.st, game.st.turn))
    if(R.isBuild(mv) && R.buildType(mv) === game.buildType) out.add(R.buildAt(mv));
  return out;
}

export function setBuildType(t){
  game.buildType = t;
  game.sel = -1; game.targets = new Set();
  emit('change');
}

export function clickSquare(i){
  if(game.over || game.busy) return;
  if(game.sel >= 0 && game.targets.has(i)){ move(R.packMove(game.sel, i)); return; }

  const st = game.st;
  const k = R.unitAt(st, i);
  if(k < 0){
    /* an empty square: a build, if one is on offer there */
    if(buildTargets().has(i)){ move(R.packBuild(game.buildType, i)); return; }
    game.sel = -1; game.targets = new Set(); emit('change'); return;
  }
  if(st.side[k] !== st.turn){ game.sel = -1; game.targets = new Set(); emit('change'); return; }
  if(game.sel === i){ game.sel = -1; game.targets = new Set(); emit('change'); return; }

  const t = new Set();
  for(const mv of R.genMoves(st, st.turn)){
    if(R.isPass(mv) || R.isBuild(mv)) continue;
    if(R.moveFrom(mv) === i) t.add(R.moveTo(mv));
  }
  game.sel = t.size ? i : -1;
  game.targets = t;
  emit('change');
}
