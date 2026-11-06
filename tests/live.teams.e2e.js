#!/usr/bin/env node
/* Live rooms with teams (2 v 2 and the like): the host turns teams on, newcomers join the smaller team, players
 * switch sides, the host shuffles, a room all on one side can't start, and a match scores each team as its
 * players' points added up, a smaller team's scaled up to the bigger one's size. Four phones, then three.
 *   node tests/live.teams.e2e.js   (needs public.cloud.shiftr.io) */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
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
const errors = [];
const check = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };
const NAMES = ["Gold", "Blue", "Green", "Rose"];

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch({ proxy });
  const c = "t" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
  async function player(tag, init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript((code) => {
      window.MLION_TEST = true;
      if (code) { window.MLION_LIVE_CODE = code; window.MLION_LIVE_SECRET = code.padEnd(22, "K"); }
      try { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:settings", JSON.stringify({ sound: false })); } catch { /* */ }
    }, init || null);
    return page;
  }
  const teams = (pg) => pg.evaluate(() => Object.fromEntries([...window.MLION_LIVE_STATE.players.values()].map((p) => [p.name, p.team])));
  const sizes = (t) => [0, 1].map((k) => Object.values(t).filter((x) => x === k).length);
  const settle = (pgs, fn, arg, what) => Promise.all(pgs.map((pg) => pg.waitForFunction(fn, arg, { timeout: 15000 }))).then(() => check(true, what));

  // ---- the lobby
  const ana = await player("ana", c);
  await ana.goto(base + "#live");
  await ana.fill("#live-name", "Ana");
  await ana.click("#live-go");
  await ana.waitForSelector(".lv-code", { timeout: 20000 });
  check(await ana.$eval('.lv-teams.on', (b) => b.dataset.k === "0"), "teams start off");
  await ana.click('.lv-teams[data-k="2"]');
  await ana.waitForSelector('.lv-teams.on[data-k="2"]');
  const ben = await player("ben"), cat = await player("cat"), dan = await player("dan");
  for (const [pg, name] of [[ben, "Ben"], [cat, "Cat"], [dan, "Dan"]]) {
    await pg.goto(base + `#live-${c}-${c.padEnd(22, "K")}`);
    await pg.fill("#live-name", name);
    await pg.click("#live-go");
    await pg.waitForSelector(".lv-teampick", { timeout: 40000 });
  }
  const all = [ana, ben, cat, dan];
  await settle(all, () => document.querySelectorAll(".lv-players li:not(.lv-tm-head):not(.lv-wait)").length === 4, null, "four players in the room");
  let t = await teams(dan);
  check(t.Ana === 0 && t.Ben === 1 && t.Cat === 0 && t.Dan === 1, `newcomers join the smaller team (${JSON.stringify(t)})`);
  check(/4 players here, 2 v 2/.test(await dan.textContent(".page-head")) && (await dan.$$(".lv-tm-head")).length === 2, "every phone shows the teams and the matchup");
  check(!(await ben.$(".lv-teams")) && /2 teams: a team scores/.test(await ben.textContent(".screen")), "only the host picks the number of teams; guests are told");
  await ana.screenshot({ path: path.join(OUT, "70-live-teams-lobby.png"), fullPage: true });

  await ben.click('.lv-team[data-t="0"]');
  await settle(all, () => /3 v 1/.test(document.querySelector(".page-head").textContent), null, "a player switches sides and every phone sees 3 v 1");
  await dan.click('.lv-team[data-t="0"]');
  await settle(all, () => /one team/.test(document.body.textContent), null, "all on one side: the room says someone has to switch");
  for (const pg of all) await pg.click("#live-ready");
  await ana.waitForTimeout(4500);
  check(await ana.evaluate(() => window.MLION_LIVE_STATE.phase === "lobby"), "and it doesn't start, even with everyone ready");
  for (const pg of all) await pg.click("#live-ready"); // not ready again, so the shuffle doesn't start the match
  await ana.waitForFunction(() => [...window.MLION_LIVE_STATE.players.values()].every((p) => !p.ready), null, { timeout: 10000 });
  await ana.click("#lv-shuffle");
  await settle(all, () => /2 v 2/.test(document.querySelector(".page-head").textContent), null, "Shuffle teams deals everyone out evenly");
  t = await teams(cat);
  check(sizes(t).join() === "2,2", `two on each side (${JSON.stringify(t)})`);

  // Dan leaves: 2 v 1, the case where the smaller team's points are scaled up
  await dan.click("#live-leave-lobby");
  await dan.waitForTimeout(1000); // the "leave" goes out before the page closes
  await dan.context().close();
  const three = [ana, ben, cat];
  await settle(three, () => document.querySelectorAll(".lv-players li:not(.lv-tm-head):not(.lv-wait)").length === 3, null, "Dan leaves");
  await ana.fill("#q-custom", "2");
  await ana.press("#q-custom", "Enter");
  await settle([ben, cat], () => /2 questions ·/.test(document.body.textContent), null, "the host sets two questions");
  for (const pg of three) { await pg.waitForSelector("#live-ready.primary:not([disabled])", { timeout: 10000 }); await pg.click("#live-ready"); }

  // ---- the match: everyone answers; the strip and the reveal show the teams
  let st0 = null;
  for (let i = 0; i < 2; i++) {
    for (const pg of three) await pg.waitForSelector("#veil.hidden", { state: "attached", timeout: 30000 });
    if (!st0) st0 = await ana.evaluate(() => ({ mt: window.MLION_LIVE_STATE.mteam }));
    const ids = await ana.evaluate(() => window.MLION_LIVE_STATE.ids.slice());
    const p = PROMPT.get(ids[i]);
    if (i === 0) {
      const strip = await ana.$$eval("#live-strip .tm-sum b", (els) => els.map((e) => e.textContent));
      check(strip.length === 2 && strip.every((x) => ["Gold", "Blue"].includes(x)), `the strip leads with the team totals (${strip.join(", ")})`);
    }
    for (const [k, pg] of three.entries()) { await pg.fill("#answer", p.answers[k].a); await pg.press("#answer", "Enter"); }
    await Promise.all(three.map((pg) => pg.waitForSelector(".lv-reveal .lv-tstand", { timeout: 25000 })));
    if (i === 0) {
      check((await cat.$$(".lv-tstand li")).length === 2, "the reveal puts team standings above the players'");
      await cat.screenshot({ path: path.join(OUT, "71-live-teams-reveal.png"), fullPage: true });
    }
  }
  await Promise.all(three.map((pg) => pg.waitForSelector(".lv-tpodium", { timeout: 30000 })));

  // ---- the end: team totals add up (scaled for 2 v 1), the winner, the rematch picker, nothing off the screen
  const per = Object.fromEntries(await ana.$$eval(".lv-ppodium li", (els) => els.map((li) => [li.querySelector(".nm b").textContent, +li.querySelector("em").textContent])));
  const id2name = await ana.evaluate(() => Object.fromEntries([...window.MLION_LIVE_STATE.players.values()].map((p) => [p.id, p.name])));
  const members = [0, 1].map((k) => Object.keys(st0.mt).filter((id) => st0.mt[id] === k).map((id) => id2name[id]));
  const big = Math.max(...members.map((m) => m.length));
  const want = members.map((m) => Math.round(m.reduce((s, n) => s + per[n], 0) * big / m.length));
  const rows = await ana.$$eval(".lv-tpodium li", (els) => els.map((li) => ({ name: li.querySelector(".nm b").textContent, total: +li.querySelector("em").textContent })));
  for (const r of rows) {
    const k = NAMES.indexOf(r.name);
    check(r.total === want[k], `${r.name} (${members[k].join(" + ")}): ${r.total}${members[k].length < big ? `, scaled ×${big / members[k].length}` : ""}`);
  }
  const winner = want[0] === want[1] ? "It's a tie" : `Team ${NAMES[want[0] > want[1] ? 0 : 1]} wins`;
  for (const pg of three) check((await pg.textContent("h1")) === winner, `${await pg.evaluate(() => [...window.MLION_LIVE_STATE.players.values()].find((p) => p.id === window.MLION_LIVE_STATE.myId).name)} sees "${winner}"`);
  check(/Uneven teams/.test(await ben.textContent(".screen")), "the end says uneven teams were evened out");
  check(!!(await ben.$(".lv-rematch-teams .lv-team")), "players can switch sides for the rematch");
  for (const pg of three) check(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing runs off a 390 px phone");
  // a long match (user's iPhone, 10 questions: the row of tier marks ran out of its card): 25 marks wrap inside it
  const fits = await ana.evaluate(() => {
    const row = document.querySelector(".lv-ppodium .tiers"), one = row.firstElementChild;
    while (row.children.length < 25) row.appendChild(one.cloneNode(true));
    const li = row.closest("li").getBoundingClientRect(), r = row.getBoundingClientRect();
    return r.right <= li.right && li.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth && r.height > 30;
  });
  check(fits, "25 tier marks wrap inside their card instead of running off the screen");
  await ana.screenshot({ path: path.join(OUT, "72-live-teams-podium.png"), fullPage: true });

  // after a match the host can go back to the lobby to change settings; everyone follows, nobody ready
  check(!!(await ana.$("#live-settings")) && !(await ben.$("#live-settings")), "only the host gets Change settings on the podium");
  await ben.click("#live-ready"); // a guest who was already ready for the rematch
  await ana.waitForFunction(() => [...window.MLION_LIVE_STATE.players.values()].some((p) => p.name === "Ben" && p.ready), null, { timeout: 8000 });
  await ana.click("#live-settings");
  await Promise.all(three.map((pg) => pg.waitForSelector(".lv-code", { timeout: 15000 })));
  check(!!(await ana.$(".lv-fmt")) && !(await ana.$(".lv-podium")), "Change settings takes the host back to the lobby's settings");
  check(await ben.evaluate(() => window.MLION_LIVE_STATE.phase === "lobby" && [...window.MLION_LIVE_STATE.players.values()].every((p) => !p.ready)), "the guests follow, and nobody is ready");
  await ana.click('.lv-fmt[data-f="quiz"]');
  await cat.waitForFunction(() => /Quiz format/.test(document.body.textContent), null, { timeout: 8000 });
  check(true, "the host can now switch the format for the next match");
  for (const pg of three) await pg.context().close();

  // ---- a Sprint room with teams (a minute shortened to 8 s): team totals in the strip, the reveal and the end
  const c2 = "s" + c.slice(1);
  const sprinter = async (tag, code) => { const pg = await player(tag, code); await pg.addInitScript(() => { window.MLION_SPRINT_TEST = { secs: 8, reveal: 3000 }; }); return pg; };
  const sa = await sprinter("sa", c2), sb = await sprinter("sb");
  await sa.goto(base + "#live"); await sa.fill("#live-name", "Ana"); await sa.click("#live-go");
  await sa.waitForSelector(".lv-code", { timeout: 20000 });
  await sa.click('.lv-teams[data-k="2"]');
  await sa.click('.lv-fmt[data-f="sprint"]');
  await sa.fill("#q-custom", "1"); await sa.press("#q-custom", "Enter");
  await sb.goto(base + `#live-${c2}-${c2.padEnd(22, "K")}`); await sb.fill("#live-name", "Ben"); await sb.click("#live-go");
  await sa.waitForFunction(() => /1 v 1/.test(document.querySelector(".page-head").textContent), null, { timeout: 40000 });
  for (const pg of [sa, sb]) { await pg.waitForSelector("#live-ready.primary:not([disabled])", { timeout: 10000 }); await pg.click("#live-ready"); }
  await Promise.all([sa, sb].map((pg) => pg.waitForSelector("#sp-answer:not([disabled])", { timeout: 40000 })));
  const sp = PROMPT.get(await sa.evaluate(() => window.MLION_LIVE_STATE.ids[0]));
  for (const [k, pg] of [sa, sb].entries()) for (const a of sp.answers.slice(3 * k, 3 * k + 2 + k)) { await pg.fill("#sp-answer", a.a); await pg.press("#sp-answer", "Enter"); }
  await sa.waitForFunction(() => document.querySelectorAll("#sp-strip .tm-sum").length === 2, null, { timeout: 8000 });
  check(true, "the sprint strip leads with the two team totals");
  await Promise.all([sa, sb].map((pg) => pg.waitForSelector(".sp-reveal .lv-tstand", { timeout: 30000 })));
  check(true, "the sprint reveal shows team standings");
  await Promise.all([sa, sb].map((pg) => pg.waitForSelector(".lv-tpodium", { timeout: 30000 })));
  const spPer = Object.fromEntries(await sb.$$eval(".lv-ppodium li", (els) => els.map((li) => [li.querySelector(".nm b").textContent, +li.querySelector("em").textContent])));
  const spTeams = await sb.$$eval(".lv-tpodium li", (els) => els.map((li) => [li.querySelector(".nm-t").textContent, +li.querySelector("em").textContent]));
  check(spTeams.length === 2 && spTeams.every(([who, pts]) => spPer[who] === pts) && spPer.Ana > 0 && spPer.Ben > 0, `a sprint team's total is its player's (${JSON.stringify(spTeams)})`);
  await sb.screenshot({ path: path.join(OUT, "73-live-teams-sprint-podium.png"), fullPage: true });

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  console.log("live teams e2e passed");
  await browser.close(); server.close();
})().catch((e) => { console.error(e); if (errors.length) console.error("page errors: " + errors.join(" | ")); process.exit(1); });
