-- An admin can replay today's daily or quiz, and the newest score is the one on the board (the owner, 2026-11-10:
-- "as admin give me the ability to play again no matter what if I have already played, and the newest score
-- should display"). Players keep the rule in schema.sql: one score per account and day, the first post counts.
--
-- admin_replace_score(kind, day, after): removes the caller's own score for that day (and, for the daily, the
-- answers that went up with it) only if it was posted before `after`, the time the newer run started. The game
-- then posts the newer run the normal way. A run older than the score on the board (say, from another device)
-- removes nothing, so it can't push a newer score out. Admins only; it acts on auth.uid() alone.
-- Run after admin.sql and daily_answers.sql. Safe to run twice.

create or replace function public.admin_replace_score(p_kind text, p_day date, p_after timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.admin_guard();
  if p_day is null or p_after is null then return false; end if;
  if p_kind = 'quiz' then
    delete from public.daily_quiz_scores where user_id = auth.uid() and day = p_day and created_at < p_after;
    get diagnostics n = row_count;
  else
    delete from public.daily_scores where user_id = auth.uid() and day = p_day and created_at < p_after;
    get diagnostics n = row_count;
    if n > 0 then delete from public.daily_answers where user_id = auth.uid() and day = p_day; end if;
  end if;
  return n > 0;
end $$;

revoke execute on function public.admin_replace_score(text, date, timestamptz) from public, anon;
grant execute on function public.admin_replace_score(text, date, timestamptz) to authenticated;
