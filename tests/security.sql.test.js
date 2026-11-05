#!/usr/bin/env node
/* The database attacks from the 2026-11-05 security audit, on PGlite (Postgres 17 in WebAssembly, no network):
 *   node tests/security.sql.test.js
 * Needs @electric-sql/pglite (not a dependency of the game): npm i --no-save @electric-sql/pglite, or point
 * NODE_PATH at a folder that has it.
 *
 * Each attack runs twice: on the files production has (schema, daily_quiz, admin, names, names_v2 when present,
 * quiz_speed, suggestions, rate_limits), where it must WORK (so the test can see it), and with
 * supabase/security_v1.sql run on top, twice (it must be safe to re-run), where it must FAIL.
 * Supabase's auth schema and API roles are stand-ins: auth.users, auth.identities, auth.uid() from
 * request.jwt.claim.sub, request.headers as PostgREST sets them, and Supabase's default privileges. */
"use strict";
const fs = require("fs");
const path = require("path");
let PGlite;
try { ({ PGlite } = require("@electric-sql/pglite")); } catch {
  console.log("skipped: @electric-sql/pglite isn't installed (npm i --no-save @electric-sql/pglite)");
  process.exit(0);
}
const SQL = path.join(__dirname, "..", "supabase");
let failed = 0;
function check(c, m) { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) failed++; }

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(99), EVE = U(1), BOB = U(2);

