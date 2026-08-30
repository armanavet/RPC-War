/* ============================================================
   The homepage card images.

   These used to be generated illustrations of a board game — which
   looked like generated illustrations of a board game, and showed a
   thing that was not the game you get when you click Play.

   So they are drawn from the real parts instead: the actual board
   colours out of css/tokens.css, and the actual piece sprites the
   game renders, composited into a wide crop of a real position. A
   card is now a photograph of the game rather than an impression of
   it, and it cannot drift out of date without the game changing too.

     npm install sharp && node tools/make-cards.mjs
   ============================================================ */
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';

const W = 640, H = 272;

/* Straight out of the light palette in css/tokens.css. */
const LITE = '#EBE2CE', DARK = '#CFC0A2', EDGE = '#BCAC8C';

/* A position per game: [column, row, sprite] with 0,0 top left of the
   crop. Chosen to look like a game a few moves in — symmetrical setups
   read as a screenshot of the start screen, which is duller. */
const GAMES = {
  'rps-chess': {
    cols: 9, rows: 4, dir: 'img/1', inset: 0.07,
    pieces: [
      [1, 0, 'r1c1'], [4, 0, 'r1c2'], [7, 0, 'r1c1'],
      [2, 1, 'r1c0'], [5, 1, 'r1c2'], [8, 1, 'r0c1'],
      [0, 2, 'r0c0'], [3, 2, 'r0c1'], [6, 2, 'r1c0'],
      [2, 3, 'r0c2'], [5, 3, 'r0c0'], [7, 3, 'r0c2'],
    ],
  },
  anvil: {
    cols: 6, rows: 3, dir: 'img/anvil', inset: 0.12,
    pieces: [
      [0, 0, 'r'], [2, 0, 'r'], [4, 0, 'r'],
      [2, 1, 'b'], [3, 1, 'r'],
      [1, 2, 'b'], [3, 2, 'b'], [5, 2, 'b'],
    ],
  },
};

function boardSvg(cols, rows, cell){
  const parts = [`<rect width="${W}" height="${H}" fill="${LITE}"/>`];
  for(let r = 0; r < rows; r++){
    for(let c = 0; c < cols; c++){
      if((r + c) % 2 === 0) continue;
      parts.push(`<rect x="${(c * cell).toFixed(1)}" y="${(r * cell).toFixed(1)}" `
        + `width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${DARK}"/>`);
    }
  }
  /* Hairline grid, and a soft press at the top edge so the crop reads as
     part of a physical board rather than a flat swatch. */
  for(let c = 1; c < cols; c++)
    parts.push(`<line x1="${(c*cell).toFixed(1)}" y1="0" x2="${(c*cell).toFixed(1)}" y2="${H}" `
      + `stroke="${EDGE}" stroke-width="1" opacity=".5"/>`);
  for(let r = 1; r < rows; r++)
    parts.push(`<line x1="0" y1="${(r*cell).toFixed(1)}" x2="${W}" y2="${(r*cell).toFixed(1)}" `
      + `stroke="${EDGE}" stroke-width="1" opacity=".5"/>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#vig)"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>`
    + `<linearGradient id="vig" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="#000000" stop-opacity=".10"/>`
    + `<stop offset=".35" stop-color="#000000" stop-opacity="0"/>`
    + `<stop offset="1" stop-color="#000000" stop-opacity=".07"/></linearGradient>`
    + `</defs>${parts.join('')}</svg>`;
}

async function card(slug){
  const g = GAMES[slug];
  const cell = W / g.cols;
  const rows = Math.ceil(H / cell);
  const size = Math.round(cell * (1 - g.inset * 2));
  const pad = Math.round(cell * g.inset);

  const layers = [];
  const place = async (c, r, file, dy = 0) => {
    const buf = await sharp(`${g.dir}/${file}.webp`)
      .resize(size, size, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}})
      .toBuffer();
    layers.push({input: buf, left: Math.round(c * cell + pad), top: Math.round(r * cell + pad + dy)});
  };

  for(const [c, r, file] of (g.pieces || [])) await place(c, r, file);
  await mkdir('img/cards', {recursive: true});
  const base = sharp(Buffer.from(boardSvg(g.cols, rows, cell))).composite(layers);
  await base.clone().webp({quality: 86, effort: 6}).toFile(`img/cards/${slug}.webp`);
  await base.clone().resize(W * 2, H * 2, {kernel: 'lanczos3'})
    .webp({quality: 82, effort: 6}).toFile(`img/cards/${slug}@2x.webp`);
  console.log(`  ${slug}: ${g.cols} cols, ${g.pieces.length} placements`);
}

for(const slug of Object.keys(GAMES)) await card(slug);
console.log('cards drawn from the real board and the real pieces');
