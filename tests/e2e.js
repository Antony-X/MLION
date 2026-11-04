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

  const plan = ["Snake", "relu", "sparsemax", "Squareplus", "__timeout__", "__chips__"];
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
    if (ans === "__chips__") {
      // several near misses: tap the one you meant
      await page.fill("#answer", "gel");
      await page.press("#answer", "Enter");
      await page.waitForSelector(".chip");
      const chips = await page.$$eval(".chip", (els) => els.map((e) => e.textContent));
      check(chips.includes("GELU"), `ambiguous typo offers chips (${chips.join(" · ")})`);
      await page.screenshot({ path: path.join(OUT, "06b-chips.png") });
      await page.click(".chip:text-is('GELU')");
      await page.waitForSelector(".feedback.indist");
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
  // the Windows clipboard turns \n into \r\n; normalise so the check is platform-independent
  const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  check(/^MLion #\d+ 🦁\n300\/700 · loss 4\.00\n\n🦜🦁🐑🦄☄️⬛📊/.test(clip), "share text format");
  console.log(clip.split("\n").map((l) => "    | " + l).join("\n"));

  const snakeNote = JSON.parse(fs.readFileSync(path.join(ROOT, "data/prompts/activation-function.json"), "utf8")).answers.find((a) => a.a === "Snake").q;
  check((await page.textContent(".run-list")).includes(snakeNote), "your answers come with their explanations");
  // open an answer key and search it
  await page.click("details.key summary");
  await page.waitForSelector("details.key[open] .ans-list .ex", { timeout: 5000 });
  check((await page.$$("details.key[open] .ans-list .ex")).length > 3, "answer keys explain their answers");
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
  for (const r of ["unlimited", "archive", "faq", "prefs", "how"]) {
    await page.goto(base + "#" + r);
    await page.waitForSelector(".screen");
    await page.screenshot({ path: path.join(OUT, `10-${r}.png`), fullPage: true });
  }
  check(true, "all secondary screens render");
  for (const r of ["packs", "library", "pack-blocks", "pack-blocks-1", "practice-activation-function", "answers-activation-function"]) {
    await page.goto(base + "#" + r);
    await page.waitForFunction(() => location.hash === "#home", null, { timeout: 5000 });
  }
  check(!(await page.$('#drawer a[href="#packs"], #drawer a[href="#library"]')) && !(await page.$('.home a[href="#packs"], .home a[href="#library"]')), "packs and the library are gone: no picking questions");
  await page.goto(base + "#unlimited-9");
  await page.waitForFunction(() => location.hash === "#unlimited-1", null, { timeout: 5000 });
  check(true, "Unlimited can't jump ahead to a later run");

  // ---- quiz: the tile and the drawer link exist. This fixture is nine clones of one prompt, so every
  // wrong option would be accepted by the question's own matcher: a run must say so, not break.
  // (the full quiz flow runs in tests/quiz.e2e.js on the real data)
  await page.goto(base + "#home");
  await page.waitForSelector(".wordmark");
  check(!!(await page.$('.modes a[href="#quiz"]')) && !!(await page.$('#drawer a.nav[href="#quiz"]')), "home and the drawer link to Quiz");
  await page.goto(base + "#quiz-1");
  await page.waitForFunction(() => /can't make quiz questions/.test(document.body.textContent), null, { timeout: 5000 });
  check(true, "a bundle with no fair wrong answers says so instead of breaking");

  // ---- custom question count: any number up to 25
  await page.goto(base + "#challenge");
  await page.waitForSelector("#vs-go");
  await page.fill("#q-custom", "8"); // the fixture has 9 prompts; the real set has 128
  await page.press("#q-custom", "Enter");
  check(await page.$eval("#q-custom", (el) => el.classList.contains("on")) && !(await page.$(".q-size.on")), "a custom count replaces the presets");
  await page.fill("#q-custom", "40");
  await page.press("#q-custom", "Enter");
  check((await page.inputValue("#q-custom")) === "8", "counts over 25 are refused");
  await page.click('.t-size[data-s="40"]');
  await page.click("#vs-go");
  await page.waitForSelector("#begin");
  check(/#vs-[a-z0-9]+-8t40$/.test(await page.evaluate(() => location.hash)) && (await page.textContent(".beats li b")) === "8", "an 8-question challenge starts");
  check((await page.$$eval(".beats li b", (els) => els.map((e) => e.textContent))).includes("40 s"), "the challenge link carries its 40 s clock");

  // ---- challenge a friend: Ana plays 3, sends a link; Ben opens it on his own phone
  await page.goto(base + "#challenge");
  await page.waitForSelector("#vs-go");
  await page.fill("#vs-name", "Ana");
  await page.click('.vs-size[data-n="3"]');
  await page.click('.t-size[data-s="25"]');
  await page.click("#vs-go");
  await page.waitForSelector("#vs-send-now");
  await page.click("#vs-send-now");
  const early = (await page.evaluate(() => navigator.clipboard.readText())).split("\n").pop();
  check(/#vs-[a-z0-9]+-3$/.test(early), "link can be sent before playing");
  await page.click("#begin");
  for (const ans of ["snake", "relu", "gelu"]) {
    await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
    await page.fill("#answer", ans);
    await page.press("#answer", "Enter");
    await page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    await page.click("#next");
  }
  await page.waitForSelector("#send-vs");
  await page.click("#send-vs");
  const invite = (await page.evaluate(() => navigator.clipboard.readText())).split("\n").pop();
  check(/#vs-[a-z0-9]+-3-[0-6]{3}-[0-9a-f]+$/.test(invite), `challenge link built (${invite.split("#")[1]})`);
  const ctxB = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctxB.grantPermissions(["clipboard-read", "clipboard-write"]);
  const ben = await ctxB.newPage();
  ben.on("pageerror", (e) => errors.push("ben: " + e.message));
  await ben.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ben.goto(invite);
  await ben.waitForSelector("#begin");
  check((await ben.textContent("#card")).includes("Ana challenged you"), "friend sees who challenged them");
  await ben.fill("#vs-name", "Ben");
  await ben.click("#begin");
  for (let i = 0; i < 3; i++) {
    await ben.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
    await ben.fill("#answer", "relu");
    await ben.press("#answer", "Enter");
    await ben.waitForSelector(".fb-opp");
    await ben.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    if (i === 0) await ben.screenshot({ path: path.join(OUT, "12-vs-feedback.png") });
    await ben.click("#next");
  }
  await ben.waitForSelector(".duel-head");
  check((await ben.textContent(".duel-head")) === "Ana wins", "head-to-head names the winner (Ana 140 vs 30)");
  await ben.screenshot({ path: path.join(OUT, "13-vs-results.png"), fullPage: true });
  await ben.click("#send-vs");
  const reply = (await ben.evaluate(() => navigator.clipboard.readText())).split("\n").pop();
  await page.goto(reply);
  await page.waitForSelector(".duel-head");
  const board = await page.textContent(".duel-scores");
  check(board.includes("Ana (you)") && board.includes("Ben"), "challenger opens the reply and sees both names");
  await ctxB.close();

  // desktop layout shot of home
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(base);
  await page.waitForSelector(".wordmark");
  await page.screenshot({ path: path.join(OUT, "11-home-desktop.png") });

  // ---- time per question (Settings) and Skip on an empty box
  await page.goto(base + "#prefs");
  await page.click('.t-size[data-s="40"]');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem("mlion:settings")).answerSecs === 40), "the time setting is saved");
  await page.goto(base + "#unlimited-1");
  await page.waitForSelector("#begin");
  check((await page.$$eval(".beats li b", (els) => els.map((e) => e.textContent))).includes("40 s"), "a new run uses the chosen time");
  await page.click("#begin");
  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
  check(parseFloat(await page.textContent("#timer-num")) > 30, "the clock counts down from 40");
  check((await page.textContent("#step")).trim() === "Skip" && !(await page.$("#step.primary")), "an empty box offers Skip");
  await page.fill("#answer", "re");
  check((await page.textContent("#step")).trim() === "Step" && !!(await page.$("#step.primary")), "typing turns it back into Step");
  await page.fill("#answer", "");
  await page.click("#step");
  await page.waitForSelector(".feedback", { timeout: 5000 });
  check((await page.textContent(".feedback")).includes("Skipped."), "Skip moves on with no points");
  await page.screenshot({ path: path.join(OUT, "12-skipped.png") });
  await page.click("#next");
  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
  await page.fill("#answer", "rectified linear unit");
  await page.press("#answer", "Enter");
  await page.waitForSelector(".feedback", { timeout: 5000 });
  check((await page.textContent(".fb-note")).includes("counts as ReLU"), "an answer given by another name says what it counted as");

  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  console.log("e2e passed");
})().catch(async (e) => { console.error(e); process.exit(1); });
