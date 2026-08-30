/* ============================================================
   The sign-in control in the top bar. Shared by every page.

   Expects this markup:
     <button id="navProfile">
       <span class="avatar avatar--sm" id="navAvatar"></span>
       <span id="navName"></span>
     </button>

   Signed out it reads "Sign in" and drops a provider chooser.
   Signed in it shows you, and drops your handle and a way out.
   ============================================================ */
import * as auth from '../net/auth.js';
import * as profile from './profile.js';

const $ = id => document.getElementById(id);

const esc = t => String(t).replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* Brand marks. Google's is fixed-colour by their brand rules; GitHub's
   takes currentColor so it works in both themes. */
const MARK = {
  google: `<svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
    </svg>`,
  github: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>`,
};

const LABEL = {google: 'Google', github: 'GitHub'};

/* The bar is on pages at three different depths (/, /leaderboard/,
   /games/<slug>/), so links out of it have to climb back to the site
   root themselves. An absolute /player/ would break the moment the
   site is served from a subpath again. */
const ROOT = (() => {
  const segs = location.pathname.replace(/\/[^/]*$/, '').split('/').filter(Boolean);
  return segs.length ? '../'.repeat(segs.length) : './';
})();

let menu = null;

function closeMenu(){
  if(menu){ menu.remove(); menu = null; }
}

function dropMenu(btn, html){
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = html;
  btn.parentNode.appendChild(menu);
  return menu;
}

function openSignInMenu(btn){
  const items = auth.PROVIDERS.map(p =>
    `<button class="menu__item menu__item--icon" data-provider="${p}">
       <span class="menu__mark">${MARK[p]}</span>Continue with ${LABEL[p]}
     </button>`).join('');
  const el = dropMenu(btn, `<div class="menu__hd">Sign in</div>${items}`);
  el.querySelectorAll('[data-provider]').forEach(b =>
    b.addEventListener('click', () => {
      closeMenu();
      auth.signIn(b.dataset.provider);
    }));
}

function openAccountMenu(btn){
  const acc = profile.account();
  const el = dropMenu(btn,
    `<div class="menu__who">
       <div class="menu__name">${esc(profile.displayName())}</div>
       <div class="menu__handle">@${esc(acc ? acc.handle : '')}</div>
     </div>
     <a class="menu__item" href="${ROOT}player/?h=${encodeURIComponent(acc ? acc.handle : '')}">Your profile</a>
     <button class="menu__item" id="menuSignOut">Sign out</button>`);
  el.querySelector('#menuSignOut').addEventListener('click', async () => {
    closeMenu();
    await auth.signOut();
  });
}

function render(state){
  const btn = $('navProfile'), av = $('navAvatar'), nm = $('navName');
  if(!btn) return;

  closeMenu();

  /* `--anon` tells the stylesheet there is no avatar to show. Phones
     collapse this chip to the avatar alone, which leaves an empty
     capsule when nobody is signed in — the class lets the label stay. */
  if(!state.ready){
    btn.disabled = true;
    btn.classList.add('chipbtn--anon');
    av.style.display = 'none';
    nm.textContent = '…';
    return;
  }

  btn.disabled = false;
  if(state.signedIn && !state.isGuest){
    const name = profile.displayName();
    btn.classList.remove('chipbtn--anon');
    av.style.display = '';
    profile.paintAvatar(av, name);
    nm.textContent = name;
    btn.title = 'Account';
  }else{
    btn.classList.add('chipbtn--anon');
    av.style.display = 'none';
    nm.textContent = 'Sign in';
    btn.title = 'Sign in';
  }
}

export function mountAuthBar(){
  const btn = $('navProfile');
  if(!btn) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const state = auth.authState();
    if(!state.ready) return;
    if(menu){ closeMenu(); return; }
    (state.signedIn && !state.isGuest) ? openAccountMenu(btn) : openSignInMenu(btn);
  });

  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeMenu(); });

  auth.onAuth(render);
  render(auth.authState());
  auth.init();
}
