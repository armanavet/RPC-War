-- ============================================================
-- Match history.
--
-- A finished game stops being private. Participants can already see
-- their own matches at any stage; this adds "and everyone can see a
-- game that is over", which is what makes a public player page and
-- game replay possible.
--
-- Chat is NOT covered by this. match_chat keeps its own
-- participants-only policy, so what you said during a game stays
-- between the two of you.
--
-- Apply after 0007_matchmaking.sql.
-- ============================================================

drop policy if exists "finished matches are public" on public.matches;
create policy "finished matches are public"
  on public.matches for select
  using (state in ('finished', 'aborted'));

-- Policies are OR-ed, so participants keep full access to their live
-- games through the existing policy and everyone gains read access to
-- games that have ended.
grant select on public.matches to anon;

-- profiles and ratings are already readable by anon; a signed-out
-- visitor can therefore open any player's page.
