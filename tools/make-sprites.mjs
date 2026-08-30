/* ============================================================
   Turn the generated sheets in sprites/ into shippable assets.

   The generators hand back JPEGs, which cannot carry alpha — so a
   "transparent" sheet arrives with the checkerboard *painted in*,
   and other sheets arrive on a flat colour. This script learns the
   background from the border, removes only the background actually
   connected to the edge (so a white highlight inside a piece
   survives), finds each item, and writes one trimmed sprite per
   cell plus a packed sheet.

   Offline asset step, like tools/sync-rules.py. Not part of the
   site, not needed to run it. Needs sharp:

     npm install sharp
     node tools/make-sprites.mjs

   ============================================================ */
import sharp from 'sharp';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const SRC = 'sprites', OUT = 'img';

/* Colour distance in plain RGB is good enough here: the backgrounds
   are flat greys and creams, and the art is saturated. */
const dist = (a, b, c, r, g, bl) =>
  Math.abs(a - r) + Math.abs(b - g) + Math.abs(c - bl);

/* Learn the background from a border ring. A checkerboard gives two
   clusters, a flat ground gives one; we keep up to two. */
function learnBackground(data, w, h, ch){
  const seen = new Map();
  const sample = (x, y) => {
    const i = (y * w + x) * ch;
    const key = `${data[i] >> 3},${data[i+1] >> 3},${data[i+2] >> 3}`;
    const e = seen.get(key) || {n: 0, r: 0, g: 0, b: 0};
    e.n++; e.r += data[i]; e.g += data[i+1]; e.b += data[i+2];
    seen.set(key, e);
  };
  for(let x = 0; x < w; x += 2){ sample(x, 0); sample(x, h - 1); }
  for(let y = 0; y < h; y += 2){ sample(0, y); sample(w - 1, y); }
  return [...seen.values()]
    .sort((a, b) => b.n - a.n).slice(0, 2)
    .map(e => [e.r / e.n, e.g / e.n, e.b / e.n]);
}

/* Measure the checkerboard.

   The lit rim of a maple token is very nearly the same white as the
   board's white squares, so no colour threshold can separate them and
   the flood fill walks straight from the ground into the rim. The
   checkerboard is a strict grid though: a pixel is background only if
   it matches the colour its own grid square *should* be. White sitting
   where a dark square belongs is paint, not ground. */
function detectChecker(data, w, h, ch, bg){
  if(bg.length < 2) return null;
  const cls = (x, y) => {
    const i = (y * w + x) * ch;
    const d0 = dist(bg[0][0], bg[0][1], bg[0][2], data[i], data[i+1], data[i+2]);
    const d1 = dist(bg[1][0], bg[1][1], bg[1][2], data[i], data[i+1], data[i+2]);
    return d0 <= d1 ? 0 : 1;
  };
  const runs = [];
  for(const y of [1, 2, h - 2]){
    let last = cls(0, y), n = 1;
    for(let x = 1; x < w; x++){
      const c = cls(x, y);
      if(c === last) n++;
      else { if(n > 2 && n < 200) runs.push(n); last = c; n = 1; }
    }
  }
  if(runs.length < 8) return null;
  runs.sort((a, b) => a - b);
  const period = runs[runs.length >> 1];
  if(period < 4 || period > 120) return null;
  /* phase: which colour the square containing (0,0) actually is */
  return {period, phase: cls(1, 1)};
}

/* Alpha from a flood fill inwards from the border. Anything matching
   a background colour *and reachable from the edge* goes; everything
   else stays, which is what protects pale highlights inside art. */
