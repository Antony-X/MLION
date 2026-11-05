-- MLion: Daily Quiz speed points. Run once in the Supabase SQL editor (safe to run again).
-- Adds one column (each answer's time) and replaces the quiz scoring function; existing rows keep
-- their scores. A right answer is worth 100 within 3 s, then falls in a straight line to 50 at the
-- 35 s buzzer (a bank question's clock); a wrong answer is 0. Integer maths, the same as quizPoints in js/engine.js.

alter table public.daily_quiz_scores add column if not exists times text
  check (times is null or times ~ '^[0-9]{1,3}(,[0-9]{1,3}){6}$');

create or replace function public.daily_quiz_scores_check() returns trigger
language plpgsql as $$
declare
  utc_day date := (now() at time zone 'utc')::date;
  total int := 0;
  t int;
  a int;
begin
  if new.day < utc_day - 1 or new.day > utc_day + 1 then
    raise exception 'only today''s quiz can be posted';
  end if;
  if new.times is null then
    total := 100 * (char_length(new.marks) - char_length(replace(new.marks, '1', '')));
  else
    for i in 1..7 loop
      if substr(new.marks, i, 1) = '1' then
        t := least(350, greatest(0, split_part(new.times, ',', i)::int)); -- tenths of a second
        a := greatest(0, 100 * t - 3000);                                 -- ms past the 3 s grace
        total := total + greatest(50, 100 - (100 * a + 32000) / 64000);   -- 50 * a / 32000, rounded half up
      end if;
    end loop;
  end if;
  new.score := total;
  new.created_at := now();
  return new;
end $$;

grant insert (times) on public.daily_quiz_scores to authenticated;
