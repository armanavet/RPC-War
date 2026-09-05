/* ============================================================
   bot-move — plays a bot's turn.

   POST { matchId }   with the caller's Authorization: Bearer <jwt>

   The client calls this after every move it makes and once on
   entering a match. It is deliberately a no-op when the opponent is
   a person: the request goes out in every game, so the fact that it
   went out tells nobody anything.

   Everything that decides whether there is a bot here happens in the
   database. bot_pending() returns a row only when a bot is in this
   match and it is that bot's turn; otherwise this function has no
   idea a bot exists and says so to no one.

   Why it waits before playing: a reply that lands the instant you
   release your piece is the single most obvious tell there is. The
   pause is drawn from the persona's own tempo, scaled by how much
   there is to think about, and the bot touches the match before
   sleeping so the human is never offered "opponent left".

     python tools/sync-rules.py && npx supabase functions deploy bot-move
   ============================================================ */
import {createClient} from 'jsr:@supabase/supabase-js@2';
import * as rpsRules from '../_shared/rps-chess-rules.js';
import * as rpsAi from '../_shared/rps-chess-ai.js';
import * as anvilRules from '../_shared/anvil-rules.js';
import * as anvilAi from '../_shared/anvil-ai.js';
import * as salRules from '../_shared/salient-rules.js';
import * as salAi from '../_shared/salient-ai.js';
import * as tideRules from '../_shared/tideline-rules.js';
import * as tideAi from '../_shared/tideline-ai.js';
import * as brkRules from '../_shared/breakthrough-rules.js';
import * as brkAi from '../_shared/breakthrough-ai.js';
import * as barRules from '../_shared/barbican-rules.js';
import * as barAi from '../_shared/barbican-ai.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* The two board games hand round a plain array; the three wargames
   hand round a state object. `bd` is therefore whatever that game
   calls a position — it is only ever passed straight back in. */
type Engine = {
  start: () => any;
  legal: (bd: any, turn: number) => number[];
  apply: (bd: any, mv: number) => any;
  best: (bd: any, turn: number, depth: number, budget: number) => number | undefined;
  /* how far ahead the side to move is, for the resign decision */
  edge: (bd: any, turn: number) => number;
  /* whose turn a position says it is, where the position knows */
  turn?: (bd: any) => number;
};

/* One adapter for all three control-field games: same module shape,
   same state object, different rules inside. */
function fieldEngine(R: any, A: any, weight: number): Engine {
  return {
    start: () => R.startState(),
    legal: (s) => R.genMoves(s, s.turn),
    apply: (s, mv) => R.apply(s, mv).st,
    best:  (s, _t, d, ms) => A.bestMoveTimed(s, d, ms, false),
    turn:  (s) => s.turn,
    edge:  (s) => {
      const me = R.countUnits(s, s.turn), them = R.countUnits(s, 1 - s.turn);
      return (me - them) * weight;
    },
  };
}

const ENGINES: Record<string, Engine> = {
  'rps-chess': {
    start: () => rpsRules.startBoard().b,
    legal: (bd, t) => rpsRules.genMoves(bd, t),
    apply: (bd, mv) => rpsRules.apply(bd, mv).bd,
    best: (bd, t, d, ms) => rpsAi.bestMoveTimed(bd, t, d, ms, false),
    edge: (bd, t) => {
      const me = rpsRules.count(bd, t), them = rpsRules.count(bd, 1 - t);
      return (me - them) * 120;
    },
  },
  anvil: {
    start: () => anvilRules.startBoard().b,
    legal: (bd, t) => anvilRules.genMoves(bd, t),
    apply: (bd, mv) => anvilRules.apply(bd, mv).bd,
    best: (bd, t, d, ms) => anvilAi.bestMoveTimed(bd, t, d, ms, false),
    edge: (bd, t) => {
      const me = anvilRules.count(bd, t), them = anvilRules.count(bd, 1 - t);
      return (me - them) * 150;
    },
  },
  salient:      fieldEngine(salRules,  salAi,  130),
  tideline:     fieldEngine(tideRules, tideAi, 130),
  breakthrough: fieldEngine(brkRules,  brkAi,  130),
};

/* Log-normal-ish think time. Never a constant, never instant, but never
   long enough to make you wait either.

   The first version of this had a median of 6.4s and put 31% of moves
   over ten seconds, which is not a thoughtful opponent — it is a broken
   one. Realism is not the goal on its own: a five-minute game cannot
   afford a five-second pause per move.

   `tempo_ms` is treated as how deliberate a persona is rather than as
   milliseconds, so the personas already seeded keep their relative
   character without anyone re-running the seeder. */
