#!/usr/bin/env node
/* Live Quiz match, two browsers over the real MQTT relay: the host picks the Quiz format in the
 * lobby, both pages build the same four options from the room's seed, picks stay hidden until the
 * other player has answered, verdicts wait for the reveal, a skip vote draws a fresh question,
 * chat keeps working (and typing digits there never answers), the host rejects a bad pick and
 * clamps a forged time, and a tie on points goes to the faster total time.
 *   node tests/live.quiz.e2e.js   (needs unpkg.com and public.cloud.shiftr.io) */
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
      if (code) window.MLION_LIVE_CODE = code;
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
  await ben.goto(base + `#live-${forced}`);
  await ben.fill("#live-name", "Ben");
  await ben.click("#live-go");
  await ana.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 2, null, { timeout: 40000 });
  check((await ana.$$eval(".lv-fmt", (els) => els.map((e) => e.textContent.trim()).join(","))) === "Classic,Quiz,Sprint", "the host's lobby offers Classic, Quiz and Sprint");
  check(!!(await ana.$(".lv-assist")), "Classic keeps its autocorrect setting");
  await ben.waitForFunction(() => /Classic format/.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "a guest's settings note names the format (Classic by default)");
  await ana.click('.lv-fmt[data-f="quiz"]');
  await ana.fill("#q-custom", "4");
  await ana.press("#q-custom", "Enter");
  await ana.click('.t-size[data-s="10"]');
  await ben.waitForFunction(() => /picks the settings. 4 questions · 10 s each · Quiz format/.test(document.body.textContent), null, { timeout: 8000 });
  check(!(await ana.$(".lv-assist")), "Quiz hides the autocorrect setting");
  check(true, "the guest sees: 4 questions · 10 s each · Quiz format");
  await ana.screenshot({ path: path.join(OUT, "50-live-quiz-lobby.png") });
  for (const pg of [ana, ben]) { await pg.waitForSelector("#live-ready:not([disabled])"); await pg.click("#live-ready"); }

  // ---- question 1: same options everywhere; picks stay hidden; the verdict waits
  await Promise.all([unlocked(ana), unlocked(ben)]);
  const s0 = await state(ana), b0 = await state(ben);
  check(s0.fmt === "quiz" && s0.n === 4 && new Set(s0.ids).size === 4, "a four-question quiz match with four different prompts");
  assert.deepStrictEqual(s0.quiz, E.quizFor(CORE, s0.seed, 4, { promptIds: s0.ids }).map((q) => ({ promptId: q.promptId, options: q.options, correct: q.correct, from: q.from })));
  check(true, "the host's questions are exactly what the engine builds from the room's seed");
  assert.deepStrictEqual(b0.quiz, s0.quiz);
  check(JSON.stringify(await options(ana)) === JSON.stringify(await options(ben)) && JSON.stringify(await options(ana)) === JSON.stringify(s0.quiz[0].options), "both phones show the same four options in the same order");
  if (!(await ana.$$eval(".mcq-opt", (els) => els.every((e) => e.getBoundingClientRect().bottom <= window.innerHeight)))) { await ana.screenshot({ path: path.join(OUT, "fail-live-quiz-fit.png") }); console.log(JSON.stringify(s0.quiz[0]), await ana.evaluate(() => [...document.querySelectorAll(".mcq-opt")].map((e) => Math.round(e.getBoundingClientRect().bottom)))); }
  check(await ana.$$eval(".mcq-opt", (els) => els.every((e) => e.getBoundingClientRect().bottom <= window.innerHeight)), "live, with the strip and rivals above, all four options still fit a 390 x 844 screen");
  await ana.screenshot({ path: path.join(OUT, "51-live-quiz-round.png") });
  const Q0 = s0.quiz[0], right0 = Q0.options[Q0.correct], wrong0 = (Q0.correct + 1) % 4;

  await ana.keyboard.press(String(Q0.correct + 1)); // Ana answers first, with the key
  await ana.waitForSelector("#live-wait");
  check((await ana.textContent(".feedback")).includes("Locked in") && !/Correct|Not quite/.test(await ana.textContent(".feedback")), "after answering you see Locked in, not the verdict");
  check((await ana.textContent("#hud-score")).trim() === "0", "your score doesn't move until the reveal");
  await ben.waitForFunction(() => /Locked in/.test(document.querySelector("#live-rivals").textContent), null, { timeout: 8000 });
  check(!(await ben.textContent("#live-rivals")).includes(right0) && !!(await ben.$("#live-strip .lp:not(.me) .lp-tick")), "a rival who has answered shows as answered, not what they picked");
  check((await ben.$eval("#live-strip .lp:not(.me) em", (e) => e.textContent.trim())) === "0", "the strip's totals hold back the unrevealed round");
  await ben.screenshot({ path: path.join(OUT, "52-live-quiz-rival.png") });
  await ben.click(`.mcq-opt[data-i="${wrong0}"]`); // Ben answers wrong
  await ana.waitForFunction((t) => document.querySelector("#live-rivals").textContent.includes(t), Q0.options[wrong0], { timeout: 8000 });
  check(!/Not quite|Correct|\+100/.test(await ana.textContent("#live-rivals")), "once you've answered you see their pick, still without a verdict");
  await Promise.all([ana.waitForSelector(".mq-opts", { timeout: 15000 }), ben.waitForSelector(".mq-opts", { timeout: 15000 })]);
  check((await ben.textContent(".mq-opts li.right b")) === right0, "the reveal lights the right option");
  check((await ben.textContent(".mq-opts li.right .mcq-who")).includes("Ana") && (await ben.textContent(`.mq-opts li:nth-child(${wrong0 + 1}) .mcq-who`)).includes("Ben"), "the reveal shows who picked what");
  const froms = await ben.$$eval(".mq-opts li:not(.right) .mcq-from", (els) => els.map((e) => e.textContent));
  const wantFroms = Q0.from ? Q0.options.map((_, k) => k).filter((k) => k !== Q0.correct && Q0.from[k]).map((k) => `That's ${kindOf(Q0.from[k])}`) : []; // a bank question's options come from nowhere else
  check(JSON.stringify(froms) === JSON.stringify(wantFroms), "wrong options are labelled with the prompt they came from");
  check((await standings(ben)) === "Ana 100, Ben 0", "standings: Ana 100, Ben 0");
  await ana.waitForFunction(() => document.querySelector("#hud-score").textContent.trim() === "100", null, { timeout: 6000 });
  check(true, "Ana's ball and score move at the reveal");
  await ben.screenshot({ path: path.join(OUT, "53-live-quiz-reveal.png"), fullPage: true });

  // ---- question 2: Ben answers, then both vote it out; a fresh question replaces it and Ben's points from it are gone
  await Promise.all([unlocked(ana), unlocked(ben)]);
  const before = await ana.textContent("#prompt-text");
  const oldQ = (await state(ana)).quiz[1];
  await ben.click(`.mcq-opt[data-i="${oldQ.correct}"]`);
  await ana.click("#skip-vote");
  await ben.waitForFunction(() => /Ana wants to skip/.test(document.querySelector("#live-skip").textContent), null, { timeout: 8000 });
  await ben.click("#skip-vote");
  for (const pg of [ana, ben]) await pg.waitForFunction((b) => { const el = document.querySelector("#prompt-text"); return el && el.textContent !== b && document.querySelector(".mcq:not(.locked)"); }, before, { timeout: 30000 });
  const s1 = await state(ana), b1 = await state(ben);
  check(s1.quiz[1].promptId !== oldQ.promptId && JSON.stringify(s1.quiz[1]) === JSON.stringify(b1.quiz[1]), "a skip vote draws a fresh question, the same one on both pages");
  assert.deepStrictEqual(s1.quiz[1].options, E.quizQuestion(DATA, s1.seed, s1.quiz[1].promptId).options);
  check(JSON.stringify(await options(ben)) === JSON.stringify(s1.quiz[1].options) && new Set(s1.ids).size === 4, "the replacement's options come from the room seed, and no prompt repeats");
  const Q1 = s1.quiz[1];
  await ben.click(`.mcq-opt[data-i="${Q1.correct}"]`); // Ben is quick, Ana takes a moment
  await ana.waitForTimeout(1500);
  await ana.click(`.mcq-opt[data-i="${Q1.correct}"]`);
  await Promise.all([ana.waitForSelector(".mq-opts", { timeout: 15000 }), ben.waitForSelector(".mq-opts", { timeout: 15000 })]);
  check((await standings(ben)) === "Ana 200, Ben 100", "the skipped question's points are gone (Ana 200, Ben 100)");

  // ---- question 3: Ben right, Ana wrong: level on points
  await Promise.all([unlocked(ana), unlocked(ben)]);
  const Q2 = (await state(ana)).quiz[2];
  await ben.click(`.mcq-opt[data-i="${Q2.correct}"]`);
  await ana.waitForTimeout(1500);
  await ana.click(`.mcq-opt[data-i="${(Q2.correct + 1) % 4}"]`);
  await Promise.all([ana.waitForSelector(".mq-opts", { timeout: 15000 }), ben.waitForSelector(".mq-opts", { timeout: 15000 })]);
  check((await standings(ana)) === "Ana 200, Ben 200", "after three questions it's 200 each");

  // ---- question 4: chat while a question is open; the host refuses a bad pick and clamps a forged time
  await Promise.all([unlocked(ana), unlocked(ben)]);
  const Q3 = (await state(ana)).quiz[3];
  await ben.click("#chat-btn");
  await ben.keyboard.type("no idea lol 1234");
  await ben.keyboard.press("Enter");
  await ana.waitForSelector("#chat-peek:not([hidden])", { timeout: 10000 });
  check((await ana.textContent("#chat-peek")).includes("no idea lol 1234"), "chat works during a quiz question");
  check(!!(await ben.$(".mcq:not(.locked)")) && !(await ben.$(".feedback")), "digits typed into the chat never answer the question");
  await ben.keyboard.press("Escape");
  const benId = (await state(ben)).myId;
  const forge = (pick, ms) => ben.evaluate(({ code, pick, ms }) => {
    const L = window.MLION_LIVE_STATE;
    L.client.publish(`mlion/v2/r/${code}/up`, JSON.stringify({ from: L.myId, t: "ans", i: 3, pid: L.ids[3], pick, ms }));
  }, { code: forced, pick, ms });
  await forge(7, 5); // not one of the four options
  await ana.waitForTimeout(1500);
  check(await ana.evaluate((id) => !window.MLION_LIVE_STATE.players.get(id).ans[3], benId), "the host ignores a pick that isn't one of the four options");
  await forge((Q3.correct + 1) % 4, 99999999); // a wrong pick with an absurd time
  await ana.waitForFunction((id) => { const a = window.MLION_LIVE_STATE.players.get(id).ans[3]; return a && a.ms; }, benId, { timeout: 8000 });
  const clamp = (await state(ana)).ids[3].startsWith("rq-") ? 14000 : 10000; // a bank question runs 1.4x the clock
  check((await ana.evaluate((id) => window.MLION_LIVE_STATE.players.get(id).ans[3].ms, benId)) === clamp, `the host clamps a forged answer time to the clock (${clamp / 1000} s)`);
  await ana.waitForTimeout(1500);
  await ana.click(`.mcq-opt[data-i="${(Q3.correct + 1) % 4}"]`);
  await Promise.all([ana.waitForSelector(".lv-podium", { timeout: 25000 }), ben.waitForSelector(".lv-podium", { timeout: 25000 })]);

  // ---- podium: equal points, so the faster total time decides
  for (const pg of [ana, ben]) {
    check((await pg.textContent("h1")).includes("Ana wins"), "podium names Ana, the faster of two players on 200");
    check(/level on points, Ana was faster/.test(await pg.textContent(".page-head p")), "the podium says the win came on time");
  }
  const pts = await ana.$$eval(".lv-podium li em", (els) => els.map((e) => e.textContent.trim()));
  check(pts.join() === "200,200", `both finish on 200 (${pts.join(" / ")})`);
  check((await ana.$$(".lv-recap .rc")).length === 4 && (await ana.$$(".lv-recap .rc-right")).length === 4, "the recap lists the right answer of every question");
  await ana.screenshot({ path: path.join(OUT, "54-live-quiz-podium.png"), fullPage: true });
  const used = await ana.evaluate(() => JSON.parse(localStorage.getItem("mlion:liveUsed")));
  check(s1.ids.every((id) => used.includes(id)), "no-repeat questions: the match's prompts are remembered for next time");

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  console.log("live quiz e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
