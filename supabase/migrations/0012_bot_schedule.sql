-- ============================================================
-- Keep the lobby populated.
--
-- One job. It calls bot_presence_tick(), which refreshes the synthetic
-- cohort's rows in `presence`. A client counts as present for 60
-- seconds after its last heartbeat, so this has to run at least twice
-- a minute or the number visibly breathes.
--
-- Nothing here needs a secret, which is the reason the online count
-- and the playable bots were built as separate halves: this migration
-- makes the number real on its own, with no key and no deploy.
--
-- Apply after 0011_bots.sql.
-- ============================================================

create extension if not exists pg_cron with schema extensions;

-- Idempotent: unschedule any previous version before scheduling.
do $$
begin
  perform cron.unschedule('oddboards-presence');
exception when others then
  null;   -- not scheduled yet
end $$;

/* Sub-minute schedules need pg_cron 1.5 or newer, which Supabase has.
   If this errors on an older install, use '* * * * *' instead and
   widen the window in online_counts() from 60 to 120 seconds. */
select cron.schedule(
  'oddboards-presence',
  '30 seconds',
  $$select public.bot_presence_tick()$$
);

-- ------------------------------------------------------------
-- Not scheduled here: a sweep that plays bot moves.
--
-- It would have to reach the bot-move edge function over HTTP, which
-- means pg_net plus the service key stored in Vault — a secret in the
-- migration history is not worth it for what it buys. The client
-- already nudges on entering a match and after every move it makes,
-- which covers a bot moving first and a bot replying. The only case
-- left is a human closing the tab mid-game, where the bot stops
-- moving and nobody is present to notice; re-opening the match nudges
-- again and play resumes.
--
-- If you want the sweep anyway, store the key in Vault and schedule a
-- job that posts bot_pending_all() ids to the function.
-- ------------------------------------------------------------
