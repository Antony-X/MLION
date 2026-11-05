#!/usr/bin/env node
/* Client-side attacks from the 2026-11-05 security audit: node tests/security.e2e.js
 * No network: Supabase is a stand-in (https://mock.supabase.test), fonts are blocked, the relay is a mocked WebSocket.
 *   A. the Content-Security-Policy is on, every inline script is allowed by its hash, and it stops what it should
 *      (an injected onerror handler, a script from another site, a socket to an unknown host)
 *   B. supabase-js and MQTT.js load from js/vendor, never from a CDN
 *   C. framed by another site: the game hides (and steps out of the frame when allowed)
 *   D. damaged saved data and hostile #links don't leave a blank page; Import refuses records that would
 *   E. the boot watchdog: a game that can't start offers Reload and Repair, and Repair keeps a copy
 *   F. the login-error toast doesn't repeat text from the URL */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = process.env.MLION_ROOT || path.join(__dirname, ".."); // MLION_ROOT: run against another copy of the site
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7); // --only=DF runs sections D and F
const want = (s) => !ONLY || ONLY.includes(s);
const MOCK = "https://mock.supabase.test";
const SOFT = process.argv.includes("--soft"); // report every failed check instead of stopping (for running against old code)
let failed = 0;
function check(c, m) { if (!c) { if (!SOFT) throw new Error("FAIL: " + m); failed++; console.log("  ✗ " + m); return; } console.log("  ✓ " + m); }
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

function mockSupabase(route) {
  const url = new URL(route.request().url());
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(body) });
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (url.pathname === "/auth/v1/settings") return json(200, { external: { discord: true, anonymous_users: true } });
  if (url.pathname.startsWith("/rest/v1/")) return json(200, []);
  return json(401, { message: "no session" });
}

