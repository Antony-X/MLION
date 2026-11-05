-- MLion: security fixes from the 2026-11-05 audit. Additive: run once in the Supabase SQL editor, LAST, after
-- rate_limits.sql (it replaces functions those files made, and tightens grants). Safe to run twice. It changes no
-- rows that exist, only what later writes may do. Tests: node tests/security.sql.test.js (PGlite, no network).
--
-- What it fixes
--   1. profiles: a player could write their own created_at ("joined 2001") because INSERT was granted on every
--      column. Now only (id, name), like every other table.
--   2. Daily and quiz scores: the day must be today SOMEWHERE on Earth (UTC-12 .. UTC+14, plus an hour for wrong
--      clocks). Before, tomorrow's UTC date was accepted at any hour, so a run could be posted a day early.
--   3. Daily quiz: tenths (the tie-break: total answer time) is now the sum of the seven times the score was
--      computed from. Before, a post could claim slow times for its points and 0.1 s for the tie-break.
--   4. Per-network limits: an IPv6 network counts as its /64 (one home or phone gets a whole /64, so one
--      player had 2^64 "networks"); an IPv4 address written IPv6-style (::ffff:1.2.3.4) counts as that IPv4;
--      a header that isn't an address counts as one shared "invalid" network instead of an unlimited "unknown".
--   5. #admin -> Players: the account name comes from the login provider's identity (auth.identities), which the
--      player can't edit, not from user_metadata, which any account can set to "Antony (MLion owner)" with
--      PUT /auth/v1/user. Anonymous (publish-only) accounts are flagged.
--   6. A profile name over 64 characters is refused before the name filter runs (the filter's regexes would
--      otherwise run over whatever size was sent; the 16-character check only comes after the triggers).
--      public.name_ok is no longer callable by signed-out visitors (POST /rest/v1/rpc/name_ok was a free CPU sink).
--   7. New tables made later in the SQL editor are no longer readable and writable by every visitor before
--      anyone writes their grants (Supabase's default privileges give anon and authenticated ALL on new tables).
--      From now on a new table needs its own GRANT lines, as every file in supabase/ already has.
--   8. suggestion_reviews.prompt_id gets the same shape check as answer_suggestions (it names a file in
--      tools/pull_suggestions.js).
--   At the end it prints NOTICEs: tables without row level security, tables published to Realtime, security
--   definer functions without a search_path, and the functions signed-out visitors may call. Read them.

-- 1. -------------------------------------------------------------------------------------------- profiles insert
revoke insert on public.profiles from anon, authenticated;
grant insert (id, name) on public.profiles to authenticated;

-- 2 and 3. ------------------------------------------------------------------------------------- the day, tenths
-- A day D is someone's local date from D 00:00 at UTC+14 to D 24:00 at UTC-12, so from D - 14 h to D + 36 h UTC.
-- (One hour of slack each side for a wrong clock. p_at is for tests; the triggers use now().)
create or replace function public.daily_day_ok(p_day date, p_at timestamptz default now()) returns boolean
language sql stable set search_path = '' as $$
  select (p_at at time zone 'utc') >= p_day::timestamp - interval '15 hours'
     and (p_at at time zone 'utc') <  p_day::timestamp + interval '37 hours';
$$;
revoke execute on function public.daily_day_ok(date, timestamptz) from public, anon;
grant execute on function public.daily_day_ok(date, timestamptz) to authenticated; -- the score triggers run as the caller

create or replace function public.daily_scores_check() returns trigger
language plpgsql as $$
declare
  pts int[] := array[0, 10, 15, 30, 60, 85, 100];
  total int := 0;
  d text;
begin
  if not public.daily_day_ok(new.day) then
    raise exception 'only today''s daily can be posted';
  end if;
  foreach d in array regexp_split_to_array(new.tiers, '') loop
    total := total + pts[d::int + 1];
  end loop;
  new.score := total;
  new.created_at := now();
  return new;
end $$;

create or replace function public.daily_quiz_scores_check() returns trigger
language plpgsql as $$
declare
  total int := 0;
  spent int := 0;
  t int;
  a int;
begin
  if not public.daily_day_ok(new.day) then
    raise exception 'only today''s quiz can be posted';
  end if;
  if new.times is null then
    total := 100 * (char_length(new.marks) - char_length(replace(new.marks, '1', '')));
    spent := 2450; -- no times, no speed: the slowest tie-break (7 x 35 s)
  else
    for i in 1..7 loop
      t := least(350, greatest(0, split_part(new.times, ',', i)::int)); -- tenths of a second
      spent := spent + t;
      if substr(new.marks, i, 1) = '1' then
        a := greatest(0, 100 * t - 3000);                                 -- ms past the 3 s grace
        total := total + greatest(50, 100 - (100 * a + 32000) / 64000);   -- 50 * a / 32000, rounded half up
      end if;
    end loop;
  end if;
  new.score := total;
  new.tenths := spent; -- the tie-break is the time the score was computed from, never a separate claim
  new.created_at := now();
  return new;
end $$;

-- 4. -------------------------------------------------------------------------------------- which network it is
-- Same headers as rate_limits.sql (cf-connecting-ip, else the LAST x-forwarded-for value). What changes is the
-- bucket: IPv6 -> its /64, IPv4-mapped IPv6 -> the IPv4, an unreadable value -> 'invalid' (limited like any
-- network). 'none' (never limited) is left only for a request that carries no address header at all: the SQL
-- editor, a direct connection, or an API path whose proxy sets neither header, which a client can't arrange.
create or replace function public.request_ip_info() returns json
language plpgsql stable set search_path = '' as $$
declare hdr json; v text; src text; a inet;
begin
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception when others then hdr := null;
  end;
  if hdr is null then return json_build_object('ip', null, 'source', 'none'); end if;
  v := btrim(coalesce(hdr ->> 'cf-connecting-ip', ''));
  src := 'cf-connecting-ip';
  if v = '' then
    v := btrim(split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', -1)); -- the value a proxy appended, not the client's
    src := 'x-forwarded-for (last)';
  end if;
  if v = '' then return json_build_object('ip', null, 'source', 'none'); end if;
  begin
    a := host(v::inet)::inet; -- drop any /mask the value carried
  exception when others then
    return json_build_object('ip', 'invalid', 'source', src || ', unreadable');
  end;
  if family(a) = 6 and a <<= '::ffff:0.0.0.0/96'::inet then
    a := '0.0.0.0'::inet + (a - '::ffff:0.0.0.0'::inet); -- ::ffff:1.2.3.4 is the IPv4 address 1.2.3.4
  end if;
  if family(a) = 6 then
    return json_build_object('ip', network(set_masklen(a, 64))::text, 'source', src || ', IPv6 /64');
  end if;
  return json_build_object('ip', host(a), 'source', src);
end $$;
revoke execute on function public.request_ip_info() from public, anon, authenticated;

-- 5. ------------------------------------------------------------------------------------ #admin -> Players
-- Players, newest first, optionally matching a name (leaderboard name or the login provider's name).
create or replace function public.admin_players(p_q text default '', p_limit int default 200) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  return (select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from (
    select p.id, p.name, p.created_at, u.last_sign_in_at as last_seen,
      coalesce(acc.account, '') as account,
      coalesce(u.is_anonymous, false) as anonymous,
      (select count(*) from public.daily_scores s where s.user_id = p.id) as daily,
      (select count(*) from public.daily_quiz_scores q where q.user_id = p.id) as quiz,
      (select max(s.score) from public.daily_scores s where s.user_id = p.id) as best,
      public.admin_of(p.id) as admin
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join lateral (
      -- the provider's own record of the account (refreshed at each login; the player can't write it)
      select coalesce(i.identity_data ->> 'full_name', i.identity_data -> 'custom_claims' ->> 'global_name',
                      i.identity_data ->> 'name', i.identity_data ->> 'user_name') as account
      from auth.identities i
      where i.user_id = p.id and i.provider <> 'anonymous'
      order by (i.provider = 'discord') desc, i.provider
      limit 1) acc on true
    where coalesce(btrim(p_q), '') = ''
      or p.name ilike '%' || btrim(p_q) || '%'
      or coalesce(acc.account, '') ilike '%' || btrim(p_q) || '%'
    order by p.created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))) t);
