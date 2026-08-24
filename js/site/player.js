/* ============================================================
   A player's page: who they are, their rating, and their finished
   games.

   ?h=<handle> shows anyone. With no handle it shows you, if you are
   signed in. Finished matches are world-readable (0008), so this
   works signed out too — chat is not, and is never shown here.
   ============================================================ */
import {GAMES} from './catalog.js';
import * as profile from './profile.js';
import * as auth from '../net/auth.js';
import {mountAuthBar} from './authbar.js';

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const GAME = GAMES[0].slug;

const REASONS = {
  backrow: 'reached the back row',
  wipeout: 'no pieces left',
  nomoves: 'no legal moves',
  resign:  'resignation',
  invalid: 'illegal move',
  abandon: 'abandoned',
};

function ago(iso){
  if(!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if(s < 60) return 'just now';
  if(s < 3600) return Math.floor(s / 60) + 'm ago';
  if(s < 86400) return Math.floor(s / 3600) + 'h ago';
  if(s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}

function empty(msg){
  $('histBody').innerHTML = '';
  $('histEmpty').textContent = msg;
  $('histEmpty').style.display = '';
}

async function run(){
  const sb = (await import('../net/supabase.js')).sb;
  const wanted = new URLSearchParams(location.search).get('h');

  // who are we looking at?
  let who = null;
  if(wanted){
    const {data} = await sb.from('profiles')
      .select('id,handle,display_name,is_guest').eq('handle', wanted.toLowerCase()).maybeSingle();
    who = data;
  }else{
    who = profile.account();
  }

  if(!who){
    $('pName').textContent = wanted ? 'No such player' : 'Sign in to see your games';
    $('pHandle').textContent = '';
    empty(wanted ? '' : 'Your finished games will appear here.');
    return;
  }

  const name = who.display_name || who.handle;
  document.title = name + ' — Oddboard';
  profile.paintAvatar($('pAvatar'), name);
  $('pName').textContent = name;
  $('pHandle').textContent = '@' + who.handle + (who.is_guest ? ' · guest' : '');

  // rating summary
  const {data: r} = await sb.from('ratings')
    .select('rating,played,wins,losses,draws').eq('user_id', who.id).eq('game', GAME).maybeSingle();
  const cells = [
    ['Rating', r ? r.rating : '—'],
    ['Played', r ? r.played : 0],
    ['Won',    r ? r.wins : 0],
    ['Lost',   r ? r.losses : 0],
  ];
  $('pStats').innerHTML = cells.map(([k, v]) =>
    `<div class="stat"><dt>${k}</dt><dd class="tnum">${v}</dd></div>`).join('');

  // finished games
  const {data: rows, error} = await sb.from('matches')
    .select('id,game,blue,red,rated,state,result,reason,finished_at,blue_delta,red_delta')
    .or(`blue.eq.${who.id},red.eq.${who.id}`)
    .in('state', ['finished', 'aborted'])
    .order('finished_at', {ascending: false})
    .limit(50);

  if(error){ empty('Could not load games.'); return; }
  if(!rows || !rows.length){ empty('No finished games yet.'); return; }

  // one lookup for every opponent on the page
  const oppIds = [...new Set(rows.map(m => m.blue === who.id ? m.red : m.blue).filter(Boolean))];
  const names = {};
  if(oppIds.length){
    const {data: ps} = await sb.from('profiles').select('id,handle,display_name').in('id', oppIds);
    for(const p of (ps || [])) names[p.id] = p;
  }

  $('histEmpty').style.display = 'none';
  $('histBody').innerHTML = rows.map(m => {
    const iAmBlue = m.blue === who.id;
    const opp = names[iAmBlue ? m.red : m.blue];
    const oppName = opp ? (opp.display_name || opp.handle) : 'Unknown';
    const delta = iAmBlue ? m.blue_delta : m.red_delta;

    let outcome = 'draw', label = 'Draw';
    if(m.state === 'aborted'){ outcome = 'void'; label = 'Void'; }
    else if(m.result === 'draw'){ outcome = 'draw'; label = 'Draw'; }
    else if((m.result === 'blue') === iAmBlue){ outcome = 'win'; label = 'Win'; }
    else { outcome = 'loss'; label = 'Loss'; }

    const d = (m.rated && delta != null)
      ? `<b class="${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}">${
          delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)}</b>`
      : '<span class="muted">friendly</span>';

    return `<tr>
      <td><span class="tag tag--${outcome}">${label}</span></td>
      <td>${opp ? `<a class="hist__opp" href="./?h=${esc(opp.handle)}">${esc(oppName)}</a>`
                : esc(oppName)}</td>
      <td class="lb__num tnum">${d}</td>
      <td class="lb__wide muted">${esc(REASONS[m.reason] || m.reason || '')}</td>
      <td class="lb__wide lb__num muted">${esc(ago(m.finished_at))}</td>
    </tr>`;
  }).join('');
}

mountAuthBar();

/* A named player needs no session. Your own page has to wait until we
   know who you are — and onAuth fires on every change, so only re-run
   when the identity actually moved. */
const go = () => run().catch(() => empty('Could not load.'));

if(new URLSearchParams(location.search).get('h')){
  go();
}else{
  let last;
  auth.onAuth(state => {
    if(!state.ready) return;
    const id = state.profile ? state.profile.id : null;
    if(id === last) return;
    last = id;
    go();
  });
}
