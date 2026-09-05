/* ============================================================
   finish-match — the only thing allowed to decide who won.

   A client says "this match is over". The server ignores that claim
   and replays the whole move list through the very same rules the
   browser used. Whatever the replay says is what gets recorded.

   That means a modified client can lie about the result and simply
   be ignored, and it can only get a match voided by playing an
   illegal move — which is recorded as a loss for whoever played it,
   so voiding is never the profitable option.

   One verifier per game, picked by matches.game. Adding a game
   means adding a replay function to VERIFIERS and running
   tools/sync-rules.py so its rules file is bundled.

   POST { matchId }   with the caller's Authorization: Bearer <jwt>
   ============================================================ */
import {createClient} from 'jsr:@supabase/supabase-js@2';
import * as rps from '../_shared/rps-chess-rules.js';
import * as anvil from '../_shared/anvil-rules.js';
import * as salient from '../_shared/salient-rules.js';
import * as tideline from '../_shared/tideline-rules.js';
import * as breakthrough from '../_shared/breakthrough-rules.js';
import * as barbican from '../_shared/barbican-rules.js';

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

/* ---------- RPS Chess ----------
   Mirrors the win detection in js/games/rps-chess/state.js. */
function replayRps(moves: number[]): Replay {
  let bd = rps.startBoard().b;
  let turn = rps.BLUE;

  for(let i = 0; i < moves.length; i++){
    const mv = moves[i];
    if(!rps.genMoves(bd, turn).includes(mv)) return {kind: 'illegal', index: i};

    const res = rps.apply(bd, mv);
    const mover = turn;
    const landed = (res.o === 'move' || res.o === 'win');
    bd = res.bd;
    turn = 1 - turn;

    const nB = rps.count(bd, rps.BLUE), nR = rps.count(bd, rps.RED);
    if(landed && rps.rowOf(res.to) === rps.goalRow(mover)){
      return {kind: 'over', result: mover === rps.BLUE ? 'blue' : 'red', reason: 'backrow'};
    }
    if(nB === 0 && nR === 0) return {kind: 'over', result: 'draw', reason: 'wipeout'};
    if(nR === 0) return {kind: 'over', result: 'blue', reason: 'wipeout'};
    if(nB === 0) return {kind: 'over', result: 'red',  reason: 'wipeout'};
    if(rps.genMoves(bd, turn).length === 0){
      return {kind: 'over', result: 'draw', reason: 'nomoves'};
    }
  }
  return {kind: 'unfinished'};
}

/* ---------- Anvil ----------
   Mirrors js/games/anvil/state.js. The anvil is claimed at the start
   of a turn, so the check happens after the turn has passed. */
function replayAnvil(moves: number[]): Replay {
  let bd = anvil.startBoard().b;
  let turn = anvil.BLUE;

  for(let ply = 0; ply < moves.length; ply++){
    const mv = moves[ply];
    if(!anvil.genMoves(bd, turn).includes(mv)) return {kind: 'illegal', index: ply};

    bd = anvil.apply(bd, mv).bd;
    turn = 1 - turn;

    const nB = anvil.count(bd, anvil.BLUE), nR = anvil.count(bd, anvil.RED);
    if(nR <= anvil.LOSE_AT) return {kind: 'over', result: 'blue', reason: 'wipeout'};
    if(nB <= anvil.LOSE_AT) return {kind: 'over', result: 'red',  reason: 'wipeout'};
    if(anvil.holds(bd, turn) >= anvil.HOLD_TO_WIN){
      return {kind: 'over', result: turn === anvil.BLUE ? 'blue' : 'red', reason: 'anvil'};
    }
    if(anvil.genMoves(bd, turn).length === 0){
      return {kind: 'over', result: turn === anvil.BLUE ? 'red' : 'blue', reason: 'nomoves'};
    }
    if(ply + 1 >= anvil.PLY_CAP) return {kind: 'over', result: 'draw', reason: 'capped'};
  }
  return {kind: 'unfinished'};
}

/* ---------- the control-field games ----------
   Salient, Tideline and Breakthrough all keep a whole game state in
   one object and expose the same three functions, so one replay does
   for all three. That is not a coincidence — it is the reason their
   rules modules were written to the same shape.

   `verdict` is asked *after* each move, for the side about to move,
   exactly as the browser asks it, because in all three games a side's
   casualties and score are settled at the start of its own turn. */
type Engine = {
  startState: () => any;
  genMoves: (s: any, side: number) => number[];
  apply: (s: any, mv: number) => {st: any};
  verdict: (s: any, side: number) => {w: number; why: string} | null;
  BLUE: number;
};

function replayField(eng: Engine){
  return (moves: number[]): Replay => {
    let s = eng.startState();
    for(let i = 0; i < moves.length; i++){
      const mv = moves[i];
      if(!eng.genMoves(s, s.turn).includes(mv)) return {kind: 'illegal', index: i};
      s = eng.apply(s, mv).st;
      const v = eng.verdict(s, s.turn);
      if(v){
        if(i !== moves.length - 1) return {kind: 'illegal', index: i + 1};
        return {
          kind: 'over',
          result: v.w === -1 ? 'draw' : (v.w === eng.BLUE ? 'blue' : 'red'),
          reason: v.why,
        };
      }
    }
    return {kind: 'unfinished'};
  };
}

const VERIFIERS: Record<string, (m: number[]) => Replay> = {
  'rps-chess': replayRps,
  'anvil': replayAnvil,
  'salient': replayField(salient as unknown as Engine),
  'tideline': replayField(tideline as unknown as Engine),
  'breakthrough': replayField(breakthrough as unknown as Engine),
  'barbican': replayField(barbican as unknown as Engine),
};

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
    .from('matches').select('id,game,blue,red,state,moves').eq('id', matchId).maybeSingle();
  if(error) return json({error: error.message}, 500);
  if(!m) return json({error: 'no such match'}, 404);
  if(m.blue !== uid && m.red !== uid) return json({error: 'not your match'}, 403);
  if(m.state !== 'live') return json({ok: true, already: m.state});

  const verify = VERIFIERS[m.game as string];
  if(!verify) return json({error: 'no verifier for ' + m.game}, 501);

  const verdict = verify((m.moves || []) as number[]);

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
