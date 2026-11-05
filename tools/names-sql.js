#!/usr/bin/env node
/* Writes supabase/names.sql: the leaderboard name filter (nameOk in js/engine.js) as a database check,
 * so a name sent straight to the API is refused too. Run after changing the word lists:
 *   node tools/names-sql.js */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require("../js/engine.js");

const OTHER = "[^a-z0-9ა-ჿа-я]+"; // same as NAME_OTHER in the engine
const q = (s) => s.replace(/'/g, "''");

const sql = `-- MLion: no swear words or slurs in leaderboard names. Additive: run once in the Supabase SQL editor
-- (safe to run again). Written by tools/names-sql.js from the lists in js/engine.js (nameOk); don't edit by hand.
-- Names already on the board are left alone; an admin can rename one in the admin panel.

create or replace function public.name_ok(p_name text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  s text := replace(translate(lower(coalesce(p_name, '')), '0134578ё', 'oieastbе'), 'ph', 'f');
  joined text := regexp_replace(s, '${OTHER}', '', 'g');
  t text;
begin
  if joined ~ '${q(E.NAME_PARTS_SRC)}' then return false; end if;
  foreach t in array array_append(regexp_split_to_array(s, '${OTHER}'), joined) loop
    if t <> '' and t ~ '^(?:${q(E.NAME_WORDS_SRC)})$' then return false; end if;
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
fs.writeFileSync(path.join(__dirname, "..", "supabase", "names.sql"), sql);
console.log("wrote supabase/names.sql");
