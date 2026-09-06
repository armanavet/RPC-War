/* ============================================================
   Salient: wiring. Local play and the computer opponent.
   ============================================================ */
import * as R from './rules.js';
import * as A from './ai.js';
import {game, on, reset, move, setBusy, undo} from './state.js';
import * as ui from './ui.js';
import * as profile from '../../site/profile.js';
import {mountAuthBar} from '../../site/authbar.js';
import {mountRailTabs} from '../../site/railtabs.js';
import {mountAds} from '../../site/ads.js';
import {startPresence} from '../../net/presence.js';

const SLUG = 'salient';

const $ = ui.$;

/* Budgets are short on purpose. This is a long game and the player
   should never be waiting on the machine; the search is pruned hard
   enough that a fifth of a second still reaches four plies. */
const LEVELS = {
  1: {depth: 2, ms: 90,  sloppy: true},
  2: {depth: 4, ms: 220, sloppy: false},
  3: {depth: 5, ms: 600, sloppy: false},
};

const aiOn  = () => $('aiOn').checked;
const level = () => LEVELS[$('level').value] || LEVELS[2];
const HUMAN = R.BLUE;

function canPlay(){
  if(game.over || game.busy) return false;
  if(aiOn() && game.st.turn !== HUMAN) return false;
  return true;
}

function think(){
  if(game.over || game.busy) return;
  if(!aiOn() || game.st.turn === HUMAN) return;
  setBusy(true);
  /* Off the paint frame, so the board shows the player's own move
     before the machine starts chewing on the reply. */
  setTimeout(() => {
    const cfg = level();
    let mv = null;
    try{ mv = A.bestMoveTimed(game.st, cfg.depth, cfg.ms, cfg.sloppy); }
    finally{ setBusy(false); }
    if(mv != null && !game.over) move(mv);
  }, 40);
}

let counted = false;

on('reset', () => { counted = false; });

on('change', () => {
  ui.render();
  if(game.over){
    /* Once per game, not once per repaint — 'change' fires on every
       redraw and the first version would have logged a win per frame. */
    if(!counted){
      counted = true;
      const me = R.BLUE;
      profile.recordResult(SLUG,
        game.over.w === -1 ? 'draw' : (game.over.w === me ? 'win' : 'loss'));
    }
    const w = game.over.w;
    ui.showOver(
      w === -1 ? 'Draw'
               : (w === R.BLUE ? '<span class="side-b">Blue wins</span>'
                               : '<span class="side-r">Red wins</span>'),
      game.over.why);
  }else{
    ui.hideOver();
  }
});

on('move', () => setTimeout(think, 10));

function newGame(){
  reset();
  ui.hideOver();
  setTimeout(think, 30);
}

ui.initBoard({canPlay});

$('btnNew').onclick  = newGame;
$('overNew').onclick = newGame;
$('btnUndo').onclick = () => undo(aiOn() ? 2 : 1);
$('aiOn').onchange   = () => think();

const rules = $('rulesModal');
const openRules  = () => rules.classList.add('on');
const closeRules = () => rules.classList.remove('on');
$('btnRules').onclick = openRules;
if($('btnRules2')) $('btnRules2').onclick = openRules;
$('rulesClose').onclick = closeRules;
rules.addEventListener('click', e => { if(e.target === rules) closeRules(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeRules(); });

/* ---------- go ----------
   The sign-in chip, the phone rail tabs, the ad slot and the online
   counter are all mounted by the page, exactly as the two older games
   do it. These four were missing every one of them — which is why a
   signed-in player still saw a Sign in button up there. */
mountAuthBar();
mountRailTabs();
mountAds();
newGame();

/* How many people are on this game's screen. */
startPresence(SLUG, ({rooms}) => {
  const n = (rooms && rooms[SLUG]) || 0;
  const el = $('liveHere');
  if(!el) return;
  el.textContent = n === 1 ? '1 here' : n + ' here';
  el.hidden = !n;
});
