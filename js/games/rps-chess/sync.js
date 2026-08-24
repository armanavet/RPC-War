/* ============================================================
   Online play for RPS Chess.

   The match row is the source of truth. We replay `moves` from
   index 0, so the two boards cannot drift apart — if what we hold
   locally is no longer a prefix of what the server holds, we throw
   our board away and replay theirs.

   Online play needs an account: play_move keys off auth.uid(), and
   that is what stops an opponent writing your moves for you.
   ============================================================ */
import {BLUE, RED} from './rules.js';
import {game, reset, move} from './state.js';
import {net, linkFor} from '../../net/session.js';
import {T, IS_MOCK} from '../../net/transport.js';
import * as auth from '../../net/auth.js';
import * as ui from './ui.js';
import * as profile from '../../site/profile.js';

const GAME = 'rps-chess';

let seatKey = '';          // so we only look names up when a seat changes
let chatRows = [];
let chatPending = [];
let finishing = false;     // one finish request per match, not one per render
let heartbeat = null;      // "I am still here", while a game is live
let queueTimer = null;     // polling find_match while we wait for an opponent

const HEARTBEAT_MS = 15000;
const QUEUE_POLL_MS = 2500;
const ABANDON_MS = 60000;

const myId = () => (T.me() || {}).id || null;

/* A guest's profile is born called "Guest 1A2B". If this browser already
   has a local name, use that instead so the opponent sees something human. */
async function adoptLocalName(){
  const s = auth.authState();
  if(!s.isGuest || !s.profile) return;
  const local = (profile.load().name || '').trim();
  if(local && local !== s.profile.display_name){
    try{ await auth.setDisplayName(local); }catch(e){}
  }
}

function fail(e){
  const msg = (e && e.message) || String(e);
  ui.mpErr(msg);
}

/* ---------- host ---------- */
export async function mpCreate(){
  try{
    ui.mpErr('');
    await T.init();
    await adoptLocalName();
    const m = await T.create(GAME);
    enterNet(m);
    history.replaceState(null, '', '#r=' + m.code);
  }catch(e){ fail(e); }
}

/* ---------- guest ---------- */
export async function mpJoin(code){
  try{
    ui.mpErr('');
    await T.init();
    await adoptLocalName();
    const m = await T.join(code);
    enterNet(m);
    history.replaceState(null, '', '#r=' + m.code);
  }catch(e){
    fail(e);
  }
}

function enterNet(m){
  net.on = true;
  net.matchId = m.id;
  net.code = m.code;
  net.me = myId();
  net.side = m.blue === myId() ? BLUE : RED;
  net.ready = !!m.red;
  net.names = ['', ''];
  net.ratings = [null, null];
  net.rated = !!m.rated;
  net.state = m.state;
  net.result = null;
  net.rematchOffer = null;
  net.delta = null;
  seatKey = '';
  chatRows = []; chatPending = [];
  finishing = false;

  ui.setFlip(net.side === RED);
  reset();
  ui.$('aiOn').checked = false;
  ui.setLink(linkFor(m.code));

  net.unwatch = T.watch(m.id, onMatch, onChat);
  startHeartbeat();
  ui.renderMpPanels();
  ui.render();
}

function startHeartbeat(){
  stopHeartbeat();
  const beat = () => { if(net.on && net.state === 'live') T.touch(net.matchId); };
  beat();
  heartbeat = setInterval(beat, HEARTBEAT_MS);
}
function stopHeartbeat(){ clearInterval(heartbeat); heartbeat = null; }

export function mpLeave(){
  if(net.unwatch){ try{ net.unwatch(); }catch(e){} }
  net.on = false; net.matchId = null; net.code = null;
  net.ready = false; net.names = ['', '']; net.unwatch = null;
  net.ratings = [null, null]; net.rated = false;
  net.state = null; net.result = null; net.rematchOffer = null; net.delta = null;
  seatKey = ''; chatRows = []; chatPending = []; finishing = false;
  stopHeartbeat();
  stopQueue();
  ui.setFlip(false);
  ui.renderChat([]);
  history.replaceState(null, '', location.pathname + location.search);
  ui.mpErr('');
  reset();
  ui.renderMpPanels();
}

