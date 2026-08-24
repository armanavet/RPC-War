-- ============================================================
-- Phase 1: accounts.
--
-- One profile row per auth user, created automatically on first
-- sign-in. Handles are derived from the OAuth identity and made
-- unique. Nothing here touches ratings yet.
--
-- Apply: paste into the Supabase SQL editor, or `supabase db push`.
-- ============================================================

create extension if not exists citext;

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  handle       citext unique not null check (handle ~ '^[a-z0-9_]{3,16}$'),
  display_name text not null check (length(display_name) between 1 and 32),
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

-- anyone may read a profile (needed for opponent names and, later, leaderboards)
drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles for select
  using (true);

-- you may edit only your own row
drop policy if exists "you may update your own profile" on public.profiles;
create policy "you may update your own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ------------------------------------------------------------
-- Grants
--
-- The project has "automatically expose new tables" switched off, so a
-- table is unreachable through the Data API until it is granted here.
-- Grants are checked BEFORE row level security, so this is the outer
-- gate and the policies above are the inner one. Grant precisely.
-- ------------------------------------------------------------
grant select on public.profiles to anon, authenticated;

-- Only the display name is editable. RLS cannot restrict columns, so a
-- column grant does it. Handles stay fixed until we decide the rules for
-- changing them (see docs/accounts.md, "Still open").
grant update (display_name) on public.profiles to authenticated;

-- No insert or delete grant, and no insert policy: rows come only from
-- the trigger below, which runs as definer. A client cannot mint itself
-- a profile, nor delete one.

-- ------------------------------------------------------------
-- Auto-create a profile on sign-up
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base      text;
  candidate text;
  n         int := 0;
begin
  -- GitHub gives user_name; other providers vary; fall back to the email local part
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

  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    candidate,
    left(coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      candidate), 32)
  );

  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
