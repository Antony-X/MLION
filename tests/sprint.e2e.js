#!/usr/bin/env node
/* Sprint mode with the real data: node tests/sprint.e2e.js
 * One prompt, sixty seconds (a fake clock) plus the time each answer adds, answers counted once each,
 * misses bounce, the end screen and the saved best. */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
const E = require(path.join(ROOT, "js/engine.js"));
global.window = {}; require(path.join(ROOT, "js/data.js"));
const D = window.MLION_DATA;
E.setLexicon(D.prompts.concat(D.extras || []));
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

// The prompt and the answers to type, worked out here with the same matcher the page uses.
const P = D.prompts.find((p) => p.id === "loss-function");
const BONUS = { baseline: 1, overfit: 2, indist: 3, outlier: 4, longtail: 5, mlion: 8 }; // seconds an answer adds to the clock
const first = P.answers.find((a) => a.t === "baseline" && a.aka && a.aka.length);
const alias = first.aka[0];
let typo = null, typoOf = null;
for (const a of P.answers) {
  if (a === first || !/^[a-z ]{9,}$/i.test(a.a)) continue;
  const s = a.a, i = Math.floor(s.length / 2), t = s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
  const m = E.matchAnswer(P, t);
  if (m.kind === "correction" && m.answer === a && !(m.confidence < 0.88)) { typo = t; typoOf = a; break; }
}

// An answer to another prompt, typed here: the miss should name the prompt it does answer.
const elsewhere = ["ReLU", "Adam", "GELU", "XGBoost", "K-means"].find((s) => E.matchAnswer(P, s).kind === "none" && E.whereElse(s, P.id).length);

