#!/usr/bin/env node
/* Admin panel (#admin) end to end, against a stand-in Supabase that follows supabase/admin.sql's rules:
 * an admin logs in, reads the overview, renames and deletes players, removes a score, sets the launch day
 * and a home banner, and resets everyone; a second browser (a normal player) sees the banner and the new
 * day number, is refused the panel, and has its saved progress cleared by the reset.
 *   node tests/admin.e2e.js */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const MOCK = "https://mock.supabase.test";
const ADA = "00000000-0000-4000-8000-00000000a11a"; // the admin
const ROB = "00000000-0000-4000-8000-00000000b22b";
const CY = "00000000-0000-4000-8000-00000000c33c";
const PAT = "00000000-0000-4000-8000-00000000d44d"; // logs in from the second browser
const PTS = [0, 10, 15, 30, 60, 85, 100];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const errors = [];
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); }

// ---- the fake project
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = ymd(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const ts = (n) => new Date(Date.now() - n * 864e5).toISOString();
const db = {
  users: new Map([[ADA, { name: "Ada Lovelace", last: ts(0) }], [ROB, { name: "Robert Smith", last: ts(1) }], [CY, { name: "Cy Twombly", last: ts(3) }]]),
  profiles: new Map([[ADA, { id: ADA, name: "Ada", created_at: ts(9) }], [ROB, { id: ROB, name: "Rob", created_at: ts(2) }], [CY, { id: CY, name: "Cy", created_at: ts(0) }]]),
  scores: [
    { user_id: ADA, day: TODAY, tiers: "6532110", created_at: ts(0) },
    { user_id: ROB, day: TODAY, tiers: "6666666", created_at: ts(0) },
    { user_id: CY, day: TODAY, tiers: "1111111", created_at: ts(0) },
    { user_id: ROB, day: daysAgo(1), tiers: "3333333", created_at: ts(1) },
  ].map((s) => ({ ...s, score: [...s.tiers].reduce((t, d) => t + PTS[+d], 0) })),
  quiz: [{ user_id: ROB, day: TODAY, marks: "1101111", tenths: 812, score: 600, created_at: ts(0) }],
  admins: new Set([ADA]),
  config: { launch: null, banner: null, reset_at: null },
  calls: [],
  // supabase/suggestions.sql: one row per (user, prompt, key), and an admin's verdict per (prompt, key)
  sugg: [
    ...["u1", "u2", "u3", "u4", "u5"].map((u, i) => ({ user_id: u, prompt_id: "optimizer", answer_key: "zorblax", raw: i < 3 ? "Zorblax" : "ZorbLax", source: i === 4 ? "auto" : "tap", created_at: ts(i) })),
    ...["u1", "u2"].map((u, i) => ({ user_id: u, prompt_id: "activation-function", answer_key: "squishu", raw: "SquishU", source: "tap", created_at: ts(i + 1) })),
    { user_id: "u6", prompt_id: "loss-function", answer_key: "lossyloss", raw: "lossy loss", source: "tap", created_at: ts(0) },
  ],
  reviews: new Map(),
  // supabase/rate_limits.sql
  limits: [["daily_score", 200, 1000], ["profile", 60, 300], ["quiz_score", 200, 1000], ["rename", 60, 300], ["suggestion", 400, 3000]]
    .map(([action, per_hour, per_day]) => ({ action, per_hour, per_day, note: null, updated_at: ts(1) })),
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`;
const userOf = (id, name) => ({ id, aud: "authenticated", role: "authenticated", email: `${id.slice(-4)}@example.invalid`, user_metadata: { full_name: name }, app_metadata: { provider: "discord" } });
const sessionFor = (id, name) => ({ access_token: jwt(id), refresh_token: "r-" + id, token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: userOf(id, name) });
const nameOf = (id) => (db.profiles.get(id) || {}).name;
const deny = (json) => json(403, { code: "42501", message: "admins only" });

function mockFor(who, whoName) {
  return async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const method = req.method();
    const hdr = req.headers();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: body === undefined ? "" : JSON.stringify(body) });
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname === "/auth/v1/settings") return json(200, { external: { discord: true, google: false, email: true } });
    if (u.pathname === "/auth/v1/authorize") {
      const back = u.searchParams.get("redirect_to");
      return route.fulfill({ status: 302, headers: { location: `${back}${back.includes("?") ? "&" : "?"}code=test-code` } });
    }
    if (u.pathname === "/auth/v1/token") return json(200, sessionFor(who, whoName));
    if (u.pathname === "/auth/v1/user") return json(200, userOf(who, whoName));
    if (u.pathname === "/auth/v1/logout") return json(204);
    let me = null;
    try { me = JSON.parse(Buffer.from((hdr.authorization || "").replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub || null; } catch { /* the publishable key */ }
    const single = /vnd\.pgrst\.object/.test(hdr.accept || "");
    const reply = (rows, status = 200) => (single ? (rows.length === 1 ? json(status, rows[0]) : json(406, { code: "PGRST116", message: "no rows" })) : json(status, rows));
    if (u.pathname === "/rest/v1/app_config") return json(200, [{ ...db.config }]);
    if (u.pathname === "/rest/v1/profiles") {
      const id = (u.searchParams.get("id") || "").replace(/^eq\./, "");
      if (method === "GET") return reply(id ? (db.profiles.has(id) ? [db.profiles.get(id)] : []) : [...db.profiles.values()]);
      if (method === "POST") {
        const r = JSON.parse(req.postData());
        const row = Array.isArray(r) ? r[0] : r;
        if (row.id !== me) return json(403, { code: "42501", message: "rls" });
        db.profiles.set(row.id, { id: row.id, name: row.name, created_at: new Date().toISOString() });
        db.users.set(row.id, { name: whoName, last: new Date().toISOString() });
        return reply([db.profiles.get(row.id)], 201);
      }
    }
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      const fn = rpc[1], a = JSON.parse(req.postData() || "{}");
      db.calls.push({ fn, a, me });
      const admin = !!me && db.admins.has(me);
      if (fn === "is_admin") return json(200, admin);
      if (!admin) return deny(json);
      const today = TODAY;
      if (fn === "admin_overview") {
        const days = Array.from({ length: 14 }, (_, k) => daysAgo(13 - k)).map((d) => ({ day: d, daily: db.scores.filter((s) => s.day === d).length, quiz: db.quiz.filter((s) => s.day === d).length, joined: 0 }));
        return json(200, {
          today, players: db.profiles.size, new_today: 1, new_week: 2,
          daily_today: db.scores.filter((s) => s.day === today).length, quiz_today: db.quiz.filter((s) => s.day === today).length, days,
          top_daily: db.scores.filter((s) => s.day === today).sort((x, y) => y.score - x.score).slice(0, 5).map((s) => ({ name: nameOf(s.user_id), score: s.score })),
          top_quiz: db.quiz.filter((s) => s.day === today).map((s) => ({ name: nameOf(s.user_id), score: s.score, tenths: s.tenths })),
        });
      }
      if (fn === "admin_players") {
        const q = String(a.p_q || "").toLowerCase();
        return json(200, [...db.profiles.values()].filter((p) => !q || p.name.toLowerCase().includes(q) || (db.users.get(p.id) || {}).name.toLowerCase().includes(q))
          .sort((x, y) => y.created_at.localeCompare(x.created_at))
          .map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, last_seen: (db.users.get(p.id) || {}).last, account: (db.users.get(p.id) || {}).name,
            daily: db.scores.filter((s) => s.user_id === p.id).length, quiz: db.quiz.filter((s) => s.user_id === p.id).length,
            best: Math.max(...db.scores.filter((s) => s.user_id === p.id).map((s) => s.score)) > -Infinity ? Math.max(...db.scores.filter((s) => s.user_id === p.id).map((s) => s.score)) : null, admin: db.admins.has(p.id) })));
      }
      if (fn === "admin_plays") {
        const at = new Date(Date.parse(a.p_from) + 3600000).toISOString();
        return json(200, [
          { at, bid: "guestaaaa1", uid: null, name: null, mode: "daily", rk: "daily:x", pid: "activation-function", tries: ["relu2", "ReLU"], ans: "ReLU", tier: 1, pts: 10, ms: 4200, admin: false },
          { at, bid: "guestaaaa1", uid: null, name: null, mode: "daily", rk: "daily:x", pid: "activation-function", tries: ["zzz"], ans: null, tier: 0, pts: 0, ms: 25000, admin: false },
          { at, bid: "guestbbbb2", uid: null, name: "Grace", mode: "unlimited", rk: "unlimited:1", pid: "activation-function", tries: ["GELU"], ans: "GELU", tier: 2, pts: 15, ms: 3000, admin: false },
          { at, bid: "ownerccc33", uid: "x", name: "Owner", mode: "daily", rk: "daily:x", pid: "activation-function", tries: ["Swish"], ans: "Swish", tier: 2, pts: 15, ms: 2000, admin: true },
        ]);
      }
      if (fn === "admin_scores") {
        const rows = a.p_kind === "quiz" ? db.quiz.filter((s) => s.day === a.p_day).map((s) => ({ user_id: s.user_id, name: nameOf(s.user_id), score: s.score, detail: s.marks, tenths: s.tenths, created_at: s.created_at }))
          : db.scores.filter((s) => s.day === a.p_day).sort((x, y) => y.score - x.score).map((s) => ({ user_id: s.user_id, name: nameOf(s.user_id), score: s.score, detail: s.tiers, tenths: null, created_at: s.created_at, hidden: !!(db.profiles.get(s.user_id) || {}).off_board }));
        return json(200, rows);
      }
      if (fn === "admin_remove_score") {
        const key = a.p_kind === "quiz" ? "quiz" : "scores", before = db[key].length;
        db[key] = db[key].filter((s) => !(s.user_id === a.p_user && s.day === a.p_day));
        return json(200, before - db[key].length);
      }
      if (fn === "admin_rename") {
        const n = String(a.p_name || "").trim();
        if (n.length < 1 || n.length > 16) return json(400, { code: "P0001", message: "a name is 1 to 16 characters" });
        db.profiles.get(a.p_user).name = n;
        return json(200, { id: a.p_user, name: n });
      }
      if (fn === "admin_delete_player") {
        if (db.admins.has(a.p_user)) return json(400, { code: "P0001", message: "admins can't be deleted here" });
        db.profiles.delete(a.p_user); db.users.delete(a.p_user);
        db.scores = db.scores.filter((s) => s.user_id !== a.p_user); db.quiz = db.quiz.filter((s) => s.user_id !== a.p_user);
        return json(200, 1);
      }
      if (fn === "admin_suggestions") {
        const groups = new Map();
        for (const r of db.sugg) {
          const k = `${r.prompt_id}|${r.answer_key}`, rv = db.reviews.get(k);
          const st = a.p_status || "open";
          if (st === "open" ? rv : st !== "all" && (!rv || rv.status !== st)) continue;
          if (!groups.has(k)) groups.set(k, { prompt_id: r.prompt_id, answer_key: r.answer_key, users: new Set(), taps: 0, autos: 0, first_seen: r.created_at, last_seen: r.created_at, raws: new Map(), ...(rv || { status: null, answer: null, reviewed_at: null }), pulled_at: null });
          const g = groups.get(k);
          g.users.add(r.user_id); g[r.source === "auto" ? "autos" : "taps"]++;
          if (r.created_at < g.first_seen) g.first_seen = r.created_at;
          if (r.created_at > g.last_seen) g.last_seen = r.created_at;
          g.raws.set(r.raw, (g.raws.get(r.raw) || 0) + 1);
        }
        return json(200, [...groups.values()].map(({ users, raws, ...g }) => ({ ...g, players: users.size, spellings: [...raws].sort((x, y) => y[1] - x[1]).map(([w]) => w).slice(0, 5) }))
          .sort((x, y) => y.players - x.players || y.last_seen.localeCompare(x.last_seen)));
      }
      if (fn === "admin_review_suggestion") {
        const k = `${a.p_prompt}|${a.p_key}`;
        if (a.p_status === "open") { db.reviews.delete(k); return json(200, { status: null }); }
        if (!["approved", "rejected"].includes(a.p_status)) return json(400, { code: "P0001", message: "status is approved, rejected or open" });
        const spelled = a.p_answer || (db.sugg.find((r) => `${r.prompt_id}|${r.answer_key}` === k) || {}).raw;
        db.reviews.set(k, { status: a.p_status, answer: spelled, reviewed_at: new Date().toISOString() });
        return json(200, { prompt_id: a.p_prompt, answer_key: a.p_key, status: a.p_status, answer: spelled });
      }
      if (fn === "admin_rate_limits") {
        return json(200, {
          limits: db.limits.map((l) => ({ ...l, hour: l.action === "suggestion" ? 12 : 1, day: l.action === "suggestion" ? 40 : 3 })),
          top: [{ ip_hash: "3f9a0c1b2d4e5f6a7b8c9d0e", action: "suggestion", day: 31, hour: 9, last_at: ts(0), at_limit: false },
            { ip_hash: "aa11bb22cc33dd44ee55ff66", action: "daily_score", day: 3, hour: 1, last_at: ts(0), at_limit: false }],
          unknown: 2, me: { source: "cf-connecting-ip", ip_hash: "0123456789abcdef01234567" },
        });
      }
      if (fn === "admin_set_rate_limit") {
        const l = db.limits.find((x) => x.action === a.p_action);
        if (!l) return json(400, { code: "P0001", message: `no such action: ${a.p_action}` });
        if (a.p_per_hour < 0 || a.p_per_day < 0) return json(400, { code: "P0001", message: "limits are 0 or more" });
        Object.assign(l, { per_hour: a.p_per_hour, per_day: a.p_per_day, updated_at: new Date().toISOString() });
        return json(200, l);
      }
      if (fn === "admin_set_launch") { db.config.launch = a.p_launch || null; return json(200, { ...db.config }); }
      if (fn === "admin_set_banner") { db.config.banner = String(a.p_text || "").trim().slice(0, 200) || null; return json(200, { ...db.config }); }
      if (fn === "admin_reset_all") {
        if (a.p_confirm !== "RESET") return json(400, { code: "P0001", message: "type RESET to confirm" });
        const out = { quiz: db.quiz.length, daily: db.scores.length, players: [...db.profiles.keys()].filter((id) => !db.admins.has(id)).length, reset_at: new Date().toISOString() };
        db.quiz = []; db.scores = [];
        for (const id of [...db.profiles.keys()]) if (!db.admins.has(id)) { db.profiles.delete(id); db.users.delete(id); }
        db.config.reset_at = out.reset_at;
        return json(200, out);
      }
    }
    return json(404, { message: "not mocked" });
  };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  async function phone(tag, who, name, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(([mock, extra]) => {
      window.MLION_BOARD = { url: mock, key: "sb_publishable_test" };
      if (extra) Object.assign(window, extra);
      try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ }
    }, [MOCK, init || null]);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route(`${MOCK}/**`, mockFor(who, name));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|status of 40[0346]/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    return page;
  }
  const rows = (pg) => pg.$$eval(".adm-rows li .who b", (els) => els.map((e) => e.textContent));
  const tab = async (pg, t) => { await pg.click(`.adm-tab[data-t="${t}"]`); await pg.waitForSelector(`.adm-tab.on[data-t="${t}"]`); };

  // ================= the admin
  const ada = await phone("ada", ADA, "Ada Lovelace");
  await ada.goto(base + "#admin");
  await ada.waitForSelector("#app [data-login]", { timeout: 15000 });
  check(/Log in with the Discord account that runs MLion/.test(await ada.textContent("#app")), "logged out, the panel asks for the admin's login");
  await ada.click('#app [data-login="discord"]');
  await ada.waitForSelector(".adm-tabs", { timeout: 20000 });
  check(/#admin$/.test(ada.url()), "after logging in you land back on the panel");
  check(!!(await ada.$("#drawer-acct .acct-admin")), "the menu shows an Admin panel link to admins");

  // overview
  await ada.waitForSelector(".adm-figs .figure");
  const figs = await ada.$$eval(".adm-figs .figure", (els) => els.map((e) => `${e.querySelector("span").textContent}=${e.querySelector("b").textContent}`));
  check(figs.includes("Players=3") && figs.includes("Dailies today=3") && figs.includes("Daily quizzes today=1"), `overview counts (${figs.join(", ")})`);
  check((await ada.$$(".adm-chart .col")).length === 14, "a 14-day chart");
  const topD = await ada.$$eval(".adm-top", (ls) => ls[0].textContent);
  check(/Rob\s*700/.test(topD) && topD.indexOf("Rob") < topD.indexOf("Cy"), "today's top scores, best first");
  { // the launch day in the code (null before launch, "2026-11-08" since)
    const CODE_LAUNCH = require("../js/engine.js").LAUNCH_DATE;
    check((CODE_LAUNCH ? /^Launched .*Today is MLion #\d+/ : /Not launched yet/).test(await ada.textContent(".adm-launch")), "the overview says whether the game has launched");
  }
  await ada.screenshot({ path: path.join(OUT, "70-admin-overview.png"), fullPage: true });

  // players: search, rename, delete
  await tab(ada, "players");
  await ada.waitForSelector(".adm-rows li");
  check((await rows(ada)).join() === "Cy,Rob,Ada", "players, newest first");
  check(await ada.$eval('.adm-rows li[data-name="Ada"]', (li) => !!li.querySelector(".adm-tag") && !li.querySelector('[data-a="delete"]')), "an admin is tagged and can't be deleted");
  check(/Robert Smith on Discord/.test(await ada.textContent('.adm-rows li[data-name="Rob"]')), "each player shows their Discord name");
  await ada.fill("#adm-q", "robert");
  await ada.press("#adm-q", "Enter");
  await ada.waitForFunction(() => document.querySelectorAll(".adm-rows li").length === 1);
  check((await rows(ada)).join() === "Rob", "search finds a player by their Discord name");
  await ada.click('.adm-rows li[data-name="Rob"] [data-a="rename"]');
  await ada.fill("#adm-rn-name", "Robin");
  await ada.press("#adm-rn-name", "Enter");
  await ada.waitForFunction(() => /Robin/.test(document.querySelector(".adm-rows")?.textContent || ""));
  check(db.profiles.get(ROB).name === "Robin", "rename saves the new name");
  await ada.fill("#adm-q", "");
  await ada.press("#adm-q", "Enter");
  await ada.waitForFunction(() => document.querySelectorAll(".adm-rows li").length === 3);
  await ada.screenshot({ path: path.join(OUT, "71-admin-players.png"), fullPage: true });
  await ada.click('.adm-rows li[data-name="Cy"] [data-a="delete"]');
  check(/Delete Cy\?/.test(await ada.textContent("#modal")), "deleting asks first");
  await ada.click("#adm-del");
  await ada.waitForFunction(() => document.querySelectorAll(".adm-rows li").length === 2);
  check(!db.profiles.has(CY) && !db.scores.some((s) => s.user_id === CY), "delete removes the player and their scores");

  // scores: remove one, read the quiz board
  db.profiles.get(ROB).off_board = true; // took themselves off the board (supabase/leave_board.sql): only admins see the score
  await tab(ada, "scores");
  await ada.waitForSelector(".adm-rows.scores li");
  check((await rows(ada)).join() === "Robin,Ada", "today's daily board, best first");
  check(!!(await ada.$('.adm-rows.scores li[data-name="Robin"] .adm-hidden')) && !(await ada.$('.adm-rows.scores li[data-name="Ada"] .adm-hidden')) && /1 hidden/.test(await ada.textContent("#adm-list")),
    "a player who took themselves off the board still shows to the admin, tagged Hidden");
  db.profiles.get(ROB).off_board = false;
  check((await ada.$$('.adm-rows.scores li[data-name="Robin"] .adm-tiers .glyph')).length === 7, "each score shows its seven tiers");
  await ada.click('.adm-rows.scores li[data-name="Robin"] [data-a="remove"]');
  await ada.click("#adm-rm");
  await ada.waitForFunction(() => document.querySelectorAll(".adm-rows.scores li").length === 1);
  check(!db.scores.some((s) => s.user_id === ROB && s.day === TODAY) && db.scores.some((s) => s.user_id === ROB), "removing a score takes only that day's");
  await ada.click('.adm-kind[data-k="quiz"]');
  await ada.waitForFunction(() => /81\.2 s/.test(document.querySelector("#adm-list")?.textContent || ""));
  check(/●●○●●●●/.test(await ada.textContent("#adm-list")), "the quiz board shows right and wrong answers and the time");
  await ada.fill("#adm-day", daysAgo(1));
  await ada.dispatchEvent("#adm-day", "change");
  await ada.waitForFunction(() => /No quiz scores/.test(document.querySelector("#adm-list")?.textContent || ""));
  await ada.click('.adm-kind[data-k="daily"]');
  await ada.waitForFunction(() => document.querySelectorAll(".adm-rows.scores li").length === 1);
  check(true, "any past day's board opens from the date picker");

  // answers: every round from the play log, grouped by player; the owner's own hidden unless asked for
  await tab(ada, "plays");
  await ada.waitForSelector(".adm-pl");
  const plays = await ada.textContent("#adm-plays");
  check(/2 players, 3 rounds/.test(plays) && (await ada.$$(".adm-pl")).length === 2 && !/Owner/.test(plays), "Answers lists each player's rounds, without the owner's");
  check(/No name/.test(plays) && /Grace/.test(plays) && /relu2/.test(await ada.innerHTML("#adm-plays")), "a player without a name shows as such, and wrong tries are listed");
  await ada.check("#adm-mine");
  await ada.waitForFunction(() => /3 players, 4 rounds/.test(document.querySelector("#adm-plays")?.textContent || ""));
  check(true, "Show mine adds the owner's rounds");

  // suggestions: most players first; approve with a chosen spelling, reject, undo
  await tab(ada, "suggest");
  await ada.waitForSelector(".adm-rows.sugg li");
  const sgRows = () => ada.$$eval(".adm-rows.sugg li", (els) => els.map((e) => `${e.dataset.p}|${e.dataset.k}`));
  check((await sgRows()).join() === "optimizer|zorblax,activation-function|squishu,loss-function|lossyloss", "suggestions to review, most players first");
  const zrow = '.adm-rows.sugg li[data-k="zorblax"]';
  const ztext = await ada.textContent(zrow);
  check(/Name an optimizer/.test(ztext) && /5 players \(4 tapped, 1 sent by setting\)/.test(ztext) && /first .* · last /.test(ztext), "each shows its prompt, how many players, how they sent it, first and last seen");
  check((await ada.$$eval(`${zrow} .sg-spell .chip`, (els) => els.map((e) => e.textContent))).join() === "Zorblax,ZorbLax", "and the spellings players typed, most common first");
  await ada.screenshot({ path: path.join(OUT, "75-admin-suggestions.png"), fullPage: true });
  await ada.click(`${zrow} .sg-spell .chip[data-v="ZorbLax"]`);
  await ada.click(`${zrow} [data-a="approved"]`);
  await ada.waitForFunction(() => !document.querySelector('.adm-rows.sugg li[data-k="zorblax"]'));
  const zr = db.reviews.get("optimizer|zorblax");
  check(zr && zr.status === "approved" && zr.answer === "ZorbLax", "Approve saves the verdict with the chosen spelling, and the row leaves the queue");
  await ada.click('.adm-rows.sugg li[data-k="squishu"] [data-a="rejected"]');
  await ada.waitForFunction(() => !document.querySelector('.adm-rows.sugg li[data-k="squishu"]'));
  check(db.reviews.get("activation-function|squishu").status === "rejected", "Reject saves the verdict");
  await ada.click('.adm-sgk[data-s="approved"]');
  await ada.waitForFunction(() => /ZorbLax/.test(document.querySelector("#adm-list")?.textContent || ""));
  check((await sgRows()).join() === "optimizer|zorblax", "the Approved list holds the approved one");
  await ada.click('.adm-sgk[data-s="rejected"]');
  await ada.waitForSelector('.adm-rows.sugg li[data-k="squishu"]');
  await ada.click('.adm-rows.sugg li[data-k="squishu"] [data-a="open"]');
  await ada.waitForFunction(() => /Nothing rejected/.test(document.querySelector("#adm-list")?.textContent || ""));
  check(!db.reviews.has("activation-function|squishu"), "Undo puts a rejected one back in the queue");
  await ada.click('.adm-sgk[data-s="open"]');
  await ada.waitForFunction(() => document.querySelectorAll(".adm-rows.sugg li").length === 2);

  // limits: each action's per-hour and per-day limit, editable; the busiest networks
  await tab(ada, "limits");
  await ada.waitForSelector(".adm-rows.lim li");
  check((await ada.$$eval(".adm-rows.lim li", (els) => els.map((e) => e.dataset.a))).join() === "daily_score,profile,quiz_score,rename,suggestion", "Limits lists every write action");
  const srow = '.adm-rows.lim li[data-a="suggestion"]';
  check(await ada.$eval(`${srow} input[name=h]`, (i) => i.value) === "400" && /12 in the last hour · 40 in the last 24 h/.test(await ada.textContent(srow)), "with its limits and its writes in the last hour and day");
  check(/3f9a0c1b2d/.test(await ada.textContent(".lim-top")) && /2 writes with no network/.test(await ada.textContent("#adm-body")) && /read from cf-connecting-ip/.test(await ada.textContent("#adm-body")), "the busiest networks by hash, unknown writes, and which header the database reads");
  await ada.screenshot({ path: path.join(OUT, "76-admin-limits.png"), fullPage: true });
  await ada.fill(`${srow} input[name=h]`, "25");
  await ada.fill(`${srow} input[name=d]`, "");
  await ada.click(`${srow} button[type=submit]`);
  await ada.waitForFunction(() => document.querySelector('.adm-rows.lim li[data-a="suggestion"] input[name=h]')?.value === "25" && /Limit saved/.test(document.body.textContent));
  const sl = db.limits.find((l) => l.action === "suggestion");
  check(sl.per_hour === 25 && sl.per_day === null, "an admin changes a limit (25 an hour, no daily cap) and it's saved");

  // game: launch day and banner
  await tab(ada, "game");
  await ada.waitForSelector("#adm-launch-save");
  await ada.click('[data-d="1"]');
  check(/After saving: Launches/.test(await ada.textContent("#adm-launch-preview")), "picking a day previews what it means");
  await ada.fill("#adm-launch", daysAgo(4));
  await ada.dispatchEvent("#adm-launch", "input");
  check(/Today is MLion #5/.test(await ada.textContent("#adm-launch-preview")), "a launch four days ago makes today MLion #5");
  await ada.click("#adm-launch-save");
  await ada.waitForFunction(() => /Today is MLion #5/.test(document.querySelector("#adm-launch-now")?.textContent || ""));
  check(db.config.launch === daysAgo(4), "the launch day is saved");
  await ada.fill("#adm-banner", "New quiz questions are in.");
  await ada.click("#adm-banner-save");
  await ada.waitForSelector("#adm-banner-clear");
  check(db.config.banner === "New quiz questions are in.", "the banner is saved");
  await ada.screenshot({ path: path.join(OUT, "72-admin-game.png"), fullPage: true });

  // ================= a player
  const pat = await phone("pat", PAT, "Pat Doe", { MLION_RESET_TEST: true });
  await pat.goto(base);
  await pat.waitForSelector(".home");
  await pat.waitForSelector("#announce", { timeout: 10000 });
  check((await pat.textContent("#announce")).includes("New quiz questions are in."), "players see the banner on home");
  await pat.waitForFunction(() => /^#5 /.test(document.querySelector("#topbar-mid").textContent), null, { timeout: 8000 });
  check(true, "and the day number follows the launch day (#5)");
  await pat.screenshot({ path: path.join(OUT, "73-home-banner.png") });
  await pat.click("#announce-x");
  await pat.reload();
  await pat.waitForSelector(".home");
  await pat.waitForTimeout(800);
  check(!(await pat.$("#announce")), "a closed banner stays closed");
  await pat.evaluate(() => localStorage.setItem("mlion:seen", JSON.stringify(["activation-function"])));
  await pat.goto(base + "#admin");
  await pat.waitForSelector("#app [data-login]", { timeout: 15000 });
  await pat.click('#app [data-login="discord"]');
  await pat.waitForFunction(() => /for MLion's admins/.test(document.querySelector("#app").textContent), null, { timeout: 20000 });
  check(!(await pat.$(".adm-tabs")) && !(await pat.$("#drawer-acct .acct-admin")), "a player who isn't an admin gets no panel and no link");
  check(!db.calls.some((c) => c.me === PAT && c.fn !== "is_admin"), "and the page never calls an admin function for them");
  const patTry = await pat.evaluate(async (mock) => {
    const tok = JSON.parse(localStorage.getItem("mlion:sb")).access_token;
    const r = await fetch(`${mock}/rest/v1/rpc/admin_set_rate_limit`, { method: "POST", headers: { apikey: "k", authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ p_action: "suggestion", p_per_hour: 100000, p_per_day: null }) });
    return r.status;
  }, MOCK);
  check(patTry === 403 && db.limits.find((l) => l.action === "suggestion").per_hour === 25, "a player who calls admin_set_rate_limit directly is refused (42501) and the limit stays");

  // ================= reset everyone
  await ada.evaluate(() => localStorage.setItem("mlion:seen", JSON.stringify(["activation-function"])));
  check(await ada.$eval("#adm-reset", (b) => b.disabled), "Reset stays locked until you type RESET");
  await ada.fill("#adm-reset-word", "RESET");
  await ada.click("#adm-reset");
  await ada.waitForSelector("#adm-done");
  check(/Removed 2 players, 2 daily scores and 1 quiz score/.test(await ada.textContent("#modal")), `the reset says what it removed (${(await ada.textContent("#modal .modal p")).trim()})`);
  check(db.profiles.size === 1 && db.profiles.has(ADA) && !db.scores.length && !db.quiz.length && !!db.config.reset_at, "every score and every non-admin account is gone");
  check(await ada.evaluate(() => localStorage.getItem("mlion:seen") === null && Object.keys(localStorage).some((k) => k.startsWith("mlion:sb"))), "the admin's own progress clears but the login stays");
  await ada.click("#adm-done");
  await ada.goto(base + "#home");
  await ada.reload(); // a real start, which reads the config again
  await ada.waitForSelector(".home");
  await ada.waitForTimeout(1200);
  check(await ada.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("mlion:sb"))), "the admin's device doesn't wipe itself again");

  await pat.goto(base + "#home");
  await pat.reload();
  await pat.waitForFunction(() => localStorage.getItem("mlion:seen") === null, null, { timeout: 15000 });
  await pat.waitForSelector(".home");
  check(await pat.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith("mlion:sb"))), "a player's device clears their progress and login after the reset");
  const since = await pat.evaluate(() => JSON.parse(localStorage.getItem("mlion:since")));
  check(Date.parse(since) >= Date.parse(db.config.reset_at), "and counts as starting after it, so it clears once");

  await ada.setViewportSize({ width: 1280, height: 900 });
  await ada.goto(base + "#admin");
  await ada.waitForSelector(".adm-figs .figure", { timeout: 15000 });
  await ada.screenshot({ path: path.join(OUT, "74-admin-desktop.png"), fullPage: true });
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  console.log("admin e2e passed");
  await browser.close(); server.close();
})().catch((e) => { console.error(e); if (errors.length) console.error("page errors: " + errors.join(" | ")); process.exit(1); });
