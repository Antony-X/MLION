-- A player takes themselves off the leaderboard (user, 2026-11-08: "optionality to remove yourself from the
-- leaderboard, but a small one so people don't do it"; then: "admin can still see hidden leaderboard but know it's
-- hidden, other people can't").
--   leave_board(): sets profiles.off_board. Nothing is deleted: their scores and answers stay, but no one reads them
--                  any more (the select policies and the answer functions below), and the game stops posting their
--                  dailies by itself (guests' auto-post included, on every device).
--   join_board():  clears it again (the game calls it when the player taps Publish on a results page): every score
--                  they had is back on the boards.
--   The admin panel (admin_scores, admin_players) still lists them, marked hidden.
-- Players can only update their own name column (schema.sql), so both go through these functions, which act on
-- auth.uid() only. Run after schema.sql, daily_quiz.sql, daily_answers.sql and admin.sql.

alter table public.profiles add column if not exists off_board boolean not null default false;

create or replace function public.leave_board() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.profiles set off_board = true where id = auth.uid();
  return found;
end $$;

create or replace function public.join_board() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.profiles set off_board = false where id = auth.uid();
  return found;
end $$;

revoke execute on function public.leave_board() from public, anon;
revoke execute on function public.join_board() from public, anon;
grant execute on function public.leave_board() to authenticated;
grant execute on function public.join_board() to authenticated;

-- the boards (top rows, counts, ranks: everything reads these tables) leave hidden players out, for everyone
drop policy if exists "scores are public" on public.daily_scores;
create policy "scores are public" on public.daily_scores for select
  using (not exists (select 1 from public.profiles p where p.id = daily_scores.user_id and p.off_board));
drop policy if exists "quiz scores are public" on public.daily_quiz_scores;
create policy "quiz scores are public" on public.daily_quiz_scores for select
  using (not exists (select 1 from public.profiles p where p.id = daily_quiz_scores.user_id and p.off_board));

-- what others answered: the same rule (these run as definer, so they say it themselves)
create or replace function public.daily_answers_for(p_day date) returns table (name text, answers text[], mine boolean)
language sql stable security definer set search_path = '' as $$
  select p.name, a.answers, a.user_id = auth.uid()
  from public.daily_answers a
  join public.daily_scores s on s.user_id = a.user_id and s.day = a.day
  join public.profiles p on p.id = a.user_id
  where a.day = p_day and not p.off_board
    and exists (select 1 from public.daily_scores me where me.user_id = auth.uid() and me.day = p_day)
  order by a.created_at
  limit 200;
$$;
create or replace function public.daily_answers_board(p_day date) returns table (user_id uuid, answers text[])
language sql stable security definer set search_path = '' as $$
  select a.user_id, a.answers
  from public.daily_answers a
  join public.daily_scores s on s.user_id = a.user_id and s.day = a.day
  join public.profiles p on p.id = a.user_id
  where a.day = p_day and not p.off_board
    and (exists (select 1 from public.daily_scores me where me.user_id = (select auth.uid()) and me.day = p_day)
      or public.is_admin()) -- an admin sees them without playing (2026-11-08)
  limit 500;
$$;

-- the admin panel: everyone, hidden players marked
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
      public.admin_of(p.id) as admin,
      p.off_board as hidden
    from public.profiles p left join auth.users u on u.id = p.id
    where coalesce(btrim(p_q), '') = ''
      or p.name ilike '%' || btrim(p_q) || '%'
      or coalesce(u.raw_user_meta_data ->> 'full_name', '') ilike '%' || btrim(p_q) || '%'
    order by p.created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))) t);
end $$;

create or replace function public.admin_scores(p_day date, p_kind text default 'daily') returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  if p_kind = 'quiz' then
    return (select coalesce(json_agg(t), '[]'::json) from (
      select s.user_id, p.name, s.score, s.marks as detail, s.tenths, s.created_at, p.off_board as hidden
      from public.daily_quiz_scores s join public.profiles p on p.id = s.user_id
      where s.day = p_day order by s.score desc, s.tenths, s.created_at) t);
  end if;
  return (select coalesce(json_agg(t), '[]'::json) from (
    select s.user_id, p.name, s.score, s.tiers as detail, null::int as tenths, s.created_at, p.off_board as hidden
    from public.daily_scores s join public.profiles p on p.id = s.user_id
    where s.day = p_day order by s.score desc, s.created_at) t);
end $$;
