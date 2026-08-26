/* ============================================================
   Cairn: the live game — board, history, win detection.

   Knows nothing about the DOM, the AI or the network.

     on('reset', fn)   board rebuilt
     on('move',  fn)   a move was played ({mv, o, spilled, fromNet})
     on('change',fn)   anything visible changed — redraw

   Note the board is an array of arrays. Anything that snapshots it
   for the undo history has to deep-copy — cloneBoard does that.
   ============================================================ */
import {BLUE, RED, owner, heightOf, cloneBoard, genMoves, outcome, apply,
        count, controls, LOSE_AT, PLY_CAP,
        startBoard, sq, packMove, moveFrom, moveTo} from './rules.js';

export const game = {
  bd: [],
  turn: BLUE,
  over: null,
  sel: -1, legal: [],
  lastMove: null,
  lostA: [], lostB: [],      // pieces spilled out of the game for good
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
  game.bd = startBoard().b;
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
    bd: cloneBoard(game.bd), turn: game.turn,
    lastMove: game.lastMove, lostA: game.lostA.slice(), lostB: game.lostB.slice(),
    log: game.log.slice(), ply: game.ply,
  });

  const ply = game.moveList.length;
  const from = moveFrom(mv), to = moveTo(mv);
  const mover = owner(game.bd[from]);
  const o = outcome(game.bd, from, to);
  const res = apply(game.bd, mv);

  for(const p of res.spilled) (p === BLUE ? game.lostA : game.lostB).push(1);

  game.bd = res.bd;
  game.lastMove = [from, to];

  const side = mover === BLUE ? 'side-b' : 'side-r';
  let tag = o === 'capture' ? ' <b class="w">took ' + res.height + '</b>'
          : o === 'merge' ? ' <b class="t">stack ' + res.height + '</b>' : '';
  if(res.spilled.length) tag += ' <b class="l">spill ' + res.spilled.length + '</b>';
  game.log.push(
    game.ply + '. <span class="' + side + '">' + sq(from) + '&rarr;' + sq(to) + '</span>' + tag);

  const nB = count(game.bd, BLUE), nR = count(game.bd, RED);
  if(nR <= LOSE_AT || controls(game.bd, RED) === 0) game.over = {w: BLUE, why: 'ground down'};
  else if(nB <= LOSE_AT || controls(game.bd, BLUE) === 0) game.over = {w: RED, why: 'ground down'};

  game.turn = 1 - game.turn;
  game.ply++;

  if(!game.over && genMoves(game.bd, game.turn).length === 0){
    game.over = {w: 1 - game.turn, why: 'no stack left to move'};
  }
  if(!game.over && ply + 1 >= PLY_CAP){
    game.over = {w: -1, why: 'neither side could grind the other down'};
  }

  game.moveList.push(mv);
  game.sel = -1; game.legal = [];

  emit('move', {mv, o, spilled: res.spilled.length, fromNet});
  emit('change');
}

export function undo(steps){
  if(game.busy || !game.hist.length) return;
  while(steps-- && game.hist.length){
    const h = game.hist.pop();
    game.bd = h.bd; game.turn = h.turn; game.lastMove = h.lastMove;
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
  const st = game.bd[i];
  if(st.length && owner(st) === game.turn){
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
