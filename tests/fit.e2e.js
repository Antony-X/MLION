#!/usr/bin/env node
/* Every reasoning question, with all four options, fits a 390 x 844 phone: node tests/fit.e2e.js
 * A live room only ever deals one random question, so this checks all of them. It plays a solo quiz
 * to its first reasoning question, measures it as is (solo), then adds the rows a live match puts on
 * the screen (rival chips, their status, the skip vote) and measures again (live), swapping in each
 * question's text and options. The injected chips are a little shorter than the real ones, so live
 * keeps 20 px in hand. */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

const measure = (p) => p.evaluate(() => {
  const out = [];
  for (const q of window.MLION_DATA.reasoning.filter((r) => !r.retired)) {
    document.querySelector(".rq-text").textContent = q.q;
    document.querySelectorAll(".mcq-opt .mcq-t").forEach((el, i) => { el.textContent = q.options[i]; });
    const opts = [...document.querySelectorAll(".mcq-opt")];
    out.push({ id: q.id, bottom: Math.round(Math.max(...opts.map((e) => e.getBoundingClientRect().bottom + window.scrollY))) });
  }
  return out.sort((a, b) => b.bottom - a.bottom);
});

(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\./, (r) => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify({ sound: false, answerSecs: 60 })); });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base + "#quiz-1");
  for (let k = 0; k < 7; k++) {
    await p.waitForSelector(".mcq-opt:not([disabled])", { timeout: 20000 });
    if (await p.$(".rq-text")) break;
    await p.click(".mcq-opt"); await p.waitForSelector("#next:not([disabled])", { timeout: 20000 }); await p.click("#next");
  }
  check(!!(await p.$(".rq-text")), "quiz run 1 reaches a reasoning question");
  const n = await p.evaluate(() => window.MLION_DATA.reasoning.filter((r) => !r.retired).length);

  const solo = await measure(p);
  check(solo[0].bottom <= 844, `solo: all ${n} fit (worst ${solo[0].id} ends at ${solo[0].bottom} px)`);

  await p.evaluate(() => {
    document.querySelector("#card").insertAdjacentHTML("beforebegin", `<div class="live-strip" id="live-strip"><span>A Ana 120</span><span>B Ben 80</span></div>
      <div class="live-rivals" id="live-rivals"><div><span>B</span><span>Ben</span><span class="rv-typing"><span class="muted">thinking</span></span></div></div>
      <div class="live-skip" id="live-skip"><button type="button" class="btn sm">Vote to skip</button></div>`);
  });
  const live = await measure(p);
  check(live[0].bottom <= 824, `live: all ${n} fit with the rivals' rows below (worst ${live[0].id} ends at ${live[0].bottom} px)`);
  check(!errs.length, "no page errors");
  console.log("fit e2e passed");
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
