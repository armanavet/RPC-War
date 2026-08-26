/* ============================================================
   Cairn: wiring. The only module that knows about all the
   others — buttons to the game, the computer player, and local
   moves out to the match.
   ============================================================ */
import {BLUE, RED} from './rules.js';
import {bestMove, bestMoveTimed} from './ai.js';
import {game, on, reset, move, undo, clickSquare, setBusy} from './state.js';
import {net} from '../../net/session.js';
import * as ui from './ui.js';
import * as mp from './sync.js';
import * as profile from '../../site/profile.js';
import {mountAuthBar} from '../../site/authbar.js';
import {mountAds} from '../../site/ads.js';
import {startPresence} from '../../net/presence.js';

const SLUG = 'cairn';

/* ---------- computer player ---------- */
const aiEnabled = () => ui.$('aiOn').checked;

/* Cairn needs three plies to convert an advantage — at two the search
   shuffles and games run to the cap. Only Easy searches shallower, and
   that is the point of Easy. */
const LEVELS = {
  1: bd => bestMove(bd, RED, 2, true),
  2: bd => bestMoveTimed(bd, RED, 3, 900, false),
  3: bd => bestMoveTimed(bd, RED, 5, 2400, false),
};

function maybeAI(){
  if(game.over || net.on) return;
  if(!aiEnabled() || game.turn !== RED) return;
  setBusy(true);
  setTimeout(() => {
    const lv = parseInt(ui.$('level').value, 10);
    const mv = (LEVELS[lv] || LEVELS[2])(game.bd);
    game.busy = false;
    if(mv == null){
      game.over = {w: BLUE, why: 'no stack left to move'};
      ui.render();
      return;
    }
    move(mv);
  }, 200);
}

function newGame(){
  if(net.on) return;          // online games end on the server, not on a button
  reset();
  maybeAI();
}

/* ---------- results ---------- */
let recorded = false;

function maybeRecord(){
  if(!game.over || recorded) return;
  if(!net.on && !aiEnabled()) return;
  recorded = true;
  const me = net.on ? net.side : BLUE;
  profile.recordResult(SLUG,
    game.over.w === -1 ? 'draw' : game.over.w === me ? 'win' : 'loss');
}

/* ---------- game -> app ---------- */
on('reset', () => { recorded = false; ui.clearPieces(); });
on('change', () => { ui.render(); maybeRecord(); });
on('move', ({mv, fromNet}) => {
  if(net.on && !fromNet) mp.pushMove(mv);
  if(!game.over) maybeAI();
});

/* ---------- input ---------- */
const canPlay = () => {
  if(game.over || game.busy) return false;
  if(net.on) return net.ready && game.turn === net.side;
  return !(aiEnabled() && game.turn === RED);
};

ui.initBoard({canPlay, onPick: clickSquare});

const click = (id, fn) => { const el = ui.$(id); if(el) el.addEventListener('click', fn); };
click('btnNew', newGame);
click('overNew', newGame);
click('overRematch', mp.mpRematch);
click('overLeave', mp.mpLeave);
click('btnResign', () => {
  if(confirm('Resign this game? It counts as a loss.')) mp.mpResign();
});
click('btnUndo', () => {
  if(net.on) return;
  undo(aiEnabled() && game.hist.length > 1 ? 2 : 1);
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
mountAds();
newGame();
mp.autoJoinFromHash();

/* How many people are on this game's screen. Match presence is a
   different thing entirely and lives in matchsync.js. */
startPresence(SLUG, ({rooms}) => {
  const n = (rooms && rooms[SLUG]) || 0;
  const el = ui.$('liveHere');
  if(!el) return;
  el.textContent = n === 1 ? '1 here' : n + ' here';
  el.hidden = !n;
});
