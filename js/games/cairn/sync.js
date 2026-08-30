/* ============================================================
   Online play for Cairn. Everything real lives in
   js/net/matchsync.js and is shared with every other game.
   ============================================================ */
import {createSync} from '../../net/matchsync.js';
import {game, reset, move} from './state.js';
import * as ui from './ui.js';

const mp = createSync({
  slug: 'cairn',
  state: {game, reset, move},
  ui,
  reasons: {
    wipeout: 'ground down',
    nomoves: 'no stack left to move',
    capped:  'neither side could grind the other down',
  },
});

export const {
  mpCreate, mpJoin, mpLeave, mpRematch, mpResign, mpClaimAbandon,
  mpCopy, pushMove, mpFindMatch, mpLeaveQueue, sendChat, autoJoinFromHash,
} = mp;
