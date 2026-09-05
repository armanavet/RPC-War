/* ============================================================
   Tideline's look: painted pieces on a physical board.

   The opposite end of the scale from Salient's pixels. Everything
   here wants to look moulded and lit: domed tokens with a bevel, a
   specular highlight, an embossed emblem and a real cast shadow, on
   a board that looks like lacquered wood with felt regions painted
   onto it.

   The moulding is done in CSS rather than SVG gradients, on purpose.
   An SVG gradient needs an id, ids have to be unique per document,
   and a board with forty pieces on it would mean forty sets of
   near-identical <defs> — so the shape comes from here and all the
   light comes from the stylesheet.
   ============================================================ */

/* Bold emblems. They are struck into the top of a token, so they have
   to read purely as silhouette: anything with a thin part disappears
   the moment it is embossed. */
import {ICON, GRID} from '../_shared/icons.js';

/* The charge struck into the top of a token. Real drawn artwork
   rather than shapes invented here — see CREDITS.md. Anything with a
   thin part disappears once it is embossed, so these are chosen for
   mass: a crown, a shield, a rider, a catapult, a sheaf of spears. */
const EMBLEM = {
  gen: ICON['tid-gen'], inf: ICON['tid-inf'], arm: ICON['tid-arm'],
  art: ICON['tid-art'], mil: ICON['tid-mil'],
};

export function unit(u){
  const side = u.side === 0 ? 'b' : 'r';
  return `<span class="tok tok--${side}">
    <span class="tok__body"></span>
    <svg class="tok__em" viewBox="0 0 ${GRID} ${GRID}" aria-hidden="true">${EMBLEM[u.mark] || ''}</svg>
  </span>`;
}

/* Ground is painted onto the board rather than tiled. Each kind is a
   flat shape with a soft edge and a little hand-drawn detail on top,
   the way a printed board has silk-screened woods and hills. */
const MOTIF = {
  woods:
    '<g class="mo mo--woods">' +
    '<path d="M9 23c0-3 2.6-5 2.6-5s-1.6-.6-1.6-2.4S12.6 9 12.6 9s2.6 4.8 2.6 6.6-1.6 2.4-1.6 2.4S16.2 20 16.2 23z"/>' +
    '<path d="M19 24c0-2.4 2-3.9 2-3.9s-1.2-.5-1.2-1.8S21.8 13 21.8 13s2 3.6 2 5-1.2 1.8-1.2 1.8S25.4 21.6 25.4 24z"/>' +
    '</g>',
  hill:
    '<g class="mo mo--hill"><path d="M3 24c4.5 0 6.5-5.5 8.5-9S15.5 9 17 9s3.5 2.5 5.5 6 4 9 8.5 9z"/>' +
    '<path d="M10 24c2.6 0 3.8-3.2 5-5s2-2.6 2-2.6 .8 .8 2 2.6 2.4 5 5 5z" fill="#000" fill-opacity=".13"/></g>',
  town:
    '<g class="mo mo--town"><path d="M6 26V14l6-4.5 6 4.5v12z"/><path d="M18 26V17l4.5-3.4L27 17v9z"/>' +
    '<rect x="10" y="18" width="3.4" height="4.4" fill="#000" fill-opacity=".3"/></g>',
  marsh:
    '<g class="mo mo--marsh"><path d="M5 14h7M15 14h6M24 14h4M5 20h5M13 20h7M23 20h5M5 26h8M16 26h5M24 26h4"/></g>',
  river: '<g class="mo mo--water"><path d="M2 12c5 0 5 3 10 3s5-3 10-3 5 3 10 3"/><path d="M2 20c5 0 5 3 10 3s5-3 10-3 5 3 10 3"/></g>',
  ford:  '<g class="mo mo--water"><path d="M2 12c5 0 5 3 10 3s5-3 10-3 5 3 10 3"/></g>' +
         '<g class="mo mo--stone"><circle cx="10" cy="21" r="2.6"/><circle cx="17" cy="24" r="2.2"/><circle cx="24" cy="20" r="2.6"/></g>',
  road:  '',
  open:  '',
};

export function terrain(kind, links){
  const motif = MOTIF[kind] || '';
  /* Roads and rivers still join up across squares, because a painted
     board draws them as continuous lines rather than as tiles. */
  let line = '';
  if(kind === 'road' || kind === 'river' || kind === 'ford'){
    let d = '';
    if(links & 1) d += 'M16 16V0';
    if(links & 2) d += 'M16 16H32';
    if(links & 4) d += 'M16 16V32';
    if(links & 8) d += 'M16 16H0';
    if(!d) d = 'M7 16h18';
    line = `<path class="ln ln--${kind === 'road' ? 'road' : 'river'}" d="${d}"/>`;
  }
  if(!motif && !line) return '';
  return `<svg class="paint" viewBox="0 0 32 32" aria-hidden="true">${line}${motif}</svg>`;
}

export function cell(kind){ return 'gr gr--' + kind; }
export const name = 'painted';
