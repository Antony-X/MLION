#!/usr/bin/env node
/* Home list order, solo runs that start without an intro, and endless Unlimited sessions with Stop:
 * node tests/flow.e2e.js */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
global.window = {}; require(path.join(ROOT, "js/data.js")); require(path.join(ROOT, "js/explain.js"));
const D = window.MLION_DATA;
const E = require(path.join(ROOT, "js/engine.js"));
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.routeWebSocket(/\/relay$/, () => {}); // the live page lists open rooms: a stand-in relay that answers nothing
  await ctx.route(/fonts\./, (r) => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem("mlion:seenHow", "true"); });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  // ---- home: Daily first and gold, then Unlimited, Quiz, Sprint, Leaderboard, Settings
  await p.goto(base);
  await p.waitForSelector(".modes a");
  const modes = await p.$$eval(".modes li > a:first-child", (els) => els.map((a) => ({ href: a.getAttribute("href"), t: a.firstChild.textContent.trim(), color: getComputedStyle(a).color, hl: a.classList.contains("hl") })));
  const order = modes.map((m) => m.t).filter((t) => t !== "Leaderboard"); // the board shows only where it's configured
  check(JSON.stringify(order) === JSON.stringify(["Daily", "Unlimited", "Quiz", "Sprint", "Settings"]), `home list order: ${modes.map((m) => m.t).join(", ")}`);
  check(modes[0].hl && modes[0].color !== modes[1].color, `Daily stands out in its own colour (${modes[0].color})`);
  check(modes.find((m) => m.t === "Settings").href === "#prefs" && !modes.some((m) => m.t === "Stats"), "Settings replaces Stats");
  // "With a friend" beside Daily, Quiz and Sprint opens a live room in that format
  const duo = await p.$$eval(".modes li.duo", (els) => els.map((li) => [li.querySelector("a").getAttribute("href"), li.querySelector("a.friend").getAttribute("href"), li.querySelector("a.friend").dataset.fmt, li.querySelector("a.friend").textContent.trim()].join(" ")));
  check(JSON.stringify(duo) === JSON.stringify(["#daily #live rarity With a friend", "#quiz #live quiz With a friend", "#sprint #live sprint With a friend"]), `With a friend sits beside Daily, Quiz and Sprint (${duo.join(" | ")})`);
  const box = async (sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  const [rowA, chip] = [await box('.modes a[href="#daily"]'), await box('.modes li.duo a.friend[data-fmt="rarity"]')];
  check(chip.l >= rowA.r - 1 && chip.t < rowA.b && chip.b > rowA.t && chip.r <= 390, "the button sits on Daily's row, to its right, inside a phone screen");
  await p.$eval(".modes", (el) => el.scrollIntoView());
  await p.screenshot({ path: path.join(OUT, "70-home-modes.png") });
  await p.click('.modes a.friend[data-fmt="quiz"]');
  await p.waitForSelector("#live-fmt-line");
  check((await p.textContent("#live-fmt-line")).includes("Quiz") && (await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:liveFmt")))) === "quiz", "the Quiz one opens the room page set to Quiz");
  await p.goto(base + "#home"); await p.waitForSelector(".modes a");

  // ---- Daily starts at once: no Begin page, straight into the first prompt's read time
  await p.click('.modes a[href="#daily"]');
  await p.waitForSelector("#answer", { timeout: 8000 });
  check(!(await p.$("#begin")), "the daily opens straight on its first prompt");
  await p.goto(base + "#home");

  // ---- Quiz runs start at once too
  await p.goto(base + "#quiz-1");
  await p.waitForSelector(".mcq-opt", { timeout: 8000 });
  check(!(await p.$("#begin")), "a quiz run opens straight on its first question");

  // ---- Unlimited: endless, with Stop; a new session never repeats a prompt
  await p.goto(base + "#home");
  await p.click('.modes a[href="#unlimited-play"]');
  await p.waitForSelector("#answer");
  check(!(await p.$("#begin")), "Unlimited opens straight on a prompt");
  check((await p.textContent(".hud span")).trim() === "Answered" && !!(await p.$("#stop-run")), "the stage counts answers and offers Stop");
  const seen = [];
  const answerOne = async (i) => {
    const pid = await p.evaluate(() => { const r = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("mlion:run:unlimited:")))); return r.promptIds[r.promptIds.length - 1]; });
    seen.push(pid);
    await p.waitForSelector("#veil.hidden", { state: "attached", timeout: 8000 });
    await p.press("#answer", "Enter"); // an empty box skips
    await p.waitForSelector(".feedback", { timeout: 8000 });
    return pid;
  };
  for (let i = 0; i < 9; i++) { // more than seven: an endless session doesn't end itself
    await answerOne(i);
    check(!!(await p.$("#next")) && (await p.textContent("#next")).trim() === "Next", `prompt ${i + 1}: Next, never "See results"`);
    if (i === 8) break;
    await p.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    await p.click("#next");
    await p.waitForSelector("#answer");
  }
  check((await p.textContent("#hud-loss")).trim() === "9", "nine answered");
  await p.screenshot({ path: path.join(OUT, "71-unlimited-feedback.png") });
  await p.click("#stop-here");
  await p.waitForSelector(".score-hero", { timeout: 8000 });
  check(p.url().endsWith("#results-unlimited-1") && (await p.textContent(".loss-line")).includes("of 9"), "Stop ends the session on its results (9 prompts)");
  await p.screenshot({ path: path.join(OUT, "72-unlimited-results.png"), fullPage: true });
  check((await p.textContent('a.btn[href="#unlimited-play"]')).trim() === "Keep going", "the results offer Keep going");

  // the next session picks up the deck: no prompt from session 1 comes back
  await p.click('a.btn[href="#unlimited-play"]');
  await p.waitForSelector("#answer");
  const next = [];
  for (let i = 0; i < 3; i++) {
    next.push(await answerOne(i));
    await p.waitForSelector("#next:not([disabled])", { timeout: 6000 });
    if (i < 2) { await p.click("#next"); await p.waitForSelector("#answer"); }
  }
  check(next.every((id) => !seen.slice(0, 9).includes(id)), "session 2 deals prompts session 1 didn't");
  const deck = E.streamIds({ version: `${D.version}:core`, packs: D.packs, prompts: D.prompts.filter((x) => !x.extra) }, "unlimited-v3:core", 12);
  check(JSON.stringify(seen.slice(0, 9).concat(next)) === JSON.stringify(deck), "both sessions follow one shuffled deck");

  // Stop in the middle of a question drops that prompt; a reload resumes the session first
  await p.click("#next"); await p.waitForSelector("#answer");
  await p.reload(); await p.waitForSelector("#answer");
  check((await p.textContent("#hud-loss")).trim() === "3", "a reload resumes the session where it was");
  await p.click("#stop-run");
  await p.waitForSelector(".score-hero", { timeout: 8000 });
  check(p.url().endsWith("#results-unlimited-2") && (await p.textContent(".loss-line")).includes("of 3"), "Stop mid-question keeps the three answered, drops the open one");

  // the Unlimited page lists sessions
  await p.goto(base + "#unlimited");
  await p.waitForSelector(".list-item");
  check((await p.$$eval(".list-item .title", (els) => els.map((e) => e.textContent))).join("|") === "Session 2 · 3 prompts|Session 1 · 9 prompts", "the Unlimited page lists sessions with their length");
  await p.screenshot({ path: path.join(OUT, "73-unlimited-page.png"), fullPage: true });
  // ---- launch reset: what the beta saved goes once, settings stay, and later saves are left alone
  const rc = await b.newContext({ viewport: { width: 390, height: 844 } });
  await rc.route(/fonts\./, (r) => r.abort());
  await rc.addInitScript(() => {
    window.MLION_RESET_TEST = true; // the reset skips test browsers otherwise
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("mlion:records", JSON.stringify({ "unlimited:1": { key: "unlimited:1", mode: "unlimited", score: 300 } }));
    localStorage.setItem("mlion:name", JSON.stringify("Beta"));
    localStorage.setItem("mlion:sprints", JSON.stringify({ "loss-function": { best: 90, n: 3, plays: 1, at: 1 } }));
    localStorage.setItem("mlion:sb", "{}");
    localStorage.setItem("mlion:settings", JSON.stringify({ sound: false, answerSecs: 40 }));
  });
  const rp = await rc.newPage(); rp.on("pageerror", (e) => errs.push(e.message));
  await rp.goto(base); await rp.waitForSelector(".modes a");
  const kept = await rp.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mlion:")).sort());
  check(!kept.some((k) => /records|name|sprints|sb$/.test(k)) && kept.includes("mlion:reset"), `beta records, name, sprint bests and sign-in are cleared (left: ${kept.join(", ")})`);
  check((await rp.evaluate(() => JSON.parse(localStorage.getItem("mlion:settings")).answerSecs)) === 40, "settings stay");
  await rp.evaluate(() => localStorage.setItem("mlion:name", JSON.stringify("Launch")));
  await rp.reload(); await rp.waitForSelector(".modes a");
  check((await rp.evaluate(() => JSON.parse(localStorage.getItem("mlion:name")))) === "Launch", "the reset happens once: a name saved after it survives the next visit");
  await rc.close();

  check(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  console.log("flow e2e passed");
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
