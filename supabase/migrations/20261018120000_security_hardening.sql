-- ============================================================================
-- StreamPulse — production security hardening (Row Level Security)
-- ----------------------------------------------------------------------------
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (or `supabase db push` if you use the Supabase CLI)
--
-- Everything below is idempotent: re-running it is safe.
--
-- Why this matters:
--   The browser talks to Supabase directly with the PUBLIC anon key. The anon
--   key is not a secret — Row Level Security is the only thing standing
--   between a user and everyone else's rows. Without RLS, anyone holding the
--   anon key can read/modify the whole table.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Table definition (matches the snippet that used to live in .env.local)
-- ----------------------------------------------------------------------------
create table if not exists public.user_favorites (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel_id text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_favorites_user_channel_key unique (user_id, channel_id)
);

comment on table public.user_favorites is
  'Per-user channel favorites. Accessible only to the owning user (RLS).';

-- The UNIQUE constraint already provides the (user_id, channel_id) lookup
-- index; this covers plain "all favorites for this user" reads.
create index if not exists user_favorites_user_id_idx
  on public.user_favorites (user_id);

-- ----------------------------------------------------------------------------
-- 2. Enable RLS — and FORCE it so even the table owner / postgres role is
--    subject to the policies (service_role keeps BYPASSRLS, so server-side
--    admin tooling still works).
-- ----------------------------------------------------------------------------
alter table public.user_favorites enable row level security;
alter table public.user_favorites force row level security;

-- ----------------------------------------------------------------------------
-- 3. Replace whatever policies exist with strict auth.uid()-scoped ones.
--    (DROP first so this stays idempotent and removes any permissive leftovers
--     such as "for all using (true)".)
-- ----------------------------------------------------------------------------
do $$
declare pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'user_favorites'
  loop
    execute format('drop policy %I on public.user_favorites', pol.policyname);
  end loop;
end $$;

-- READ: a user can only see their own rows.
create policy "user_favorites_select_own"
  on public.user_favorites
  for select
  to authenticated
  using (auth.uid() = user_id);

-- INSERT: the payload must target the caller's own user_id.
create policy "user_favorites_insert_own"
  on public.user_favorites
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- UPDATE: required because the app upserts (INSERT ... ON CONFLICT DO UPDATE
-- runs the UPDATE policies on the conflicting row).
create policy "user_favorites_update_own"
  on public.user_favorites
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: a user can only remove their own rows.
create policy "user_favorites_delete_own"
  on public.user_favorites
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4. Least-privilege grants.
--    StreamPulse only ever touches this table with a signed-in user, so the
--    `anon` role (unauthenticated requests) gets nothing. RLS would block it
--    anyway; revoking removes the attempt entirely.
-- ----------------------------------------------------------------------------
revoke all on table public.user_favorites from anon;
grant select, insert, update, delete on table public.user_favorites to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Optional `profiles` table hardening.
--    StreamPulse currently keeps profiles in localStorage, but this makes the
--    migration safe if a profiles table (with a user_id column) is added or
--    already exists in the project. Skipped automatically when the shape
--    doesn't match.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
        select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'profiles'
      )
     and exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'
           and column_name = 'user_id'
      )
  then
    alter table public.profiles enable row level security;
    alter table public.profiles force row level security;

    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'profiles'
                      and policyname = 'profiles_select_own') then
      execute 'create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = user_id)';
    end if;
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'profiles'
                      and policyname = 'profiles_insert_own') then
      execute 'create policy profiles_insert_own on public.profiles for insert to authenticated with check (auth.uid() = user_id)';
    end if;
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'profiles'
                      and policyname = 'profiles_update_own') then
      execute 'create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';
    end if;
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'profiles'
                      and policyname = 'profiles_delete_own') then
      execute 'create policy profiles_delete_own on public.profiles for delete to authenticated using (auth.uid() = user_id)';
    end if;

    raise notice 'Hardened public.profiles with auth.uid()-scoped policies.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Sweep: turn RLS on for EVERY remaining table in the public schema.
--    Secure by default — a table with RLS enabled and no policies is
--    inaccessible through the API rather than wide open. Tables that are
--    intentionally public must get an explicit policy (see notice below).
-- ----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select tablename
      from pg_tables
     where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;

  -- Report tables that are now locked down but have no policy at all.
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
       and not exists (
             select 1 from pg_policies p
              where p.schemaname = 'public' and p.tablename = c.relname
           )
  loop
    raise notice 'RLS enabled, NO policies -> public.% is now unreachable via the API. Add an explicit policy if the app needs it.', t.relname;
  end loop;
end $$;

commit;

-- ----------------------------------------------------------------------------
-- Verification (run these after the migration):
--   select relname, relrowsecurity, relforcerowsecurity
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and relkind = 'r';   -- both columns must be t
--
--   select tablename, policyname, roles, cmd, qual, with_check
--     from pg_policies where schemaname = 'public';
--
-- See supabase/audit_rls.sql for the full audit query set.
-- ----------------------------------------------------------------------------
