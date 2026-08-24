/* ============================================================
   The live game: board state, move history, capture trays, the
   move log and win detection.

   This module knows nothing about the DOM, the AI or the network.
   It announces what happened and lets the app react:

     on('reset', fn)   board was rebuilt from scratch
     on('move',  fn)   a move was played  ({mv, o, fromNet})
     on('change',fn)   anything visible changed — time to redraw
   ============================================================ */
import {BLUE, RED, col, typ, rowOf, goalRow, genMoves, outcome, apply, count,
        startBoard, sq, packMove, moveFrom, moveTo} from './rules.js';
import {LET} from './icons.js';

export const game = {
  bd: [], ids: [],
  turn: BLUE,
  over: null,          // null | {w: BLUE|RED|-1, why: string}
  sel: -1, legal: [],
  lastMove: null,
  lostB: [], lostR: [],
  log: [],
  ply: 1,
  busy: false,
  moveList: [],        // every move played, in order — the online source of truth
  hist: [],
};

const listeners = {reset: [], move: [], change: []};
export function on(evt, fn){ listeners[evt].push(fn); }
function emit(evt, data){ for(const fn of listeners[evt]) fn(data); }

/* Call after mutating game state from outside (e.g. the busy flag). */
export function changed(){ emit('change'); }

export function setBusy(v){ game.busy = v; emit('change'); }

export function reset(){
  const s = startBoard();
  game.bd = s.b; game.ids = s.id;
  game.turn = BLUE; game.over = null;
  game.sel = -1; game.legal = []; game.lastMove = null;
  game.lostB = []; game.lostR = [];
  game.log = []; game.ply = 1;
  game.hist = []; game.moveList = [];
  game.busy = false;
  emit('reset');
  emit('change');
}

export function move(mv, fromNet){
  game.hist.push({
    bd: game.bd.slice(), ids: game.ids.slice(), turn: game.turn,
    lastMove: game.lastMove, lostB: game.lostB.slice(), lostR: game.lostR.slice(),
    log: game.log.slice(), ply: game.ply,
  });

  const from = moveFrom(mv), to = moveTo(mv);
  const mover = col(game.bd[from]), pt = typ(game.bd[from]);
  const def = game.bd[to] ? typ(game.bd[to]) : null;
  const o = outcome(game.bd, from, to);
  const res = apply(game.bd, mv);

  // carry piece identity across, so the UI can animate the same disc moving
  const nids = game.ids.slice();
  if(o === 'move' || o === 'win') nids[to] = game.ids[from];
  else nids[to] = (o === 'lose') ? game.ids[to] : 0;
  nids[from] = 0;

  if(o === 'win')   (mover === BLUE ? game.lostR : game.lostB).push(def);
  if(o === 'lose')  (mover === BLUE ? game.lostB : game.lostR).push(pt);
  if(o === 'trade'){ game.lostB.push(mover === BLUE ? pt : def);
                     game.lostR.push(mover === BLUE ? def : pt); }

  game.bd = res.bd; game.ids = nids; game.lastMove = [from, to];

  const tag = o === 'win'   ? '<b class="w">&times;' + LET[def] + '</b>'
            : o === 'lose'  ? '<b class="l">&#10005;</b>'
            : o === 'trade' ? '<b class="t">=</b>' : '';
  game.log.push(`${game.ply}. <span class="${mover === BLUE ? 'side-b' : 'side-r'}">` +
                `${LET[pt]}</span> ${sq(from)}&rarr;${sq(to)} ${tag}`);

  const nB = count(game.bd, BLUE), nR = count(game.bd, RED);
  const landed = (o === 'move' || o === 'win');
  if(landed && rowOf(to) === goalRow(mover)) game.over = {w: mover, why: 'reached the back row'};
  else if(nB === 0 && nR === 0) game.over = {w: -1, why: 'both armies wiped out'};
  else if(nR === 0) game.over = {w: BLUE, why: 'red has no pieces left'};
  else if(nB === 0) game.over = {w: RED, why: 'blue has no pieces left'};

  game.turn = 1 - game.turn; game.ply++;
  if(!game.over && genMoves(game.bd, game.turn).length === 0)
    game.over = {w: -1, why: 'no legal moves'};

  game.moveList.push(mv);
  game.sel = -1; game.legal = [];

  emit('move', {mv, o, fromNet});
  emit('change');
}

export function undo(steps){
  if(game.busy || !game.hist.length) return;
  while(steps-- && game.hist.length){
    const h = game.hist.pop();
    game.bd = h.bd; game.ids = h.ids; game.turn = h.turn; game.lastMove = h.lastMove;
    game.lostB = h.lostB; game.lostR = h.lostR; game.log = h.log; game.ply = h.ply;
    game.moveList.pop();
  }
  game.over = null; game.sel = -1; game.legal = [];
  emit('change');
}

/* Click on square i: play a highlighted move, or pick a piece up / put it down. */
export function clickSquare(i){
  if(game.over || game.busy) return;
  if(game.sel >= 0){
    const m = game.legal.find(x => x.to === i);
    if(m){ move(packMove(game.sel, i)); return; }
  }
  const p = game.bd[i];
  if(p && col(p) === game.turn){
    if(game.sel === i){ game.sel = -1; game.legal = []; }
    else{
      game.sel = i;
      game.legal = genMoves(game.bd, game.turn)
        .filter(mv => moveFrom(mv) === i)
        .map(mv => ({to: moveTo(mv), o: outcome(game.bd, i, moveTo(mv))}));
    }
  }else{ game.sel = -1; game.legal = []; }
  emit('change');
}
