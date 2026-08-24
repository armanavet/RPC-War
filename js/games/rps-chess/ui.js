/* ============================================================
   Everything that touches the DOM: the board, the side panels, the
   name modal and the chat log. Reads game + net state, writes pixels.
   ============================================================ */
import {SZ, BLUE, RED, col, typ, rowOf, colOf} from './rules.js';
import {SVG} from './icons.js';
import {game} from './state.js';
import {net} from '../../net/session.js';

import * as profile from '../../site/profile.js';

export const $ = id => document.getElementById(id);
export const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* true = board drawn rotated 180, for the red player in an online game */
let flip = false;
const dsp = i => flip ? 80 - i : i;      // logic square <-> screen square (its own inverse)
export function setFlip(v){ flip = v; }

const cellsEl = $('cells'), pcEl = $('pieces'), marksEl = $('marks');
const pcEls = new Map();                 // piece id -> element, so discs animate rather than jump
let cellDivs = [];

/* ---------- board scaffolding + input (built once) ---------- */
/* Two ways to move a piece, both ending in the same place:
     click it, then click a destination
     or drag it onto one
   A drag is just "pick up" then "put down", so it goes through the very
   same onPick() the clicks use — the rules and turn guards cannot drift
   apart between the two. */

const boardEl = $('board');
let input = {canPlay: () => false, onPick: () => {}};
let drag = null;          // {id, from, el, startX, startY, moved, dropEl}
let suppressClick = false;

const DRAG_SLOP = 4;      // px of movement before a press becomes a drag

/* Logical square under a point, or -1 when outside the board. */
function squareAt(x, y){
  const r = boardEl.getBoundingClientRect();
  if(!r.width || !r.height) return -1;
  const c = Math.floor((x - r.left) / r.width * 9);
  const w = Math.floor((y - r.top) / r.height * 9);
  if(c < 0 || c > 8 || w < 0 || w > 8) return -1;
  return dsp(w * 9 + c);
}

const isLegalTarget = to => game.legal.some(m => m.to === to);

function highlightDrop(to){
  const el = (to >= 0 && isLegalTarget(to)) ? cellDivs[dsp(to)] : null;
  if(el === drag.dropEl) return;
  if(drag.dropEl) drag.dropEl.classList.remove('drop');
  if(el) el.classList.add('drop');
  drag.dropEl = el;
}

function endDrag(){
  if(!drag) return null;
  const d = drag;
  drag = null;
  if(d.dropEl) d.dropEl.classList.remove('drop');
  d.el.classList.remove('pc--drag');
  d.el.style.transform = '';
  boardEl.classList.remove('board--dragging');
  return d;
}

function onPointerDown(e){
  suppressClick = false;
  if(e.button > 0) return;                       // left button or touch only
  if(!input.canPlay()) return;
  const from = squareAt(e.clientX, e.clientY);
  if(from < 0) return;
  const p = game.bd[from];
  if(!p || col(p) !== game.turn) return;         // you can only drag your own
  const el = pcEls.get(game.ids[from]);
  if(!el) return;
  drag = {id: e.pointerId, from, el, startX: e.clientX, startY: e.clientY, moved: false, dropEl: null};
}

