/* ============================================================
   Breakthrough: everything that touches the DOM.

   The pressure gauges are the important thing on this board. A
   defender who cannot see a build-up cannot answer it, so they are
   drawn on every square that has any pressure at all — both sides'
   — rather than only on the attacker's own.
   ============================================================ */
import * as R from './rules.js';
import {game, clickSquare} from './state.js';
import {mountBoard} from '../_shared/board.js';
import * as skin from './skin.js';

export const $ = id => document.getElementById(id);
const MARK = ['gen','inf','arm','art','rec','mil'];
const FULL = ['General','Infantry','Armour','Artillery','Recon','Militia'];

let board = null, input = {canPlay: () => false};

export function initBoard(handlers){
  input = handlers;
  board = mountBoard({
    el: $('board'), geo: R.geo, skin,
    objectives: R.OBJECTIVES, objValue: R.OBJECTIVES.map(() => 1),
    onPick(i){ if(input.canPlay()) clickSquare(i); },
  });
  buildKey();
}

export function render(){
  if(!board || !game.st) return;
  const st = game.st;
  const f = R.controlOf(st);

  /* Both sides' gauges on one layer: whichever is larger on a square
     is the one that matters there. Only real build-up is drawn — a
     single pip appears and vanishes all over the map every turn, and
     showing it turned the board into a field of gold sticks with no
     signal in it. */
  const press = new Int8Array(R.SZ);
  for(let i = 0; i < R.SZ; i++){
    const v = Math.max(st.pB[i], st.pR[i]);
    press[i] = v >= 2 ? v : 0;
  }

  const units = [];
  const exploitOnly = st.exploit > 0 && st.expSide === st.turn;
  for(let k = 0; k < st.n; k++){
    if(!st.live[k]) continue;
    const t = R.TYPES[st.type[k]];
    const i = st.sq[k];
    const v = st.side[k] === R.BLUE ? f[i] : -f[i];
    units.push({
      key: k, sq: i, side: st.side[k], mark: MARK[st.type[k]],
      strength: t.str, cut: v <= -(R.BREAK - 2), sel: game.sel === i,
      dim: exploitOnly && st.side[k] === st.turn && !t.fast,
      title: FULL[st.type[k]] + '  ·  strength ' + t.str +
             (exploitOnly && !t.fast ? '  ·  cannot exploit' : ''),
    });
  }

  const last = game.moveList.length ? game.moveList[game.moveList.length - 1] : null;
  let lastFrom = -1, lastTo = -1;
  if(last != null && !R.isPass(last)){ lastFrom = R.moveFrom(last); lastTo = R.moveTo(last); }

  board.render({
    terrain: st.ter, control: f, units, press,
    selected: game.sel, targets: game.targets, lastFrom, lastTo,
  });
  panels(f);
}

function panels(f){
  const st = game.st;
  gauge('B', R.rearHeld(st, R.BLUE, f));
  gauge('R', R.rearHeld(st, R.RED, f));

  $('pbarTop').classList.toggle('pbar--turn', st.turn === R.RED);
  $('pbarBot').classList.toggle('pbar--turn', st.turn === R.BLUE);

  const dot = $('turnDot'), txt = $('turnTxt');
  if(game.over){ txt.textContent = 'Game over'; dot.className = 'dot'; }
  else{
    dot.className = 'dot ' + (st.turn === R.BLUE ? 'b' : 'r');
    txt.textContent = (st.turn === R.BLUE ? 'Blue' : 'Red') + ' to move';
  }
  $('ply').textContent = Math.floor(st.ply / 2) + 1;

  const ex = $('exChip');
  ex.hidden = st.exploit <= 0;
  ex.innerHTML = '<b class="' + (st.expSide === R.BLUE ? 'side-b' : 'side-r') + '">' +
    (st.expSide === R.BLUE ? 'Blue' : 'Red') + '</b> is through — ' +
    st.exploit + ' fast move' + (st.exploit === 1 ? '' : 's') + ' left';

  /* How close either side is to opening a hole. */
  const bestB = runOf(st.pB), bestR = runOf(st.pR);
  const pc = $('pressChip');
  pc.hidden = !(bestB || bestR);
  pc.innerHTML = 'pressure <b class="side-b">' + bestB + '</b> / <b class="side-r">' +
    bestR + '</b> of ' + R.CRACK_LEN;

  $('log').innerHTML = game.log.slice(-40).join('<br>');
  $('log').scrollTop = $('log').scrollHeight;
  $('hint').textContent = game.over ? ''
    : (st.exploit > 0 && st.expSide === st.turn) ? 'Drive armour and recon through the hole'
    : st.exploit > 0 ? 'They are through the line — you can only watch'
    : game.sel >= 0 ? 'Choose a destination' : 'Pick a unit';
}

/* Longest connected run already at breaking point. */
function runOf(p){
  const hot = new Uint8Array(R.SZ);
  for(let i = 0; i < R.SZ; i++) if(p[i] >= R.PRESS_CAP) hot[i] = 1;
  const seen = new Uint8Array(R.SZ);
  let best = 0;
  for(let i = 0; i < R.SZ; i++){
    if(!hot[i] || seen[i]) continue;
    const comp = [i]; seen[i] = 1;
    for(let h = 0; h < comp.length; h++)
      for(const j of R.geo.N4[comp[h]])
        if(hot[j] && !seen[j]){ seen[j] = 1; comp.push(j); }
    if(comp.length > best) best = comp.length;
  }
  return best;
}

function gauge(w, held){
  $('vpFill' + w).style.width = (held / 2 * 100) + '%';
  $('vpN' + w).textContent = held + ' / 2 depots';
}

function buildKey(){
  const el = $('key');
  if(!el) return;
  el.classList.add('sk-flat-key');
  el.innerHTML = R.TYPES.map((t, n) =>
    '<div class="key__row"><span class="key__ctr">' + skin.unit({mark: MARK[n], side: 0}) +
    '</span><span>' + FULL[n] + (t.fast ? ' *' : '') + '</span></div>').join('') +
    '<div class="key__note">* may exploit a breakthrough</div>';
}

export function showOver(t, why){
  $('overBig').innerHTML = t; $('overWhy').textContent = why || '';
  $('over').classList.add('over--on');
}
export function hideOver(){ $('over').classList.remove('over--on'); }
