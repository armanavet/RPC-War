/* ============================================================
   Online transport. A match row is the source of truth: both
   clients replay `moves` from index 0, so the two boards cannot
   drift apart.

   Two interchangeable implementations behind one interface:
     SupaT  Supabase — RPCs for every write, Realtime for updates
     MockT  same-browser stand-in (?mock=1), no backend at all

   Interface:
     init()                              throws if unusable
     me()                          ->    {id, handle, display_name} | null
     create(game)                  ->    match
     join(code)                    ->    match
     get(matchId)                  ->    match
     playMove(matchId, mv)
     nudge(matchId)                      fire and forget, no-op vs a human
     rematch(matchId)
     sendChat(matchId, body)
     players(match)                ->    {blue, red} profiles
     watch(matchId, onMatch, onChat) ->  unsubscribe
   ============================================================ */
import {MOCK} from './config.js';
import {authState, ensureSession} from './auth.js';

const MATCH_COLS = 'id,code,game,blue,red,rated,state,moves,result,reason,'
  + 'rematch_offer,next_match,blue_delta,red_delta';

/* how often to re-read as insurance against a dropped websocket */
const SAFETY_POLL_MS = 10000;

const SupaT = {
  _sb: null,
  async init(){
    if(!this._sb) this._sb = (await import('./supabase.js')).sb;
    await ensureSession();          // signs in as a guest if need be
    return this._sb;
  },

  me(){
    const p = authState().profile;
    return p ? {id: p.id, handle: p.handle, display_name: p.display_name} : null;
  },

  async _rpc(fn, args){
    const sb = await this.init();
    const {data, error} = await sb.rpc(fn, args);
    if(error) throw new Error(error.message);
    return data;
  },

  async create(game){ return this._rpc('create_match', {p_game: game}); },
  async join(code){   return this._rpc('join_match', {p_code: String(code).toUpperCase()}); },
  async playMove(matchId, mv){ await this._rpc('play_move', {p_match: matchId, p_move: mv}); },
  async resign(matchId){       await this._rpc('resign', {p_match: matchId}); },
  async offerRematch(matchId){ await this._rpc('offer_rematch', {p_match: matchId}); },
  async acceptRematch(matchId){ return this._rpc('accept_rematch', {p_match: matchId}); },
  async sendChat(matchId, body){ await this._rpc('send_chat', {p_match: matchId, p_body: body}); },

  /* Ask the server to settle the game. It replays the moves itself and
     ignores whatever we think the result was. */
  async finish(matchId){
    const sb = await this.init();
    const {data: {session}} = await sb.auth.getSession();
    const {data, error} = await sb.functions.invoke('finish-match', {
      body: {matchId},
      headers: session ? {Authorization: 'Bearer ' + session.access_token} : {},
    });
    /* supabase-js reports every non-2xx as the same sentence and hides the
       function's own message on error.context, which is the unread Response.
       Unwrap it, or a 409 and a 500 are indistinguishable on screen. */
    if(error){
      const res = error.context;
      if(res && typeof res.text === 'function'){
        let body = '';
        try{ body = await res.text(); }catch(e){}
        let msg = body;
        try{ msg = JSON.parse(body).error || body; }catch(e){}
        throw new Error(`finish-match ${res.status}: ${msg || error.message}`);
      }
      throw new Error(error.message);
    }
    return data;
  },

  /* Ask the server to take the opponent's turn if the opponent is not a
     person. Fired in *every* match, including human ones, where it does
     nothing — a request that only went out in some games would itself be
     the giveaway. Never awaited by the caller and never surfaces an
     error: it must not be able to slow a move down or show a message. */
  nudge(matchId){
    this.init()
      .then(sb => sb.auth.getSession().then(({data: {session}}) =>
        sb.functions.invoke('bot-move', {
          body: {matchId},
          headers: session ? {Authorization: 'Bearer ' + session.access_token} : {},
        })))
      .catch(() => {});
  },

  async touch(matchId){ try{ await this._rpc('touch_match', {p_match: matchId}); }catch(e){} },
  async claimAbandon(matchId){ await this._rpc('claim_abandon', {p_match: matchId}); },
  async findMatch(game){    return this._rpc('find_match', {p_game: game}); },
  async leaveQueue(){       await this._rpc('leave_queue', {}); },
  async myLiveMatch(game){  return this._rpc('my_live_match', {p_game: game}); },

  /* When did each side last say they were here? */
  async presence(matchId){
    const sb = await this.init();
    const {data} = await sb.from('match_presence').select('user_id,seen_at').eq('match_id', matchId);
    const by = {};
    for(const r of (data || [])) by[r.user_id] = Date.parse(r.seen_at);
    return by;
  },

  async ratings(ids, game){
    if(!ids.length) return {};
    const sb = await this.init();
    const {data} = await sb.from('ratings').select('user_id,rating').in('user_id', ids).eq('game', game);
    const by = {};
    for(const r of (data || [])) by[r.user_id] = r.rating;
    return by;
  },

  async get(matchId){
    const sb = await this.init();
    const {data, error} = await sb.from('matches').select(MATCH_COLS).eq('id', matchId).maybeSingle();
    if(error) throw new Error(error.message);
    return data;
  },

  async chat(matchId){
    const sb = await this.init();
    const {data, error} = await sb.from('match_chat')
      .select('id,author,body').eq('match_id', matchId).order('id');
    if(error) throw new Error(error.message);
    return data || [];
  },

  /* Realtime carries only the match row, so names are looked up separately
     and only when a seat actually changes. */
  async players(match){
    const ids = [match.blue, match.red].filter(Boolean);
    if(!ids.length) return {};
    const sb = await this.init();
    const {data} = await sb.from('profiles').select('id,handle,display_name').in('id', ids);
    const by = {};
    for(const p of (data || [])) by[p.id] = p;
    return {blue: by[match.blue] || null, red: by[match.red] || null};
  },

  watch(matchId, onMatch, onChat){
    let stopped = false;
    let channel = null;
    let timer = null;

    const refetch = async () => {
      if(stopped) return;
      try{
        const [m, c] = await Promise.all([this.get(matchId), this.chat(matchId)]);
        if(!stopped && m){ onMatch(m); onChat(c); }
      }catch(e){ /* transient; the next tick tries again */ }
    };

    (async () => {
      const sb = await this.init();
      if(stopped) return;
      channel = sb.channel('match:' + matchId)
        .on('postgres_changes',
            {event: '*', schema: 'public', table: 'matches', filter: 'id=eq.' + matchId},
            payload => { if(payload.new) onMatch(payload.new); })
        .on('postgres_changes',
            {event: 'INSERT', schema: 'public', table: 'match_chat', filter: 'match_id=eq.' + matchId},
            () => { this.chat(matchId).then(onChat).catch(() => {}); })
        .subscribe();
      await refetch();
      // websockets drop. A slow re-read costs ~6 requests a minute and
      // guarantees we converge even if the socket dies quietly.
      timer = setInterval(refetch, SAFETY_POLL_MS);
    })();

    return () => {
      stopped = true;
      clearInterval(timer);
      if(channel && this._sb) this._sb.removeChannel(channel);
    };
  },
};