function onPointerMove(e){
  if(!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;

  if(!drag.moved){
    if(Math.hypot(dx, dy) < DRAG_SLOP) return;   // still just a press
    drag.moved = true;
    // picking the piece up is the same act as clicking it
    if(game.sel !== drag.from) input.onPick(drag.from);
    drag.el.classList.add('pc--drag');
    boardEl.classList.add('board--dragging');
    try{ boardEl.setPointerCapture(e.pointerId); }catch(err){}
  }

  e.preventDefault();
  drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
  highlightDrop(squareAt(e.clientX, e.clientY));
}

function onPointerUp(e){
  if(!drag || e.pointerId !== drag.id) return;
  const to = squareAt(e.clientX, e.clientY);
  const d = endDrag();
  if(!d.moved) return;                           // a tap: let the click handler run

  suppressClick = true;                          // ...but a drag must not also toggle
  if(to >= 0 && to !== d.from && isLegalTarget(to)) input.onPick(to);
  else render();                                 // illegal or off-board: snap home, stay picked up
}

function onPointerCancel(e){
  if(!drag || e.pointerId !== drag.id) return;
  const d = endDrag();
  if(d.moved){ suppressClick = true; render(); }
}

export function initBoard(handlers){
  input = handlers;

  for(let i = 0; i < SZ; i++){
    const d = document.createElement('div');
    d.className = 'cell ' + (((rowOf(i) + colOf(i)) % 2) ? 'dark' : 'lite');
    if(rowOf(i) === 0) d.className += ' goalB';
    if(rowOf(i) === 8) d.className += ' goalR';
    d.dataset.i = i;
    d.addEventListener('click', () => {
      if(suppressClick){ suppressClick = false; return; }
      if(!input.canPlay()) return;
      input.onPick(dsp(i));
    });
    cellsEl.appendChild(d);
  }
  cellDivs = [...cellsEl.children];

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', onPointerCancel);
  boardEl.addEventListener('dragstart', e => e.preventDefault());

  document.querySelectorAll('.ico').forEach(e => { e.innerHTML = SVG[{R:0, P:1, S:2}[e.dataset.i]]; });
}

/* Drop every disc so the next render starts from a clean board. */
export function clearPieces(){
  endDrag();
  pcEl.innerHTML = '';
  marksEl.innerHTML = '';
  pcEls.clear();
}

/* ---------- the main draw ---------- */
export function render(){
  drawCells();
  drawMarks();
  drawPieces();
  drawPlayerBars();
  drawStatus();
  drawTrays();
  drawLog();
  drawOverlay();
}

function drawCells(){
  for(let i = 0; i < SZ; i++){
    const d = cellDivs[dsp(i)];
    d.className = 'cell ' + (((rowOf(i) + colOf(i)) % 2) ? 'dark' : 'lite')
      + (rowOf(i) === 0 ? ' goalB' : '') + (rowOf(i) === 8 ? ' goalR' : '')
      + (game.lastMove && (i === game.lastMove[0] || i === game.lastMove[1]) ? ' last' : '')
      + (i === game.sel ? ' sel' : '');
    d.innerHTML = '';
  }
}

/* Move markers live on their own layer, above the pieces. */
function drawMarks(){
  marksEl.innerHTML = '';
  for(const m of game.legal){
    const to = m.to;
    cellDivs[dsp(to)].classList.add('pick');
    const s = document.createElement('div');
    s.className = 'mv';
    s.style.left = (colOf(dsp(to)) * 100 / 9) + '%';
    s.style.top  = (rowOf(dsp(to)) * 100 / 9) + '%';
    if(m.o === 'move'){
      s.innerHTML = '<i class="dot0"></i>';
    }else{
      s.style.setProperty('--c', m.o === 'win' ? 'var(--good)' : m.o === 'trade' ? 'var(--even)' : 'var(--bad)');
      s.innerHTML = '<i class="ring"></i><span class="tag">'
        + (m.o === 'win' ? '&#10003;' : m.o === 'trade' ? '=' : '&#10005;') + '</span>';
    }
    marksEl.appendChild(s);
  }
  if(game.sel >= 0) cellDivs[dsp(game.sel)].classList.add('pick');
}

function drawPieces(){
  const seen = new Set();
  for(let i = 0; i < SZ; i++){
    const p = game.bd[i]; if(!p) continue;
    const id = game.ids[i]; seen.add(id);
    let el = pcEls.get(id);
    if(!el){
      el = document.createElement('div');
      el.className = 'pc ' + (col(p) === BLUE ? 'b' : 'r') + ' born';
      el.innerHTML = '<div class="disc">' + SVG[typ(p)] + '</div>';
      pcEl.appendChild(el);
      pcEls.set(id, el);
    }
    el.style.left = (colOf(dsp(i)) * 100 / 9) + '%';
    el.style.top  = (rowOf(dsp(i)) * 100 / 9) + '%';
    el.classList.toggle('selp', i === game.sel);
  }
  // anything that vanished this turn fades out, then leaves the DOM
  for(const [id, el] of [...pcEls]){
    if(!seen.has(id)){
      el.classList.add('gone');
      pcEls.delete(id);
      setTimeout(() => el.remove(), 260);
    }
  }
}

function drawStatus(){
  const dot = $('turnDot'), txt = $('turnTxt'), hint = $('hint');
  dot.className = 'dot ' + (game.turn === BLUE ? 'b' : 'r');
  if(net.on){
    txt.textContent = game.over ? 'Game over'
      : !net.ready ? 'Waiting for your friend…'
      : game.turn === net.side ? 'Your turn' : (net.names[game.turn] || 'Opponent') + ' is thinking…';
    hint.textContent = net.ready
      ? 'You are ' + (net.side === BLUE ? 'Blue' : 'Red') + ' · vs ' + (net.names[1 - net.side] || '…')
      : 'Share the link to start';
    renderMpPanels();
  }else{
    txt.textContent = game.over ? 'Game over' : (game.turn === BLUE ? 'Blue to move' : 'Red to move');
    hint.textContent = game.over ? '' : game.busy ? 'Thinking…'
      : (game.sel >= 0 ? 'Pick a square' : 'Pick a piece');
  }
  $('ply').textContent = Math.ceil(game.ply / 2);
}

function drawTrays(){
  const tray = (arr, cls) => arr.map(t => '<span class="mini ' + cls + '">' + SVG[t] + '</span>').join('');
  $('lostB').innerHTML = tray(game.lostB, 'b');
  $('lostR').innerHTML = tray(game.lostR, 'r');
}

function drawLog(){
  const lg = $('log');
  lg.innerHTML = game.log.slice(-60).map(l => '<div>' + l + '</div>').join('');
  lg.scrollTop = lg.scrollHeight;
}

function drawOverlay(){
  const o = $('over');
  o.classList.toggle('on', !!game.over);
  if(!game.over) return;

  const big = $('overBig');
  big.textContent = game.over.w === -1 ? 'Draw'
    : net.on ? (game.over.w === net.side ? 'You win' : (net.names[game.over.w] || 'Opponent') + ' wins')
    : (game.over.w === BLUE ? 'Blue wins' : 'Red wins');
  big.style.color = game.over.w === -1 ? 'var(--text)'
    : (game.over.w === BLUE ? 'var(--blue-hi)' : 'var(--red-hi)');
  $('overWhy').textContent = game.over.why;

  // rating change, once the server has applied it
  const d = $('overDelta');
  if(net.on && net.rated && net.delta != null){
    const sign = net.delta > 0 ? '+' : net.delta < 0 ? '−' : '±';
    d.textContent = sign + Math.abs(net.delta) + ' rating';
    d.className = 'over__delta tnum ' + (net.delta > 0 ? 'is-up' : net.delta < 0 ? 'is-down' : '');
    d.style.display = '';
  }else if(net.on && !net.rated){
    d.textContent = 'Unrated — friendly game';
    d.className = 'over__delta';
    d.style.display = '';
  }else{
    d.style.display = 'none';
  }

  $('overNew').style.display     = net.on ? 'none' : '';
  $('overRematch').style.display = net.on ? '' : 'none';
  $('overLeave').style.display   = net.on ? '' : 'none';

  if(net.on){
    const btn = $('overRematch');
    const offer = net.rematchOffer;
    const mine = offer && offer === net.me;
    // the server will not let anyone restart a game that is still running
    const settled = net.state === 'finished' || net.state === 'aborted';
    btn.disabled = !!mine || !settled;
    btn.textContent = !settled ? 'Finishing…'
      : mine ? 'Waiting for them…'
      : offer ? 'Accept rematch'
      : 'Offer rematch';
  }
}

/* ---------- player bars ---------- */
/* Bottom bar is always you; top is always the opponent. Online that follows
   the seat you were given, which is also the end of the board you look from. */
function seatName(side, isMe){
  if(net.on) return net.names[side] || (isMe ? 'You' : 'Opponent');
  if(side === BLUE) return profile.displayName();
  return $('aiOn').checked ? 'Computer' : 'Red';
}

function paintSeat(prefix, side, isMe){
  const name = seatName(side, isMe);
  const isBot = !net.on && side === RED && $('aiOn').checked;
  const av = $(prefix + 'Avatar');
  profile.paintAvatar(av, isBot ? 'computer' : name);
  if(isBot) av.textContent = 'AI';

  const nameEl = $(prefix + 'Name');
  nameEl.textContent = name + (isMe && net.on ? ' (you)' : '');
  nameEl.className = 'pbar__name side-' + (side === BLUE ? 'b' : 'r');

  const thinking = !game.over && game.turn === side && (game.busy || (net.on && side !== net.side));
  const rating = net.on ? net.ratings[side] : null;
  $(prefix + 'Meta').textContent =
    (side === BLUE ? 'Blue' : 'Red')
    + (rating != null ? ' · ' + rating : '')
    + (thinking ? ' · thinking…' : '');
}

function drawPlayerBars(){
  const me = net.on ? net.side : BLUE;
  const op = 1 - me;
  paintSeat('pBot', me, true);
  paintSeat('pTop', op, false);
  $('pbarBot').classList.toggle('pbar--turn', !game.over && game.turn === me);
  $('pbarTop').classList.toggle('pbar--turn', !game.over && game.turn === op);
}

/* ---------- online panels ---------- */
export function renderMpPanels(){
  const online = net.on;

  $('cardGame').style.display = online ? 'none' : '';
  $('mpIdle').style.display   = (!online && !net.queued) ? '' : 'none';
  $('mpQueue').style.display  = (!online && net.queued) ? '' : 'none';
  $('btnClaim').style.display = (online && net.abandonable) ? '' : 'none';
  $('mpLobby').style.display     = (online && !net.ready) ? '' : 'none';
  $('mpLive').style.display      = (online && net.ready) ? '' : 'none';
  $('cardChat').style.display    = online ? '' : 'none';

  $('chatIn').disabled    = !net.ready;
  $('chatIn').placeholder = net.ready ? 'Message…' : 'Waiting for your friend…';

  const head = $('cardMp').querySelector('.eyebrow');
  if(head) head.textContent = online ? (net.rated ? 'Rated match' : 'Friendly match')
                                     : 'Play a friend';

  if(online && net.ready){
    const you = 1 - net.side;
    $('mpVs').innerHTML = 'vs <b>' + esc(net.names[you] || 'Opponent') + '</b> · you are '
      + (net.side === BLUE ? 'Blue' : 'Red');
  }
}

export function setLink(url){ $('mpLink').value = url; }

export function mpErr(msg){
  const e = $('mpErr');
  if(!msg){ e.style.display = 'none'; return; }
  e.textContent = msg;
  e.style.display = 'block';
}

export function flashCopied(){
  $('mpCopyBtn').textContent = 'Copied';
  setTimeout(() => { $('mpCopyBtn').textContent = 'Copy'; }, 1400);
}

/* ---------- chat ---------- */
export function renderChat(list){
  const box = $('chatLog');
  if(!box) return;
  box.innerHTML = (list || []).slice(-50).map(m =>
    '<div class="msg' + (m.mine ? ' me' : '') + (m.pending ? ' pending' : '') + '">'
    + '<span class="who ' + (m.side === BLUE ? 'b' : 'r') + '">' + esc(m.name || '?') + '</span>'
    + esc(m.body) + '</div>').join('');
  box.scrollTop = box.scrollHeight;
}
