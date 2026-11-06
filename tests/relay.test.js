#!/usr/bin/env node
/* The live relay (worker/relay.js) on its own: who may connect, publish/subscribe with MQTT filters, retained
 * listings, wills, bye, junk topics, ping, and the rate limit. Runs against a local `wrangler dev` (started here,
 * or the one in MLION_RELAY_DEV).  node tests/relay.test.js */
"use strict";
const { startRelay } = require("./relay-dev");

const check = (c, msg) => { if (!c) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const relay = await startRelay();
  const url = relay.url; // ws://127.0.0.1:<port>/relay
  const ORIGIN = new URL(url).origin.replace(/^ws/, "http");

  function open(origin) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, origin === "none" ? {} : { headers: { Origin: origin || ORIGIN } });
      const got = [];
      ws.got = got;
      ws.closed = null;
      ws.addEventListener("message", (e) => { got.push(e.data === "pong" ? "pong" : JSON.parse(e.data)); });
      ws.addEventListener("close", (e) => { ws.closed = e.code; });
      ws.addEventListener("open", () => resolve(ws), { once: true });
      ws.addEventListener("error", () => reject(new Error("refused")), { once: true });
    });
  }
  const send = (ws, f) => ws.send(typeof f === "string" ? f : JSON.stringify(f));
  const msgs = (ws, topic) => ws.got.filter((m) => Array.isArray(m) && m[0] === "m" && (!topic || m[1] === topic));

  try {
    // who may connect
    let refused = false;
    try { await open("https://evil.example"); } catch { refused = true; }
    check(refused, "a page from another site can't connect");
    refused = false;
    try { await open("none"); } catch { refused = true; }
    check(refused, "nor can a client that sends no origin");

    // publish and subscribe
    const a = await open(), b = await open();
    send(a, ["s", ["mlion/v3/r/abc/down", "mlion/v3/r/abc/to/a1"]]);
    send(b, ["s", ["mlion/v3/r/abc/up", "mlion/v3/r/abc/down"]]);
    await sleep(150);
    send(b, ["p", "mlion/v3/r/abc/down", "hello from b", 0]);
    send(b, ["p", "mlion/v3/r/abc/to/a1", "just for a", 0]);
    send(b, ["p", "mlion/v3/r/zzz/down", "another room", 0]);
    await sleep(300);
    check(msgs(a, "mlion/v3/r/abc/down").map((m) => m[2]).join() === "hello from b", "a subscriber gets a message on its topic");
    check(msgs(a, "mlion/v3/r/abc/to/a1").length === 1 && !msgs(a, "mlion/v3/r/zzz/down").length, "and only on its topics");
    check(msgs(b, "mlion/v3/r/abc/down").length === 1, "the sender gets its own message back, as from an MQTT broker");

    // order is kept
    for (let i = 0; i < 40; i++) send(b, ["p", "mlion/v3/r/abc/down", `n${i}`, 0]);
    await sleep(500);
    const seq = msgs(a, "mlion/v3/r/abc/down").slice(1).map((m) => m[2]);
    check(seq.length === 40 && seq.every((x, i) => x === `n${i}`), "40 messages in a row arrive in order");

    // retained listings and the + filter
    send(a, ["p", "mlion/v3/pub/pub01", JSON.stringify({ host: "Ana", at: 1 }), 1]);
    send(a, ["p", "mlion/v3/pub/pub02", JSON.stringify({ host: "Ben", at: 2 }), 1]);
    send(a, ["p", "mlion/v3/r/abc/down", "not kept", 1]); // retain only works for listings
    await sleep(200);
    const c = await open();
    send(c, ["s", ["mlion/v3/pub/+"]]);
    await sleep(250);
    check(msgs(c).map((m) => m[1]).sort().join() === "mlion/v3/pub/pub01,mlion/v3/pub/pub02", "a new subscriber to pub/+ gets the retained listings at once");
    send(a, ["p", "mlion/v3/pub/pub01", "", 1]);
    await sleep(200);
    check(msgs(c, "mlion/v3/pub/pub01").slice(-1)[0][2] === "", "clearing a listing reaches the watchers as an empty message");
    const d = await open();
    send(d, ["s", ["mlion/v3/pub/+", "mlion/v3/r/abc/down"]]);
    await sleep(250);
    check(msgs(d).map((m) => m[1]).join() === "mlion/v3/pub/pub02", "and a cleared listing is no longer retained (nor is a room message)");

    // wills
    const h = await open();
    send(h, ["w", "mlion/v3/pub/pub02", "", 1]);
    await sleep(100);
    h.close();
    await sleep(400);
    check(msgs(c, "mlion/v3/pub/pub02").slice(-1)[0][2] === "", "a socket that drops publishes its will");
    const h2 = await open();
    send(h2, ["p", "mlion/v3/pub/pub03", JSON.stringify({ host: "Cy", at: 3 }), 1]);
    send(h2, ["w", "mlion/v3/pub/pub03", "", 1]);
    send(h2, ["b"]);
    await sleep(100);
    h2.close();
    await sleep(400);
    check(msgs(c, "mlion/v3/pub/pub03").length === 1, "one that says bye first doesn't");

    // junk is ignored, the socket stays usable
    const before = msgs(c).length;
    send(c, "not json");
    send(c, ["p", "other/app/topic", "x", 0]);
    send(c, ["p", "mlion/v3/pub/+", "wildcards can't be published to", 1]);
    send(c, ["s", ["#", "other/#", "mlion/v3/a#b", "mlion/v3/r/#", "mlion/v3/r/+/down"]]); // only the listings' + is allowed
    send(b, ["p", "mlion/v3/r/abc/down", "eavesdrop?", 0]);
    send(c, ["p", "mlion/v3/pub/pub04", 42, 1]);
    await sleep(250);
    check(msgs(c).length === before && c.readyState === 1, "junk frames, other apps' topics, wildcard publishes and room wildcards are ignored");
    send(c, "ping");
    await sleep(200);
    check(c.got.includes("pong"), "ping gets pong");

    // the rate limit: a socket that floods is cut off; normal ones carry on
    const f = await open();
    for (let i = 0; i < 400; i++) send(f, ["p", "mlion/v3/r/abc/down", `flood${i}`, 0]);
    await sleep(800);
    const flood = msgs(a, "mlion/v3/r/abc/down").filter((m) => m[2].startsWith("flood")).length;
    check(flood >= 140 && flood < 320, `a flood is cut down to about the burst (${flood} of 400 got through)`);
    check(f.closed === 1008, "and a socket that keeps flooding is closed");
    send(b, ["p", "mlion/v3/r/abc/down", "still here", 0]);
    await sleep(200);
    check(msgs(a, "mlion/v3/r/abc/down").slice(-1)[0][2] === "still here", "the others carry on");

    for (const ws of [a, b, c, d]) ws.close();
    console.log("relay: all checks passed");
  } finally {
    await relay.stop();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