/* Offer a rematch, or take one that is already on the table. Either way
   the old game stays on the record — a rematch is a new match, with the
   seats swapped so nobody keeps whatever moving first is worth. */
export async function mpRematch(){
  if(!net.on) return;
  try{
    ui.mpErr('');
    if(net.rematchOffer && net.rematchOffer !== myId()){
      const next = await T.acceptRematch(net.matchId);
      if(next) followMatch(next);
    }else{
      await T.offerRematch(net.matchId);
    }
  }catch(e){ fail(e); }
}

export async function mpResign(){
  if(!net.on || !net.ready) return;
  try{ ui.mpErr(''); await T.resign(net.matchId); }catch(e){ fail(e); }
}

/* The opponent accepted: both clients follow next_match to the new row. */
function followMatch(m){
  if(net.unwatch){ try{ net.unwatch(); }catch(e){} }
  net.unwatch = null;
  enterNet(m);
}

export function mpCopy(){
  const i = ui.$('mpLink');
  i.select();
  (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject())
    .catch(() => { try{ document.execCommand('copy'); }catch(e){} })
    .finally(ui.flashCopied);
}

/* Called by main.js when a local move is played. */
export async function pushMove(mv){
  try{
    await T.playMove(net.matchId, mv);
  }catch(e){
    // the server refused it — our board is now ahead of the truth
    fail(e);
    try{ onMatch(await T.get(net.matchId)); }catch(_){}
  }
}

/* ---------- incoming ---------- */
async function refreshNames(m){
  const key = (m.blue || '') + '|' + (m.red || '');
  if(key === seatKey) return;
  seatKey = key;
  try{
    const p = await T.players(m);
    const nameOf = x => x ? (x.display_name || x.handle) : '';
    net.names[BLUE] = nameOf(p.blue);
    net.names[RED] = nameOf(p.red);
    const r = await T.ratings([m.blue, m.red].filter(Boolean), m.game);
    net.ratings[BLUE] = r[m.blue] ?? null;
    net.ratings[RED] = r[m.red] ?? null;
    ui.render();
  }catch(e){ /* names are cosmetic; the game still works */ }
}

function onMatch(m, presence){
  if(!m || !net.on) return;
  if(presence) notePresence(m, presence);

  // a rematch was accepted — both clients move to the new match
  if(m.next_match && m.next_match !== net.matchId){
    T.get(m.next_match).then(next => { if(next) followMatch(next); }).catch(() => {});
    return;
  }

  net.code = m.code;
  net.me = myId();
  net.side = m.blue === myId() ? BLUE : RED;
  net.ready = !!m.red;
  net.rated = !!m.rated;
  net.state = m.state;
  net.result = m.result || null;
  net.rematchOffer = m.rematch_offer || null;
  net.delta = net.side === BLUE ? (m.blue_delta ?? null) : (m.red_delta ?? null);
  ui.setFlip(net.side === RED);
  refreshNames(m);

  const rm = m.moves || [];
  const ours = game.moveList;
  const prefixOk = rm.length >= ours.length && ours.every((x, i) => rm[i] === x);
  if(!prefixOk){
    reset();
    for(const mv of rm) move(mv, true);
  }else{
    for(let k = ours.length; k < rm.length; k++) move(rm[k], true);
  }

  // The server decides results, not us. When our board says the game is
  // over but the row is still live, ask it to check for itself.
  if(game.over && m.state === 'live' && !finishing){
    finishing = true;
    // Let go of the latch on failure, or one dropped request strands the
    // match as `live` for good — the safety poll re-enters here and retries.
    T.finish(m.id).catch(e => { finishing = false; fail(e); });
  }
  // a result the server reached without us (resignation, or their client
  // got there first) still has to end the game on this screen
  if(m.state === 'finished' && !game.over && m.result){
    game.over = {
      w: m.result === 'draw' ? -1 : (m.result === 'blue' ? BLUE : RED),
      why: reasonText(m.reason),
    };
  }

  ui.renderMpPanels();
  ui.render();
}

