/* ============================================================
   Breakthrough: wiring. Local play and the computer opponent.
   ============================================================ */
import * as R from './rules.js';
import * as A from './ai.js';
import {game, on, reset, move, setBusy, undo} from './state.js';
import * as ui from './ui.js';

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

on('change', () => {
  ui.render();
  if(game.over){
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
const open = () => rules.classList.add('modal--on');
const close = () => rules.classList.remove('modal--on');
$('btnRules').onclick = open;
if($('btnRules2')) $('btnRules2').onclick = open;
$('rulesClose').onclick = close;
rules.addEventListener('click', e => { if(e.target === rules) close(); });
newGame();
