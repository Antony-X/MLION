#!/usr/bin/env node
/* Live match: a guest whose phone goes quiet long enough to be marked away, and
 * comes back inside the grace period, keeps their seat in the running match.
 * Regression test for a stale grace timer that freed the seat anyway.
 *   node tests/live.rejoin.e2e.js          (needs unpkg.com and public.cloud.shiftr.io)
 *   node tests/live.rejoin.e2e.js --quiz   the same in a Quiz match (real data: a quiz needs distinct prompts) */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const quiz = process.argv.includes("--quiz");
const check = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };
function fixtureBundle() {
  const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/packs.json"), "utf8"));
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "data/prompts/activation-function.json"), "utf8"));
  const prompts = packs.flatMap((pk) => [0, 1].map((j) => ({ ...JSON.parse(JSON.stringify(base)), id: `${pk.id}-c${j}`, pack: pk.id, text: `Name an activation function (${pk.name} ${j + 1})` })));
  return "window.MLION_DATA = " + JSON.stringify({ version: "fixture", packs, prompts, extras: [] }) + ";";
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/js/data.js" && !quiz) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(fixtureBundle()); }
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const code = "k" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  async function player(init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript((c) => { window.MLION_TEST = true; if (c) window.MLION_LIVE_CODE = c; try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ } }, init || null);
    return page;
  }
  const ana = await player(code), ben = await player();
  await ana.goto(base + "#live"); await ana.fill("#live-name", "Ana"); await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 30000 });
  await ben.goto(base + `#live-${code}`); await ben.fill("#live-name", "Ben"); await ben.click("#live-go");
  await ana.waitForFunction(() => window.MLION_LIVE_STATE.players.size === 2, null, { timeout: 40000 });
  await ben.waitForSelector("#live-ready:not([disabled])", { timeout: 20000 });
  if (quiz) await ana.click('.lv-fmt[data-f="quiz"]');
  for (const pg of [ana, ben]) { await pg.waitForSelector("#live-ready:not([disabled])"); await pg.click("#live-ready"); }
  const inputSel = quiz ? ".mcq:not(.locked)" : "#answer";
  await Promise.all([ana.waitForSelector(inputSel, { timeout: 30000 }), ben.waitForSelector(inputSel, { timeout: 30000 })]);
  const benId = await ben.evaluate(() => window.MLION_LIVE_STATE.myId);
  console.log(`room ${code}, match running, Ben = ${benId}`);

  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + "s";
  let last = "";
  const poll = setInterval(async () => {
    try {
      const s = await ana.evaluate((id) => { const p = window.MLION_LIVE_STATE.players.get(id); return p ? (p.late ? "LATE (sits out the match)" : p.away ? "away" : "in match") : "REMOVED"; }, benId);
      if (s !== last) { console.log(`${stamp()}  host sees Ben: ${s}`); last = s; }
    } catch { /* page busy */ }
  }, 250);

  // Ben's phone goes quiet: nothing he sends reaches the host.
  await ben.evaluate(() => { const c = window.MLION_LIVE_STATE.client; c.__pub = c.publish; c.publish = function () { return c; }; });
  console.log(`${stamp()}  Ben goes quiet`);
  await ana.waitForFunction((id) => { const p = window.MLION_LIVE_STATE.players.get(id); return p && p.away; }, benId, { timeout: 20000 });
  const awayAt = Date.now();
  await sleep(2000);
  await ben.evaluate(() => { const c = window.MLION_LIVE_STATE.client; c.publish = c.__pub; });
  console.log(`${stamp()}  Ben is back (${((Date.now() - awayAt) / 1000).toFixed(1)}s after being marked away, grace is 15s)`);
  await ana.waitForFunction((id) => { const p = window.MLION_LIVE_STATE.players.get(id); return p && !p.away; }, benId, { timeout: 10000 });
  await sleep(Math.max(0, awayAt + 15000 + 4000 - Date.now())); // past the grace timer
  clearInterval(poll);
  await sleep(300);
  const final = await ana.evaluate((id) => { const p = window.MLION_LIVE_STATE.players.get(id); return p ? { late: !!p.late, away: !!p.away } : null; }, benId);
  const benScreen = (await ben.textContent("#app")).replace(/\s+/g, " ").slice(0, 120);
  console.log(`${stamp()}  final host view: ${JSON.stringify(final)}`);
  console.log(`         Ben's screen: "${benScreen}"`);
  check(final && !final.late && !final.away, "a guest who comes back within the grace period keeps their seat");
  if (quiz) { // and can still play: the question is on his screen, and an answer reaches the host
    check(await ben.evaluate(() => window.MLION_LIVE_STATE.mfmt === "quiz"), "it was a quiz match");
    await ben.waitForSelector(".mcq:not(.locked) .mcq-opt:not([disabled])", { timeout: 60000 });
    const i = await ben.evaluate(() => window.MLION_LIVE_STATE.revealed + 1);
    await ben.click(".mcq-opt");
    await ana.waitForFunction(([id, k]) => { const p = window.MLION_LIVE_STATE.players.get(id); return p && p.ans[k]; }, [benId, i], { timeout: 30000 });
    check(true, "after coming back, the guest answers a quiz question and the host records it");
  }
  console.log("live rejoin e2e passed");
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