/* How long has the other side been quiet? The server checks this again
   before it awards anything — this only decides whether to offer the
   button. */
function notePresence(m, seen){
  const opp = m.blue === myId() ? m.red : m.blue;
  if(!opp){ net.abandonable = false; return; }
  const last = seen[opp] || 0;
  net.abandonable = m.state === 'live' && last > 0 && (Date.now() - last) > ABANDON_MS;
}

export async function mpClaimAbandon(){
  if(!net.on) return;
  try{ ui.mpErr(''); await T.claimAbandon(net.matchId); }catch(e){ fail(e); }
}

/* ---------- ranked queue ---------- */
export async function mpFindMatch(){
  if(net.on) return;
  try{
    ui.mpErr('');
    await T.init();
    net.queued = true;
    ui.renderMpPanels();
    const tick = async () => {
      try{
        const id = await T.findMatch(GAME) || await T.myLiveMatch(GAME);
        if(id){
          stopQueue();
          net.queued = false;
          const m = await T.get(id);
          if(m) enterNet(m);
        }
      }catch(e){ stopQueue(); net.queued = false; fail(e); ui.renderMpPanels(); }
    };
    await tick();
    if(net.queued) queueTimer = setInterval(tick, QUEUE_POLL_MS);
  }catch(e){
    net.queued = false;
    fail(e);
    ui.renderMpPanels();
  }
}

export async function mpLeaveQueue(){
  stopQueue();
  net.queued = false;
  try{ await T.leaveQueue(); }catch(e){}
  ui.renderMpPanels();
}

function stopQueue(){ clearInterval(queueTimer); queueTimer = null; }

const REASONS = {
  backrow: 'reached the back row',
  wipeout: 'no pieces left',
  nomoves: 'no legal moves',
  resign:  'resigned',
  invalid: 'an illegal move was played',
  abandon: 'abandoned the game',
};
const reasonText = r => REASONS[r] || r || '';

/* ---------- chat ---------- */
function onChat(rows){
  chatRows = rows || [];
  // drop optimistic copies the server has now echoed back
  const seen = {};
  for(const r of chatRows){ const k = r.author + '|' + r.body; seen[k] = (seen[k] || 0) + 1; }
  chatPending = chatPending.filter(p => {
    const k = p.author + '|' + p.body;
    if(seen[k] > 0){ seen[k]--; return false; }
    return true;
  });
  paintChat();
}

function paintChat(){
  const me = myId();
  const sideOf = a => a === me ? net.side : 1 - net.side;
  const nameOf = a => net.names[sideOf(a)] || (a === me ? 'You' : 'Opponent');
  const rows = chatRows.concat(chatPending.map(p => ({...p, pending: true})));
  ui.renderChat(rows.map(r => ({
    name: nameOf(r.author),
    side: sideOf(r.author),
    mine: r.author === me,
    body: r.body,
    pending: !!r.pending,
  })));
}

export async function sendChat(){
  const inp = ui.$('chatIn');
  const body = inp.value.trim().slice(0, 200);
  if(!body || !net.on || !net.ready) return;
  inp.value = '';
  const optimistic = {author: myId(), body};
  chatPending.push(optimistic);
  paintChat();
  try{
    await T.sendChat(net.matchId, body);
  }catch(e){
    chatPending = chatPending.filter(p => p !== optimistic);
    paintChat();
    ui.mpErr('Message not sent: ' + ((e && e.message) || e));
  }
}

/* ---------- invite links ---------- */
const codeInHash = () => {
  const m = location.hash.match(/^#r=([A-Z0-9]{4,10})$/i);
  return m ? m[1].toUpperCase() : null;
};

/* A link opened while signed out has to survive the OAuth round trip —
   the hash never reaches the provider, so stash the code instead. */
export function autoJoinFromHash(){
  const code = codeInHash();
  if(!code) return;
  // no account needed: T.init() opens a guest session if there isn't one
  mpJoin(code);
}

