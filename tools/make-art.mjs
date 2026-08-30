/* ============================================================
   Piece art for the games whose generated sheets could not be used.
   Drawn as vector here, rasterised to the same sprite sizes that
   tools/make-sprites.mjs produces from the generated sheets.

   Why drawn rather than generated: those sheets arrived on grounds
   that collide with the art (grey slate on a grey checkerboard), or
   in three-quarter perspective when a board needs straight-down.
   Drawing gives exact brand colours, a correct silhouette, and clean
   edges at the ~41px a piece occupies on a phone.

   The shared language matches sheet 1 so every game reads as one
   set: a round token, a coloured face, one soft light from upper left.

     npm install sharp && node tools/make-art.mjs
   ============================================================ */
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';

const SIDES = {
  b: {main: '#3B6FC4', dark: '#2C568F', lite: '#6E97D6'},
  r: {main: '#C7462F', dark: '#9C3423', lite: '#DA7660'},
};
const MAPLE = '#E0C79C', MAPLE_D = '#B8945F';
const SLATE = '#9AA3AC', SLATE_D = '#6E767E';
const IRON = '#5A6169', IRON_D = '#3C4147';
const S = 256;

const svg = (inner, defs) => [
  '<svg xmlns="http://www.w3.org/2000/svg" width="', S, '" height="', S,
  '" viewBox="0 0 ', S, ' ', S, '"><defs>',
  '<filter id="soft" x="-25%" y="-25%" width="150%" height="150%">',
  '<feGaussianBlur stdDeviation="2.4"/></filter>',
  '<radialGradient id="fall" cx="36%" cy="30%" r="78%">',
  '<stop offset="0" stop-color="#ffffff" stop-opacity=".30"/>',
  '<stop offset="1" stop-color="#000000" stop-opacity=".20"/></radialGradient>',
  defs || '', '</defs>', inner, '</svg>',
].join('');

/* Anvil: a heavy iron weight seen straight down, enamelled in the
   player's colour, with a lifting ring at its centre. */
function weight(side){
  const c = SIDES[side];
  const defs = [
    '<linearGradient id="i" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="', SLATE, '"/><stop offset="1" stop-color="', IRON, '"/></linearGradient>',
    '<radialGradient id="e" cx="38%" cy="32%" r="76%">',
    '<stop offset="0" stop-color="', c.lite, '"/><stop offset="1" stop-color="', c.main, '"/></radialGradient>',
  ].join('');
  const body = [
    '<circle cx="128" cy="134" r="106" fill="#000000" opacity=".20" filter="url(#soft)"/>',
    '<circle cx="128" cy="128" r="106" fill="url(#i)"/>',
    '<circle cx="128" cy="128" r="106" fill="none" stroke="', IRON_D, '" stroke-width="5"/>',
    '<circle cx="128" cy="128" r="74" fill="url(#e)"/>',
    '<circle cx="128" cy="128" r="74" fill="none" stroke="', c.dark, '" stroke-width="4" opacity=".6"/>',
    '<circle cx="128" cy="128" r="30" fill="none" stroke="', IRON_D, '" stroke-width="13" opacity=".85"/>',
    '<circle cx="128" cy="128" r="30" fill="none" stroke="', SLATE, '" stroke-width="5" opacity=".5"/>',
    '<circle cx="128" cy="128" r="106" fill="url(#fall)"/>',
  ].join('');
  return svg(body, defs);
}

function anvilMark(){
  return svg([
    '<path d="M46 96h150l-26 34h30l-16 46H74l-16-46h30z" fill="', IRON,
    '" stroke="', IRON_D, '" stroke-width="6" stroke-linejoin="round"/>',
    '<rect x="86" y="176" width="84" height="26" rx="8" fill="', IRON_D, '"/>',
    '<path d="M62 104h128" stroke="', SLATE, '" stroke-width="7" stroke-linecap="round" opacity=".45"/>',
  ].join(''));
}

async function write(dir, name, markup){
  await mkdir('img/' + dir, {recursive: true});
  await sharp(Buffer.from(markup)).resize(S, S)
    .webp({quality: 92, effort: 6})
    .toFile('img/' + dir + '/' + name + '.webp');
}

for(const side of ['b', 'r']){
  await write('anvil', side, weight(side));
}
await write('anvil', 'mark', anvilMark());

console.log('anvil:      2 weights + centre mark');
