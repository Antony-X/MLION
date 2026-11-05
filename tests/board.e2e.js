#!/usr/bin/env node
/* Leaderboard end-to-end test against a stand-in Supabase (no real accounts needed).
 *   node tests/board.e2e.js
 * The page loads the real supabase-js from the CDN; every request to the fake project
 * (https://mock.supabase.test) is answered here, including the PKCE login round trip. */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const MOCK = "https://mock.supabase.test";
const UID = "00000000-0000-4000-8000-00000000a11a";
const RIVAL = "00000000-0000-4000-8000-00000000b22b";
const ANON = "00000000-0000-4000-8000-00000000c33c"; // a publish-only account (anonymous sign-in)
const ANON2 = "00000000-0000-4000-8000-00000000d44d"; // a player who taps Suggest it (anonymous sign-in on that tap)
const E = require("../js/engine.js");
const PTS = [0, 10, 15, 30, 60, 85, 100];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); }

// ---- the fake project: tiny in-memory tables that follow the real rules in supabase/schema.sql
const db = { profiles: new Map(), scores: [], quiz: [], quizTable: false }; // the quiz table arrives with supabase/daily_quiz.sql
const sugg = { table: true, rows: [], reviews: new Map(), counts: [], offline: false }; // supabase/suggestions.sql
const calls = [];
const providers = { google: false, discord: true }; // what the dashboard has switched on
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
let anonId = ANON; // whom the next anonymous sign-in makes
function session(anon = false) {
  const user = anon
    ? { id: anonId, aud: "authenticated", role: "authenticated", is_anonymous: true, user_metadata: {}, app_metadata: { provider: "anonymous" } }
    : { id: UID, aud: "authenticated", role: "authenticated", email: "ada@example.invalid", user_metadata: { full_name: "Ada Lovelace" }, app_metadata: { provider: "google" } };
  return { access_token: jwt(user.id), refresh_token: anon ? "r2" : "r1", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user };
}
let anonOn = true; // "Allow anonymous sign-ins" in the dashboard
let anonGone = false; // the publish-only account was deleted on the server (an admin reset)
function filters(u) {
  const f = {};
  for (const [k, v] of u.searchParams) { const m = v.match(/^(eq|gt|lt)\.(.*)$/); if (m) f[k] = [m[1], m[2]]; }
  return f;
}
const pass = (row, f) => Object.entries(f).every(([k, [op, v]]) => (op === "eq" ? String(row[k]) === v : op === "lt" ? Number(row[k]) < Number(v) : Number(row[k]) > Number(v)));