function keyOut(data, w, h, ch, bg, tol, neutral, checker, warm){
  const alpha = new Uint8Array(w * h).fill(255);
  const stack = [];
  const isBg = p => {
    const i = p * ch;
    const r = data[i], g = data[i+1], b = data[i+2];
    if(checker){
      const x = p % w, y = (p / w) | 0;
      const want = bg[(((x / checker.period) | 0) + ((y / checker.period) | 0)
                       + checker.phase) % 2];
      return dist(want[0], want[1], want[2], r, g, b) < tol;
    }
    if(bg.some(c => dist(c[0], c[1], c[2], r, g, b) < tol)) return true;
    /* Warmth beats brightness. A painted checkerboard is perfectly
       neutral (R=G=B) and stays neutral under a drop shadow, while
       maple is warm by ~56 and the pieces are saturated. So on those
       sheets "neutral, at any lightness" is the ground, and the lit
       rim that no brightness threshold could keep is kept. Only for
       art with no neutral greys on its silhouette. */
    if(warm && Math.abs(r - b) < warm.dw && Math.abs(g - (r + b) / 2) < warm.dg) return true;
    /* The drop shadow under a piece darkens the ground without matching
       either learned colour, and left a bright halo around every token.
       Ground and shadow are both *neutral*; the art is not — so treat any
       desaturated pixel the flood fill can reach as background too. */
    if(neutral){
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if(mx - mn < neutral.sat && mx >= neutral.lo) return true;
    }
    return false;
  };
  const push = p => { if(alpha[p] === 255 && isBg(p)){ alpha[p] = 0; stack.push(p); } };
  for(let x = 0; x < w; x++){ push(x); push((h - 1) * w + x); }
  for(let y = 0; y < h; y++){ push(y * w); push(y * w + w - 1); }
  while(stack.length){
    const p = stack.pop(), x = p % w, y = (p / w) | 0;
    if(x > 0) push(p - 1);
    if(x < w - 1) push(p + 1);
    if(y > 0) push(p - w);
    if(y < h - 1) push(p + w);
  }
  return alpha;
}

/* Pull the matte in a few pixels.

   A soft drop shadow sits between the art and the ground and matches
   neither, so a binary key leaves it as a bright halo ringing every
   piece. Colour tests to remove it also eat lit highlights on pale
   wood. Eroding is blunter and better: the halo is a thin ring, the
   pieces are ~200px, and losing three pixels off a token is invisible
   while losing the halo is the whole job. */
function erodeMask(alpha, w, h, n){
  let cur = alpha;
  for(let pass = 0; pass < n; pass++){
    const next = Uint8Array.from(cur);
    for(let y = 0; y < h; y++){
      for(let x = 0; x < w; x++){
        const p = y * w + x;
        if(cur[p] === 0) continue;
        if((x > 0 && cur[p-1] === 0) || (x < w-1 && cur[p+1] === 0) ||
           (y > 0 && cur[p-w] === 0) || (y < h-1 && cur[p+w] === 0)) next[p] = 0;
      }
    }
    cur = next;
  }
  return cur;
}

/* Feather one pixel so keyed edges are not aliased against the board. */
function soften(alpha, w, h){
  const out = Uint8Array.from(alpha);
  for(let y = 1; y < h - 1; y++){
    for(let x = 1; x < w - 1; x++){
      const p = y * w + x;
      if(alpha[p] !== 255) continue;
      let open = 0;
      for(const q of [p-1, p+1, p-w, p+w]) if(alpha[q] === 0) open++;
      if(open) out[p] = 255 - open * 45;
    }
  }
  return out;
}

/* Find item bands: runs of rows/columns that contain any opaque pixel. */
function bands(alpha, w, h, along){
  const n = along === 'x' ? w : h, m = along === 'x' ? h : w;
  const hit = new Array(n).fill(false);
  for(let i = 0; i < n; i++){
    for(let j = 0; j < m; j++){
      const p = along === 'x' ? j * w + i : i * w + j;
      if(alpha[p] > 24){ hit[i] = true; break; }
    }
  }
  const out = []; let s = -1;
  for(let i = 0; i <= n; i++){
    if(hit[i] && s < 0) s = i;
    else if(!hit[i] && s >= 0){ if(i - s > n * 0.02) out.push([s, i]); s = -1; }
  }
  return out;
}

