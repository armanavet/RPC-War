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
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const W = 640, H = 272;

/* Straight out of the light palette in css/tokens.css. */
const LITE = '#EBE2CE', DARK = '#CFC0A2', EDGE = '#BCAC8C';

/* A card is 310px wide on a phone, less than half what it is authored
   at — so the crop is chosen for how it reads *there*, not here. Nine
   columns put each piece at about 30 display pixels: the emblems went
   illegible and the board read as noise. `cell` is therefore set
   directly rather than derived from a column count, at a size that
   divides the height evenly so no row is sliced through the middle.

   A position per game: [column, row, sprite], 0,0 at the top left of
   the crop. Chosen to look like a game a few moves in — symmetrical
   setups read as a screenshot of the start screen, which is duller. */
const GAMES = {
  'rps-chess': {
    cell: 136, dir: 'img/1', inset: 0.06,
    pieces: [
      [0, 0, 'r1c1'], [2, 0, 'r1c2'], [3, 0, 'r1c0'],
      [1, 1, 'r0c0'], [2, 1, 'r1c1'], [4, 1, 'r0c2'],
    ],
  },
  anvil: {
    /* Crowded around the middle, because that is the whole game — and
       so the two cards do not resolve to the same picture of scattered
       discs at thumbnail size. */
    cell: 136, dir: 'img/anvil', inset: 0.10,
    pieces: [
      [1, 0, 'r'], [2, 0, 'r'], [3, 0, 'b'],
      [0, 1, 'b'], [2, 1, 'b'], [3, 1, 'r'], [4, 1, 'r'],
    ],
  },
};

function boardSvg(cols, rows, cell, scale = 1){
  const W = 640 * scale, H = 272 * scale;
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

/* Rendered once per pixel density rather than resized afterwards.

   sharp applies resize BEFORE composite whatever order you call them
   in — so scaling the finished card up to 2x actually scaled the empty
   board and then pasted the pieces at their original coordinates,
   crowding every one of them into the top-left quarter. The 1x file
   was correct, so it only showed on devices that pick @2x: phones. */
async function card(slug, scale){
  const g = GAMES[slug];
  const cell = g.cell * scale;
  const cols = Math.ceil((W * scale) / cell);
  const rows = Math.ceil((H * scale) / cell);
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
  await sharp(Buffer.from(boardSvg(cols, rows, cell, scale)))
    .composite(layers)
    .webp({quality: scale > 1 ? 82 : 86, effort: 6})
    .toFile(`img/cards/${slug}${scale > 1 ? '@2x' : ''}.webp`);
  console.log(`  ${slug}: ${cols}x${rows} cells of ${cell}px, ${g.pieces.length} pieces`);
}

for(const slug of Object.keys(GAMES)){ await card(slug, 1); await card(slug, 2); }

/* Regenerated art keeps its filename, so browsers and CDNs happily
   serve the copy they already have — which is how a card that had been
   fixed twice still looked wrong on a phone. A content hash written
   into a tiny generated module gives the URLs something to change. */
const h = createHash('sha1');
for(const slug of Object.keys(GAMES)){
  h.update(await readFile(`img/cards/${slug}.webp`));
  h.update(await readFile(`img/cards/${slug}@2x.webp`));
}
const version = h.digest('hex').slice(0, 8);
const banner = '/* GENERATED by tools/make-cards.mjs - do not edit. */';
await writeFile('js/site/art-version.js',
  banner + '\n' + "export const ART_V = '" + version + "';" + '\n', 'utf8');

console.log(`cards drawn from the real board and the real pieces (v${version})`);
