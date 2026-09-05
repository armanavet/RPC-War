/* ============================================================
   Barbican: the live game. Knows nothing about the DOM, the AI or
   the network.
     on('reset'|'move'|'change', fn)
   ============================================================ */
import * as R from './rules.js';

export const game = {
  st: null, over: null,
  sel: -1, targets: new Set(), siege: new Set(),
  busy: false,
  log: [], hist: [], moveList: [],
};

const listeners = {reset: [], move: [], change: []};
export function on(e, fn){ listeners[e].push(fn); }
const emit = (e, d) => { for(const fn of listeners[e]) fn(d); };
export function changed(){ emit('change'); }
export function setBusy(v){ game.busy = v; emit('change'); }

export function reset(){
  game.st = R.startState();
  game.over = null; game.sel = -1;
  game.targets = new Set(); game.siege = new Set();
  game.log = []; game.hist = []; game.moveList = [];
  game.busy = false;
  emit('reset'); emit('change');
}

const SHORT = ['Captain','Levy','Serjeant','Ram','Trebuchet','Ladders','Miner',
               'Castellan','Archer','Guard','Knight'];

function describe(st, mv, res){
  const side = res.side === R.BESIEGER ? 'side-b' : 'side-r';
  const n = Math.floor(st.ply / 2) + 1;
  const who = res.k >= 0 ? SHORT[st.type[res.k]] : '';
  let body;
  if(R.isPass(mv)) body = 'no move possible';
  else if(res.kind === 'breach') body = who + ' brings down ' + R.sq(res.to);
  else if(res.kind === 'ram')   body = who + ' batters the gate';
  else if(res.kind === 'mine')  body = who + ' undermines ' + R.sq(res.to);
  else if(res.kind === 'shot')  body = who + ' looses on ' + R.sq(res.to);
  else body = who + ' ' + R.sq(res.from) + '&rarr;' + R.sq(res.to);

  let tag = '';
  if(res.kind === 'breach') tag += ' <b class="w">BREACH</b>';
  const cut = (res.lost || []).filter(l => l.why === 'cut down').length;
  if(cut) tag += ' <b class="l">&times;' + cut + '</b>';
  if(res.camp) tag += ' <b class="t">a man lost to the camp</b>';
  return n + '. <span class="' + side + '">' + body + '</span>' + tag;
}

export function move(mv){
  if(game.over) return;
  game.hist.push({st: R.clone(game.st), log: game.log.slice()});
  const res = R.apply(game.st, mv);
  game.log.push(describe(game.st, mv, res));
  game.st = res.st;
  game.moveList.push(mv);
  game.sel = -1; game.targets = new Set(); game.siege = new Set();
  game.over = R.verdict(game.st, game.st.turn);
  emit('move', {mv, res}); emit('change');
}

export function undo(steps){
  if(game.busy || !game.hist.length) return;
  while(steps-- && game.hist.length){
    const h = game.hist.pop();
    game.st = h.st; game.log = h.log; game.moveList.pop();
  }
  game.over = null; game.sel = -1;
  game.targets = new Set(); game.siege = new Set();
  emit('change');
}

export function clickSquare(i){
  if(game.over || game.busy) return;
  if(game.sel >= 0 && (game.targets.has(i) || game.siege.has(i))){
    move(R.packMove(game.sel, i)); return;
  }
  const st = game.st;
  const k = R.unitAt(st, i);
  if(k < 0 || st.side[k] !== st.turn || game.sel === i){
    game.sel = -1; game.targets = new Set(); game.siege = new Set();
    emit('change'); return;
  }
  /* Moves and siege work are told apart here so the interface can
     mark a stretch of wall about to be battered differently from a
     square somebody can walk to. */
  const t = new Set(), s = new Set();
  for(const mv of R.genMoves(st, st.turn)){
    if(R.isPass(mv) || R.moveFrom(mv) !== i) continue;
    const to = R.moveTo(mv);
    if(R.isWallKind(st.ter[to]) && R.siegeDamage(st, i, to) > 0) s.add(to);
    else t.add(to);
  }
  if(!t.size && !s.size){ game.sel = -1; emit('change'); return; }
  game.sel = i; game.targets = t; game.siege = s;
  emit('change');
}
