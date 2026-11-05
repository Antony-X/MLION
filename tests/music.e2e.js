#!/usr/bin/env node
/* The background music in a real page (headless Chromium): nothing before a gesture, it starts with
 * the first tap, follows the descent, hears the clock and the effects, resolves on the results screen,
 * obeys Sound, Music and the volume in Settings, and stops while the tab is hidden.
 *   node tests/music.e2e.js
 * Uses the fixture bundle (nine copies of the activation-function prompt), so the answers are known.
 * Whether it sounds good is a question for ears: tools/music-render.js renders it to WAVs. */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
function fixtureBundle() {
  const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/packs.json"), "utf8"));
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "data/prompts/activation-function.json"), "utf8"));
  const prompts = [base];
  packs.forEach((pk, i) => { for (let j = 0; j < (i === 0 ? 2 : 1); j++) prompts.push({ ...JSON.parse(JSON.stringify(base)), id: `${pk.id}-clone-${j}`, pack: pk.id, text: `Name an activation function (${pk.name} copy ${j + 1})` }); });
  return "window.MLION_DATA = " + JSON.stringify({ version: "fixture", packs, prompts }) + ";";
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/js/data.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(fixtureBundle()); }
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); }
/** What the music engine is doing right now (null before it exists). */
const probe = (page) => page.evaluate(() => {
  const m = window.MLION_MUSIC && window.MLION_MUSIC.current, e = m && m.engine;
  if (!e) return null;
  const s = e.state;
  return { on: e.on, ctx: e.ctx.state, voices: e.voices(), view: s.view, depthT: s.depthT, chord: s.chord, lastClock: s.lastClock, tensT: s.tensT, streak: s.streak, queue: s.queue.map((q) => q[0]), vol: s.vol };
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("mlion:seenHow", "true"); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  await page.goto(base);
  await page.waitForSelector(".wordmark");
  await sleep(500);
  check((await probe(page)) === null, "no music engine (and no audio context from it) before a gesture");

  await page.click("text=Play today's daily");
  await sleep(1500);
  let p = await probe(page);
  check(p && p.on && p.ctx === "running", `the first tap starts it (context ${p && p.ctx})`);
  check(p.view === "play" && p.voices > 0 && p.chord, `it plays the descent's variant (${p.voices} oscillators, ${p.chord})`);
  check(p.depthT < 0.05, `the plateau to begin with (depth ${p.depthT.toFixed(3)})`);

  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 6000 });
  await sleep(300);
  p = await probe(page);
  check(p.lastClock >= 0 && p.tensT === 0, "the answer clock reports in, no tension with time to spare");
  await page.fill("#answer", "Snake"); // the gem: 100 points, a deep roll
  await page.press("#answer", "Enter");
  await page.waitForSelector(".feedback");
  await sleep(1800);
  p = await probe(page);
  check(p.depthT > 0.2, `the ball's landing moves the music down (depth ${p.depthT.toFixed(3)})`);
  check(p.streak >= 1 && (p.queue.includes("C") || p.chord === "C"),`the gem pulls the harmony to C (queue ${p.queue.join() || "-"}, chord ${p.chord})`);
  await sleep(600);
  p = await probe(page);
  check(p.lastClock === -1 && p.tensT === 0, "the clock stopped reporting, so no tension is left");

  // low time: the 25 s clock runs down into the music's thinning (its last few seconds)
  await page.click("#next");
  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
  const tense = await page.waitForFunction(() => { const e = window.MLION_MUSIC.current.engine; return e && e.state.tensT > 0.5 ? e.state.tensT : false; }, null, { timeout: 30000 });
  check((await tense.jsonValue()) > 0.5, "with the clock nearly out, the music thins (tension > 0.5)");
  await page.fill("#answer", "relu");
  await page.press("#answer", "Enter");
  await page.waitForSelector(".feedback");
  await sleep(1500);
  p = await probe(page);
  check(p.tensT === 0, "the answer releases it");

  // Settings: rows, volume, Music off/on, Sound off
  await page.goto(base + "#prefs");
  await page.waitForSelector("#music-vol");
  check(await page.isVisible('input[data-k="music"]'), "Settings has a Music switch");
  check((await page.inputValue("#music-vol")) === "50", "and a volume, at 50 by default");
  await page.click(".topbar", { position: { x: 200, y: 4 } }); // a neutral tap
  await sleep(1200);
  p = await probe(page);
  check(p && !p.on && p.view === "menu", `menus stay silent (view ${p && p.view})`);
  await page.evaluate(() => window.MLION_MUSIC.current.view("play")); // the rest as during a run
  await sleep(500);
  check((await probe(page)).on, "and it plays again in a run");
  await page.fill("#music-vol", "20");
  await page.dispatchEvent("#music-vol", "change");
  await sleep(200);
  p = await probe(page);
  check(Math.abs(p.vol - 0.2) < 1e-6, "the slider sets the volume");
  check((await page.evaluate(() => JSON.parse(localStorage.getItem("mlion:settings")).musicVol)) === 0.2, "and it is saved");
  await page.click('label:has(input[data-k="music"])');
  await sleep(300);
  p = await probe(page);
  check(!p.on, "Music off stops it");
  await page.click('label:has(input[data-k="music"])');
  await sleep(500);
  p = await probe(page);
  check(p.on, "Music on starts it again");
  await page.click('label:has(input[data-k="sound"])');
  await sleep(300);
  p = await probe(page);
  check(!p.on, "Sound off stops the music too");
  check(await page.evaluate(() => document.querySelector('input[data-k="music"]').closest(".setting").classList.contains("dim")), "and dims the Music rows");
  await page.click('label:has(input[data-k="sound"])');
  await sleep(500);
  check((await probe(page)).on, "Sound on brings it back");

  // a hidden tab: stopped and unplugged; visible again: back
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await sleep(2000);
  p = await probe(page);
  check(!p.on && p.voices === 0, "a hidden tab stops it and frees every voice");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await sleep(500);
  check((await probe(page)).on, "visible again, it plays again");

  // results: the cadence to C
  await page.goto(base + "#home");
  await page.waitForSelector(".wordmark");
  await page.evaluate(() => { // a finished Unlimited run, so there is a results page to open
    const rec = { key: "unlimited:1", mode: "unlimited", number: 1, label: "Unlimited #1", score: 85, secs: 25, tiers: ["longtail"], results: [{ promptId: "activation-function", raw: "x", tier: "longtail", score: 85 }] };
    localStorage.setItem("mlion:records", JSON.stringify({ "unlimited:1": rec }));
  });
  await page.reload();
  await page.waitForSelector(".wordmark");
  await page.click(".wordmark");
  await sleep(800);
  await page.evaluate(() => { location.hash = "results-unlimited-1"; });
  await page.waitForSelector(".score-big");
  await sleep(300);
  p = await probe(page);
  check(p.view === "results" && (p.queue[p.queue.length - 1] === "C" || p.chord === "C"), `the results screen queues a cadence to C (queue ${p.queue.join(" ") || "-"}, chord ${p.chord})`);
  await page.waitForFunction(() => window.MLION_MUSIC.current.engine.state.chord === "C", null, { timeout: 10000 });
  check(true, "and lands on it within a bar or two");

  // Sound off from the start: never an engine
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify({ sound: false })); });
  const page2 = await ctx2.newPage();
  await page2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page2.goto(base);
  await page2.waitForSelector(".wordmark");
  await page2.click("text=Play today's daily");
  await sleep(1200);
  check((await probe(page2)) === null, "with Sound off there is no music at all");

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  console.log("music e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