(async () => {
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port, base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch();
  const errs = [], cdn = [], sockets = [];
  /** A fresh browser context: no service worker, no fonts, the stand-in Supabase, saved keys preset. */
  async function fresh(preset = {}, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: "block" });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route(/jsdelivr\.net|unpkg\.com|cdnjs\.|esm\.sh/, (r) => { cdn.push(r.request().url()); return r.abort(); });
    await ctx.route(/supabase\.co\//, (r) => r.abort()); // the real project is never contacted from tests
    await ctx.route(`${MOCK}/**`, mockSupabase);
    await ctx.routeWebSocket(/shiftr\.io/, (ws) => { sockets.push(ws.url()); }); // mocked: nothing reaches the public relay
    await ctx.addInitScript(([preset, board]) => {
      window.MLION_TEST = true;
      if (board) window.MLION_BOARD = { url: board, key: "sb_publishable_test" };
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      new MutationObserver(() => { if (document.querySelector(".pre-home .wordmark")) window.__preboot = true; }).observe(document, { childList: true, subtree: true });
      try {
        if (!sessionStorage.getItem("preset")) { // once per tab, so a reload keeps what the page changed
          sessionStorage.setItem("preset", "1");
          localStorage.setItem("mlion:settings", JSON.stringify({ sound: false, reducedMotion: true }));
          for (const [k, v] of Object.entries(preset)) localStorage.setItem(k, v);
        }
      } catch { /* a frame without storage (about:blank, an opaque origin) */ }
    }, [preset, opts.board ? MOCK : null]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    return { ctx, page };
  }
  const csp = (p) => p.evaluate(() => window.__csp.slice());
  const homeUp = (p) => p.waitForSelector(".home .depths-sec", { timeout: 20000 });

  // ------------------------------------------------------------------ A. CSP
  console.log("A. Content-Security-Policy");
  if (want("A")) {
    const meta = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    check(meta && /script-src 'self' 'sha256-/.test(meta[1]) && !/unsafe-inline[^;]*;[^;]*style/.test(meta[1].split("script-src")[1].split(";")[0]) && !/unsafe-eval/.test(meta[1]),
      "index.html carries a CSP: scripts from this site and hashed inline scripts only, no unsafe-inline or unsafe-eval for scripts");
    const { ctx, page } = await fresh();
    await page.goto(base);
    await homeUp(page);
    check(await page.evaluate(() => window.__preboot === true), "a first visit still draws the early home hero (its inline script is allowed by hash)");
    await page.goto(base + "#daily");
    await page.waitForSelector("#answer:not([disabled])", { timeout: 20000 });
    await page.fill("#answer", "relu"); await page.press("#answer", "Enter");
    await page.waitForTimeout(800);
    for (const h of ["#stats", "#prefs", "#quiz", "#sprint", "#live", "#challenge", "#how"]) { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250); }
    check((await csp(page)).length === 0, `playing the daily and opening every screen breaks no CSP rule${(await csp(page)).length ? ": " + (await csp(page)).join(" | ") : ""}`);
    // what the policy is for: markup that slipped past escaping can't run script
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<img src="data:," onerror="window.__pwned=1"><img src="x" onerror="window.__pwned=2">';
      document.body.appendChild(d);
      const s = document.createElement("script"); s.src = "https://cdn.example.com/evil.js"; document.head.appendChild(s);
      try { new WebSocket("wss://evil.example/x"); } catch { /* blocked either way */ }
    });
    await page.waitForTimeout(600);
    const v = await csp(page);
    check(!(await page.evaluate(() => window.__pwned)), "an injected onerror= handler does not run");
    check(v.some((x) => /^script-src/.test(x) && /inline/.test(x)) && v.some((x) => /cdn\.example\.com/.test(x)) && v.some((x) => /^connect-src/.test(x) && /evil\.example/.test(x)),
      "the browser reports each attempt: inline handler, foreign script, socket to an unknown host");
    await ctx.close();
  }

  // ------------------------------------------------------------------ B. vendored libraries
  console.log("B. vendored libraries");
  if (want("B")) {
    // the board's rows are a plain REST read; the login library loads for someone who has logged in (a stored session)
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const user = { id: "00000000-0000-4000-8000-00000000e55e", aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: { provider: "discord" } };
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const stored = JSON.stringify({ access_token: `${b64({ alg: "HS256" })}.${b64({ sub: user.id, role: "authenticated", exp })}.sig`, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: exp, user });
    const { ctx, page } = await fresh({ "mlion:sb": stored }, { board: true });
    sockets.length = 0;
    await page.goto(base + "#board");
    await page.waitForFunction(() => !!(window.supabase && window.supabase.createClient), null, { timeout: 15000 });
    await page.waitForSelector("#board-list li", { timeout: 15000 });
    const sb = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => /supabase/.test(s)));
    check(sb.length === 1 && /\/js\/vendor\/supabase-2\.118\.0\.js$/.test(sb[0]), `the login library loads from js/vendor (${sb[0] && sb[0].replace(base, "")})`);
    await page.evaluate(() => new Promise((res, rej) => { const s = document.createElement("script"); s.src = "js/vendor/mqtt-4.3.7.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));
    await page.evaluate(() => { window.__c = window.mqtt.connect("wss://public.cloud.shiftr.io", { username: "public", password: "public", reconnectPeriod: 0, connectTimeout: 2000 }); });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { try { window.__c.end(true); } catch { /* ignore */ } });
    check((await page.evaluate(() => typeof (window.mqtt && window.mqtt.connect))) === "function" && sockets.length >= 1, `MQTT.js runs under the CSP and may open the relay's socket (mocked here; ${sockets.length} opened)`);
    check((await csp(page)).length === 0, `the board and the relay socket break no CSP rule${(await csp(page)).length ? ": " + (await csp(page)).join(" | ") : ""}`);
    check(cdn.length === 0, `nothing was requested from a CDN${cdn.length ? ": " + cdn.join(", ") : ""}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ C. framing
  console.log("C. framed by another site");
  if (want("C")) {
    const { ctx, page } = await fresh();
    const outside = `http://localhost:${port}/frame.html`; // another origin than 127.0.0.1
    await ctx.route(outside, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><p>Win a prize!</p><iframe id="f" src="${base}#prefs" style="opacity:.01;width:420px;height:800px"></iframe>` }));
    await page.goto(outside);
    await page.waitForTimeout(2500);
    const top = page.url();
    if (top.startsWith(base)) check(true, "the game stepped out of the frame to the top window");
    else {
      const fr = page.frames().find((f) => f.url().startsWith(base));
      const hidden = fr ? await fr.evaluate(() => getComputedStyle(document.documentElement).display === "none" && !document.querySelector("#app .set-groups")) : true;
      check(hidden, "inside another site's frame the game hides itself and never draws Settings (no clickjacking)");
    }
    await ctx.close();
  }

  // ------------------------------------------------------------------ D. damaged saved data, hostile links, Import
  console.log("D. damaged saved data and hostile links");
  if (want("D")) {
    const poisons = [["mlion:seen", "5"], ["mlion:records", "null"], ["mlion:records", "[1,2]"], ["mlion:practice", "\"x\""], ["mlion:sprints", "null"],
      ["mlion:boardPosted", "5"], ["mlion:suggested", "7"], ["mlion:records", JSON.stringify({ "daily:2026-01-01": 5, "__proto__": { results: 1 } })]];
    for (const [k, v] of poisons) {
      const { ctx, page } = await fresh({ "mlion:reset": "launch-2026-11", [k]: v });
      const before = errs.length;
      try {
        await page.goto(base + "#home");
        await homeUp(page);
        for (const h of ["#stats", "#daily"]) { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(300); }
        const ok = await page.evaluate(() => !!document.querySelector("#app .play, #app #answer, #app .intro-card"));
        check(ok && errs.length === before, `${k} = ${v.slice(0, 40)}: the game still starts and plays`);
      } catch (e) { check(false, `${k} = ${v.slice(0, 40)}: the game still starts and plays (${e.message.split("\n")[0]})`); }
      await ctx.close();
    }
    const { ctx, page } = await fresh();
    for (const h of ["#%E0%A4%A", "#%", "#results-__proto__", "#results-constructor", "#vs-abcd-3-000-3c696d67207372633d78206f6e6572726f723d616c65727428312933"]) {
      const before = errs.length;
      try {
        await page.goto(base + h);
        await page.waitForFunction(() => !!document.querySelector("#app .home, #app .play, #app .intro-card, #app .screen:not(.pre-home)"), null, { timeout: 15000 });
        check(errs.length === before && !(await page.evaluate(() => !!document.querySelector("#app img[src=x]"))), `${h.slice(0, 40)} opens a page (no blank screen, no error, no markup)`);
      } catch (e) { check(false, `${h.slice(0, 40)} opens a page (${e.message.split("\n")[0]})`); }
    }
    // Import: crafted progress must not plant a record that breaks the game on every later visit
    await page.goto(base + "#prefs"); await page.waitForSelector("#imp");
    const bad = { v: 1, records: { "daily:2026-01-01": { key: "daily:2026-01-01", mode: "daily", results: [], tiers: 5, score: 999 }, "__proto__": { results: [] }, "../x": { results: [] } }, seen: "abc", sprints: { x: { best: "NaN" } } };
    await page.click("#imp"); await page.fill("#imp-t", JSON.stringify(bad)); await page.click("#imp-go");
    await page.waitForFunction(() => /Imported 0 runs/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 });
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    const good = { v: 1, records: { [`archive:2026-01-02`]: { key: "archive:2026-01-02", mode: "archive", number: 1, date: "2026-01-02", label: "x", promptIds: ["optimizer"], results: [{ promptId: "optimizer", raw: "adam", answer: "Adam", tier: "baseline", score: 10 }], score: 10, tiers: ["baseline"] } } };
    await page.click("#imp"); await page.fill("#imp-t", JSON.stringify(good)); await page.click("#imp-go");
    await page.waitForFunction(() => /Imported 1 run\b/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 });
    check(true, "Import refuses malformed records (0 imported) and still takes a well-formed one (1 imported)");
    const before = errs.length;
    await page.goto(base + "#home"); await page.reload(); await homeUp(page);
    await page.evaluate(() => { location.hash = "#stats"; }); await page.waitForTimeout(400);
    check(errs.length === before && today, "after the imports the game starts and Stats opens");
    await ctx.close();
  }

  // ------------------------------------------------------------------ E. the boot watchdog
  console.log("E. a game that can't start");
  if (want("E")) {
    const { ctx, page } = await fresh({ "mlion:records": JSON.stringify({ x: 1 }), "mlion:name": "Ana", "mlion:sb-test": "token", "mlion:liveRules": "{}" });
    let broken = true;
    await ctx.route(/\/js\/data\.js/, (r) => (broken ? r.fulfill({ contentType: "text/javascript", body: "window.MLION_DATA = null;" }) : r.continue()));
    const before = errs.length;
    await page.goto(base + "#daily");
    await page.waitForSelector(".boot-fail #bf-repair", { timeout: 10000 });
    check(errs.length > before && /couldn.t start/.test(await page.textContent("#app")), "when the game throws while starting, the page says so and offers Reload and Repair");
    broken = false;
    await page.click("#bf-repair");
    await homeUp(page);
    const st = await page.evaluate(() => ({ backup: JSON.parse(localStorage.getItem("mlion-backup") || "null"), name: localStorage.getItem("mlion:name"), sb: localStorage.getItem("mlion:sb-test"), records: localStorage.getItem("mlion:records") }));
    check(st.backup && st.backup.keys["mlion:records"] === JSON.stringify({ x: 1 }) && st.name === "Ana" && st.sb === "token" && st.records !== JSON.stringify({ x: 1 }),
      "Repair keeps a copy (mlion-backup), clears the saved game, keeps the name and the login, and the game starts again");
    await ctx.close();
  }

  // ------------------------------------------------------------------ F. login error text
  console.log("F. the login-error toast");
  if (want("F")) {
    const { ctx, page } = await fresh({}, { board: true });
    const before = errs.length;
    await page.goto(base + "?error=access_denied&error_description=Your%20account%20is%20locked.%20Verify%20at%20evil.example#home");
    await page.waitForFunction(() => /Login didn/.test(document.querySelector("#toast").textContent), null, { timeout: 15000 });
    const t = await page.textContent("#toast");
    check(!/evil\.example|locked/.test(t), `the toast doesn't repeat text from the link ("${t}")`);
    check(errs.length === before, "no page errors");
    await ctx.close();
  }

  const unexpected = errs.filter((e) => !/MLION_DATA|Cannot read properties of null/.test(e)); // E's deliberate failure
  check(!unexpected.length, `no unexpected page errors${unexpected.length ? ": " + unexpected.join(" | ") : ""}`);
  if (failed) process.exitCode = 1;
  console.log(failed ? `${failed} check(s) failed` : "security e2e passed");
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
