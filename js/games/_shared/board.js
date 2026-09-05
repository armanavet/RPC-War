/* ============================================================
   The wargame board, shared by every game built on the control
   field. Everything that touches the DOM for the board itself
   lives here; a game supplies a description of its own state and
   gets back a rendered map with input wired up.

   Three layers, in this order:

     .cells    terrain, and the control shading that is the whole
               point of the thing
     .marks    objectives, the front contour, selection, legal moves
     .units    the counters, positioned absolutely so that moving
               one is a transform and therefore an animation

   The front contour deserves a note. It is not drawn as a line: it
   is drawn as edges between cells whose owners differ, one edge at a
   time. That is the only way to get a line that bends around a
   salient and closes around a pocket without anybody having to
   compute what a salient or a pocket is. It falls out of comparing
   each cell with the neighbour to its right and the one below.

   SKINS

   Nothing here knows what anything looks like. A game passes a skin:

     skin.name          a class put on the board root; the game's own
                        stylesheet hangs everything off it
     skin.unit(u)       markup for one counter
     skin.terrain(k, links, i)   markup for one square of ground
     skin.cell(k, i)    optional extra classes for a square

   That indirection exists because the four games deliberately look
   nothing like each other — pixel art, painted tokens, flat poster
   illustration and a woodcut — and the moment any of that leaked in
   here, the next skin would have had to fight it.
   ============================================================ */
import {TERRAIN, owner} from './control.js';

/* Taken from the terrain table rather than written out again here.
   It was a hand-kept list once, and the day fortification was added
   to the engine every wall, tower, gate and keep resolved to
   `undefined` and the siege game rendered a castle made of nothing. */
const TERR_KEY = TERRAIN.map(t => t.key);

/* Which neighbours share this terrain, as a north-east-south-west
   bitmask, so roads and rivers join up across cell boundaries. */
function links(geo, ter, i, kinds){
  const r = geo.rowOf(i), c = geo.colOf(i);
  let m = 0;
  const same = (rr, cc) => geo.inB(rr, cc) && kinds.includes(ter[geo.at(rr, cc)]);
  if(same(r - 1, c)) m |= 1;
  if(same(r, c + 1)) m |= 2;
  if(same(r + 1, c)) m |= 4;
  if(same(r, c - 1)) m |= 8;
  return m;
}

