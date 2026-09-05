/* ============================================================
   Homepage card art for the three control-field wargames.

   tools/make-cards.mjs builds cards for the two sprite games by
   compositing their piece images. The wargames have no sprites —
   their counters are drawn in SVG at run time — so the only honest
   way to photograph one is to photograph one. This drives a real
   game to a real midgame position in a headless browser and crops a
   wide band through the middle of the board, where the front is.

   Same principle as the older script and for the same reason: a card
   should be the game, not an impression of it, and it should not be
   able to drift out of date without the game changing too.

   Needs the dev server running, plus playwright and sharp, neither
   of which the site itself depends on:

     python tools/serve.py 8000
     npm install playwright sharp && node tools/make-wargame-cards.mjs
   ============================================================ */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';

const OUT = 'img/cards/';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8000';
const W = 640, H = 272;

/* How far into a game each card is taken. Chosen so the front has
   actually bent: a symmetrical opening reads as a start screen, which
   is duller than the thing being advertised. */
const GAMES = [['salient', 46], ['tideline', 56], ['breakthrough', 64], ['barbican', 70]];

await mkdir(OUT, {recursive: true});
const browser = await chromium.launch({executablePath: process.env.CHROME || undefined});
const page = await browser.newPage({viewport: {width: 1600, height: 1100}, deviceScaleFactor: 2});

for(const [slug, plies] of GAMES){
  await page.goto(`${ORIGIN}/games/${slug}/`, {waitUntil: 'networkidle'});
  await page.waitForTimeout(600);
  await page.uncheck('#aiOn');
  await page.waitForTimeout(150);

  /* Drive both sides with the game's own engine, and never photograph
     a finished one: the win overlay covers the board, which is the one
     thing the card exists to show. If the game ends early, start again
     and stop sooner. */
  const drive = (s, n) => page.evaluate(async ([slug, n]) => {
    const S = await import(`/js/games/${slug}/state.js`);
    const A = await import(`/js/games/${slug}/ai.js`);
    for(let i = 0; i < n; i++){
      if(S.game.over) return 'over';
      S.move(A.bestMoveTimed(S.game.st, 3, 90, false));
    }
    return S.game.over ? 'over' : 'ok';
  }, [s, n]);

  let want = plies;
  for(let attempt = 0; attempt < 4; attempt++){
    if(attempt) await page.click('#btnNew');
    await page.waitForTimeout(200);
    if(await drive(slug, want) === 'ok') break;
    want = Math.max(12, Math.round(want * 0.6));
  }
  await page.waitForTimeout(400);

  const box = await page.locator('#board').boundingBox();
  const h = box.width / (W / H);
  const buf = await page.screenshot({
    clip: {x: box.x, y: box.y + (box.height - h) / 2, width: box.width, height: h},
  });
  await sharp(buf).resize(W * 2, H * 2, {fit: 'cover'}).webp({quality: 88})
    .toFile(`${OUT}${slug}@2x.webp`);
  await sharp(buf).resize(W, H, {fit: 'cover'}).webp({quality: 88})
    .toFile(`${OUT}${slug}.webp`);
  console.log('card', slug);
}
await browser.close();
