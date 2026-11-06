#!/usr/bin/env node
/* Player levels (LEVELS.md): node tests/levels.e2e.js
 * 1. The rules, without a browser: XP for each mode, the curve, and the limits that stop farming.
 * 2. In the page: a new player sees no level; an existing player's level comes from what they already played
 *    (finished runs and sprint bests from before levels); the level-up moment on results (the full bar holds for a
 *    beat, the ring pops, the bells ring once) and a revisit that shows it still; Reduce motion; a daily's XP;
 *    practice XP slowing down after a long session; a sprint's XP; levels in a live room's lobby and XP on its podium.
 * Screenshots go to tests/out/levels-*.png. */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
const E = require(path.join(ROOT, "js/engine.js"));
global.window = {}; require(path.join(ROOT, "js/data.js")); require(path.join(ROOT, "js/explain.js"));
const D = window.MLION_DATA;
E.setLexicon(D.prompts.concat(D.extras || []));
const X = E.XP;
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

// ------------------------------------------------------------------ fixtures
const CORE = { version: `${D.version}:core`, packs: D.packs, prompts: D.prompts.filter((p) => !p.extra) };
const PIDS = CORE.prompts.map((p) => p.id);
const LVL = new Map((D.reasoning || []).map((r) => [r.id, r.lvl]));
const lvlOf = (pid) => LVL.get(pid);
const localDay = (ms) => E.localDateString(new Date(ms));
const noon = (day) => new Date(`${day}T12:00:00`).getTime();
/** A finished run as finalize() writes it: one result per tier ("miss" for a miss). */
function run(key, mode, tiers, { date = null, at = Date.now(), quiz = false, ids = PIDS } = {}) {
  const results = tiers.map((t, i) => {
    const p = D.prompts.find((x) => x.id === ids[i % ids.length]) || { id: ids[i % ids.length], text: "A question", answers: [] };
    const a = t === "miss" ? null : quiz ? { a: "Right" } : p.answers.find((x) => x.t === t) || { a: "Something" };
    return { promptId: p.id, promptText: p.text, raw: a ? a.a : "", answer: a ? a.a : null, tier: t === "miss" ? null : quiz ? "indist" : t,
      score: t === "miss" ? 0 : quiz ? 100 : E.TIERS[t].score, quip: null, corrected: false, timeout: false, ...(quiz ? { picked: t === "miss" ? 1 : 0, correct: 0, ms: 4000 } : {}) };
  });
  const rec = { key, mode, number: 1, date, pack: null, label: key, promptIds: results.map((r) => r.promptId), results, score: results.reduce((s, r) => s + r.score, 0),
    tiers: results.map((r) => r.tier || "miss"), completedAt: at, secs: 25 };
  if (quiz) Object.assign(rec, { fmt: "quiz", quiz: results.map((r) => ({ promptId: r.promptId, options: ["Right", "B", "C", "D"], correct: 0 })), picks: results.map((r) => r.picked + 1), tenths: 200 });
  return rec;
}
const asMap = (list) => Object.fromEntries(list.map((r) => [r.key, r]));
const legacySprintXp = (sp) => Object.values(sp).reduce((t, r) => t + 2 * r.n + 6 * (r.plays - 1), 0); // app.js "levels": sprints from before levels

