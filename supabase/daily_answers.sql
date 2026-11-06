-- MLion: what other players answered in the daily (user, 2026-11-06: "show stats like what other players
-- answered"; rarity stays as it is). Additive and safe to run twice; run after schema.sql and security_v1.sql.
--
-- Each player's seven answers for a day sit in daily_answers, posted through post_daily_answers() right after
-- their score. Nobody reads the table directly: daily_answers_for() hands out a day's answers only to a player
-- who has a score on that day, so no one can look at today's answers before playing. Only players whose score
-- is still on the board are listed (an admin who removes a score removes its answers from view too).
-- The page shows an answer only when it is a real answer to that day's prompt, so text posted by hand can't
-- put anything else on another player's screen.

create table if not exists public.daily_answers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  answers text[] not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint daily_answers_seven check (cardinality(answers) = 7)
);
alter table public.daily_answers enable row level security;
revoke all on public.daily_answers from anon, authenticated;

-- Post your answers for a day you have a score on: seven slots, each an answer's name (at most 80 characters)
-- or '' for a miss. The first post counts; a second one changes nothing.
create or replace function public.post_daily_answers(p_day date, p_answers text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_day is null or p_answers is null or cardinality(p_answers) <> 7 then return false; end if;
  if exists (select 1 from unnest(p_answers) as x(a) where a is null or char_length(a) > 80) then return false; end if;
  if not exists (select 1 from public.daily_scores s where s.user_id = auth.uid() and s.day = p_day) then return false; end if;
  insert into public.daily_answers (user_id, day, answers) values (auth.uid(), p_day, p_answers)
    on conflict (user_id, day) do nothing;
  return true;
end $$;
revoke execute on function public.post_daily_answers(date, text[]) from public, anon;
grant execute on function public.post_daily_answers(date, text[]) to authenticated;

-- Everyone's answers for a day (yours marked), once you have a score on that day; nothing otherwise.
create or replace function public.daily_answers_for(p_day date) returns table (name text, answers text[], mine boolean)
language sql stable security definer set search_path = '' as $$
  select p.name, a.answers, a.user_id = auth.uid()
  from public.daily_answers a
  join public.daily_scores s on s.user_id = a.user_id and s.day = a.day
  join public.profiles p on p.id = a.user_id
  where a.day = p_day
    and exists (select 1 from public.daily_scores me where me.user_id = auth.uid() and me.day = p_day)
  order by a.created_at
  limit 200;
$$;
revoke execute on function public.daily_answers_for(date) from public, anon;
grant execute on function public.daily_answers_for(date) to authenticated;