async function setup(fixed) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, is_anonymous boolean default false, raw_user_meta_data jsonb, last_sign_in_at timestamptz);
    create table auth.identities (user_id uuid references auth.users (id) on delete cascade, provider text, identity_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  const files = ["schema.sql", "daily_quiz.sql", "admin.sql", "names.sql", "names_v2.sql", "quiz_speed.sql", "suggestions.sql", "rate_limits.sql"]
    .filter((f) => fs.existsSync(path.join(SQL, f)));
  if (fixed) files.push("security_v1.sql", "security_v1.sql");
  for (const f of files) await db.exec(fs.readFileSync(path.join(SQL, f), "utf8"));
  for (let i = 1; i <= 30; i++) await db.query("insert into auth.users (id, is_anonymous) values ($1, true)", [U(i)]);
  await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, '{\"full_name\":\"Owner\"}')", [ADMIN]);
  await db.query("insert into auth.identities values ($1, 'discord', '{\"sub\":\"42\",\"full_name\":\"Owner\"}')", [ADMIN]);
  await db.query("insert into public.admins (discord_id) values ('42')");
  const state = { hdrs: { "cf-connecting-ip": "203.0.113.7" } };
  const as = async (role, uid, sql, params) => {
    await db.query("select set_config('request.headers', $1, false)", [state.hdrs ? JSON.stringify(state.hdrs) : ""]);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false); set role ${role};`);
    try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
  };
  const fails = async (p) => { try { await p; return false; } catch { return true; } };
  return { db, as, fails, state, files };
}

/** Each attack returns true when it worked. */
const ATTACKS = [
  ["a player writes their own profile created_at", async ({ db, as, fails }) => {
    const refused = await fails(as("authenticated", EVE, "insert into public.profiles (id, name, created_at) values ($1, 'Eve', '2001-01-01')", [EVE]));
    if (refused) await as("authenticated", EVE, "insert into public.profiles (id, name) values ($1, 'Eve')", [EVE]);
    const row = (await db.query("select created_at from public.profiles where id = $1", [EVE])).rows[0];
    return !refused && row.created_at.getUTCFullYear() === 2001;
  }],
  ["a daily score for a date that is today nowhere on Earth (tomorrow UTC before 09:00, yesterday after 13:00)", async ({ db, as, fails }) => {
    const h = new Date().getUTCHours(); // the window moves with the clock: pick the side that is closed now
    const off = h < 8 ? 1 : h >= 14 ? -1 : null;
    if (off === null) { console.log("    (between 08:00 and 14:00 UTC both neighbours are someone's today; checking the rule at fixed times instead)"); }
    if (off !== null) return !(await fails(as("authenticated", EVE, `insert into public.daily_scores (user_id, day, tiers) values ($1, (now() at time zone 'utc')::date + ${off}, '1111111')`, [EVE])));
    const has = (await db.query("select to_regprocedure('public.daily_day_ok(date, timestamptz)') is not null ok")).rows[0].ok;
    if (!has) return true; // before the fix: tomorrow UTC was accepted at any hour (schema.sql: utc_day - 1 .. utc_day + 1)
    const at = async (day, ts) => (await db.query("select public.daily_day_ok($1::date, $2::timestamptz) ok", [day, ts])).rows[0].ok;
    return (await at("2026-11-07", "2026-11-06 07:59Z")) || (await at("2026-11-05", "2026-11-06 13:01Z"))
      || !(await at("2026-11-07", "2026-11-06 09:01Z")) || !(await at("2026-11-05", "2026-11-06 12:59Z")) || !(await at("2026-11-06", "2026-11-06 00:00Z"));
  }],
  ["a quiz post whose tie-break (tenths 1) isn't its own times (7 x 35 s)", async ({ db, as, fails }) => {
    await as("authenticated", BOB, "insert into public.profiles (id, name) values ($1, 'Bob')", [BOB]);
    const refused = await fails(as("authenticated", BOB, "insert into public.daily_quiz_scores (user_id, day, marks, tenths, times) values ($1, (now() at time zone 'utc')::date, '1111111', 1, '350,350,350,350,350,350,350')", [BOB]));
    const q = (await db.query("select tenths from public.daily_quiz_scores where user_id = $1", [BOB])).rows[0];
    return !refused && q.tenths === 1;
  }],
  ["ten addresses in one IPv6 /64 each get the per-network limit (3/h)", async ({ db, as, fails, state }) => {
    await as("authenticated", ADMIN, "select public.admin_set_rate_limit('suggestion', 3, 100)");
    await db.exec("delete from public.ip_events; delete from public.answer_suggestions;");
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      state.hdrs = { "cf-connecting-ip": `2001:db8:1:2::${(i + 1).toString(16)}` };
      if (!(await fails(as("authenticated", U(3 + (i % 5)), "insert into public.answer_suggestions (user_id, prompt_id, answer_key, raw) values ($1, 'optimizer', $2, 'x')", [U(3 + (i % 5)), `v6-${i}`])))) ok++;
    }
    state.hdrs = { "cf-connecting-ip": "203.0.113.7" };
    return ok > 3;
  }],
  ["a header that isn't an address is never limited (limit 1/h, 4 writes)", async ({ db, as, fails, state }) => {
    await as("authenticated", ADMIN, "select public.admin_set_rate_limit('suggestion', 1, 1)");
    await db.exec("delete from public.ip_events");
    state.hdrs = { "cf-connecting-ip": "not-an-ip" };
    let ok = 0;
    for (let i = 0; i < 4; i++) if (!(await fails(as("authenticated", U(20 + i), "insert into public.answer_suggestions (user_id, prompt_id, answer_key, raw) values ($1, 'optimizer', $2, 'x')", [U(20 + i), `junk-${i}`])))) ok++;
    state.hdrs = { "cf-connecting-ip": "203.0.113.7" };
    await as("authenticated", ADMIN, "select public.admin_set_rate_limit('suggestion', 400, 3000)");
    return ok > 1;
  }],
  ["an anonymous account shows the admin a Discord name it chose itself", async ({ db, as }) => {
    await db.query("update auth.users set raw_user_meta_data = $2 where id = $1", [EVE, JSON.stringify({ full_name: "Antony (MLion owner)" })]);
    const pl = (await as("authenticated", ADMIN, "select public.admin_players('', 50) j")).rows[0].j.find((r) => r.id === EVE);
    return pl.account === "Antony (MLion owner)";
  }],
  ["signed-out visitors run the name filter on 100 KB (POST /rest/v1/rpc/name_ok)", async ({ as, fails }) =>
    !(await fails(as("anon", null, "select public.name_ok($1)", ["a".repeat(100000)])))],
  ["a 100 KB profile name reaches the name filter", async ({ db, as, fails }) => {
    // the name filter's notice: count calls by timing is flaky, so look at the error: the size guard names the size
    try { await as("authenticated", U(21), "insert into public.profiles (id, name) values ($1, $2)", [U(21), "a".repeat(100000)]); return true; } catch (e) { return !/too long/.test(e.message); }
  }],
  ["a table made later in the SQL editor is readable and writable by signed-out visitors", async ({ db, as, fails }) => {
    await db.exec("create table public.later_feature (id int primary key, secret text); insert into public.later_feature values (1, 'internal');");
    return !(await fails(as("anon", null, "select * from public.later_feature"))) || !(await fails(as("anon", null, "insert into public.later_feature values (2, 'x')")));
  }],
  ["an admin's review row names a path (../../x) for tools/pull_suggestions.js", async ({ as, fails }) =>
    !(await fails(as("authenticated", ADMIN, "insert into public.suggestion_reviews (prompt_id, answer_key, status) values ('../../x', 'k', 'approved')")))],
];

/** Still allowed with the fix: what honest players and admins do. */
const HONEST = [
  ["a new profile with a name", ({ as }) => as("authenticated", U(9), "insert into public.profiles (id, name) values ($1, 'Nine')", [U(9)])],
  ["a rename", ({ as }) => as("authenticated", U(9), "update public.profiles set name = 'Niner' where id = $1", [U(9)])],
  ["today's daily", ({ as }) => as("authenticated", U(9), "insert into public.daily_scores (user_id, day, tiers) values ($1, (now() at time zone 'utc')::date, '1234560')", [U(9)])],
  ["today's quiz with times", async ({ db, as }) => {
    await as("authenticated", U(9), "insert into public.daily_quiz_scores (user_id, day, marks, tenths, times) values ($1, (now() at time zone 'utc')::date, '1101100', 999, '20,40,350,31,100,5,7')", [U(9)]);
    const q = (await db.query("select score, tenths from public.daily_quiz_scores where user_id = $1", [U(9)])).rows[0];
    // right at 2.0 s, 4.0 s, 3.1 s, 10.0 s: 100, 98, 100, 89 (engine quizPoints); tenths = every time, wrong ones too
    if (q.tenths !== 553 || q.score !== 100 + 98 + 100 + 89) throw new Error(`quiz scored ${q.score}, tenths ${q.tenths}`);
  }],
  ["six IPv4-mapped addresses are six networks (limit 3/h)", async ({ db, as, state }) => {
    await as("authenticated", ADMIN, "select public.admin_set_rate_limit('suggestion', 3, 100)");
    await db.exec("delete from public.ip_events");
    for (let i = 0; i < 6; i++) {
      state.hdrs = { "cf-connecting-ip": `::ffff:198.51.100.${i + 1}` };
      await as("authenticated", U(10 + i), "insert into public.answer_suggestions (user_id, prompt_id, answer_key, raw) values ($1, 'optimizer', $2, 'x')", [U(10 + i), `v4m-${i}`]);
    }
    state.hdrs = { "cf-connecting-ip": "203.0.113.7" };
    await as("authenticated", ADMIN, "select public.admin_set_rate_limit('suggestion', 400, 3000)");
  }],
  ["the admin panel lists players with the provider's name", async ({ as }) => {
    const j = (await as("authenticated", ADMIN, "select public.admin_players('Owner', 50) j")).rows[0].j;
    if (!Array.isArray(j)) throw new Error("no list");
  }],
  ["a non-admin can't list players", async ({ as, fails }) => { if (!(await fails(as("authenticated", EVE, "select public.admin_players('', 50)")))) throw new Error("listed"); }],
];

(async () => {
  for (const fixed of [false, true]) {
    const env = await setup(fixed);
    console.log(fixed ? `\nwith security_v1.sql (run twice): every attack fails` : `production files (${env.files.join(", ")}): every attack works`);
    for (const [label, run] of ATTACKS) {
      let worked;
      try { worked = await run(env); } catch (e) { worked = false; console.log(`    (${e.message.slice(0, 120)})`); }
      check(fixed ? !worked : worked, `${label}: ${worked ? "works" : "refused"}`);
    }
    if (fixed) {
      console.log("\nwith security_v1.sql: what honest players and the admin do still works");
      for (const [label, run] of HONEST) {
        let err = null;
        try { await run(env); } catch (e) { err = e; }
        check(!err, `${label}${err ? ": " + err.message.slice(0, 120) : ""}`);
      }
    }
    await env.db.close();
  }
  console.log(failed ? `\n${failed} check(s) failed` : "\nsecurity sql test passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
