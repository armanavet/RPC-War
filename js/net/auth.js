/* ============================================================
   Sign-in state, for any page on the site.

   Everything reads `authState()`, which is synchronous and always
   safe to call. It starts as {ready:false} and settles once init()
   has looked for a session.

   The SDK is imported dynamically, and only when there is a reason
   to: a stored session, a returning OAuth redirect, or the visitor
   pressing sign in. A signed-out person playing the computer never
   downloads it.
   ============================================================ */
import {SUPABASE_URL} from './config.js';

const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const TOKEN_KEY = `sb-${REF}-auth-token`;    // where supabase-js parks the session

let snap = {ready: false, signedIn: false, isGuest: false, user: null, profile: null};
const subs = [];

export const authState = () => snap;

export function onAuth(fn){
  subs.push(fn);
  if(snap.ready) fn(snap);
  return () => { const i = subs.indexOf(fn); if(i >= 0) subs.splice(i, 1); };
}

const emit = () => { for(const fn of subs.slice()) fn(snap); };

/* one client, fetched on first need */
let clientPromise = null;
const client = () => (clientPromise ||= import('./supabase.js').then(m => m.sb));

/* The signup trigger writes the profile row in the same transaction as the
   user, but a first sign-in can still race the read. Retry briefly. */
async function loadProfile(sb, id){
  for(let i = 0; i < 4; i++){
    const {data} = await sb.from('profiles')
      .select('id,handle,display_name').eq('id', id).maybeSingle();
    if(data) return data;
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

async function apply(sb, session){
  const profile = session ? await loadProfile(sb, session.user.id) : null;
  snap = {
    ready: true,
    signedIn: !!session,
    isGuest: !!session?.user?.is_anonymous,
    user: session?.user ?? null,
    profile,
  };
  emit();
}

async function boot(){
  const sb = await client();
  const {data} = await sb.auth.getSession();
  await apply(sb, data.session);
  // Calling into supabase from inside this callback can deadlock on the auth
  // lock, so hand the work to the next tick.
  sb.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => apply(sb, session), 0);
  });
}

const hasStoredSession = () => {
  try{ return !!localStorage.getItem(TOKEN_KEY); }catch(e){ return false; }
};

const isReturningFromOAuth = () =>
  /[?&]code=/.test(location.search) || /access_token=/.test(location.hash);

export async function init(){
  if(!hasStoredSession() && !isReturningFromOAuth()){
    snap = {...snap, ready: true};     // signed out, and the SDK stays unloaded
    emit();
    return;
  }
  try{
    await boot();
  }catch(e){
    console.error('auth: could not restore session', e);
    snap = {...snap, ready: true};
    emit();
  }
}

/* The providers we accept. Adding one means enabling it in the Supabase
   dashboard and adding it here and in authbar.js. */
export const PROVIDERS = ['google', 'github'];

export async function signIn(provider = 'google'){
  if(!PROVIDERS.includes(provider)) throw new Error('unknown provider: ' + provider);
  const sb = await client();
  const {error} = await sb.auth.signInWithOAuth({
    provider,
    // come back to this exact page; both origins are in Supabase's allow-list
    options: {redirectTo: location.origin + location.pathname},
  });
  if(error) console.error('auth: sign-in failed', error);
}

/* A session of some kind, creating a guest one if there is none.
   Sending or accepting a challenge goes through here, so playing a
   friend never needs an account — but a guest still has a real
   auth.uid(), which is what play_move checks. */
export async function ensureSession(){
  const sb = await client();
  const {data} = await sb.auth.getSession();
  if(data.session) return data.session;

  const {data: anon, error} = await sb.auth.signInAnonymously();
  if(error) throw new Error('Could not start a guest session: ' + error.message);
  await apply(sb, anon.session);
  return anon.session;
}

/* Only your own row, and only this column — see 0001_profiles.sql. */
export async function setDisplayName(name){
  const sb = await client();
  const id = snap.user && snap.user.id;
  if(!id || !name) return;
  const {error} = await sb.from('profiles').update({display_name: name}).eq('id', id);
  if(error){ console.error('auth: could not set display name', error); return; }
  if(snap.profile) snap.profile = {...snap.profile, display_name: name};
  emit();
}

export async function signOut(){
  const sb = await client();
  await sb.auth.signOut();
  snap = {ready: true, signedIn: false, isGuest: false, user: null, profile: null};
  emit();
}