(async () => {
  // ================================================================ 1. the rules
  console.log("rules");
  const ALL = ["baseline", "overfit", "indist", "outlier", "longtail", "mlion", "miss"];
  const day = "2026-11-06";
  const d1 = E.recordXp(run(`daily:${day}`, "daily", ALL, { date: day, at: noon(day) }));
  check(d1.daily && d1.day === day && d1.raw === 2 + 2 + 3 + 5 + 7 + 10 + 0 + X.daily, `daily: tier XP per accepted answer (2, 2, 3, 5, 7, 10), nothing for a miss, +${X.daily} for finishing (${d1.raw})`);
  check(E.recordXp(run(`daily:${day}`, "daily", Array(7).fill("miss"), { date: day })).raw === X.daily, "a daily with no answer accepted still earns the finishing bonus");
  const u1 = E.recordXp(run("unlimited:1", "unlimited", ALL, { at: noon(day) }));
  check(!u1.daily && u1.day === day && u1.raw === 29, "Unlimited: the same tier XP, no bonus, counted as practice on the day it finished");
  check(E.recordXp(run("unlimited:2", "unlimited", Array(12).fill("miss"))).raw === 0, "skips and junk answers (all misses) earn nothing");
  const bank = (lvl) => (D.reasoning || []).filter((r) => r.lvl === lvl && !r.retired).slice(0, 1).map((r) => r.id);
  const qids = [...bank("easy"), ...bank("medium"), ...bank("hard"), PIDS[0]];
  const q1 = E.recordXp(run("quiz:1", "quiz", ["indist", "indist", "indist", "indist"], { quiz: true, ids: qids }), lvlOf);
  check(q1.raw === X.quiz.easy + X.quiz.medium + X.quiz.hard + X.quiz.medium, `Quiz: a right answer earns ${X.quiz.easy}/${X.quiz.medium}/${X.quiz.hard} by level, a prompt-made question counts as medium (${q1.raw})`);
  const dq = E.recordXp(run(`dquiz:${day}`, "dquiz", ["indist", "miss", "indist", "miss"], { date: day, quiz: true, ids: qids }), lvlOf);
  check(dq.daily && dq.raw === X.quiz.easy + X.quiz.hard + X.daily, `Daily Quiz: right answers plus +${X.daily} for finishing (${dq.raw})`);
  check(E.recordXp(run("vs:abc", "vs", ["outlier", "miss"])).raw === 5 && !E.recordXp(run("vs:abc", "vs", ["outlier"])).daily, "a challenge (vs) earns tier XP as practice");
  check(E.recordXp(run("vq:abc", "vq", ["indist", "miss"], { quiz: true, ids: qids }), lvlOf).raw === X.quiz.easy, "a quiz challenge (vq) earns quiz XP as practice");
  check(["baseline", "overfit", "indist", "outlier", "longtail", "mlion"].map(E.xpSprint).join() === "1,1,2,3,4,5", "a Sprint answer earns about half (1, 1, 2, 3, 4, 5): a sprint names many answers a minute");
  check(E.recordXp(null) === null && E.recordXp({ key: "x" }) === null && E.recordXp({ results: [null, 5, "x"] }).raw === 0, "damaged records earn nothing and break nothing");

  // the curve: the first daily reaches level 2, early levels come fast, then a steady 400 a level
  check(E.levelStart(1) === 0 && E.levelStart(2) === 30 && E.levelStart(3) === 80 && E.levelStart(4) === 150, "levels 2, 3 and 4 start at 30, 80 and 150 XP");
  check([1, 2, 3, 10, 19].map(E.levelCost).join() === "30,50,70,210,390" && [20, 21, 50, 500].every((l) => E.levelCost(l) === X.steady), "each early level costs 20 more than the last, then 400 a level from level 20");
  const typicalDaily = E.recordXp(run(`daily:${day}`, "daily", ["baseline", "indist", "indist", "outlier", "baseline", "miss", "overfit"], { date: day })).raw;
  check(E.levelFor(typicalDaily).level === 2, `a typical first daily (${typicalDaily} XP) reaches level 2`);
  let prev = 1, startsOk = true;
  for (let x = 0; x <= 60000; x++) { const L = E.levelFor(x).level; if (L < prev) throw new Error(`FAIL: the level went down at ${x} XP`); if (E.levelStart(L) > x || E.levelStart(L + 1) <= x) startsOk = false; prev = L; }
  check(startsOk, "more XP never means a lower level, and every level starts where levelStart says (0 to 60,000 XP)");
  const f = E.levelFor(4000);
  check(f.level === 20 && f.into === 10 && f.left === 390 && f.need === 400, "levelFor says how far into the level and how much is left");
  check(E.levelFor(-5).level === 1 && E.levelFor(NaN).level === 1 && E.levelFor(1e12).level > 1 && Number.isFinite(E.levelFor(1e12).level), "junk XP values give a sane level");
  check(["baseline", "baseline", "overfit", "overfit", "indist", "outlier", "longtail", "mlion"].join() === [1, 4, 5, 9, 10, 25, 50, 100].map(E.levelTier).join(), "the badge warms along the tier ramp: grey to level 4, gold from level 100");

  // farm limits: a day's practice tops out; the dailies always count in full
  check(E.practiceXp(X.fresh) === X.fresh && E.practiceXp(30) === 30, `the first ${X.fresh} XP of practice each day count in full`);
  check([200, 1000, 1e5, 1e9].every((r) => E.practiceXp(r) <= X.fresh + X.tail), `a day's practice never adds more than ${X.fresh + X.tail}, however much is played`);
  check(E.practiceXp(300) > E.practiceXp(200) && E.practiceXp(200) > E.practiceXp(120), "but more practice still adds a little, so it never feels like a wall");
  const sprintDay = Array.from({ length: 180 }, (_, i) => ({ day, daily: false, raw: 25 })); // three hours of back-to-back sprints, about 25 XP a minute
  check(E.xpTotal(sprintDay) <= X.fresh + X.tail, `three hours of sprints in one day: ${E.xpTotal(sprintDay)} XP`);
  const replay = E.xpTotal(Array.from({ length: 60 }, () => ({ day, daily: false, raw: 40 }))); // the same sprint, memorised, sixty times
  check(replay <= X.fresh + X.tail, `replaying one solved sprint 60 times in a day: ${replay} XP`);
  const week = (dailyRaw, practiceRaw) => { const es = []; for (let i = 0; i < 7; i++) { const d = E.addDays(day, i); es.push({ day: d, daily: true, raw: dailyRaw }); if (practiceRaw) es.push({ day: d, daily: false, raw: practiceRaw }); } return E.xpTotal(es); };
  const casual = week(45 + 35, 0), keen = week(45 + 35, 120), grind = week(45 + 35, 5000);
  check(grind / casual < 3.2 && grind / keen < 1.6, `a week: both dailies ${casual} XP, plus 15 minutes of practice ${keen}, plus hours of grinding ${grind}: grinding pays little past normal play`);
  check(E.xpTotal([{ day, daily: true, raw: 1e9 }, { day, daily: false, raw: -50 }, { day, daily: false, raw: NaN }, null]) === 200, "stored junk can't be worth more than one daily's ceiling");

  // ================================================================ 2. in the page
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const errs = [];
  /** A context whose storage is seeded once (the seed survives reloads of the same tab only through storage). */
  async function context(seed, { width = 390, height = 844, settings = { sound: false }, fake = false } = {}) {
    const ctx = await b.newContext({ viewport: { width, height } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.routeWebSocket(/\/relay$/, () => {});
    await ctx.addInitScript(([seed, settings, fake]) => {
      if (fake) (new Function(fake))();
      window.MLION_TEST = true;
      if (localStorage.getItem("__seeded")) return;
      localStorage.setItem("__seeded", "1");
      localStorage.setItem("mlion:seenHow", "true");
      localStorage.setItem("mlion:settings", JSON.stringify(settings));
      for (const [k, v] of Object.entries(seed || {})) localStorage.setItem("mlion:" + k, JSON.stringify(v));
    }, [seed, settings, fake || ""]);
    return ctx;
  }
  async function page(ctx, tag) { const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(`${tag}: ${e.message}`)); return p; }
  const shot = (p, name, full) => p.screenshot({ path: path.join(OUT, `levels-${name}.png`), fullPage: !!full });
  const levelOn = (p, sel) => p.$eval(sel, (el) => +(el.querySelector(".xp-lv b, .xp-ring b").textContent));
  const sounds = (p) => p.evaluate(() => (window.MLION_SOUNDS || []).map((s) => s[0]));

  // ---- a new player: nothing about levels on home
  console.log("new player");
  {
    const ctx = await context({});
    const p = await page(ctx, "new");
    await p.goto(base); await p.waitForSelector(".modes a");
    check(!(await p.$(".xp-chip, .xp-row, .xp-block")) && !/Level \d/.test(await p.textContent("#app")), "a new player's home shows no level");
    await p.waitForTimeout(2500); await shot(p, "home-new-390"); // after the hero has risen in
    await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(200);
    await p.waitForTimeout(2500); await shot(p, "home-new-1366"); // after the hero has risen in
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(base + "#stats"); await p.waitForSelector(".page-head");
    check(!(await p.$(".xp-block, .xp-how")), "nor does their empty Stats page");
    await ctx.close();
  }

  // ---- an existing player: the level comes from what they already played
  console.log("retroactive");
  const d4 = "2026-11-04", d5 = "2026-11-05";
  const pastRuns = [
    run(`daily:${d4}`, "daily", ["baseline", "indist", "outlier", "miss", "baseline", "overfit", "longtail"], { date: d4, at: noon(d4) }),
    run(`daily:${d5}`, "daily", ["indist", "indist", "mlion", "baseline", "miss", "outlier", "baseline"], { date: d5, at: noon(d5) }),
    run(`dquiz:${d5}`, "dquiz", ["indist", "indist", "miss", "indist", "indist", "miss", "indist"], { date: d5, at: noon(d5) + 1, quiz: true, ids: (D.daily.quiz[0] || qids) }),
    run("unlimited:1", "unlimited", Array.from({ length: 30 }, (_, i) => ALL[i % 7]), { at: noon(d5) + 2 }),
    run("quiz:1", "quiz", ["indist", "indist", "indist", "miss", "indist", "indist", "indist"], { at: noon(d4) + 3, quiz: true, ids: qids }),
    run("vs:k3x9q2", "vs", ["outlier", "baseline", "miss"], { at: noon(d4) + 4 }),
  ];
  const oldSprints = { "loss-function": { best: 120, n: 9, plays: 3, at: noon(d5) }, "optimizer": { best: 40, n: 4, plays: 1, at: noon(d4) } };
  const pastXp = E.xpTotal(pastRuns.map((r) => E.recordXp(r, lvlOf)).concat([{ day: d5, daily: false, raw: legacySprintXp(oldSprints) }]));
  const past = E.levelFor(pastXp);
  {
    const ctx = await context({ records: asMap(pastRuns), sprints: oldSprints });
    const p = await page(ctx, "seasoned");
    await p.goto(base); await p.waitForSelector(".xp-chip");
    check((await levelOn(p, ".xp-chip")) === past.level && (await p.textContent(".xp-chip")).includes(`${past.left} XP to Level ${past.level + 1}`), `home shows Level ${past.level}, ${past.left} XP to go: what their ${pastXp} XP of earlier play is worth`);
    const log = await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:xplog")));
    check(log && log["sprints-before-levels"] && log["sprints-before-levels"].r === legacySprintXp(oldSprints) && log["sprints-before-levels"].d === d5, "sprint bests from before levels count once, on the day of the latest");
    await p.waitForTimeout(2500); await shot(p, "home-seasoned-390"); // after the hero has risen in
    await p.reload(); await p.waitForSelector(".xp-chip");
    check((await levelOn(p, ".xp-chip")) === past.level && Object.keys(await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:xplog")))).length === 1, "a reload counts them once, not again");
    await p.goto(base + "#stats"); await p.waitForSelector("#xp-block");
    check((await levelOn(p, "#xp-block")) === past.level && (await p.textContent("#xp-block")).includes(`${pastXp.toLocaleString("en-US")} XP in all`), "Stats shows the same level and the XP in all");
    check((await p.textContent(".xp-how")).includes("never go down"), "Stats explains how XP is earned");
    await shot(p, "stats-390", true);
    await p.setViewportSize({ width: 1366, height: 768 });
    await p.goto(base + "#stats"); await p.waitForSelector("#xp-block");
    await shot(p, "stats-1366");
    await p.goto(base); await p.waitForSelector(".xp-chip");
    await p.waitForTimeout(2500); await shot(p, "home-seasoned-1366"); // after the hero has risen in
    // Reset progress clears levels with everything else
    await p.goto(base + "#prefs"); await p.click("#reset"); await p.click("#rs-yes");
    await p.waitForSelector(".modes a");
    check(!(await p.$(".xp-chip")), "Reset progress clears the level with the rest of the progress");
    await ctx.close();
  }

  // ---- the level-up moment: one Unlimited answer takes a player over the line
  console.log("level-up moment");
  const nearly = run("unlimited:1", "unlimited", ["longtail", "longtail", "longtail", "outlier", "baseline"], { at: Date.now() - 60000 }); // 28 XP today: 2 short of level 2
  check(E.xpTotal([E.recordXp(nearly)]) === 28, "fixture: 28 XP, level 2 begins at 30");
  /** Opens Unlimited, answers the prompt it deals with an answer of the tier asked for (or the nearest it has), and
   *  stops. Returns that tier, so the test knows what the answer was worth. */
  async function playOne(p, want) {
    await p.goto(base + "#unlimited-play");
    await p.waitForSelector("#veil.hidden", { state: "attached", timeout: 10000 });
    const pick = await p.evaluate((want) => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("mlion:run:unlimited:"));
      const ids = JSON.parse(localStorage.getItem(k)).promptIds, q = window.MLION_DATA.prompts.find((x) => x.id === ids[ids.length - 1]);
      const order = [want, "baseline", "overfit", "indist", "outlier", "longtail", "mlion"];
      for (const t of order) { const a = q.answers.find((x) => x.t === t); if (a) return { a: a.a, t }; }
      return null;
    }, want);
    await p.fill("#answer", pick.a); await p.press("#answer", "Enter");
    await p.waitForSelector(".feedback", { timeout: 8000 });
    await p.waitForSelector("#stop-here", { timeout: 8000 });
    await p.evaluate(() => { // watch the row from its first frame: the level shown and the bar's width, with the time
      window.__xp = [];
      const tick = () => { const r = document.querySelector("#xp-row"); if (r) window.__xp.push([performance.now(), +r.querySelector(".xp-lv b").textContent, parseFloat(r.querySelector(".xp-bar i").style.width) || 0, r.classList.contains("up")]); if (window.__xp.length < 2000) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await p.click("#stop-here");
    await p.waitForSelector(".score-hero", { timeout: 8000 });
    return pick.t;
  }
  {
    const ctx = await context({ records: asMap([nearly]) }, { settings: { sound: false, reducedMotion: false } });
    const p = await page(ctx, "levelup");
    const t = await playOne(p, "baseline");
    const got = X.tier[t], after = E.levelFor(28 + got);
    const first = await p.$eval("#xp-row", (r) => [+r.querySelector(".xp-lv b").textContent, r.querySelector(".xp-gain").textContent.trim(), r.querySelector(".xp-up").hidden]);
    check(first[0] === 1 && first[1] === "+0 XP" && first[2], `the row starts where the player was (Level 1, ${first[1]})`);
    await p.waitForTimeout(700);
    await shot(p, "results-filling-390");
    await p.waitForSelector(".xp-row.up .xp-up:not([hidden])", { timeout: 6000 });
    await p.waitForFunction(() => !document.querySelector("#xp-row").classList.contains("xp-anim"), null, { timeout: 6000 });
    const end = await p.$eval("#xp-row", (r) => [+r.querySelector(".xp-lv b").textContent, r.querySelector(".xp-gain").textContent.trim(), r.querySelector(".xp-sub").textContent, r.querySelector(".sr").textContent]);
    check(end[0] === 2 && end[1] === `+${got} XP` && end[2] === `${after.left} XP to Level 3`, `it ends on Level 2, ${end[1]} (a ${t} answer), ${end[2]}`);
    check(end[3] === "Level up. You're Level 2.", "screen readers hear the level-up");
    const seq = await p.evaluate(() => window.__xp);
    const full = seq.filter(([, lv, w]) => lv === 1 && w >= 99.9);
    const firstTwo = seq.find(([, lv]) => lv === 2);
    check(full.length && firstTwo && full[0][0] < firstTwo[0], "the bar fills to the brim before the level ticks over");
    const hold = firstTwo[0] - full[0][0];
    check(hold >= 120 && hold < 600, `the full bar holds for a beat first, like the stage's hit-stop (${Math.round(hold)} ms)`);
    check(seq.some(([, lv, , up]) => lv === 1 && !up) && seq.every(([, lv, , up]) => !up || lv === 2), "the gold level-up look comes only with the new level");
    const s = await sounds(p);
    check(s.filter((x) => x === "levelUp").length === 1, "the level-up bells ring once");
    check((await p.textContent(".score-hero")).includes("rarer ones the most") && (await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:xpHello")))) === true, "the first XP row says once how XP works and that levels never go down");
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:records"))["unlimited:2"].xp);
    check(saved === got, `the run keeps what it earned (rec.xp = ${saved})`);
    await shot(p, "results-levelup-390");
    // a revisit shows where things stand, with no second moment
    await p.goto(base + "#home"); await p.waitForSelector(".xp-chip");
    check((await levelOn(p, ".xp-chip")) === 2, "home now says Level 2");
    await p.goto(base + "#results-unlimited-2"); await p.waitForSelector("#xp-row");
    const again = await p.$eval("#xp-row", (r) => [+r.querySelector(".xp-lv b").textContent, r.querySelector(".xp-gain").textContent.trim(), r.querySelector(".xp-up").hidden, !!r.parentElement.querySelector(".xp-note")]);
    check(again[0] === 2 && again[1] === `+${got} XP` && again[2] && !again[3], "a revisit shows Level 2 and the XP the run earned, without the tag or the note");
    check((await sounds(p)).filter((x) => x === "levelUp").length === 1, "and rings no bells");
    await p.goto(base + "#results-unlimited-1"); await p.waitForSelector(".score-hero");
    check(!(await p.$("#xp-row")), "a run from before levels shows no XP row");
    await ctx.close();
  }
  {
    const ctx = await context({ records: asMap([nearly]) }, { width: 1366, height: 768, settings: { sound: false } });
    const p = await page(ctx, "levelup-wide");
    await playOne(p, "baseline");
    await p.waitForSelector(".xp-row.up .xp-up:not([hidden])", { timeout: 6000 });
    await p.waitForTimeout(400);
    await shot(p, "results-levelup-1366");
    await ctx.close();
  }

  // ---- Reduce motion: the end at once, the bells still ring
  console.log("reduce motion");
  {
    const ctx = await context({ records: asMap([nearly]), xpHello: true }, { settings: { sound: false, reducedMotion: true } });
    const p = await page(ctx, "calm");
    const t = await playOne(p, "baseline");
    const now = await p.$eval("#xp-row", (r) => [+r.querySelector(".xp-lv b").textContent, r.querySelector(".xp-gain").textContent.trim(), r.querySelector(".xp-up").hidden, r.classList.contains("xp-anim"), r.classList.contains("up")]);
    check(now[0] === 2 && now[1] === `+${X.tier[t]} XP` && !now[2] && !now[3] && now[4], "with Reduce motion the row shows Level 2 and the tag at once, with no animation");
    const seq = await p.evaluate(() => window.__xp);
    check(seq.length && seq.every(([, lv]) => lv === 2), "it never shows the old level filling");
    check((await sounds(p)).includes("levelUp"), "the level-up bells still ring (sound is its own setting)");
    check(!(await p.$(".xp-note")), "the how-XP-works note shows only once per browser");
    await ctx.close();
  }

  // ---- a daily: finishing counts even with nothing accepted
  console.log("daily");
  {
    const ctx = await context({});
    const p = await page(ctx, "daily");
    await p.goto(base + "#daily");
    for (let i = 0; i < 7; i++) {
      await p.waitForSelector("#veil.hidden", { state: "attached", timeout: 10000 });
      await p.press("#answer", "Enter"); // an empty box skips
      await p.waitForSelector("#next:not([disabled])", { timeout: 8000 });
      if (i < 6) { await p.click("#next"); await p.waitForSelector("#answer"); }
    }
    await p.click("#next");
    await p.waitForSelector("#xp-row", { timeout: 8000 });
    const rec = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem("mlion:records")))[0]);
    check(rec.mode === "daily" && rec.xp === X.daily, `a daily with seven skips earns the finishing bonus (+${rec.xp} XP)`);
    await p.waitForFunction(() => !document.querySelector("#xp-row").classList.contains("xp-anim"), null, { timeout: 6000 });
    check((await levelOn(p, "#xp-row")) === 1 && (await p.textContent(".xp-gain")).trim() === `+${X.daily} XP`, "the row says +20 XP, still Level 1 (level 2 is at 30)");
    await shot(p, "results-daily-390");
    await ctx.close();
  }

  // ---- practice slows down after a long session, and says so
  console.log("farm limits in the page");
  {
    const long = Array.from({ length: 12 }, (_, i) => run(`unlimited:${i + 1}`, "unlimited", Array(10).fill("outlier"), { at: Date.now() - (i + 2) * 60000 })); // 600 raw today
    const busyXp = E.xpTotal(long.map((r) => E.recordXp(r)));
    check(busyXp === E.practiceXp(600), `fixture: 12 long Unlimited sessions today are worth ${busyXp} XP, not 600`);
    const ctx = await context({ records: asMap(long), xpHello: true });
    const p = await page(ctx, "tired");
    await p.goto(base); await p.waitForSelector(".xp-chip");
    check((await levelOn(p, ".xp-chip")) === E.levelFor(busyXp).level, `home agrees: Level ${E.levelFor(busyXp).level}`);
    const t = await playOne(p, "outlier");
    await p.waitForSelector("#xp-row");
    await p.waitForFunction(() => !document.querySelector("#xp-row").classList.contains("xp-anim"), null, { timeout: 6000 });
    const gain = +(await p.textContent(".xp-gain b"));
    const note = await p.textContent(".score-hero");
    const want = E.practiceXp(600 + X.tier[t]) - E.practiceXp(600);
    check(gain === want && gain <= 1 && note.includes("refills tomorrow"), `one more answer worth ${X.tier[t]} XP adds +${gain} today, and the row says why`);
    check((await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:records"))["unlimited:13"].xp)) === want, "the run keeps what it really added");
    await shot(p, "results-tired-390");
    await ctx.close();
  }

  // ---- a sprint: its XP is logged (a sprint leaves no record) and shown on the end screen
  console.log("sprint");
  {
    const ctx = await context({ xpHello: true });
    const p = await page(ctx, "sprint");
    await p.clock.install();
    await p.goto(base + "#sprint-loss-function"); await p.waitForSelector("#sp-go");
    await p.click("#sp-go");
    const LF = D.prompts.find((x) => x.id === "loss-function");
    const named = LF.answers.filter((a) => a.t === "baseline" || a.t === "indist").slice(0, 6);
    for (const a of named) { await p.fill("#sp-answer", a.a); await p.press("#sp-answer", "Enter"); await p.waitForTimeout(30); }
    await p.clock.runFor(200000);
    await p.waitForSelector("#sp-done");
    await p.clock.runFor(5000);
    const want = named.reduce((t, a) => t + E.xpSprint(a.t), 0);
    const log = await p.evaluate(() => JSON.parse(localStorage.getItem("mlion:xplog")));
    const ent = Object.entries(log).filter(([k]) => k.startsWith("sp:loss-function:"));
    check(ent.length === 1 && ent[0][1].r === want, `the sprint logs ${want} XP for ${named.length} answers`);
    check((await p.textContent("#xp-row .xp-gain")).trim() === `+${want} XP`, "and its end screen shows it");
    await shot(p, "sprint-done-390", true);
    await p.setViewportSize({ width: 1366, height: 768 });
    await p.clock.runFor(500);
    await shot(p, "sprint-done-1366");
    await ctx.close();
  }

  // ---- a live room: everyone's level in the lobby, and the match's XP on the podium
  console.log("live room");
  {
    // Two profiles can't share the fake relay, so the lobby test uses one profile: Ana hosts while storage holds no
    // runs (Level 1), then the runs go back and Ben joins (his level comes from them). Each level travels in the
    // hello message and comes back in the lobby list.
    const FAKE = `(${(() => {
      class Client {
        constructor() {
          this.h = {}; this.msg = []; this.subs = new Set(); this.connected = true;
          this.ch = new BroadcastChannel("fake-relay");
          this.ch.onmessage = (ev) => { const { topic, payload } = ev.data; if (this.subs.has(topic)) this.msg.forEach((f) => f(topic, { toString: () => payload, length: payload.length })); };
          setTimeout(() => (this.h.connect || []).forEach((f) => f()), 300);
        }
        on(ev, f) { if (ev === "message") this.msg.push(f); else (this.h[ev] = this.h[ev] || []).push(f); return this; }
        removeAllListeners(ev) { if (ev === "message") this.msg = []; else delete this.h[ev]; }
        subscribe(t) { [].concat(t).forEach((x) => this.subs.add(x)); }
        publish(topic, payload) { this.ch.postMessage({ topic, payload: String(payload) }); }
        end() { try { this.ch.close(); } catch { /* ignore */ } }
        reconnect() {}
      }
      window.mqtt = { connect: () => new Client() };
      window.MLION_FAKE_RELAY = () => new Client();
      window.MLION_SPRINT_TEST = { secs: 6, reveal: 1500 };
    }).toString()})();`;
    const ctx = await context({}, { width: 390, height: 844, fake: FAKE });
    const ana = await page(ctx, "Ana"), ben = await page(ctx, "Ben");
    await ana.goto(base + "#live"); await ana.waitForSelector("#live-name");
    await ana.fill("#live-name", "Ana"); await ana.click("#live-go");
    await ana.waitForFunction(() => /^#live-[a-z0-9]{5}-[A-Za-z0-9_-]{22}$/.test(location.hash), null, { timeout: 15000 });
    const link = await ana.evaluate(() => location.hash);
    await ana.evaluate((recs) => localStorage.setItem("mlion:records", JSON.stringify(recs)), asMap(pastRuns)); // Ben's page loads with these
    await ben.goto(base + link); await ben.waitForSelector("#live-name");
    await ben.fill("#live-name", "Ben"); await ben.click("#live-go");
    const rows = (p) => p.$$eval(".lv-players li:not(.lv-wait)", (els) => els.map((li) => li.textContent.replace(/\s+/g, " ").trim()));
    const benXp = E.xpTotal(pastRuns.map((r) => E.recordXp(r, lvlOf)));
    const benLv = E.levelFor(benXp).level;
    for (const [p, who] of [[ana, "Ana's page"], [ben, "Ben's page"]]) {
      await p.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 2, null, { timeout: 20000 });
      await p.waitForFunction((lv) => document.querySelector(".lv-players").textContent.includes(`Level ${lv}`), benLv, { timeout: 10000 });
      const r = await rows(p);
      check(r.some((t) => t.startsWith("AAna") && t.includes("Level 1 ·")) && r.some((t) => t.startsWith("BBen") && t.includes(`Level ${benLv} ·`)), `${who} lists Ana at Level 1 and Ben at Level ${benLv} (${r.join(" | ")})`);
    }
    await ben.waitForTimeout(1200); // the rows fade in
    await ben.screenshot({ path: path.join(OUT, "levels-lobby-390.png") });
    // a one-sprint match: the podium shows the XP it earned, once
    await ana.click('.lv-fmt[data-f="sprint"]');
    await ana.fill("#q-custom", "1"); await ana.press("#q-custom", "Tab"); await ana.waitForTimeout(300);
    await ana.click("#live-ready"); await ben.click("#live-ready");
    await ben.waitForSelector("#sp-answer:not([disabled])", { timeout: 30000 });
    const words = await ben.evaluate(() => { const L = window.MLION_LIVE_STATE; const q = window.MLION_DATA.prompts.find((x) => x.id === L.ids[0]); return q.answers.filter((a) => a.t === "baseline").slice(0, 3).map((a) => a.a); });
    // both name the same three, so whichever page logs the match (they share storage) logs the same XP
    await ana.waitForSelector("#sp-answer:not([disabled])", { timeout: 30000 });
    for (const p of [ben, ana]) for (const w of words) { await p.fill("#sp-answer", w); await p.press("#sp-answer", "Enter"); await p.waitForTimeout(200); }
    await Promise.all([ana, ben].map((p) => p.waitForFunction(() => window.MLION_LIVE_STATE.phase === "done" && document.querySelector(".lv-podium"), null, { timeout: 40000 })));
    await ben.waitForTimeout(2500);
    const log = await ben.evaluate(() => JSON.parse(localStorage.getItem("mlion:xplog")));
    const live = Object.entries(log).filter(([k]) => k.startsWith("live:"));
    check(live.length === 1 && live[0][1].r === X.live + words.length * X.sprint.baseline, `the match logs its XP once, ${X.live} for playing plus each right answer (${live.map(([k, e]) => `${k}: ${e.r}`).join(", ")}), though both pages share this profile`);
    const shown = (await ana.$("#xp-row")) || (await ben.$("#xp-row"));
    check(!!shown && /^\+\d+ XP$/.test((await shown.$eval(".xp-gain", (e) => e.textContent.trim()))), "the podium shows the XP row");
    await (await ana.$("#xp-row") ? ana : ben).screenshot({ path: path.join(OUT, "levels-podium-390.png") });
    await ben.click("#live-ready"); await ben.waitForTimeout(500); // a redraw of the podium
    check(Object.keys(await ben.evaluate(() => JSON.parse(localStorage.getItem("mlion:xplog")))).filter((k) => k.startsWith("live:")).length === 1, "a podium redraw (a Ready tap) adds nothing");
    await ctx.close();
  }

  check(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  console.log("levels e2e passed");
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
