#!/usr/bin/env node
/* Live room options (the host's "More options"): speed bonus, hints, wrong-answer penalties, final question
 * double, clash, and the quiz's 50:50. Two phones play a Classic match, then a Quiz match.
 *   node tests/live.rules.e2e.js   (needs public.cloud.shiftr.io) */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const E = require("../js/engine.js");
global.window = {};
require(path.join(ROOT, "js", "data.js")); require(path.join(ROOT, "js", "explain.js"));
const DATA = global.window.MLION_DATA;
const PROMPT = new Map(DATA.prompts.map((p) => [p.id, p]));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const CLOCK = E.ANSWER_MS, QCLOCK = Math.round(E.ANSWER_MS * E.REASONING_CLOCK); // Classic, and a bank question's clock
const errors = [];
const check = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy });
  const code = () => "r" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  async function player(tag, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript((c) => {
      window.MLION_TEST = true;
      if (c) { window.MLION_LIVE_CODE = c; window.MLION_LIVE_SECRET = c.padEnd(22, "K"); }
      try { localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ }
    }, init || null);
    return page;
  }
  async function room(host, guest, forced) {
    await host.goto(base + "#live");
    await host.fill("#live-name", "Ana");
    await host.click("#live-go");
    await host.waitForSelector(".lv-code", { timeout: 20000 });
    await guest.goto(base + `#live-${forced}-${forced.padEnd(22, "K")}`);
    await guest.fill("#live-name", "Ben");
    await guest.click("#live-go");
    await host.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 2, null, { timeout: 40000 });
  }
  const live = (pg) => pg.evaluate(() => {
    const L = window.MLION_LIVE_STATE;
    return { ids: L.ids.slice(), n: L.n, rules: L.mrules, quiz: L.quiz && L.quiz.map((q) => ({ correct: q.correct })),
      players: [...L.players.values()].map((p) => ({ name: p.name, ans: Array.from({ length: L.n }, (_, i) => p.ans[i]).map((a) => a && { answer: a.answer, tier: a.tier, ms: a.ms, miss: a.miss, hint: a.hint, score: a.score }) })) };
  });
  const podium = (pg) => pg.$$eval(".lv-podium li", (els) => Object.fromEntries(els.map((li) => [li.querySelector(".nm b").textContent, +li.querySelector("em").textContent.trim()])));
  const setRule = async (pg, k, v) => { await pg.click(`.lv-rule[data-k="${k}"][data-v="${v}"]`); await pg.waitForSelector(`.lv-rule.on[data-k="${k}"][data-v="${v}"]`); };
  const tick = async (pg, k) => { await pg.check(`.lv-rule-x[data-k="${k}"]`); await pg.waitForSelector(`.lv-rule-x[data-k="${k}"]:checked`); };

  // ================= Classic: speed ×2, hints for half points, one strike, final ×2, clash
  const c1 = code();
  const ana = await player("ana", c1), ben = await player("ben");
  await room(ana, ben, c1);
  check(await ana.$eval("#lv-more", (d) => !d.open) && !(await ben.$("#lv-more")), "More options starts closed, and only the host has it");
  await ana.click("#lv-more > summary");
  check(await ana.$eval("#lv-more", (d) => d.open), "the host opens More options");
  await setRule(ana, "speed", "2");
  await setRule(ana, "hints", "half");
  await setRule(ana, "miss", "strike");
  await tick(ana, "final");
  await tick(ana, "clash");
  check(await ana.$eval("#lv-more", (d) => d.open) && /5 on/.test(await ana.textContent("#lv-more > summary")), "the panel stays open as rules change and counts what's on");
  // autocorrect is a slider: two steps right from Typos is Generous, and focus stays on it through the redraw
  await ana.focus("#lv-assist");
  await ana.keyboard.press("ArrowRight");
  await ana.waitForFunction(() => document.querySelector("#lv-assist-name").textContent === "Full" && document.activeElement && document.activeElement.id === "lv-assist", null, { timeout: 8000 });
  await ana.keyboard.press("ArrowRight");
  await ana.waitForFunction(() => document.querySelector("#lv-assist-name").textContent === "Generous" && /close guess counts/.test(document.querySelector("#lv-assist-note").textContent), null, { timeout: 8000 });
  check(true, "the autocorrect slider moves Typos → Full → Generous by keyboard and says what each does");
  await ana.fill("#q-custom", "2");
  await ana.press("#q-custom", "Enter");
  await ben.waitForFunction(() => /2 questions · 25 s each · autocorrect generous\. .*Options: speed bonus up to ×2, hints for half points, one strike, final question ×2, clash\./.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "the guest's note lists the room's options");
  await ana.screenshot({ path: path.join(OUT, "60-live-more-options.png"), fullPage: true });
  for (const pg of [ana, ben]) { await pg.waitForSelector("#live-ready:not([disabled])"); await pg.click("#live-ready"); }

  // round 1: Ben takes a hint, then answers wrong and is out (one strike); Ana answers fast
  for (const pg of [ana, ben]) await pg.waitForSelector("#veil.hidden", { state: "attached", timeout: 20000 });
  let st = await live(ana);
  check(st.rules.speed === "2" && st.rules.miss === "strike" && st.rules.final && st.rules.clash, "the match runs the host's rules");
  const p0 = PROMPT.get(st.ids[0]);
  check(/Time left · ×(1\.\d|2\.0)/.test(await ana.textContent("#timer-label")), `the clock shows the speed multiplier (${await ana.textContent("#timer-label")})`);
  check(/half points/.test(await ben.textContent("#hint-btn")), "the hint button says what it costs");
  await ben.click("#hint-btn");
  const shape = await ben.textContent(".hint-shape");
  const rare = p0.answers.filter((a) => ["indist", "outlier", "longtail"].includes(a.t));
  const hinted = rare.find((a) => a.a[0].toUpperCase() === shape[0] && a.a.length === shape.length);
  check(!!hinted, `the hint shows the first letter and shape of a rarer answer (${shape})`);
  const clue = (await ben.$(".hint-clue")) ? await ben.textContent(".hint-clue") : "";
  check(!clue.toLowerCase().includes(hinted.a.toLowerCase()), "the clue never names the answer");
  await ben.screenshot({ path: path.join(OUT, "61-live-hint.png") });
  await ben.fill("#answer", "qqqzzzq");
  await ben.press("#answer", "Enter");
  await ben.waitForFunction(() => /One strike/.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "one strike: a wrong answer ends your round");
  const easy = p0.answers.find((a) => a.t === "baseline") || p0.answers[0];
  await ana.fill("#answer", easy.a);
  await ana.press("#answer", "Enter");
  await ana.waitForSelector(".rule-note", { timeout: 8000 });
  check(/for speed/.test(await ana.textContent(".rule-note")), `your feedback says how the rules changed your points (${(await ana.textContent(".rule-note")).trim()})`);
  await Promise.all([ana.waitForSelector(".lv-reveal", { timeout: 20000 }), ben.waitForSelector(".lv-reveal", { timeout: 20000 })]);
  check(/speed/.test(await ben.textContent(".lv-answers")), "the reveal tags the speed bonus");
  st = await live(ben);
  const aBen = st.players.find((p) => p.name === "Ana").ans[0];
  const base0 = E.TIERS[aBen.tier].score;
  check(aBen.score === E.liveScore(st.rules, { base: base0, ms: aBen.ms, total: CLOCK, misses: aBen.miss, hinted: aBen.hint, last: false }) && aBen.score > base0,
    `a fast answer scores more on every phone (${aBen.score} from ${base0}, ${aBen.ms} ms)`);
  check(!st.players.find((p) => p.name === "Ben").ans[0].tier, "the struck answer scores nothing");

  // round 2 (final, double): both give the same answer, so it clashes
  for (const pg of [ana, ben]) await pg.waitForSelector("#veil.hidden", { state: "attached", timeout: 25000 });
  check(/Final question · double points/.test(await ana.textContent(".final-x2")) && await ben.isVisible(".final-x2"), "the last question says it counts double");
  st = await live(ana);
  const p1 = PROMPT.get(st.ids[1]);
  // Ben makes a typo; generous autocorrect takes it at once (when the matcher finds the answer from it)
  const words = p1.answers.filter((a) => /^[a-z]{6,}$/i.test(a.a));
  const typoOf = (w) => w.slice(0, 2) + w[3] + w[2] + w.slice(4);
  const pick = words.find((a) => { const m = E.matchAnswer(p1, typoOf(a.a)); return (m.kind === "correction" && m.answer.a === a.a) || (m.kind === "suggest" && m.suggestions[0].a === a.a && !(m.confidence < 0.6)); });
  const same = pick || p1.answers.find((a) => a.t === "baseline") || p1.answers[0];
  await ana.fill("#answer", same.a); await ana.press("#answer", "Enter");
  await ben.fill("#answer", pick ? typoOf(same.a) : same.a); await ben.press("#answer", "Enter");
  await Promise.all([ana.waitForSelector(".lv-reveal", { timeout: 25000 }), ben.waitForSelector(".lv-reveal", { timeout: 25000 })]);
  if (pick) check(true, `generous autocorrect takes "${typoOf(same.a)}" as ${same.a} without asking`);
  const rv = await ana.textContent(".lv-answers");
  check(/clash: half/.test(rv) && /×2 final/.test(rv), "the reveal tags the clash and the double final");
  await Promise.all([ana.waitForSelector(".lv-podium", { timeout: 25000 }), ben.waitForSelector(".lv-podium", { timeout: 25000 })]);
  const fin = await live(ana);
  const pts = (who) => {
    const pl = fin.players.find((p) => p.name === who);
    return pl.ans.reduce((s, a, i) => {
      if (!a || !a.tier) return s;
      const sc = E.liveScore(fin.rules, { base: E.TIERS[a.tier].score, ms: a.ms, total: CLOCK, misses: a.miss, hinted: a.hint, last: i === fin.n - 1 });
      const other = fin.players.find((p) => p !== pl).ans[i];
      return s + (other && other.tier && other.answer === a.answer ? Math.round(sc / 2) : sc);
    }, 0);
  };
  const shown = await podium(ana), shownB = await podium(ben);
  check(shown.Ana === pts("Ana") && shown.Ben === pts("Ben") && shownB.Ana === shown.Ana && shownB.Ben === shown.Ben,
    `totals match the rules on both phones (Ana ${shown.Ana}, Ben ${shown.Ben})`);
  const r1 = fin.players.find((p) => p.name === "Ben").ans[1];
  check(r1.score === E.liveScore(fin.rules, { base: E.TIERS[r1.tier].score, ms: r1.ms, total: CLOCK, last: true }) && r1.score >= 2 * E.TIERS[r1.tier].score, "the final question's points are doubled");
  await ana.screenshot({ path: path.join(OUT, "62-live-rules-podium.png"), fullPage: true });
  await ana.context().close(); await ben.context().close();

  // ================= Quiz: 50:50 (free), speed up to ×1.5
  const c2 = code();
  const qa = await player("qa", c2), qb = await player("qb");
  await room(qa, qb, c2);
  await qa.click('.lv-fmt[data-f="quiz"]');
  await qa.click("#lv-more > summary");
  check(!(await qa.$('.lv-rule[data-k="miss"]')) && !(await qa.$('.lv-rule-x[data-k="clash"]')), "a quiz room leaves out the typing-only options");
  check(/50:50/.test(await qa.textContent("#lv-more")), "a quiz room's hint is the 50:50");
  await setRule(qa, "hints", "free");
  await setRule(qa, "speed", "1.5");
  await qa.fill("#q-custom", "2");
  await qa.press("#q-custom", "Enter");
  await qb.waitForFunction(() => /Options: speed bonus up to ×1\.5, 50:50/.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "the guest's note lists the quiz options");
  for (const pg of [qa, qb]) { await pg.waitForSelector("#live-ready:not([disabled])"); await pg.click("#live-ready"); }
  const unlocked = (pg) => pg.waitForSelector(".mcq:not(.locked) .mcq-opt:not([disabled])", { timeout: 30000 });
  await Promise.all([unlocked(qa), unlocked(qb)]);
  const q = await live(qa);
  await qa.click("#hint-btn");
  await qb.click("#hint-btn");
  const cutA = await qa.$$eval(".mcq-opt.cut", (els) => els.map((e) => e.dataset.i).join());
  const cutB = await qb.$$eval(".mcq-opt.cut", (els) => els.map((e) => e.dataset.i).join());
  check(cutA.split(",").length === 2 && cutA === cutB && !cutA.split(",").includes(String(q.quiz[0].correct)), `the 50:50 removes the same two wrong answers for everyone (${cutA})`);
  check(await qa.$$eval(".mcq-opt.cut", (els) => els.every((e) => e.disabled)), "removed answers can't be picked");
  await qa.screenshot({ path: path.join(OUT, "63-live-quiz-5050.png") });
  for (const pg of [qa, qb]) await pg.click(`.mcq-opt[data-i="${q.quiz[0].correct}"]`);
  await Promise.all([qa.waitForSelector(".lv-reveal", { timeout: 20000 }), qb.waitForSelector(".lv-reveal", { timeout: 20000 })]);
  const qs = await live(qb);
  for (const who of ["Ana", "Ben"]) {
    const a = qs.players.find((p) => p.name === who).ans[0];
    check(a.score === E.liveScore(qs.rules, { base: E.QUIZ_POINTS, ms: a.ms, total: QCLOCK, hinted: a.hint }) && a.score > E.QUIZ_POINTS && a.hint, `${who}: a free 50:50 keeps full points, and speed adds (${a.score})`);
  }
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  console.log("live rules e2e passed");
  await browser.close(); server.close();
})().catch((e) => { console.error(e); if (errors.length) console.error("page errors: " + errors.join(" | ")); process.exit(1); });
