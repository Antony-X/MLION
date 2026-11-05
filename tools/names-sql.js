#!/usr/bin/env node
/* Writes supabase/names_v2.sql: the leaderboard name filter (nameOk in js/engine.js) as a database check,
 * so a name sent straight to the API is refused too. Run after changing the word lists or the maps:
 *   node tools/names-sql.js
 * supabase/names.sql is the first version, already run on the project; it is left as it was.
 * names_v2.sql replaces its function, so run it after names.sql (and again after any change here). */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require("../js/engine.js");

const q = (s) => s.replace(/'/g, "''");

const sql = `-- MLion: the leaderboard name check, version 2. Additive: run once in the Supabase SQL editor after
-- names.sql (safe to run again). Written by tools/names-sql.js from js/engine.js (nameOk); don't edit by hand.
-- New in v2: NFKD normalisation (fullwidth and maths letters), accents dropped, Cyrillic and Greek
-- look-alikes read as Latin, more leetspeak (@ $ ! | 9), small capitals, u/v and g/q swaps ("fvck", "niqqa"),
-- "kys", staff-like names (admin, moderator, official, support, MLion), and control, bidi, zero-width
-- characters or stacked combining marks refused.
-- Names already on the board are left alone; an admin can rename one in the admin panel.

create or replace function public.name_ok(p_name text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  raw text := coalesce(p_name, '');
  base text;
  s text;
  joined text;
  t text;
begin
  if raw ~ '${q(E.NAME_BAD_CHARS_SRC)}' then return false; end if;
  base := replace(translate(regexp_replace(lower(normalize(raw, NFKD)), '${E.NAME_MARKS}', '', 'g'),
    '${q(E.NAME_BASE_FROM)}', '${q(E.NAME_BASE_TO)}'), 'ph', 'f');
  foreach s in array array[base, replace(translate(base, '${q(E.NAME_FOLD_FROM)}', '${q(E.NAME_FOLD_TO)}'), 'ph', 'f')] loop
    joined := regexp_replace(s, '${E.NAME_OTHER_SRC}', '', 'g');
    if joined ~ '${q(E.NAME_PARTS_SRC)}' then return false; end if;
    if joined ~ '^(?:${q(E.NAME_RESERVED_SRC)})|(?:${q(E.NAME_RESERVED_SRC)})$' then return false; end if;
    foreach t in array array_append(regexp_split_to_array(s, '${E.NAME_OTHER_SRC}'), joined) loop
      if t <> '' and t ~ '^(?:${q(E.NAME_WORDS_SRC)})$' then return false; end if;
      if t <> '' and t ~ '^(?:${q(E.NAME_RESERVED_SRC)})|(?:${q(E.NAME_RESERVED_SRC)})$' then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function public.profiles_name_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.name_ok(new.name) then
    raise exception 'that name isn''t allowed' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists profiles_name_check on public.profiles;
create trigger profiles_name_check before insert or update of name on public.profiles
  for each row execute function public.profiles_name_check();
`;
const OUT = path.join(__dirname, "..", "supabase", "names_v2.sql");
if (require.main === module) {
  fs.writeFileSync(OUT, sql);
  console.log("wrote supabase/names_v2.sql");
}
module.exports = { sql, OUT }; // tests/engine.test.js checks the file is up to date
