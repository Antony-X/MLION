-- The daily quiz leaderboard. Additive: run once in the Supabase SQL editor (it only creates
-- new objects; nothing existing changes). Safe to run twice.
--
-- One row per player per day, like daily_scores. `marks` holds one digit per question
-- (1 right, 0 wrong or no answer); the score is recomputed here: 100 per right answer.
-- `tenths` is the total answer time in tenths of a second; equal scores rank by it.

create table if not exists public.daily_quiz_scores (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  marks text not null check (marks ~ '^[01]{7}$'),
  tenths int not null check (tenths between 0 and 99999),
  score int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists daily_quiz_scores_board on public.daily_quiz_scores (day, score desc, tenths, created_at);

create or replace function public.daily_quiz_scores_check() returns trigger
language plpgsql as $$
declare
  utc_day date := (now() at time zone 'utc')::date;
begin
  if new.day < utc_day - 1 or new.day > utc_day + 1 then
    raise exception 'only today''s quiz can be posted';
  end if;
  new.score := 100 * (char_length(new.marks) - char_length(replace(new.marks, '1', '')));
  new.created_at := now();
  return new;
end $$;

drop trigger if exists daily_quiz_scores_check on public.daily_quiz_scores;
create trigger daily_quiz_scores_check before insert on public.daily_quiz_scores
  for each row execute function public.daily_quiz_scores_check();

alter table public.daily_quiz_scores enable row level security;

drop policy if exists "quiz scores are public" on public.daily_quiz_scores;
drop policy if exists "insert own quiz score" on public.daily_quiz_scores;
create policy "quiz scores are public" on public.daily_quiz_scores for select using (true);
create policy "insert own quiz score" on public.daily_quiz_scores for insert to authenticated with check (auth.uid() = user_id);

revoke all on public.daily_quiz_scores from anon, authenticated;
grant select on public.daily_quiz_scores to anon, authenticated;
grant insert (user_id, day, marks, tenths) on public.daily_quiz_scores to authenticated;
