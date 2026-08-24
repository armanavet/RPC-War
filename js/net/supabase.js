/* ============================================================
   The Supabase client, created once.

   Imported lazily by auth.js — the vendored SDK is ~270KB, and a
   signed-out visitor playing the computer should never pay for it.
   ============================================================ */
import {createClient} from '../vendor/supabase-js.js';
import {SUPABASE_URL, SUPABASE_KEY} from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,   // completes the OAuth redirect for us
    flowType: 'pkce',
  },
});
