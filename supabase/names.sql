-- MLion: no swear words or slurs in leaderboard names. Additive: run once in the Supabase SQL editor
-- (safe to run again). Written by tools/names-sql.js from the lists in js/engine.js (nameOk); don't edit by hand.
-- Names already on the board are left alone; an admin can rename one in the admin panel.

create or replace function public.name_ok(p_name text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  s text := replace(translate(lower(coalesce(p_name, '')), '0134578ё', 'oieastbе'), 'ph', 'f');
  joined text := regexp_replace(s, '[^a-z0-9ა-ჿа-я]+', '', 'g');
  t text;
begin
  if joined ~ 'f+u+c+k+|s+h+i+t+|c+u+n+t+|n+i+g{2,}e+r+|n+i+g{2,}a+|f+a+g{2,}o+t+|b+i+t+c+h+|w+h+o+r+e+|s+l+u+t+|t+w+a+t+|p+u+s{2,}y+|p+o+r+n+|d+i+l+d+o+|r+e+t+a+r+d+|m+o+t+h+e+r+f+|a+s{2,}h+o+l+e+|a+r+s+e+h+o+l+e+|j+i+z{2,}|p+e+n+i+s+|v+a+g+i+n+a+|b+o{2,}b+|b+a+s+t+a+r+d+|b+o+l{2,}o+c+k+|b+e+l{2,}e+n+d+|w+a+n+k+e+r+|w+a+n+k+i+n+g+|p+e+d+o+p+h+i+l+|p+a+e+d+o+p+h+i+l+|m+o+l+e+s+t+|i+n+c+e+s+t+|h+i+t+l+e+r+|k{3,}|p+i+s{2,}|b+l+o+w+j+o+b+|h+a+n+d+j+o+b+|o+r+g+a+s+m+|d+o+u+c+h+e+b+a+g+|h+e+n+t+a+i+|c+u+m+s+h+o+t+|b+l+y+a+t+|b+l+y+a+d+|p+i+z+d+|e+b+a+t+|e+b+l+a+n+|m+u+d+a+k+|p+i+d+o+r+|p+i+d+a+r+|g+a+n+d+o+n+|z+a+l+u+p+|h+u+e+s+o+s+|n+a+h+u+i+|n+a+h+u+y+|б+л+я+|п+и+з+д+|х+у+й+|х+у+е+|х+у+я+|е+б+а+т+|е+б+а+н+|е+б+л+а+н+|е+б+л+о+|п+и+д+о+р+|п+и+д+а+р+|п+е+д+и+к+|м+у+д+а+к+|г+а+н+д+о+н+|з+а+л+у+п+|ш+л+ю+х+|m+u+t+e+l+|c+h+a+t+l+a+k+h+|c+h+a+t+l+a+x+|d+e+d+a+m+o+t+|მ+უ+ტ+ე+ლ+|ჩ+ა+თ+ლ+ა+ხ+|ტ+რ+ა+კ+|დ+ე+დ+ა+მ+ო+ტ+ყ+|პ+ი+დ+ა+რ+ა+ს+' then return false; end if;
  foreach t in array array_append(regexp_split_to_array(s, '[^a-z0-9ა-ჿа-я]+'), joined) loop
    if t <> '' and t ~ '^(?:a+s{2,}|a+r+s+e+|d+i+c+k+|c+o+c+k+|r+a+p+e+|r+a+p+i+s+t+|c+u+m+|s+e+x+|t+i+t+|t+i+t+s+|f+a+g+|f+a+g+s+|c+r+a+p+|a+n+a+l+|a+n+u+s+|n+a+z+i+|p+e+d+o+|p+a+e+d+o+|p+r+i+c+k+|k+n+o+b+|t+o+s{2,}e+r+|w+a+n+k+|f+u+k+|f+c+k+|f+u+|s+t+f+u+|w+t+f+|m+i+l+f+|n+u+d+e+|n+u+d+e+s+|h+o+r+n+y+|s+e+m+e+n+|s+p+e+r+m+|d+y+k+e+|t+r+a+n{2,}y+|h+o+m+o+|s+p+i+c+|c+h+i+n+k+|g+o{2,}k+|k+i+k+e+|c+o{2,}n+|n+e+g+r+o+|w+e+t+b+a+c+k+|j+a+p+|s+l+a+g+|s+k+a+n+k+|h+o+e+|h+o+e+s+|t+h+o+t+|d+o+u+c+h+e+|b+o+n+e+r+|p+u+t+a+|p+u+t+o+|p+u+t+a+i+n+|m+e+r+d+e+|m+i+e+r+d+a+|c+a+b+r+o+n+|p+e+n+d+e+j+o+|s+u+k+a+|h+u+i+|h+u+y+|x+u+i+|x+u+y+|b+l+y+a+|с+у+к+а+|е+б+у+|t+r+a+k+i+|y+l+e+|q+l+e+|b+o+z+i+|ყ+ლ+ე+|ბ+ო+ზ+ი+|ბ+ო+ზ+ო+)$' then return false; end if;
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
