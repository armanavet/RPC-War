/* ============================================================
   Breakthrough: the live game. Knows nothing about the DOM, the AI
   or the network.

   The one thing that is not like the other two: a turn does not
   always pass. Inside an exploitation the same side moves again, so
   everything here asks the state whose turn it is rather than
   assuming it alternates.
     on('reset'|'move'|'change', fn)
   ============================================================ */
import * as R from './rules.js';

export const game = {
  st: null, over: null,
  sel: -1, targets: new Set(),
  busy: false,
  log: [], hist: [], moveList: [], lastCrack: null,
};

const listeners = {reset: [], move: [], change: []};
export function on(e, fn){ listeners[e].push(fn); }
const emit = (e, d) => { for(const fn of listeners[e]) fn(d); };
export function changed(){ emit('change'); }
export function setBusy(v){ game.busy = v; emit('change'); }

export function reset(){
  game.st = R.startState();
  game.over = null; game.sel = -1; game.targets = new Set();
  game.log = []; game.hist = []; game.moveList = []; game.lastCrack = null;
  game.busy = false;
  emit('reset'); emit('change');
}

const SHORT = ['HQ', 'Inf', 'Arm', 'Art', 'Rec', 'Mil'];

function describe(st, mv, res){
  const side = res.side === R.BLUE ? 'side-b' : 'side-r';
  const n = Math.floor(st.ply / 2) + 1;
  let body = R.isPass(mv) ? 'no move possible'
    : (res.k >= 0 ? SHORT[st.type[res.k]] : '') + ' ' +
      R.sq(res.from) + '&rarr;' + R.sq(res.to);
  let tag = '';
  if(res.crack){
    tag += ' <b class="w">BREAKTHROUGH &middot; ' + res.crack.squares.length + ' squares</b>';
    if(res.crack.routed.length) tag += ' <b class="t">' + res.crack.routed.length + ' routed</b>';
  }
  if(res.exploiting) tag += ' <b class="t">exploiting</b>';
  const dead = (res.lost || []).filter(l => l.why !== 'headquarters displaced').length;
  if(dead) tag += ' <b class="l">&times;' + dead + '</b>';
  return n + '. <span class="' + side + '">' + body + '</span>' + tag;
}

export function move(mv){
  if(game.over) return;
  game.hist.push({st: R.clone(game.st), log: game.log.slice()});
  const res = R.apply(game.st, mv);
  game.log.push(describe(game.st, mv, res));
  game.st = res.st;
  game.lastCrack = res.crack || null;
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

export function clickSquare(i){
  if(game.over || game.busy) return;
  if(game.sel >= 0 && game.targets.has(i)){ move(R.packMove(game.sel, i)); return; }
  const st = game.st;
  const k = R.unitAt(st, i);
  if(k < 0 || st.side[k] !== st.turn || game.sel === i){
    game.sel = -1; game.targets = new Set(); emit('change'); return;
  }
  const t = new Set();
  for(const mv of R.genMoves(st, st.turn)){
    if(R.isPass(mv)) continue;
    if(R.moveFrom(mv) === i) t.add(R.moveTo(mv));
  }
  game.sel = t.size ? i : -1;
  game.targets = t;
  emit('change');
}
