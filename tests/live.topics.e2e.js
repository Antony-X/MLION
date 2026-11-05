#!/usr/bin/env node
/* Live room topics: the host keeps a quiz match to one pack; the guest rebuilds the same questions.
 *   node tests/live.topics.e2e.js   (needs public.cloud.shiftr.io) */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const E = require("../js/engine.js");
global.window = {};
require(path.join(ROOT, "js", "data.js"));
const DATA = global.window.MLION_DATA;
const PROMPT = new Map(DATA.prompts.map((p) => [p.id, p]));
const CORE = { version: `${DATA.version}:core`, packs: DATA.packs, prompts: DATA.prompts.filter((p) => !p.extra), reasoning: DATA.reasoning || [] }; // live rooms deal from the core set
const kindOf = (id) => PROMPT.get(id).text.replace(/^Name\s+/i, "");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const check = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy });
  const errors = [];
  const forced = "q" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  async function player(tag, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript((code) => {
      window.MLION_TEST = true;
      if (code) { window.MLION_LIVE_CODE = code; window.MLION_LIVE_SECRET = code.padEnd(22, "K"); } // a fixed link, so a guest can open it before the room exists
      try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ }
    }, init || null);
    return page;
  }
  const ana = await player("ana", forced), ben = await player("ben");
  const state = (pg) => pg.evaluate(() => {
    const L = window.MLION_LIVE_STATE;
    return { seed: L.seed, ids: L.ids.slice(), fmt: L.mfmt, n: L.n, myId: L.myId, quiz: L.quiz && L.quiz.map((q) => ({ promptId: q.promptId, options: q.options, correct: q.correct, from: q.from })) };
  });
  const unlocked = (pg) => pg.waitForSelector(".mcq:not(.locked) .mcq-opt:not([disabled])", { timeout: 30000 });
  const standings = (pg) => pg.$$eval(".lv-standings li", (els) => els.map((e) => `${e.querySelector("b").textContent} ${e.querySelector("em").textContent}`).sort().join(", "));
  const options = (pg) => pg.$$eval(".mcq-opt .mcq-t", (els) => els.map((e) => e.textContent));

  // ---- lobby: the host picks the format next to the count and the time
  await ana.goto(base + "#live");
  await ana.fill("#live-name", "Ana");
  await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 20000 });
  await ben.goto(base + `#live-${forced}-${forced.padEnd(22, "K")}`);
  await ben.fill("#live-name", "Ben");
  await ben.click("#live-go");
  await ana.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 2, null, { timeout: 40000 });
  // ---- topics: the host keeps the match to Math & Theory
  await ana.click('.lv-fmt[data-f="quiz"]');
  await ana.click('.lv-topic[data-p="theory"]');
  await ana.fill("#q-custom", "4");
  await ana.press("#q-custom", "Enter");
  await ben.waitForFunction(() => /picks the settings. 4 questions · 25 s each · Math & Theory · Quiz format/.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "the guest's note names the topic");
  check(await ana.$eval('.lv-topic[data-p=""]', (e) => !e.classList.contains("on")) && await ana.$eval('.lv-topic[data-p="theory"]', (e) => e.classList.contains("on")), "All topics turns off when a topic is picked");
  await ana.screenshot({ path: path.join(OUT, "55-live-topics.png"), fullPage: true });
  for (const pg of [ana, ben]) { await pg.waitForSelector("#live-ready:not([disabled])"); await pg.click("#live-ready"); }
  await Promise.all([unlocked(ana), unlocked(ben)]);
  const s0 = await state(ana), b0 = await state(ben);
  const BANK = new Map(E.quizBank(DATA).map((r) => [r.id, r]));
  check(s0.n === 4 && s0.ids.every((id) => BANK.has(id) && BANK.get(id).pack === "theory"), `every question is a Math & Theory bank question (${s0.ids.join(", ")})`);
  assert.deepStrictEqual(b0.quiz, s0.quiz);
  assert.deepStrictEqual(s0.quiz, E.quizFor(CORE, s0.seed, 4, { promptIds: s0.ids, reasoningIds: [] }).map((q) => ({ promptId: q.promptId, options: q.options, correct: q.correct, from: q.from })));
  check(true, "the guest builds exactly the host's questions");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  console.log("live topics e2e passed");
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
