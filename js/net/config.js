/* ============================================================
   Backend configuration.
   ============================================================ */

/* Supabase — accounts now, matches and ratings later.

   Both values are public on purpose. The publishable key is designed to
   ship inside client code; row level security and table grants are what
   protect the data, not the key. Never put the `sb_secret_...` key or the
   database password in here — those bypass RLS entirely. */
export const SUPABASE_URL = 'https://gderpmkfszmlrqhfmhvg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_dELU7xXbhtKQUZ-APkIuRA_aETxcUQH';

/* Add ?mock=1 to a game URL to run the whole online flow in two tabs of
   one browser with no backend at all. This one stays for good. */
export const MOCK = new URLSearchParams(location.search).has('mock');
