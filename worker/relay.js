// MLion's own live relay (user, 2026-11-06: "would this be free, if better you can do it"). It replaces the public
// MQTT broker that live rooms used to talk through, keeping the same little publish/subscribe model, so the game
// code didn't change: a page subscribes to topics, publishes to a topic, and everyone subscribed gets it.
//
// One Durable Object ("hub") holds every connection. Live rooms are small (a few players, a few messages a
// second), so one object is plenty, and with one object the free plan's duration allowance can't run out: an
// object is billed at most 24 hours a day, which is under the 13,000 GB-s a day it includes. It uses the WebSocket
// Hibernation API, so it sleeps (unbilled) while nobody is talking, with every socket still open; pings are
// answered by the runtime without waking it. Each socket's subscriptions and will ride on the socket itself
// (serializeAttachment), so they survive the object sleeping.
//
// Everything that matters is sealed by the pages before it gets here (the room key never reaches this server);
// the relay only sees topic names and opaque text. It stores nothing: retained messages (the open-room
// listings) live in memory. They are refreshed by their hosts every 3 seconds, and pages ignore a listing
// older than 45 seconds, so one lost when the object sleeps comes back on the host's next refresh.
//
// Frames are JSON arrays. Page to relay:
//   ["s", [topic filters]]            subscribe: exact topics, or "mlion/<v>/pub/+" for every open-room listing
//   ["u", [topic filters]]            unsubscribe
//   ["p", topic, payload, retain]     publish (retain 1: keep it for later subscribers; "" clears it)
//   ["w", topic, payload, retain]     the will: published for this socket if it drops without saying bye
//   ["b"]                             bye: leaving on purpose, so no will
//   "ping"                            answered "pong" (keepalive)
// Relay to page: ["m", topic, payload]. Like an MQTT 3.1.1 broker, a page gets its own messages back on topics
// it is subscribed to.
import { DurableObject } from "cloudflare:workers";

const TOPIC_RE = /^mlion\/[A-Za-z0-9_-]{1,16}(\/[A-Za-z0-9_-]{1,40}){1,6}$/; // what pages publish and subscribe to
const LISTINGS_RE = /^mlion\/[A-Za-z0-9_-]{1,16}\/pub\/\+$/; // the one wildcard: every open-room listing
const RETAIN_RE = /^mlion\/[A-Za-z0-9_-]{1,16}\/pub\/[A-Za-z0-9_-]{1,16}$/; // only the open-room listings are kept
// No other wildcard is allowed, so listening to a room takes its code (and reading it takes its secret).
const filterOk = (f) => typeof f === "string" && (TOPIC_RE.test(f) || LISTINGS_RE.test(f));
export const LIMITS = {
  sockets: 600, // in all
  perIp: 40, // from one address (a school or a family shares one)
  subs: 24, // filters per socket
  payload: 256 * 1024, // characters in one message
  retained: 64, // listings kept
  retainedPayload: 2048,
  rate: 25, // messages a second per socket, on average...
  burst: 150, // ...with this much to spare
};

