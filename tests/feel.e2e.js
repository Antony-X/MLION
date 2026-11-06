#!/usr/bin/env node
/* Game feel (CONTEXT.md, "Game feel from Nintendo's practice"): node tests/feel.e2e.js
 *   A. hit-stop: a rare landing holds the stage still for a beat (longer the rarer, capped at 300 ms); a common
 *      landing doesn't stop; Reduce motion has none
 *   B. Sprint's coin ladder: each counted answer one note higher, a wrong answer starts the climb again
 *   C. a wrong answer is the soft reject sound; switches, sliders and choice buttons click; hover is silent
 *   D. the streak badge (an ink count of one size centred on the flame, the lion from seven, --font-num, ink on the
 *      gem's gold, the stage avoids it, a miss puts it out), the ball's fire (embers, put out by a miss, under the
 *      numbers) and the gem's lion (under the badge); Reduce motion keeps the badge and the fire still
 *   E. sound comes back after leaving the page: the context is let go when the page hides and rebuilt on the next tap
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

  // ---- D. the streak badge and the ball's fire
  console.log("D. the streak badge and the ball's fire");
  {
    const { ctx, p } = await fresh({ sound: false, reducedMotion: false });
    await p.goto(base + "#daily"); await p.waitForFunction(() => !!window.MLION_STREAK && !!window.MLION_STAGE && window.MLION_STAGE.w > 0);
    const badge = (n, mode) => p.evaluate(([n, mode]) => {
      window.MLION_STREAK(n, mode);
      const el = document.querySelector("#streak"), num = el.querySelector(".sk-n"), S = window.MLION_STAGE;
      const r = el.getBoundingClientRect(), cv = document.querySelector("#descent").getBoundingClientRect();
      const nr = num && num.getBoundingClientRect(), fr = el.querySelector(".flame") && el.querySelector(".flame").getBoundingClientRect();
      const nm = el.querySelector(".sk-name");
      return {
        hidden: el.hidden, text: num && num.textContent, color: num && getComputedStyle(num).color, size: num && getComputedStyle(num).fontSize,
        off: nr && fr ? Math.abs((nr.top + nr.bottom) / 2 - (fr.top + fr.bottom) / 2) : null,
        lion: !!el.querySelector(".fl-core path"), name: nm && nm.textContent, nameColor: nm && getComputedStyle(nm).color,
        pop: el.classList.contains("pop"), sparks: el.querySelectorAll(".sk-spark").length,
        // the camera keeps the path clear of the badge: it is one of the boxes the stage avoids
        avoided: S.rects.some((b) => Math.abs(b.x - (r.left - cv.left)) < 1 && Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1),
      };
    }, [n, mode]);
    const hex = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
    const INK = hex("#f2ede4"), GOLD = hex("#f2b53c"), GOLD_INK = hex("#1a1306");
    let ok = true, sizes = new Set(), off = 0;
    for (const n of [2, 3, 4, 5, 6]) {
      const b = await badge(n, "set");
      ok = ok && !b.hidden && b.text === String(n) && b.color === INK && !b.lion && !b.name && b.avoided;
      sizes.add(b.size); off = Math.max(off, b.off);
    }
    check(ok, "from two in a row the badge shows the count in ink, and the stage avoids it");
    check(sizes.size === 1 && off < 1, `the count keeps one size (${[...sizes].join(", ")}) while the flame grows, centred on it (off by ${off.toFixed(2)} px at most)`);
    const seven = await badge(9, "set");
    check(seven.text === "9" && seven.lion && seven.name === "MLion" && seven.color === INK && seven.nameColor === GOLD, "from seven the flame is gold with the lion in it, and the gold name stands beside the ink count");
    const flood = await p.evaluate(() => {
      const st = document.querySelector("#stage"), el = document.querySelector("#streak");
      st.classList.add("flood");
      const r = [getComputedStyle(el.querySelector(".sk-n")).color, getComputedStyle(el.querySelector(".sk-name")).color];
      st.classList.remove("flood");
      return r;
    });
    check(flood[0] === GOLD_INK && flood[1] === GOLD_INK, "on the gem's gold flood the count and the name turn gold-ink");
    const fam = await p.evaluate(() => {
      const num = document.querySelector("#streak .sk-n"), was = getComputedStyle(num).fontFamily, house = getComputedStyle(document.body).fontFamily;
      document.documentElement.style.setProperty("--font-num", "monospace");
      const now = getComputedStyle(num).fontFamily;
      document.documentElement.style.removeProperty("--font-num");
      return [was, now, house];
    });
    check(fam[0] === fam[2] && fam[1] === "monospace", `the count is set in --font-num when there is one, else the house face (${fam.slice(0, 2).join(" / ")})`);
    const up = await badge(4, "up");
    check(up.pop && up.sparks > 0, "one more in a row pops the badge and throws embers");
    await badge(0, "out");
    await p.waitForTimeout(120);
    check(await p.evaluate(() => { const el = document.querySelector("#streak"); return !el.hidden && el.classList.contains("out") && el.querySelectorAll(".sk-smoke").length === 3; }), "a miss puts it out in a puff of smoke");
    await p.waitForTimeout(800);
    check(await p.evaluate(() => document.querySelector("#streak").hidden && window.MLION_STAGE.rects.length === document.querySelectorAll("#stage .hud, #stage .dots, #stage .play-meta").length), "then the badge is gone and the stage stops avoiding it");

    // the flames stay under the numbers over the stage, on the full stage and on the keyboard strip
    for (const kb of [false, true]) {
      await p.evaluate((kb) => document.documentElement.classList.toggle("kb", kb), kb);
      await p.waitForTimeout(400);
      await badge(7, "set");
      await p.evaluate(() => { window.MLION_STAGE.streak = 7; });
      await p.waitForTimeout(500);
      const room = await p.evaluate(() => {
        const S = window.MLION_STAGE, cv = document.querySelector("#descent").getBoundingClientRect(), r = document.querySelector("#streak").getBoundingClientRect();
        return { tip: S.fx.tip && S.fx.tip.top, under: r.bottom - cv.top, h: S.h };
      });
      check(room.tip != null && room.tip >= room.under, `${kb ? "keyboard strip" : "full stage"}: the fire's tip (${Math.round(room.tip)} px) stays under the badge (${Math.round(room.under)} px)`);
    }
    await p.evaluate(() => document.documentElement.classList.remove("kb"));

    // the gem: the lion grows out of the ball up to the badge and no further
    await badge(4, "set");
    await p.waitForTimeout(300);
    const lion = await p.evaluate(() => new Promise((done) => {
      const S = window.MLION_STAGE, cv = document.querySelector("#descent").getBoundingClientRect();
      S.anim = { from: S.x, to: S.x + 300, tier: "mlion", start: performance.now(), dur: 200, t: 0, done: null };
      setTimeout(() => done({ top: S.flood && S.flood.top, under: document.querySelector("#streak").getBoundingClientRect().bottom - cv.top }), 1400);
    }));
    check(lion.top != null && lion.top >= lion.under, `the gem's lion (top at ${Math.round(lion.top)} px) stays under the badge (${Math.round(lion.under)} px)`);
    await p.waitForFunction(() => !window.MLION_STAGE.flood, null, { timeout: 4000 });

    // the ball's fire on a stage of its own: it sheds embers, and a miss puts it out with smoke
    const fire = (reduce) => p.evaluate((reduce) => new Promise((done) => {
      document.documentElement.classList.toggle("reduce-motion", reduce);
      const cv = document.createElement("canvas");
      cv.style.cssText = "position:fixed;left:0;top:0;width:390px;height:400px;z-index:99";
      document.body.appendChild(cv);
      const d = window.MLION_VISUALS.Descent(cv, {}), S = window.MLION_STAGE;
      d.set([1, 2, 3, 4, 5].map(() => ({ tier: "indist", score: 60 })));
      setTimeout(() => {
        const embers = S.fx.bits.filter((b) => b.kind !== "smoke").length;
        d.roll(null, 0, () => {
          const out = !!S.fx.out, smoke = S.fx.bits.filter((b) => b.kind === "smoke").length;
          d.destroy(); cv.remove(); document.documentElement.classList.remove("reduce-motion");
          done({ embers, out, smoke, streak: S.streak });
        });
      }, 700);
    }), reduce);
    const lit = await fire(false);
    check(lit.embers > 0, `five in a row: the ball's fire sheds embers (${lit.embers} in the air)`);
    check(lit.out && lit.smoke > 0 && lit.streak === 0, "a miss puts the ball's fire out with a puff of smoke");
    const calm = await fire(true);
    check(calm.embers === 0 && !calm.out && calm.smoke === 0, "Reduce motion: the fire is still (no embers, no smoke)");
    await ctx.close();
  }
  {
    const { ctx, p } = await fresh({ sound: false, reducedMotion: true });
    await p.goto(base + "#daily"); await p.waitForFunction(() => !!window.MLION_STREAK && !!window.MLION_STAGE && window.MLION_STAGE.w > 0);
    const still = await p.evaluate(() => {
      window.MLION_STREAK(4, "up");
      const el = document.querySelector("#streak");
      const r = { pop: el.classList.contains("pop"), sparks: el.querySelectorAll(".sk-spark").length, moving: el.getAnimations({ subtree: true }).length };
      window.MLION_STREAK(0, "out");
      r.goneAtOnce = el.hidden;
      return r;
    });
    check(!still.pop && still.sparks === 0 && still.moving === 0 && still.goneAtOnce, "Reduce motion: the badge doesn't pop, flicker or smoke, and a miss takes it away at once");
    await ctx.close();
  }

  // ---- E. sound comes back after leaving the page (user, 2026-11-06: silent after coming back mid-game)
  console.log("E. sound after leaving the page");
  {
    const { ctx, p } = await fresh({ sound: true, haptics: false });
    await p.goto(base + "#prefs"); await p.waitForSelector('input[role="switch"]');
    const state = () => p.evaluate(() => { const c = window.MLION_AUDIO(); return c ? c.state : "none"; });
    await p.mouse.click(5, 5);
    await p.waitForFunction(() => window.MLION_AUDIO() && window.MLION_AUDIO().state === "running", null, { timeout: 3000 });
    check(true, "a tap starts the sound");
    const setVisible = (v) => p.evaluate((v) => {
      Object.defineProperty(document, "visibilityState", { value: v ? "visible" : "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, v);
    await p.evaluate(() => { window.OLD_AUDIO = window.MLION_AUDIO(); });
    await setVisible(false);
    await p.waitForTimeout(100);
    check((await state()) === "none" && (await p.evaluate(() => window.OLD_AUDIO.state)) === "closed", "leaving the page lets the sound go");
    await setVisible(true);
    await p.mouse.click(5, 5);
    await p.waitForFunction(() => window.MLION_AUDIO() && window.MLION_AUDIO().state === "running", null, { timeout: 3000 });
    check(await p.evaluate(() => window.MLION_AUDIO() !== window.OLD_AUDIO), "coming back, the next tap builds it fresh and it plays");
    // a browser that suspends the sound on its own: any later tap or key wakes it (not just the first one)
    await p.evaluate(() => window.MLION_AUDIO().suspend());
    await p.waitForFunction(() => window.MLION_AUDIO().state === "suspended");
    await p.keyboard.press("Shift");
    await p.waitForFunction(() => window.MLION_AUDIO().state === "running", null, { timeout: 3000 });
    check(true, "a suspended sound wakes on the next key");
    await ctx.close();
  }

  check(errs.length === 0, `no page errors${errs.length ? ": " + errs.join(" | ") : ""}`);
  await b.close(); srv.close();
  console.log("feel: all checks passed");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
