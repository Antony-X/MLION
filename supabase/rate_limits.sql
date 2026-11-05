-- Per-network (per-IP) limits on everything the game writes, changeable in #admin → Limits. Additive: run once in
-- the Supabase SQL editor, LAST, after schema.sql, daily_quiz.sql, admin.sql, names.sql, quiz_speed.sql and
-- suggestions.sql (it adds triggers to their tables; a table that doesn't exist yet is skipped, so run this file
-- again after adding one). It only creates new objects. Safe to run twice; a second run keeps the limits you set.
--
-- What it does
--   * public.rate_limits: one row per action with a limit per hour and per day (null = no limit, 0 = none allowed).
--     Everyone may read it; only admins change it, through admin_set_rate_limit().
--   * A BEFORE trigger on each table players write counts that network's successful writes of that action in the
--     last hour and day (public.ip_events) and refuses the write past either limit with SQLSTATE PT429, which
--     PostgREST sends as HTTP 429; the game shows "Too many tries from this network. Try again later."
--     Actions: profile (a new profile: first login or first publish/suggest), rename (a profile's name changes),
--     daily_score, quiz_score, suggestion. Admins (public.is_admin()) are never limited.
--   * Only a salted SHA-256 of the address is stored (the salt lives in public.rate_limit_secret, which no API role
--     can read), and each write also deletes up to 200 rows older than 2 days, so the log stays small.
--   * Refused writes are not logged: the refusal rolls the whole write back, log row included. The admin page
--     shows who is AT a limit, not how many times they were turned away.
--
-- Which address (researched 2026-11-05)
--   PostgREST puts the request's headers in current_setting('request.headers'). Supabase's own guide reads
--   x-forwarded-for and takes the FIRST value (https://supabase.com/docs/guides/api/securing-your-api), but that
--   value is whatever the client sent: a Supabase user showed a forged x-forwarded-for reaching Postgres as
--   "spoofed,<real ip>", with cf-connecting-ip holding the real address
--   (https://github.com/orgs/supabase/discussions/34647, no official answer). Supabase's API sits behind
--   Cloudflare, which sets CF-Connecting-IP to the address that connected to it and recommends it over
--   X-Forwarded-For (https://developers.cloudflare.com/fundamentals/reference/http-headers/). So: cf-connecting-ip
--   first; if it's missing, the LAST x-forwarded-for value (the one a proxy appended); never the first. Neither is
--   documented by Supabase as spoof-proof. #admin → Limits shows which header your own request was read from; to
--   check, send a request with a made-up X-Forwarded-For and CF-Connecting-IP and see that the hash doesn't change.
--   A request with no usable header (the SQL editor, a direct connection) counts as "unknown": logged, never limited.
--
-- Shared networks: a school, an olympiad venue or a phone carrier's NAT puts many players behind one address. The
-- defaults are set for a few hundred players on one network; raise them in #admin if a venue hits them.

create table if not exists public.rate_limits (
  action text primary key check (action ~ '^[a-z_]{1,32}$'),
  per_hour int check (per_hour is null or per_hour between 0 and 1000000),
  per_day int check (per_day is null or per_day between 0 and 10000000),
  note text check (note is null or char_length(note) <= 120),
  updated_at timestamptz not null default now()
);
insert into public.rate_limits (action, per_hour, per_day, note) values
  ('profile', 60, 300, 'New profiles: a first login, or a first publish or suggestion'),
  ('rename', 60, 300, 'Name changes'),
  ('daily_score', 200, 1000, 'Daily scores posted'),
  ('quiz_score', 200, 1000, 'Daily quiz scores posted'),
  ('suggestion', 400, 3000, 'Answer suggestions (each player also has 50 a day)')
on conflict (action) do nothing;

create table if not exists public.rate_limit_secret (
  id int primary key default 1 check (id = 1),
  salt text not null
);
insert into public.rate_limit_secret (id, salt) values (1, gen_random_uuid()::text || gen_random_uuid()::text)
on conflict (id) do nothing;

create table if not exists public.ip_events (
  id bigint generated always as identity primary key,
  ip_hash text not null, -- 24 hex characters of sha256(salt || address), or 'unknown'
  action text not null,
  at timestamptz not null default now()
);
create index if not exists ip_events_by_ip on public.ip_events (ip_hash, action, at);
create index if not exists ip_events_by_time on public.ip_events (at);

alter table public.rate_limits enable row level security;
alter table public.rate_limit_secret enable row level security; -- no policies: nobody reads it over the API
alter table public.ip_events enable row level security; -- no policies: only the functions below read it
drop policy if exists "limits are public" on public.rate_limits;
create policy "limits are public" on public.rate_limits for select using (true);
revoke all on public.rate_limits, public.rate_limit_secret, public.ip_events from anon, authenticated;
grant select on public.rate_limits to anon, authenticated;

-- The caller's address and which header it came from: {ip, source}. ip is null when no header is usable.
create or replace function public.request_ip_info() returns json
language plpgsql stable set search_path = '' as $$
declare hdr json; v text; src text;
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
  begin
    return json_build_object('ip', host(v::inet), 'source', src);
  exception when others then
    return json_build_object('ip', null, 'source', 'none');
  end;
end $$;
revoke execute on function public.request_ip_info() from public, anon, authenticated;

create or replace function public.ip_hash(p_ip text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_ip is null then 'unknown'
    else left(encode(sha256(convert_to((select s.salt from public.rate_limit_secret s where s.id = 1) || '|' || p_ip, 'UTF8')), 'hex'), 24) end;
$$;
revoke execute on function public.ip_hash(text) from public, anon, authenticated;

-- Count this network's write of p_action; refuse it past the limit.
create or replace function public.rate_limit_check(p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare h text; lim public.rate_limits%rowtype; n_hour int; n_day int;
begin
  if public.is_admin() then return; end if;
  h := public.ip_hash(public.request_ip_info() ->> 'ip');
  delete from public.ip_events where id in (
    select e.id from public.ip_events e where e.at < now() - interval '2 days' order by e.at limit 200);
  if h <> 'unknown' then
    select * into lim from public.rate_limits r where r.action = p_action;
    if found and (lim.per_hour is not null or lim.per_day is not null) then
      perform pg_advisory_xact_lock(hashtextextended('mlion-ip:' || h || ':' || p_action, 0));
      select count(*) filter (where e.at > now() - interval '1 hour'), count(*) into n_hour, n_day
        from public.ip_events e where e.ip_hash = h and e.action = p_action and e.at > now() - interval '24 hours';
      if (lim.per_hour is not null and n_hour >= lim.per_hour) or (lim.per_day is not null and n_day >= lim.per_day) then
        raise exception 'Too many tries from this network. Try again later.'
          using errcode = 'PT429', detail = p_action, hint = 'rate limit';
      end if;
    end if;
  end if;
  insert into public.ip_events (ip_hash, action) values (h, p_action);
end $$;
revoke execute on function public.rate_limit_check(text) from public, anon, authenticated;

create or replace function public.rate_limit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.rate_limit_check(tg_argv[0]);
  return new;
end $$;
revoke execute on function public.rate_limit_trigger() from public, anon, authenticated;

-- The triggers. Named "a_…" so they run before each table's own checks (triggers fire in name order).
do $$
declare t record;
begin
  for t in select * from (values
      ('profiles', 'a_rate_limit_profile', 'insert', 'profile', null),
      ('profiles', 'a_rate_limit_rename', 'update', 'rename', 'old.name is distinct from new.name'),
      ('daily_scores', 'a_rate_limit', 'insert', 'daily_score', null),
      ('daily_quiz_scores', 'a_rate_limit', 'insert', 'quiz_score', null),
      ('answer_suggestions', 'a_rate_limit', 'insert', 'suggestion', null)
    ) as v(tbl, name, ev, action, cond) loop
    if to_regclass('public.' || t.tbl) is null then
      raise notice 'rate limits: no table public.% yet; run this file again after creating it', t.tbl;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', t.name, t.tbl);
    execute format('create trigger %I before %s on public.%I for each row %s execute function public.rate_limit_trigger(%L)',
      t.name, t.ev, t.tbl, case when t.cond is null then '' else 'when (' || t.cond || ')' end, t.action);
  end loop;
end $$;

-- #admin → Limits: each action's limits and its writes in the last hour and day, the networks with the most writes
-- in the last day (and whether they're at a limit now), unknown-network writes, and how this request was read.
create or replace function public.admin_rate_limits() returns json
language plpgsql stable security definer set search_path = '' as $$
declare me json := public.request_ip_info();
begin
  perform public.admin_guard();
  return json_build_object(
    'limits', (select coalesce(json_agg(json_build_object(
        'action', r.action, 'per_hour', r.per_hour, 'per_day', r.per_day, 'note', r.note, 'updated_at', r.updated_at,
        'hour', (select count(*) from public.ip_events e where e.action = r.action and e.at > now() - interval '1 hour'),
        'day', (select count(*) from public.ip_events e where e.action = r.action and e.at > now() - interval '24 hours'))
        order by r.action), '[]'::json) from public.rate_limits r),
    'top', (select coalesce(json_agg(t order by t.day desc), '[]'::json) from (
        select e.ip_hash, e.action, count(*)::int as day,
          (count(*) filter (where e.at > now() - interval '1 hour'))::int as hour,
          max(e.at) as last_at,
          ((r.per_hour is not null and count(*) filter (where e.at > now() - interval '1 hour') >= r.per_hour)
            or (r.per_day is not null and count(*) >= r.per_day)) as at_limit
        from public.ip_events e left join public.rate_limits r on r.action = e.action
        where e.at > now() - interval '24 hours' and e.ip_hash <> 'unknown'
        group by e.ip_hash, e.action, r.per_hour, r.per_day
        order by count(*) desc limit 10) t),
    'unknown', (select count(*) from public.ip_events e where e.ip_hash = 'unknown' and e.at > now() - interval '24 hours'),
    'me', json_build_object('source', me ->> 'source', 'ip_hash', public.ip_hash(me ->> 'ip')));
end $$;

create or replace function public.admin_set_rate_limit(p_action text, p_per_hour int, p_per_day int) returns json
language plpgsql security definer set search_path = '' as $$
declare r json;
begin
  perform public.admin_guard();
  if p_per_hour < 0 or p_per_day < 0 then raise exception 'limits are 0 or more (empty: no limit)'; end if;
  update public.rate_limits set per_hour = p_per_hour, per_day = p_per_day, updated_at = now() where action = p_action
    returning json_build_object('action', action, 'per_hour', per_hour, 'per_day', per_day, 'updated_at', updated_at) into r;
  if r is null then raise exception 'no such action: %', p_action; end if;
  return r;
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_rate_limits()', 'admin_set_rate_limit(text, int, int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
