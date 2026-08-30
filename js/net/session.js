/* ============================================================
   Shared online-session state, for any game on the site.

   Deliberately just data: a game's UI reads it to decide what to
   draw, its sync module is what writes to it. Keeping it in its own
   module stops those two importing each other.
   ============================================================ */
export const net = {
  on: false,          // are we in an online game at all?
  matchId: null,      // the match row we are playing
  code: null,         // its invite code
  side: 0,            // which seat we play — a game gives 0 and 1 their meaning
  names: ['', ''],    // indexed by seat
  ratings: [null, null],
  me: null,           // our own user id
  ready: false,       // has the other player joined?
  rated: false,
  state: null,        // lobby | live | finished | aborted
  result: null,       // blue | red | draw
  rematchOffer: null, // who has offered one, if anyone
  delta: null,        // our rating change, once the server has applied it
  queued: false,      // waiting in the ranked queue
  canRank: false,     // ranked needs a real account — guests are barred server-side
  abandonable: false, // the opponent has gone quiet long enough to claim
  unwatch: null,
};

/* An invite link points back at whichever game page you are on. */
export const linkFor = c => location.origin + location.pathname + location.search + '#r=' + c;
