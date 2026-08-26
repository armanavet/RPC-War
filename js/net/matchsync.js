/* ============================================================
   Online play, for any game on the site.

   The match row is the source of truth. Both clients replay `moves`
   from index 0, so two boards cannot drift apart — if what we hold
   locally genuinely disagrees with the server, we throw our board
   away and replay theirs.

   Nothing in here knows what a move means. A game supplies an
   adapter and gets back the whole online surface:

     const mp = createSync({slug, state, ui});
     mp.mpCreate(); mp.pushMove(mv); mp.sendChat(); ...

   The adapter:
     slug     the game's catalogue slug, e.g. 'rps-chess'
     state    {game, reset, move} — `game` exposes .over and .moveList
     ui       the game's ui module; see UI CONTRACT below
     reasons  optional extra end-reason wording

   UI CONTRACT — a game's ui module must export:
     $, render, renderMpPanels, renderChat, setFlip,
     setLink, flashCopied, mpErr

   Seats are 0 and 1 throughout. A game may call them whatever it
   likes; here seat 0 is the one the server calls `blue`.
   ============================================================ */
import {net, linkFor} from './session.js';
import {T} from './transport.js';
import * as auth from './auth.js';
import * as profile from '../site/profile.js';

const HEARTBEAT_MS = 15000;
const QUEUE_POLL_MS = 2500;
const ABANDON_MS = 60000;

const SEAT_A = 0, SEAT_B = 1;

const BASE_REASONS = {
  wipeout: 'no pieces left',
  nomoves: 'no legal moves',
  resign:  'resigned',
  invalid: 'an illegal move was played',
  abandon: 'abandoned the game',
};

