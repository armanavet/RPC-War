/* ============================================================
   How many people are here, and where.

   Deliberately built on plain fetch rather than the Supabase SDK.
   The counter lives on the homepage, which a signed-out visitor
   must still be able to load without pulling 284 KB of vendor
   JavaScript (HANDOFF §8). Two REST calls against PostgREST cost
   nothing and keep that invariant intact — so do not be tempted to
   import ./supabase.js in here.

   Identity is a uuid in localStorage, not auth.uid(), so someone
   playing the computer counts too. See 0010_presence.sql for why
   the numbers are advisory and why that is fine.

     startPresence(room, onCounts) -> stop()

   `onCounts` gets {total, rooms:{slug:n}} every tick. Every failure
   is swallowed: a decorative number must never break a page.
   ============================================================ */
import {SUPABASE_URL, SUPABASE_KEY, MOCK} from './config.js';

const BEAT_MS  = 25000;    // < the 60s the server counts you as present for
const IDLE_MS  = 90000;    // a hidden tab still exists, but is not "here"
const KEY      = 'ob.client';

function clientId(){
  let v = null;
  try{ v = localStorage.getItem(KEY); }catch(e){}
  if(v) return v;
  v = (crypto.randomUUID && crypto.randomUUID()) ||
      /* older browsers: any v4-shaped string is fine, it is only a key */
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  try{ localStorage.setItem(KEY, v); }catch(e){}
  return v;
}

async function rpc(fn, body){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  if(!r.ok) throw new Error(fn + ' ' + r.status);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export function startPresence(room, onCounts){
  if(MOCK) return () => {};          // offline flow has no backend to ask

  const id = clientId();
  let stopped = false, timer = null;

  const schedule = ms => {
    clearTimeout(timer);
    if(!stopped) timer = setTimeout(tick, ms);
  };

  async function tick(){
    if(stopped) return;

    /* A backgrounded tab is not "here", and nobody is reading its number
       either — so it neither beats nor polls. Coming back re-ticks at
       once through visibilitychange, so this costs no freshness. */
    if(document.hidden){ schedule(IDLE_MS); return; }

    try{
      await rpc('heartbeat', {p_client: id, p_room: room});
      const counts = await rpc('online_counts');
      if(!stopped && counts && onCounts) onCounts(counts);
    }catch(e){
      /* offline, blocked, migration not applied — leave the number be */
    }
    schedule(BEAT_MS);
  }

  /* coming back to a tab should feel instant, not up to 25s stale */
  const onVis = () => { if(!document.hidden) schedule(0); };
  document.addEventListener('visibilitychange', onVis);

  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
  };
}
