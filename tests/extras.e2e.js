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
async function runIds(b, base, hash, { extras, time }) {
  const ctx = await b.newContext(); await ctx.route(/fonts\./, (r) => r.abort());
  await ctx.addInitScript((x) => { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify({ extraQuestions: x })); }, extras);
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
  check(/Extra questions/.test(r.setText) && /Adds \d+ questions outside the IOAI syllabus/.test(r.setText), "Settings has the Extra questions switch");
  r = await runIds(b, base, "#unlimited-1", { extras: true });
  check(r.ids.length === 7 && ex(r.ids).length > 0 && !r.errs.length, "with the switch on, Unlimited mixes extras in");
  r = await runIds(b, base, "#quiz-1", { extras: false });
  check(!ex(r.ids).length && !r.errs.length, "Quiz deals only core questions by default");
  r = await runIds(b, base, "#quiz-1", { extras: true });
  check(r.ids.length === 7 && ex(r.ids).length > 0, "with the switch on, Quiz mixes extras in");
  r = await runIds(b, base, "#daily", { extras: true, time: "2026-11-05T12:00:00" });
  check(r.ids.join() === "sampling-method,retrieval,ml-course,probabilistic-model,training-pathology,sklearn-estimator,cnn-architecture", "dailies before the switch-over keep their questions");
  r = await runIds(b, base, "#daily", { extras: true, time: "2026-11-06T12:00:00" });
  check(r.ids.length === 7 && !ex(r.ids).length, "from 2026-11-06 the daily is core only, even with extras on");
  console.log("extras e2e passed");
  await b.close(); srv.close();
})();
