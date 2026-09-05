/* ============================================================
   Salient's look: rendered counters on an operations map.

   Struck enamel badges with the light baked into the file, sitting
   on a raster terrain tileset. This is the only one of the four
   skins whose art is pre-rendered rather than drawn live in the
   page, and that is the point of it: everything has real shading and
   nothing is a line.

   The sprites come from tools/build-art.mjs, which renders them from
   Game Icons artwork (game-icons.net, CC BY 3.0 — see CREDITS.md).
   ============================================================ */
const SRC = '../../img/salient/';

/* One <img> per unit. The wrapper carries the state classes so the
   stylesheet can dim, flash or grey a unit without touching the art. */
export function unit(u){
  const side = u.side === 0 ? 'b' : 'r';
  return `<img class="px" src="${SRC}${u.mark}-${side}.png" alt="" draggable="false">`;
}

/* Ground is a tiled sprite, including plain open ground — the noise
   in the grass tile is what stops a board this size reading as graph
   paper. Roads and rivers are whole-tile fills rather than sixteen
   connector variants: at this scale adjacent tiles butt together into
   a continuous band on their own. */
export function terrain(kind){
  return `<img class="px-t" src="${SRC}t-${kind}.png" alt="" draggable="false">`;
}

export const name = 'map';
