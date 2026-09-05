/* ============================================================
   Breakthrough's look: flat illustration.

   Mid-century poster. Solid shapes, no outlines, no gradients, no
   texture, no light source — a thing is a silhouette in one colour
   with at most one darker shape cut into it for depth. The palette is
   four inks on paper stock.

   Every unit is drawn in *profile*, which is the cheapest way to make
   this skin share nothing with the other three: Salient's pixels are
   front-on, Tideline's tokens are top-down discs, and Barbican's
   woodcut is a drawn map. Side elevation reads as a printed diagram.
   ============================================================ */

import {ICON, GRID} from '../_shared/icons.js';

/* Real drawn artwork, printed as one flat colour — no outline, no
   shading, no second tone. See CREDITS.md. */
const SHAPE = {
  gen: ICON['brk-gen'], inf: ICON['brk-inf'], arm: ICON['brk-arm'],
  art: ICON['brk-art'], rec: ICON['brk-rec'], mil: ICON['brk-mil'],
};

export function unit(u){
  const s = SHAPE[u.mark] || SHAPE.inf;
  const side = u.side === 0 ? 'b' : 'r';
  return `<svg class="fl fl--${side}" viewBox="0 0 ${GRID} ${GRID}" aria-hidden="true">${s}</svg>`;
}

/* Ground: flat geometry. A wood is three triangles, a hill is one
   trapezoid, a town is two rectangles. Nothing is drawn, everything
   is constructed. */
const GROUND = {
  woods: '<path class="g1" d="M6 24 11 12l5 12zM17 24l4.5-9 4.5 9z"/>',
  hill:  '<path class="g1" d="M2 25 12 10h8l10 15z"/>',
  town:  '<path class="g1" d="M6 26V13h9v13zM17 26v-8h9v8z"/>',
  marsh: '<path class="g2" d="M4 13h8v2.4H4zM15 13h9v2.4h-9zM4 19h11v2.4H4zM18 19h10v2.4H18zM7 25h9v2.4H7zM19 25h9v2.4h-9z"/>',
  river: '',
  ford:  '<path class="g3" d="M8 12h5v5H8zM19 15h5v5h-5zM12 21h5v5h-5z"/>',
  road:  '',
  open:  '',
};

export function terrain(kind, links){
  let line = '';
  if(kind === 'road' || kind === 'river' || kind === 'ford'){
    let d = '';
    if(links & 1) d += 'M16 16V0';
    if(links & 2) d += 'M16 16H32';
    if(links & 4) d += 'M16 16V32';
    if(links & 8) d += 'M16 16H0';
    if(!d) d = 'M6 16h20';
    line = `<path class="ln ln--${kind === 'road' ? 'road' : 'water'}" d="${d}"/>`;
  }
  const g = GROUND[kind] || '';
  if(!g && !line) return '';
  return `<svg class="flat" viewBox="0 0 32 32" aria-hidden="true">${line}${g}</svg>`;
}

export function cell(kind){ return 'fg fg--' + kind; }
export const name = 'flat';
