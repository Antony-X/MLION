#!/usr/bin/env node
/* Live room: the host is told when a player loses connection (user, 2026-11-08).
 *   lobby  the quiet player's row says "Disconnected" (the Remove button is next to it), and clears when they're back
 *   match  a bar names who lost connection (Remove each) and who left, with End game (two taps): everyone goes to the podium
 * A player counts as lost after more than 5 s without a word (guests send a heartbeat every 3 s).
 *   node tests/live.drop.e2e.js          (starts a local relay with wrangler dev) */
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
const mute = (pg) => pg.evaluate(() => { const c = window.MLION_LIVE_STATE.client; c.__pub = c.publish; c.publish = function () { return c; }; });
const unmute = (pg) => pg.evaluate(() => { const c = window.MLION_LIVE_STATE.client; c.publish = c.__pub; });
const barText = (pg) => pg.evaluate(() => { const b = document.getElementById("lv-drop"); return b ? b.textContent.replace(/\s+/g, " ").trim() : ""; });

(async () => {
  await new Promise((r) => server.listen(0, r));
  const relay = await startRelay();
  attachRelay(server, relay);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const code = "d" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  const secret = code.padEnd(22, "K");
  async function player(init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript(([c, s]) => { window.MLION_TEST = true; if (c) { window.MLION_LIVE_CODE = c; window.MLION_LIVE_SECRET = s; } try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ } }, [init || null, secret]);
    return page;
  }
  const ana = await player(code);
  await ana.goto(base + "#live"); await ana.fill("#live-name", "Ana"); await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 30000 });
  const guests = {};
  for (const name of ["Ben", "Cara", "Dan"]) {
    const pg = await player();
    await pg.goto(base + `#live-${code}-${secret}`); await pg.fill("#live-name", name); await pg.click("#live-go");
    await pg.waitForSelector("#live-ready:not([disabled])", { timeout: 40000 });
    guests[name] = pg;
  }
  await ana.waitForFunction(() => window.MLION_LIVE_STATE.players.size === 4, null, { timeout: 40000 });
  const { Ben: ben, Cara: cara, Dan: dan } = guests;
  const idOf = {};
  for (const [n, pg] of Object.entries(guests)) idOf[n] = await pg.evaluate(() => window.MLION_LIVE_STATE.myId);
  console.log(`room ${code}: Ana hosts, Ben, Cara and Dan joined`);
  const row = (id) => ana.evaluate((x) => { const b = document.querySelector(`.lv-kick[data-id="${x}"]`); const li = b && b.closest("li"); return li ? { off: li.classList.contains("off"), st: li.querySelector(".lv-st").textContent } : null; }, id);

  // 1. Lobby: Dan goes quiet. His row says so, with Remove next to it; it clears when he's back.
  await sleep(4000);
  check(!(await row(idOf.Dan)).off, "1. a player who is still there is not shown as disconnected");
  let t = Date.now();
  await mute(dan);
  await ana.waitForFunction((x) => { const b = document.querySelector(`.lv-kick[data-id="${x}"]`); return b && b.closest("li").classList.contains("off"); }, idOf.Dan, { timeout: 15000 });
  const lobbyAfter = (Date.now() - t) / 1000;
  const r1 = await row(idOf.Dan);
  check(r1.st === "Disconnected" && lobbyAfter > 3 && lobbyAfter < 10, `1. the host's lobby shows Dan as Disconnected after ${lobbyAfter.toFixed(1)} s, with his Remove button`);
  check((await ana.textContent("#toast")).includes("Dan lost connection"), "1. and a toast tells the host");
  await unmute(dan);
  await ana.waitForFunction((x) => { const b = document.querySelector(`.lv-kick[data-id="${x}"]`); return b && !b.closest("li").classList.contains("off"); }, idOf.Dan, { timeout: 15000 });
  check(true, "1. Dan back: his row is normal again");

  // 2. A match with all four. Nobody is flagged while everyone is fine.
  for (const pg of [ana, ben, cara, dan]) { await pg.waitForSelector("#live-ready:not([disabled])", { timeout: 20000 }); await pg.click("#live-ready"); }
  await Promise.all([ana, ben, cara, dan].map((pg) => pg.waitForSelector("#answer", { timeout: 30000 })));
  await sleep(9000);
  check((await barText(ana)) === "", "2. nine seconds into the match with everyone connected: no bar");
  check((await ben.evaluate(() => !document.getElementById("lv-drop"))), "2. guests never get the bar");

  // 3. Dan loses connection mid-match: the bar names him; Remove takes him out and the bar goes.
  t = Date.now();
  await mute(dan);
  await ana.waitForSelector("#lv-drop .lv-drop-rm", { timeout: 15000 });
  const barAfter = (Date.now() - t) / 1000;
  const b3 = await barText(ana);
  check(/Dan lost connection/.test(b3) && /Remove/.test(b3) && /End game/.test(b3) && barAfter > 3 && barAfter < 10, `3. ${barAfter.toFixed(1)} s later the host's bar reads "${b3}"`);
  await ana.click(`#lv-drop .lv-drop-rm[data-id="${idOf.Dan}"]`);
  await ana.waitForFunction((x) => !window.MLION_LIVE_STATE.players.has(x), idOf.Dan, { timeout: 5000 });
  await sleep(300);
  check((await barText(ana)) === "", "3. Remove takes Dan out of the match, and the bar goes (the host chose it)");

  // 4. Ben taps Leave mid-match: the bar says he left, with End game and no Remove.
  await ben.evaluate(() => window.MLION_LIVE_SEND({ t: "leave" }));
  await ana.waitForFunction(() => { const b = document.getElementById("lv-drop"); return b && /left the match/.test(b.textContent); }, null, { timeout: 10000 });
  const b4 = await barText(ana);
  check(/Ben left the match/.test(b4) && !/Remove/.test(b4) && /End game/.test(b4), `4. after Ben leaves: "${b4}"`);

  // 5. Cara goes quiet too. End game: the first tap asks, the second ends the match for everyone.
  await mute(cara);
  await ana.waitForFunction(() => { const b = document.getElementById("lv-drop"); return b && /Cara lost connection/.test(b.textContent); }, null, { timeout: 15000 });
  const b5 = await barText(ana);
  check(/Cara lost connection/.test(b5) && /Ben left the match/.test(b5), `5. both on the bar: "${b5}"`);
  if (process.env.MLION_SHOT) await ana.screenshot({ path: process.env.MLION_SHOT + "-bar.png" });
  await ana.click("#lv-drop .lv-drop-end");
  await sleep(200);
  if (process.env.MLION_SHOT) await ana.screenshot({ path: process.env.MLION_SHOT + "-armed.png" });
  check((await barText(ana)).includes("End for everyone?") && (await ana.evaluate(() => window.MLION_LIVE_STATE.phase)) === "playing", "5. the first tap on End game only asks");
  await ana.click("#lv-drop .lv-drop-end");
  await ana.waitForFunction(() => window.MLION_LIVE_STATE.phase === "done", null, { timeout: 5000 });
  check(!(await ana.$("#lv-drop")), "5. the second tap ends the match on the host's page, and the bar goes");
  await cara.waitForFunction(() => window.MLION_LIVE_STATE.phase === "done", null, { timeout: 10000 });
  const caraToast = await cara.textContent("#toast");
  check(caraToast.includes("The host ended the match"), "5. a guest still listening goes to the podium and is told the host ended it");
  check(await cara.evaluate(() => document.body.dataset.view === "results" || !!document.querySelector(".lv-standings")), "5. Cara's page shows the podium");
  await unmute(cara);
  await sleep(5000);
  check((await barText(ana)) === "", "5. after the match the bar stays gone");

  console.log("live drop e2e passed");
  await browser.close(); server.close();
  await relay.stop();
})().catch((e) => { console.error(e); process.exit(1); });
