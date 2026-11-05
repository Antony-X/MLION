-- "Suggest this answer": players propose answers the key is missing. Additive: run once in the Supabase SQL
-- editor, after admin.sql (it uses public.is_admin() and public.admin_guard()). It only creates new objects and
-- changes nothing that exists. Safe to run twice.
--
-- What is stored, and who sees it:
--   * answer_suggestions: one row per (player, prompt, answer key). A row holds the prompt id, the answer's
--     normalised key (engine fullKey), the text as typed, and how it got here: 'tap' (the player tapped
--     "Suggest it") or 'auto' (the player switched on "Send answers the game rejects" in Settings).
--     Nothing is logged for players who do neither.
--   * Any signed-in account may insert its own rows, anonymous sign-ins included. Nobody but an admin reads
--     the rows. The game reads only suggestion_count(), which returns a number of distinct players and
--     nothing below 4 (small counts stay private).
--   * suggestion_reviews: an admin's verdict on a (prompt, key): approved or rejected. A rejected key stops
--     showing "N other players tried this too". Approving changes no game data: the owner pulls approved
--     ones with tools/pull_suggestions.js and commits them to data/prompts/*.json.
--   * Rows are not tied to auth.users by a foreign key, so deleting players (or "Reset all players") keeps
--     the review queue; a deleted player's rows are left with an id that points at nobody.
--
-- Limits: prompt ids look like the game's (a-z, 0-9, hyphens, up to 64), keys up to 80 characters, typed text
-- up to 120, and at most 50 suggestions per player in any 24 hours (a trigger).

create table if not exists public.answer_suggestions (
  user_id uuid not null default auth.uid(),
  prompt_id text not null check (prompt_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  answer_key text not null check (char_length(answer_key) between 1 and 80),
  raw text not null check (char_length(raw) between 1 and 120),
  source text not null default 'tap' check (source in ('tap', 'auto')),
  created_at timestamptz not null default now(),
  primary key (user_id, prompt_id, answer_key)
);
create index if not exists answer_suggestions_answer on public.answer_suggestions (prompt_id, answer_key);
create index if not exists answer_suggestions_recent on public.answer_suggestions (user_id, created_at);

create table if not exists public.suggestion_reviews (
  prompt_id text not null,
  answer_key text not null,
  status text not null check (status in ('approved', 'rejected')),
  answer text check (answer is null or char_length(answer) between 1 and 120), -- the spelling to add
  reviewed_by uuid,
  reviewed_at timestamptz not null default now(),
  pulled_at timestamptz, -- set by tools/pull_suggestions.js --mark-pulled
  primary key (prompt_id, answer_key)
);

-- Inserts: the row is always the caller's, stamped now, trimmed; 50 a day at most. Security definer so it can
-- count the caller's earlier rows, which the caller itself can't read.
create or replace function public.answer_suggestions_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  if new.user_id is null then raise exception 'sign in first' using errcode = '42501'; end if;
  new.raw := btrim(new.raw);
  new.answer_key := btrim(new.answer_key);
  new.created_at := now();
  perform pg_advisory_xact_lock(hashtextextended('mlion-suggest:' || new.user_id::text, 0));
  select count(*) into n from public.answer_suggestions s
    where s.user_id = new.user_id and s.created_at > now() - interval '24 hours';
  if n >= 50 then raise exception 'at most 50 suggestions a day' using errcode = '54000'; end if;
  return new;
end $$;
revoke execute on function public.answer_suggestions_check() from public, anon, authenticated;

drop trigger if exists answer_suggestions_check on public.answer_suggestions;
create trigger answer_suggestions_check before insert on public.answer_suggestions
  for each row execute function public.answer_suggestions_check();

alter table public.answer_suggestions enable row level security;
alter table public.suggestion_reviews enable row level security;

drop policy if exists "insert own suggestion" on public.answer_suggestions;
drop policy if exists "admins read suggestions" on public.answer_suggestions;
create policy "insert own suggestion" on public.answer_suggestions for insert to authenticated
  with check (user_id = auth.uid());
create policy "admins read suggestions" on public.answer_suggestions for select to authenticated
  using (public.is_admin());

drop policy if exists "admins read reviews" on public.suggestion_reviews;
drop policy if exists "admins add reviews" on public.suggestion_reviews;
drop policy if exists "admins change reviews" on public.suggestion_reviews;
create policy "admins read reviews" on public.suggestion_reviews for select to authenticated using (public.is_admin());
create policy "admins add reviews" on public.suggestion_reviews for insert to authenticated with check (public.is_admin());
create policy "admins change reviews" on public.suggestion_reviews for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Supabase grants everything on new tables by default; narrow it to what the game uses.
revoke all on public.answer_suggestions, public.suggestion_reviews from anon, authenticated;
grant insert (user_id, prompt_id, answer_key, raw, source) on public.answer_suggestions to authenticated;
grant select on public.answer_suggestions to authenticated; -- the policy above lets only admins see rows
grant select, insert, update on public.suggestion_reviews to authenticated; -- admins only, by policy
grant select, insert, update, delete on public.answer_suggestions, public.suggestion_reviews to service_role; -- tools/pull_suggestions.js

-- How many distinct players suggested (or, opted in, typed) this rejected answer: 0 below 4, and 0 once an
-- admin rejected it. The caller is left out when it is signed in. The game shows "N other players tried
-- this too" when more than 3 others did.
create or replace function public.suggestion_count(p_prompt text, p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.suggestion_reviews r
                 where r.prompt_id = p_prompt and r.answer_key = p_key and r.status = 'rejected') then 0
    else (select case when c.n >= 4 then c.n else 0 end from (
            select count(distinct s.user_id)::int as n from public.answer_suggestions s
            where s.prompt_id = p_prompt and s.answer_key = p_key
              and s.user_id is distinct from auth.uid()) c)
  end;
$$;
revoke execute on function public.suggestion_count(text, text) from public;
grant execute on function public.suggestion_count(text, text) to anon, authenticated;

-- The admin panel's Suggestions tab: one row per (prompt, key), most players first.
-- p_status: 'open' (not reviewed yet), 'approved', 'rejected' or 'all'.
create or replace function public.admin_suggestions(p_status text default 'open', p_limit int default 200) returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  return (select coalesce(json_agg(t order by t.players desc, t.last_seen desc), '[]'::json) from (
    select s.prompt_id, s.answer_key,
      count(distinct s.user_id)::int as players,
      count(*) filter (where s.source = 'tap')::int as taps,
      count(*) filter (where s.source = 'auto')::int as autos,
      min(s.created_at) as first_seen, max(s.created_at) as last_seen,
      (select coalesce(json_agg(x.raw order by x.n desc, x.raw), '[]'::json) from (
          select s2.raw, count(*) as n from public.answer_suggestions s2
          where s2.prompt_id = s.prompt_id and s2.answer_key = s.answer_key
          group by s2.raw order by count(*) desc, s2.raw limit 5) x) as spellings,
      r.status, r.answer, r.reviewed_at, r.pulled_at
    from public.answer_suggestions s
    left join public.suggestion_reviews r on r.prompt_id = s.prompt_id and r.answer_key = s.answer_key
    where case coalesce(p_status, 'open')
            when 'open' then r.status is null
            when 'all' then true
            else r.status = p_status end
    group by s.prompt_id, s.answer_key, r.status, r.answer, r.reviewed_at, r.pulled_at
    order by count(distinct s.user_id) desc, max(s.created_at) desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))) t);
end $$;

-- Approve or reject a (prompt, key); 'open' takes the verdict back. p_answer: the spelling to add when approving
-- (default: the most common spelling players typed).
create or replace function public.admin_review_suggestion(p_prompt text, p_key text, p_status text, p_answer text default null) returns json
language plpgsql security definer set search_path = '' as $$
declare r json; spelled text;
begin
  perform public.admin_guard();
  if p_status = 'open' then
    delete from public.suggestion_reviews where prompt_id = p_prompt and answer_key = p_key;
    return json_build_object('prompt_id', p_prompt, 'answer_key', p_key, 'status', null);
  end if;
  if p_status not in ('approved', 'rejected') then raise exception 'status is approved, rejected or open'; end if;
  spelled := nullif(left(btrim(coalesce(p_answer, '')), 120), '');
  if spelled is null then
    select s.raw into spelled from public.answer_suggestions s where s.prompt_id = p_prompt and s.answer_key = p_key
      group by s.raw order by count(*) desc, s.raw limit 1;
  end if;
  if spelled is null then raise exception 'no suggestion for that answer'; end if;
  insert into public.suggestion_reviews as v (prompt_id, answer_key, status, answer, reviewed_by, reviewed_at, pulled_at)
    values (p_prompt, p_key, p_status, spelled, auth.uid(), now(), null)
    on conflict (prompt_id, answer_key) do update
      set status = excluded.status, answer = excluded.answer, reviewed_by = excluded.reviewed_by,
          reviewed_at = excluded.reviewed_at, pulled_at = null
    returning json_build_object('prompt_id', v.prompt_id, 'answer_key', v.answer_key, 'status', v.status, 'answer', v.answer) into r;
  return r;
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_suggestions(text, int)', 'admin_review_suggestion(text, text, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
