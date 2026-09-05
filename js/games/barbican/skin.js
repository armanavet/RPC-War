/* ============================================================
   Barbican's look: a woodcut.

   A drawn map rather than a rendered one — the sort of thing printed
   in a chronicle. Everything is ink on parchment: hatching instead of
   shading, outlines instead of fills, no perspective and no light.

   Units are heraldic shields with a charge on them, which is both the
   right notation for the period and the right notation for the
   problem: eleven kinds of unit, none of which may be confused with
   another at forty pixels. A crown, a bow, a ladder and a horse are
   told apart instantly; eleven little drawn men would not be.

   The fourth of four skins, and it shares nothing with the other
   three: not the palette, not the geometry, not the medium.
   ============================================================ */

import {ICON, GRID} from '../_shared/icons.js';

/* The charge borne on the shield: real drawn artwork, filled in the
   parchment colour so it reads as a device cut out of the tincture.
   See CREDITS.md. */
const CHARGE = {
  captain: ICON['bar-captain'], levy: ICON['bar-levy'],
  serjeant: ICON['bar-serjeant'], ram: ICON['bar-ram'],
  trebuchet: ICON['bar-trebuchet'], ladder: ICON['bar-ladder'],
  miner: ICON['bar-miner'], castellan: ICON['bar-castellan'],
  archer: ICON['bar-archer'], guard: ICON['bar-guard'],
  knight: ICON['bar-knight'],
};

/* The shield itself: a heater, drawn on the artwork's own 512 grid
   so the charge can be dropped straight onto it without rescaling. */
const SHIELD = 'M64 80h384v160c0 112-80 176-192 240C144 416 64 352 64 240z';

export function unit(u){
  const side = u.side === 0 ? 'b' : 'r';
  const charge = CHARGE[u.mark] || '';
  return `<svg class="wc wc--${side}" viewBox="0 0 ${GRID} ${GRID}" aria-hidden="true">
    <path class="wc__field" d="${SHIELD}"/>
    <path class="wc__hatch" d="${SHIELD}" fill="url(#wc-hatch)"/>
    <path class="wc__edge" d="${SHIELD}"/>
    <g class="wc__charge" transform="translate(128 136) scale(.5)">${charge}</g>
  </svg>`;
}

/* The hatch pattern is defined once for the document; every shield
   references it. Injected by the game's ui module on start-up. */
export const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <pattern id="wc-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
    <line x1="0" y1="0" x2="0" y2="4" stroke="#2A1F14" stroke-width="1.1" opacity=".38"/>
  </pattern>
  <pattern id="wc-stone" width="8" height="6" patternUnits="userSpaceOnUse">
    <rect width="8" height="6" fill="none"/>
    <path d="M0 0h8M0 3h8M0 0v3M4 3v3" stroke="#2A1F14" stroke-width=".9" opacity=".5"/>
  </pattern>
</defs></svg>`;

/* The ground, drawn. Masonry is the star of the map, so the wall,
   tower, gate and keep get the most ink on the board. */
const DRAW = {
  woods: '<g class="ln"><path d="M7 25c0-4 3-6 3-6s-2-1-2-3 3-6 3-6 3 4 3 6-2 3-2 3 3 2 3 6z"/>' +
         '<path d="M19 26c0-3.4 2.6-5 2.6-5s-1.7-.9-1.7-2.6 2.6-5 2.6-5 2.6 3.3 2.6 5-1.7 2.6-1.7 2.6 2.6 1.6 2.6 5z"/></g>',
  hill:  '<g class="ln"><path d="M3 25c4-1 5-8 8-11s5-2 7 1 4 9 11 10"/>' +
         '<path d="M10 22l2-3M14 20l2-3M18 21l2-3"/></g>',
  town:  '<g class="ln"><path d="M7 26V15l5-4 5 4v11z"/><path d="M18 26v-8l4-3 4 3v8"/><path d="M11 21h3v5h-3z"/></g>',
  marsh: '<g class="ln"><path d="M5 15q2-3 4 0M12 15q2-3 4 0M20 15q2-3 4 0M7 21q2-3 4 0M16 21q2-3 4 0M5 26q2-3 4 0M14 26q2-3 4 0M22 26q2-3 4 0"/></g>',
  river: '<g class="ln ln--w"><path d="M0 12q8 5 16 0t16 0M0 20q8 5 16 0t16 0"/></g>',
  ford:  '<g class="ln ln--w"><path d="M0 12q8 5 16 0t16 0"/></g><g class="ln"><circle cx="10" cy="21" r="2.4"/><circle cx="18" cy="24" r="2"/><circle cx="25" cy="20" r="2.4"/></g>',
  road:  '',
  open:  '',

  /* the castle */
  wall:   '<rect class="base" x="1" y="4" width="30" height="24"/>' +
          '<rect class="stone" x="1" y="4" width="30" height="24"/>' +
          '<g class="ln"><path d="M1 8h30M1 28h30"/><path d="M1 4h4v4H1zM9 4h4v4H9zM17 4h4v4h-4zM25 4h4v4h-4z"/></g>',
  tower:  '<rect class="base" x="3" y="2" width="26" height="28"/>' +
          '<rect class="stone" x="3" y="2" width="26" height="28"/>' +
          '<g class="ln"><path d="M3 8h26M3 30h26M16 8v22"/><path d="M3 2h5v6H3zM13 2h6v6h-6zM24 2h5v6h-5z"/></g>',
  gate:   '<rect class="base" x="1" y="4" width="30" height="24"/>' +
          '<rect class="stone" x="1" y="4" width="30" height="24"/>' +
          '<g class="ln"><path d="M1 4h4v4H1zM13 4h6v4h-6zM27 4h4v4h-4z"/>' +
          '<path d="M9 28V17a7 7 0 0 1 14 0v11"/><path d="M12 28V17M16 28v-13M20 28v-11M9 21h14M9 25h14"/></g>',
  rubble: '<g class="ln"><path d="M5 27l3-5 4 3 2-5 5 4 3-3 5 6z"/><path d="M9 22l-2-3M18 21l2-4M24 24l3-3"/></g>',
  keep:   '<rect class="base" x="5" y="3" width="22" height="27"/>' +
          '<rect class="stone" x="5" y="3" width="22" height="27"/>' +
          '<g class="ln"><path d="M5 9h22M5 30h22"/><path d="M5 3h4v6H5zM14 3h4v6h-4zM23 3h4v6h-4z"/>' +
          '<path d="M13 30V20a3 3 0 0 1 6 0v10"/><path d="M10 13h4v4h-4zM18 13h4v4h-4z"/></g>',
};

export function terrain(kind, links){
  let line = '';
  if(kind === 'road'){
    let d = '';
    if(links & 1) d += 'M16 16V0';
    if(links & 2) d += 'M16 16H32';
    if(links & 4) d += 'M16 16V32';
    if(links & 8) d += 'M16 16H0';
    if(!d) d = 'M7 16h18';
    line = `<path class="ln ln--road" d="${d}"/>`;
  }
  const g = DRAW[kind] || '';
  if(!g && !line) return '';
  return `<svg class="cut" viewBox="0 0 32 32" aria-hidden="true">${line}${g}</svg>`;
}

export function cell(kind){ return 'pg pg--' + kind; }
export const name = 'woodcut';
