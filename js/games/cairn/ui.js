/* ============================================================
   Cairn: everything that touches the DOM.

   Satisfies the UI CONTRACT in js/net/matchsync.js.

   The hard part here is that a square is a *stack*, not a piece.
   A stack is drawn as offset discs so you can count its height and
   see the colours buried in it at a glance — the buried pieces are
   the whole tension, so hiding them would hide the game.

   Because stacks change identity constantly there is no stable
   piece id to animate, so this redraws the pieces layer wholesale
   rather than moving nodes about.

   The class is `.pile`, not `.stack`. Every page already carries
   <main class="stack"> from the shared furniture, and naming a piece
   the same thing applied `position:absolute; width:14%` to the whole
   page and collapsed the layout to nothing. Game CSS must not invent
   bare class names that the site chrome already uses.
   ============================================================ */
import {SZ, N, BLUE, RED, owner, heightOf, MAX_HEIGHT,
        rowOf, colOf, count} from './rules.js';
import {game} from './state.js';
import {net} from '../../net/session.js';
import * as profile from '../../site/profile.js';

export const $ = id => document.getElementById(id);
export const esc = t => String(t).replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let flip = false;
const dsp = i => flip ? (SZ - 1) - i : i;
export function setFlip(v){ flip = v; }

const cellsEl = $('cells'), pcEl = $('pieces'), marksEl = $('marks');
const boardEl = $('board');
let cellDivs = [];

/* ---------- input ---------- */
let input = {canPlay: () => false, onPick: () => {}};
let drag = null;
let suppressClick = false;
const DRAG_SLOP = 4;

function squareAt(x, y){
  const r = boardEl.getBoundingClientRect();
  if(!r.width || !r.height) return -1;
  const c = Math.floor((x - r.left) / r.width * N);
  const w = Math.floor((y - r.top) / r.height * N);
  if(c < 0 || c >= N || w < 0 || w >= N) return -1;
  return dsp(w * N + c);
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
  if(d.el){ d.el.classList.remove('pile--drag'); d.el.style.transform = ''; }
  boardEl.classList.remove('board--dragging');
  return d;
}

export function initBoard(handlers){
  input = handlers;

  for(let i = 0; i < SZ; i++){
    const d = document.createElement('div');
    d.dataset.i = i;
    d.addEventListener('click', () => {
      if(suppressClick){ suppressClick = false; return; }
      if(!input.canPlay()) return;
      input.onPick(dsp(i));
    });
    cellsEl.appendChild(d);
  }
  cellDivs = [...cellsEl.children];

  boardEl.addEventListener('pointerdown', e => {
    suppressClick = false;
    if(e.button > 0 || !input.canPlay()) return;
    const from = squareAt(e.clientX, e.clientY);
    if(from < 0) return;
    const st = game.bd[from];
    if(!st.length || owner(st) !== game.turn) return;
    drag = {id: e.pointerId, from, el: null, startX: e.clientX, startY: e.clientY,
            moved: false, dropEl: null};
  });

  boardEl.addEventListener('pointermove', e => {
    if(!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if(!drag.moved){
      if(Math.hypot(dx, dy) < DRAG_SLOP) return;
      drag.moved = true;
      if(game.sel !== drag.from) input.onPick(drag.from);
      drag.el = pcEl.querySelector('.pile[data-at="' + drag.from + '"]');
      if(drag.el) drag.el.classList.add('pile--drag');
      boardEl.classList.add('board--dragging');
      try{ boardEl.setPointerCapture(e.pointerId); }catch(err){}
    }
    e.preventDefault();
    if(drag.el) drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
    highlightDrop(squareAt(e.clientX, e.clientY));
  });

  boardEl.addEventListener('pointerup', e => {
    if(!drag || e.pointerId !== drag.id) return;
    const to = squareAt(e.clientX, e.clientY);
    const d = endDrag();
    if(!d.moved) return;
    suppressClick = true;
    if(to >= 0 && to !== d.from && isLegalTarget(to)) input.onPick(to);
    else render();
  });

  boardEl.addEventListener('pointercancel', e => {
    if(!drag || e.pointerId !== drag.id) return;
    const d = endDrag();
    if(d.moved){ suppressClick = true; render(); }
  });

  boardEl.addEventListener('dragstart', e => e.preventDefault());
}

export function clearPieces(){
  endDrag();
  pcEl.innerHTML = '';
  marksEl.innerHTML = '';
}

/* ---------- drawing ---------- */
export function render(){
  drawCells();
  drawMarks();
  drawStacks();
  drawPlayerBars();
  drawStatus();
  drawTrays();
  drawLog();
  drawOverlay();
}

function drawCells(){
  for(let i = 0; i < SZ; i++){
    const d = cellDivs[dsp(i)];
    let cls = 'cell ' + (((rowOf(i) + colOf(i)) % 2) ? 'dark' : 'lite');
    if(game.lastMove && (i === game.lastMove[0] || i === game.lastMove[1])) cls += ' last';
    if(i === game.sel) cls += ' sel';
    d.className = cls;
  }
}

/* A landing that takes a stack is worth shouting about, so the marker
   says how much it would flip. */
function drawMarks(){
  marksEl.innerHTML = '';
  if(game.sel < 0) return;
  for(const m of game.legal){
    cellDivs[dsp(m.to)].classList.add('pick');
    const s = document.createElement('div');
    s.className = 'mv' + (m.o === 'capture' ? ' mv--take' : m.o === 'merge' ? ' mv--merge' : '');
    s.style.left = (colOf(dsp(m.to)) * 100 / N) + '%';
    s.style.top  = (rowOf(dsp(m.to)) * 100 / N) + '%';
    if(m.o === 'move'){
      s.innerHTML = '<i class="dot0"></i>';
    }else{
      const gain = heightOf(game.bd[m.to]) + heightOf(game.bd[game.sel]);
      const spill = Math.max(0, gain - MAX_HEIGHT);
      s.innerHTML = '<i class="ring"></i><span class="tag">'
        + (spill ? '!' : heightOf(game.bd[m.to])) + '</span>';
    }
    marksEl.appendChild(s);
  }
  cellDivs[dsp(game.sel)].classList.add('pick');
}

/* Stacks are drawn bottom-first as offset discs. Height is the whole
   game — how far you reach, and how much you lose — so it has to be
   countable without clicking. */
function drawStacks(){
  pcEl.innerHTML = '';
  for(let i = 0; i < SZ; i++){
    const st = game.bd[i];
    if(!st.length) continue;
    const box = document.createElement('div');
    box.className = 'pile' + (i === game.sel ? ' pile--sel' : '');
    box.dataset.at = i;
    box.style.left = (colOf(dsp(i)) * 100 / N) + '%';
    box.style.top  = (rowOf(dsp(i)) * 100 / N) + '%';
    st.forEach((p, k) => {
      const d = document.createElement('i');
      d.className = 'disc ' + (p === BLUE ? 'b' : 'r') + (k === st.length - 1 ? ' top' : '');
      d.style.bottom = (k * 22) + '%';
      box.appendChild(d);
    });
    const h = document.createElement('span');
    h.className = 'pile__h';
    h.textContent = st.length;
    box.appendChild(h);
    pcEl.appendChild(box);
  }
}

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
    (side === BLUE ? 'Blue' : 'Red') + ' · ' + count(game.bd, side) + ' left'
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
      : (game.sel >= 0 ? 'A stack moves as far as it is tall' : 'Pick a stack');
  }
  $('ply').textContent = Math.ceil(game.ply / 2);
}

