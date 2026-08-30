/* ============================================================
   The player profile.

   There is no backend yet, so this is deliberately thin: a display
   name and whatever results this browser has seen, kept in
   localStorage. Nothing here is authoritative and nothing is
   invented — anything that needs a server (rating, rank, a real
   match history) reports itself as unavailable rather than
   guessing a number.

   Signed in, the display name comes from the account. The local
   record stays local for now — moving results to the server is
   phase 3, where they become Elo. See docs/accounts.md.
   ============================================================ */
import {authState} from '../net/auth.js';

const KEY = 'oddboard.profile';
const LEGACY_NAME_KEY = 'rps.name';   // the old per-game name prompt

/* A few flat avatar colours, picked by name hash so your tile stays
   the same. All of them carry white text on either theme. */
const PALETTES = ['#4B7BB5', '#3E8E6B', '#A8603F', '#7A5FA8', '#B0543F', '#3F7F8E', '#8A6A3C', '#9A4C72'];

const hash = s => {
  let h = 0;
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const blank = () => ({name: '', results: {}});

export function load(){
  let p;
  try{ p = JSON.parse(localStorage.getItem(KEY)); }catch(e){ p = null; }
  if(!p || typeof p !== 'object') p = blank();
  p.results = p.results || {};
  // carry over the name the game used to ask for on its own
  if(!p.name){
    const old = localStorage.getItem(LEGACY_NAME_KEY);
    if(old) p.name = old;
  }
  return p;
}

export function save(patch){
  const p = {...load(), ...patch};
  try{ localStorage.setItem(KEY, JSON.stringify(p)); }catch(e){}
  // keep the game's own prompt pre-filled with the same name
  if(patch.name){ try{ localStorage.setItem(LEGACY_NAME_KEY, patch.name); }catch(e){} }
  return p;
}

/* The signed-in profile row, or null. A guest is not an account —
   the local name keeps working exactly as it does signed out. */
export function account(){
  const s = authState();
  return (s.profile && !s.isGuest) ? s.profile : null;
}

/* What to call this player. The account wins when there is one. */
export function displayName(){
  const acc = account();
  if(acc) return acc.display_name || acc.handle;
  return load().name || 'Guest';
}

function initialsOf(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  if(parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function paletteFor(name){
  return PALETTES[hash(String(name || 'guest').toLowerCase()) % PALETTES.length];
}

/* Paint an .avatar element for a given name. */
export function paintAvatar(el, name){
  el.style.setProperty('--av-c', paletteFor(name));
  el.textContent = initialsOf(name);
}

/* Your rating for one game, or null when signed out. Ratings live on the
   server and no client can write them — see supabase/migrations/0004. */
/* Every rating this account holds, strongest-first by how much it has
   actually been played. With four games there is no single "your rating"
   any more, so callers show the one that represents the player best. */
export async function topRating(){
  const acc = account();
  if(!acc) return null;
  try{
    const {sb} = await import('../net/supabase.js');
    const {data} = await sb.from('ratings')
      .select('game,rating,played').eq('user_id', acc.id);
    const rows = data || [];
    if(!rows.length) return null;
    rows.sort((a, b) => (b.played - a.played) || (b.rating - a.rating));
    return {...rows[0], totalPlayed: rows.reduce((n, r) => n + (r.played || 0), 0)};
  }catch(e){ return null; }
}

export async function ratingFor(game){
  const acc = account();
  if(!acc) return null;
  try{
    const {sb} = await import('../net/supabase.js');
    const {data} = await sb.from('ratings')
      .select('rating,played,wins,losses,draws')
      .eq('user_id', acc.id).eq('game', game).maybeSingle();
    return data;
  }catch(e){ return null; }
}

/* Called by a game when it finishes. result: 'win' | 'loss' | 'draw' */
export function recordResult(slug, result){
  const p = load();
  const r = p.results[slug] || {win: 0, loss: 0, draw: 0};
  if(result in r) r[result]++;
  p.results[slug] = r;
  save({results: p.results});
  return r;
}

export function totals(){
  const all = Object.values(load().results);
  const t = all.reduce((a, r) => ({
    win:  a.win  + (r.win  || 0),
    loss: a.loss + (r.loss || 0),
    draw: a.draw + (r.draw || 0),
  }), {win: 0, loss: 0, draw: 0});
  t.played = t.win + t.loss + t.draw;
  t.winRate = t.played ? Math.round(t.win / t.played * 100) : null;
  return t;
}
