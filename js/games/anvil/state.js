/* ============================================================
   Anvil: the live game — board, history, win detection.

   Knows nothing about the DOM, the AI or the network.

     on('reset', fn)   board rebuilt
     on('move',  fn)   a move was played ({mv, o, off, fromNet})
     on('change',fn)   anything visible changed — redraw
   ============================================================ */
import {BLUE, RED, col, genMoves, outcome, apply, count, holds,
        HOLD_TO_WIN, LOSE_AT, PLY_CAP,
        startBoard, sq, packMove, moveFrom, moveTo} from './rules.js';

export const game = {
  bd: [], ids: [],
  turn: BLUE,
  over: null,
  sel: -1, legal: [],
  lastMove: null,
  lostA: [], lostB: [],
  log: [],
  ply: 1,
  busy: false,
  moveList: [],
  hist: [],
};

const listeners = {reset: [], move: [], change: []};
export function on(evt, fn){ listeners[evt].push(fn); }
function emit(evt, data){ for(const fn of listeners[evt]) fn(data); }
export function changed(){ emit('change'); }
export function setBusy(v){ game.busy = v; emit('change'); }

export function reset(){
  const s = startBoard();
  game.bd = s.b;
  game.ids = s.b.map((p, i) => p ? i + 1 : 0);
  game.turn = BLUE; game.over = null;
  game.sel = -1; game.legal = []; game.lastMove = null;
  game.lostA = []; game.lostB = [];
  game.log = []; game.ply = 1;
  game.hist = []; game.moveList = [];
  game.busy = false;
  emit('reset');
  emit('change');
}

export function move(mv, fromNet){
  game.hist.push({
    bd: game.bd.slice(), ids: game.ids.slice(), turn: game.turn,
    lastMove: game.lastMove, lostA: game.lostA.slice(), lostB: game.lostB.slice(),
    log: game.log.slice(), ply: game.ply,
  });

  const ply = game.moveList.length;
  const from = moveFrom(mv), to = moveTo(mv);
  const mover = col(game.bd[from]);
  const o = outcome(game.bd, from, to);
  const res = apply(game.bd, mv);

  /* Ids follow pieces, so a shoved line animates as a line. `apply`
     tells us exactly what travelled where. */
  const nids = game.ids.slice();
  for(const [a] of res.moved) nids[a] = 0;
  for(const [a, b] of res.moved) if(b >= 0) nids[b] = game.ids[a];

  if(res.off) (mover === BLUE ? game.lostB : game.lostA).push(1);

  game.bd = res.bd;
  game.ids = nids;
  game.lastMove = [from, to];

  const side = mover === BLUE ? 'side-b' : 'side-r';
  let tag = o === 'push' ? ' <b class="t">shove</b>' : '';
  if(res.off) tag += ' <b class="w">&times;' + res.off + '</b>';
  game.log.push(
    game.ply + '. <span class="' + side + '">' + sq(from) + '&rarr;' + sq(to) + '</span>' + tag);

  const nB = count(game.bd, BLUE), nR = count(game.bd, RED);
  if(nR <= LOSE_AT) game.over = {w: BLUE, why: 'shoved into the sea'};
  else if(nB <= LOSE_AT) game.over = {w: RED, why: 'shoved into the sea'};

  game.turn = 1 - game.turn;
  game.ply++;

  /* The anvil is claimed at the start of your turn, so holding it has
     to survive your opponent's reply. */
  if(!game.over && holds(game.bd, game.turn) >= HOLD_TO_WIN){
    game.over = {w: game.turn, why: 'held the anvil'};
  }
  if(!game.over && genMoves(game.bd, game.turn).length === 0){
    game.over = {w: 1 - game.turn, why: 'no move left'};
  }
  if(!game.over && ply + 1 >= PLY_CAP){
    game.over = {w: -1, why: 'neither side could take the middle'};
  }

  game.moveList.push(mv);
  game.sel = -1; game.legal = [];

  emit('move', {mv, o, off: res.off, fromNet});
  emit('change');
}

export function undo(steps){
  if(game.busy || !game.hist.length) return;
  while(steps-- && game.hist.length){
    const h = game.hist.pop();
    game.bd = h.bd; game.ids = h.ids; game.turn = h.turn; game.lastMove = h.lastMove;
    game.lostA = h.lostA; game.lostB = h.lostB; game.log = h.log; game.ply = h.ply;
    game.moveList.pop();
  }
  game.over = null; game.sel = -1; game.legal = [];
  emit('change');
}

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