function drawTrays(){
  const pip = (arr, cls) => arr.map(() => '<span class="mini ' + cls + '"></span>').join('');
  $('lostB').innerHTML = pip(game.lostA, 'b');
  $('lostR').innerHTML = pip(game.lostB, 'r');
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
    const settled = net.state === 'finished' || net.state === 'aborted';
    btn.disabled = !!mine || !settled;
    btn.textContent = !settled ? 'Finishing…'
      : mine ? 'Waiting for them…'
      : offer ? 'Accept rematch'
      : 'Offer rematch';
  }
}

export function renderMpPanels(){
  const online = net.on;
  $('cardGame').style.display = online ? 'none' : '';
  $('mpIdle').style.display   = (!online && !net.queued) ? '' : 'none';
  $('mpQueue').style.display  = (!online && net.queued) ? '' : 'none';
  $('btnClaim').style.display = (online && net.abandonable) ? '' : 'none';
  $('mpLobby').style.display  = (online && !net.ready) ? '' : 'none';
  $('mpLive').style.display   = (online && net.ready) ? '' : 'none';
  $('cardChat').style.display = online ? '' : 'none';

  $('chatIn').disabled    = !net.ready;
  $('chatIn').placeholder = net.ready ? 'Message…' : 'Waiting for your friend…';

  /* The idle panel offers both a random ranked opponent and an invite
     link, so it cannot be called "Play a friend" — that named half of
     what is in it and left Play ranked looking misfiled. */
  const head = $('cardMp').querySelector('.eyebrow');
  if(head) head.textContent = online ? (net.rated ? 'Rated match' : 'Friendly match')
                                     : 'Play online';

  /* Ranked needs a real account. Say so on the button instead of
     letting the server refusal be the first anyone hears of it. */
  const ranked = $('btnRanked'), note = $('rankedNote');
  if(ranked && note){
    ranked.disabled = !net.canRank;
    note.textContent = net.canRank
      ? 'Random opponent, rating on the line.'
      : 'Sign in to play ranked. Game links work without an account.';
  }

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

export function renderChat(list){
  const box = $('chatLog');
  if(!box) return;
  box.innerHTML = (list || []).slice(-50).map(m =>
    '<div class="msg' + (m.mine ? ' me' : '') + (m.pending ? ' pending' : '') + '">'
    + '<span class="who ' + (m.side === BLUE ? 'b' : 'r') + '">' + esc(m.name || '?') + '</span>'
    + esc(m.body) + '</div>').join('');
  box.scrollTop = box.scrollHeight;
}
