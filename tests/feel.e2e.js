#!/usr/bin/env node
/* Game feel (CONTEXT.md, "Game feel from Nintendo's practice"): node tests/feel.e2e.js
 *   A. hit-stop: a rare landing holds the stage still for a beat (longer the rarer, capped at 300 ms); a common
 *      landing doesn't stop; Reduce motion has none
 *   B. Sprint's coin ladder: each counted answer one note higher, a wrong answer starts the climb again
 *   C. a wrong answer is the soft reject sound; switches, sliders and choice buttons click; hover is silent
 * Sounds are read from window.MLION_SOUNDS (test builds log every Sound call, even with sound off). */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
const E = require(path.join(ROOT, "js/engine.js"));
global.window = {}; require(path.join(ROOT, "js/data.js")); require(path.join(ROOT, "js/explain.js"));
const D = window.MLION_DATA;
E.setLexicon(D.prompts.concat(D.extras || []));
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

const P = D.prompts.find((p) => p.id === "loss-function");
const exact = P.answers.filter((a) => E.matchAnswer(P, a.a).kind === "exact").slice(0, 5).map((a) => a.a);

(async () => {
  if (exact.length < 5) throw new Error("FAIL: test setup could not find five answers to type");
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const errs = [];
  async function fresh(settings) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await ctx.route(/fonts\./, (r) => r.abort());
    await ctx.addInitScript((s) => { window.MLION_TEST = true; localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify(s)); }, settings);
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return { ctx, p };
  }
  const sounds = (p) => p.evaluate(() => window.MLION_SOUNDS.splice(0));

  // ---- A. hit-stop
  console.log("A. hit-stop");
  {
    const { ctx, p } = await fresh({ sound: false, reducedMotion: false });
    await p.goto(base + "#home"); await p.waitForFunction(() => !!window.MLION_VISUALS);
    /** Roll one answer of this tier on a stage of its own; how long the stage's clock stood still at the landing. */
    const heldFor = (tier) => p.evaluate((tier) => new Promise((done) => {
      const cv = document.createElement("canvas");
      cv.style.cssText = "position:fixed;left:0;top:0;width:390px;height:400px;z-index:99";
      document.body.appendChild(cv);
      const d = window.MLION_VISUALS.Descent(cv, {}), S = window.MLION_STAGE;
      requestAnimationFrame(() => requestAnimationFrame(() => d.roll(tier, 60, () => {
        if (!(S.hold > 0)) { d.destroy(); cv.remove(); done(0); return; } // no hold set at the landing
        const frozen = S.t, t0 = performance.now();
        const watch = () => {
          if (S.t !== frozen || performance.now() - t0 > 1000) { const ms = performance.now() - t0; d.destroy(); cv.remove(); done(Math.round(ms)); }
          else requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      })));
    }), tier);
    // measured from the landing until the stage's clock moves again, which includes about two frames of watching
    const base1 = await heldFor("baseline"), rare = await heldFor("outlier"), legend = await heldFor("mlion");
    check(base1 === 0, "a common landing doesn't stop");
    check(rare >= 70 && rare < 140, `a Rare one holds about 70 ms (${rare} ms measured)`);
    check(legend >= 220 && legend <= 330 && legend > rare + 100, `a Legendary one holds longer, about 220 ms, under the 300 ms cap (${legend} ms measured)`);
    await p.evaluate(() => document.documentElement.classList.add("reduce-motion"));
    const calm = await heldFor("mlion");
    check(calm === 0, "Reduce motion: no hold");
    await ctx.close();
  }

  // ---- B. Sprint's coin ladder
  console.log("B. Sprint's coin ladder");
  {
    const { ctx, p } = await fresh({ sound: false });
    await p.goto(base + "#sprint-loss-function"); await p.waitForSelector("#sp-go");
    await p.click("#sp-go");
    const send = async (s) => { await p.fill("#sp-answer", s); await p.press("#sp-answer", "Enter"); await p.waitForTimeout(60); };
    await sounds(p);
    await send(exact[0]); await send(exact[1]); await send(exact[2]);
    let got = await sounds(p);
    check(got.filter((s) => s[0] === "coin").map((s) => s[1]).join() === "1,2,3", `three answers in a row climb 1, 2, 3 (${got.map((s) => s[0] + (s[1] ?? "")).join(" ")})`);
    check(!got.some((s) => s[0] === "tier"), "Sprint no longer plays the ball's landing sound for each answer");
    await send("banana bread");
    await send(exact[3]); await send(exact[4]);
    got = await sounds(p);
    check(got.map((s) => s[0]).join() === "reject,coin,coin" && got[1][1] === 1 && got[2][1] === 2, "a wrong answer is the soft reject and starts the climb again (1, 2)");
    await ctx.close();
  }

  // ---- C. controls
  console.log("C. controls");
  {
    const { ctx, p } = await fresh({ sound: false, haptics: false });
    await p.goto(base + "#prefs"); await p.waitForSelector('input[role="switch"]');
    await sounds(p);
    await p.hover("label:has(input[role=switch])");
    check((await sounds(p)).length === 0, "hovering is silent");
    const sw = 'input[role="switch"][data-k="previewCorrections"]';
    const was = await p.isChecked(sw);
    await p.click(`label:has(${sw})`);
    await p.click(`label:has(${sw})`);
    const t = (await sounds(p)).filter((s) => s[0] === "toggle").map((s) => s[1]);
    check(t.join() === `${!was},${was}`, `a switch clicks up when turned on and down when turned off (${t.join()})`);
    await p.click(`label:has(${sw})`).catch(() => {});
    await ctx.close();
  }

  // the slider and the choice buttons, in a live room's lobby (no relay needed: the host's page draws it)
  {
    const { ctx, p } = await fresh({ sound: false });
    await p.addInitScript(() => {
      class Client { constructor() { this.connected = true; this.h = {}; setTimeout(() => (this.h.connect || []).forEach((f) => f()), 100); }
        on(ev, f) { (this.h[ev] = this.h[ev] || []).push(f); return this; } removeAllListeners() { return this; }
        subscribe() { return this; } publish() { return this; } end() { return this; } reconnect() { return this; } }
      window.MLION_FAKE_RELAY = () => new Client();
    });
    await p.goto(base + "#live"); await p.waitForSelector("#live-name");
    await p.fill("#live-name", "Ana"); await p.click("#live-go");
    await p.waitForSelector("#lv-assist", { timeout: 15000 });
    await sounds(p);
    await p.focus("#lv-assist"); await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(150);
    const s1 = await sounds(p);
    check(s1.some((s) => s[0] === "step"), "the autocorrect slider ticks as it moves a step");
    await p.click('.lv-fmt[data-f="quiz"]');
    await p.waitForTimeout(150);
    check((await sounds(p)).some((s) => s[0] === "step"), "picking another format ticks");
    await p.click('.lv-fmt[data-f="quiz"]');
    await p.waitForTimeout(150);
    check(!(await sounds(p)).some((s) => s[0] === "step"), "tapping the one already chosen doesn't");
    await ctx.close();
  }

  check(errs.length === 0, `no page errors${errs.length ? ": " + errs.join(" | ") : ""}`);
  await b.close(); srv.close();
  console.log("feel: all checks passed");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