end $$;
revoke execute on function public.admin_players(text, int) from public, anon;
grant execute on function public.admin_players(text, int) to authenticated; -- admin_guard() refuses everyone else

-- 6. -------------------------------------------------------------------------------- profile name size, name_ok
create or replace function public.profiles_name_size() returns trigger
language plpgsql set search_path = '' as $$
begin
  if char_length(new.name) > 64 then
    raise exception 'that name is too long' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.profiles_name_size() from public, anon, authenticated;
drop trigger if exists a_0_profiles_name_size on public.profiles;
-- "a_0_..." sorts before "a_rate_limit_..." and "profiles_name_check": it runs first (triggers fire in name order)
create trigger a_0_profiles_name_size before insert or update of name on public.profiles
  for each row execute function public.profiles_name_size();

revoke execute on function public.name_ok(text) from public, anon;
grant execute on function public.name_ok(text) to authenticated; -- profiles_name_check runs as the caller

-- 7. ------------------------------------------------------------------------- default grants on future tables
do $$
begin
  alter default privileges in schema public revoke all on tables from anon, authenticated;
  alter default privileges in schema public revoke all on sequences from anon, authenticated;
exception when others then
  raise notice 'default privileges: could not change them (%); new tables still need RLS before use', sqlerrm;
end $$;

-- 8. ----------------------------------------------------------------------------- suggestion_reviews.prompt_id
do $$
begin
  if to_regclass('public.suggestion_reviews') is not null and not exists (
      select 1 from pg_constraint where conname = 'suggestion_reviews_prompt_id_shape'
        and conrelid = 'public.suggestion_reviews'::regclass) then
    alter table public.suggestion_reviews add constraint suggestion_reviews_prompt_id_shape
      check (prompt_id ~ '^[a-z0-9][a-z0-9-]{0,63}$') not valid; -- not valid: rows already there aren't rechecked
  end if;
end $$;

-- Self-check: things to look at, printed as NOTICEs. Nothing here changes the database.
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity loop
    raise notice 'CHECK: table public.% has no row level security', r.relname;
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for r in select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' loop
      raise notice 'CHECK: %.% is published to Realtime (the game uses none)', r.schemaname, r.tablename;
    end loop;
  end if;
  for r in select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not coalesce(array_to_string(p.proconfig, ',') like '%search_path%', false) loop
    raise notice 'CHECK: security definer function % has no search_path', r.f;
  end loop;
  for r in select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'execute') order by 1 loop
    raise notice 'signed-out visitors may call public.%', r.f;
  end loop;
end $$;
