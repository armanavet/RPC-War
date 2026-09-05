/* ============================================================
   Barbican: everything that touches the DOM.

   The two sides are not shown symmetrically, because they are not
   playing the same game. The besieger's bar carries his strength and
   what the camp has cost him; the garrison's carries the clock,
   which is the only thing it is trying to win.
   ============================================================ */
import * as R from './rules.js';
import {game, clickSquare} from './state.js';
import {mountBoard} from '../_shared/board.js';
import * as skin from './skin.js';
import {isWallKind} from './rules.js';

export const $ = id => document.getElementById(id);
const MARK = ['captain','levy','serjeant','ram','trebuchet','ladder','miner',
              'castellan','archer','guard','knight'];

let board = null, input = {canPlay: () => false};

export function initBoard(handlers){
  input = handlers;
  /* the hatch and masonry patterns every shield and wall references */
  const holder = document.createElement('div');
  holder.innerHTML = skin.DEFS;
  document.body.appendChild(holder.firstElementChild);

  board = mountBoard({
    el: $('board'), geo: R.geo, skin,
    objectives: [R.KEEP_SQ], objValue: [1],
    onPick(i){ if(input.canPlay()) clickSquare(i); },
  });
  buildKey();
}

export function render(){
  if(!board || !game.st) return;
  const st = game.st;
  const f = R.controlOf(st);

  const units = [];
  for(let k = 0; k < st.n; k++){
    if(!st.live[k]) continue;
    const t = R.TYPES[st.type[k]];
    const i = st.sq[k];
    const v = st.side[k] === R.BESIEGER ? f[i] : -f[i];
    units.push({
      key: k, sq: i, side: st.side[k], mark: MARK[st.type[k]],
      strength: t.str, cut: v <= -(R.BREAK - 2), sel: game.sel === i,
      title: t.name + '  ·  strength ' + t.str,
    });
  }

  /* Masonry that is taking damage gets a wear class, so a wall about
     to come down is visible before it does. */
  const wear = new Uint8Array(R.SZ);
  for(let i = 0; i < R.SZ; i++){
    if(!isWallKind(st.ter[i])) continue;
    const full = R.HP[st.ter[i]] || 1;
    const frac = st.hp[i] / full;
    wear[i] = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
  }

  const last = game.moveList.length ? game.moveList[game.moveList.length - 1] : null;
  let lastFrom = -1, lastTo = -1;
  if(last != null && !R.isPass(last)){ lastFrom = R.moveFrom(last); lastTo = R.moveTo(last); }

  board.render({
    terrain: st.ter, control: f, units,
    selected: game.sel,
    targets: new Set([...game.targets, ...game.siege]),
    danger: null, lastFrom, lastTo, wear,
  });
  panels(st);
}

function panels(st){
  const besiegers = R.countUnits(st, R.BESIEGER);
  const garrison  = R.countUnits(st, R.GARRISON);

  $('pTopName').textContent = 'Garrison';
  $('pBotName').textContent = 'Besieger';
  $('vpNR').textContent = garrison + ' hold the walls';
  $('vpNB').textContent = besiegers + ' before the walls';

  /* The garrison's bar is the clock, and fills toward relief. */
  const left = Math.max(0, R.PLY_CAP - st.ply);
  $('vpFillR').style.width = ((R.PLY_CAP - left) / R.PLY_CAP * 100).toFixed(1) + '%';
  $('vpIncR').textContent = Math.ceil(left / 2) + ' turns to relief';
  /* The besieger's is his army, and empties. */
  $('vpFillB').style.width = (besiegers / 19 * 100).toFixed(1) + '%';
  $('vpIncB').textContent = st.lost ? st.lost + ' lost to the camp' : '';

  $('pbarTop').classList.toggle('pbar--turn', st.turn === R.GARRISON);
  $('pbarBot').classList.toggle('pbar--turn', st.turn === R.BESIEGER);

  const dot = $('turnDot'), txt = $('turnTxt');
  if(game.over){ txt.textContent = 'The siege is over'; dot.className = 'dot'; }
  else{
    dot.className = 'dot ' + (st.turn === R.BESIEGER ? 'b' : 'r');
    txt.textContent = (st.turn === R.BESIEGER ? 'Besieger' : 'Garrison') + ' to move';
  }
  $('ply').textContent = Math.floor(st.ply / 2) + 1;

  const br = R.breaches(st);
  $('brChip').hidden = br === 0;
  $('brChip').textContent = br + (br === 1 ? ' breach' : ' breaches');
  $('keepChip').hidden = !R.inKeep(st, R.BESIEGER);
  $('keepChip').textContent = 'a banner in the keep';

  $('log').innerHTML = game.log.slice(-40).join('<br>');
  $('log').scrollTop = $('log').scrollHeight;
  $('hint').textContent = game.over ? ''
    : game.sel >= 0 ? 'Choose where to go, or a stretch of wall to attack'
    : 'Pick a unit';
}

function buildKey(){
  const el = $('key');
  if(!el) return;
  el.classList.add('sk-woodcut-key');
  el.innerHTML = R.TYPES.map((t, n) =>
    '<div class="key__row"><span class="key__ctr">' +
    skin.unit({mark: MARK[n], side: t.side}) +
    '</span><span>' + t.name + '</span></div>').join('');
}

export function showOver(t, why){
  $('overBig').innerHTML = t; $('overWhy').textContent = why || '';
  $('over').classList.add('over--on');
}
export function hideOver(){ $('over').classList.remove('over--on'); }
