-- MLion daily leaderboard.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- Rules the database enforces (the browser is never trusted with the score):
--   * one row per account per day; the first post counts, rows can't be edited or deleted
--   * only today's daily (±1 day, because players' local dates span time zones)
--   * the score is recomputed here from the seven tier digits, whatever the client sends
--   * everyone can read the board; you can only write your own rows

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 16),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_scores (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  -- one digit per question: 0 miss, 1 baseline, 2 overfit, 3 in-distribution,
  -- 4 outlier, 5 long tail, 6 one in a MLion (same code as challenge links)
  tiers text not null check (tiers ~ '^[0-6]{7}$'),
  score int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists daily_scores_board on public.daily_scores (day, score desc, created_at);

create or replace function public.daily_scores_check() returns trigger
language plpgsql as $$
declare
  pts int[] := array[0, 10, 15, 30, 60, 85, 100];
  utc_day date := (now() at time zone 'utc')::date;
  total int := 0;
  d text;
begin
  if new.day < utc_day - 1 or new.day > utc_day + 1 then
    raise exception 'only today''s daily can be posted';
  end if;
  foreach d in array regexp_split_to_array(new.tiers, '') loop
    total := total + pts[d::int + 1];
  end loop;
  new.score := total;
  new.created_at := now();
  return new;
end $$;

drop trigger if exists daily_scores_check on public.daily_scores;
create trigger daily_scores_check before insert on public.daily_scores
  for each row execute function public.daily_scores_check();

alter table public.profiles enable row level security;
alter table public.daily_scores enable row level security;

drop policy if exists "profiles are public" on public.profiles;
drop policy if exists "insert own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
create policy "insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "scores are public" on public.daily_scores;
drop policy if exists "insert own score" on public.daily_scores;
create policy "scores are public" on public.daily_scores for select using (true);
create policy "insert own score" on public.daily_scores for insert to authenticated with check (auth.uid() = user_id);

-- Supabase grants everything on new tables by default; narrow it to what the game uses.
revoke all on public.profiles, public.daily_scores from anon, authenticated;
grant select on public.profiles, public.daily_scores to anon, authenticated;
grant insert, update (name) on public.profiles to authenticated;
grant insert (user_id, day, tiers) on public.daily_scores to authenticated;