/** Does an MQTT topic filter match a topic? */
export function topicMatch(filter, topic) {
  if (filter === topic) return true;
  const f = filter.split("/"), t = topic.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (i >= t.length || (f[i] !== "+" && f[i] !== t[i])) return false;
  }
  return f.length === t.length;
}

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = new Map(); // socket -> { subs: string[], will: [topic, payload, retain] | null }, cached from its attachment
    this.retained = new Map(); // topic -> payload
    this.buckets = new Map(); // socket -> { tokens, at } for the rate limit (losing it while asleep is fine)
    this.gone = new WeakSet(); // sockets already dropped (close and error can both arrive)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    if (this.ctx.getWebSockets().length >= LIMITS.sockets) return new Response("Busy", { status: 503 });
    if (this.ctx.getWebSockets(`ip:${ip}`).length >= LIMITS.perIp) return new Response("Too many connections", { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`ip:${ip}`]);
    const st = { subs: [], will: null };
    server.serializeAttachment(st);
    this.state.set(server, st);
    return new Response(null, { status: 101, webSocket: client });
  }

  stateOf(ws) {
    let st = this.state.get(ws);
    if (!st) {
      st = ws.deserializeAttachment() || { subs: [], will: null };
      this.state.set(ws, st);
    }
    return st;
  }

  save(ws, st) {
    this.state.set(ws, st);
    try { ws.serializeAttachment(st); } catch { /* too big can't happen within LIMITS.subs; keep the cached copy */ }
  }

  /** The rate limit: true when this socket may send another message now. */
  allow(ws) {
    const now = Date.now();
    const b = this.buckets.get(ws) || { tokens: LIMITS.burst, at: now };
    b.tokens = Math.min(LIMITS.burst, b.tokens + ((now - b.at) / 1000) * LIMITS.rate);
    b.at = now;
    this.buckets.set(ws, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  webSocketMessage(ws, data) {
    if (typeof data !== "string") return ws.close(1003, "Text frames only");
    if (data === "ping") return ws.send("pong"); // the runtime answers these itself; this is in case it didn't
    if (data.length > LIMITS.payload + 512) return ws.close(1009, "Too big");
    if (!this.allow(ws)) {
      if ((this.buckets.get(ws) || {}).tokens < -LIMITS.burst) return ws.close(1008, "Too fast");
      this.buckets.get(ws).tokens -= 1; // keep counting: a socket that never slows down gets closed
      return;
    }
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!Array.isArray(m)) return;
    const [kind, a, b, c] = m;
    if (kind === "p") return this.publish(a, b, c === 1);
    if (kind === "s") return this.subscribe(ws, a);
    if (kind === "u") return this.unsubscribe(ws, a);
    if (kind === "w") return this.setWill(ws, a, b, c === 1);
    if (kind === "b") { const st = this.stateOf(ws); st.will = null; this.save(ws, st); }
  }

  publish(topic, payload, retain) {
    if (typeof topic !== "string" || !TOPIC_RE.test(topic) || typeof payload !== "string" || payload.length > LIMITS.payload) return;
    if (retain && RETAIN_RE.test(topic) && payload.length <= LIMITS.retainedPayload) {
      if (!payload) this.retained.delete(topic);
      else if (this.retained.has(topic) || this.retained.size < LIMITS.retained) this.retained.set(topic, payload);
    }
    const frame = JSON.stringify(["m", topic, payload]);
    for (const ws of this.ctx.getWebSockets()) {
      if (this.gone.has(ws)) continue;
      if (this.stateOf(ws).subs.some((f) => topicMatch(f, topic))) {
        try { ws.send(frame); } catch { /* closing */ }
      }
    }
  }

  subscribe(ws, filters) {
    if (!Array.isArray(filters)) return;
    const st = this.stateOf(ws);
    const fresh = filters.filter(filterOk);
    for (const f of fresh) if (!st.subs.includes(f) && st.subs.length < LIMITS.subs) st.subs.push(f);
    this.save(ws, st);
    // like a broker: a new subscription gets what is retained on it (sent again on a repeat subscribe, as MQTT does)
    for (const [topic, payload] of this.retained) {
      if (fresh.some((f) => st.subs.includes(f) && topicMatch(f, topic))) {
        try { ws.send(JSON.stringify(["m", topic, payload])); } catch { /* closing */ }
      }
    }
  }

  unsubscribe(ws, filters) {
    if (!Array.isArray(filters)) return;
    const st = this.stateOf(ws);
    st.subs = st.subs.filter((f) => !filters.includes(f));
    this.save(ws, st);
  }

  setWill(ws, topic, payload, retain) {
    if (typeof topic !== "string" || !TOPIC_RE.test(topic) || typeof payload !== "string" || payload.length > LIMITS.retainedPayload) return;
    const st = this.stateOf(ws);
    st.will = [topic, payload, retain ? 1 : 0];
    this.save(ws, st);
  }

  /** A socket is gone: forget it, and publish its will if it had one (it didn't say bye). */
  drop(ws) {
    if (this.gone.has(ws)) return;
    this.gone.add(ws);
    const st = this.stateOf(ws);
    this.state.delete(ws);
    this.buckets.delete(ws);
    if (st.will) this.publish(st.will[0], st.will[1], st.will[2] === 1);
  }

  webSocketClose(ws, code, reason) {
    this.drop(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
  }

  webSocketError(ws) {
    this.drop(ws);
  }
}

/** The Worker's side: send a page's WebSocket to the hub, if the page is ours. (Under `wrangler dev` a request
 *  looks as if it came to mlion.lol, and an Origin of the dev server itself is rewritten to match, which is how
 *  tests/relay-dev.js presents its pages.) */
export function relayFetch(request, env) {
  let from = "";
  try { from = new URL(request.headers.get("Origin") || "").hostname; } catch { from = ""; }
  if (from !== "mlion.lol" && from !== "www.mlion.lol") return new Response("Not allowed", { status: 403 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
  return env.RELAY.get(env.RELAY.idFromName("hub")).fetch(request);
}
