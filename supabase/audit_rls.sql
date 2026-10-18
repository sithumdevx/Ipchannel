-- ============================================================================
-- StreamPulse — read-only RLS / exposure audit
-- ----------------------------------------------------------------------------
-- Run in Supabase Dashboard -> SQL Editor. Every statement here is a SELECT
-- (the DO blocks only RAISE NOTICE), so it is safe to run against production.
--
-- Interpreting the output is documented in SECURITY.md.
-- ============================================================================

-- 1) Which tables have RLS enabled, and is it FORCED?
--    relrowsecurity = t  -> RLS enabled
--    relforcerowsecurity = t -> even the table owner is subject to policies
--    Anything reporting 'f' here is reachable by any client holding the anon key.
select c.relname                                     as table_name,
       c.relrowsecurity                              as rls_enabled,
       c.relforcerowsecurity                         as rls_forced,
       (select count(*) from pg_policies p
         where p.schemaname = n.nspname and p.tablename = c.relname) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind in ('r', 'p', 'v', 'm')
 order by rls_enabled, table_name;

-- 2) Every policy that is actually in effect (cmd / roles / expression).
select policyname, tablename, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- 3) Table privileges per role — anything above USAGE/SELECT on data tables
--    for `anon` deserves a second look.
select grantee, table_name, privilege_type
  from information_schema.table_privileges
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated', 'service_role', 'public')
 order by table_name, grantee, privilege_type;

-- 4) SECURITY DEFINER functions in the public schema: these run with elevated
--    rights and are a classic privilege-escalation vector. Expect zero rows
--    unless you added them on purpose.
select p.proname                                   as function_name,
       pg_get_userbyid(p.proowner)                 as owner,
       p.prosecdef                                 as is_security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
 order by p.proname;

-- 5) Views in the public schema. By default a view executes with the
--    OWNER's rights (security_invoker = off), which can silently bypass RLS.
--    If you rely on any view, mark it:  alter view ... set (security_invoker = true);
select schemaname,
       viewname,
       (coalesce(
          (select option_value from pg_options_to_table(c.reloptions)
            where option_name = 'security_invoker'),
          'false'))                                as security_invoker
  from pg_views v
  join pg_class c on c.relname = v.viewname
  join pg_namespace n on n.oid = c.relnamespace
 where v.schemaname = 'public'
   and n.oid = c.relnamespace;

-- 6) RLS status per table, as a plain yes/no list for a quick eyeball.
select relname as table,
       case when relrowsecurity then 'RLS ON' else '*** RLS OFF ***' end as status,
       case when relforcerowsecurity then 'forced' else 'not forced' end  as forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by status, table;

-- 7) Summary notice: are there any tables still open?
do $$
declare open_count integer;
begin
  select count(*) into open_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if open_count = 0 then
    raise notice 'OK: all public tables have RLS enabled.';
  else
    raise notice 'WARNING: % public table(s) have RLS DISABLED.', open_count;
  end if;
end $$;