export function createSync({slug, state, ui, reasons}){
  const {game, reset, move} = state;
  const REASONS = {...BASE_REASONS, ...(reasons || {})};
  const reasonText = r => REASONS[r] || r || '';

  let seatKey = '';        // only look names up when a seat actually changes
  let chatRows = [];
  let chatPending = [];
  let finishing = false;   // one finish request per match, not one per render
  let heartbeat = null;
  let queueTimer = null;

  const myId = () => (T.me() || {}).id || null;
  const fail = e => ui.mpErr((e && e.message) || String(e));

  /* A guest's profile is born called "Guest 1A2B". If this browser already
     has a local name, use that so the opponent sees something human. */
  async function adoptLocalName(){
    const s = auth.authState();
    if(!s.isGuest || !s.profile) return;
    const local = (profile.load().name || '').trim();
    if(local && local !== s.profile.display_name){
      try{ await auth.setDisplayName(local); }catch(e){}
    }
  }

  /* ---------- entering and leaving ---------- */
  function enterNet(m){
    net.on = true;
    net.matchId = m.id;
    net.code = m.code;
    net.me = myId();
    net.side = m.blue === myId() ? SEAT_A : SEAT_B;
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

    ui.setFlip(net.side === SEAT_B);
    reset();
    const ai = ui.$('aiOn');
    if(ai) ai.checked = false;
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
  function stopQueue(){ clearInterval(queueTimer); queueTimer = null; }

  /* The opponent accepted a rematch: both clients follow to the new row. */
  function followMatch(m){
    if(net.unwatch){ try{ net.unwatch(); }catch(e){} }
    net.unwatch = null;
    enterNet(m);
  }

  /* ---------- incoming ---------- */
  async function refreshNames(m){
    const key = (m.blue || '') + '|' + (m.red || '');
    if(key === seatKey) return;
    seatKey = key;
    try{
      const p = await T.players(m);
      const nameOf = x => x ? (x.display_name || x.handle) : '';
      net.names[SEAT_A] = nameOf(p.blue);
      net.names[SEAT_B] = nameOf(p.red);
      const r = await T.ratings([m.blue, m.red].filter(Boolean), m.game);
      net.ratings[SEAT_A] = r[m.blue] ?? null;
      net.ratings[SEAT_B] = r[m.red] ?? null;
      ui.render();
    }catch(e){ /* names are cosmetic; the game still works */ }
  }

  function onMatch(m, presence){
    if(!m || !net.on) return;
    if(presence) notePresence(m, presence);

    if(m.next_match && m.next_match !== net.matchId){
      T.get(m.next_match).then(next => { if(next) followMatch(next); }).catch(() => {});
      return;
    }

    net.code = m.code;
    net.me = myId();
    net.side = m.blue === myId() ? SEAT_A : SEAT_B;
    net.ready = !!m.red;
    net.rated = !!m.rated;
    net.state = m.state;
    net.result = m.result || null;
    net.rematchOffer = m.rematch_offer || null;
    net.delta = net.side === SEAT_A ? (m.blue_delta ?? null) : (m.red_delta ?? null);
    ui.setFlip(net.side === SEAT_B);
    refreshNames(m);

    const rm = m.moves || [];
    const ours = game.moveList;

    /* Three cases, and only one is a resync. A row *shorter* than our board
       but agreeing as far as it goes is simply stale — our own move has not
       been echoed back yet. Rebuilding on that visibly rewinds the board
       until the next update undoes the rewind. Only genuine disagreement is
       worth throwing our board away. */
    const shared = Math.min(rm.length, ours.length);
    let diverged = false;
    for(let i = 0; i < shared; i++){
      if(rm[i] !== ours[i]){ diverged = true; break; }
    }

    if(diverged){
      reset();
      for(const mv of rm) move(mv, true);
    }else if(rm.length > ours.length){
      for(let k = ours.length; k < rm.length; k++) move(rm[k], true);
    }

    /* The server decides results, not us. When our board says the game is
       over but the row is still live, ask it to check for itself. */
    if(game.over && m.state === 'live' && !finishing){
      finishing = true;
      // Let go of the latch on failure, or one dropped request strands the
      // match as `live` for good — the safety poll re-enters here and retries.
      T.finish(m.id).catch(e => { finishing = false; fail(e); });
    }
    /* A result the server reached without us (resignation, or their client
       got there first) still has to end the game on this screen. */
    if(m.state === 'finished' && !game.over && m.result){
      game.over = {
        w: m.result === 'draw' ? -1 : (m.result === 'blue' ? SEAT_A : SEAT_B),
        why: reasonText(m.reason),
      };
    }

    ui.renderMpPanels();
    ui.render();
  }

  /* How long has the other side been quiet? The server checks this again
     before awarding anything — this only decides whether to offer the button. */
  function notePresence(m, seen){
    const opp = m.blue === myId() ? m.red : m.blue;
    if(!opp){ net.abandonable = false; return; }
    const last = seen[opp] || 0;
    net.abandonable = m.state === 'live' && last > 0 && (Date.now() - last) > ABANDON_MS;
  }

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

  const codeInHash = () => {
    const m = location.hash.match(/^#r=([A-Z0-9]{4,10})$/i);
    return m ? m[1].toUpperCase() : null;
  };

  async function mpJoin(code){
    try{
      ui.mpErr('');
      await T.init();
      await adoptLocalName();
      const m = await T.join(code);
      enterNet(m);
      history.replaceState(null, '', '#r=' + m.code);
    }catch(e){ fail(e); }
  }

  /* ---------- the surface a game gets ---------- */
  return {
    async mpCreate(){
      try{
        ui.mpErr('');
        await T.init();
        await adoptLocalName();
        const m = await T.create(slug);
        enterNet(m);
        history.replaceState(null, '', '#r=' + m.code);
      }catch(e){ fail(e); }
    },

    mpJoin,

    mpLeave(){
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
    },

    /* Offer a rematch, or take one already on the table. Either way the old
       game stays on the record — a rematch is a new match with swapped seats. */
    async mpRematch(){
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
    },

    async mpResign(){
      if(!net.on || !net.ready) return;
      try{ ui.mpErr(''); await T.resign(net.matchId); }catch(e){ fail(e); }
    },

    async mpClaimAbandon(){
      if(!net.on) return;
      try{ ui.mpErr(''); await T.claimAbandon(net.matchId); }catch(e){ fail(e); }
    },

    mpCopy(){
      const i = ui.$('mpLink');
      i.select();
      (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject())
        .catch(() => { try{ document.execCommand('copy'); }catch(e){} })
        .finally(ui.flashCopied);
    },

    /* Called when a local move is played. */
    async pushMove(mv){
      try{
        await T.playMove(net.matchId, mv);
      }catch(e){
        // the server refused it — our board is now ahead of the truth
        fail(e);
        try{ onMatch(await T.get(net.matchId)); }catch(_){}
      }
    },

    /* ---------- ranked queue ---------- */
    async mpFindMatch(){
      if(net.on) return;
      try{
        ui.mpErr('');
        await T.init();
        net.queued = true;
        ui.renderMpPanels();
        const tick = async () => {
          try{
            const id = await T.findMatch(slug) || await T.myLiveMatch(slug);
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
    },

    async mpLeaveQueue(){
      stopQueue();
      net.queued = false;
      try{ await T.leaveQueue(); }catch(e){}
      ui.renderMpPanels();
    },

    async sendChat(){
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
    },

    /* A link opened while signed out has to survive the OAuth round trip —
       the hash never reaches the provider. T.init() opens a guest session,
       so no account is needed and nothing has to be stashed. */
    autoJoinFromHash(){
      const code = codeInHash();
      if(code) mpJoin(code);
    },
  };
}
