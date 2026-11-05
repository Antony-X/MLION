#!/usr/bin/env node
/* Core vs extra questions with the real data: node tests/extras.e2e.js */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
global.window = {}; require(path.join(ROOT, "js/data.js"));
const D = window.MLION_DATA; const EXTRA = new Set(D.prompts.filter((p) => p.extra).map((p) => p.id).concat(D.extras.map((p) => p.id)));
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
async function runIds(b, base, hash, { extras, time, launch }) {
  const ctx = await b.newContext(); await ctx.route(/fonts\./, (r) => r.abort());
  await ctx.addInitScript(([x, l]) => { if (l) window.MLION_LAUNCH = l; localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify({ extraQuestions: x })); }, [extras, launch || null]);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  if (time) await p.clock.install({ time: new Date(time) });
  await p.goto(base + hash); await p.waitForSelector("#begin", { timeout: 15000 });
  const intro = await p.textContent(".screen");
  await p.click("#begin"); await p.waitForTimeout(800);
  const runs = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mlion:run:")).map((k) => JSON.parse(localStorage.getItem(k)).promptIds));
  const setText = await (async () => { await p.goto(base + "#prefs"); await p.waitForTimeout(300); return p.textContent(".screen"); })();
  await ctx.close(); return { ids: runs[0], errs, intro, setText };
}
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const ex = (ids) => ids.filter((i) => EXTRA.has(i));
  let r = await runIds(b, base, "#unlimited-1", { extras: false });
  check(!ex(r.ids).length && !r.errs.length, "Unlimited deals only core questions by default");
  check(/Extra questions/.test(r.setText) && /\d+ more outside the IOAI syllabus/.test(r.setText), "Settings has the Extra questions switch");
  r = await runIds(b, base, "#unlimited-1", { extras: true });
  check(r.ids.length === 7 && ex(r.ids).length > 0 && !r.errs.length, "with the switch on, Unlimited mixes extras in");
  r = await runIds(b, base, "#quiz-1", { extras: false });
  check(!ex(r.ids).length && !r.errs.length, "Quiz deals only core questions by default");
  r = await runIds(b, base, "#quiz-1", { extras: true });
  check(r.ids.length === 7 && ex(r.ids).length > 0, "with the switch on, Quiz mixes extras in");
  // the daily: only the hand-picked pool, always. Before launch every day is #1.
  const POOL = new Set(D.daily.pool), WEEK = D.daily.launch, inWeek = (ids) => ids.filter((i) => WEEK.some((d) => d.includes(i)));
  const offPool = (ids) => ids.filter((i) => !POOL.has(i));
  check(POOL.size >= 50 && !ex([...POOL]).length && POOL.has("optimizer") && !POOL.has("retrieval") && !POOL.has("peft"), "the daily pool ships: hand-picked core prompts (optimizers in, RAG and PEFT out)");
  check(WEEK.length === 7 && WEEK.every((d) => d.length === 7) && new Set(WEEK.flat()).size === 49 && !offPool(WEEK.flat()).length, "the launch week ships: seven days of seven pool prompts, none twice");
  const pre1 = await runIds(b, base, "#daily", { extras: true, time: "2026-11-05T12:00:00" });
  const pre2 = await runIds(b, base, "#daily", { extras: true, time: "2026-11-06T12:00:00" });
  for (const [r, d] of [[pre1, "11-05"], [pre2, "11-06"]]) {
    check(r.ids.length === 7 && !offPool(r.ids).length && !r.errs.length, `before launch (${d}) the daily deals only from the pool, even with extras on`);
    check(r.intro.includes("MLion #1"), `before launch (${d}) the daily is MLion #1`);
  }
  check(pre1.ids.join() !== pre2.ids.join(), "before launch each day still gets fresh questions");
  // launch day is #1 and plays the hand-picked week in order; after it, the shuffle starts with what the week didn't use
  r = await runIds(b, base, "#daily", { extras: true, time: "2026-11-10T12:00:00", launch: "2026-11-10" });
  check(r.ids.join() === WEEK[0].join() && r.intro.includes("MLion #1"), "launch day is MLion #1 and deals launch day 1");
  r = await runIds(b, base, "#daily", { extras: true, time: "2026-11-16T12:00:00", launch: "2026-11-10" });
  check(r.ids.join() === WEEK[6].join() && r.intro.includes("MLion #7"), "the seventh day deals launch day 7");
  r = await runIds(b, base, "#daily", { extras: true, time: "2026-11-17T12:00:00", launch: "2026-11-10" });
  check(r.ids.length === 7 && !offPool(r.ids).length && !inWeek(r.ids).length && r.intro.includes("MLion #8"), "day 8 moves on to pool prompts the launch week didn't use");
  console.log("extras e2e passed");
  await b.close(); srv.close();
})();