const PACE = 0.4;

function thinkMs(tempo: number, variance: number, choices: number){
  const u = Math.max(1e-6, Math.random()), v = Math.max(1e-6, Math.random());
  const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const busy = 0.55 + Math.min(0.75, choices / 70);      // more options, longer pause
  const spread = Math.min(0.42, variance);               // the old tail was far too fat
  let ms = Math.min(tempo * PACE, 2000) * busy * Math.exp(gauss * spread);
  if(Math.random() < 0.05) ms *= 1.9;                     // the occasional long think
  if(Math.random() < 0.20) ms *= 0.45;                    // and the frequent snap reply
  return Math.round(Math.min(6000, Math.max(320, ms)));
}

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if(req.method !== 'POST') return json({error: 'POST only'}, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {auth: {persistSession: false}},
  );

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if(!jwt) return json({error: 'not signed in'}, 401);
  /* A sweep authenticates with the service key, which getUser() cannot
     resolve to a user — so test the key first, not the lookup result. */
  const isCron = jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const {data: userData, error: userErr} = isCron
    ? {data: null, error: null} as any
    : await admin.auth.getUser(jwt);
  if(!isCron && (userErr || !userData?.user)) return json({error: 'not signed in'}, 401);

  let matchId: string;
  try{ ({matchId} = await req.json()); }
  catch{ return json({error: 'bad body'}, 400); }
  if(!matchId) return json({error: 'matchId required'}, 400);

  /* The caller has to be in the match. A bot game has exactly one human
     in it, so this is also what stops anyone poking at other people's. */
  if(userData?.user){
    const {data: m} = await admin.from('matches')
      .select('blue,red').eq('id', matchId).maybeSingle();
    if(!m) return json({error: 'no such match'}, 404);
    if(m.blue !== userData.user.id && m.red !== userData.user.id){
      return json({error: 'not your match'}, 403);
    }
  }

  const {data: rows, error} = await admin.rpc('bot_pending', {p_match: matchId});
  if(error) return json({error: error.message}, 500);
  const job = Array.isArray(rows) ? rows[0] : rows;
  /* No bot, or not its turn. Same answer either way — an opponent who
     is a person produces exactly this response. */
  if(!job) return json({ok: true});

  const eng = ENGINES[job.game];
  if(!eng) return json({error: 'unknown game'}, 400);

  let bd = eng.start();
  let turn = 0;
  for(const mv of (job.moves || [])){ bd = eng.apply(bd, mv); turn = 1 - turn; }
  /* Games that carry a turn in their own state are the authority on
     it; parity is only a fallback for the two that do not. Both
     agree, because every game on the site alternates strictly — see
     the note in breakthrough/rules.js about why that matters. */
  if(eng.turn) turn = eng.turn(bd);
  if(turn !== job.seat) return json({ok: true});           // raced with a real move

  const legal = eng.legal(bd, turn);
  if(!legal.length) return json({ok: true});

  /* Stay visibly present while thinking, then think. */
  await admin.rpc('bot_touch', {p_match: matchId});
  await sleep(thinkMs(job.tempo_ms, Number(job.tempo_var), legal.length));

  /* Concede a lost position sometimes, the way a person does — not
     always, and not the instant it turns bad. */
  if(eng.edge(bd, turn) <= job.resign_at && Math.random() < Number(job.resign_p)){
    const {error: rErr} = await admin.rpc('bot_resign', {p_match: matchId});
    if(!rErr) return json({ok: true, resigned: true});
  }

  /* The search runs *after* the pause, so its budget is latency you feel
     on top of the think time. Capped here rather than in the seeder so
     the bots already in the database get it without being re-created. */
  let mv = eng.best(bd, turn, job.depth, Math.min(job.budget_ms, 900));
  /* Imperfection, scaled by persona: take something other than the best
     move now and then. Weak bots blunder in ways you can punish. */
  if(mv === undefined || mv === null || Math.random() < Number(job.blunder)){
    mv = legal[Math.floor(Math.random() * legal.length)];
  }
  if(!legal.includes(mv)) mv = legal[0];

  const {error: pErr} = await admin.rpc('bot_play', {p_match: matchId, p_move: mv});
  if(pErr) return json({error: pErr.message}, 500);
  return json({ok: true});
});
