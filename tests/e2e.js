#!/usr/bin/env node
/* End-to-end smoke test: plays a full daily descent in Chromium.
 *   node tests/e2e.js            uses the real js/data.js
 *   node tests/e2e.js --fixture  serves a small fixture bundle instead
 * Screenshots land in tests/out/. */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const useFixture = process.argv.includes("--fixture");

function fixtureBundle() {
  const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/packs.json"), "utf8"));
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "data/prompts/activation-function.json"), "utf8"));
  const prompts = [base];
  packs.forEach((pk, i) => {
    for (let j = 0; j < (i === 0 ? 2 : 1); j++) {
      prompts.push({ ...JSON.parse(JSON.stringify(base)), id: `${pk.id}-clone-${j}`, pack: pk.id, text: `Name an activation function (${pk.name} copy ${j + 1})` });
    }
  });
  return "window.MLION_DATA = " + JSON.stringify({ version: "fixture", packs, prompts }) + ";";
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (useFixture && url === "/js/data.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(fixtureBundle()); }
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text()); });

  if (!process.argv.includes("--fonts")) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base);
  await page.waitForSelector(".modal");
  await page.screenshot({ path: path.join(OUT, "01-howto.png") });
  await page.click("#how-go");
  await page.screenshot({ path: path.join(OUT, "02-home.png"), fullPage: true });
  check(await page.isVisible(".wordmark"), "home renders");

  await page.click("text=Start training");
  await page.waitForSelector("#begin");
  await page.click("#begin");
  await page.waitForSelector("#veil:not(.hidden)");
  await page.screenshot({ path: path.join(OUT, "03-preview.png") });
  check(await page.isDisabled("#answer"), "input locked during preview");
  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 6000 });

  // A wrong answer is rejected and leaves the round open.
  await page.fill("#answer", "definitely not an activation");
  await page.press("#answer", "Enter");
  await page.waitForSelector("#status.bad");
  check((await page.textContent("#status")).includes("no gradient"), "wrong answer rejected");
  // Autocorrect preview, then confirm.
  await page.fill("#answer", "swishh");
  await page.press("#answer", "Enter");
  await page.waitForSelector("#status.info");
  check((await page.inputValue("#answer")) === "Swish", "autocorrect proposes canonical answer");
  await page.screenshot({ path: path.join(OUT, "04-autocorrect.png") });
  await page.press("#answer", "Enter");
  await page.waitForSelector(".feedback.overfit");
  check(true, "confirmed correction lands Overfit");
  await page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
  await page.screenshot({ path: path.join(OUT, "05-feedback.png") });

  const plan = ["Snake", "relu", "sparsemax", "Squareplus", "__timeout__", "gelu"];
  for (const ans of plan) {
    await page.click("#next");
    await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
    if (ans === "__reload__") continue;
    if (ans === "__timeout__") {
      // reload mid-round: the clock must keep running (no free restarts)
      await page.fill("#answer", "zzz not real");
      await sleep(400);
      await page.reload();
      await page.waitForSelector("#answer");
      const t = parseFloat(await page.textContent("#timer-num"));
      check(t < 25, `timer survives reload (${t}s left)`);
      await page.waitForSelector(".feedback.miss", { timeout: 30000 });
      check(true, "timeout with unknown draft scores a miss");
      await page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
      continue;
    }
    await page.fill("#answer", ans);
    await page.press("#answer", "Enter");
    await page.waitForSelector(".feedback");
    if (ans === "Snake") {
      await sleep(900);
      await page.screenshot({ path: path.join(OUT, "06-gem-mid.png") });
    }
    await page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
  }
  await page.click("#next");
  await page.waitForSelector(".score-big", { timeout: 6000 });
  const score = parseInt(await page.textContent(".score-big"), 10);
  check(score === 15 + 100 + 10 + 60 + 85 + 0 + 30, `final score adds up (${score})`);
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, "07-results.png"), fullPage: true });
  await page.click("#share");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(/^MLion #\d+ 🦁\n300\/700 · loss 4\.00\n\n🦜🦁🐑🦄☄️⬛📊/.test(clip), "share text format");
  console.log(clip.split("\n").map((l) => "    | " + l).join("\n"));

  // open an answer key and search it
  await page.click("details.key summary");
  await page.fill("details.key[open] .search", "relu");
  const items = await page.$$eval("details.key[open] .ans-list li", (els) => els.length);
  check(items > 3, `answer key search works (${items} hits)`);
  await page.screenshot({ path: path.join(OUT, "08-answer-key.png") });

  // daily is locked after finishing; home shows results + countdown
  await page.goto(base + "#daily");
  await page.waitForSelector(".score-big");
  check(true, "replaying daily goes to results");
  await page.goto(base + "#stats");
  await page.waitForSelector(".stat-grid");
  check((await page.textContent(".stat-grid")).includes("1"), "stats count the run");
  await page.screenshot({ path: path.join(OUT, "09-stats.png"), fullPage: true });
  for (const r of ["packs", "unlimited", "archive", "library", "faq", "prefs", "how", "pack-blocks", "practice-activation-function"]) {
    await page.goto(base + "#" + r);
    await page.waitForSelector(".screen");
    await page.screenshot({ path: path.join(OUT, `10-${r}.png`), fullPage: true });
  }
  check(true, "all secondary screens render");

  // desktop layout shot of home
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(base);
  await page.waitForSelector(".wordmark");
  await page.screenshot({ path: path.join(OUT, "11-home-desktop.png") });

  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  console.log("e2e passed");
})().catch(async (e) => { console.error(e); process.exit(1); });
