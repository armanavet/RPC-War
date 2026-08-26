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
  /* 'none' | 'aads' | 'adsense' | 'ethical' */
  network: 'aads',

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

  /* A-ADS. One unit id is enough to start — `unit` is used for every
     placement that has no entry of its own. Separate ids only buy you
     separate stats. Nothing loads while these are blank. */
  aads: {
    unit: '2453421',       // a-ads.com unit; covers every slot
    units: {
      home: '',
      leaderboard: '',
      player: '',
      game: '',
    },
  },
};

/* A-ADS serves fixed sizes, so pick the biggest that actually fits the
   space rather than letting a 728-wide unit hang off a phone. */
const AADS_SIZES = [[728, 90], [468, 60], [320, 100], [320, 50]];

function bestSize(width, tall){
  const pool = tall ? [[300, 250], [336, 280], [320, 100], [320, 50]] : AADS_SIZES;
  for(const [w, h] of pool) if(w <= width) return [w, h];
  return [320, 50];
}

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

/* No script, no cookies: A-ADS is an iframe and nothing else. That is
   why it needs no consent banner and cannot slow the page down. */
function fillAads(el){
  const {unit, units} = ADS.aads;
  const id = units[el.dataset.ad] || unit;
  if(!id) return;                                 // not configured: stay collapsed

  const tall = !!el.closest('.rail');
  const room = el.getBoundingClientRect().width || el.parentElement.getBoundingClientRect().width;
  const [w, h] = bestSize(Math.floor(room) || 320, tall);

  /* set the height before the frame exists, so nothing shifts later */
  el.style.minHeight = h + 'px';
  el.classList.add('adslot--live');

  const f = document.createElement('iframe');
  f.src = `https://ad.a-ads.com/${id}?size=${w}x${h}`;
  f.width = w;
  f.height = h;
  f.loading = 'lazy';
  f.scrolling = 'no';
  f.title = 'Advertisement';
  f.style.cssText = 'border:0;padding:0;overflow:hidden;background:transparent;display:block;margin:0 auto';
  el.appendChild(f);
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

    if(ADS.network === 'aads'){ fillAads(el); continue; }   // synchronous, no script

    const fill = ADS.network === 'adsense' ? fillAdsense
               : ADS.network === 'ethical' ? fillEthical
               : null;
    if(!fill) continue;

    /* An ad blocker rejecting the script must never surface as a
       broken page — the slot just stays empty. */
    fill(el).catch(() => {});
  }
}
