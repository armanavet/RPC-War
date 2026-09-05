/* ============================================================
   Tideline: everything that touches the DOM.
   ============================================================ */
import * as R from './rules.js';
import {game, clickSquare, buildTargets, setBuildType} from './state.js';
import {mountBoard} from '../_shared/board.js';
import * as skin from './skin.js';

export const $ = id => document.getElementById(id);
const MARK = ['gen','inf','arm','art','mil'];
const FULL = ['General','Infantry','Armour','Artillery','Militia'];

let board = null, input = {canPlay: () => false};

export function initBoard(handlers){
  input = handlers;
  board = mountBoard({
    el: $('board'), geo: R.geo, skin,
    objectives: R.OBJECTIVES, objValue: R.OBJECTIVES.map(() => 1),
    onPick(i){ if(input.canPlay()) clickSquare(i); },
  });
  buildKey();
  buildShop();
}

export function render(){
  if(!board || !game.st) return;
  const st = game.st;
  const f = R.controlOf(st);
  const pend = R.pending(st, st.turn, f);

  const units = [];
  for(let k = 0; k < st.n; k++){
    if(!st.live[k]) continue;
    const t = R.TYPES[st.type[k]];
    const i = st.sq[k];
    const onTheirs = st.own[i] === (1 - st.side[k]);
    units.push({
      key: k, sq: i, side: st.side[k], mark: MARK[st.type[k]],
      strength: t.str, cut: onTheirs, sel: game.sel === i,
      title: FULL[st.type[k]] + '  ·  strength ' + t.str +
             (onTheirs ? '  ·  on enemy ground — takes it this turn or falls back' : ''),
    });
  }

  const targets = game.sel >= 0 ? game.targets : buildTargets();

  const last = game.moveList.length ? game.moveList[game.moveList.length - 1] : null;
  let lastFrom = -1, lastTo = -1;
  if(last != null && !R.isPass(last)){
    if(R.isBuild(last)) lastTo = R.buildAt(last);
    else { lastFrom = R.moveFrom(last); lastTo = R.moveTo(last); }
  }

  board.render({
    terrain: st.ter, control: f, ground: st.own, units,
    selected: game.sel, targets, lastFrom, lastTo, pending: pend,
  });
  panels(f);
}

function panels(f){
  const st = game.st;
  const gb = R.groundCount(st, R.BLUE), gr = R.groundCount(st, R.RED);
  bar('B', gb); bar('R', gr);

  $('pbarTop').classList.toggle('pbar--turn', st.turn === R.RED);
  $('pbarBot').classList.toggle('pbar--turn', st.turn === R.BLUE);

  const dot = $('turnDot'), txt = $('turnTxt');
  if(game.over){ txt.textContent = 'Game over'; dot.className = 'dot'; }
  else{
    dot.className = 'dot ' + (st.turn === R.BLUE ? 'b' : 'r');
    txt.textContent = (st.turn === R.BLUE ? 'Blue' : 'Red') + ' to move';
  }
  $('ply').textContent = Math.floor(st.ply / 2) + 1;
  $('bpChip').textContent = st.bp[st.turn] + ' build points';
  $('objChip').innerHTML = 'towns <b class="side-b">' + R.objectivesOwned(st, R.BLUE) +
    '</b> / <b class="side-r">' + R.objectivesOwned(st, R.RED) + '</b>';

  for(const t of R.BUILDABLE){
    const b = $('buy' + t);
    if(!b) continue;
    b.disabled = R.TYPES[t].cost > st.bp[st.turn] || !!game.over;
    b.classList.toggle('buy--on', game.buildType === t);
  }

  $('log').innerHTML = game.log.slice(-40).join('<br>');
  $('log').scrollTop = $('log').scrollHeight;
  $('hint').textContent = game.over ? ''
    : game.sel >= 0 ? 'Choose a destination'
    : 'Move a unit, or click your ground to raise a ' + FULL[game.buildType].toLowerCase();
}

function bar(w, v){
  $('vpFill' + w).style.width = Math.min(100, v / R.WIN_GROUND * 100).toFixed(1) + '%';
  $('vpN' + w).textContent = v + ' / ' + R.WIN_GROUND;
}

function buildKey(){
  const el = $('key');
  if(!el) return;
  el.classList.add('sk-painted-key');
  el.innerHTML = R.TYPES.map((t, n) =>
    '<div class="key__row"><span class="key__ctr">' + skin.unit({mark: MARK[n], side: 0}) +
    '</span><span>' + FULL[n] + '</span></div>').join('');
}

/* The build shop: what a turn of income can buy. */
function buildShop(){
  const el = $('shop');
  if(!el) return;
  el.classList.add('sk-painted-key');
  el.innerHTML = R.BUILDABLE.map(t =>
    '<button class="buy" id="buy' + t + '"><span class="buy__ctr">' +
    skin.unit({mark: MARK[t], side: 0}) + '</span><span class="buy__n">' +
    FULL[t] + '</span><span class="buy__c tnum">' + R.TYPES[t].cost + '</span></button>').join('');
  for(const t of R.BUILDABLE) $('buy' + t).onclick = () => setBuildType(t);
}

export function showOver(t, why){
  $('overBig').innerHTML = t; $('overWhy').textContent = why || '';
  $('over').classList.add('over--on');
}
export function hideOver(){ $('over').classList.remove('over--on'); }
