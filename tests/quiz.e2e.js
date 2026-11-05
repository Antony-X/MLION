#!/usr/bin/env node
/* Quiz mode end to end (solo and async challenge): four tap targets on a phone-sized screen,
 * keys 1-4, verdict with explanation and "where it belongs" labels, a timeout, resume after a
 * reload, results and share text, quiz runs kept out of the stats, launch-mode rule, and a
 * #vq- challenge between two browsers (head to head, send-back, tie broken on time).
 *   node tests/quiz.e2e.js        uses the real js/data.js
 * Screenshots land in tests/out/. */
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
// reasoning questions are looked up like prompts: the stem is the text, the right option carries the why
const PROMPT = new Map(DATA.prompts.map((p) => [p.id, p]).concat((DATA.reasoning || []).map((r) => [r.id, { id: r.id, text: r.q, reasoning: true, answers: [{ a: r.options[r.answer], q: r.why }] }])));
// the app deals solo quiz runs and challenges from the core set unless Extra questions is on
const CORE = { version: `${DATA.version}:core`, packs: DATA.packs, prompts: DATA.prompts.filter((p) => !p.extra), reasoning: DATA.reasoning || [] };
const kindOf = (id) => PROMPT.get(id).text.replace(/^Name\s+/i, "");
const explain = (id, name) => (PROMPT.get(id).answers.find((a) => a.a === name) || {}).q || null;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const check = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };
const hexName = (s) => Buffer.from(s).toString("hex");

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function phone(tag) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(`${tag}: ${m.text()}`); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    // a short clock keeps the timeout case quick; the how-to modal stays out of the way
    await page.addInitScript(() => { try { localStorage.setItem("mlion:seenHow", "true"); if (!localStorage.getItem("mlion:settings")) localStorage.setItem("mlion:settings", JSON.stringify({ answerSecs: 10 })); } catch { /* */ } });
    return { ctx, page };
  }
  const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  /** Wait for the options to unlock; return what the screen shows. */
  async function readQuestion(page) {
    await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 10000 });
    await page.waitForSelector(".mcq:not(.locked) .mcq-opt:not([disabled])", { timeout: 10000 });
    return { text: await page.textContent("#prompt-text"), opts: await page.$$eval(".mcq-opt .mcq-t", (els) => els.map((e) => e.textContent)) };
  }

  const { ctx, page } = await phone("ana");
  await page.goto(base);
  await page.waitForSelector(".wordmark");

  // ---- entry points
  check(!!(await page.$('.modes a[href="#quiz"]')), "home has a Quiz tile");
  check(!!(await page.$('#drawer a.nav[href="#quiz"]')), "the drawer has a Quiz link");
  await page.click('.modes a[href="#quiz"]');
  await page.waitForSelector('a.btn[href="#quiz-1"]');
  check((await page.textContent(".page-head")).includes("Seven hand-written questions a run"), "the hub explains the mode");
  await page.screenshot({ path: path.join(OUT, "40-quiz-hub.png") });

  // ---- a solo run: 7 questions, key / tap / wrong / timeout
  const run1 = E.quizRun(CORE, 1);
  assert.strictEqual(run1.length, 7);
  check(!!(await page.$('.dq-card a.btn.primary[href="#daily-quiz"]')), "the hub leads with today's quiz");
  await page.click('a.btn[href="#quiz-1"]');
  await page.waitForSelector("#begin");
  check((await page.textContent("#card")).includes("Quiz #1") && (await page.textContent(".beats li b")) === "7", "run 1 opens on an intro of seven questions");
  check((await page.textContent(".beats")).includes("10 s"), "the question time from Settings applies");
  await page.screenshot({ path: path.join(OUT, "41-quiz-intro.png") });
  await page.click("#begin");
  await page.waitForSelector("#veil:not(.hidden)");
  check(await page.$$eval(".mcq-opt", (els) => els.length === 4 && els.every((e) => e.disabled)), "the four options are locked while the question is being read");
  check(!!(await page.$("#mcq.locked")) && !!(await page.$("#veil:not(.hidden)")), "a veil covers them through the preview");
  // a stray global .locked rule once squeezed the options into a 40 px column during the preview
  check(await page.$eval("#mcq", (el) => Math.abs(el.getBoundingClientRect().width - el.parentElement.getBoundingClientRect().width) < 1), "the options keep their full width while locked");

  const plan = ["key-right", "tap-wrong", "tap-right", "timeout", "key-wrong", "tap-right", "key-right"];
  const expectHits = [];
  for (let i = 0; i < 7; i++) {
    const q = run1[i], how = plan[i];
    const shown = await readQuestion(page);
    check(shown.text === PROMPT.get(q.promptId).text && JSON.stringify(shown.opts) === JSON.stringify(q.options), `question ${i + 1}: the browser builds the same four options as the engine (${shown.text})`);
    if (i === 0) {
      const boxes = await page.$$eval(".mcq-opt", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      check(boxes.every(([w, h]) => w >= 300 && h >= 56), `each option is a big tap target at 390 px wide (${boxes.map((b) => b.join("x")).join(" ")})`);
      check(await noSideScroll(page), "no horizontal scroll while answering");
      check(await page.$$eval(".mcq-opt", (els) => els.every((e) => e.getBoundingClientRect().bottom <= window.innerHeight)), "all four options fit on the screen without scrolling");
      await page.screenshot({ path: path.join(OUT, "42-quiz-round.png") });
    }
    if (q.reasoning && !expectHits.some((_, k) => run1[k].reasoning)) { // the first reasoning question of the run
      const r = DATA.reasoning.find((x) => x.id === q.promptId);
      check((await page.textContent(".rq-eyebrow")) === `${r.cat} · ${r.lvl}`, "a bank question shows its topic and level above the question");
      await page.waitForFunction(() => parseFloat(document.querySelector("#timer-num").textContent) > 10.5, null, { timeout: 5000 });
      check(parseFloat(await page.textContent("#timer-num")) <= 14, "a bank question gets 1.4x the clock (14 s on a 10 s setting)");
      check(await page.$$eval(".mcq-opt", (els) => els.every((e) => e.getBoundingClientRect().bottom <= window.innerHeight)), "a reasoning question's options fit on the screen too");
      check(await noSideScroll(page), "no horizontal scroll on a reasoning question");
      await page.screenshot({ path: path.join(OUT, "42b-quiz-reasoning.png") });
    }
    const wrong = (q.correct + 1) % 4;
    let pick = -1;
    if (how === "key-right") { pick = q.correct; await page.keyboard.press(String(pick + 1)); }
    else if (how === "key-wrong") { pick = wrong; await page.keyboard.press(String(pick + 1)); }
    else if (how === "tap-right") { pick = q.correct; await page.click(`.mcq-opt[data-i="${pick}"]`); }
    else if (how === "tap-wrong") { pick = wrong; await page.click(`.mcq-opt[data-i="${pick}"]`); }
    else { await page.waitForSelector(".feedback", { timeout: 40000 }); } // time runs out (14 s on a 10 s setting)
    await page.waitForSelector(".feedback");
    const ok = pick === q.correct;
    expectHits.push(ok);
    const verdict = (await page.textContent(".fb-name")).trim();
    check(verdict === (ok ? "Correct" : how === "timeout" ? "Out of time" : "Not quite"), `question ${i + 1} (${how}): verdict "${verdict}"`);
    check((await page.textContent(".fb-points")).trim() === (ok ? "+100" : "+0"), `question ${i + 1}: ${ok ? "100" : "0"} points`);
    await page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    const right = q.options[q.correct];
    check((await page.textContent(".mcq-key li.right b")) === right, `question ${i + 1}: the right option is lit (${right})`);
    const x = explain(q.promptId, right);
    check(x ? (await page.textContent(".mcq-key li.right .mcq-x")) === x : !(await page.$(".mcq-key li.right .mcq-x")), `question ${i + 1}: ${x ? "the explanation shows" : "no explanation to show"}`);
    const froms = await page.$$eval(".mcq-key li:not(.right) .mcq-from", (els) => els.map((e) => e.textContent));
    const wantFroms = q.options.map((_, k) => k).filter((k) => k !== q.correct && q.from[k]).map((k) => `That's ${kindOf(q.from[k])}`);
    check(JSON.stringify(froms) === JSON.stringify(wantFroms), `question ${i + 1}: each wrong option says where it belongs (${froms[0]})`);
    if (pick >= 0 && !ok) check((await page.textContent(".mcq-key li.mine:not(.right) b")) === q.options[pick], `question ${i + 1}: your wrong pick is marked`);
    if (how === "timeout") check(!(await page.$(".mcq-key li.mine")), "a timeout marks no pick");
    if (i === 1) { check(await noSideScroll(page), "no horizontal scroll on the verdict"); await page.screenshot({ path: path.join(OUT, "43-quiz-wrong.png"), fullPage: true }); }
    if (i === 2) await page.screenshot({ path: path.join(OUT, "44-quiz-right.png"), fullPage: true });
    await page.click("#next");
  }
  await page.waitForSelector(".score-big", { timeout: 8000 });
  const hits = expectHits.filter(Boolean).length;
  check(parseInt(await page.textContent(".score-big"), 10) === hits * 100, `final score is 100 per right answer (${hits * 100})`);
  check((await page.textContent(".band")).trim() === `${hits} of 7 right`, "the result names how many were right");
  const list = await page.textContent(".run-list");
  check(run1.every((q) => list.includes(q.options[q.correct])), "the results list every question's right answer");
  check(list.includes("Out of time") && list.includes(`You picked ${run1[1].options[(run1[1].correct + 1) % 4]}`), "wrong picks and the timeout are spelled out");
  check(await noSideScroll(page), "no horizontal scroll on the results");
  await page.screenshot({ path: path.join(OUT, "45-quiz-results.png"), fullPage: true });
  await page.click("#share");
  const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  const grid = expectHits.map((h) => (h ? "🟩" : "⬛")).join("");
  check(clip.startsWith(`MLion Quiz #1 🦁\n${hits * 100}/700 · loss ${((700 - hits * 100) / 100).toFixed(2)} · 10 s\n\n${grid}`), "share text has the usual shape with a quiz grid");
  console.log(clip.split("\n").map((l) => "    | " + l).join("\n"));

  // ---- records: a quiz is its own mode; stats and the daily are untouched
  const recs = await page.evaluate(() => JSON.parse(localStorage.getItem("mlion:records")));
  check(Object.keys(recs).join() === "quiz:1" && recs["quiz:1"].mode === "quiz", "the run is saved under its own mode");
  await page.goto(base + "#stats");
  await page.waitForSelector("#app .page-head");
  check(!(await page.$(".stat-grid")) && (await page.textContent("#app")).includes("Play today's daily"), "quiz runs stay out of the daily stats (no daily played: stats still invite the first one)");
  await page.goto(base + "#quiz");
  await page.waitForSelector('.btn-row a.btn[href="#quiz-2"]');
  check((await page.textContent(".main .list")).includes(String(hits * 100)), "the hub lists the finished run");
  await page.goto(base + "#quiz-1");
  await page.waitForSelector(".score-big");
  check(true, "a finished run opens on its results");

  // ---- launch mode: sequential runs only
  await page.goto(base + "#quiz-9");
  await page.waitForFunction(() => location.hash === "#quiz-2", null, { timeout: 5000 });
  check(true, "Quiz can't jump ahead to a later run");

  // ---- resume after a reload: same options, the clock keeps running
  const run2 = E.quizRun(CORE, 2);
  await page.waitForSelector("#begin");
  await page.click("#begin");
  const before = await readQuestion(page);
  await page.waitForTimeout(2000); // let the clock run (a bank question gets 14 s on the 10 s setting)
  await page.reload();
  await page.waitForSelector("#mcq");
  const t = parseFloat(await page.textContent("#timer-num"));
  const after = await readQuestion(page);
  check(t < 13 && JSON.stringify(after.opts) === JSON.stringify(before.opts) && JSON.stringify(before.opts) === JSON.stringify(run2[0].options), `a reload keeps the question and its clock (${t}s left)`);
  await page.keyboard.press(String(run2[0].correct + 1));
  await page.waitForSelector(".feedback");
  await page.reload();
  await page.waitForSelector(".feedback");
  check((await page.textContent(".fb-name")).trim() === "Correct", "a reload after answering lands on the same verdict");
  // a small phone (360 x 640): nothing spills sideways on the verdict or the next question
  await page.setViewportSize({ width: 360, height: 640 });
  check(await noSideScroll(page), "no horizontal scroll on the verdict at 360 px wide");
  await page.click("#next");
  await readQuestion(page);
  check(await noSideScroll(page), "no horizontal scroll on a question at 360 px wide");
  const small = await page.$$eval(".mcq-opt", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.bottom)]; }));
  check(small.every(([w, h]) => w >= 280 && h >= 56), `the options stay big taps at 360 px (${small.map((b) => b[0] + "x" + b[1]).join(" ")}; bottoms ${small.map((b) => b[2]).join("/")} of 640)`);
  await page.screenshot({ path: path.join(OUT, "48-quiz-small-phone.png") });
  await page.setViewportSize({ width: 390, height: 844 });

  // ---- quiz challenge: Ana plays 3 and sends a link; Ben opens it on his own phone
  await page.goto(base + "#challenge");
  await page.waitForSelector("#vs-go");
  await page.click('.fmt-size[data-f="quiz"]');
  await page.click('.q-size[data-n="3"]');
  await page.click('.t-size[data-s="10"]');
  await page.click("#vs-go");
  await page.waitForSelector("#vs-send-now");
  const seed = (await page.evaluate(() => location.hash)).match(/^#vq-([a-z0-9]+)-3t10$/)[1];
  check(!!seed, "a quiz challenge gets a #vq- link with the count and clock");
  const vq = E.quizFor(CORE, `vq-${seed}`, 3);
  await page.fill("#vs-name", "Ana");
  await page.click("#vs-send-now");
  const early = (await page.evaluate(() => navigator.clipboard.readText())).split("\n").pop();
  check(new RegExp(`#vq-${seed}-3t10$`).test(early), "the link can be sent before playing");
  await page.click("#begin");
  const anaPicks = [vq[0].correct, vq[1].correct, (vq[2].correct + 1) % 4];
  for (let i = 0; i < 3; i++) {
    const shown = await readQuestion(page);
    check(JSON.stringify(shown.opts) === JSON.stringify(vq[i].options), `challenge question ${i + 1} matches the seed`);
    await page.click(`.mcq-opt[data-i="${anaPicks[i]}"]`);
    await page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    await page.click("#next");
  }
  await page.waitForSelector("#send-vs");
  check((await page.textContent(".score-big")).startsWith("200"), "Ana scored 200");
  await page.click("#send-vs");
  const invite = (await page.evaluate(() => navigator.clipboard.readText())).split("\n").pop();
  check(new RegExp(`#vq-${seed}-3t10-${anaPicks.map((p) => p + 1).join("")}-\\d+-${hexName("Ana")}$`).test(invite), `quiz result link built (${invite.split("#")[1]})`);

  const ben = await phone("ben");
  await ben.page.goto(invite);
  await ben.page.waitForSelector("#begin");
  check((await ben.page.textContent("#card")).includes("Ana challenged you") && (await ben.page.textContent("#card")).includes("Score to beat: 200"), "the friend sees who challenged them and the score to beat");
  await ben.page.fill("#vs-name", "Ben");
  await ben.page.click("#begin");
  const benPicks = [vq[0].correct, (vq[1].correct + 1) % 4, (vq[2].correct + 1) % 4];
  for (let i = 0; i < 3; i++) {
    await readQuestion(ben.page);
    await ben.page.click(`.mcq-opt[data-i="${benPicks[i]}"]`);
    await ben.page.waitForSelector(".fb-opp");
    const opp = await ben.page.textContent(".fb-opp");
    check(opp.includes("Ana picked " + vq[i].options[anaPicks[i]]), `after answering, Ben sees what Ana picked (${i + 1})`);
    if (i === 0) await ben.page.screenshot({ path: path.join(OUT, "46-quiz-vs-feedback.png"), fullPage: true });
    await ben.page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    await ben.page.click("#next");
  }
  await ben.page.waitForSelector(".duel-head");
  check((await ben.page.textContent(".duel-head")) === "Ana wins", "head-to-head names the winner (Ana 200 vs Ben 100)");
  check((await ben.page.textContent(".band")).includes("Ana wins · 100 vs 200"), "Ben's results say who won");
  await ben.page.screenshot({ path: path.join(OUT, "47-quiz-vs-results.png"), fullPage: true });
  await ben.page.click("#send-vs");
  const reply = (await ben.page.evaluate(() => navigator.clipboard.readText())).split("\n").pop();
  check(new RegExp(`#vq-${seed}-3t10-\\d{3}-\\d+-${hexName("Ana")}-\\d{3}-\\d+-${hexName("Ben")}$`).test(reply), "the reply link carries both results");
  await page.goto(reply);
  await page.waitForSelector(".duel-head");
  const board = await page.textContent(".duel-scores");
  check(board.includes("Ana (you)") && board.includes("Ben"), "the challenger opens the reply and sees both names");
  await ben.page.goto(reply);
  await ben.page.waitForSelector(".duel-head");
  check((await ben.page.textContent(".duel-scores")).includes("Ben (you)"), "Ben opening the full link sees himself marked");
  await ben.ctx.close();

  // ---- the daily quiz: the same seven for everyone, one go a day, on the fixed 25 s clock
  {
    const dq = await phone("dq");
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // before launch: Daily Quiz #1 every day, dealt from the daily's hand-picked pool
    const pool = new Set(DATA.daily.pool);
    const DAILY = { ...CORE, version: `${CORE.version}:daily`, prompts: CORE.prompts.filter((p) => pool.has(p.id)) };
    const want = E.dailyQuiz(DAILY, Math.max(1, E.daysBetween("2026-11-05", day) + 1), "dquiz-pre2");
    const bank = new Set(E.quizBank(DATA).map((r) => r.id));
    check(want.length === 7 && want.every((q) => q.reasoning && bank.has(q.promptId)), "the engine deals today's quiz: seven hand-written bank questions");
    await dq.page.goto(base + "#quiz");
    await dq.page.click('.dq-card a[href="#daily-quiz"]');
    await dq.page.waitForSelector("#begin");
    check((await dq.page.textContent("#card")).includes("Daily Quiz #1") && (await dq.page.textContent(".beats")).includes("25 s"), "the daily quiz opens on its own intro, on the 25 s clock whatever Settings says");
    await dq.page.click("#begin");
    for (let i = 0; i < 7; i++) {
      const shown = await readQuestion(dq.page);
      check(JSON.stringify(shown.opts) === JSON.stringify(want[i].options), `daily quiz question ${i + 1}: the browser deals the engine's question`);
      await dq.page.keyboard.press(String((i % 2 ? (want[i].correct + 1) % 4 : want[i].correct) + 1));
      await dq.page.waitForSelector("#next:not([disabled])", { timeout: 6000 });
      await dq.page.click("#next");
    }
    await dq.page.waitForSelector(".grid-tiers");
    check(dq.page.url().endsWith(`#results-dquiz-${day}`) && (await dq.page.textContent("#app")).includes("Next quiz in"), "the results count down to the next daily quiz");
    check((await dq.page.textContent(".loss-line")).includes("4 of 7 right"), "four of seven right");
    await dq.page.goto(base + "#daily-quiz");
    await dq.page.waitForFunction((t) => location.hash === `#results-dquiz-${t}`, day, { timeout: 5000 });
    check(true, "one go a day: opening it again shows your result");
    await dq.page.goto(base + "#quiz");
    check((await dq.page.textContent(".dq-card")).includes("Your score · 400"), "the hub shows today's score instead of the play button");
    await dq.ctx.close();
  }

  // ---- level on points: the faster total time wins (a link made by hand, opened by a stranger)
  const eve = await phone("eve");
  const allRight = vq.map((q) => q.correct + 1).join("");
  const tie = `${base}#vq-${seed}-3t10-${allRight}-300-${hexName("Slow")}-${allRight}-250-${hexName("Quick")}`;
  await eve.page.goto(tie);
  await eve.page.waitForSelector(".duel-head");
  check((await eve.page.textContent(".duel-head")) === "Quick wins" && (await eve.page.textContent(".duel-tie")).includes("faster"), "equal points: the faster total time wins");
  await eve.page.goto(`${base}#vq-${seed}-3t10-${allRight}-250-${hexName("Same")}-${allRight}-250-${hexName("Same")}`);
  await eve.page.waitForSelector(".duel-head");
  check((await eve.page.textContent(".duel-head")) === "It's a draw", "equal points and equal time is a draw");
  await eve.page.goto(`${base}#vq-${seed}-3t10-99-1-4a`);
  await eve.page.waitForSelector(".challenge");
  check(true, "a malformed quiz link falls back to the challenge page");
  await eve.ctx.close();

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
  await browser.close();
  server.close();
  console.log("quiz e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
