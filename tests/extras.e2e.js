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
  await p.goto(base + hash); await p.waitForSelector("#answer, .mcq-opt", { timeout: 15000 }); // solo runs start without an intro
  const intro = await p.textContent("#topbar-mid");
  await p.waitForTimeout(800);
  const saved = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("mlion:run:")).map((k) => JSON.parse(localStorage.getItem(k))));
  const runs = saved.map((r) => r.promptIds);
  const setText = await (async () => { await p.goto(base + "#prefs"); await p.waitForTimeout(300); return p.textContent(".screen"); })();
  await ctx.close(); return { ids: runs[0], run: saved[0], errs, intro, setText };
}
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const ex = (ids) => ids.filter((i) => EXTRA.has(i));
  // Unlimited deals one endless deck per question set: core by default, core plus extras with the switch on
  const E = require(path.join(ROOT, "js/engine.js"));
  const CORE = { version: `${D.version}:core`, packs: D.packs, prompts: D.prompts.filter((p) => !p.extra) };
  const WIDE = { version: `${D.version}:wide`, packs: D.packs, prompts: D.prompts.concat(D.extras) };
  const coreDeck = E.streamIds(CORE, "unlimited-v3:core", 400), wideDeck = E.streamIds(WIDE, "unlimited-v3:wide", 60);
  check(!ex(coreDeck).length && new Set(coreDeck.slice(0, CORE.prompts.length)).size === CORE.prompts.length, "the core deck never deals an extra, and shows every core prompt once before any repeats");
  check(ex(wideDeck).length > 0, "the deck with extras mixes them in");
  let r = await runIds(b, base, "#unlimited-play", { extras: false });
  check(r.run.endless && r.run.pool === "core" && r.ids.join() === coreDeck[0] && !r.errs.length, "Unlimited deals the core deck by default");
  check(/Extra questions/.test(r.setText) && /\d+ more outside the IOAI syllabus/.test(r.setText), "Settings has the Extra questions switch");
  r = await runIds(b, base, "#unlimited-play", { extras: true });
  check(r.run.pool === "wide" && r.ids.join() === wideDeck[0] && !r.errs.length, "with the switch on, Unlimited deals the deck with extras");
  // the Quiz deals the hand-written bank whatever the switch says
  const BANK = new Set(E.quizBank(D).map((q) => q.id));
  for (const extras of [false, true]) {
    r = await runIds(b, base, "#quiz-1", { extras });
    check(r.ids.length === 7 && r.ids.every((id) => BANK.has(id)) && !r.errs.length, `Quiz deals seven bank questions (extras ${extras ? "on" : "off"})`);
  }
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
