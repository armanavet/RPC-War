/* ============================================================
   Tideline: wiring. Local play and the computer opponent.
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

const SLUG = 'tideline';

const $ = ui.$;
const LEVELS = {
  1: {depth: 2, ms: 90,  sloppy: true},
  2: {depth: 4, ms: 240, sloppy: false},
  3: {depth: 5, ms: 650, sloppy: false},
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
    ui.showOver(w === -1 ? 'Draw'
      : (w === R.BLUE ? '<span class="side-b">Blue wins</span>'
                      : '<span class="side-r">Red wins</span>'), game.over.why);
  }else ui.hideOver();
});
on('move', () => setTimeout(think, 10));

function newGame(){ reset(); ui.hideOver(); setTimeout(think, 30); }
ui.initBoard({canPlay});
$('btnNew').onclick = newGame;
$('overNew').onclick = newGame;
$('btnUndo').onclick = () => undo(aiOn() ? 2 : 1);
$('aiOn').onchange = () => think();

const rules = $('rulesModal');
const open = () => rules.classList.add('on');
const close = () => rules.classList.remove('on');
$('btnRules').onclick = open;
if($('btnRules2')) $('btnRules2').onclick = open;
$('rulesClose').onclick = close;
rules.addEventListener('click', e => { if(e.target === rules) close(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') close(); });
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
