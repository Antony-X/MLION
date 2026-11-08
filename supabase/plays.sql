-- Every round anyone plays, logged in or not (the owner, 2026-11-08: "every answer at all time should be stored ...
-- so we can inspect all of it"). Additive; safe to run twice. Run after rate_limits.sql.
--
-- One row per round: the prompt, everything typed in it (wrong tries too), the answer it settled on, its tier,
-- points and time. A browser is a random id the game makes (mlion:bid), so plays group by player without an
-- account; uid is filled when the browser has one (a login, or a guest who published a score).
-- Size: a row is about 150 bytes with its indexes. log_plays stops writing past PLAYS_CAP rows (~220 MB) so the
-- table can never fill the database (500 MB on the free plan, 11 MB used when this was written).
-- Writes come in batches (up to 50 rounds a call) and count against the "play" rate limit (#admin → Limits).
-- Players can't read the table; admins read it through admin_plays (#admin → Plays).

create table if not exists public.plays (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  bid text not null check (bid ~ '^[a-z0-9]{8,16}$'),
  uid uuid,
  nm text check (nm is null or char_length(nm) <= 16),
  mode text not null check (mode ~ '^[a-z]{1,12}$'),
  rk text check (rk is null or char_length(rk) <= 40),
  pid text not null check (char_length(pid) between 1 and 60),
  tries text[] check (tries is null or cardinality(tries) <= 80),
  ans text check (ans is null or char_length(ans) <= 600),
  tier smallint check (tier is null or tier between 0 and 6),
  pts int check (pts is null or pts between -100000 and 100000),
  ms int check (ms is null or ms between 0 and 3600000)
);
create index if not exists plays_at on public.plays (at);
create index if not exists plays_pid on public.plays (pid, at);
alter table public.plays enable row level security; -- no policies: only the functions below touch it
revoke all on public.plays from anon, authenticated;

insert into public.rate_limits (action, per_hour, per_day, note) values
  ('play', 600, 4000, 'Batches of played rounds sent for the play log (up to 50 rounds each)')
on conflict (action) do nothing;

-- p_rows: [{m: mode, k: run key, p: prompt id, tr: [typed...], a: answer, t: tier 0-6, s: points, ms}]
create or replace function public.log_plays(p_bid text, p_name text, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_bid !~ '^[a-z0-9]{8,16}$' or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 50 then
    return 0;
  end if;
  -- PLAYS_CAP: 1.5 million rows. reltuples is the planner's estimate: free to read, close enough for a cap.
  if (select c.reltuples from pg_catalog.pg_class c where c.oid = 'public.plays'::regclass) > 1500000 then return 0; end if;
  perform public.rate_limit_check('play');
  insert into public.plays (bid, uid, nm, mode, rk, pid, tries, ans, tier, pts, ms)
  select p_bid, auth.uid(), nullif(left(btrim(coalesce(p_name, '')), 16), ''),
    r.m, left(r.k, 40), left(r.p, 60),
    (select array_agg(left(x, 120)) from unnest(coalesce(r.tr, '{}'::text[])) with ordinality u(x, i) where i <= 80),
    left(r.a, 600),
    case when r.t between 0 and 6 then r.t end,
    case when r.s between -100000 and 100000 then r.s end,
    case when r.ms between 0 and 3600000 then r.ms end
  from jsonb_to_recordset(p_rows) as r(m text, k text, p text, tr text[], a text, t int, s int, ms int)
  where r.m ~ '^[a-z]{1,12}$' and char_length(coalesce(r.p, '')) between 1 and 60;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.log_plays(text, text, jsonb) from public;
grant execute on function public.log_plays(text, text, jsonb) to anon, authenticated;

-- #admin → Plays: every round between two moments (the page sends the bounds of a local day), newest last,
-- with the account's current name when there is one.
create or replace function public.admin_plays(p_from timestamptz, p_to timestamptz, p_limit int default 5000) returns json
language plpgsql security definer set search_path = '' stable as $$
begin
  perform public.admin_guard();
  return coalesce((select json_agg(x order by x.at) from (
    select p.at, p.bid, p.uid, coalesce(pr.name, p.nm) as name, p.mode, p.rk, p.pid, p.tries, p.ans, p.tier, p.pts, p.ms,
      public.admin_of(p.uid) as admin
    from public.plays p left join public.profiles pr on pr.id = p.uid
    where p.at >= p_from and p.at < p_to
    order by p.at limit least(greatest(coalesce(p_limit, 5000), 1), 20000)) x), '[]'::json);
end $$;
revoke execute on function public.admin_plays(timestamptz, timestamptz, int) from public, anon;
grant execute on function public.admin_plays(timestamptz, timestamptz, int) to authenticated;
