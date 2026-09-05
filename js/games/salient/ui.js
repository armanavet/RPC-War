/* ============================================================
   Salient: everything that touches the DOM. Reads game state,
   writes pixels. The board itself is _shared/board.js; what is
   here is the furniture around it.
   ============================================================ */
import * as R from './rules.js';
import {game, clickSquare, placeAt, legalTargetsForPlacement} from './state.js';
import {mountBoard} from '../_shared/board.js';
import * as skin from './skin.js';
import {owner} from '../_shared/control.js';

export const $ = id => document.getElementById(id);
export const esc = t => String(t).replace(/[&<>"]/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let flip = false;
export function setFlip(v){ flip = v; if(board) board.setFlip(v); }

const MARK = ['gen','stf','inf','arm','art','eng','rec','dep'];
const FULL = ['General','Staff officer','Infantry','Armour','Artillery',
              'Engineer','Recon','Depot'];

let board = null;
let input = {canPlay: () => false};

export function initBoard(handlers){
  input = handlers;
  board = mountBoard({
    el: $('board'),
    geo: R.geo,
    skin,
    objectives: R.OBJECTIVES,
    objValue: R.OBJ_VALUE,
    onPick(i){
      if(!input.canPlay()) return;
      /* An empty baseline square with a replacement waiting is a
         placement; anything else is an ordinary selection. */
      const st = game.st;
      if(st && st.pool[st.turn] > 0 && R.unitAt(st, i) < 0 && placeAt(i)) return;
      clickSquare(i);
    },
  });
  buildKey();
}

/* ---------- the board ---------- */
export function render(){
  if(!board || !game.st) return;
  const st = game.st;
  const f = R.controlOf(st);
  const cmd = R.commandMask(st, st.turn, f).slice();

  const units = [];
  const danger = new Uint8Array(R.SZ);
  for(let k = 0; k < st.n; k++){
    if(!st.live[k]) continue;
    const t = R.TYPES[st.type[k]];
    const i = st.sq[k];
    const v = st.side[k] === R.BLUE ? f[i] : -f[i];
    if(v <= -(R.BREAK - 2)) danger[i] = 1;
    units.push({
      key: k, sq: i, side: st.side[k],
      mark: MARK[st.type[k]], strength: t.str, cut: st.cut[k] > 0,
      sel: game.sel === i,
      /* Dimming your own unreachable units says "these cannot move"
         far more directly than outlining the half of the board that
         they can. The command radius is a fact about your units, not
         about the ground. */
      dim: st.side[k] === st.turn && !cmd[i],
      title: FULL[st.type[k]] + '  ·  strength ' + t.str
           + (st.cut[k] > 0 ? '  ·  CUT OFF (' + st.cut[k] + '/' + R.CUT_LIMIT + ')' : '')
           + (st.side[k] === st.turn && !cmd[i] ? '  ·  out of command' : ''),
    });
  }

  let targets = game.targets;
  if(st.pool[st.turn] > 0 && game.sel < 0){
    targets = new Set([...targets, ...legalTargetsForPlacement()]);
  }

  const last = game.moveList.length
    ? game.moveList[game.moveList.length - 1] : null;
  let lastFrom = -1, lastTo = -1;
  if(last != null && !R.isPass(last)){
    if(R.isPlace(last)) lastTo = R.placeAt(last);
    else { lastFrom = R.moveFrom(last); lastTo = R.moveTo(last); }
  }

  board.render({
    terrain: st.ter, control: f, units, command: null,
    selected: game.sel, targets, lastFrom, lastTo, danger,
  });

  renderPanels(f);
}

/* ---------- panels ---------- */
function renderPanels(f){
  const st = game.st;
  const incB = R.income(st, R.BLUE, f), incR = R.income(st, R.RED, f);

  setVp('B', st.vp[R.BLUE], incB);
  setVp('R', st.vp[R.RED], incR);

  $('pbarTop').classList.toggle('pbar--turn', st.turn === (flip ? R.BLUE : R.RED));
  $('pbarBot').classList.toggle('pbar--turn', st.turn === (flip ? R.RED : R.BLUE));

  const dot = $('turnDot'), txt = $('turnTxt');
  if(game.over){
    txt.textContent = 'Game over';
    dot.className = 'dot';
  }else{
    dot.className = 'dot ' + (st.turn === R.BLUE ? 'b' : 'r');
    txt.textContent = (st.turn === R.BLUE ? 'Blue' : 'Red') + ' to move';
  }
  $('ply').textContent = Math.floor(st.ply / 2) + 1;

  const pool = st.pool[st.turn];
  $('poolChip').hidden = pool <= 0;
  $('poolChip').textContent = pool + ' replacement' + (pool === 1 ? '' : 's') + ' ready';

  const cutB = countCut(st, R.BLUE), cutR = countCut(st, R.RED);
  $('cutChip').hidden = !(cutB || cutR);
  $('cutChip').innerHTML = 'cut off ' +
    '<b class="side-b">' + cutB + '</b> / <b class="side-r">' + cutR + '</b>';

  $('log').innerHTML = game.log.slice(-40).join('<br>');
  $('log').scrollTop = $('log').scrollHeight;

  const hint = $('hint');
  if(game.over) hint.textContent = '';
  else if(game.sel >= 0) hint.textContent = 'Choose a destination';
  else if(pool > 0) hint.textContent = 'Pick a unit, or a baseline square to place a replacement';
  else hint.textContent = 'Pick a unit inside your command';
}

function countCut(st, side){
  let n = 0;
  for(let k = 0; k < st.n; k++)
    if(st.live[k] && st.side[k] === side && st.cut[k] > 0) n++;
  return n;
}

function setVp(which, v, inc){
  const pct = Math.min(100, v / R.VP_WIN * 100);
  $('vpFill' + which).style.width = pct.toFixed(1) + '%';
  $('vpN' + which).textContent = v + ' / ' + R.VP_WIN;
  $('vpInc' + which).textContent = '+' + inc;
}

/* ---------- the key ----------
   The counters are a notation, and a notation nobody has been taught
   is decoration. It is built from the same function that draws the
   board, so it can never drift out of step with it. */
function buildKey(){
  const el = $('key');
  if(!el) return;
  el.classList.add('sk-map-key');
  el.innerHTML = R.TYPES.map((t, n) =>
    '<div class="key__row"><span class="key__ctr">' +
    skin.unit({mark: MARK[n], side: 0}) +
    '</span><span>' + FULL[n] + '</span></div>').join('');
}

/* ---------- game over ---------- */
export function showOver(text, why){
  $('overBig').innerHTML = text;
  $('overWhy').textContent = why || '';
  $('over').classList.add('over--on');
}
export function hideOver(){ $('over').classList.remove('over--on'); }

/* ---------- panels the shared sync layer expects ---------- */
export function renderMpPanels(){}
export function renderChat(){}
export function setLink(){}
export function flashCopied(){}
export function mpErr(){}
