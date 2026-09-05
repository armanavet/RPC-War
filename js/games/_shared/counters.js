/* ============================================================
   Unit counters, drawn rather than downloaded.

   The visual language is military map symbology — the APP-6 family
   every army in the world uses to draw a situation map. It is not a
   stylistic flourish: it is a notation designed over a century for
   exactly this problem, telling a dozen kinds of unit apart at a
   glance on a crowded map, and it beats anything decorative we could
   commission. A rectangle is a unit; what is inside it says what
   kind. Crossed diagonals are infantry, an ellipse is armour, a
   filled dot is artillery, a single stroke is reconnaissance.

   It is also free of every problem an asset pack brings: it is
   geometry, so it scales to any board size without a sprite sheet,
   it takes the player's colour from currentColor so light and dark
   both work, it adds no third-party host to the page — which this
   site has refused twice already — and there is no licence attached
   to a rectangle.

   Everything here returns an SVG string on a 32x22 viewBox. Games
   pick the subset of symbols they use.
   ============================================================ */

/* The frame every counter sits in. Friendly and hostile frames differ
   in real symbology; here both sides get the rectangle and are told
   apart by colour, because a player should never have to decode
   which army is theirs. */
const FRAME = '<rect x="1.1" y="1.1" width="29.8" height="19.8" rx="1.6" ' +
              'fill="var(--ctr-fill)" stroke="currentColor" stroke-width="1.7"/>';

const CUT_FRAME = '<rect x="1.1" y="1.1" width="29.8" height="19.8" rx="1.6" ' +
              'fill="var(--ctr-fill)" stroke="currentColor" stroke-width="1.7" ' +
              'stroke-dasharray="3.2 2.4"/>';

/* Inner marks. Kept on one stroke width so a board of them reads as
   one typeface rather than a ransom note. */
const MARKS = {
  /* infantry — crossed diagonals */
  inf: '<path d="M4.5 4.5 27.5 17.5M27.5 4.5 4.5 17.5"/>',

  /* armour — the ellipse, drawn wide so it never reads as a letter O */
  arm: '<ellipse cx="16" cy="11" rx="9.5" ry="5.6" fill="none"/>',

  /* artillery — a single filled round, the oldest mark of the lot */
  art: '<circle cx="16" cy="11" r="3.6" fill="currentColor" stroke="none"/>',

  /* reconnaissance — one diagonal, leaning the way cavalry always leans */
  rec: '<path d="M5 17.5 27 4.5"/>',

  /* engineer — the bridge bracket */
  eng: '<path d="M7 15.5v-4.2h18v4.2M16 11.3V6.6M11.4 6.6h9.2"/>',

  /* supply depot — a stack, because that is what a depot is */
  dep: '<path d="M9.5 15.8h13M9.5 11.9h13M9.5 8h13" stroke-width="2.4"/>',

  /* headquarters — the staff, flying from the left of the frame */
  gen: '<path d="M8 17.5V5.2h11.5l-2.6 2.9 2.6 2.9H8"/>' +
       '<path d="M22.2 14.6h3.4" stroke-width="1.4"/>',

  /* staff detachment — the same staff, half the flag, and a chevron
     so it is never confused with the general at board size */
  stf: '<path d="M9.5 17.5V6.2h7.6l-1.9 2.2 1.9 2.2H9.5"/>' +
       '<path d="m20 8.4 3.4 3 -3.4 3"/>',

  /* militia / second line — the diagonal with a bar under it */
  mil: '<path d="M5 15.5 27 5.5M6 18.2h20"/>',

  /* mechanised — armour and infantry together */
  mech: '<ellipse cx="16" cy="11" rx="9.5" ry="5.6" fill="none"/>' +
        '<path d="M8.4 6.4 23.6 15.6M23.6 6.4 8.4 15.6"/>',
};

/* A small pip row along the top edge is how real symbology says how
   big a formation is. Here it says how much force the unit projects,
   which is the number a player actually needs. */
function pips(n){
  if(!n) return '';
  const gap = 3.4, total = (n - 1) * gap;
  let out = '';
  for(let k = 0; k < n; k++){
    const x = 16 - total / 2 + k * gap;
    out += `<circle cx="${x.toFixed(2)}" cy="-1.6" r="1.15" fill="currentColor" stroke="none"/>`;
  }
  return out;
}

/* opts: {cut, strength, dim} */
export function counter(key, opts){
  const o = opts || {};
  const mark = MARKS[key] || '';
  return '<svg class="ctr' + (o.cut ? ' ctr--cut' : '') + '" viewBox="-1 -4 34 27" ' +
         'fill="none" stroke="currentColor" stroke-width="1.9" ' +
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
         (o.cut ? CUT_FRAME : FRAME) + mark + pips(o.strength || 0) + '</svg>';
}

export const MARK_KEYS = Object.keys(MARKS);

/* ---------- terrain ----------
   Drawn as one SVG per square, beneath the counters. Roads and
   rivers need to know which neighbours match so a line joins up
   across squares instead of stopping at every edge; `links` is a
   4-bit mask, north east south west. */
const LINK_PATH = (links, w) => {
  let d = '';
  if(links & 1) d += 'M16 16V0';
  if(links & 2) d += 'M16 16H32';
  if(links & 4) d += 'M16 16V32';
  if(links & 8) d += 'M16 16H0';
  if(!links) d = 'M8 16h16';                       // an isolated stub
  return `<path d="${d}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
};

export function terrainSVG(kind, links){
  const open = (inner, cls) =>
    `<svg class="terr terr--${cls}" viewBox="0 0 32 32" fill="none" aria-hidden="true">${inner}</svg>`;

  switch(kind){
    case 'road':
      return open(LINK_PATH(links, 3.4), 'road');
    case 'river':
      return open(LINK_PATH(links, 7), 'river');
    case 'ford':
      return open(LINK_PATH(links, 7) +
        '<path d="M6 11h20M6 21h20" stroke-width="2.2" stroke-dasharray="3 3"/>', 'ford');
    case 'woods':
      return open(
        '<path d="M8 23c0-4 2.6-6.4 2.6-6.4S8.8 16 8.8 14.2 11.4 8 11.4 8s2.6 4.4 2.6 6.2-1.8 2.4-1.8 2.4S14.8 19 14.8 23z"/>' +
        '<path d="M18 24c0-3.2 2.2-5.2 2.2-5.2s-1.6-.4-1.6-1.9 2.2-5 2.2-5 2.2 3.5 2.2 5-1.6 1.9-1.6 1.9S23.6 20.8 23.6 24z"/>',
        'woods');
    case 'hill':
      return open(
        '<path d="M4 23c3.6 0 5-4.4 6.6-7.2S14.6 10 16.6 10s4 3 5.6 5.8S27.4 23 30 23"/>' +
        '<path d="M9.5 23c2.2 0 3.2-2.8 4.2-4.4s1.9-3 2.9-3 2 1.4 3 3S22.4 23 24.6 23"/>',
        'hill');
    case 'marsh':
      return open(
        '<path d="M5 12h7M15 12h6M24 12h4M5 18h5M13 18h7M23 18h5M5 24h8M16 24h5M24 24h4" ' +
        'stroke-width="1.9" stroke-linecap="round"/>', 'marsh');
    case 'town':
      return open(
        '<path d="M7 25v-9l4.6-3.4L16 16v9z"/><path d="M18 25V13l4-3 4 3v12z"/>' +
        '<path d="M10.4 20.4h2.6M21 17.4h2.2M21 21.4h2.2"/>',
        'town');
    default:
      return '';
  }
}
