-- MLion: the leaderboard name check, version 2. Additive: run once in the Supabase SQL editor after
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
  if raw ~ '[\u0001-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]|[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{3,}' then return false; end if;
  base := replace(translate(regexp_replace(lower(normalize(raw, NFKD)), '[\u0300-\u036f]', '', 'g'),
    '01345789@$!|€łøđıħᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'oieastbgasilelodihabcdefghijklmnoprstuvwyzабвгдежзийклмнопрстуфхцчшщъыьэюя'), 'ph', 'f');
  foreach s in array array[base, replace(translate(base, 'авекмнорстухіјѕԁӏԛԝүһьпигшАВЕКМНОРСТУХІЈЅαβγεηικνορτυχωμΑΒΕΖΗΙΚΜΝΟΡΤΥΧ', 'abekmhopctyxijsdlqwyhbnurwabekmhopctyxijsabyenikvoptuxwuabezhikmnoptyx'), 'ph', 'f')] loop
    joined := regexp_replace(s, '[^a-z0-9ა-ჿа-я]+', '', 'g');
    if joined ~ 'f+[uv]+c+k+|s+h+i+t+|c+[uv]+n+t+|n+i+[gq]{2,}e+r+|n+i+[gq]{2,}a+|f+a+[gq]{2,}o+t+|b+i+t+c+h+|w+h+o+r+e+|s+l+[uv]+t+|t+w+a+t+|p+[uv]+s{2,}y+|p+o+r+n+|d+i+l+d+o+|r+e+t+a+r+d+|m+o+t+h+e+r+f+|a+s{2,}h+o+l+e+|a+r+s+e+h+o+l+e+|j+i+z{2,}|p+e+n+i+s+|v+a+[gq]+i+n+a+|b+o{2,}b+|b+a+s+t+a+r+d+|b+o+l{2,}o+c+k+|b+e+l{2,}e+n+d+|w+a+n+k+e+r+|w+a+n+k+i+n+[gq]+|p+e+d+o+f+i+l+|p+a+e+d+o+f+i+l+|m+o+l+e+s+t+|i+n+c+e+s+t+|h+i+t+l+e+r+|k{3,}|p+i+s{2,}|b+l+o+w+j+o+b+|h+a+n+d+j+o+b+|o+r+[gq]+a+s+m+|d+o+[uv]+c+h+e+b+a+[gq]+|h+e+n+t+a+i+|c+[uv]+m+s+h+o+t+|f+[gq]{2,}o+t+|k+i+l{2,}y+o+[uv]+r+s+e+l+f+|k+i+l{2,}[uv]+r+s+e+l+f+|k+i+l{2,}y+o+s+e+l+f+|m+l+i+o+n+|b+l+y+a+t+|b+l+y+a+d+|p+i+z+d+|e+b+a+t+|e+b+l+a+n+|m+[uv]+d+a+k+|p+i+d+o+r+|p+i+d+a+r+|[gq]+a+n+d+o+n+|z+a+l+[uv]+p+|h+[uv]+e+s+o+s+|n+a+h+[uv]+i+|n+a+h+[uv]+y+|б+л+я+|п+и+з+д+|х+у+и+|х+у+е+|х+у+я+|е+б+а+т+|е+б+а+н+|е+б+л+а+н+|е+б+л+о+|п+и+д+о+р+|п+и+д+а+р+|п+е+д+и+к+|м+у+д+а+к+|г+а+н+д+о+н+|з+а+л+у+п+|ш+л+ю+х+' then return false; end if;
    if joined ~ '^(?:a+d+m+i+n+|a+d+m+i+n+i+s+t+r+a+t+o+r+|m+o+d+e+r+a+t+o+r+|o+f{2,}i+c+i+a+l+|s+[uv]+p{2,}o+r+t+)|(?:a+d+m+i+n+|a+d+m+i+n+i+s+t+r+a+t+o+r+|m+o+d+e+r+a+t+o+r+|o+f{2,}i+c+i+a+l+|s+[uv]+p{2,}o+r+t+)$' then return false; end if;
    foreach t in array array_append(regexp_split_to_array(s, '[^a-z0-9ა-ჿа-я]+'), joined) loop
      if t <> '' and t ~ '^(?:a+s{2,}|a+r+s+e+|d+i+c+k+|c+o+c+k+|r+a+p+e+|r+a+p+i+s+t+|c+[uv]+m+|s+e+x+|t+i+t+|t+i+t+s+|f+a+[gq]+|f+a+[gq]+s+|c+r+a+p+|a+n+a+l+|a+n+[uv]+s+|n+a+z+i+|p+e+d+o+|p+a+e+d+o+|p+r+i+c+k+|k+n+o+b+|t+o+s{2,}e+r+|w+a+n+k+|f+[uv]+k+|f+c+k+|f+[uv]+|s+t+f+[uv]+|w+t+f+|m+i+l+f+|n+[uv]+d+e+|n+[uv]+d+e+s+|h+o+r+n+y+|s+e+m+e+n+|s+p+e+r+m+|d+y+k+e+|t+r+a+n{2,}y+|h+o+m+o+|s+p+i+c+|c+h+i+n+k+|[gq]+o{2,}k+|k+i+k+e+|c+o{2,}n+|n+e+[gq]+r+o+|w+e+t+b+a+c+k+|j+a+p+|s+l+a+[gq]+|s+k+a+n+k+|h+o+e+|h+o+e+s+|t+h+o+t+|d+o+[uv]+c+h+e+|b+o+n+e+r+|p+[uv]+t+a+|p+[uv]+t+o+|p+[uv]+t+a+i+n+|m+e+r+d+e+|m+i+e+r+d+a+|c+a+b+r+o+n+|p+e+n+d+e+j+o+|s+[uv]+k+a+|h+[uv]+i+|h+[uv]+y+|x+[uv]+i+|x+[uv]+y+|b+l+y+a+|с+у+к+а+|е+б+у+|f+[gq]+t+|k+y+s+)$' then return false; end if;
      if t <> '' and t ~ '^(?:a+d+m+i+n+|a+d+m+i+n+i+s+t+r+a+t+o+r+|m+o+d+e+r+a+t+o+r+|o+f{2,}i+c+i+a+l+|s+[uv]+p{2,}o+r+t+)|(?:a+d+m+i+n+|a+d+m+i+n+i+s+t+r+a+t+o+r+|m+o+d+e+r+a+t+o+r+|o+f{2,}i+c+i+a+l+|s+[uv]+p{2,}o+r+t+)$' then return false; end if;
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
