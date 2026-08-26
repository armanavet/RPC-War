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

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function fillGames(){
  $('lbGame').innerHTML = GAMES.map(g =>
    `<option value="${g.slug}">${esc(g.title)}</option>`).join('');
}

function row(r, i){
  const p = r.profiles || {};
  const name = p.display_name || p.handle || 'Unknown';
  return `<tr>
    <td class="lb__rank tnum">${i + 1}</td>
    <td>
      <a class="lb__who" href="../player/?h=${esc(p.handle || '')}">
        <span class="avatar avatar--sm" data-name="${esc(name)}"></span>
        <span class="lb__name">${esc(name)}</span>
        <span class="lb__handle">@${esc(p.handle || '')}</span>
      </a>
    </td>
    <td class="lb__num tnum"><b>${r.rating}</b></td>
    <td class="lb__num tnum lb__wide">${r.wins}</td>
    <td class="lb__num tnum lb__wide">${r.losses}</td>
    <td class="lb__num tnum lb__wide">${r.draws}</td>
  </tr>`;
}

async function load(game){
  const body = $('lbBody');
  body.innerHTML = '<tr><td colspan="6" class="lb__loading">Loading…</td></tr>';
  try{
    const {sb} = await import('../net/supabase.js');
    const {data, error} = await sb
      .from('ratings')
      .select('rating,played,wins,losses,draws,profiles!inner(handle,display_name,is_guest)')
      .eq('game', game)
      .eq('profiles.is_guest', false)
      .gt('played', 0)
      .order('rating', {ascending: false})
      .limit(50);
    if(error) throw error;

    body.innerHTML = (data || []).map(row).join('');
    $('lbEmpty').style.display = (data && data.length) ? 'none' : '';
    // avatars are painted, not markup
    body.querySelectorAll('.avatar[data-name]').forEach(el =>
      profile.paintAvatar(el, el.dataset.name));
  }catch(e){
    body.innerHTML = '';
    $('lbEmpty').textContent = 'Could not load the leaderboard.';
    $('lbEmpty').style.display = '';
  }
}

fillGames();
$('lbGame').addEventListener('change', e => load(e.target.value));
load(GAMES[0].slug);
mountAuthBar();
mountAds();
