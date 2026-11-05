-- MLion admin panel (#admin in the game). Additive: run once in the Supabase SQL editor; it only creates
-- new objects (two tables and some functions) and changes nothing that exists. Safe to run twice.
--
-- Who is an admin: a Discord account listed in public.admins (by its Discord user id, which stays the same
-- when an account is deleted and made again). Every admin_* function checks that itself, so the page in the
-- browser guards nothing; nobody else can call them.
--
-- Add an admin (their Discord user id; it is identity_data->>'sub' of their discord row in auth.identities):
--   insert into public.admins (discord_id, note) values ('123456789012345678', 'owner');

create table if not exists public.admins (
  discord_id text primary key,
  note text,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security; -- no policies: only these functions read it
revoke all on public.admins from anon, authenticated;

-- One public row the game reads at start: the launch day (MLion #1), a home banner, and when an admin
-- last reset every player (devices clear progress saved before that).
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  launch date,
  banner text check (banner is null or char_length(banner) <= 200),
  reset_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;
alter table public.app_config enable row level security;
drop policy if exists "config is public" on public.app_config;
create policy "config is public" on public.app_config for select using (true);
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

-- Is this auth user an admin?
create or replace function public.admin_of(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.identities i
    join public.admins a on a.discord_id in (i.identity_data ->> 'sub', i.identity_data ->> 'provider_id')
    where i.user_id = p_user and i.provider = 'discord');
$$;
revoke execute on function public.admin_of(uuid) from public, anon, authenticated;

-- Is the caller an admin? (The game asks to show the Admin panel link.)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.admin_of(auth.uid()), false);
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.admin_guard() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
end $$;
revoke execute on function public.admin_guard() from public, anon, authenticated;

-- Overview: players, plays today, the last 14 days, today's top five on each board.
create or replace function public.admin_overview() returns json
language plpgsql stable security definer set search_path = '' as $$
declare d0 date := (now() at time zone 'utc')::date;
begin
  perform public.admin_guard();
  return json_build_object(
    'today', d0,
    'players', (select count(*) from public.profiles),
    'new_today', (select count(*) from public.profiles where (created_at at time zone 'utc')::date = d0),
    'new_week', (select count(*) from public.profiles where (created_at at time zone 'utc')::date > d0 - 7),
    'daily_today', (select count(*) from public.daily_scores where day = d0),
    'quiz_today', (select count(*) from public.daily_quiz_scores where day = d0),
    'days', (select json_agg(json_build_object(
        'day', g.d,
        'daily', (select count(*) from public.daily_scores s where s.day = g.d),
        'quiz', (select count(*) from public.daily_quiz_scores q where q.day = g.d),
        'joined', (select count(*) from public.profiles p where (p.created_at at time zone 'utc')::date = g.d)) order by g.d)
      from (select d0 - k as d from generate_series(0, 13) k) g),
    'top_daily', (select coalesce(json_agg(t), '[]'::json) from (
        select p.name, s.score from public.daily_scores s join public.profiles p on p.id = s.user_id
        where s.day = d0 order by s.score desc, s.created_at limit 5) t),
    'top_quiz', (select coalesce(json_agg(t), '[]'::json) from (
        select p.name, s.score, s.tenths from public.daily_quiz_scores s join public.profiles p on p.id = s.user_id
        where s.day = d0 order by s.score desc, s.tenths, s.created_at limit 5) t)
  );
end $$;

-- Players, newest first, optionally matching a name (leaderboard name or Discord name).
create or replace function public.admin_players(p_q text default '', p_limit int default 200) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  return (select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from (
    select p.id, p.name, p.created_at, u.last_sign_in_at as last_seen,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'user_name', '') as account,
      (select count(*) from public.daily_scores s where s.user_id = p.id) as daily,
      (select count(*) from public.daily_quiz_scores q where q.user_id = p.id) as quiz,
      (select max(s.score) from public.daily_scores s where s.user_id = p.id) as best,
      public.admin_of(p.id) as admin
    from public.profiles p left join auth.users u on u.id = p.id
    where coalesce(btrim(p_q), '') = ''
      or p.name ilike '%' || btrim(p_q) || '%'
      or coalesce(u.raw_user_meta_data ->> 'full_name', '') ilike '%' || btrim(p_q) || '%'
    order by p.created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))) t);
