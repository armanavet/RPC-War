/* ============================================================
   The side rail, as tabs, on phones.

   On a desktop the rail is a column beside the board and everything
   is visible at once. On a phone that same column becomes a long
   scroll underneath the board: to resign you scroll past the whole
   Game panel, and the move list is somewhere off the bottom of the
   world. This turns those panels into one segmented control.

   Used by every game. A game calls it once and forgets:

     import {mountRailTabs} from '../../site/railtabs.js';
     mountRailTabs();

   Two things make this fiddlier than it looks:

   1. Panels appear and disappear on their own. Chat only exists once
      you are in a match, and the app shows it by clearing an inline
      `display:none`. So the tab bar has to be rebuilt whenever that
      changes, which is what the MutationObserver is for.

   2. We must not fight the app over `style.display`. Inline styles
      beat class rules, so hiding an inactive panel with a class would
      lose to the app's own inline hiding — and setting inline display
      ourselves would clobber the value the app is relying on. Instead
      the panel carries data-tab="off" and the stylesheet hides that
      with !important, which outranks the inline style without ever
      overwriting it.
   ============================================================ */

/* Tabs are for a tall, narrow screen. A phone held sideways is short
   but wide, and there the rail belongs *beside* the board where it
   always was — so this must stay in step with the matching media
   query in each game's stylesheet. */
const NARROW = '(max-width:768px) and (orientation:portrait)';

export function mountRailTabs(){
  const rail = document.querySelector('.rail');
  if(!rail) return;

  const mq = matchMedia(NARROW);
  let bar = null;
  let activeId = null;

  const panels = () => [...rail.children].filter(el => el.classList.contains('panel'));
  /* A panel the app itself has hidden is not a tab. */
  const offered = () => panels().filter(p => p.style.display !== 'none');
  const labelOf = p => (p.querySelector('.panel__hd .eyebrow') || {}).textContent || 'Panel';
  const idOf = (p, i) => p.id || ('railpanel' + i);

  function show(id){
    const list = offered();
    if(!list.length) return;
    const target = list.find(p => p.dataset.railId === id) || list[0];
    activeId = target.dataset.railId;
    for(const p of panels()) p.dataset.tab = (p === target) ? 'on' : 'off';
    if(bar){
      for(const b of bar.children){
        const on = b.dataset.railFor === activeId;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
    }
  }

  function build(){
    const list = offered();
    panels().forEach((p, i) => { p.dataset.railId = idOf(p, i); });

    if(!bar){
      bar = document.createElement('div');
      bar.className = 'railtabs';
      bar.setAttribute('role', 'tablist');
      bar.addEventListener('click', e => {
        const b = e.target.closest('[data-rail-for]');
        if(b) show(b.dataset.railFor);
      });
      bar.addEventListener('keydown', e => {
        if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const bs = [...bar.children];
        const at = bs.findIndex(b => b.getAttribute('aria-selected') === 'true');
        const next = bs[(at + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
        if(next){ show(next.dataset.railFor); next.focus(); e.preventDefault(); }
      });
      rail.prepend(bar);
    }

    bar.textContent = '';
    for(const p of list){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'railtabs__t';
      b.setAttribute('role', 'tab');
      b.dataset.railFor = p.dataset.railId;
      b.textContent = labelOf(p);
      bar.appendChild(b);
    }
    rail.classList.add('rail--tabs');
    /* Keep the tab you were on if it is still here, otherwise fall back. */
    show(list.some(p => p.dataset.railId === activeId) ? activeId : (list[0] || {}).dataset?.railId);
  }

  function teardown(){
    rail.classList.remove('rail--tabs');
    if(bar){ bar.remove(); bar = null; }
    for(const p of panels()) delete p.dataset.tab;
  }

  /* Panels are shown and hidden by the app as a match starts and ends,
     so the bar has to follow. Watching `style` is enough — that is the
     only way visibility ever changes here. */
  const obs = new MutationObserver(() => { if(mq.matches) build(); });
  for(const p of panels()) obs.observe(p, {attributes: true, attributeFilter: ['style']});

  const sync = () => { if(mq.matches) build(); else teardown(); };
  mq.addEventListener('change', sync);
  sync();
}
