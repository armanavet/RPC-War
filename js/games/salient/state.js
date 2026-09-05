/* ============================================================
   Salient: the live game — position, history, the move log and win
   detection. Knows nothing about the DOM, the AI or the network.

     on('reset', fn)   position rebuilt
     on('move',  fn)   a move was played ({mv, res, fromNet})
     on('change',fn)   anything visible changed — redraw
   ============================================================ */
import * as R from './rules.js';

export const game = {
  st: null,
  over: null,               // null | {w, why}
  sel: -1,
  targets: new Set(),
  busy: false,
  log: [],
  hist: [],
  moveList: [],
  lastLost: [],
};

const listeners = {reset: [], move: [], change: []};
export function on(evt, fn){ listeners[evt].push(fn); }
function emit(evt, d){ for(const fn of listeners[evt]) fn(d); }
export function changed(){ emit('change'); }
export function setBusy(v){ game.busy = v; emit('change'); }

export function reset(){
  game.st = R.startState();
  game.over = null;
  game.sel = -1; game.targets = new Set();
  game.log = []; game.hist = []; game.moveList = []; game.lastLost = [];
  game.busy = false;
  emit('reset'); emit('change');
}

const TYPE_SHORT = ['HQ', 'Stf', 'Inf', 'Arm', 'Art', 'Eng', 'Rec', 'Dep'];

function describe(st, mv, res){
  const side = res.side === R.BLUE ? 'side-b' : 'side-r';
  const n = Math.floor(st.ply / 2) + 1;
  let body;
  if(R.isPass(mv)) body = 'no orders possible';
  else if(R.isPlace(mv)) body = 'replacements &rarr; ' + R.sq(R.placeAt(mv));
  else if(res.kind === 'entrench') body = 'Eng digs in at ' + R.sq(res.from);
  else if(res.kind === 'bridge')   body = 'Eng bridges ' + R.sq(res.to);
  else{
    const k = res.k;
    const t = k >= 0 ? TYPE_SHORT[st.type[k]] : '';
    body = t + ' ' + R.sq(res.from) + '&rarr;' + R.sq(res.to);
  }
  let tag = '';
  if(res.lost && res.lost.length){
    const surr = res.lost.filter(l => l.why === 'surrendered').length;
    const ovr  = res.lost.length - surr;
    if(surr) tag += ' <b class="w">&times;' + surr + ' cut off</b>';
    if(ovr)  tag += ' <b class="t">&times;' + ovr + ' broken</b>';
  }
  return n + '. <span class="' + side + '">' + body + '</span>' + tag;
}

export function move(mv, fromNet){
  if(game.over) return;
  game.hist.push({
    st: R.clone(game.st), log: game.log.slice(), lastLost: game.lastLost,
  });
  const res = R.apply(game.st, mv);
  game.log.push(describe(game.st, mv, res));
  game.st = res.st;
  game.lastLost = res.lost || [];
  game.moveList.push(mv);
  game.sel = -1; game.targets = new Set();
  game.over = R.verdict(game.st, game.st.turn);
  emit('move', {mv, res, fromNet});
  emit('change');
}

export function undo(steps){
  if(game.busy || !game.hist.length) return;
  while(steps-- && game.hist.length){
    const h = game.hist.pop();
    game.st = h.st; game.log = h.log; game.lastLost = h.lastLost;
    game.moveList.pop();
  }
  game.over = null; game.sel = -1; game.targets = new Set();
  emit('change');
}

/* Click a square: play a highlighted move, or pick a unit up. */
export function clickSquare(i){
  if(game.over || game.busy) return;
  if(game.sel >= 0 && game.targets.has(i)){
    move(game.sel === i ? R.packMove(i, i) : R.packMove(game.sel, i));
    return;
  }
  const st = game.st;
  const k = R.unitAt(st, i);
  if(k >= 0 && st.side[k] === st.turn){
    if(game.sel === i){ game.sel = -1; game.targets = new Set(); }
    else{
      const ms = R.genMoves(st, st.turn);
      const t = new Set();
      let any = false;
      for(const mv of ms){
        if(R.isPass(mv) || R.isPlace(mv)) continue;
        if(R.moveFrom(mv) === i){ t.add(R.moveTo(mv)); any = true; }
      }
      if(any){ game.sel = i; game.targets = t; }
      else{ game.sel = -1; game.targets = new Set(); }
    }
  }else{
    game.sel = -1; game.targets = new Set();
  }
  emit('change');
}

/* Placing a replacement is a click on an empty baseline square, so it
   needs its own entry point rather than going through a selection. */
export function placeAt(i){
  if(game.over || game.busy) return false;
  const mv = R.PLACE + i;
  if(!R.genMoves(game.st, game.st.turn).includes(mv)) return false;
  move(mv);
  return true;
}

export function legalTargetsForPlacement(){
  const out = new Set();
  if(game.over) return out;
  for(const mv of R.genMoves(game.st, game.st.turn))
    if(R.isPlace(mv)) out.add(R.placeAt(mv));
  return out;
}
