/* ============================================================
   Online play for Anvil. Everything real lives in
   js/net/matchsync.js and is shared with every other game.
   ============================================================ */
import {createSync} from '../../net/matchsync.js';
import {game, reset, move} from './state.js';
import * as ui from './ui.js';

const mp = createSync({
  slug: 'anvil',
  state: {game, reset, move},
  ui,
  reasons: {
    anvil:   'held the anvil',
    wipeout: 'shoved into the sea',
    nomoves: 'no move left',
  },
});

export const {
  mpCreate, mpJoin, mpLeave, mpRematch, mpResign, mpClaimAbandon,
  mpCopy, pushMove, mpFindMatch, mpLeaveQueue, sendChat, autoJoinFromHash,
} = mp;
