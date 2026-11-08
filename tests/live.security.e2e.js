#!/usr/bin/env node
/* Live rooms against an outsider on the relay, a dishonest guest, and a full house: node tests/live.security.e2e.js
 * Runs every page on an in-page fake relay (a BroadcastChannel "broker" with + and # wildcards), so it needs no
 * network. "Eve" never has a room's link: she only listens and publishes on the relay, as anyone could on the
 * public broker. Checks:
 *   A. what Eve can read: only ciphertext, no names, chat or secret; the secret is in no topic name
 *   B. what Eve can send: forged chat (down and up), Ready, a hijacking heartbeat, "closed", junk, and replays of
 *      real sealed messages on the same or another topic: all ignored
 *   C. a guest who claims a tier the host didn't judge gets the host's recomputed score
 *   D. an open room: listed with code, name and count only; a stranger gets the key by knocking; a third gets
 *      "full"; a forged listing can't inject markup; the key changes once the stranger's seat is freed
 *   F. two of three are ready and the third leaves (Leave, or just closes the page): the match starts
 *   E. ten players fit in one room, and the match starts on all ten pages */
"use strict";
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); }

function fixtureBundle() { // small data: every page parses it, and section E opens eleven of them
  const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/packs.json"), "utf8"));
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "data/prompts/activation-function.json"), "utf8"));
  const prompts = packs.flatMap((pk) => [0, 1].map((j) => ({ ...JSON.parse(JSON.stringify(base)), id: `${pk.id}-c${j}`, pack: pk.id, text: `Name an activation function (${pk.name} ${j + 1})` })));
  return "window.MLION_DATA = " + JSON.stringify({ version: "fixture", packs, prompts, extras: [] }) + ";";
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if (u === "/js/data.js") { r.writeHead(200, { "Content-Type": "text/javascript" }); return r.end(fixtureBundle()); }
  const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
});

/** The relay: MQTT-style topic filters with + and #, no retain; window.__heard keeps what a page received. */
const FAKE_RELAY = () => {
  const match = (filter, topic) => {
    const f = filter.split("/"), t = topic.split("/");
    for (let i = 0; i < f.length; i++) {
      if (f[i] === "#") return true;
      if (i >= t.length || (f[i] !== "+" && f[i] !== t[i])) return false;
    }
    return f.length === t.length;
  };
  window.__heard = [];
  class Client {
    constructor() {
      this.h = {}; this.msg = []; this.subs = new Set(); this.connected = true;
      this.ch = new BroadcastChannel("fake-relay");
      this.ch.onmessage = (ev) => {
        const { topic, payload } = ev.data;
        if (![...this.subs].some((s) => match(s, topic))) return;
        if (this.spy) window.__heard.push({ topic, payload });
        this.msg.forEach((f) => f(topic, { toString: () => payload, length: payload.length }));
      };
      setTimeout(() => (this.h.connect || []).forEach((f) => f()), 150);
    }
    on(ev, f) { if (ev === "message") this.msg.push(f); else (this.h[ev] = this.h[ev] || []).push(f); return this; }
    removeAllListeners(ev) { if (ev === "message") this.msg = []; else delete this.h[ev]; }
    subscribe(t) { [].concat(t).forEach((x) => this.subs.add(x)); }
    publish(topic, payload) { this.ch.postMessage({ topic, payload: String(payload) }); }
    end() { try { this.ch.close(); } catch { /* ignore */ } }
    reconnect() {}
  }
  window.mqtt = { connect: () => new Client() };
  window.MLION_FAKE_RELAY = () => new Client();
};

