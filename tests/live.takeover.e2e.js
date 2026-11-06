#!/usr/bin/env node
/* A live Sprint host goes quiet, a guest takes over, the old host comes back: node tests/live.takeover.e2e.js
 * Runs two pages on an in-page fake relay (BroadcastChannel), so it needs no network and the host's
 * silence is exact: while window.__blackout is set its page neither sends nor hears anything.
 * The old host must rejoin the same match as a guest, its answers from before the silence must count,
 * and both pages must end with the same standings. */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });

/** Stands in for the relay's client: every page of the context shares one BroadcastChannel "broker". */
const FAKE_RELAY = () => {
  class Client {
    constructor() {
      this.h = {}; this.msg = []; this.subs = new Set(); this.connected = true;
      this.ch = new BroadcastChannel("fake-relay");
      this.ch.onmessage = (ev) => {
        if (window.__blackout) return;
        const { topic, payload } = ev.data;
        if (this.subs.has(topic)) this.msg.forEach((f) => f(topic, { toString: () => payload, length: payload.length }));
      };
      setTimeout(() => (this.h.connect || []).forEach((f) => f()), 300);
    }
    on(ev, f) { if (ev === "message") this.msg.push(f); else (this.h[ev] = this.h[ev] || []).push(f); return this; }
    removeAllListeners(ev) { if (ev === "message") this.msg = []; else delete this.h[ev]; }
    subscribe(t) { [].concat(t).forEach((x) => this.subs.add(x)); }
    publish(topic, payload) { if (!window.__blackout) this.ch.postMessage({ topic, payload: String(payload) }); }
    end() { try { this.ch.close(); } catch { /* ignore */ } }
    reconnect() {}
  }
  window.mqtt = { connect: () => new Client() };
  window.MLION_FAKE_RELAY = () => new Client();
};

(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(`(${FAKE_RELAY.toString()})(); window.MLION_TEST = true; window.MLION_SPRINT_TEST = { secs: 30, reveal: 4000 }; localStorage.setItem("mlion:settings", JSON.stringify({ sound: false }));`);
  const errs = [];
  const page = async (tag) => { const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(`${tag}: ${e.message}`)); return p; };
  const ana = await page("Ana"), ben = await page("Ben");
  const state = (p) => p.evaluate(() => { const L = window.MLION_LIVE_STATE; return { isHost: L.isHost, phase: L.phase, mfmt: L.mfmt, revealed: L.revealed, players: [...L.players.keys()], gone: [...L.gone.keys()] }; });
  const answersFor = (p, i, from, k) => p.evaluate(([i, from, k]) => { const L = window.MLION_LIVE_STATE; const q = window.MLION_DATA.prompts.find((x) => x.id === L.ids[i]); return q.answers.slice(from, from + k).map((a) => a.a); }, [i, from, k]);
  const type = async (p, list) => { for (const s of list) { await p.fill("#sp-answer", s); await p.press("#sp-answer", "Enter"); await p.waitForTimeout(250); } };

  await ana.goto(base + "#live"); await ana.waitForSelector("#live-name");
  await ana.fill("#live-name", "Ana"); await ana.click("#live-go");
  await ana.waitForFunction(() => window.MLION_LIVE_STATE && window.MLION_LIVE_STATE.active && window.MLION_LIVE_STATE.code, null, { timeout: 15000 });
  await ana.waitForFunction(() => /^#live-[a-z0-9]{5}-[A-Za-z0-9_-]{22}$/.test(location.hash), null, { timeout: 15000 });
  const link = await ana.evaluate(() => location.hash); // the invite link: room code and secret
  await ben.goto(base + link); await ben.waitForSelector("#live-name");
  await ben.fill("#live-name", "Ben"); await ben.click("#live-go");
  await ana.waitForSelector('.lv-fmt[data-f="sprint"]', { timeout: 15000 });
  await ana.click('.lv-fmt[data-f="sprint"]');
  await ana.fill("#q-custom", "2"); await ana.press("#q-custom", "Tab"); await ana.waitForTimeout(300);
  await ana.click("#live-ready"); await ben.click("#live-ready");
  await ana.waitForSelector("#sp-answer:not([disabled])", { timeout: 30000 });

  const anaWords = await answersFor(ana, 0, 5, 2);
  await type(ana, anaWords);
  await ana.evaluate(() => { window.__blackout = true; }); // Ana's page goes silent mid-sprint
  await ben.waitForFunction(() => window.MLION_LIVE_STATE.isHost, null, { timeout: 30000 });
  check(true, "Ben takes over the room while Ana is silent");
  const benWords = await answersFor(ben, 0, 0, 3);
  await type(ben, benWords);

  await ana.evaluate(() => { window.__blackout = false; }); // Ana is back, still inside sprint 1
  await ana.waitForFunction(() => !window.MLION_LIVE_STATE.isHost && window.MLION_LIVE_STATE.active && window.MLION_LIVE_STATE.mfmt === "sprint", null, { timeout: 20000 });
  await ana.waitForFunction(() => /You're back/.test(document.querySelector("#app").textContent), null, { timeout: 10000 });
  check(true, "Ana rejoins the same Sprint match as a guest and waits for the next sprint");

  await ana.waitForFunction(() => window.MLION_LIVE_STATE.revealed >= 0 && document.querySelector("#sp-answer:not([disabled])"), null, { timeout: 60000 });
  const mid = await state(ana);
  check(mid.players.length === 2 && !mid.gone.length, `in sprint 2 Ana's page still seats both players (${mid.players.length} seated, ${mid.gone.length} gone)`);

  await Promise.all([ana, ben].map((p) => p.waitForFunction(() => window.MLION_LIVE_STATE.phase === "done" && document.querySelector(".lv-podium"), null, { timeout: 60000 })));
  const podium = (p) => p.evaluate(() => [...document.querySelectorAll(".lv-podium li")].map((li) => `${li.querySelector(".nm b").textContent}:${li.querySelector("em").textContent}:${li.querySelector(".nm-t").textContent}`).join(" | "));
  const [pa, pb] = [await podium(ana), await podium(ben)];
  check(pa === pb, `both pages show the same standings (${pa})`);
  check(/Ben:\d+:3 answers/.test(pa) && /Ana:\d+:2 answers/.test(pa), "Ben's answers after the takeover and Ana's from before her silence both count");
  const [ha, hb] = [await ana.textContent("h1"), await ben.textContent("h1")];
  check(ha === hb, `both pages name the same winner (${ha})`);
  check(!errs.length, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
  console.log("live takeover e2e passed");
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
