#!/usr/bin/env node
/* A first visit shows the home hero before the questions arrive: node tests/preboot.e2e.js
 * data.js is held back on purpose, so the page has to stand on index.html alone for a moment.
 * Checks: the early hero appears without data, it says what the real hero says, the swap keeps the
 * same node in place (no jump, no replayed entrance), a click made early still lands, and returning
 * players (who have saved runs) get no early hero at all. */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
const HOLD_MS = 2500;

(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const errs = [];
  async function fresh(init = "") {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route(/\/js\/data\.js/, async (r) => { await new Promise((s) => setTimeout(s, HOLD_MS)); await r.continue(); });
    await ctx.addInitScript(`window.MLION_TEST = true; ${init}`);
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return { ctx, p };
  }
  const box = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }, sel);
  const text = (p, sel) => p.evaluate((s) => document.querySelector(s).textContent.replace(/\s+/g, ""), sel); // markup whitespace differs, words must not

  // 1. First visit: the hero is up long before the questions
  {
    const { ctx, p } = await fresh();
    const t0 = Date.now();
    await p.goto(base, { waitUntil: "commit" });
    await p.waitForSelector(".pre-home .wordmark", { timeout: HOLD_MS - 500 });
    check(Date.now() - t0 < HOLD_MS - 500 && !(await p.evaluate(() => !!window.MLION_DATA)), "first visit: the hero shows before the questions have loaded");
    await p.evaluate(() => { window.__hero = document.querySelector(".home-hero"); });
    const early = await text(p, ".pre-home .home-hero");
    await p.waitForTimeout(1200); // let the entrance finish, so positions are final
    const earlyBox = await box(p, ".wordmark"), earlyCta = await box(p, ".hero-cta");
    await p.waitForSelector(".home .depths-sec", { timeout: HOLD_MS + 10000 });
    const late = await text(p, ".home .home-hero");
    check(early === late, `the early hero says what the real one says ("${early}")`);
    check(await p.evaluate(() => document.querySelector(".home-hero") === window.__hero && !document.querySelector(".pre-home")), "the real home is built around the same hero node, so the entrance is not replayed");
    const [lateBox, lateCta] = [await box(p, ".wordmark"), await box(p, ".hero-cta")];
    check(JSON.stringify(earlyBox) === JSON.stringify(lateBox) && JSON.stringify(earlyCta) === JSON.stringify(lateCta), `nothing in the hero moves when the questions arrive (${earlyBox} / ${earlyCta})`);
    check(await p.evaluate(() => document.querySelectorAll("h1").length === 1 && document.querySelectorAll(".home-hero").length === 1 && !!document.querySelector(".depths-sec .depths li") && document.body.dataset.view === "home"), "one h1, one hero, the depth list below it");
    await ctx.close();
  }

  // 2. A click on the early hero still opens the daily once the app is up
  {
    const { ctx, p } = await fresh();
    await p.goto(base, { waitUntil: "commit" });
    await p.waitForSelector(".pre-home .hero-cta a.primary", { timeout: HOLD_MS - 500 });
    await p.waitForTimeout(700); // the button has risen into place
    await p.click(".pre-home .hero-cta a.primary");
    await p.waitForFunction(() => location.hash === "#daily" && document.querySelector(".play, .intro-card, .round"), null, { timeout: HOLD_MS + 10000 });
    check(true, "Start training clicked before the questions arrived still opens today's run");
    await ctx.close();
  }

  // 3. Returning players and deep links keep the spinner (their screen depends on saved runs or the route)
  {
    const { ctx, p } = await fresh(`try { localStorage.setItem("mlion:records", "{}"); } catch {}`);
    await p.goto(base, { waitUntil: "commit" });
    await p.waitForTimeout(800);
    check(!(await p.$(".pre-home")) && !!(await p.$(".boot")), "a returning player sees no early hero");
    await ctx.close();
  }
  {
    const { ctx, p } = await fresh();
    await p.goto(base + "#sprint", { waitUntil: "commit" });
    await p.waitForTimeout(800);
    check(!(await p.$(".pre-home")) && !!(await p.$(".boot")), "a deep link (#sprint) sees no early hero");
    await p.waitForSelector("#sp-form, .sprint", { timeout: HOLD_MS + 10000 }).catch(() => {});
    await ctx.close();
  }

  // 4. Reduced motion: the early hero has no entrance either
  {
    const { ctx, p } = await fresh(`try { localStorage.setItem("mlion:settings", JSON.stringify({ reducedMotion: true })); } catch {}`);
    await p.goto(base, { waitUntil: "commit" });
    await p.waitForSelector(".pre-home .home-hero", { timeout: HOLD_MS - 500 });
    check(await p.evaluate(() => !document.querySelector(".pre-home .home-hero").classList.contains("arrive")), "with Reduce motion on, the early hero does not animate in");
    await p.waitForSelector(".home .depths-sec", { timeout: HOLD_MS + 10000 });
    await ctx.close();
  }

  check(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
  console.log("preboot e2e passed");
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
