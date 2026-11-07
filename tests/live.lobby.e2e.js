#!/usr/bin/env node
/* Live lobby: seats survive the ways people really drop out (the user, 2026-11-07: "lot of bugs with people getting
 * kicked in multiplayer, disconnected, ready button broken, when ready then you need to ready again then you can't
 * ready then you get kicked, and a duplicate of yours is there").
 *   1. Ready, unready and ready again each reach the host.
 *   2. A guest silent for longer than the grace (a phone in another app) loses the seat; when he is back, he is
 *      seated again by himself, once, with the same id, and still ready.
 *   3. A guest who reloads the page and rejoins gets his own seat back (no "Ben 2"), still ready.
 *   4. The same player opening the link on another device while his old seat is away replaces it: one Ben.
 *   5. The host reloads: the guest takes over, and the old host rejoins as one player, not two.
 *   6. The host removes a player (two taps): the seat goes, the page says so, and it doesn't come back by itself.
 *   node tests/live.lobby.e2e.js          (starts a local relay with wrangler dev) */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const { startRelay, attachRelay } = require("./relay-dev");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
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
  attachRelay(server, relay);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const code = "k" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  const link = `#live-${code}-${code.padEnd(22, "K")}`;
  const errors = [];
  async function player(asHost, ctx) {
    ctx = ctx || await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript(([c]) => { window.MLION_TEST = true; if (c) { window.MLION_LIVE_CODE = c; window.MLION_LIVE_SECRET = c.padEnd(22, "K"); } try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ } }, [asHost ? code : null]);
    return page;
  }
  const join = async (pg, name) => { await pg.goto(base + link); await pg.fill("#live-name", name); await pg.click("#live-go"); };
  // the host's view of the room: name, id, away, ready for each seat
  const seats = (pg) => pg.evaluate(() => [...window.MLION_LIVE_STATE.players.values()].map((p) => ({ name: p.name, id: p.id, away: !!p.away, ready: !!p.ready, host: !!p.host })));
  const hostPage = async (pages) => { for (const pg of pages) if (await pg.evaluate(() => !!(window.MLION_LIVE_STATE && window.MLION_LIVE_STATE.active && window.MLION_LIVE_STATE.isHost)).catch(() => false)) return pg; return null; };
  const quiet = (pg) => pg.evaluate(() => { const c = window.MLION_LIVE_STATE.client; c.__pub = c.publish; c.publish = function () { return c; }; });
  const loud = (pg) => pg.evaluate(() => { const c = window.MLION_LIVE_STATE.client; if (c.__pub) c.publish = c.__pub; });
  const waitSeat = (pg, fn, arg, ms = 20000) => pg.waitForFunction(fn, arg, { timeout: ms });

  const ana = await player(true), ben = await player(false);
  await ana.goto(base + "#live"); await ana.fill("#live-name", "Ana"); await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 30000 });
  await join(ben, "Ben");
  await waitSeat(ana, () => window.MLION_LIVE_STATE.players.size === 2, null, 40000);
  const benId = await ben.evaluate(() => window.MLION_LIVE_STATE.myId);

  // ---- 1. ready, unready, ready
  const benReady = (v) => waitSeat(ana, ([id, want]) => { const p = window.MLION_LIVE_STATE.players.get(id); return p && !!p.ready === want; }, [benId, v], 8000);
  await ben.waitForSelector("#live-ready:not([disabled])"); await ben.click("#live-ready"); await benReady(true);
  await ben.waitForFunction(() => /Not ready|Ready/.test(document.querySelector("#live-ready").textContent)); await ben.click("#live-ready"); await benReady(false);
  await ben.click("#live-ready"); await benReady(true);
  check(true, "1. Ready, unready and ready again each reach the host");

  // ---- 2. silent past the grace: the seat goes, and comes back by itself when he does
  await quiet(ben);
  await waitSeat(ana, (id) => { const p = window.MLION_LIVE_STATE.players.get(id); return p && p.away; }, benId, 20000);
  const away2 = Date.now();
  await waitSeat(ana, (id) => !window.MLION_LIVE_STATE.players.has(id), benId, 70000);
  check(Date.now() - away2 > 40000, `2. a quiet guest keeps the seat for the lobby grace (${((Date.now() - away2) / 1000).toFixed(0)} s), then loses it`);
  await loud(ben);
  const t2 = Date.now();
  await waitSeat(ana, (id) => { const p = window.MLION_LIVE_STATE.players.get(id); return p && !p.away; }, benId, 15000).catch(() => {});
  let s = await seats(ana);
  console.log(`     host sees ${JSON.stringify(s.map((p) => `${p.name}${p.away ? " away" : ""}${p.ready ? " ready" : ""}`))} ${((Date.now() - t2) / 1000).toFixed(1)} s after Ben is back`);
  check(s.filter((p) => p.name.startsWith("Ben")).length === 1 && s.some((p) => p.id === benId && !p.away), "2. when he is back he is seated again by himself, once, with the same id");
  await benReady(true).catch(() => {});
  check((await seats(ana)).find((p) => p.id === benId).ready, "2. and still ready, without tapping Ready again");
  await ben.waitForFunction(() => { const me = window.MLION_LIVE_STATE.players.get(window.MLION_LIVE_STATE.myId); return me && me.ready; }, null, { timeout: 8000 });
  check(true, "2. his own page agrees he is seated and ready");

  // ---- 3. a reload, then the link again
  await ben.reload();
  await ben.fill("#live-name", "Ben"); await ben.click("#live-go");
  await ben.waitForSelector("#live-ready:not([disabled])", { timeout: 30000 });
  await sleep(1500);
  s = await seats(ana);
  console.log(`     after Ben's reload the host sees ${JSON.stringify(s.map((p) => `${p.name}${p.away ? " away" : ""}${p.ready ? " ready" : ""}`))}`);
  check(s.filter((p) => p.name.startsWith("Ben")).length === 1 && s.some((p) => p.id === benId), "3. a reload rejoins the same seat: no second Ben");
  check(s.find((p) => p.id === benId).ready, "3. and keeps it ready");

  // ---- 4. the link on another device while the old seat is away
  await quiet(ben);
  await waitSeat(ana, (id) => { const p = window.MLION_LIVE_STATE.players.get(id); return p && p.away; }, benId, 20000);
  console.log("     before the other device the host sees " + JSON.stringify((await seats(ana)).map((p) => `${p.name}${p.away ? " away" : ""}${p.ready ? " ready" : ""}`)));
  const ben2 = await player(false);
  await join(ben2, "Ben");
  await ben2.waitForSelector("#live-ready:not([disabled])", { timeout: 30000 });
  await sleep(1500);
  s = await seats(ana);
  console.log(`     after Ben opens the link on another phone the host sees ${JSON.stringify(s.map((p) => `${p.name}${p.away ? " away" : ""}${p.ready ? " ready" : ""}`))}`);
  check(s.filter((p) => p.name.startsWith("Ben")).length === 1 && !s.some((p) => p.name === "Ben 2"), "4. the same name on another device replaces the away seat: one Ben");
  check(s.find((p) => p.name === "Ben").ready, "4. and the new seat keeps his Ready");
  await ben.close();

  // ---- 5. the host reloads: Ben takes over, Ana rejoins as one player
  const ben2Id = await ben2.evaluate(() => window.MLION_LIVE_STATE.myId);
  const anaId = await ana.evaluate(() => window.MLION_LIVE_STATE.myId);
  await ana.reload();
  await waitSeat(ben2, () => window.MLION_LIVE_STATE.isHost, null, 40000);
  check(true, "5. the host reloads: the guest takes over");
  await ana.fill("#live-name", "Ana"); await ana.click("#live-go");
  await ana.waitForSelector("#live-ready:not([disabled])", { timeout: 40000 });
  await sleep(1500);
  const host = await hostPage([ben2, ana]);
  s = await seats(host);
  console.log(`     after Ana's reload the host (${host === ben2 ? "Ben" : "Ana"}) sees ${JSON.stringify(s.map((p) => `${p.name}${p.away ? " away" : ""}${p.host ? " host" : ""}`))}`);
  check(s.filter((p) => p.name.startsWith("Ana")).length === 1 && s.some((p) => p.id === anaId), "5. the old host rejoins as one player, with her own id");
  check(s.some((p) => p.id === ben2Id), "5. and Ben is still there");

  // ---- 6. the host removes a player: gone, stays gone, and a reload doesn't get back in
  const out = host === ben2 ? ana : ben2, outId = await out.evaluate(() => window.MLION_LIVE_STATE.myId);
  await host.waitForSelector(`.lv-kick[data-id="${outId}"]`, { timeout: 8000 });
  await host.click(`.lv-kick[data-id="${outId}"]`);
  check((await host.textContent(`.lv-kick[data-id="${outId}"]`)).includes("Remove?") && (await seats(host)).some((p) => p.id === outId), "6. the first tap on Remove only asks");
  await host.click(`.lv-kick[data-id="${outId}"]`);
  await out.waitForFunction(() => /removed you/.test(document.body.textContent), null, { timeout: 10000 });
  check(!(await seats(host)).some((p) => p.id === outId), "6. the second tap removes the seat, and the removed page says so");
  await sleep(8000);
  check(!(await seats(host)).some((p) => p.id === outId) && await out.evaluate(() => !window.MLION_LIVE_STATE.active), "6. the removed player doesn't rejoin by himself");
  await out.click("a[href=\"#live\"]"); // the removed page offers Back
  await join(out, "Ana");
  await out.waitForFunction(() => /removed you/.test(document.body.textContent), null, { timeout: 20000 });
  check(!(await seats(host)).some((p) => p.id === outId), "6. opening the link again on the same device is refused");
  check(!(await host.$(`.lv-kick[data-id="${host === ben2 ? ben2Id : anaId}"]`)), "6. the host has no Remove button on his own seat");

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  await relay.stop();
  console.log("live lobby e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
