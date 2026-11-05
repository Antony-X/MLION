#!/usr/bin/env node
/* Pre-launch fixes, end to end (no network: every Supabase call goes to a stand-in):
 *   - launch day: a first visit gets the launch set even when the config arrives late; a config that changes
 *     today's daily mid-run switches to the real set; a daily finished from the old set is put aside
 *   - a broken #link falls back to home with a note
 *   - two tabs: the second can't overwrite what the first saved, and stops a daily the first finished
 *   - Supabase down or paused: the game plays, the board says it can't be reached, and nobody is logged out
 *   node tests/launch.e2e.js */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
global.window = {}; require(path.join(ROOT, "js/data.js"));
const D = window.MLION_DATA;
const POOL = new Set(D.daily.pool);
const LAUNCH_DAY1 = D.daily.launch[0].filter((id) => POOL.has(id)); // what launch day 1 deals (app.js LAUNCH_DAYS)
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

const pad = (n) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = localDay();

// A stand-in project that only knows app_config (the launch day): it answers after `cfg.delay` ms.
const CFG_URL = "https://mock.supabase.test";
const cfg = { launch: null, delay: 0, reads: 0 };
async function cfgRoute(route) {
  const u = new URL(route.request().url());
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(body) });
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (u.pathname === "/rest/v1/app_config") { cfg.reads++; await sleep(cfg.delay); return json(200, [{ launch: cfg.launch, banner: null, reset_at: null }]).catch(() => null); }
  if (u.pathname === "/auth/v1/settings") return json(200, { external: {} });
  return json(404, { message: "not mocked" });
}

