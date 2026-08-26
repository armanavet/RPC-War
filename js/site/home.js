/* ============================================================
   The homepage: a profile strip, the game grid, the name modal.
   ============================================================ */
import {GAMES} from './catalog.js';
import * as profile from './profile.js';
import {mountAuthBar} from './authbar.js';
import {onAuth} from '../net/auth.js';
import {startPresence} from '../net/presence.js';
import {mountAds} from './ads.js';

const $ = id => document.getElementById(id);

/* ---------- profile ---------- */
function renderProfile(){
  const acc = profile.account();
  const name = profile.displayName();

  profile.paintAvatar($('profileAvatar'), name);
  $('profileName').textContent = name;

  if(acc){
    $('profileStats').textContent = '@' + acc.handle;
    $('btnEditName').style.display = 'none';
    // ratings are server-side; fill them in when they arrive
    profile.ratingFor('rps-chess').then(r => {
      if(!r || profile.account() !== acc) return;
      $('profileStats').innerHTML =
        '@' + acc.handle + ' · <b>' + r.rating + '</b> rating'
        + (r.played ? ' · ' + r.played + ' played' : '');
    });
  }else{
    const t = profile.totals();
    $('profileStats').textContent = t.played
      ? `${t.played} played · ${t.win} won`
      : 'No games yet';
    $('btnEditName').style.display = '';
  }
}

/* ---------- game grid ---------- */
function card(g){
  return `<a class="gcard" href="${g.href}">
    <div class="gcard__art">${g.art}</div>
    <div class="gcard__bd">
      <h2 class="gcard__title display">${g.title}</h2>
      <p class="gcard__blurb">${g.blurb}</p>
      <div class="gcard__foot">
        <ul class="gcard__tags">${g.tags.map(t => `<li>${t}</li>`).join('')}</ul>
        <span class="live" data-room="${g.slug}" hidden></span>
        <span class="btn btn--primary btn--sm">Play</span>
      </div>
    </div>
  </a>`;
}

const renderGames = () => { $('gameGrid').innerHTML = GAMES.map(card).join(''); };

/* ---------- who is around ---------- */
/* Nobody needs to be told a game has nobody in it, so a zero hides
   rather than reading "0 playing" next to every card on a quiet day. */
function renderCounts({total, rooms}){
  const t = $('liveTotal');
  if(t){
    t.textContent = total === 1 ? '1 online' : `${total} online`;
    t.hidden = !total;
  }
  for(const el of document.querySelectorAll('.gcard .live')){
    const n = (rooms && rooms[el.dataset.room]) || 0;
    el.textContent = n === 1 ? '1 playing' : `${n} playing`;
    el.hidden = !n;
  }
}

/* ---------- name modal ---------- */
function openModal(){
  $('nameIn').value = profile.load().name || '';
  $('modalErr').style.display = 'none';
  $('modal').classList.add('on');
  setTimeout(() => $('nameIn').focus(), 40);
}
const closeModal = () => $('modal').classList.remove('on');

function commitName(){
  const v = $('nameIn').value.trim();
  if(!v){
    $('modalErr').textContent = 'Type a name first.';
    $('modalErr').style.display = 'block';
    return;
  }
  profile.save({name: v});
  closeModal();
  renderProfile();
}

$('modalOk').addEventListener('click', commitName);
$('modalCancel').addEventListener('click', closeModal);
$('nameIn').addEventListener('keydown', e => { if(e.key === 'Enter') commitName(); });
$('modal').addEventListener('click', e => { if(e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });
$('btnEditName').addEventListener('click', openModal);

renderGames();
renderProfile();            // paint the local view straight away
onAuth(renderProfile);      // ...then again once sign-in settles
mountAuthBar();
startPresence('home', renderCounts);
mountAds();
