/* ============================================================
   finish-match — the only thing allowed to decide who won.

   A client says "this match is over". The server ignores that claim
   and replays the whole move list through the very same rules.js the
   browser used. Whatever the replay says is what gets recorded.

   That means a modified client can lie about the result and simply
   be ignored, and it can only get a match voided by playing an
   illegal move — which is recorded as a loss for whoever played it,
   so voiding is never the profitable option.

   POST { matchId }   with the caller's Authorization: Bearer <jwt>
   ============================================================ */
import {createClient} from 'jsr:@supabase/supabase-js@2';
import {
  BLUE, RED, rowOf, goalRow,
  startBoard, genMoves, apply, count,
} from '../_shared/rps-chess-rules.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {...cors, 'Content-Type': 'application/json'},
  });

type Replay =
  | {kind: 'illegal'; index: number}
  | {kind: 'unfinished'}
  | {kind: 'over'; result: 'blue' | 'red' | 'draw'; reason: string};

/* Mirrors the win detection in js/games/rps-chess/state.js. */
function replay(moves: number[]): Replay {
  let bd = startBoard().b;
  let turn = BLUE;

  for(let i = 0; i < moves.length; i++){
    const mv = moves[i];
    if(!genMoves(bd, turn).includes(mv)) return {kind: 'illegal', index: i};

    const res = apply(bd, mv);
    const mover = turn;
    const landed = (res.o === 'move' || res.o === 'win');
    bd = res.bd;
    turn = 1 - turn;

    const nB = count(bd, BLUE), nR = count(bd, RED);
    if(landed && rowOf(res.to) === goalRow(mover)){
      return {kind: 'over', result: mover === BLUE ? 'blue' : 'red', reason: 'backrow'};
    }
    if(nB === 0 && nR === 0) return {kind: 'over', result: 'draw', reason: 'wipeout'};
    if(nR === 0) return {kind: 'over', result: 'blue', reason: 'wipeout'};
    if(nB === 0) return {kind: 'over', result: 'red',  reason: 'wipeout'};
    if(genMoves(bd, turn).length === 0){
      return {kind: 'over', result: 'draw', reason: 'nomoves'};
    }
  }
  return {kind: 'unfinished'};
}

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if(req.method !== 'POST') return json({error: 'POST only'}, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {auth: {persistSession: false}},
  );

  // who is asking?
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if(!jwt) return json({error: 'not signed in'}, 401);
  const {data: userData, error: userErr} = await admin.auth.getUser(jwt);
  if(userErr || !userData.user) return json({error: 'not signed in'}, 401);
  const uid = userData.user.id;

  let matchId: string;
  try{
    ({matchId} = await req.json());
  }catch{
    return json({error: 'bad body'}, 400);
  }
  if(!matchId) return json({error: 'matchId required'}, 400);

  const {data: m, error} = await admin
    .from('matches').select('id,blue,red,state,moves').eq('id', matchId).maybeSingle();
  if(error) return json({error: error.message}, 500);
  if(!m) return json({error: 'no such match'}, 404);
  if(m.blue !== uid && m.red !== uid) return json({error: 'not your match'}, 403);
  if(m.state !== 'live') return json({ok: true, already: m.state});

  const verdict = replay((m.moves || []) as number[]);

  if(verdict.kind === 'unfinished'){
    return json({error: 'that game is not over'}, 409);
  }

  if(verdict.kind === 'illegal'){
    // whoever played the illegal move loses it — voiding must never pay
    const loserIsBlue = verdict.index % 2 === 0;
    await admin.rpc('record_result', {
      p_match: matchId,
      p_result: loserIsBlue ? 'red' : 'blue',
      p_reason: 'invalid',
    });
    return json({ok: true, result: loserIsBlue ? 'red' : 'blue', reason: 'invalid'});
  }

  const {error: rpcErr} = await admin.rpc('record_result', {
    p_match: matchId,
    p_result: verdict.result,
    p_reason: verdict.reason,
  });
  if(rpcErr) return json({error: rpcErr.message}, 500);

  return json({ok: true, result: verdict.result, reason: verdict.reason});
});
