/* ============================================================
   Salient: wiring. Local play and the computer opponent.
   ============================================================ */
import * as R from './rules.js';
import * as A from './ai.js';
import {game, on, reset, move, setBusy, undo} from './state.js';
import * as ui from './ui.js';

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

on('change', () => {
  ui.render();
  if(game.over){
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
const openRules  = () => rules.classList.add('modal--on');
const closeRules = () => rules.classList.remove('modal--on');
$('btnRules').onclick = openRules;
if($('btnRules2')) $('btnRules2').onclick = openRules;
$('rulesClose').onclick = closeRules;
rules.addEventListener('click', e => { if(e.target === rules) closeRules(); });

newGame();