/* ------------------------------------------------------------
   MockT — the whole flow in two tabs, no backend.

   Identity lives in sessionStorage, which is per-tab, so two tabs
   of one browser are two different players.
   ------------------------------------------------------------ */
const MockT = {
  _bc: null,
  _subs: [],

  async init(){
    if(!this._bc){
      this._bc = new BroadcastChannel('oddboard-mock');
      this._bc.addEventListener('message', e => {
        for(const s of this._subs) if(s.id === e.data.id) s.fire();
      });
    }
    return true;
  },

  me(){
    let id = sessionStorage.getItem('mock.uid');
    if(!id){
      id = 'mock-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('mock.uid', id);
    }
    const n = 'Player ' + id.slice(-4).toUpperCase();
    return {id, handle: id.slice(-8), display_name: n};
  },

  _key: id => 'oddboard.mock.match.' + id,
  _read(id){ try{ return JSON.parse(localStorage.getItem(this._key(id))); }catch(e){ return null; } },
  _write(m){
    localStorage.setItem(this._key(m.id), JSON.stringify(m));
    this._bc.postMessage({id: m.id});
    for(const s of this._subs) if(s.id === m.id) s.fire();   // BroadcastChannel skips the sender
  },

  async create(game){
    await this.init();
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = ''; for(let i = 0; i < 6; i++) code += A[(Math.random() * A.length) | 0];
    const m = {id: 'm-' + code, code, game, blue: this.me().id, red: null,
               rated: false, state: 'lobby', moves: [], result: null, reason: null,
               _names: {[this.me().id]: this.me()}, _chat: []};
    this._write(m);
    return m;
  },

  async join(code){
    await this.init();
    const m = this._read('m-' + String(code).toUpperCase());
    if(!m) throw new Error('no such game');
    const me = this.me();
    if(m.blue === me.id || m.red === me.id) return m;
    if(m.red) throw new Error('that game is full');
    m.red = me.id; m.state = 'live'; m._names[me.id] = me;
    this._write(m);
    return m;
  },

  async get(id){ return this._read(id); },
  async chat(id){ const m = this._read(id); return m ? m._chat : []; },

  async playMove(id, mv){
    const m = this._read(id);
    if(!m || m.state !== 'live') throw new Error('match is not live');
    const seat = m.blue === this.me().id ? 0 : m.red === this.me().id ? 1 : null;
    if(seat === null) throw new Error('you are not in this match');
    if((m.moves.length % 2) !== seat) throw new Error('not your turn');
    m.moves.push(mv);
    this._write(m);
  },

  async resign(id){
    const m = this._read(id);
    if(!m || m.state !== 'live') throw new Error('match is not live');
    const blueResigned = m.blue === this.me().id;
    m.state = 'finished'; m.result = blueResigned ? 'red' : 'blue'; m.reason = 'resign';
    this._write(m);
  },

  async finish(id){
    const m = this._read(id);
    if(!m || m.state !== 'live') return {ok: true};
    // the mock has no server to verify with; the client's word has to do
    m.state = 'finished';
    this._write(m);
    return {ok: true};
  },

  async offerRematch(id){
    const m = this._read(id);
    if(!m || m.state !== 'finished') throw new Error('the game is not over');
    m.rematch_offer = this.me().id;
    this._write(m);
  },

  async acceptRematch(id){
    const m = this._read(id);
    if(!m || m.state !== 'finished') throw new Error('the game is not over');
    if(!m.rematch_offer) throw new Error('nobody offered a rematch');
    if(m.rematch_offer === this.me().id) throw new Error('wait for them to accept');
    if(m.next_match) return this._read(m.next_match);
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = ''; for(let i = 0; i < 6; i++) code += A[(Math.random() * A.length) | 0];
    const n = {id: 'm-' + code, code, game: m.game, blue: m.red, red: m.blue,
               rated: false, state: 'live', moves: [], result: null, reason: null,
               rematch_offer: null, next_match: null, _names: m._names, _chat: []};
    this._write(n);
    m.next_match = n.id; m.rematch_offer = null;
    this._write(m);
    return n;
  },

  async ratings(){ return {}; },

  nudge(){},          // no server to nudge in the offline flow

  async touch(id){
    const m = this._read(id);
    if(!m) return;
    m._seen = m._seen || {};
    m._seen[this.me().id] = Date.now();
    this._write(m);
  },

  async presence(id){
    const m = this._read(id);
    return (m && m._seen) || {};
  },

  async claimAbandon(id){
    const m = this._read(id);
    if(!m || m.state !== 'live') throw new Error('match is not live');
    const opp = m.blue === this.me().id ? m.red : m.blue;
    const seen = (m._seen || {})[opp] || 0;
    if(Date.now() - seen < 60000) throw new Error('they are still here');
    m.state = 'finished';
    m.result = m.blue === this.me().id ? 'blue' : 'red';
    m.reason = 'abandon';
    this._write(m);
  },

  _queueKey: 'oddboard.mock.queue',
  _queue(){ try{ return JSON.parse(localStorage.getItem(this._queueKey)) || []; }catch(e){ return []; } },

  async findMatch(game){
    await this.init();
    const me = this.me().id;
    const q = this._queue().filter(e => Date.now() - e.at < 300000);
    const opp = q.find(e => e.id !== me);
    if(!opp){
      if(!q.some(e => e.id === me)) q.push({id: me, at: Date.now(), game});
      localStorage.setItem(this._queueKey, JSON.stringify(q));
      this._bc.postMessage({id: 'queue'});
      return null;
    }
    localStorage.setItem(this._queueKey,
      JSON.stringify(q.filter(e => e.id !== me && e.id !== opp.id)));
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = ''; for(let i = 0; i < 6; i++) code += A[(Math.random() * A.length) | 0];
    const blueFirst = Math.random() < 0.5;
    const m = {id: 'm-' + code, code, game,
               blue: blueFirst ? me : opp.id, red: blueFirst ? opp.id : me,
               rated: true, state: 'live', moves: [], result: null, reason: null,
               rematch_offer: null, next_match: null,
               _names: {[me]: this.me(), [opp.id]: {id: opp.id, display_name: 'Player ' + opp.id.slice(-4).toUpperCase()}},
               _chat: [], _seen: {}};
    this._write(m);
    return m.id;
  },

  async leaveQueue(){
    const me = this.me().id;
    localStorage.setItem(this._queueKey,
      JSON.stringify(this._queue().filter(e => e.id !== me)));
  },

  async myLiveMatch(game){
    const me = this.me().id;
    for(const k of Object.keys(localStorage)){
      if(!k.startsWith('oddboard.mock.match.')) continue;
      const m = JSON.parse(localStorage.getItem(k));
      if(m && m.game === game && m.state === 'live' && m.rated &&
         (m.blue === me || m.red === me)) return m.id;
    }
    return null;
  },

  async sendChat(id, body){
    const m = this._read(id);
    if(!m) return;
    m._chat.push({id: m._chat.length + 1, author: this.me().id, body: String(body).slice(0, 200)});
    this._write(m);
  },

  async players(match){
    const m = this._read(match.id) || match;
    const by = m._names || {};
    return {blue: by[match.blue] || null, red: by[match.red] || null};
  },

  watch(id, onMatch, onChat){
    const fire = () => {
      const m = this._read(id);
      if(m){ onMatch(m); onChat(m._chat || []); }
    };
    const sub = {id, fire};
    this._subs.push(sub);
    this.init().then(fire);
    return () => { this._subs = this._subs.filter(s => s !== sub); };
  },
};

export const T = MOCK ? MockT : SupaT;
export const IS_MOCK = MOCK;
