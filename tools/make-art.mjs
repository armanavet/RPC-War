/* ============================================================
   Piece art for the games whose generated sheets could not be used.
   Drawn as vector here, rasterised to the same sprite sizes that
   tools/make-sprites.mjs produces from the generated sheets.

   Why drawn rather than generated: those sheets arrived on grounds
   that collide with the art (grey slate on a grey checkerboard), or
   in three-quarter perspective when a board needs straight-down.
   Drawing gives exact brand colours, a correct silhouette, and clean
   edges at the ~41px a piece occupies on a phone.

   The shared language matches sheet 1 so all four games read as one
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

/* Slipstream: a domed glass counter. The dome is the whole shape. */
function counter(side){
  const c = SIDES[side];
  const defs = [
    '<radialGradient id="g" cx="38%" cy="32%" r="78%">',
    '<stop offset="0" stop-color="', c.lite, '"/>',
    '<stop offset=".62" stop-color="', c.main, '"/>',
    '<stop offset="1" stop-color="', c.dark, '"/></radialGradient>',
  ].join('');
  const body = [
    '<ellipse cx="128" cy="198" rx="102" ry="24" fill="#000000" opacity=".20" filter="url(#soft)"/>',
    '<circle cx="128" cy="126" r="110" fill="url(#g)"/>',
    '<circle cx="128" cy="126" r="110" fill="none" stroke="', c.dark, '" stroke-width="4" opacity=".5"/>',
    '<ellipse cx="98" cy="88" rx="50" ry="32" fill="#ffffff" opacity=".40"/>',
    '<ellipse cx="152" cy="176" rx="44" ry="18" fill="#ffffff" opacity=".12"/>',
  ].join('');
  return svg(body, defs);
}

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

/* Cairn: n slate discs with the top one painted. Anchored to the
   bottom of the cell so stacks of different heights sit level. */
function stack(side, n){
  const c = SIDES[side];
  const step = 30, baseY = 206;
  const out = ['<ellipse cx="128" cy="220" rx="96" ry="22" fill="#000000" opacity=".20" filter="url(#soft)"/>'];
  for(let i = 0; i < n; i++){
    const y = baseY - i * step, top = i === n - 1, rx = 96 - i * 3, ry = rx * 0.34;
    out.push(
      '<ellipse cx="128" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + (top ? c.dark : SLATE_D) + '"/>',
      '<ellipse cx="128" cy="' + (y - 9) + '" rx="' + rx + '" ry="' + ry + '" fill="' + (top ? c.main : SLATE) + '"/>',
      '<ellipse cx="' + Math.round(128 - rx * 0.28) + '" cy="' + (y - 14) + '" rx="' + Math.round(rx * 0.42) +
        '" ry="' + Math.round(rx * 0.13) + '" fill="#ffffff" opacity="' + (top ? '.20' : '.26') + '"/>');
  }
  return svg(out.join(''));
}

/* Cairn draws a stack as offset discs, one per stone, each coloured by
   whoever owns it — so it needs a single stone, not a whole stack. */
function stone(side){
  const c = SIDES[side];
  return svg([
    '<ellipse cx="128" cy="176" rx="104" ry="34" fill="', c.dark, '"/>',
    '<ellipse cx="128" cy="150" rx="104" ry="34" fill="', c.main, '"/>',
    '<ellipse cx="128" cy="150" rx="104" ry="34" fill="none" stroke="', c.dark,
      '" stroke-width="3" opacity=".5"/>',
    '<ellipse cx="98" cy="138" rx="44" ry="13" fill="#ffffff" opacity=".24"/>',
  ].join(''));
}

/* Neutral furniture. */
function wall(){
  return svg([
    '<rect x="18" y="20" width="220" height="216" rx="16" fill="', SLATE_D, '"/>',
    '<rect x="18" y="18" width="220" height="210" rx="16" fill="', SLATE, '"/>',
    '<g stroke="', SLATE_D, '" stroke-width="7" stroke-linecap="round" opacity=".8">',
    '<path d="M18 88h220M18 158h220M88 18v70M158 88v70M88 158v70"/></g>',
    '<rect x="18" y="18" width="220" height="210" rx="16" fill="url(#fall)"/>',
  ].join(''));
}

function ring(){
  return svg([
    '<circle cx="128" cy="128" r="106" fill="none" stroke="', SLATE_D, '" stroke-width="26"/>',
    '<circle cx="128" cy="128" r="106" fill="none" stroke="', SLATE, '" stroke-width="16"/>',
    '<circle cx="128" cy="128" r="106" fill="none" stroke="#ffffff" stroke-width="4" opacity=".22"/>',
  ].join(''));
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
  await write('slipstream', side, counter(side));
  await write('anvil', side, weight(side));
  await write('cairn', side, stone(side));
}
await write('slipstream', 'wall', wall());
await write('slipstream', 'ring', ring());
await write('anvil', 'mark', anvilMark());

console.log('slipstream: 2 counters + wall + ring');
console.log('anvil:      2 weights + centre mark');
console.log('cairn:      2 stones (stacked by the DOM, not baked in)');
