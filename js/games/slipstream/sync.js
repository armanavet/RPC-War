/* ============================================================
   Online play for Slipstream.

   Everything real lives in js/net/matchsync.js and is shared with
   every other game. This only says which game it is.
   ============================================================ */
import {createSync} from '../../net/matchsync.js';
import {game, reset, move} from './state.js';
import * as ui from './ui.js';

const mp = createSync({
  slug: 'slipstream',
  state: {game, reset, move},
  ui,
  reasons: {
    wipeout: 'no pieces left',
    nomoves: 'nowhere left to slide',
    capped:  'neither side could finish it',
  },
});

export const {
  mpCreate, mpJoin, mpLeave, mpRematch, mpResign, mpClaimAbandon,
  mpCopy, pushMove, mpFindMatch, mpLeaveQueue, sendChat, autoJoinFromHash,
} = mp;