async function mockRoute(route) {
  const req = route.request();
  const u = new URL(req.url());
  const method = req.method();
  const hdr = req.headers();
  const json = (status, body, extra) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...(extra || {}) }, body: body === undefined ? "" : JSON.stringify(body) });
  calls.push(`${method} ${u.pathname}${u.search}`);
  if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });

  // auth
  if (u.pathname === "/auth/v1/settings") return json(200, { external: { google: providers.google, discord: providers.discord, email: true } });
  if (u.pathname === "/auth/v1/authorize") {
    const back = u.searchParams.get("redirect_to");
    return route.fulfill({ status: 302, headers: { location: `${back}${back.includes("?") ? "&" : "?"}code=test-code` } });
  }
  if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "pkce") {
    const body = JSON.parse(req.postData() || "{}");
    if (body.auth_code !== "test-code" || !body.code_verifier) return json(400, { error: "bad pkce" });
    return json(200, session());
  }
  if (u.pathname === "/auth/v1/signup" && method === "POST") { // supabase.auth.signInAnonymously()
    if (!anonOn) return json(422, { code: "anonymous_provider_disabled", msg: "Anonymous sign-ins are disabled" });
    return json(200, session(true));
  }
  if (u.pathname === "/auth/v1/user") {
    let sub = "";
    try { sub = JSON.parse(Buffer.from((hdr.authorization || "").replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub || ""; } catch { /* anon key */ }
    if (sub === ANON && anonGone) return json(403, { code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
    return json(200, sub === anonId ? session(true).user : session().user);
  }
  if (u.pathname === "/auth/v1/logout") return json(204);

  // rest
  const single = /vnd\.pgrst\.object/.test(hdr.accept || "");
  const reply = (rows, status = 200) => {
    if (single) return rows.length === 1 ? json(status, rows[0]) : json(406, { code: "PGRST116", message: "no rows" });
    return json(status, rows);
  };
  let me = null; // the caller's user id, read from the bearer token like PostgREST would
  try { me = JSON.parse(Buffer.from((hdr.authorization || "").replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub || null; } catch { /* anon key */ }
  if (u.pathname === "/rest/v1/profiles") {
    const f = filters(u);
    if (method === "GET") return reply([...db.profiles.values()].filter((r) => pass(r, f)));
    if (method === "POST") {
      const row = JSON.parse(req.postData());
      const r = Array.isArray(row) ? row[0] : row;
      if (r.id !== me) return json(403, { code: "42501", message: "rls" });
      if (db.profiles.has(r.id)) return json(409, { code: "23505", message: "dup" });
      if (!E.nameOk(r.name)) return json(400, { code: "23514", message: "that name isn't allowed" }); // supabase/names.sql
      db.profiles.set(r.id, { id: r.id, name: r.name });
      return reply([db.profiles.get(r.id)], 201);
    }
    if (method === "PATCH") {
      const patch = JSON.parse(req.postData());
      if (!E.nameOk(patch.name)) return json(400, { code: "23514", message: "that name isn't allowed" });
      const rows = [...db.profiles.values()].filter((r) => pass(r, f) && r.id === me);
      rows.forEach((r) => Object.assign(r, { name: patch.name }));
      return reply(rows);
    }
  }
  if (u.pathname === "/rest/v1/daily_scores") {
    const f = filters(u);
    if (method === "POST") {
      const r = JSON.parse(req.postData());
      const row = Array.isArray(r) ? r[0] : r;
      if (row.user_id !== me || "score" in row) return json(403, { code: "42501", message: "rls" });
      if (db.scores.some((s) => s.user_id === row.user_id && s.day === row.day)) return json(409, { code: "23505", message: "duplicate key" });
      db.scores.push({ user_id: row.user_id, day: row.day, tiers: row.tiers, score: [...row.tiers].reduce((s, d) => s + PTS[+d], 0), created_at: new Date().toISOString() });
      return json(201);
    }
    const rows = db.scores.filter((s) => pass(s, f));
    if (method === "HEAD" || /count=exact/.test(hdr.prefer || "")) {
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", "content-range": `*/${rows.length}` }, body: method === "HEAD" ? "" : "[]" });
    }
    if (method === "GET") {
      const out = rows.slice().sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at))
        .map((s) => ({ ...s, profiles: db.profiles.get(s.user_id) ? { name: db.profiles.get(s.user_id).name } : null }));
      return reply(out);
    }
  }
  // suggestions, following supabase/suggestions.sql: own rows only, one per (user, prompt, key); the count leaves out
  // the caller, says 0 below 4 players and 0 once an admin rejected the answer
  if (u.pathname === "/rest/v1/rpc/suggestion_count" && method === "POST") {
    if (!sugg.table) return json(404, { code: "PGRST202", message: "Could not find the function public.suggestion_count" });
    const a = JSON.parse(req.postData() || "{}");
    sugg.counts.push(a);
    if (sugg.reviews.get(`${a.p_prompt}|${a.p_key}`) === "rejected") return json(200, 0);
    const n = new Set(sugg.rows.filter((r) => r.prompt_id === a.p_prompt && r.answer_key === a.p_key && r.user_id !== me).map((r) => r.user_id)).size;
    return json(200, n >= 4 ? n : 0);
  }
  if (u.pathname === "/rest/v1/answer_suggestions" && method === "POST") {
    if (!sugg.table) return json(404, { code: "PGRST205", message: "Could not find the table 'public.answer_suggestions' in the schema cache" });
    const r = JSON.parse(req.postData());
    const row = Array.isArray(r) ? r[0] : r;
    if (!me || row.user_id !== me) return json(403, { code: "42501", message: "rls" });
    if (sugg.rows.some((x) => x.user_id === me && x.prompt_id === row.prompt_id && x.answer_key === row.answer_key)) return json(409, { code: "23505", message: "duplicate key" });
    sugg.rows.push({ user_id: me, prompt_id: row.prompt_id, answer_key: row.answer_key, raw: row.raw, source: row.source || "tap" });
    return json(201);
  }
  if (u.pathname === "/rest/v1/daily_quiz_scores") {
    if (!db.quizTable) return json(404, { code: "PGRST205", message: "Could not find the table 'public.daily_quiz_scores' in the schema cache" });
    const f = filters(u);
    if (method === "POST") {
      const r = JSON.parse(req.postData());
      const row = Array.isArray(r) ? r[0] : r;
      if (row.user_id !== me || "score" in row || !/^[01]{7}$/.test(row.marks)) return json(403, { code: "42501", message: "rls" });
      if (db.quiz.some((s) => s.user_id === row.user_id && s.day === row.day)) return json(409, { code: "23505", message: "duplicate key" });
      if ("times" in row && !db.quizTimes) return json(400, { code: "PGRST204", message: "Could not find the 'times' column of 'daily_quiz_scores' in the schema cache" });
      if ("times" in row && !/^[0-9]{1,3}(,[0-9]{1,3}){6}$/.test(row.times)) return json(400, { code: "23514", message: "check" });
      const times = row.times ? row.times.split(",").map(Number) : null; // scored like the trigger in supabase/quiz_speed.sql
      const score = [...row.marks].reduce((s, c, i) => s + (c === "1" ? (times ? E.quizPoints(times[i]) : 100) : 0), 0);
      db.quiz.push({ user_id: row.user_id, day: row.day, marks: row.marks, tenths: row.tenths, times: row.times || null, score, created_at: new Date().toISOString() });
      return json(201);
    }
    const rows = db.quiz.filter((s) => pass(s, f));
    if (method === "HEAD" || /count=exact/.test(hdr.prefer || "")) {
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", "content-range": `*/${rows.length}` }, body: method === "HEAD" ? "" : "[]" });
    }
    if (method === "GET") {
      const out = rows.slice().sort((a, b) => b.score - a.score || a.tenths - b.tenths || a.created_at.localeCompare(b.created_at))
        .map((s) => ({ ...s, profiles: db.profiles.get(s.user_id) ? { name: db.profiles.get(s.user_id).name } : null }));
      return reply(out);
    }
  }
  return json(404, { message: "not mocked" });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((mock) => { window.MLION_BOARD = { url: mock, key: "sb_publishable_test" }; }, MOCK);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${MOCK}/**`, mockRoute);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.log("  page error: " + e.message); });
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|status of 40[69]/.test(m.text())) errors.push(m.text()); });

  await page.goto(base); // a first visit opens on the home page, no dialog
  await page.waitForSelector(".home");

  // ---- logged out
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  check(!!(await page.$('.home a[href="#board"]')) && !!(await page.$('#drawer a[href="#board"]')), "home and the menu link to the leaderboard");
  check(!(await page.$('script[src*="supabase"]')), "nothing extra loads for players who never logged in");

  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("mlion:settings") || "{}"); s.answerSecs = 40; localStorage.setItem("mlion:settings", JSON.stringify(s)); });
  await page.goto(base + "#daily");
  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
  const clock = parseFloat(await page.textContent("#timer-num"));
  check(clock > 20 && clock <= 25, `the daily keeps the 25 s clock even when Settings says 40 s (${clock} s left)`);

  await page.goto(base + "#board");
  await page.waitForFunction(() => /No scores yet/.test(document.querySelector("#board-list")?.textContent || ""), null, { timeout: 15000 });
  await page.waitForSelector("#app [data-login]");
  check((await page.$$eval("#app [data-login]", (els) => els.map((e) => e.dataset.login))).join() === "discord", "only providers switched on in Supabase get a button (Discord)");
  providers.google = true;
  await page.goto("about:blank");
  await page.goto(base + "#board");
  await page.waitForSelector('#app [data-login="google"]', { timeout: 15000 });
  check((await page.$$("#app [data-login]")).length === 2, "switching Google on in the dashboard adds its button, no code change");
  check((await page.textContent("#app .side")).includes("Play today's daily"), "the board points at today's daily when you haven't played");
  await page.waitForSelector('#drawer-acct [data-login="discord"]', { state: "attached" });
  check(true, "the menu offers Discord login on every page");

  // a finished daily (as if just played), scoring 6-5-4-3-2-1-0 = 300
  const tiers = ["mlion", "longtail", "outlier", "indist", "overfit", "baseline", "miss"];
  await page.evaluate(({ today, tiers }) => {
    const pts = { mlion: 100, longtail: 85, outlier: 60, indist: 30, overfit: 15, baseline: 10, miss: 0 };
    const results = tiers.map((t, i) => ({ promptId: "nope-" + i, promptText: "Q" + i, answer: t === "miss" ? null : "A" + i, raw: "", tier: t === "miss" ? null : t, score: pts[t] }));
    const rec = { key: `daily:${today}`, mode: "daily", number: 1, date: today, label: "MLion #1", promptIds: results.map((r) => r.promptId), results, score: 300, tiers, completedAt: Date.now(), secs: 25 };
    localStorage.setItem("mlion:records", JSON.stringify({ [rec.key]: rec }));
  }, { today, tiers });
  await page.goto("about:blank"); // a fresh load, so the app reads the record we just stored
  await page.goto(base + `#results-daily-${today}`);
  await page.waitForSelector("#board-box [data-login]", { timeout: 10000 }).catch(async (e) => { console.log(await page.evaluate(() => location.href + " :: " + (document.querySelector("#board-box") || {}).outerHTML + " :: " + JSON.stringify(Object.keys(localStorage)))); throw e; });
  check(!!(await page.$("#board-box #pub-btn")), "today's results offer Publish my score, and login");
  await page.waitForFunction(() => /No scores yet/.test(document.querySelector("#mini-board")?.textContent || ""), null, { timeout: 10000 });
  check(true, "under the results, today's leaderboard shows (empty so far)");

  // ---- log in with Google: PKCE round trip through the fake project
  const exchanged = page.waitForRequest((r) => r.url().startsWith(`${MOCK}/auth/v1/token`), { timeout: 20000 });
  await page.click('#board-box [data-login="google"]');
  await exchanged;
  await page.waitForFunction((t) => location.hash === `#results-daily-${t}` && !location.search, today, { timeout: 15000 });
  const auth = calls.find((c) => c.startsWith("GET /auth/v1/authorize"));
  const q = new URL(MOCK + auth.slice(4)).searchParams;
  check(q.get("provider") === "google" && q.get("redirect_to") === base && !!q.get("code_challenge"), "login goes to Google with PKCE and comes back to the site");
  check(calls.some((c) => c.startsWith("POST /auth/v1/token?grant_type=pkce")), "the returned code is swapped for a session");
  check(true, "you land back on the page you left, with the code gone from the address bar");

  await page.waitForFunction(() => /#1<\/b> of 1 today as Ada/.test(document.querySelector("#board-box")?.innerHTML || ""), null, { timeout: 15000 });
  check(true, "after login the score posts and the rank shows (#1 of 1 as Ada)");
  check(db.profiles.get(UID).name === "Ada", "the public name defaults to a first name only");
  check(db.scores.length === 1 && db.scores[0].score === 300 && db.scores[0].tiers === "6543210", "the database got the tier digits (and scored them 300)");
  await page.screenshot({ path: path.join(OUT, "board-01-results.png"), fullPage: true });

  // a rival with a higher score
  db.profiles.set(RIVAL, { id: RIVAL, name: "Grace" });
  db.scores.push({ user_id: RIVAL, day: today, tiers: "6666665", score: 685, created_at: new Date(Date.now() + 1000).toISOString() });

  await page.goto(base + "#board");
  await page.waitForSelector(".board-list .list-item.me");
  const rows = await page.$$eval(".board-list .list-item", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  check(rows.length === 2 && /^1 Grace/.test(rows[0]) && /685/.test(rows[0]) && /^2 Ada · you/.test(rows[1]) && /300/.test(rows[1]), "the board ranks by score and marks your row");
  check((await page.textContent(".board-acct")).includes("Ada"), "the board says who you're logged in as");
  check((await page.textContent("#drawer-acct")).includes("Logged in as Ada") && !!(await page.$("#acct-out")), "the menu shows the account and a Log out button");
  check(await page.evaluate(() => JSON.parse(localStorage.getItem("mlion:name"))) === "Ada", "the account name fills an empty player name for rooms and challenges");
  await page.screenshot({ path: path.join(OUT, "board-02-board.png"), fullPage: true });

  // posting twice doesn't duplicate
  await page.evaluate(() => localStorage.removeItem("mlion:boardPosted"));
  await page.reload();
  await page.waitForSelector(".board-list .list-item.me");
  check(db.scores.filter((s) => s.user_id === UID).length === 1, "a second post the same day is refused; the first score stays");

  // rename
  await page.click("#bn-edit");
  await page.fill("#bn-input", "Countess <b>");
  await page.click('#bn-form button[type="submit"]');
  await page.waitForFunction(() => /Countess b/.test(document.querySelector(".board-acct")?.textContent || ""), null, { timeout: 8000 });
  check(db.profiles.get(UID).name === "Countess b", "you can change your public name (markup is stripped)");

  // the quiz board: a calm note until the table exists, then posting, ranking and the time tie-break
  await page.click('.tabs a[href="#board-quiz"]');
  await page.waitForFunction(() => /opens soon/.test(document.querySelector("#board-list")?.textContent || ""), null, { timeout: 8000 });
  check(true, "before the quiz table exists, the Quiz tab says it opens soon (no error)");
  check((await page.textContent("#app .side")).includes("Play today's quiz"), "the Quiz tab points at today's quiz");
  db.quizTable = true;
  db.quizTimes = true; // supabase/quiz_speed.sql has been run
  await page.goto(base + "#quiz");
  await page.click('.dq-card a[href="#daily-quiz"]');
  for (let i = 0; i < 7; i++) {
    await page.waitForSelector(".mcq:not(.locked) .mcq-opt:not([disabled])", { timeout: 10000 });
    await page.keyboard.press("1");
    await page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    await page.click("#next");
  }
  await page.waitForFunction(() => /#1<\/b> of 1 today as Countess b/.test(document.querySelector("#board-box")?.innerHTML || ""), null, { timeout: 15000 });
  const mineQ = db.quiz.find((s) => s.user_id === UID);
  check(!!mineQ && /^[01]{7}$/.test(mineQ.marks) && mineQ.tenths > 0 && mineQ.tenths < 7 * 350, `the daily quiz posts its marks and total time (${mineQ && mineQ.marks}, ${mineQ && mineQ.tenths / 10} s)`);
  check(!!mineQ && /^\d+(,\d+){6}$/.test(mineQ.times || "") && mineQ.score === [...mineQ.marks].reduce((s, c, i) => s + (c === "1" ? E.quizPoints(+mineQ.times.split(",")[i]) : 0), 0), `and each answer's time, scored for speed (${mineQ && mineQ.times} -> ${mineQ && mineQ.score})`);
  { // before quiz_speed.sql is run there is no times column: the post retries without it and still lands
    const kept = db.quiz.splice(db.quiz.indexOf(mineQ), 1)[0];
    db.quizTimes = false;
    await page.evaluate((m) => { const b = JSON.parse(localStorage.getItem("mlion:boardPosted") || "{}"); delete b[m]; localStorage.setItem("mlion:boardPosted", JSON.stringify(b)); }, `q:${today}`);
    await page.reload();
    await page.waitForFunction(() => document.readyState === "complete");
    for (let i = 0; i < 50 && !db.quiz.some((s) => s.user_id === UID); i++) await page.waitForTimeout(200);
    const plain = db.quiz.find((s) => s.user_id === UID);
    check(!!plain && plain.times === null && plain.marks === kept.marks && plain.score === 100 * [...kept.marks].filter((c) => c === "1").length, "without the times column the quiz still posts, 100 a right answer");
    db.quiz.splice(db.quiz.indexOf(plain), 1, kept);
    db.quizTimes = true;
  }
  db.quiz.push({ user_id: RIVAL, day: today, marks: mineQ.marks, tenths: Math.max(0, mineQ.tenths - 5), score: mineQ.score, created_at: new Date(Date.now() + 1000).toISOString() });
  await page.goto(base + "#board-quiz");
  await page.waitForSelector(".board-list .list-item.me");
  const qrows = await page.$$eval(".board-list .list-item", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  check(qrows.length === 2 && /^1 Grace/.test(qrows[0]) && /^2 Countess b · you/.test(qrows[1]), "equal quiz scores rank by total time (Grace was faster)");
  check(db.scores.length === 2 && db.quiz.length === 2, "the two boards keep separate tables");
  await page.screenshot({ path: path.join(OUT, "board-03-quiz.png"), fullPage: true });
  await page.click('.tabs a[href="#board"]');
  await page.waitForSelector(".board-list .list-item.me");

  // before launch every day is #1, so there is no earlier board to page back to
  check(!(await page.$('.board-days a[href^="#board-"]')), "before launch the board has no past days");
  // after launch: the previous day, then log out
  const ago = new Date(Date.now() - 3 * 864e5);
  const launchDay = `${ago.getFullYear()}-${String(ago.getMonth() + 1).padStart(2, "0")}-${String(ago.getDate()).padStart(2, "0")}`;
  await page.addInitScript((d) => { window.MLION_LAUNCH = d; }, launchDay);
  await page.reload();
  await page.waitForSelector(".board-list .list-item.me");
  check((await page.textContent(".board-days")).includes("MLion #4"), "after launch the board counts days from launch day");
  await page.click('.board-days a[href^="#board-"]');
  await page.waitForFunction(() => /No scores yet/.test(document.querySelector("#board-list")?.textContent || ""), null, { timeout: 8000 });
  check(/^#board-\d{4}-\d{2}-\d{2}$/.test(await page.evaluate(() => location.hash)), "past days have their own board");
  await page.goto(base + "#board");
  await page.click("#menu-btn");
  await page.waitForSelector("#acct-out", { state: "visible" });
  await page.click("#acct-out");
  await page.waitForSelector(".board-side [data-login]");
  check(true, "log out brings the login buttons back");
  await page.goto(base + "#board-2000-01-01");
  await page.waitForFunction(() => location.hash === "#board", null, { timeout: 5000 });
  check(true, "a board before day 1 redirects to today's");

  // ---- publish without logging in: a fresh browser, a name, the swear filter
  const ctx2 = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  await ctx2.addInitScript((mock) => { window.MLION_BOARD = { url: mock, key: "sb_publishable_test" }; }, MOCK);
  await ctx2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx2.route(`${MOCK}/**`, mockRoute);
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => { errors.push(e.message); console.log("  page error: " + e.message); });
  await p2.goto(base);
  await p2.waitForSelector(".home");
  const tiers2 = ["mlion", "longtail", "longtail", "outlier", "outlier", "indist", "overfit"]; // 100+85+85+60+60+30+15 = 435
  await p2.evaluate(({ today, tiers }) => {
    const pts = { mlion: 100, longtail: 85, outlier: 60, indist: 30, overfit: 15, baseline: 10, miss: 0 };
    const results = tiers.map((t, i) => ({ promptId: "nope-" + i, promptText: "Q" + i, answer: "A" + i, raw: "", tier: t, score: pts[t] }));
    const rec = { key: `daily:${today}`, mode: "daily", number: 1, date: today, label: "MLion #1", promptIds: results.map((r) => r.promptId), results, score: 435, tiers, completedAt: Date.now(), secs: 25 };
    localStorage.setItem("mlion:records", JSON.stringify({ [rec.key]: rec }));
  }, { today, tiers: tiers2 });
  await p2.goto("about:blank");
  await p2.goto(base + `#results-daily-${today}`);
  await p2.waitForSelector("#mini-board .mb-list li");
  const mini = await p2.$$eval("#mini-board .mb-list li", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  check(mini.length === 2 && /^1\s*Grace\s*685$/.test(mini[0]) && /^2\s*Countess b\s*300$/.test(mini[1]), `without logging in, the results show today's top scores (${mini.join(" / ")})`);
  check(!(await p2.$('script[src*="supabase"]')), "reading the top scores needs no login library");
  anonOn = false;
  await p2.click("#pub-btn");
  await p2.fill("#pub-name", "Turing");
  await p2.click("#pub-go");
  await p2.waitForFunction(() => /isn't switched on/.test(document.querySelector("#pub-err")?.textContent || ""), null, { timeout: 15000 });
  check(true, "if anonymous sign-ins are off in Supabase, the dialog says so");
  anonOn = true;
  await p2.fill("#pub-name", "Fuuu ck");
  await p2.click("#pub-go");
  await p2.waitForFunction(() => /isn't allowed/.test(document.querySelector("#pub-err")?.textContent || ""), null, { timeout: 5000 });
  check(!db.profiles.has(ANON), "a swear name is refused before anything is sent");
  await p2.fill("#pub-name", "Turing");
  await p2.click("#pub-go");
  await p2.waitForFunction(() => /#2<\/b> of 3 today as Turing/.test(document.querySelector("#board-box")?.innerHTML || ""), null, { timeout: 15000 });
  check(db.profiles.get(ANON).name === "Turing" && db.scores.some((r) => r.user_id === ANON && r.score === 435), "Publish makes a no-login account named Turing and posts 435");
  await p2.waitForSelector("#mini-board li.me");
  check((await p2.textContent("#mini-board li.me")).includes("Turing"), "your row is marked in today's top five");
  check(calls.some((c) => c.startsWith("POST /auth/v1/signup")), "it used Supabase anonymous sign-in");
  await p2.screenshot({ path: path.join(OUT, "board-04-published.png"), fullPage: true });
  // the database refuses a bad name even when the page is skipped
  const raw = await p2.evaluate(async (mock) => {
    const tok = JSON.parse(localStorage.getItem("mlion:sb")).access_token;
    const r = await fetch(`${mock}/rest/v1/profiles?id=eq.00000000-0000-4000-8000-00000000c33c`, { method: "PATCH", headers: { apikey: "k", authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ name: "sh1t" }) });
    return r.status;
  }, MOCK);
  check(raw === 400 && db.profiles.get(ANON).name === "Turing", "a bad name sent straight to the API is refused (the database check)");
  // a publish-only account doesn't post by itself on later visits
  db.scores = db.scores.filter((r) => r.user_id !== ANON);
  await p2.evaluate(() => localStorage.removeItem("mlion:boardPosted"));
  await p2.goto("about:blank");
  await p2.goto(base + `#results-daily-${today}`);
  await p2.waitForSelector("#board-box #pub-btn");
  await sleep(800);
  check(!db.scores.some((r) => r.user_id === ANON), "a publish-only account waits for the button; it never posts by itself");
  await p2.click("#menu-btn");
  check((await p2.textContent("#drawer-acct")).includes("On the leaderboard as Turing") && !(await p2.$("#acct-out")), "the menu shows the publish name, with login to keep it everywhere");
  // the account is deleted on the server while this browser still holds its login: renaming logs out cleanly
  anonGone = true;
  db.profiles.delete(ANON);
  await p2.click("#acct-name");
  await p2.fill("#bn-input", "Lovelace");
  await p2.click('#bn-form button[type="submit"]');
  await p2.waitForFunction(() => /no longer exists/.test(document.body.textContent) && !document.querySelector("#bn-form"), null, { timeout: 8000 });
  check(true, "renaming a deleted account says so and closes the dialog");
  await p2.waitForFunction(() => !/On the leaderboard as/.test(document.querySelector("#drawer-acct")?.textContent || "") && !!document.querySelector("#board-box #pub-btn"), null, { timeout: 8000 });
  check(!db.profiles.has(ANON), "the browser drops the dead login; Publish is offered again");
  await ctx2.close();

  // ---- Suggest it: a rejected answer can be sent for review; the count of other players who sent it
  anonId = ANON2;
  const ctx3 = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  await ctx3.addInitScript((mock) => { window.MLION_BOARD = { url: mock, key: "sb_publishable_test" }; }, MOCK);
  await ctx3.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx3.route(`${MOCK}/**`, (r) => (sugg.offline ? r.abort("internetdisconnected") : mockRoute(r)));
  const p3 = await ctx3.newPage();
  p3.on("pageerror", (e) => { errors.push(e.message); console.log("  page error: " + e.message); });
  p3.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|status of 40[69]|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  const others = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
  const seed = (pid, raw, users) => users.forEach((u) => { if (!sugg.rows.some((r) => r.user_id === u && r.prompt_id === pid && r.answer_key === E.fullKey(raw))) sugg.rows.push({ user_id: u, prompt_id: pid, answer_key: E.fullKey(raw), raw, source: "tap" }); });
  /** The prompt now open in the run stored under mlion:run:<prefix>…, after waiting for the answer box to open. */
  const openPid = async (prefix) => {
    for (let i = 0; i < 3; i++) { // a round that ran out while we were away shows Next first
      await p3.waitForSelector("#answer:not([disabled]), #next:not([disabled])", { timeout: 15000 });
      if (await p3.$("#answer:not([disabled])")) break;
      await p3.click("#next");
    }
    return p3.evaluate((pre) => { const k = Object.keys(localStorage).find((x) => x.startsWith("mlion:run:" + pre)); const r = JSON.parse(localStorage.getItem(k)); return r.promptIds[r.round]; }, prefix);
  };
  const miss = async (box, raw) => {
    await p3.fill(box, raw);
    await p3.press(box, "Enter");
    await p3.waitForFunction((t) => (document.querySelector("#status")?.textContent || "").includes(t), raw, { timeout: 5000 });
  };
  const shown = () => p3.waitForSelector("#status .sg:not([hidden])", { timeout: 8000 });
  const sgText = () => p3.evaluate(() => (document.querySelector("#status .sg") || {}).textContent || "");
  const focused = (id) => p3.evaluate((x) => document.activeElement && document.activeElement.id === x, id);

  await p3.goto(base);
  await p3.waitForSelector(".home");
  // the daily: more than 3 others sent this answer, so the rejection says so
  await p3.goto(base + "#daily");
  let pid = await openPid("daily:");
  seed(pid, "qqzx blorpnet", others(5));
  const signups = () => calls.filter((c) => c.startsWith("POST /auth/v1/signup")).length;
  const signed0 = signups();
  await miss("#answer", "qqzx blorpnet");
  await shown();
  check(/5 other players tried this too/.test(await sgText()) && !!(await p3.$("#status .sg-btn")), "a daily miss five others sent says \"5 other players tried this too\" and offers Suggest it");
  check(await focused("answer") && !(await p3.isDisabled("#answer")), "the answer box keeps focus and the round goes on");
  check(signups() === signed0 && !(await p3.$('script[src*="supabase"]')), "a rejection alone signs nobody in and loads no login library");
  await p3.screenshot({ path: path.join(OUT, "board-05-suggest-count.png") });

  // Unlimited with a long clock, for the rest
  await p3.evaluate(() => { const s = JSON.parse(localStorage.getItem("mlion:settings") || "{}"); s.answerSecs = 60; localStorage.setItem("mlion:settings", JSON.stringify(s)); });
  await p3.goto("about:blank");
  await p3.goto(base + "#unlimited-play");
  pid = await openPid("unlimited:");
  seed(pid, "vvkq snorkel", others(3));
  await miss("#answer", "vvkq snorkel");
  await shown();
  check(!/other players/.test(await sgText()) && !!(await p3.$("#status .sg-btn")), "three others: no count yet, just Suggest it");
  await p3.click("#status .sg-btn");
  await p3.waitForFunction(() => /Sent for review\. Thanks\./.test(document.querySelector("#status .sg")?.textContent || ""), null, { timeout: 15000 });
  const mine = sugg.rows.find((r) => r.user_id === ANON2);
  check(!!mine && mine.prompt_id === pid && mine.answer_key === E.fullKey("vvkq snorkel") && mine.raw === "vvkq snorkel" && mine.source === "tap", `one tap sends the prompt, the key and the typed text (${pid}, "${mine && mine.answer_key}")`);
  check(signups() === signed0 + 1, "the tap made the anonymous account");
  check(await focused("answer") && !(await p3.isDisabled("#answer")), "after the tap you can keep typing");
  seed(pid, "vvkq snorkel", others(4)); // a fourth other player
  await miss("#answer", "VVKQ  snorkel");
  await shown();
  const again = await sgText();
  check(/4 other players tried this too/.test(again) && /Sent for review/.test(again) && !(await p3.$("#status .sg-btn")), "the same answer again: 4 others (you aren't counted), already sent, no button");
  check(sugg.rows.filter((r) => r.user_id === ANON2).length === 1, "and nothing is sent twice");
  // an admin rejected it: the count stops showing
  seed(pid, "ppzq gorp", others(6));
  sugg.reviews.set(`${pid}|${E.fullKey("ppzq gorp")}`, "rejected");
  await miss("#answer", "ppzq gorp");
  await shown();
  check(!/other players/.test(await sgText()) && !!(await p3.$("#status .sg-btn")), "a rejected suggestion shows no count");
  // offline: no button; a tap that can't get through fails quietly
  sugg.offline = true;
  await miss("#answer", "zzkq vorpal");
  await sleep(1200);
  check(!(await p3.$("#status .sg:not([hidden])")) && /isn't in the key/.test(await p3.textContent("#status")), "offline: the rejection shows as usual, with no Suggest button");
  sugg.offline = false;
  await miss("#answer", "mmqz florp");
  await shown();
  sugg.offline = true;
  await p3.click("#status .sg-btn");
  await p3.waitForFunction(() => /Couldn't send it right now/.test(document.querySelector("#status .sg")?.textContent || ""), null, { timeout: 10000 });
  check(!sugg.rows.some((r) => r.raw === "mmqz florp") && !(await p3.isDisabled("#answer")), "a tap that can't reach the server says so quietly; play goes on");
  sugg.offline = false;
  await p3.screenshot({ path: path.join(OUT, "board-06-suggest-sent.png") });

  // Sprint
  await p3.goto(base + "#sprint-loss-function");
  await p3.click("#sp-go");
  await p3.waitForSelector("#sp-answer");
  seed("loss-function", "wqqz blurf", others(4));
  await miss("#sp-answer", "wqqz blurf");
  await shown();
  check(/4 other players tried this too/.test(await sgText()), "Sprint misses show the count too");
  await p3.click("#status .sg-btn");
  await p3.waitForFunction(() => /Sent for review/.test(document.querySelector("#status .sg")?.textContent || ""), null, { timeout: 10000 });
  check(sugg.rows.some((r) => r.user_id === ANON2 && r.prompt_id === "loss-function" && r.raw === "wqqz blurf"), "and Suggest it works in Sprint");
  check(await focused("sp-answer"), "the sprint box keeps focus");

  // opt-in: Settings → send every rejected answer
  await p3.goto(base + "#prefs");
  await p3.waitForSelector('input[data-k="shareMisses"]', { state: "attached" });
  check(!(await p3.$eval('input[data-k="shareMisses"]', (i) => i.checked)), "Settings has \"Send answers the game rejects\", off by default");
  await p3.$eval('input[data-k="shareMisses"]', (i) => i.click());
  await p3.goto(base + "#unlimited-play");
  pid = await openPid("unlimited:");
  await miss("#answer", "kkzq auto miss");
  await p3.waitForFunction(() => /Sent for review/.test(document.querySelector("#status .sg")?.textContent || ""), null, { timeout: 10000 });
  check(sugg.rows.some((r) => r.user_id === ANON2 && r.raw === "kkzq auto miss" && r.source === "auto") && !(await p3.$("#status .sg-btn")), "switched on, a rejected answer is sent by itself (source auto)");

  // the database without suggestions.sql: nothing shows, nothing is sent
  sugg.table = false;
  await p3.goto("about:blank");
  await p3.goto(base + "#unlimited-play");
  await openPid("unlimited:");
  const before = sugg.rows.length;
  await miss("#answer", "jjqz no table");
  await sleep(1200);
  check(!(await p3.$("#status .sg:not([hidden])")) && sugg.rows.length === before, "before suggestions.sql is run: no button and nothing sent");
  await ctx3.close();

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  console.log("board e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
