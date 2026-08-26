/* ============================================================
   Ad slots.

   One switch, in ADS.network below. While it is 'none' this file
   loads no third-party script, sets no cookie and makes no request
   — the site keeps its "zero third parties" property until you
   actually have an account somewhere.

   Markup is just:

     <div class="adslot" data-ad="home"></div>

   Every slot reserves its height in CSS before anything loads, so
   an ad arriving never pushes the page around. That matters more
   here than on most sites: the board is the page, and a late
   layout shift under someone's cursor mid-drag is unforgivable.

   ?ads=preview on any URL fills the slots with a labelled dummy so
   you can see the layout without a live tag.
   ============================================================ */

export const ADS = {
  /* 'none' | 'adsense' | 'ethical' */
  network: 'none',

  adsense: {
    client: '',            // 'ca-pub-0000000000000000'
    slots: {               // slot id per placement, from the AdSense UI
      home: '',
      leaderboard: '',
      player: '',
      game: '',
    },
  },

  ethical: {
    publisher: '',         // your EthicalAds publisher id
  },
};

const PREVIEW = new URLSearchParams(location.search).get('ads') === 'preview';

/* Load a script once, no matter how many slots ask for it. */
const loaded = new Map();
function loadOnce(src, attrs){
  if(loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    for(const [k, v] of Object.entries(attrs || {})) s.setAttribute(k, v);
    s.onload = resolve;
    s.onerror = () => reject(new Error('ad script blocked or failed'));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

function fillPreview(el){
  el.classList.add('adslot--preview');
  el.innerHTML = `<span>ad slot · ${el.dataset.ad}</span>`;
}

async function fillAdsense(el){
  const {client, slots} = ADS.adsense;
  const slot = slots[el.dataset.ad];
  if(!client || !slot) return;                    // not configured: stay collapsed

  await loadOnce(
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + client,
    {crossorigin: 'anonymous'},
  );

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = client;
  ins.dataset.adSlot = slot;
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  el.appendChild(ins);
  el.classList.add('adslot--live');

  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

async function fillEthical(el){
  const {publisher} = ADS.ethical;
  if(!publisher) return;

  await loadOnce('https://media.ethicalads.io/media/client/ethicalads.min.js');

  const box = document.createElement('div');
  box.dataset.eaPublisher = publisher;
  box.dataset.eaType = 'image';
  box.className = 'horizontal';
  el.appendChild(box);
  el.classList.add('adslot--live');
}

/* Mount every slot on the page. Safe to call on any page; if there
   are no slots it does nothing. */
export function mountAds(){
  const slots = document.querySelectorAll('.adslot[data-ad]');
  if(!slots.length) return;

  for(const el of slots){
    if(PREVIEW){ fillPreview(el); continue; }
    if(ADS.network === 'none') continue;          // stays display:none

    const fill = ADS.network === 'adsense' ? fillAdsense
               : ADS.network === 'ethical' ? fillEthical
               : null;
    if(!fill) continue;

    /* An ad blocker rejecting the script must never surface as a
       broken page — the slot just stays empty. */
    fill(el).catch(() => {});
  }
}