end $$;

-- One day's board, best first. p_kind: 'daily' or 'quiz'.
create or replace function public.admin_scores(p_day date, p_kind text default 'daily') returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  if p_kind = 'quiz' then
    return (select coalesce(json_agg(t), '[]'::json) from (
      select s.user_id, p.name, s.score, s.marks as detail, s.tenths, s.created_at
      from public.daily_quiz_scores s join public.profiles p on p.id = s.user_id
      where s.day = p_day order by s.score desc, s.tenths, s.created_at) t);
  end if;
  return (select coalesce(json_agg(t), '[]'::json) from (
    select s.user_id, p.name, s.score, s.tiers as detail, null::int as tenths, s.created_at
    from public.daily_scores s join public.profiles p on p.id = s.user_id
    where s.day = p_day order by s.score desc, s.created_at) t);
end $$;

create or replace function public.admin_remove_score(p_kind text, p_user uuid, p_day date) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.admin_guard();
  if p_kind = 'quiz' then delete from public.daily_quiz_scores where user_id = p_user and day = p_day;
  else delete from public.daily_scores where user_id = p_user and day = p_day; end if;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_rename(p_user uuid, p_name text) returns json
language plpgsql security definer set search_path = '' as $$
declare r json;
begin
  perform public.admin_guard();
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 16 then raise exception 'a name is 1 to 16 characters'; end if;
  update public.profiles set name = btrim(p_name) where id = p_user returning json_build_object('id', id, 'name', name) into r;
  return r;
end $$;

-- Deletes the account; its profile and scores go with it (on delete cascade). Admins can't be deleted here.
create or replace function public.admin_delete_player(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.admin_guard();
  if public.admin_of(p_user) then raise exception 'admins can''t be deleted here'; end if;
  delete from auth.users where id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_set_launch(p_launch date) returns json
language plpgsql security definer set search_path = '' as $$
declare r json;
begin
  perform public.admin_guard();
  update public.app_config set launch = p_launch, updated_at = now() where id = 1
    returning json_build_object('launch', launch, 'banner', banner, 'reset_at', reset_at) into r;
  return r;
end $$;

create or replace function public.admin_set_banner(p_text text) returns json
language plpgsql security definer set search_path = '' as $$
declare r json;
begin
  perform public.admin_guard();
  update public.app_config set banner = nullif(left(btrim(coalesce(p_text, '')), 200), ''), updated_at = now() where id = 1
    returning json_build_object('launch', launch, 'banner', banner, 'reset_at', reset_at) into r;
  return r;
end $$;

-- Every score, every non-admin account, and (through reset_at) every device's saved progress.
create or replace function public.admin_reset_all(p_confirm text) returns json
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; t timestamptz := now();
begin
  perform public.admin_guard();
  if p_confirm is distinct from 'RESET' then raise exception 'type RESET to confirm'; end if;
  delete from public.daily_quiz_scores where true; get diagnostics a = row_count;
  delete from public.daily_scores where true; get diagnostics b = row_count;
  delete from auth.users u where not public.admin_of(u.id); get diagnostics c = row_count;
  update public.app_config set reset_at = t, updated_at = t where id = 1;
  return json_build_object('quiz', a, 'daily', b, 'players', c, 'reset_at', t);
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_overview()', 'admin_players(text, int)', 'admin_scores(date, text)',
    'admin_remove_score(text, uuid, date)', 'admin_rename(uuid, text)', 'admin_delete_player(uuid)',
    'admin_set_launch(date)', 'admin_set_banner(text)', 'admin_reset_all(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