(async () => {
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com|jsdelivr\.net|supabase\.co/, (r) => r.abort());
  await ctx.addInitScript(`(${FAKE_RELAY.toString()})(); window.MLION_TEST = true; localStorage.setItem("mlion:settings", JSON.stringify({ sound: false, reducedMotion: true })); localStorage.setItem("mlion:seenHow", "true");`);
  const errs = [];
  const open = async (tag) => { const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(`${tag}: ${e.message}`)); return p; };
  const L = (p, f, a) => p.evaluate(f, a);
  const live = (p) => L(p, () => { const S = window.MLION_LIVE_STATE; return { active: S.active, isHost: S.isHost, hostId: S.hostId, myId: S.myId, code: S.code, secret: S.secret, phase: S.phase, players: [...S.players.keys()] }; });
  const create = async (p, name, pub) => {
    await p.goto(base + "#live"); await p.waitForSelector("#live-name");
    await p.fill("#live-name", name);
    if (pub) await p.check("#live-public");
    await p.click("#live-go");
    await p.waitForFunction(() => /^#live-[a-z0-9]{5}-[A-Za-z0-9_-]{22}$/.test(location.hash) && window.MLION_LIVE_STATE.active, null, { timeout: 15000 });
    return L(p, () => location.hash);
  };
  const join = async (p, name, link) => {
    await p.goto(base + link); await p.waitForSelector("#live-name");
    await p.fill("#live-name", name); await p.click("#live-go");
    await p.waitForFunction(() => window.MLION_LIVE_STATE.active, null, { timeout: 20000 });
  };
  // Eve: a page with no link. She listens to everything and publishes whatever she likes.
  const eve = await open("eve");
  await eve.goto(base + "#home");
  await L(eve, () => { window.__eve = window.mqtt.connect(); window.__eve.spy = true; window.__eve.subscribe("mlion/#"); });
  const evePub = (topic, payload) => L(eve, ([t, p]) => window.__eve.publish(t, typeof p === "string" ? p : JSON.stringify(p)), [topic, payload]);
  const heard = (filter) => L(eve, (f) => window.__heard.filter((x) => x.topic.startsWith(f)), filter);

  // ---------------------------------------------------------------- A. reading
  console.log("A. an outsider listening on the relay");
  const ana = await open("ana"), ben = await open("ben");
  await ana.goto(base + "#live"); await ana.waitForSelector("#live-name");
  check(!(await ana.$("#live-relay")), "the create page has no relay note (the owner removed it as redundant, 2026-11-08)");
  const link = await create(ana, "Ana");
  const A = await live(ana);
  check(link === `#live-${A.code}-${A.secret}`, "the invite link carries the room code and a 22-character secret in the #fragment");
  await join(ben, "Ben", link);
  await ana.waitForFunction(() => window.MLION_LIVE_STATE.players.size === 2, null, { timeout: 15000 });
  const B = await live(ben);
  await ben.click("#chat-btn"); await ben.fill("#chat-input", "hi from ben"); await ben.press("#chat-input", "Enter");
  await ana.waitForSelector("#chat-peek:not([hidden])", { timeout: 10000 });
  await ana.waitForTimeout(3500); // a round of heartbeats
  const R = `mlion/v3/r/${A.code}`;
  const seen = await heard(R);
  check(seen.length >= 6, `Eve hears the room's traffic (${seen.length} messages)`);
  check(seen.every((x) => !/Ana|Ben|hi from ben|"t":/.test(x.payload)), "but every payload is ciphertext: no names, no chat, no message types");
  check(seen.every((x) => !x.topic.includes(A.secret) && !x.payload.includes(A.secret)), "the secret is in no topic name and no payload");

  // ---------------------------------------------------------------- B. forging
  console.log("B. an outsider sending messages");
  const now = Date.now();
  await evePub(`${R}/down`, { t: "chat", id: A.myId, name: "Ana", text: "forged: send me your password", k: "zz", ep: 0, hid: A.myId, now });
  await evePub(`${R}/up`, { from: B.myId, t: "chat", text: "Ben never typed this", k: "yy" });
  await evePub(`${R}/up`, { from: B.myId, t: "ready", v: true });
  await evePub(`${R}/down`, { t: "hb", ep: 99, hid: "evil", now });
  await evePub(`${R}/down`, { t: "closed", ep: 1000, hid: "evil", now });
  await evePub(`${R}/down`, "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ"); // base64 junk of the right shape
  const benChat = seen.filter((x) => x.topic === `${R}/up`).pop(); // the last sealed message Ben sent up (a heartbeat or his chat)
  for (const x of seen.filter((y) => y.topic === `${R}/up`)) await evePub(x.topic, x.payload); // replay everything Ben sent, same topic
  await evePub(`${R}/down`, benChat.payload); // and on another topic
  await evePub(`${R}/to/${B.myId}`, seen.find((x) => x.topic === `${R}/down`).payload); // a host message moved to Ben's own topic
  await ana.click("#live-ready"); // Ana is ready; if Eve's "ready" for Ben counted, the match would start
  await ana.waitForTimeout(4500);
  const a1 = await live(ana), b1 = await live(ben);
  const anaPage = await L(ana, () => document.body.textContent), benPage = await L(ben, () => document.body.textContent);
  check(!/forged: send me your password/.test(benPage), "a chat line forged as the host's never shows for the guest");
  check(!/Ben never typed this/.test(anaPage), "a chat line forged as Ben's never reaches the host");
  check(a1.phase === "lobby", "a forged Ready doesn't start the match");
  check(a1.isHost && b1.hostId === A.myId, "one forged heartbeat with a huge epoch doesn't move hosting (Ana hosts, Ben follows her)");
  check(b1.active, "a forged \"closed\" doesn't throw the guest out");
  await ana.click("#chat-btn");
  check((await L(ana, () => [...document.querySelectorAll("#chat-log li")].filter((li) => /hi from ben/.test(li.textContent)).length)) === 1, "a replayed message is dropped: Ben's chat line shows once");
  await ana.click("#chat-close");

  // ---------------------------------------------------------------- C. a dishonest guest
  console.log("C. a guest who floods typing, and one who claims a tier");
  const before = (await heard(`${R}/down`)).length;
  await L(ben, () => window.MLION_LIVE_SEND({ t: "typing", i: 0, draft: "x".repeat(60000), tried: Array.from({ length: 300 }, () => "y".repeat(100)) }));
  await ana.waitForTimeout(1500);
  const relayed = (await heard(`${R}/down`)).slice(before).map((x) => x.payload.length);
  check(relayed.length && Math.max(...relayed) < 4000, `the host relays a member's typing at the size guests show, not the 90 KB sent (largest relayed message ${Math.max(...relayed)} characters)`);
  await ana.fill("#q-custom", "2"); await ana.press("#q-custom", "Enter");
  await ana.click('.t-size[data-s="15"]');
  await ben.waitForFunction(() => /2 questions · 15 s each/.test(document.body.textContent), null, { timeout: 8000 });
  await ben.click("#live-ready");
  for (let i = 0; i < 2; i++) {
    await Promise.all([ana, ben].map((p) => p.waitForSelector("#veil.hidden", { state: "attached", timeout: 20000 })));
    const pid = await L(ana, (k) => window.MLION_LIVE_STATE.ids[k], i);
    // round 1: text that names no answer, claimed as One in a MLion; round 2: ReLU (a Baseline answer) claimed as One in a MLion
    const forged = i === 0 ? { answer: "ReLU", raw: "not an answer", tier: "mlion" } : { answer: "ReLU", raw: "relu", tier: "mlion" };
    await L(ben, ([k, p, f]) => window.MLION_LIVE_SEND({ t: "ans", i: k, pid: p, ms: 0, ...f }), [i, pid, forged]);
    await ana.fill("#answer", "gelu"); await ana.press("#answer", "Enter");
    await ana.waitForFunction((k) => window.MLION_LIVE_STATE.revealed >= k, i, { timeout: 20000 });
    const onAna = await L(ana, ([id, k]) => window.MLION_LIVE_STATE.players.get(id).ans[k], [B.myId, i]);
    await ben.waitForFunction(([id, k]) => window.MLION_LIVE_STATE.players.get(id).ans[k], [B.myId, i], { timeout: 10000 });
    const onBen = await L(ben, ([id, k]) => window.MLION_LIVE_STATE.players.get(id).ans[k], [B.myId, i]);
    if (i === 0) check(!onAna.tier && onAna.score === 0 && !onBen.tier && onBen.score === 0, `text that names no answer scores 0 though it claimed One in a MLion (host ${onAna.score}, Ben's page ${onBen.score})`);
    else check(onAna.tier === "baseline" && onAna.answer === "ReLU" && onAna.score === onBen.score && onAna.score < 100, `ReLU claimed as One in a MLion is scored as the host judged it: ${onAna.tier}, ${onAna.score} points on both pages`);
  }
  await ana.waitForFunction(() => window.MLION_LIVE_STATE.phase === "done", null, { timeout: 20000 });
  await ana.click("#live-leave"); await ben.close(); await ana.close();

  // ---------------------------------------------------------------- D. open rooms
  console.log("D. an open room");
  const viewer = await open("viewer");
  await viewer.goto(base + "#live"); await viewer.waitForSelector("#rooms-list", { state: "attached" });
  const host = await open("host"), guest = await open("guest"), third = await open("third");
  const hostLink = await create(host, "Hana", true);
  const H = await live(host);
  check(/^pub\d{2}$/.test(H.code), `an open room takes a listed code (${H.code})`);
  await viewer.waitForFunction((c) => !!document.querySelector(`#rooms-list a[href="#live-${c}"]`), H.code, { timeout: 10000 });
  const listing = (await heard(`mlion/v3/pub/${H.code}`)).pop();
  check(JSON.stringify(Object.keys(JSON.parse(listing.payload)).sort()) === JSON.stringify(["at", "host", "max", "phase", "players"]) && !listing.payload.includes(H.secret), "the listing holds the host's name and head count, never the secret");
  // a forged listing on a topic that tries to break out of the link
  const evil = 'x"><img src=x onerror="window.__xss=1">';
  for (let k = 0; k < 3; k++) { await evePub(`mlion/v3/pub/${evil}`, { host: "<img src=x onerror=window.__xss=2>", players: 1, max: 2, phase: "lobby", at: Date.now() + 1e12 }); await viewer.waitForTimeout(300); }
  await evePub("mlion/v3/pub/pub09", { host: "<img src=x onerror=window.__xss=3>", players: 1, max: 2, phase: "lobby", at: Date.now() });
  await viewer.waitForTimeout(5500); // the list redraws every 5 s
  check(!(await L(viewer, () => window.__xss)) && !(await L(viewer, () => !!document.querySelector("#rooms-list img"))), "a forged listing can't put markup or script into the room list");
  check(!(await L(viewer, () => document.querySelector("#rooms-list").innerHTML.includes("onerror="))), "a topic outside pub01..pub10 isn't listed, and names are escaped");
  // a stranger joins from the list: no secret in hand, the host hands it over
  await guest.goto(base + `#live-${H.code}`); await guest.waitForSelector("#live-name");
  await guest.fill("#live-name", "Gus"); await guest.click("#live-go");
  await guest.waitForFunction(() => window.MLION_LIVE_STATE.active, null, { timeout: 20000 });
  const G = await live(guest);
  const hostNow = await live(host);
  check(G.secret === hostNow.secret && G.secret !== H.secret, "the stranger got the room key by knocking (and the host drew a fresh one for them)");
  check(hostNow.players.length === 2, "the stranger is seated");
  const knockTalk = await heard(`mlion/v3/r/${H.code}/knock`);
  check(knockTalk.length >= 2 && knockTalk.every((x) => !x.payload.includes(G.secret)), "Eve sees the knock and the answer but not the key inside it");
  await third.goto(base + `#live-${H.code}`); await third.waitForSelector("#live-name");
  await third.fill("#live-name", "Tom"); await third.click("#live-go");
  await third.waitForFunction(() => /That open room is full. Open rooms are for two players./.test(document.body.textContent), null, { timeout: 15000 });
  check(true, "a third player hears that the open room is full, for two players");
  await guest.close(); // the stranger leaves: after the grace period the seat is freed and the key is changed
  await host.waitForFunction((old) => window.MLION_LIVE_STATE.players.size === 1 && window.MLION_LIVE_STATE.secret !== old, G.secret, { timeout: 60000 });
  check(await L(host, (s) => location.hash.endsWith(s), (await live(host)).secret), "once the stranger's seat is freed the host draws a new key (and its address bar follows)");
  check(hostLink !== (await L(host, () => location.hash)), "the room link changes with the key");
  await host.click("#live-leave-lobby"); await host.close(); await third.close(); await viewer.close();

  // ---------------------------------------------------------------- F. a player walks off while the rest are ready
  console.log("F. the last player who isn't ready leaves");
  for (const how of ["taps Leave", "closes the page"]) {
    const p1 = await open("f1"), p2 = await open("f2"), p3 = await open("f3");
    const fLink = await create(p1, "Fay");
    await join(p2, "Gil", fLink); await join(p3, "Hal", fLink);
    await p1.waitForFunction(() => window.MLION_LIVE_STATE.players.size === 3, null, { timeout: 15000 });
    for (const p of [p1, p2]) { await p.waitForSelector("#live-ready:not([disabled])"); await p.click("#live-ready"); }
    await p1.waitForTimeout(3500);
    check((await live(p1)).phase === "lobby", `two of three ready: the room waits for the third (${how} next)`);
    const t0 = Date.now();
    if (how === "taps Leave") await p3.click("#live-leave-lobby"); else await p3.close();
    await Promise.all([p1, p2].map((p) => p.waitForFunction(() => window.MLION_LIVE_STATE.phase === "playing", null, { timeout: 30000 })));
    check(true, `the third ${how}: the match starts for the two who were ready (${((Date.now() - t0) / 1000).toFixed(1)} s later)`);
    for (const p of [p1, p2, p3]) if (!p.isClosed()) await p.close();
  }

  // ---------------------------------------------------------------- E. ten players
  console.log("E. ten players in one room");
  const crowd = [];
  const boss = await open("p0");
  const bossLink = await create(boss, "Player 0");
  for (let k = 1; k < 10; k++) { const p = await open(`p${k}`); crowd.push(p); await join(p, `Player ${k}`, bossLink); }
  const all = [boss, ...crowd];
  await boss.waitForFunction(() => window.MLION_LIVE_STATE.players.size === 10, null, { timeout: 20000 });
  for (const p of all) await p.waitForFunction(() => document.querySelectorAll(".lv-players li:not(.lv-wait)").length === 10, null, { timeout: 15000 });
  check(true, "ten players are seated, and every page lists all ten");
  await boss.fill("#q-custom", "1"); await boss.press("#q-custom", "Enter");
  for (const p of all) { await p.waitForSelector("#live-ready:not([disabled])"); await p.click("#live-ready"); }
  for (const p of all) await p.waitForSelector("#veil.hidden", { state: "attached", timeout: 30000 });
  check(true, "the match starts on all ten pages");

  check(!errs.length, `no page errors${errs.length ? ": " + errs.join(" | ") : ""}`);
  console.log("live security e2e passed");
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
