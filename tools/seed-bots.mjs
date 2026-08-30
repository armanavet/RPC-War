/* ============================================================
   Create the bot accounts.

   Run once, after applying supabase/migrations/0011_bots.sql. It is
   idempotent: re-running updates personas and adds any that are
   missing rather than duplicating them.

     SUPABASE_URL=https://<ref>.supabase.co \
     SUPABASE_SERVICE_KEY=sb_secret_... \
     node tools/seed-bots.mjs [count]

   Plain fetch, no dependencies — this is the one script that handles
   the secret key, so it should be readable end to end in one sitting.
   NEVER commit that key; pass it on the command line.

   Why accounts at all: matches.blue/red are foreign keys to profiles,
   and profiles.id is a foreign key to auth.users. A playable opponent
   therefore has to be a real user. The online *count* does not — that
   is bot_presence_tick() in the migration, and it needs none of this.
   ============================================================ */

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const COUNT = Number(process.argv[2] || 100);

if(!URL_ || !KEY){
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}
if(!/^sb_secret_|^ey/.test(KEY)){
  console.error('That does not look like a service key.');
  process.exit(1);
}

const GAMES = ['rps-chess', 'anvil'];

/* Names are combined from pools rather than listed, so a hundred of
   them do not need a hundred lines. Mixed conventions on purpose: a
   lobby where everyone is FirstnameLastname reads as generated. */
const FIRST = ['nina','tomas','iris','arto','lena','mikkel','sara','yusuf','emre','dana',
  'petra','johan','elif','kaspar','maja','rune','anouk','ivo','freya','luca',
  'senna','oskar','vera','matty','noor','tibor','hana','joris','ilse','ravi'];
const LAST = ['halvorsen','kovacs','delacroix','ferreira','novak','bakker','lindqvist',
  'moreau','vasquez','okonkwo','sandberg','rossi','demir','walsh','kaur'];
const HANDLEY = ['','_','0','7','11','_x','93','21','_b','88'];

const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];

/* Strength follows the displayed rating, so a 900 really does play like
   a 900 — a bot whose rating and behaviour disagree is noticed fast. */
function persona(rating){
  const depth     = rating < 1100 ? 2 : rating < 1500 ? 3 : 4;
  const budget_ms = rating < 1100 ? 250 : rating < 1500 ? 650 : 1200;
  const blunder   = rating < 1000 ? 0.30 : rating < 1200 ? 0.20
                  : rating < 1450 ? 0.11 : rating < 1650 ? 0.06 : 0.03;
  return {
    depth, budget_ms, blunder,
    tempo_ms:  1700 + rnd(2800),
    tempo_var: 0.55 + Math.random() * 0.5,
    resign_at: -700 - rnd(600),
    resign_p:  0.25 + Math.random() * 0.5,
    /* A contiguous waking window, offset per bot, so the pool that is
       available at 04:00 is small but never empty. */
    hours: waking(9 + rnd(7), rnd(24)),
  };
}

function waking(len, start){
  let mask = 0;
  for(let i = 0; i < len; i++) mask |= 1 << ((start + i) % 24);
  return mask;
}

/* Ratings cluster the way a real ladder does: most in the middle. */
function rating(){
  const g = (Math.random() + Math.random() + Math.random()) / 3;   // ~normal
  return Math.round(820 + g * 1080);
}

async function api(path, opts = {}){
  const r = await fetch(URL_ + path, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try{ body = text ? JSON.parse(text) : null; }catch{ body = text; }
  return {ok: r.ok, status: r.status, body};
}

const used = new Set();
function handle(){
  for(let i = 0; i < 200; i++){
    const h = (pick(FIRST) + pick(HANDLEY) + (Math.random() < 0.35 ? pick(LAST).slice(0, 4) : ''))
      .replace(/[^a-z0-9_]/g, '').slice(0, 16);
    if(h.length >= 3 && !used.has(h)){ used.add(h); return h; }
  }
  const h = 'player' + rnd(99999);
  used.add(h); return h;
}

const cap = s => s[0].toUpperCase() + s.slice(1);

let made = 0, updated = 0, failed = 0;

for(let i = 0; i < COUNT; i++){
  const h = handle();
  const display = Math.random() < 0.55
    ? cap(pick(FIRST)) + ' ' + cap(pick(LAST))
    : cap(h.replace(/[_0-9]+/g, ''));
  const game = GAMES[i % GAMES.length];
  const r = rating();
  const p = persona(r);

  /* The .invalid TLD is reserved by RFC 2606 and can never resolve, so
     these addresses cannot collide with a real person's. Nobody knows
     the password and nothing ever signs in as these accounts. */
  const email = `${h}@bots.oddboards.invalid`;
  const password = crypto.randomUUID() + crypto.randomUUID();

  let res = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: {user_name: h, full_name: display},
    }),
  });

  let id = res.body?.id;
  if(!id){
    /* Already there from an earlier run: look it up and carry on. */
    const found = await api('/auth/v1/admin/users?page=1&per_page=1&filter=' + encodeURIComponent(email));
    id = found.body?.users?.[0]?.id;
    if(!id){
      failed++;
      if(failed <= 3) console.error(`  ${h}: ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      continue;
    }
    updated++;
  }else{
    made++;
  }

  const reg = await api('/rest/v1/rpc/bot_register', {
    method: 'POST',
    body: JSON.stringify({
      p_user: id, p_game: game, p_rating: r,
      p_depth: p.depth, p_budget_ms: p.budget_ms, p_blunder: p.blunder,
      p_tempo_ms: p.tempo_ms, p_tempo_var: p.tempo_var,
      p_resign_at: p.resign_at, p_resign_p: p.resign_p, p_hours: p.hours,
    }),
  });
  if(!reg.ok){
    failed++;
    if(failed <= 3) console.error(`  register ${h}: ${reg.status} ${JSON.stringify(reg.body).slice(0, 160)}`);
  }

  if((i + 1) % 20 === 0) console.log(`  ${i + 1}/${COUNT}`);
}

console.log(`\ncreated ${made}, refreshed ${updated}, failed ${failed}`);
console.log('bots are only reachable through find_match; nothing about them is readable by a client.');
