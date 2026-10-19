-- ============================================================================
-- Roles: public.profiles
--
-- One row per account carrying exactly one piece of authorization state:
-- `role`. `admin` may open /admin and call /api/admin/*; everyone else is
-- `user`. The app reads its own row (row-level security), the console's "User
-- Management" tab writes roles through the service role, and the post-login
-- redirect uses the same value to choose between /admin and /watch.
--
-- ADAPTS TO THE TABLE AS IT ALREADY IS. The columns in play are:
--
--     id     uuid  = auth.users.id   (NOT `user_id`)
--     email  text
--     role   text  = 'user' | 'admin'
--     created_at / updated_at  timestamptz
--
-- Every statement is `if not exists`-style or guarded, so this is safe to run
-- on an empty database, on the live one, and again after either.
--
-- Run it in the Supabase Dashboard -> SQL Editor, or with `supabase db push`.
--
-- Bootstrapping the FIRST administrator (then sign out and back in so the app
-- re-reads the role):
--
--     insert into public.profiles (id, role)
--     select id, 'admin' from auth.users where email = 'you@example.com'
--     on conflict (id) do update set role = excluded.role;
--
-- Promote/demote everyone else from the console's User Management tab.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Table + columns, created only if genuinely absent.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  role       text not null default 'user',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- The live table predates this migration; these fill in any column it lacks.
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists role       text;
alter table public.profiles add column if not exists created_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz;

alter table public.profiles alter column role       set default 'user';
alter table public.profiles alter column created_at set default timezone('utc', now());
alter table public.profiles alter column updated_at set default timezone('utc', now());

-- ----------------------------------------------------------------------------
-- 2. Normalise existing values, THEN constrain the column.
--
--    Only the literal `admin` (case/whitespace aside) survives as an
-- administrator; NULL, '', 'owner', 'moderator' … all become `user`. The
-- mapping can therefore only NARROW access — it can never quietly promote
-- somebody. Guarded so that a database where the migration role is itself
-- subject to RLS still completes: the app reads an un-normalised value as
-- `user` anyway, so a skipped normalisation is not a security hole.
-- ----------------------------------------------------------------------------
do $$
begin
  update public.profiles
     set role = case
                  when lower(btrim(coalesce(role, ''))) = 'admin' then 'admin'
                  else 'user'
                end
   where role is distinct from case
                                 when lower(btrim(coalesce(role, ''))) = 'admin' then 'admin'
                                 else 'user'
                               end;
exception when others then
  raise warning 'public.profiles role normalisation skipped: %', sqlerrm;
end $$;

-- New and changed rows must hold one of the two values. NOT VALID keeps a
-- legacy row from aborting the whole migration; the guarded VALIDATE below
-- upgrades it once the data agrees.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname  = 'profiles_role_valid'
  ) then
    alter table public.profiles
      add constraint profiles_role_valid check (role in ('user', 'admin')) not valid;
  end if;
end $$;

do $$
begin
  alter table public.profiles validate constraint profiles_role_valid;
exception when others then
  raise notice 'profiles_role_valid is not yet validated (existing rows disagree): %', sqlerrm;
end $$;

-- `id` is the primary key above; the foreign key keeps rows honest on delete.
do $$
declare
  id_attr smallint;
begin
  select attnum into id_attr
    from pg_attribute
   where attrelid = 'public.profiles'::regclass and attname = 'id';

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and contype  = 'f'
       and confrelid = 'auth.users'::regclass
       and conkey = array[id_attr]
  ) then
    if exists (
      select 1 from public.profiles p
       where not exists (select 1 from auth.users u where u.id = p.id)
    ) then
      raise notice 'public.profiles has rows without a matching auth user; foreign key not added.';
    else
      alter table public.profiles
        add constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade;
    end if;
  end if;
exception when others then
  raise notice 'public.profiles foreign key not added: %', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Signup bookkeeping + the role lock.
-- ----------------------------------------------------------------------------

-- One `user` row per new account. The row is a convenience — the app reads a
-- missing row as `user`, and the console's promote path upserts — so the
-- exception guard exists to guarantee that a signing-up human is never blocked
-- by a bookkeeping failure (most often: forced RLS, or a legacy NOT NULL
-- column this function does not know about).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'public.profiles row for % was not created: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill, same reasoning: best-effort, and skipped inside its own block so a
-- blocked DML path cannot abort the migration.
do $$
begin
  insert into public.profiles (id, email, role)
  select u.id, u.email, 'user'
    from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id);
exception when others then
  raise warning 'public.profiles backfill skipped: %', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 3b. The role column is immutable to everyone but the service role.
--
-- Revoking the grant (step 4) is the primary lock. This trigger is the second:
-- it stands even if a future migration, the dashboard's table editor, or a
-- careless `grant` widens what `authenticated` may write.
-- ----------------------------------------------------------------------------

/** True when the current request may write `role`. */
create or replace function public.role_change_allowed()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), 'service_role') = 'service_role';
$$;

create or replace function public.guard_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    if not public.role_change_allowed() then
      raise exception 'public.profiles.role may only be changed with the service role'
        using errcode = '42501';
    end if;
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_change on public.profiles;
create trigger profiles_guard_role_change
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ----------------------------------------------------------------------------
-- 4. Row level security + least privilege.
--
--    `select` is the only verb `authenticated` holds, and the only policy lets
--    a row be seen by its owner. Everything else — the signup insert, the
--    console's promote/demote — goes through the service role, which never
--    needs a policy.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- The console and the signup trigger reach this table as the service role,
-- which carries BYPASSRLS and would not need a policy. It is spelled out here
-- so that is not the only thing standing between an operator and an empty
-- directory: `grant all` is the privilege, this is the row visibility.
drop policy if exists profiles_service_role on public.profiles;
create policy profiles_service_role on public.profiles
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

commit;

-- ----------------------------------------------------------------------------
-- Verify afterwards (read-only):
--
--   select relname, relrowsecurity, relforcerowsecurity
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'profiles';      -- both t
--
--   select tablename, policyname, roles, cmd
--     from pg_policies where schemaname = 'public' and tablename = 'profiles';
--
--   select table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'profiles'
--      and grantee = 'authenticated';                            -- SELECT only
--
--   select id, role from public.profiles;   -- run as the service role
-- ----------------------------------------------------------------------------
