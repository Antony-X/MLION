#!/usr/bin/env node
/* Live match end to end: two separate browsers connect through PeerJS and
 * play 5 questions on the same clock.  node tests/live.e2e.js
 * Needs network access to cdn.jsdelivr.net and 0.peerjs.com (the handshake);
 * the match itself runs browser to browser over WebRTC. */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

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
const check = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy, args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  const errors = [];
  const forced = "t" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  async function player(tag, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript((code) => {
      window.MLION_TEST = true;
      if (code) window.MLION_LIVE_CODE = code;
      try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ }
    }, init || null);
    return page;
  }
  const ana = await player("ana", forced), ben = await player("ben"), cy = await player("cy");

  // Ben opens the link before the room exists (the host switched apps): he must wait, not fail.
  await ben.goto(base + `#live-${forced}`);
  await ben.fill("#live-name", "Ben");
  await ben.click("#live-go");
  await ben.waitForFunction(() => /Waiting for the host|Connecting|reaching/.test(document.body.textContent), null, { timeout: 20000 });
  check(true, "friend waits for a host who isn't there yet");
  await ben.screenshot({ path: path.join(OUT, "19-live-waiting.png") });

  await ana.goto(base + "#live");
  await ana.fill("#live-name", "Ana");
  await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 20000 });
  const code = (await ana.textContent(".lv-code")).trim();
  check(code === forced, `room opened (${code})`);
  await ana.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 2, null, { timeout: 30000 });
  check(true, "the waiting friend gets in as soon as the room is back");

  // The host's phone drops its server connection; a third player must still get in.
  await ana.evaluate(() => window.MLION_LIVE_STATE.peer.disconnect());
  await cy.goto(base + `#live-${code}`);
  await cy.fill("#live-name", "Cy");
  await cy.click("#live-go");
  await ana.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 3, null, { timeout: 40000 });
  check(true, "room reconnects by itself after the host drops off");
  await ben.waitForSelector(".lv-players li:nth-child(2)");
  check((await ben.textContent(".lv-players")).includes("Ana"), "friend sees the host in the lobby");
  await ana.screenshot({ path: path.join(OUT, "20-live-lobby.png") });

  await ana.click('.vs-size[data-n="5"]');
  await ana.click("#live-start");
  const plan = { ana: ["snake", "snake", "snake", "snake", "snake"], ben: ["relu", "relu", "relu", "relu", "relu"], cy: ["gelu", "gelu", "gelu", "gelu", "gelu"] };
  for (let i = 0; i < 5; i++) {
    for (const [page, who] of [[ana, "ana"], [ben, "ben"], [cy, "cy"]]) {
      await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 15000 });
      await page.fill("#answer", plan[who][i]);
      await page.press("#answer", "Enter");
    }
    if (i === 0) {
      await ben.waitForSelector("#live-wait");
      await ben.screenshot({ path: path.join(OUT, "21-live-answered.png") });
    }
    await Promise.all([ana.waitForSelector(".lv-reveal", { timeout: 15000 }), ben.waitForSelector(".lv-reveal", { timeout: 15000 })]);
    if (i === 0) {
      const txt = await ben.textContent(".lv-answers");
      check(txt.includes("Ana") && txt.includes("Snake") && txt.includes("ReLU"), "both answers revealed to everyone");
      await ben.screenshot({ path: path.join(OUT, "22-live-reveal.png") });
    }
  }
  await Promise.all([ana.waitForSelector(".lv-podium", { timeout: 15000 }), ben.waitForSelector(".lv-podium", { timeout: 15000 })]);
  check((await ben.textContent("h1")).includes("Ana wins"), "podium names the winner on both phones");
  check((await ana.textContent(".lv-podium li.first em")).trim() === "500", "scores add up (Ana 500)");
  const order = await ana.$$eval(".lv-podium .nm b", (els) => els.map((e) => e.textContent));
  check(order.join(",") === "Ana,Cy,Ben", `podium order (${order.join(", ")})`);
  await ben.screenshot({ path: path.join(OUT, "23-live-podium.png") });

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  console.log("live e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
