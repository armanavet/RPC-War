/* ============================================================
   Wiring. This is the only module that knows about all the others:
   it connects the buttons to the game, drives the computer player,
   and forwards local moves to the online room.
   ============================================================ */
import {BLUE, RED} from './rules.js';
import {bestMove, bestMoveTimed} from './ai.js';
import {game, on, reset, move, undo, clickSquare, setBusy} from './state.js';
import {net} from '../../net/session.js';
import * as ui from './ui.js';
import * as mp from './sync.js';
import * as profile from '../../site/profile.js';
import {mountAuthBar} from '../../site/authbar.js';
import {startPresence} from '../../net/presence.js';
import {mountAds} from '../../site/ads.js';

/* ---------- computer player ---------- */
const aiEnabled = () => ui.$('aiOn').checked;

const LEVELS = {
  1: bd => bestMove(bd, RED, 2, true),
  2: bd => bestMoveTimed(bd, RED, 4, 700, false),
  3: bd => bestMoveTimed(bd, RED, 9, 2200, false),
};

function maybeAI(){
  if(game.over || net.on) return;
  if(!aiEnabled() || game.turn !== RED) return;
  setBusy(true);
  // let the browser paint the human's move before we start thinking
  setTimeout(() => {
    const lv = parseInt(ui.$('level').value, 10);
    const mv = (LEVELS[lv] || LEVELS[2])(game.bd);
    game.busy = false;
    if(mv == null){
      game.over = {w: BLUE, why: 'red cannot move'};
      ui.render();
      return;
    }
    move(mv);
  }, 230);
}

/* ---------- new game ---------- */
function newGame(){
  if(net.on) return;      // online games end on the server, not on a button
  reset();
  maybeAI();
}

/* ---------- results ---------- */
/* Only games with a real opponent count, and only once each — 'change'
   fires many times per move. Hot-seat games between two people sharing
   one screen are not recorded against anyone. */
let recorded = false;

function maybeRecord(){
  if(!game.over || recorded) return;
  if(!net.on && !aiEnabled()) return;
  recorded = true;
  const me = net.on ? net.side : BLUE;
  profile.recordResult('rps-chess',
    game.over.w === -1 ? 'draw' : game.over.w === me ? 'win' : 'loss');
}

/* ---------- game -> app reactions ---------- */
on('reset', () => { recorded = false; ui.clearPieces(); });
on('change', () => { ui.render(); maybeRecord(); });
on('move', ({mv, fromNet}) => {
  if(net.on && !fromNet) mp.pushMove(mv);
  if(!game.over) maybeAI();
});

/* ---------- input ---------- */
/* One guard, shared by clicking and dragging. */
const canPlay = () => {
  if(game.over || game.busy) return false;
  if(net.on) return net.ready && game.turn === net.side;
  return !(aiEnabled() && game.turn === RED);
};

ui.initBoard({canPlay, onPick: clickSquare});

const click = (id, fn) => ui.$(id).addEventListener('click', fn);
click('btnNew', newGame);
click('overNew', newGame);
click('overRematch', mp.mpRematch);
click('overLeave', mp.mpLeave);
click('btnResign', () => {
  if(confirm('Resign this game? It counts as a loss.')) mp.mpResign();
});
click('btnUndo', () => {
  if(net.on) return;                              // online games replay from the server
  undo(aiEnabled() && game.hist.length > 1 ? 2 : 1);   // step back over the computer's reply too
});
click('btnCreate', mp.mpCreate);
click('btnRanked', mp.mpFindMatch);
click('btnLeaveQueue', mp.mpLeaveQueue);
click('btnClaim', mp.mpClaimAbandon);
click('mpCopyBtn', mp.mpCopy);
click('btnCancelLobby', mp.mpLeave);
click('btnLeave', mp.mpLeave);
click('btnSendChat', mp.sendChat);

/* rules live in a modal, opened from the top bar or the footer */
const rules = ui.$('rulesModal');
const openRules = () => rules.classList.add('on');
const closeRules = () => rules.classList.remove('on');
click('btnRules', openRules);
click('btnRules2', openRules);
click('rulesClose', closeRules);
rules.addEventListener('click', e => { if(e.target === rules) closeRules(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeRules(); });

ui.$('mpLink').addEventListener('click', e => e.target.select());
ui.$('chatIn').addEventListener('keydown', e => { if(e.key === 'Enter') mp.sendChat(); });
ui.$('aiOn').addEventListener('change', () => { if(!game.over) maybeAI(); });

/* ---------- go ---------- */
mountAuthBar();

/* "3 here" — everyone on this screen, not just the two in this match.
   Match presence is a different thing entirely and lives in sync.js. */
startPresence('rps-chess', ({rooms}) => {
  const n = (rooms && rooms['rps-chess']) || 0;
  const el = ui.$('liveHere');
  if(!el) return;
  el.textContent = n === 1 ? '1 here' : `${n} here`;
  el.hidden = !n;
});
newGame();
mp.autoJoinFromHash();
mountAds();