(async () => {
  if (!first || !typo || !elsewhere) throw new Error("FAIL: test setup could not find answers to type");
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\./, (r) => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify({ sound: false })); });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.clock.install();

  await p.goto(base + "#sprint"); await p.waitForSelector("#sp-go");
  check(/^#sprint-[a-z0-9-]+$/.test(await p.evaluate(() => location.hash)), "#sprint picks a prompt and puts it in the address");
  const before = await p.evaluate(() => location.hash);
  await p.click("#sp-other"); await p.waitForTimeout(100);
  check((await p.evaluate(() => location.hash)) !== before, "Another prompt changes it");

  await p.goto(base + "#sprint-loss-function"); await p.waitForSelector("#sp-go");
  check((await p.textContent("#sp-card")).includes(P.text), "a sprint link opens that prompt");
  check(await p.$eval('#drawer a[href="#sprint"]', (a) => a.classList.contains("on")), "the menu marks Sprint");
  await p.click("#sp-go");
  check(await p.evaluate(() => document.activeElement && document.activeElement.id === "sp-answer"), "Start focuses the answer box");
  check(await p.$eval(".sprint .page-head", (e) => getComputedStyle(e).display === "none"), "the page heading steps aside while playing");

  const send = async (s) => { await p.fill("#sp-answer", s); await p.press("#sp-answer", "Enter"); await p.waitForTimeout(50); };
  await send(first.a);
  check((await p.textContent("#sp-n")) === "1" && (await p.textContent("#sp-pts")) === String(E.TIERS[first.t].score), `"${first.a}" counts with its tier's points`);
  check((await p.inputValue("#sp-answer")) === "", "the box clears for the next answer");
  await send(alias);
  check((await p.textContent("#sp-n")) === "1" && /Already counted/.test(await p.textContent("#status")), `its alias "${alias}" is not counted twice`);
  await send("banana bread");
  check((await p.textContent("#sp-n")) === "1" && /isn't in the key/.test(await p.textContent("#status")), "a miss bounces");
  await send(elsewhere);
  check((await p.textContent("#sp-n")) === "1" && /answers “Name an? /.test(await p.textContent("#status")), `"${elsewhere}" is turned down with the prompt it does answer`);
  await send(typo);
  check((await p.textContent("#sp-n")) === "2" && (await p.textContent("#status")).includes(`Counted as ${typoOf.a}`), `a typo "${typo}" counts as ${typoOf.a} and says so`);
  const pts = E.TIERS[first.t].score + E.TIERS[typoOf.t].score;
  check((await p.$$("#sp-found li")).length === 2, "both answers are listed");
  // every accepted answer adds time, more for a rarer tier
  const bonus = BONUS[first.t] + BONUS[typoOf.t];
  check((await p.textContent("#sp-plus")).trim() === `+${BONUS[typoOf.t]} s`, `the clock flashes the time the last answer added (+${BONUS[typoOf.t]} s for ${typoOf.t})`);

  await p.clock.runFor(30000);
  const mid = +(await p.textContent("#sp-secs"));
  check(mid > 29 + bonus && mid < 30.5 + bonus, `the clock counts down from 60 s plus the ${bonus} s the two answers added (${mid} s left after 30 s)`);
  await p.clock.runFor(30500);
  check(!(await p.$("#sp-done")) && +(await p.textContent("#sp-secs")) > bonus - 1, "the added time keeps the sprint going past the minute");
  await p.clock.runFor(bonus * 1000 + 1000);
  await p.waitForSelector("#sp-done");
  const done = await p.textContent("#sp-done");
  check(done.includes("2") && done.includes(String(pts)) && /Answers/.test(done) && /Points/.test(done), `time's up: 2 answers, ${pts} points`);
  check(/Common ones you missed/.test(done), "the end lists common answers you missed");
  check((await p.$$eval("#sp-done .figure", (els) => els.map((e) => e.textContent))).includes(`${60 + bonus}Seconds`), `the end says how long the sprint ran (${60 + bonus} s)`);
  check(await p.$("#sp-share") !== null && await p.$("details.key") !== null, "Share and the full answer key are there");
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:sprints")));
  check(saved["loss-function"] && saved["loss-function"].best === pts && saved["loss-function"].plays === 1, "the best is saved");

  await p.click("#sp-again"); await p.waitForSelector("#sp-go");
  check((await p.textContent("#sp-card")).includes(`Your best: ${pts} points`), "Again shows the best to beat");
  check((await p.textContent(".sp-recent")).includes(P.text), "the prompt is listed under Your sprints");

  await p.goto(base + "#stats"); await p.waitForTimeout(300);
  const st = await p.textContent(".screen");
  check(/Sprint/.test(st) && /Most answers/.test(st), "Stats shows a Sprint block before any daily");

  await p.goto(base + "#home"); await p.waitForTimeout(300);
  check(await p.$('.modes a[href="#sprint"]') !== null, "home lists Sprint");
  // --- a duel: the link carries a friend's result; the share carries mine
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.route(/fonts\./, (r) => r.abort());
  await ctx2.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ctx2.addInitScript(() => { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:name", JSON.stringify("Bo")); localStorage.setItem("mlion:settings", JSON.stringify({ sound: false })); });
  const q = await ctx2.newPage(); q.on("pageerror", (e) => errs.push(e.message));
  await q.clock.install();
  await q.goto(base + "#sprint-loss-function~50~3~416e61"); await q.waitForSelector("#sp-go");
  check((await q.textContent("#sp-card")).includes("Ana named 3 for 50 points"), "a duel link shows the friend's result to beat");
  await q.click("#sp-go");
  check((await q.textContent(".sp-tally")).includes("Ana: 50"), "the target stays in view while playing");
  for (const s of [first.a, typo]) { await q.fill("#sp-answer", s); await q.press("#sp-answer", "Enter"); await q.waitForTimeout(50); }
  await q.clock.runFor(61000 + bonus * 1000); await q.waitForSelector("#sp-done");
  check((await q.textContent(".sp-verdict")).includes(`You beat Ana by ${pts - 50} points`), "the end says who won and by how much");
  await q.click("#sp-share"); await q.waitForTimeout(300);
  const shared = await q.evaluate(() => navigator.clipboard.readText());
  check(shared.includes(P.text) && shared.includes(`#sprint-loss-function~${pts}~2~426f`), "Share carries my result as the next challenge");
  check(shared.includes(`2 answers · ${pts} points in ${60 + bonus} s`), "the share text gives the time the sprint really ran");
  await ctx2.close();

  check(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
  console.log("sprint e2e passed");
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
