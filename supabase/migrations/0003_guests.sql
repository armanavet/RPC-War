-- ============================================================
-- Guests.
--
-- Sending or accepting a challenge should not need an account. The
-- answer is Supabase anonymous sign-in: a guest still gets a real
-- auth.uid(), so play_move keeps enforcing whose turn it is, and no
-- second authentication scheme has to exist.
--
-- Requires: Authentication -> Providers -> Anonymous sign-ins ON.
--
-- Apply: paste into the Supabase SQL editor, or `supabase db push`.
-- ============================================================

alter table public.profiles
  add column if not exists is_guest boolean not null default false;

-- Leaderboards and matchmaking will want to skip guests entirely.
create index if not exists profiles_real_accounts
  on public.profiles (id) where not is_guest;

-- ------------------------------------------------------------
-- The signup trigger now has two cases.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  guest     boolean := coalesce(new.is_anonymous, false);
  base      text;
  candidate text;
  n         int := 0;
begin
  if guest then
    -- guest_ + 8 hex characters fits the 16-character handle limit
    candidate := 'guest_' || substr(replace(new.id::text, '-', ''), 1, 8);
    insert into public.profiles (id, handle, display_name, is_guest)
    values (new.id,
            candidate,
            'Guest ' || upper(substr(replace(new.id::text, '-', ''), 1, 4)),
            true);
    return new;
  end if;

  -- GitHub gives user_name; Google does not, so fall back to the email
  base := lower(coalesce(
            new.raw_user_meta_data->>'user_name',
            new.raw_user_meta_data->>'preferred_username',
            split_part(coalesce(new.email, ''), '@', 1),
            'player'));
  base := regexp_replace(base, '[^a-z0-9_]', '', 'g');
  if length(base) < 3 then
    base := base || 'player';
  end if;
  base := left(base, 16);

  candidate := base;
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := left(base, 16 - length(n::text)) || n::text;
  end loop;

  insert into public.profiles (id, handle, display_name, is_guest)
  values (
    new.id,
    candidate,
    left(coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      candidate), 32),
    false
  );

  return new;
end
$$;