async function cutSheet(name, {tol = 48, pad = 0.06,
                              neutral = null, erode = 3, useGrid = false,
                              warm = null} = {}){
  const file = path.join(SRC, name + '.jpg');
  const {data, info} = await sharp(file).raw().toBuffer({resolveWithObject: true});
  /* Take the size from the decoded buffer, never from metadata: an EXIF
     orientation makes the two disagree and every extract then lands
     outside the image. */
  const {width: w, height: h, channels: ch} = info;

  const bg = learnBackground(data, w, h, ch);
  /* Opt-in. A generated checkerboard drifts out of phase across the
     sheet, so the grid model under-keys far from the origin and whole
     rows merge together. Tight per-colour tolerance does better. */
  const checker = useGrid ? detectChecker(data, w, h, ch, bg) : null;
  let alpha = keyOut(data, w, h, ch, bg, tol, neutral, checker, warm);
  if(erode) alpha = erodeMask(alpha, w, h, erode);
  alpha = soften(alpha, w, h);

  const rgba = Buffer.alloc(w * h * 4);
  for(let p = 0; p < w * h; p++){
    rgba[p*4] = data[p*ch]; rgba[p*4+1] = data[p*ch+1];
    rgba[p*4+2] = data[p*ch+2]; rgba[p*4+3] = alpha[p];
  }

  const cols = bands(alpha, w, h, 'x'), rows = bands(alpha, w, h, 'y');
  console.log(`  ${name}: ${checker ? `checker ${checker.period}px` : 'flat ground'}, `
    + `${cols.length}x${rows.length} items`);

  await mkdir(path.join(OUT, name), {recursive: true});
  const base = sharp(rgba, {raw: {width: w, height: h, channels: 4}});
  let n = 0;
  for(let r = 0; r < rows.length; r++){
    for(let c = 0; c < cols.length; c++){
      const [x0, x1] = cols[c], [y0, y1] = rows[r];
      const px = Math.round((x1 - x0) * pad), py = Math.round((y1 - y0) * pad);
      const left = Math.max(0, x0 - px), top = Math.max(0, y0 - py);
      const width = Math.min(w - left, x1 - x0 + px * 2);
      const height = Math.min(h - top, y1 - y0 + py * 2);
      /* Encode in one pass. toBuffer() on a raw-input pipeline hands
         back raw pixels, not a PNG, so re-opening it fails.

         No .trim() here: sharp orders trim *before* extract whatever
         order you call them in, so trimming the sheet's transparent
         border shifts every later extract out of bounds. The bands
         above are already tight, and equal-sized cells are what a
         sprite sheet wants anyway. */
      const ok = await base.clone()
        .extract({left, top, width, height})
        .webp({quality: 90, effort: 6})
        .toFile(path.join(OUT, name, `r${r}c${c}.webp`))
        .then(() => true).catch(e => { console.log('       skip', r, c, e.message.slice(0, 60)); return false; });
      if(ok) n++;
    }
  }
  console.log(`     wrote ${n} sprites -> ${OUT}/${name}/`);
  return {cols: cols.length, rows: rows.length};
}

/* The card art is four finished illustrations in a 2x2 grid, no
   keying wanted — just cut and size for the homepage cards. */
async function cutCards(){
  const file = path.join(SRC, '6.jpg');
  const {width: w, height: h} = await sharp(file).metadata();
  const names = ['rps-chess', 'slipstream', 'anvil', 'cairn'];
  await mkdir(path.join(OUT, 'cards'), {recursive: true});
  let i = 0;
  for(let r = 0; r < 2; r++){
    for(let c = 0; c < 2; c++){
      const slug = names[i++];
      for(const [suffix, width] of [['', 640], ['@2x', 1280]]){
        await sharp(file)
          .extract({left: c * (w >> 1), top: r * (h >> 1), width: w >> 1, height: h >> 1})
          .resize({width, fit: 'cover'})
          .webp({quality: 82, effort: 6})
          .toFile(path.join(OUT, 'cards', `${slug}${suffix}.webp`));
      }
      console.log(`  card ${slug}`);
    }
  }
}

console.log('sheets:');
/* Tolerances are per sheet because the grounds differ. Keep them tight:
   the lit rim of a maple token is only ~58 away from the board's white
   squares, and anything looser keys the rim off the piece. */
await cutSheet('1', {tol: 60, erode: 2, warm: {dw: 16, dg: 12}});  // RPS Chess (checkerboard)
await cutSheet('2', {tol: 60, erode: 2});   // Slipstream       (flat cream)
await cutSheet('4', {tol: 104, erode: 3});  // Cairn stacks (grey slate: warmth trick cannot help)
await cutSheet('7', {tol: 50, erode: 2});   // avatars          (flat near-white)
console.log('cards:');
await cutCards();
console.log('done');