(async () => {
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  // ---- no CDN at launch: the login library ships with the game (the MQTT library for live rooms is separate)
  const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
  const cdn = app.split("\n").filter((l) => /unpkg\.com|cdn\.jsdelivr\.net/.test(l) && !/MQTT_SRC\s*=/.test(l));
  check(cdn.length === 0, `no script but the MQTT library loads from unpkg or jsDelivr${cdn.length ? ": " + cdn.join(" | ") : ""}`);
  const sbSrc = (app.match(/const SB_SRC = "([^"]+)"/) || [])[1];
  const sha = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, sbSrc))).digest("hex");
  check(sha === "ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3", `${sbSrc} is @supabase/supabase-js 2.118.0 dist/umd/supabase.js, byte for byte (as on jsDelivr and unpkg)`);

  const browser = await chromium.launch();
  const errors = [];
  async function fresh(board, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\./, (r) => r.abort());
    await ctx.addInitScript(([b, extra]) => {
      if (b) window.MLION_BOARD = { url: b, key: "sb_publishable_test" };
      try { if (extra && !localStorage.getItem("mlion:sb")) localStorage.setItem("mlion:sb", extra); } catch { /* about:blank */ }
    }, [board, init || null]);
    return ctx;
  }
  const watch = (p) => { p.on("pageerror", (e) => { errors.push(e.message); console.log("  page error: " + e.message); }); return p; };
  const runIds = (p, key = `daily:${TODAY}`) => p.evaluate((k) => (JSON.parse(localStorage.getItem("mlion:run:" + k) || "null") || {}).promptIds || null, key);
  const toastText = (p) => p.evaluate(() => document.querySelector("#toast").textContent);

  // ---- launch day, first visit: the config arrives 0.8 s late; the daily still opens on launch day 1
  {
    cfg.launch = TODAY; cfg.delay = 800;
    const ctx = await fresh(CFG_URL); await ctx.route(`${CFG_URL}/**`, cfgRoute);
    const p = watch(await ctx.newPage());
    await p.goto(base + "#daily");
    await p.waitForSelector("#answer", { timeout: 10000 });
    check(JSON.stringify(await runIds(p)) === JSON.stringify(LAUNCH_DAY1), "first visit on launch day, config 0.8 s late: the daily is launch day 1, not the pre-launch set");
    check((await p.textContent("#topbar-mid")).includes("MLion #1"), "and it is MLion #1");
    await ctx.close();
  }

  // ---- the config comes after the 2 s wait: the pre-launch set opens, then switches to the real one mid-run
  {
    cfg.launch = TODAY; cfg.delay = 3500;
    const ctx = await fresh(CFG_URL); await ctx.route(`${CFG_URL}/**`, cfgRoute);
    const p = watch(await ctx.newPage());
    await p.goto(base + "#daily");
    await p.waitForSelector("#answer", { timeout: 10000 });
    const before = await runIds(p);
    check(before && JSON.stringify(before) !== JSON.stringify(LAUNCH_DAY1), "with the config 3.5 s late, the daily doesn't wait for ever (pre-launch set)");
    await p.waitForFunction((want) => JSON.stringify((JSON.parse(localStorage.getItem(`mlion:run:daily:${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`) || "null") || {}).promptIds) === want, JSON.stringify(LAUNCH_DAY1), { timeout: 10000 });
    check(/questions just changed/.test(await toastText(p)), "when the launch day arrives mid-run, the run switches to launch day 1 and says so");
    await p.waitForSelector("#answer");
    check(true, "and today's real daily is playable");
    await ctx.close();
  }

  // ---- a daily finished from the pre-launch set, then the launch day is set: it moves aside, the real one opens
  {
    cfg.launch = null; cfg.delay = 0;
    const ctx = await fresh(CFG_URL); await ctx.route(`${CFG_URL}/**`, cfgRoute);
    const p = watch(await ctx.newPage());
    await p.goto(base + "#daily");
    await p.waitForSelector("#answer", { timeout: 10000 });
    const ids = await runIds(p);
    await p.evaluate(({ day, ids }) => {
      const results = ids.map((id, i) => ({ promptId: id, promptText: "Q" + i, answer: "A", raw: "", tier: "baseline", score: 10 }));
      localStorage.setItem("mlion:records", JSON.stringify({ [`daily:${day}`]: { key: `daily:${day}`, mode: "daily", number: 1, date: day, label: "MLion #1", promptIds: ids, results, score: 70, tiers: ids.map(() => "baseline"), completedAt: Date.now(), secs: 25 } }));
      localStorage.removeItem(`mlion:run:daily:${day}`);
    }, { day: TODAY, ids });
    await p.goto("about:blank");
    cfg.launch = TODAY;
    await p.goto(base + `#results-daily-${TODAY}`);
    await p.waitForFunction((day) => { const r = JSON.parse(localStorage.getItem("mlion:records") || "{}"); return !r[`daily:${day}`] && !!r[`stale:daily:${day}`]; }, TODAY, { timeout: 10000 });
    check(true, "a pre-launch daily finished today is put aside once the launch day arrives");
    await p.waitForSelector("#answer", { timeout: 10000 });
    check(JSON.stringify(await runIds(p)) === JSON.stringify(LAUNCH_DAY1) && /questions just changed/.test(await toastText(p)), "its results page hands over to today's real daily");
    await ctx.close();
  }

  // ---- a broken link falls back to home
  {
    const ctx = await fresh(null);
    const p = watch(await ctx.newPage());
    await p.goto(base + "#%E0%A4%A");
    await p.waitForSelector(".home", { timeout: 10000 });
    check((await p.evaluate(() => location.hash)) === "#home" && /didn't work/.test(await toastText(p)), "a malformed #link shows home with a note, not a blank page");
    await p.goto(base + "#daily");
    await p.waitForSelector("#answer", { timeout: 10000 });
    check(true, "and the game carries on");
    await ctx.close();
  }

  // ---- two tabs
  {
    const ctx = await fresh(null);
    const a = watch(await ctx.newPage()), b = watch(await ctx.newPage());
    await a.goto(base + "#daily"); await a.waitForSelector("#answer", { timeout: 10000 });
    await b.goto(base + "#daily"); await b.waitForSelector("#answer", { timeout: 10000 });
    for (let i = 0; i < 7; i++) { // tab A skips through the whole daily
      await a.waitForSelector("#veil.hidden", { state: "attached", timeout: 10000 });
      await a.click("#step");
      await a.waitForSelector("#next:not([disabled])", { timeout: 10000 });
      await a.click("#next");
    }
    await a.waitForSelector(".score-big", { timeout: 10000 });
    await b.waitForFunction((day) => location.hash === `#results-daily-${day}`, TODAY, { timeout: 10000 });
    check(/another tab/.test(await toastText(b)), "tab B, mid-daily, stops when tab A finishes it and shows that result");
    await b.goto(base + "#unlimited-play"); // B finishes something else: it must not write over A's daily
    await b.waitForSelector("#veil.hidden", { state: "attached", timeout: 10000 });
    await b.click("#step");
    await b.waitForSelector("#stop-here", { timeout: 10000 });
    await b.click("#stop-here");
    await b.waitForSelector(".score-big", { timeout: 10000 });
    const keys = await a.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("mlion:records") || "{}")).sort());
    check(keys.includes(`daily:${TODAY}`) && keys.includes("unlimited:1"), `both tabs' runs are kept (${keys.join(", ")})`);
    await ctx.close();
  }

  // ---- Supabase down or paused (every call answers 404 "not found"; app_config never answers at all)
  {
    const DOWN = "https://mock.supabase.test";
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const user = { id: "00000000-0000-4000-8000-00000000d44d", aud: "authenticated", role: "authenticated", user_metadata: { full_name: "Ada" }, app_metadata: { provider: "discord" } };
    const sess = JSON.stringify({ access_token: `${b64({ alg: "HS256" })}.${b64({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user });
    const downRoute = (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      if (u.pathname === "/rest/v1/app_config") return; // hangs: the game must not wait on it
      return route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "not found" }) });
    };
    for (const loggedIn of [true, false]) {
      const ctx = await fresh(DOWN, loggedIn ? sess : null); await ctx.route(`${DOWN}/**`, downRoute);
      const p = watch(await ctx.newPage());
      p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
      await p.goto(base);
      await p.waitForSelector(".home", { timeout: 10000 });
      const t0 = Date.now();
      await p.goto(base + "#daily");
      await p.waitForSelector("#answer", { timeout: 10000 });
      check(Date.now() - t0 < 6000, `${loggedIn ? "logged in" : "logged out"}, project down: the daily opens (${Date.now() - t0} ms)`);
      const ids = await runIds(p);
      await p.evaluate(({ day, ids }) => {
        const results = ids.map((id, i) => ({ promptId: id, promptText: "Q" + i, answer: "A", raw: "", tier: "baseline", score: 10 }));
        localStorage.setItem("mlion:records", JSON.stringify({ [`daily:${day}`]: { key: `daily:${day}`, mode: "daily", number: 1, date: day, label: "MLion #1", promptIds: ids, results, score: 70, tiers: ids.map(() => "baseline"), completedAt: Date.now(), secs: 25 } }));
      }, { day: TODAY, ids });
      await p.goto("about:blank");
      await p.goto(base + `#results-daily-${TODAY}`);
      await p.waitForFunction(() => /can't be reached/.test(document.querySelector("#mini-board")?.textContent || ""), null, { timeout: 25000 });
      check(true, "the results' leaderboard says it can't be reached");
      if (loggedIn) {
        await p.waitForFunction(() => /Couldn't post your score/.test(document.querySelector("#board-box")?.textContent || ""), null, { timeout: 25000 });
        check(!!(await p.evaluate(() => localStorage.getItem("mlion:sb"))) && !/no longer exists/.test(await toastText(p)), "posting fails quietly, and a paused project's \"not found\" doesn't log you out");
      } else {
        await p.click("#pub-btn");
        await p.fill("#pub-name", "Turing");
        await p.click("#pub-go");
        await p.waitForFunction(() => /can't be reached/.test(document.querySelector("#pub-err")?.textContent || ""), null, { timeout: 25000 });
        check(true, "Publish my score says the leaderboard can't be reached");
        await p.evaluate(() => document.querySelector("#mclose").click());
      }
      await p.goto(base + "#board");
      await p.waitForFunction(() => /Couldn't load the leaderboard/.test(document.querySelector("#board-list")?.textContent || ""), null, { timeout: 25000 });
      check(true, "the leaderboard page says it couldn't load");
      await p.goto(base + "#quiz-1");
      await p.waitForSelector(".mcq-opt", { timeout: 10000 });
      check(true, "and the rest of the game plays");
      await ctx.close();
    }
  }

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  srv.close();
  console.log("launch e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