export function mountBoard(opts){
  const {el, geo, objectives, objValue, skin} = opts;
  const {W, H, SZ} = geo;

  el.style.setProperty('--cols', W);
  el.style.setProperty('--rows', H);
  if(skin && skin.name) el.classList.add('sk-' + skin.name);

  const cellsEl = document.createElement('div'); cellsEl.className = 'cells';
  const marksEl = document.createElement('div'); marksEl.className = 'marks';
  const unitsEl = document.createElement('div'); unitsEl.className = 'units';
  el.append(cellsEl, marksEl, unitsEl);

  const cells = new Array(SZ), marks = new Array(SZ);
  for(let i = 0; i < SZ; i++){
    const c = document.createElement('div');
    c.className = 'cell';
    cells[i] = c; cellsEl.appendChild(c);
    const m = document.createElement('div');
    m.className = 'mark';
    marks[i] = m; marksEl.appendChild(m);
  }

  let flip = false;
  const dsp = i => flip ? (SZ - 1 - i) : i;

  /* Terrain is painted once and only repainted when it changes,
     which is rare — an engineer bridging a river is the only thing
     in any of the three games that edits the map. */
  let terrainSig = '';
  function paintTerrain(ter){
    const sig = ter.join(',');
    if(sig === terrainSig) return;
    terrainSig = sig;
    for(let i = 0; i < SZ; i++){
      const kind = TERR_KEY[ter[i]];
      const cell = cells[dsp(i)];
      cell.dataset.terr = kind;
      let lk = 0;
      if(kind === 'road') lk = links(geo, ter, i, [6]);
      else if(kind === 'river' || kind === 'ford') lk = links(geo, ter, i, [4, 5]);
      /* the mask is in board space; flipping the board rotates it 180 */
      if(flip && lk) lk = ((lk << 2) | (lk >> 2)) & 15;
      cell.innerHTML = skin.terrain(kind, lk, i) || '';
      const extra = skin.cell ? skin.cell(kind, i) : '';
      cell.className = 'cell' + (extra ? ' ' + extra : '');
    }
  }

  /* Objectives are permanent furniture, drawn into the marks layer
     under everything else that layer does. */
  /* Objectives are the win condition, so they are drawn as the
     loudest permanent thing on the map. An earlier version used a
     small dashed circle and it disappeared under the territory wash
     the moment anybody actually held one — which is precisely when a
     player most needs to see it. */
  const objRing = new Array(SZ).fill('');
  objectives.forEach((i, n) => {
    const pips = objValue ? objValue[n] : 1;
    objRing[i] = '<span class="obj"><span class="obj__ring"></span>' +
      '<span class="obj__val">' + pips + '</span></span>';
  });

  const unitEls = new Map();          // unit key -> element

  function render(v){
    paintTerrain(v.terrain);

    /* ---- shading and the contour ----
       Two games shade by live control; one shades by ground that has
       actually changed hands, which is a different and slower thing.
       `v.ground` picks the second: 0 blue, 1 red, anything else
       nobody. The contour then follows whichever of the two is the
       real border in that game. */
    const f = v.control;
    const g = v.ground;
    for(let i = 0; i < SZ; i++){
      const cell = cells[dsp(i)];
      const val = f[i];
      const own = g ? (g[i] === 0 ? 0 : g[i] === 1 ? 1 : -1) : owner(val);
      /* Alpha rises fast at first and then flattens: the difference
         between "just yours" and "solidly yours" is what a player
         needs to see, and beyond about eight it stops mattering.

         The ceiling is low on purpose. The first version ran the wash
         up to full opacity and the board came out as two slabs of
         poster paint with the front line invisible inside them —
         which is the one thing the shading exists to show. Territory
         is a tint over the map, never a replacement for it. */
      const a = g ? (own === -1 ? 0 : 0.26) : Math.min(0.40, Math.abs(val) * 0.052);
      cell.style.setProperty('--ctl', a.toFixed(3));
      cell.dataset.own = own === -1 ? 'x' : (own === 0 ? 'b' : 'r');

      const ownAt = j => g ? (g[j] === 0 ? 0 : g[j] === 1 ? 1 : -1) : owner(f[j]);
      let edge = '';
      const r = geo.rowOf(i), c = geo.colOf(i);
      if(c + 1 < W && ownAt(geo.at(r, c + 1)) !== own) edge += 'e';
      if(r + 1 < H && ownAt(geo.at(r + 1, c)) !== own) edge += 's';
      cell.dataset.edge = edge;
      /* Masonry damage, for the one game that has any. Shown on the
         cell rather than as a number, so a wall about to come down
         looks like a wall about to come down. */
      if(v.wear) cell.dataset.wear = v.wear[i] || 0;
    }

    /* ---- marks ---- */
    for(let i = 0; i < SZ; i++){
      const m = marks[dsp(i)];
      let cls = 'mark', html = objRing[i];
      if(v.command && v.command[i]) cls += ' mark--cmd';
      if(v.selected === i) cls += ' mark--sel';
      if(v.targets && v.targets.has(i)){
        cls += ' mark--to';
        html += '<span class="dot"></span>';
      }
      if(v.lastFrom === i) cls += ' mark--from';
      if(v.lastTo === i) cls += ' mark--last';
      if(v.danger && v.danger[i]) cls += ' mark--danger';
      /* Ground about to change hands, or a sector about to give. Both
         are things the player must be able to see coming — a tide you
         cannot read is just a rule that keeps surprising you. */
      if(v.pending && v.pending[i]) cls += ' mark--pending';
      if(v.press && v.press[i]){
        cls += ' mark--press';
        html += '<span class="press" style="--p:' + v.press[i] + '"></span>';
      }
      m.className = cls;
      m.innerHTML = html;
    }

    /* ---- counters ---- */
    const seen = new Set();
    for(const u of v.units){
      seen.add(u.key);
      let e = unitEls.get(u.key);
      if(!e){
        e = document.createElement('div');
        e.className = 'unit';
        unitsEl.appendChild(e);
        unitEls.set(u.key, e);
        e.dataset.fresh = '1';
      }
      const d = dsp(u.sq);
      e.style.setProperty('--x', geo.colOf(d));
      e.style.setProperty('--y', geo.rowOf(d));
      const cls = 'unit unit--' + (u.side === 0 ? 'b' : 'r')
                + (u.cut ? ' unit--cut' : '')
                + (u.dim ? ' unit--dim' : '')
                + (u.sel ? ' unit--sel' : '');
      if(e.className !== cls) e.className = cls;
      const sig = u.mark + '|' + u.strength + '|' + (u.cut ? 1 : 0)
                + '|' + u.side + '|' + (u.tag || '');
      if(e.dataset.sig !== sig){
        e.dataset.sig = sig;
        e.innerHTML = skin.unit(u);
      }
      e.title = u.title || '';
    }
    for(const [k, e] of unitEls){
      if(seen.has(k)) continue;
      e.classList.add('unit--gone');
      const el2 = e;
      setTimeout(() => el2.remove(), 260);
      unitEls.delete(k);
    }
  }

  /* ---- input ----
     Click a counter, then click where it should go. Pointer events
     rather than mouse events so a finger works, and the square is
     worked out from the pointer position rather than from an element
     under it — the counters sit above the cells and would otherwise
     eat every click. */
  function squareAt(x, y){
    const r = el.getBoundingClientRect();
    if(!r.width) return -1;
    const c = Math.floor((x - r.left) / r.width * W);
    const w = Math.floor((y - r.top) / r.height * H);
    if(c < 0 || c >= W || w < 0 || w >= H) return -1;
    return dsp(w * W + c);
  }
  el.addEventListener('pointerdown', e => {
    if(e.button > 0) return;
    const i = squareAt(e.clientX, e.clientY);
    if(i >= 0) opts.onPick(i);
  });

  return {
    render,
    setFlip(v){ flip = v; terrainSig = ''; },
    squareAt,
  };
}
