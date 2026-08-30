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

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json'}});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Engine = {
  start: () => number[];
  legal: (bd: number[], turn: number) => number[];
  apply: (bd: number[], mv: number) => number[];
  best: (bd: number[], turn: number, depth: number, budget: number) => number | undefined;
  /* how far ahead the side to move is, for the resign decision */
  edge: (bd: number[], turn: number) => number;
};

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
};

/* Log-normal-ish think time. Never a constant, never instant, and
   occasionally a long one — people stare at boards. */
function thinkMs(tempo: number, variance: number, choices: number){
  const u = Math.max(1e-6, Math.random()), v = Math.max(1e-6, Math.random());
  const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const busy = 0.6 + Math.min(1.6, choices / 26);        // more options, longer pause
  let ms = tempo * busy * Math.exp(gauss * variance);
  if(Math.random() < 0.07) ms *= 2.4;                     // the occasional long think
  if(Math.random() < 0.10) ms *= 0.35;                    // and the occasional snap reply
  return Math.round(Math.min(26000, Math.max(900, ms)));
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

  let mv = eng.best(bd, turn, job.depth, job.budget_ms);
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
