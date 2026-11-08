#!/usr/bin/env node
/* Live rooms survive a deploy (user, 2026-11-08: "when the website gets updated, people don't get kicked").
 * A deploy restarts the relay: every WebSocket drops at once and new ones fail for a few seconds. Here the test
 * proxy does the same (relay-dev.js cut()), in the lobby and in the middle of a match, and checks that everyone
 * keeps their seat, the same page stays host, nobody is told the host left, and the match carries on.
 *   node tests/live.restart.e2e.js            (starts a local relay with wrangler dev)
 *   node tests/live.restart.e2e.js --down 8   the relay stays down 8 s instead of 4 */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const { startRelay, attachRelay } = require("./relay-dev");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOWN = (+(process.argv[process.argv.indexOf("--down") + 1]) || 4) * 1000;
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
  if (url === "/js/data.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(fixtureBundle()); }
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const relay = await startRelay();
  const proxy = attachRelay(server, relay);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const code = "r" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  const secret = code.padEnd(22, "K");
  const toasts = new Map();
  async function player(name, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`pageerror (${name}):`, e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript(([c, s]) => {
      window.MLION_TEST = true; if (c) { window.MLION_LIVE_CODE = c; window.MLION_LIVE_SECRET = s; }
      try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ }
      window.__toasts = []; // every toast this page shows
      const watch = () => new MutationObserver(() => { const t = document.getElementById("toast"); if (t && t.textContent && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); })
        .observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      if (document.documentElement) watch(); else document.addEventListener("DOMContentLoaded", watch);
    }, [init || null, secret]);
    toasts.set(name, page);
    return page;
  }
  const ana = await player("Ana", code);
  await ana.goto(base + "#live"); await ana.fill("#live-name", "Ana"); await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 30000 });
  const guests = [];
  for (const name of ["Ben", "Cara"]) {
    const pg = await player(name);
    await pg.goto(base + `#live-${code}-${secret}`); await pg.fill("#live-name", name); await pg.click("#live-go");
    await pg.waitForSelector("#live-ready:not([disabled])", { timeout: 40000 });
    guests.push(pg);
  }
  const [ben, cara] = guests, all = [ana, ben, cara];
  await ana.waitForFunction(() => window.MLION_LIVE_STATE.players.size === 3, null, { timeout: 40000 });
  const anaId = await ana.evaluate(() => window.MLION_LIVE_STATE.myId);
  const state = () => Promise.all(all.map((pg) => pg.evaluate(() => { const L = window.MLION_LIVE_STATE; return { active: L.active, host: L.isHost, hostId: L.hostId, phase: L.phase, n: L.players.size, away: [...L.players.values()].filter((p) => p.away).length, round: window.MLION_LIVE_STATE.revealed }; })));
  const said = (pg) => pg.evaluate(() => window.__toasts.slice());
  console.log(`room ${code}: Ana hosts, Ben and Cara joined; the relay goes down for ${DOWN / 1000} s each time`);

  // 1. lobby
  let t0 = Date.now();
  proxy.cut(DOWN);
  console.log(`  relay cut in the lobby (${proxy.count()} connections left)`);
  await ana.waitForFunction(() => window.MLION_LIVE_STATE.client && window.MLION_LIVE_STATE.client.connected, null, { timeout: 60000 });
  await Promise.all(guests.map((pg) => pg.waitForFunction(() => window.MLION_LIVE_STATE.client && window.MLION_LIVE_STATE.client.connected, null, { timeout: 60000 })));
  console.log(`  everyone reconnected ${((Date.now() - t0) / 1000).toFixed(1)} s after the cut`);
  await sleep(4000);
  let s = await state();
  check(s.every((x) => x.active && x.phase === "lobby" && x.n === 3 && x.away === 0), `1. lobby: all three still in the room, nobody away (${JSON.stringify(s.map((x) => [x.n, x.away]))})`);
  check(s[0].host && !s[1].host && !s[2].host && s.every((x) => x.hostId === anaId), "1. Ana is still the host on every page (no takeover)");
  for (const pg of guests) await pg.waitForSelector("#live-ready:not([disabled])", { timeout: 15000 });
  check(true, "1. the guests' Ready buttons work again");

  // 2. mid-match
  for (const pg of all) { await pg.waitForSelector("#live-ready:not([disabled])", { timeout: 20000 }); await pg.click("#live-ready"); }
  await Promise.all(all.map((pg) => pg.waitForSelector("#answer:not([disabled])", { timeout: 40000 })));
  await ben.fill("#answer", "ReLU"); await ben.press("#answer", "Enter"); // one answer in before the cut
  await ana.waitForFunction(() => [...window.MLION_LIVE_STATE.players.values()].some((p) => p.name === "Ben" && p.ans[0]), null, { timeout: 15000 });
  t0 = Date.now();
  proxy.cut(DOWN);
  console.log("  relay cut in the middle of question 1");
  await cara.fill("#answer", "GELU"); await cara.press("#answer", "Enter"); // sent while the relay is down: held and sent on reconnect
  await Promise.all(all.map((pg) => pg.waitForFunction(() => window.MLION_LIVE_STATE.client && window.MLION_LIVE_STATE.client.connected, null, { timeout: 60000 })));
  console.log(`  everyone reconnected ${((Date.now() - t0) / 1000).toFixed(1)} s after the cut`);
  await ana.waitForFunction(() => [...window.MLION_LIVE_STATE.players.values()].some((p) => p.name === "Cara" && p.ans[0]), null, { timeout: 20000 });
  check(true, "2. an answer sent while the relay was down reaches the host once it's back");
  await sleep(3000);
  s = await state();
  check(s.every((x) => x.active && x.phase === "playing" && x.n === 3), `2. mid-match: all three still in the match (${JSON.stringify(s.map((x) => [x.phase, x.n, x.away]))})`);
  check(s[0].host && !s[1].host && !s[2].host && s.every((x) => x.hostId === anaId), "2. Ana is still the host on every page (no takeover)");
  await ana.fill("#answer", "Swish"); await ana.press("#answer", "Enter");
  await Promise.all(all.map((pg) => pg.waitForFunction(() => window.MLION_LIVE_STATE.revealed >= 0, null, { timeout: 30000 })));
  check(true, "2. the question is revealed on every page");
  await Promise.all(all.map((pg) => pg.waitForFunction(() => { const r = document.querySelector("#answer"); return window.MLION_LIVE_STATE.revealed >= 1 || window.MLION_LIVE_STATE.phase === "done" || (r && !r.disabled && window.MLION_LIVE_STATE.revealed === 0); }, null, { timeout: 60000 })));
  check(true, "2. the match moves on to question 2 for everyone");
  for (const [name, pg] of [["Ana", ana], ["Ben", ben], ["Cara", cara]]) {
    const t = await said(pg);
    console.log(`     ${name}'s toasts: ${JSON.stringify(t)}`);
    check(!t.some((x) => /host left|closed the room|removed|kicked|ended the match/i.test(x)), `2. ${name} was never told the host left, the room closed or they were removed`);
  }
  console.log("live restart e2e passed");
  await browser.close(); server.close();
  await relay.stop();
})().catch((e) => { console.error(e); process.exit(1); });
