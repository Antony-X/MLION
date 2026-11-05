#!/usr/bin/env node
/* Live Sprint match, two browsers over the real MQTT relay: the host picks the Sprint format in the lobby,
 * both players type as many answers as they can on the same clock, each sees the other's count and points
 * tick up while the answers stay hidden, the round ends on the clock, the reveal marks an answer both named,
 * a player who leaves mid-round keeps the points they had sent, and the totals are the sum of tier points.
 *   node tests/live.sprint.e2e.js   (needs unpkg.com and public.cloud.shiftr.io)
 * The minute is shortened to 8 s through window.MLION_SPRINT_TEST (honoured only with window.MLION_TEST). */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const E = require("../js/engine.js");
global.window = {};
require(path.join(ROOT, "js", "data.js"));
const DATA = global.window.MLION_DATA;
const PROMPT = new Map(DATA.prompts.map((p) => [p.id, p]));
const T = E.TIERS;
const CLOCK = 8, REVEAL_MS = 4000;
const BONUS = { baseline: 1, overfit: 2, indist: 3, outlier: 4, longtail: 5, mlion: 8 }; // seconds an answer adds to its player's clock
const added = (list) => list.reduce((s, a) => s + BONUS[a.t], 0);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const check = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };

/** What each player types for a prompt, with the points it is worth: one answer both name, then two only Ana names and two only Ben names. */
function plan(P) {
  const text = P.text.toLowerCase();
  const shared = P.answers.find((a) => a.t === "baseline");
  // names must not already be on the screen, or "hidden" proves nothing; rarer ones first so the points differ
  const pool = P.answers.filter((a) => a !== shared && a.a.length >= 5 && !text.includes(a.a.toLowerCase()) && a.t !== "mlion")
    .sort((a, b) => T[b.t].score - T[a.t].score);
  assert(pool.length >= 4, `${P.id} has too few answers to type`);
  const ana = [shared, pool[0], pool[2]], ben = [shared, pool[1], pool[3]];
  const pts = (list) => list.reduce((s, a) => s + T[a.t].score, 0);
  return { shared, ana, ben, anaPts: pts(ana), benPts: pts(ben), pts };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy });
  const errors = [];
  const forced = "s" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  async function player(tag, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript(([code, clock, reveal]) => {
      window.MLION_TEST = true;
      window.MLION_SPRINT_TEST = { secs: clock, reveal };
      if (code) window.MLION_LIVE_CODE = code;
      try { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify({ sound: false })); } catch { /* */ }
    }, [init || null, CLOCK, REVEAL_MS]);
    return page;
  }
  const ana = await player("ana", forced), ben = await player("ben");
  const state = (pg) => pg.evaluate(() => {
    const L = window.MLION_LIVE_STATE;
    return { seed: L.seed, ids: (L.ids || []).slice(), fmt: L.mfmt, n: L.n, myId: L.myId, revealed: L.revealed };
  });
  const open = (pg) => pg.waitForSelector("#sp-answer:not([disabled])", { timeout: 40000 });
  const type = async (pg, name) => { await pg.fill("#sp-answer", name); await pg.press("#sp-answer", "Enter"); };
  /** The other player's pill in this page's strip: their answers and points so far. */
  const rival = (pg) => pg.$eval("#sp-strip .lp:not(.me)", (e) => ({ name: e.querySelector("b").textContent, n: +e.querySelector(".sp-ct").textContent, pts: +e.querySelector("em").textContent }));
  const rivalIs = (pg, n, pts) => pg.waitForFunction(([n, pts]) => { const e = document.querySelector("#sp-strip .lp:not(.me)"); return !!e && +e.querySelector(".sp-ct").textContent === n && +e.querySelector("em").textContent === pts; }, [n, pts], { timeout: 12000 });
  const standings = (pg) => pg.$$eval(".lv-standings li", (els) => els.map((e) => `${e.querySelector("b").textContent} ${e.querySelector("em").textContent}`).sort().join(", "));
  const chipNames = (pg, who) => pg.$$eval(".sp-players > li", (els, who) => { const li = els.find((e) => e.querySelector(".sp-ph b").textContent === who); return li ? [...li.querySelectorAll(".sp-chips li span")].map((s) => s.textContent) : null; }, who);

  // ---- lobby: the host picks the format next to topics and count; the clock and autocorrect settings go
  await ana.goto(base + "#live");
  await ana.fill("#live-name", "Ana");
  await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 20000 });
  await ben.goto(base + `#live-${forced}`);
  await ben.fill("#live-name", "Ben");
  await ben.click("#live-go");
  await ana.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 2, null, { timeout: 40000 });
  check((await ana.$$eval(".lv-fmt", (els) => els.map((e) => e.textContent.trim()).join(","))) === "Classic,Quiz,Sprint", "the host's lobby offers Classic, Quiz and Sprint");
  check(!!(await ana.$(".t-size")) && !!(await ana.$(".lv-assist")), "Classic still shows its clock and autocorrect settings");
  await ana.click('.lv-fmt[data-f="sprint"]');
  check(!(await ana.$(".t-size")) && !(await ana.$(".lv-assist")), "Sprint hides the time-per-question and autocorrect pickers");
  check(!!(await ana.$(".lv-topic")) && !!(await ana.$("#live-norepeat")), "topics and the no-repeat box stay");
  check((await ana.textContent(".vs-field:has(#q-custom) > span")).trim() === "Sprints", "the count picker is labelled Sprints");
  check((await state(ana)).n === 3, "a sprint match defaults to 3 prompts, not Classic's 7");
  await ana.fill("#q-custom", "2");
  await ana.press("#q-custom", "Enter");
  await ben.waitForFunction(() => /picks the settings. 2 sprints of 60 s · Sprint format/.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "the guest sees: 2 sprints of 60 s · Sprint format");
  await ana.click('.lv-fmt[data-f="quiz"]');
  check((await state(ana)).n === 7, "going back to Quiz brings back the count the host had there (7)");
  await ana.click('.lv-fmt[data-f="sprint"]');
  check((await state(ana)).n === 2, "and Sprint remembers its own count (2)");
  await ana.click('.lv-topic[data-p="classic"]');
  await ben.waitForFunction(() => /picks the settings. 2 sprints of 60 s · Classical ML · Sprint format/.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "a topic shows in the guest's line too: 2 sprints of 60 s · Classical ML · Sprint format");
  await ana.screenshot({ path: path.join(OUT, "60-live-sprint-lobby.png"), fullPage: true });
  for (const pg of [ana, ben]) { await pg.waitForSelector("#live-ready:not([disabled])"); await pg.click("#live-ready"); }

  // ---- sprint 1: same prompt, both type, each watches the other's tally
  await Promise.all([open(ana), open(ben)]);
  const t0 = Date.now();
  const s0 = await state(ana), b0 = await state(ben);
  check(s0.fmt === "sprint" && s0.n === 2 && new Set(s0.ids).size === 2 && JSON.stringify(s0.ids) === JSON.stringify(b0.ids), "a two-prompt Sprint match with the same two prompts on both pages");
  check(s0.ids.every((id) => PROMPT.get(id) && PROMPT.get(id).answers.length >= 40 && !PROMPT.get(id).extra && PROMPT.get(id).pack === "classic"), "the host picked prompts with enough answers, from the core set and the chosen topic");
  const P0 = PROMPT.get(s0.ids[0]), A0 = plan(P0);
  check((await ana.textContent("#sprint .prompt-text")).includes(P0.text) && (await ben.textContent("#sprint .prompt-text")).includes(P0.text), "both players see the same prompt");
  check((await ana.textContent("#sp-secs")).trim() !== "" && parseFloat(await ana.textContent("#sp-secs")) <= CLOCK, "the clock runs from the test's short minute");
  await ana.screenshot({ path: path.join(OUT, "61-live-sprint-round.png") });

  await type(ana, A0.ana[0].a);
  await rivalIs(ben, 1, T[A0.ana[0].t].score);
  check(true, `Ben sees Ana's first answer arrive: 1 answer, ${T[A0.ana[0].t].score} points`);
  await type(ben, A0.ben[0].a);
  await rivalIs(ana, 1, T[A0.ben[0].t].score);
  check(true, "Ana sees Ben's first answer arrive too");
  await type(ana, A0.ana[1].a);
  await rivalIs(ben, 2, T[A0.ana[0].t].score + T[A0.ana[1].t].score);
  check(true, "Ben's strip ticks up to 2 answers when Ana names another");
  check(!(await ben.textContent("#sprint")).toLowerCase().includes(A0.ana[1].a.toLowerCase()), "the rival's answers themselves are not shown while the round runs");
  await type(ana, "zzzz not a thing");
  await type(ana, A0.ana[1].a); // already counted
  await ana.waitForFunction(() => /Already counted/.test(document.querySelector("#status").textContent));
  check((await rival(ana)).n === 1 && (await ana.textContent("#sp-n")) === "2", "a miss and a repeat don't count");
  await ben.waitForTimeout(600);
  check((await rival(ben)).n === 2, "and they don't reach the rival's strip either");
  // chat can't carry an answer to the other player while the sprint runs
  await ben.click("#chat-btn");
  await ben.fill("#chat-input", A0.ana[1].a);
  await ben.press("#chat-input", "Enter");
  check((await ben.textContent("#chat-note")).includes("answers this question"), "a chat message naming an answer of the open prompt waits for the reveal");
  await ben.press("#chat-input", "Escape");
  // a forged list and a forged tally are ignored by the host
  const benId = b0.myId;
  await ben.evaluate(({ code }) => {
    const L = window.MLION_LIVE_STATE, up = `mlion/v2/r/${code}/up`;
    L.client.publish(up, JSON.stringify({ from: L.myId, t: "spp", i: 0, n: 1, pts: 99999 }));
    L.client.publish(up, JSON.stringify({ from: L.myId, t: "spans", i: 0, list: [99999] }));
    L.client.publish(up, JSON.stringify({ from: L.myId, t: "spans", i: 0, list: [0, 0] }));
  }, { code: forced });
  await ana.waitForTimeout(1500);
  check(await ana.evaluate((id) => { const p = window.MLION_LIVE_STATE.players.get(id); return !p.ans[0] && (!p.sp || !p.sp[0] || p.sp[0].pts < 1000); }, benId), "the host ignores a tally above the maximum and a list with an unknown or repeated answer");
  await type(ben, A0.ben[1].a);
  await rivalIs(ana, 2, T[A0.ben[0].t].score + T[A0.ben[1].t].score);
  check(true, "Ben's second answer shows on Ana's strip");
  await type(ben, A0.ben[2].a);
  await type(ana, A0.ana[2].a);
  await rivalIs(ana, 3, A0.benPts);
  await rivalIs(ben, 3, A0.anaPts);
  check(true, `both finish typing: the strips read 3 answers, Ana ${A0.anaPts} points and Ben ${A0.benPts}`);
  const extra0 = Math.max(added(A0.ana), added(A0.ben));
  check(await ana.evaluate(() => { const L = window.MLION_LIVE_STATE; const p = [...L.players.values()].find((x) => x.id !== L.myId); return p.sp[0].b; }) === added(A0.ben) * 1000, `the host knows how much time Ben's answers added (${added(A0.ben)} s)`);
  await ana.screenshot({ path: path.join(OUT, "62-live-sprint-rival.png") });

  // ---- the clock ends the round; nobody presses anything
  await Promise.all([ana.waitForSelector(".sp-reveal", { timeout: 40000 }), ben.waitForSelector(".sp-reveal", { timeout: 40000 })]);
  const took = (Date.now() - t0) / 1000;
  check(took >= CLOCK + extra0 - 1 && took < CLOCK + extra0 + 7, `the round ended when the longest clock ran out: the reveal came ${took.toFixed(1)} s after the box opened (clock ${CLOCK} s, plus up to ${extra0} s the answers added)`);
  check(await ana.evaluate(() => document.querySelector("#sp-answer") === null), "the answer box is gone at the reveal");
  const names = (list) => list.map((a) => a.a).sort();
  check(JSON.stringify((await chipNames(ben, "Ana")).sort()) === JSON.stringify(names(A0.ana)) && JSON.stringify((await chipNames(ana, "Ben")).sort()) === JSON.stringify(names(A0.ben)), "the reveal lists each player's answers on both pages");
  for (const pg of [ana, ben]) {
    const marked = await pg.$$eval(".sp-chips li.shared", (els) => els.map((e) => ({ name: e.querySelector("span").textContent, tag: e.querySelector("i").textContent })));
    check(marked.length === 2 && marked.every((m) => m.name === A0.shared.a && m.tag === "×2"), `the answer both named ("${A0.shared.a}") is marked ×2 on each list, and nothing else is`);
  }
  const pts1 = await ben.$$eval(".sp-players > li", (els) => Object.fromEntries(els.map((e) => [e.querySelector(".sp-ph b").textContent, +e.querySelector(".sp-ph em").textContent])));
  check(pts1.Ana === A0.anaPts && pts1.Ben === A0.benPts, `round points are the tier points of what each typed (Ana ${A0.anaPts}, Ben ${A0.benPts})`);
  check((await standings(ben)) === `Ana ${A0.anaPts}, Ben ${A0.benPts}`, "standings after sprint 1 match");
  check(/Sprint 2 of 2 starts in \d+ s/.test(await ana.textContent("#sp-next")), "the reveal counts down to the next sprint");
  await ben.screenshot({ path: path.join(OUT, "63-live-sprint-reveal.png"), fullPage: true });

  // ---- sprint 2: Ben types two answers, then drops out; the round must still end, and he keeps what he sent
  await Promise.all([open(ana), open(ben)]);
  const s1 = await state(ana);
  const P1 = PROMPT.get(s1.ids[1]), A1 = plan(P1);
  check(s1.ids[1] !== s1.ids[0] && s1.revealed === 0, "the second prompt is a different one");
  await type(ben, A1.ben[0].a);
  await type(ben, A1.ben[1].a);
  const benR2 = T[A1.ben[0].t].score + T[A1.ben[1].t].score;
  await rivalIs(ana, 2, benR2);
  await ben.evaluate(() => { location.hash = "#home"; });
  check(true, "Ben sent 2 answers, then left the room");
  for (const a of A1.ana) await type(ana, a.a);
  const anaR2 = A1.anaPts;
  await ana.waitForFunction(() => /Waiting for Ben/.test((document.querySelector("#sp-wait") || {}).textContent || ""), null, { timeout: (CLOCK + added(A1.ana)) * 1000 + 8000 });
  check(true, "when Ana's clock ends she is told it is waiting for Ben");
  await ana.waitForSelector(".sp-reveal", { timeout: 30000 });
  check(true, "the round doesn't hang on a player who vanished: the host revealed on its own");
  const rows2 = await ana.$$eval(".sp-players > li", (els) => Object.fromEntries(els.map((e) => [e.querySelector(".sp-ph b").textContent, { pts: +e.querySelector(".sp-ph em").textContent, text: e.textContent }])));
  check(rows2.Ben && rows2.Ben.pts === benR2 && /still count/.test(rows2.Ben.text), `Ben keeps the ${benR2} points he had sent, and his row says his list never arrived`);
  check(rows2.Ana.pts === anaR2, `Ana's sprint 2 is ${anaR2}`);
  check((await standings(ana)) === `Ana ${A0.anaPts + anaR2}, Ben ${A0.benPts + benR2}`, "standings add the two sprints");

  // ---- podium: totals are the sum of tier points
  await ana.waitForSelector(".lv-podium", { timeout: 30000 });
  const total = { Ana: A0.anaPts + anaR2, Ben: A0.benPts + benR2 };
  const podium = async () => ana.$$eval(".lv-podium li", (els) => els.map((e) => ({ name: e.querySelector(".nm b").textContent, pts: +e.querySelector("em").textContent, sub: e.querySelector(".nm-t").textContent })));
  let pod = await podium();
  const winner = total.Ana >= total.Ben ? "Ana" : "Ben";
  check(pod.length === 2 && pod.every((r) => r.pts === total[r.name]), `final totals are the sum of tier points (Ana ${total.Ana}, Ben ${total.Ben})`);
  check(pod[0].name === winner || total.Ana === total.Ben, `the podium orders them by points (${pod.map((r) => r.name).join(", ")})`);
  check(/answers/.test(pod[0].sub), "each podium row says how many answers they named");
  check((await ana.$$(".lv-recap .rc")).length === 2 && (await ana.$$(".lv-recap .sp-players")).length === 2, "the recap lists both sprints with everyone's answers");
  check(!!(await ana.$("#live-ready")), "the Ready for rematch flow is there");
  const used = await ana.evaluate(() => JSON.parse(localStorage.getItem("mlion:liveUsed")));
  check(s0.ids.every((id) => used.includes(id)), "no-repeat questions: the match's prompts are remembered for next time");
  await ana.screenshot({ path: path.join(OUT, "64-live-sprint-podium.png"), fullPage: true });
  // Ben's seat is freed after a while; he stays on the podium with the points he scored
  await ana.waitForFunction((id) => window.MLION_LIVE_STATE.gone.has(id), benId, { timeout: 60000 });
  pod = await podium();
  check(pod.length === 2 && pod.find((r) => r.name === "Ben").pts === total.Ben && /\bleft$/.test(pod.find((r) => r.name === "Ben").sub), `once his seat is freed, Ben stays on the podium marked as having left (${JSON.stringify(pod)})`);

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  server.close();
  console.log("live sprint e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
