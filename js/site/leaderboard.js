/* ============================================================
   The leaderboard. One query: ratings, newest first by rating,
   with the owning profile embedded and guests excluded.

   Ratings are world-readable and client-unwritable, so this needs
   no session at all — signed out works fine.
   ============================================================ */
import {GAMES} from './catalog.js';
import * as profile from './profile.js';
import {mountAuthBar} from './authbar.js';
import {mountAds} from './ads.js';
import {onAuth} from '../net/auth.js';

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function fillGames(){
  $('lbGame').innerHTML = GAMES.map(g =>
    `<option value="${g.slug}">${esc(g.title)}</option>`).join('');
}

function row(r, i, meId){
  const p = r.profiles || {};
  const name = p.display_name || p.handle || 'Unknown';
  const mine = meId && r.user_id === meId;
  return `<tr class="${mine ? 'is-you' : ''}">
    <td class="lb__rank tnum">${i + 1}</td>
    <td>
      <a class="lb__who" href="../player/?h=${esc(p.handle || '')}">
        <span class="avatar avatar--sm" data-name="${esc(name)}"></span>
        <span class="lb__name">${esc(name)}</span>
        <span class="lb__handle">@${esc(p.handle || '')}</span>
        ${mine ? '<span class="lb__you">you</span>' : ''}
      </a>
    </td>
    <td class="lb__num tnum"><b>${r.rating}</b></td>
    <td class="lb__num tnum lb__wide">${r.wins}</td>
    <td class="lb__num tnum lb__wide">${r.losses}</td>
    <td class="lb__num tnum lb__wide">${r.draws}</td>
  </tr>`;
}

/* Your row and your place in the ladder, for when you are not on the
   visible page of it. Two small queries, and only when signed in. */
async function myStanding(sb, game, meId){
  try{
    const {data: mine} = await sb.from('ratings')
      .select('user_id,rating,played,wins,losses,draws,profiles!inner(handle,display_name,is_guest)')
      .eq('game', game).eq('user_id', meId).gt('played', 0).maybeSingle();
    if(!mine) return null;
    const {count} = await sb.from('ratings')
      .select('user_id,profiles!inner(is_guest)', {count: 'exact', head: true})
      .eq('game', game).eq('profiles.is_guest', false)
      .gt('played', 0).gt('rating', mine.rating);
    return {r: mine, rank: (count || 0) + 1};
  }catch(e){ return null; }
}

async function load(game){
  const body = $('lbBody');
  body.innerHTML = '<tr><td colspan="6" class="lb__loading">Loading…</td></tr>';
  try{
    const {sb} = await import('../net/supabase.js');
    const {data, error} = await sb
      .from('ratings')
      .select('user_id,rating,played,wins,losses,draws,profiles!inner(handle,display_name,is_guest)')
      .eq('game', game)
      .eq('profiles.is_guest', false)
      .gt('played', 0)
      .order('rating', {ascending: false})
      .limit(50);
    if(error) throw error;

    const acc = profile.account();
    const meId = acc ? acc.id : null;
    const rows = data || [];
    let html = rows.map((r, i) => row(r, i, meId)).join('');

    /* A highlight nobody can see is not a feature: most players are not
       in the top fifty, so if you are ranked and off the bottom of the
       list your own standing is pinned underneath it. */
    if(meId && !rows.some(r => r.user_id === meId)){
      const mine = await myStanding(sb, game, meId);
      if(mine) html += `<tr class="lb__gap"><td colspan="6"></td></tr>`
                     + row(mine.r, mine.rank - 1, meId);
    }

    body.innerHTML = html;
    $('lbEmpty').style.display = rows.length ? 'none' : '';
    // avatars are painted, not markup
    body.querySelectorAll('.avatar[data-name]').forEach(el =>
      profile.paintAvatar(el, el.dataset.name));
  }catch(e){
    body.innerHTML = '';
    $('lbEmpty').textContent = 'Could not load the leaderboard.';
    $('lbEmpty').style.display = '';
  }
}

/* Remember which board you were looking at. With several games and one
   picker, landing on someone else's default every time is a small
   irritation that costs nothing to remove. */
const PICK = 'ob.lb.game';
function savedGame(){
  let v = null;
  try{ v = localStorage.getItem(PICK); }catch(e){}
  return GAMES.some(g => g.slug === v) ? v : GAMES[0].slug;
}

fillGames();
$('lbGame').addEventListener('change', e => {
  try{ localStorage.setItem(PICK, e.target.value); }catch(err){}
  load(e.target.value);
});
const start = savedGame();
$('lbGame').value = start;
load(start);

/* The board paints before sign-in has settled, so the first render has
   nobody to highlight. Redraw once identity arrives — and only when it
   actually changes, because onAuth fires repeatedly. */
let shownFor = null;
onAuth(() => {
  const acc = profile.account();
  const id = acc ? acc.id : null;
  if(id === shownFor) return;
  shownFor = id;
  load($('lbGame').value);
});

mountAuthBar();
mountAds();
