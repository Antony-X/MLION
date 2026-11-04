/* MLion — app shell, round state machine and screens. */
(function () {
  "use strict";
  const E = window.MLION_ENGINE;
  const V = window.MLION_VISUALS;
  const DATA = window.MLION_DATA;
  const EXTRAS = DATA.extras || []; // off-topic prompts: practice only, never in a run
  const PROMPTS = new Map(DATA.prompts.concat(EXTRAS).map((p) => [p.id, p]));
  const PACKS = new Map(DATA.packs.map((p) => [p.id, p]));
  const T = E.TIERS;
  const REPO_URL = "https://github.com/Antony-X/MLION";

  const app = document.getElementById("app");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString("en-US");

  // ------------------------------------------------- presentation helpers
  const G = (t, cls) => V.glyph(t && T[t] ? t : null, cls);
  const tierOf = (t) => (t && T[t] ? t : "miss");
  /** The share grid as marks: one per prompt, shaped and lit by its tier. */
  const tiersRow = (tiers, cls = "") => `<span class="tiers ${cls}" role="img" aria-label="${esc(tiers.map((t) => (T[t] ? T[t].name : "Miss")).join(", "))}">${tiers.map((t) => G(t)).join("")}</span>`;
  const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
  const LOCK = `<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
  const XICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  /** What the page backdrop shows: the full surface at home, a horizon elsewhere. */
  function scene(view, opts) { document.body.dataset.view = view; if (V.scene) V.scene(view, opts); }
  /** The six tiers, each set as deep as it scores. */
  function depthList() {
    const order = E.TIERS_BY_SCORE.slice().reverse();
    return `<ol class="depths" aria-label="Rarity tiers">${order.map((t, i) => `<li class="t-${t.id}" style="--d:${(i / (order.length - 1)).toFixed(2)}">${G(t.id)}<span class="n">${esc(t.name)}</span><span class="p">+${t.score}</span></li>`).join("")}</ol>`;
  }

  // ------------------------------------------------------------ storage
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("mlion:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("mlion:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem("mlion:" + k); } catch { /* ignore */ } },
  };
  const sysReduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const DEFAULTS = { previewCorrections: true, clearRejected: false, sound: true, reducedMotion: sysReduced, shareLink: true, aiCheck: true };
  let settings = Object.assign({}, DEFAULTS, LS.get("settings", {}));
  function applySettings() { document.documentElement.classList.toggle("reduce-motion", !!settings.reducedMotion); }
  function saveSettings() { LS.set("settings", settings); applySettings(); }
  applySettings();

  let records = LS.get("records", {}); // run key -> finished record
  let seen = new Set(LS.get("seen", [])); // prompt ids the player has answered
  let practiceBest = LS.get("practice", {}); // prompt id -> best tier
  function saveRecord(rec) { records[rec.key] = rec; LS.set("records", records); }
  function markSeen(id) { if (!seen.has(id)) { seen.add(id); LS.set("seen", [...seen]); } }

  // -------------------------------------------------------------- sound
  const Sound = (() => {
    let ctx = null;
    function ac() {
      if (!settings.sound) return null;
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function tone(freq, dur, o = {}) {
      const c = ac(); if (!c) return;
      const t0 = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * o.slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.06, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    const SEQ = {
      baseline: [392], overfit: [415, 392, 415], indist: [440, 554],
      outlier: [440, 554, 659], longtail: [440, 554, 659, 880], mlion: [523, 659, 784, 1047, 1319],
    };
    return {
      unlock() { ac(); },
      tick() { tone(1250, 0.045, { type: "square", vol: 0.02 }); },
      reject() { tone(180, 0.2, { type: "sawtooth", vol: 0.04, slide: 0.7 }); },
      submit() { tone(520, 0.09, { type: "triangle", vol: 0.04, slide: 1.6 }); },
      miss() { tone(320, 0.55, { type: "triangle", vol: 0.06, slide: 0.35 }); },
      tier(t) {
        (SEQ[t] || SEQ.baseline).forEach((f, i) => tone(f, 0.24, { type: t === "mlion" ? "triangle" : "sine", vol: 0.06, delay: i * 0.085 }));
        if (t === "mlion") tone(2093, 0.7, { vol: 0.025, delay: 0.46 });
      },
    };
  })();
  document.addEventListener("pointerdown", () => Sound.unlock(), { once: true });

  // ------------------------------------------------- Claude answer check
  // Where the page runs inside a Claude viewer, a miss the local matcher can't
  // place is sent to Claude with the prompt's answer list. Claude may only pick
  // a listed answer, and the player still confirms it. Elsewhere it's absent.
  const AI = { sample: null, perms: null, state: "unavailable" };
  (async () => {
    if (!window.claude || typeof window.claude.use !== "function") return;
    try {
      const [sample, perms] = await Promise.all([window.claude.use("sample"), window.claude.use("permissions").catch(() => null)]);
      if (!sample) return;
      AI.sample = sample; AI.perms = perms;
      AI.state = perms ? await perms.state("sample") : "prompt";
      if (AI.state === "unavailable") AI.sample = null;
    } catch { AI.state = "unavailable"; }
    const s = document.getElementById("ai-setting");
    if (s) s.hidden = !aiUsable();
  })();
  const aiUsable = () => !!AI.sample && AI.state !== "denied" && AI.state !== "unavailable";
  async function aiConsentUpFront() {
    if (!settings.aiCheck || !aiUsable() || AI.state !== "prompt" || !AI.perms) return;
    try { const r = await AI.perms.request(["sample"]); AI.state = (r && r.sample) || AI.state; } catch { /* ask lazily instead */ }
  }
  async function aiResolve(p, raw, signal) {
    const list = p.answers.map((a) => (a.aka && a.aka.length ? `${a.a} (${a.aka.slice(0, 3).join(", ")})` : a.a)).join("\n");
    const input = `You check answers for MLion, a machine-learning trivia game.

Prompt: "${p.text}"${p.note ? ` (${p.note})` : ""}
The player typed: "${raw}"

Accepted answers, one per line (canonical name, then aliases in parentheses):
${list}

Did the player mean exactly one of these accepted answers? Count misspellings, partial or alternate names, nicknames, different version formatting, translations, or a description that clearly identifies one specific listed answer. If the text names something that is not in the list, could be several answers, or is too vague, reply null.

Reply with only JSON: {"match": "<canonical name exactly as written in the list>"} or {"match": null}`;
    const res = await AI.sample.json(input, { modelTier: "quick", signal });
    const name = res && typeof res.match === "string" ? res.match.trim() : "";
    if (!name) return null;
    return p.answers.find((a) => a.a === name) || p.answers.find((a) => E.fullKey(a.a) === E.fullKey(name)) || null;
  }

  // ------------------------------------------------------------- helpers
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function setMid(text) { $("#topbar-mid").textContent = text || ""; }
  function today() { return E.localDateString(); }
  function todayNumber() { return Math.max(1, E.dayNumberFor(today())); }
  function prettyDate(ds, opts = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
    const [y, m, d] = ds.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", opts);
  }
  function hhmmss(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  }
  let screenTimers = [];
  function every(ms, fn) { const id = setInterval(fn, ms); screenTimers.push(id); return id; }
  function clearScreenTimers() { screenTimers.forEach(clearInterval); screenTimers = []; }
  async function copyText(text) {
    try { if (!navigator.clipboard) throw new Error("no clipboard"); await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:0;top:0;opacity:0;font-size:16px";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove(); return ok;
    }
  }
  function siteUrl() { return /^https?:/.test(location.protocol) ? location.origin + location.pathname : ""; }

  // ---------------------------------------------------------------- stats
  function dailyRecords() { return Object.values(records).filter((r) => r.mode === "daily").sort((a, b) => a.date.localeCompare(b.date)); }
  function streaks() {
    const dates = new Set(dailyRecords().map((r) => r.date));
    let cur = 0;
    let d = dates.has(today()) ? today() : E.addDays(today(), -1);
    while (dates.has(d)) { cur++; d = E.addDays(d, -1); }
    let max = 0, run = 0, prev = null;
    for (const r of dailyRecords()) {
      run = prev && E.addDays(prev, 1) === r.date ? run + 1 : 1;
      max = Math.max(max, run); prev = r.date;
    }
    return { cur, max };
  }
  function statsSummary() {
    const ds = dailyRecords();
    const all = Object.values(records);
    const best = ds.reduce((m, r) => Math.max(m, r.score), 0);
    const avg = ds.length ? Math.round(ds.reduce((s, r) => s + r.score, 0) / ds.length) : 0;
    const tierCounts = Object.fromEntries([...E.TIER_IDS, "miss"].map((t) => [t, 0]));
    for (const r of all) for (const x of r.results) tierCounts[x.tier || "miss"]++;
    const bands = E.BANDS.map((b) => ({ ...b, n: 0 }));
    for (const r of ds) bands[E.BANDS.indexOf(E.bandFor(r.score))].n++;
    return { played: ds.length, best, avg, ...streaks(), tierCounts, bands, gems: tierCounts.mlion, allRuns: all.length };
  }

  // ----------------------------------------------------------- run specs
  function dailySpec(date) {
    const n = E.dayNumberFor(date);
    return { key: `daily:${date}`, mode: "daily", number: n, date, label: `MLion #${n}`, promptIds: E.dailyPromptIds(DATA, n) };
  }
  function archiveSpec(date) {
    const n = E.dayNumberFor(date);
    return { key: `archive:${date}`, mode: "archive", number: n, date, label: `Archive #${n}`, promptIds: E.dailyPromptIds(DATA, n) };
  }
  function unlimitedSpec(n) {
    return { key: `unlimited:${n}`, mode: "unlimited", number: n, label: `Unlimited #${n}`, promptIds: E.unlimitedPromptIds(DATA, n) };
  }
  function packSpec(packId, n) {
    const pk = PACKS.get(packId);
    return { key: `pack:${packId}:${n}`, mode: "pack", pack: packId, number: n, label: `${pk.name} #${n}`, promptIds: E.packPromptIds(DATA, packId, n) };
  }
  function practiceSpec(promptId) {
    return { key: `practice:${promptId}`, mode: "practice", number: 1, label: "Practice", promptIds: [promptId] };
  }
  function nextUnlimited() { let n = 1; while (records[`unlimited:${n}`]) n++; return n; }
  function nextPackRun(packId) { let n = 1; while (records[`pack:${packId}:${n}`]) n++; return n; }

  // ----------------------------------------------------------- challenges
  // A challenge travels entirely in its link, so friends need no account and
  // no server: #vs-<seed>-<n>[-<tiers>-<name>][-<tiers>-<name>]. Tiers are one
  // digit per question, names are UTF-8 hex (links allow only a-z, 0-9, -).
  const TIER_CODE = ["miss", "baseline", "overfit", "indist", "outlier", "longtail", "mlion"];
  const VS_SIZES = [3, 5, 7, 10];
  const SHARE_BASE = ((document.querySelector('meta[name="mlion:url"]') || {}).content || "").trim();
  const encTiers = (tiers) => tiers.map((t) => Math.max(0, TIER_CODE.indexOf(t || "miss"))).join("");
  const decTiers = (str) => str.split("").map((c) => TIER_CODE[+c] || "miss");
  const encName = (name) => [...new TextEncoder().encode(String(name || "").slice(0, 16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  function decName(hex) {
    try { return new TextDecoder().decode(new Uint8Array((hex.match(/../g) || []).map((h) => parseInt(h, 16)))).trim(); } catch { return ""; }
  }
  const tierPoints = (tiers) => tiers.reduce((sum, t) => sum + (T[t] ? T[t].score : 0), 0);
  const myName = () => String(LS.get("name", "") || "").slice(0, 16);
  function challengePromptIds(seed, n) { return E.makeStream(DATA, `vs-${seed}`).take(n); }
  function challengeLink(seed, n, players) {
    const tail = players.map((pl) => `-${encTiers(pl.tiers)}-${encName(pl.name)}`).join("");
    return `${SHARE_BASE || siteUrl()}#vs-${seed}-${n}${tail}`;
  }
  function parseChallenge(h) {
    const m = h.match(/^vs-([a-z0-9]{4,12})-(\d{1,2})((?:-[0-6]{1,10}-[0-9a-f]{0,64}){0,2})$/);
    if (!m) return null;
    const n = +m[2];
    if (!VS_SIZES.includes(n)) return null;
    const parts = m[3].split("-").filter((x, i) => i > 0);
    const players = [];
    for (let i = 0; i + 1 < parts.length + 1; i += 2) {
      if (parts[i] === undefined) break;
      if (parts[i].length !== n) return null;
      players.push({ tiers: decTiers(parts[i]), name: decName(parts[i + 1] || "") || "A friend" });
    }
    return { seed: m[1], n, players };
  }
  function vsSpec(seed, n, opp) {
    return {
      key: `vs:${seed}`, mode: "vs", number: 0, seed, n, opp: opp || null,
      label: opp ? `Vs ${opp.name}` : "Challenge", promptIds: challengePromptIds(seed, n),
    };
  }
  function openChallenge(h) {
    const c = parseChallenge(h);
    if (!c) return go("challenge");
    const mine = records[`vs:${c.seed}`];
    const mineTiers = mine ? encTiers(mine.tiers) : null;
    if (!c.players.length) return mine ? go(`results-vs-${c.seed}`) : openRun(vsSpec(c.seed, c.n, null));
    const [a, b] = c.players;
    if (b) {
      if (mineTiers === encTiers(a.tiers)) a.you = true;
      else if (mineTiers === encTiers(b.tiers)) b.you = true;
      return renderDuel(c, a, b);
    }
    // One result in the link: either my own link, or a friend's challenge to me.
    if (mineTiers && mineTiers === encTiers(a.tiers)) return go(`results-vs-${c.seed}`);
    if (mine) return renderDuel(c, a, { name: mine.name || myName() || "You", tiers: mine.tiers }, true);
    return openRun(vsSpec(c.seed, c.n, a));
  }

  // ================================================================ live
  // Real-time matches. Browsers talk directly over WebRTC; PeerJS's public
  // server only introduces them, so nobody needs an account. The host's page
  // is the authority: it admits players, paces rounds and relays answers.
  // claude.ai blocks WebRTC inside artifacts, so there live mode points to the
  // web version.
  const WEB_URL = "https://antony-x.github.io/MLION/";
  const PEER_SRC = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
  const LIVE_SIZES = [5, 7, 10];
  const PUB_SLOTS = 10; // public rooms live at fixed codes pub01..pub10 so anyone can find them
  const pubCode = (k) => `pub${String(k).padStart(2, "0")}`;
  const AWAY_GRACE_MS = 15000;
  const REVEAL_MS = 4500;
  const CODE_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
  const liveBlocked = () => !!SHARE_BASE; // only the artifact build sets SHARE_BASE
  const LIVE = { active: false, code: "", isHost: false, peer: null, conns: new Map(), hostConn: null, myId: "",
    players: new Map(), n: 7, seed: "", phase: "lobby", revealed: -1, timers: [], status: "" };
  let peerLib = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (!peerLib) peerLib = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = PEER_SRC; s.async = true;
      s.onload = () => (window.Peer ? res(window.Peer) : rej(new Error("no Peer")));
      s.onerror = () => { peerLib = null; rej(new Error("load failed")); };
      setTimeout(() => { if (!window.Peer) { peerLib = null; rej(new Error("timeout")); } }, 10000);
      document.head.appendChild(s);
    });
    return peerLib;
  }
  // STUN finds a direct route; the TURN relay (UDP and TCP) carries the match
  // when phone networks block direct connections.
  const ICE = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478",
      "turn:eu-0.turn.peerjs.com:3478?transport=tcp", "turn:us-0.turn.peerjs.com:3478?transport=tcp"],
    username: "peerjs", credential: "peerjsp" },
  ];
  const peerOpts = () => Object.assign({ debug: 0, config: { iceServers: ICE } }, window.MLION_PEER_OPTS || {});
  const cleanName = (s) => String(s || "").replace(/[^\p{L}\p{N} _.'-]/gu, "").trim().slice(0, 16);
  const liveLater = (fn, ms) => { const id = setTimeout(fn, ms); LIVE.timers.push(id); return id; };
  function liveReset() {
    LIVE.timers.forEach(clearTimeout); LIVE.timers = [];
    try { if (LIVE.peer) LIVE.peer.destroy(); } catch { /* already gone */ }
    Object.assign(LIVE, { active: false, code: "", isHost: false, isPublic: false, flash: "", peer: null, conns: new Map(), hostConn: null, myId: "",
      players: new Map(), seed: "", phase: "lobby", revealed: -1, status: "" });
  }
  function leaveLive() {
    if (joinState) { clearTimeout(joinState.timer); try { joinState.peer.destroy(); } catch { /* ignore */ } joinState = null; }
    if (LIVE.active) liveReset();
  }
  const liveHash = () => `live-${LIVE.code}`;
  const playerList = () => [...LIVE.players.values()];
  const inMatch = () => playerList().filter((p) => !p.late); // late joiners wait for the next match
  const roundPts = (pl, i) => (pl.ans[i] ? pl.ans[i].score : 0);
  const shownTotal = (pl) => { let s = 0; for (let i = 0; i <= LIVE.revealed; i++) s += roundPts(pl, i); return s; };

  // ---- messages: everyone (host included) applies the same events
  function apply(m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "lobby" && Array.isArray(m.players)) {
      const before = new Set(LIVE.players.keys());
      const next = new Map();
      for (const p of m.players.slice(0, 12)) {
        if (!p || typeof p.id !== "string") continue;
        const old = LIVE.players.get(p.id);
        next.set(p.id, { id: p.id, name: cleanName(p.name) || "Player", host: !!p.host, late: !!p.late, away: !!p.away, ans: old ? old.ans : {} });
        if (!before.has(p.id) && p.id !== LIVE.myId && before.size) {
          LIVE.flash = `${cleanName(p.name) || "Someone"} joined`;
          toast(LIVE.flash); Sound.tier("mlion");
          try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch { /* ignore */ }
          setTimeout(() => { LIVE.flash = ""; const b = $("#lv-banner"); if (b) b.remove(); }, 6000);
        }
      }
      for (const id of before) if (!next.has(id) && LIVE.players.get(id)) toast(`${LIVE.players.get(id).name} left`);
      LIVE.players = next;
      if (LIVE_SIZES.includes(+m.n)) LIVE.n = +m.n;
      if (LIVE.phase === "lobby" || LIVE.phase === "done") (LIVE.phase === "done" ? renderPodium : renderLobby)();
      else renderStrip();
    } else if (m.t === "start" && /^[a-z0-9]{4,12}$/.test(m.seed) && LIVE_SIZES.includes(+m.n)) {
      LIVE.seed = m.seed; LIVE.n = +m.n; LIVE.phase = "playing"; LIVE.revealed = -1;
      for (const pl of LIVE.players.values()) { pl.ans = {}; pl.late = false; }
      stopRun();
      RUN = { key: `live:${m.seed}`, mode: "live", number: 0, label: "Live match", seed: m.seed, n: LIVE.n,
        promptIds: challengePromptIds(m.seed, LIVE.n), round: 0, phase: "intro", results: [], tried: [], startedAt: Date.now() };
      renderPlayShell();
      renderIntro();
    } else if (m.t === "round" && RUN && RUN.mode === "live" && Number.isInteger(m.i) && m.i < RUN.promptIds.length) {
      cancelAnimationFrame(runRaf);
      while (RUN.results.length < m.i) { // missed a round (lag or tab asleep): count it as a miss
        const p = PROMPTS.get(RUN.promptIds[RUN.results.length]);
        RUN.results.push({ promptId: p.id, promptText: p.text, raw: null, answer: null, tier: null, score: 0, quip: null, corrected: false, timeout: true });
      }
      RUN.round = m.i;
      startRound();
      renderStrip();
    } else if (m.t === "ans" && typeof m.id === "string" && Number.isInteger(m.i)) {
      const pl = LIVE.players.get(m.id);
      if (!pl || pl.ans[m.i]) return;
      const tier = T[m.tier] ? m.tier : null;
      pl.ans[m.i] = { answer: tier ? String(m.answer || "").slice(0, 80) : null, tier, score: tier ? T[tier].score : 0 };
      renderStrip();
      renderLiveWait();
      if (LIVE.revealed >= m.i) renderReveal(m.i);
    } else if (m.t === "reveal" && Number.isInteger(m.i)) {
      LIVE.revealed = Math.max(LIVE.revealed, m.i);
      if (RUN && RUN.mode === "live" && RUN.results.length <= m.i && (RUN.phase === "preview" || RUN.phase === "answering")) submit(true);
      renderStrip();
      renderReveal(m.i);
    } else if (m.t === "end") {
      LIVE.phase = "done";
      LIVE.revealed = LIVE.n - 1;
      stopRun();
      renderPodium();
    }
  }
  function broadcast(m) {
    for (const c of LIVE.conns.values()) { try { c.send(m); } catch { /* dropped peer */ } }
    apply(m);
  }
  function lobbyMsg() {
    return { t: "lobby", n: LIVE.n, phase: LIVE.phase, players: playerList().map((p) => ({ id: p.id, name: p.name, host: p.host, late: !!p.late, away: !!p.away })) };
  }
  function hostHandle(conn, m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "info") {
      const host = playerList().find((p) => p.host);
      try { conn.send({ t: "info", host: host ? host.name : "Someone", players: LIVE.players.size, max: LIVE.isPublic ? 2 : 8, phase: LIVE.phase, n: LIVE.n }); } catch { /* ignore */ }
      setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 400);
      return;
    }
    if (m.t === "hello" && LIVE.players.has(conn.peer)) { // came back within the grace period
      const pl = LIVE.players.get(conn.peer);
      clearTimeout(pl.awayTimer); pl.away = false;
      LIVE.conns.set(conn.peer, conn);
      broadcast(lobbyMsg());
      if (LIVE.phase === "playing") try { conn.send({ t: "resume", seed: LIVE.seed, n: LIVE.n }); } catch { /* ignore */ }
      return;
    }
    if (m.t === "hello") {
      if (LIVE.players.size >= (LIVE.isPublic ? 2 : 8)) { try { conn.send({ t: "full" }); } catch { /* ignore */ } return; }
      let name = cleanName(m.name) || "Player";
      const taken = new Set(playerList().map((p) => p.name));
      for (let k = 2; taken.has(name); k++) name = `${cleanName(m.name) || "Player"} ${k}`;
      LIVE.conns.set(conn.peer, conn);
      LIVE.players.set(conn.peer, { id: conn.peer, name, host: false, late: LIVE.phase === "playing", ans: {} });
      broadcast(lobbyMsg());
      if (LIVE.phase === "playing") try { conn.send({ t: "busy" }); } catch { /* ignore */ }
    } else if (m.t === "ans" && LIVE.players.has(conn.peer)) {
      hostAnswer(conn.peer, m);
    }
  }
  function hostAnswer(id, m) {
    if (LIVE.phase !== "playing" || !Number.isInteger(m.i) || m.i <= LIVE.revealed) return;
    broadcast({ t: "ans", id, i: m.i, answer: m.answer, tier: m.tier });
    const everyone = inMatch().every((p) => p.ans[m.i]);
    if (everyone) liveLater(() => hostReveal(m.i), 700);
  }
  function hostDrop(id) {
    const pl = LIVE.players.get(id);
    if (!pl || pl.away) return;
    LIVE.conns.delete(id);
    pl.away = true; // keep their seat for a while: phones pause pages when you switch apps
    broadcast(lobbyMsg());
    pl.awayTimer = setTimeout(() => {
      if (!pl.away || !LIVE.players.has(id)) return;
      LIVE.players.delete(id);
      broadcast(lobbyMsg());
      hostCheckRound();
    }, AWAY_GRACE_MS);
  }
  function hostCheckRound() {
    if (LIVE.phase === "playing" && RUN && RUN.mode === "live") {
      const i = RUN.round;
      if (i > LIVE.revealed && inMatch().every((p) => p.ans[i])) liveLater(() => hostReveal(i), 700);
    }
  }
  function hostStart() {
    if (!LIVE.isHost || LIVE.players.size < 2) return;
    LIVE.timers.forEach(clearTimeout); LIVE.timers = [];
    LIVE.phase = "playing";
    broadcast({ t: "start", seed: Math.random().toString(36).slice(2, 9).padEnd(6, "0"), n: LIVE.n });
    broadcast(lobbyMsg());
    liveLater(() => hostRound(0), 2500);
  }
  function hostRound(i) {
    broadcast({ t: "round", i });
    liveLater(() => hostReveal(i), E.PREVIEW_MS + E.ANSWER_MS + 1500);
  }
  function hostReveal(i) {
    if (LIVE.revealed >= i || LIVE.phase !== "playing") return;
    broadcast({ t: "reveal", i });
    liveLater(() => { if (i + 1 < LIVE.n) hostRound(i + 1); else { broadcast({ t: "end" }); LIVE.phase = "done"; broadcast(lobbyMsg()); } }, REVEAL_MS);
  }
  /** Called from renderFeedback when this player's answer for the round is final. */
  function liveLocalAnswer(res) {
    const m = { t: "ans", i: RUN.round, answer: res.answer, tier: res.tier };
    if (LIVE.isHost) hostAnswer(LIVE.myId, m);
    else if (LIVE.hostConn) { try { LIVE.hostConn.send(m); } catch { /* host gone */ } }
  }

  // ---- connecting
  /** Re-register with the handshake server after the phone paused this page. */
  function keepRegistered(peer) {
    let backoff = 1000;
    const again = () => {
      if (peer.destroyed || !peer.disconnected) return;
      try { peer.reconnect(); } catch { /* retry below */ }
      backoff = Math.min(backoff * 2, 8000);
      liveLater(again, backoff);
    };
    peer.on("disconnected", () => liveLater(again, 500));
    peer.on("open", () => { backoff = 1000; });
  }
  document.addEventListener("visibilitychange", () => {
    const peer = LIVE.peer;
    if (document.visibilityState === "visible" && peer && !peer.destroyed && peer.disconnected) {
      try { peer.reconnect(); } catch { /* the disconnected handler keeps trying */ }
    }
    if (document.visibilityState === "visible" && LIVE.active && !LIVE.isHost && LIVE.hostConn && !LIVE.hostConn.open) guestRejoin();
  });

  async function liveCreate(name, isPublic) {
    LS.set("name", name);
    renderLiveStatus("Opening a room…");
    let Peer;
    try { Peer = await loadPeer(); } catch { return renderLiveStatus("Couldn't load live play. Check your connection and try again.", true); }
    const attempt = (tries) => {
      const code = isPublic ? pubCode(tries + 1) : (tries === 0 && window.MLION_LIVE_CODE) || Array.from({ length: 5 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join("");
      const peer = new Peer(`mlion-live-${code}`, peerOpts());
      let opened = false;
      peer.on("open", (id) => {
        if (opened) return; // a reconnect fires open again
        opened = true;
        Object.assign(LIVE, { active: true, code, isHost: true, isPublic: !!isPublic, peer, myId: id, phase: "lobby" });
        LIVE.players.set(id, { id, name, host: true, ans: {} });
        keepRegistered(peer);
        go(liveHash());
      });
      peer.on("connection", (conn) => {
        conn.on("data", (d) => hostHandle(conn, d));
        conn.on("close", () => hostDrop(conn.peer));
        conn.on("error", () => hostDrop(conn.peer));
      });
      peer.on("error", (err) => {
        if (err && err.type === "unavailable-id" && !opened && tries < (isPublic ? PUB_SLOTS - 1 : 4)) { try { peer.destroy(); } catch { /* ignore */ } return attempt(tries + 1); }
        if (!opened) renderLiveStatus(err && err.type === "unavailable-id" && isPublic ? "All public rooms are in use. Join one, or make a private room." : "Couldn't reach the live server. Check your connection and try again.", true);
        // once the room exists, network blips are handled by keepRegistered
      });
    };
    attempt(0);
  }

  // ---- joining: keep trying while the host is away (switched apps, slow network)
  const JOIN_PATIENCE_MS = 120000;
  let joinState = null; // { code, name, peer, started, tries, timer }
  async function liveJoin(code, name) {
    LS.set("name", name);
    if (joinState) { clearTimeout(joinState.timer); try { joinState.peer.destroy(); } catch { /* ignore */ } }
    renderJoinWait(code, "Connecting…");
    let Peer;
    try { Peer = await loadPeer(); } catch { return renderLiveStatus("Couldn't load live play. Check your connection and try again.", true); }
    const peer = new Peer(peerOpts());
    joinState = { code, name, peer, started: Date.now(), tries: 0, timer: 0 };
    keepRegistered(peer);
    peer.on("open", () => { if (!LIVE.active && joinState && joinState.peer === peer && !joinState.trying) tryConnect(); });
    peer.on("error", (err) => {
      if (!joinState || joinState.peer !== peer || LIVE.active) return;
      const t = err && err.type;
      if (t === "peer-unavailable") return retryJoin("Waiting for the host. If they switched apps, ask them to go back to MLion.");
      if (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed" || t === "disconnected") return retryJoin("Connection hiccup. Retrying…");
      retryJoin("Couldn't connect yet. Retrying…");
    });
  }
  function tryConnect() {
    const js = joinState;
    if (!js || LIVE.active) return;
    js.trying = true;
    js.tries++;
    if (js.tries > 1) renderJoinWait(js.code, `Trying again (attempt ${js.tries})…`);
    if (js.peer.disconnected) { try { js.peer.reconnect(); } catch { /* ignore */ } }
    const conn = js.peer.connect(`mlion-live-${js.code}`, { reliable: true });
    let opened = false;
    const stall = setTimeout(() => { if (!opened) { try { conn.close(); } catch { /* ignore */ } retryJoin("Still reaching the room…"); } }, 12000);
    conn.on("iceStateChanged", (st) => { if (st === "failed" && !opened) { clearTimeout(stall); try { conn.close(); } catch { /* ignore */ } retryJoin("Your networks didn't connect. Retrying through a relay…"); } });
    conn.on("open", () => {
      opened = true; clearTimeout(stall); js.trying = false;
      Object.assign(LIVE, { active: true, code: js.code, isHost: false, peer: js.peer, hostConn: conn, myId: js.peer.id, phase: LIVE.phase === "waiting" || LIVE.phase === "playing" ? LIVE.phase : "lobby" });
      conn.send({ t: "hello", name: js.name, v: 1 });
    });
    conn.on("data", (d) => {
      if (d && d.t === "full") { renderLiveStatus("That room is full.", true); joinState = null; return liveReset(); }
      if (d && d.t === "busy") { LIVE.phase = "waiting"; renderLiveStatus("A match is in progress. You'll join the next one.", false); return; }
      if (d && d.t === "resume") {
        LIVE.phase = "playing";
        toast("Back in the match");
        if (RUN && RUN.mode === "live") {
          if (descent) { descent.destroy(); descent = null; }
          renderPlayShell();
          $("#card").innerHTML = `<div class="intro-card"><div><h2>You're back</h2><p class="sub">The next question starts in a moment.</p></div></div>`;
        }
        return;
      }
      if (d && d.t === "lobby" && LIVE.phase === "waiting" && d.phase !== "playing") LIVE.phase = "lobby";
      if (LIVE.phase === "waiting" && d && d.t !== "lobby") return;
      apply(d);
    });
    conn.on("close", () => {
      clearTimeout(stall);
      if (!opened) return;
      if (LIVE.active && LIVE.hostConn === conn) guestRejoin();
    });
  }
  function retryJoin(msg) {
    const js = joinState;
    if (!js || LIVE.active) return;
    js.trying = false;
    clearTimeout(js.timer);
    if (Date.now() - js.started > JOIN_PATIENCE_MS) {
      try { js.peer.destroy(); } catch { /* ignore */ }
      joinState = null;
      return renderLiveStatus("Couldn't reach that room. Check that the host still has MLion open, then try the link again.", true);
    }
    renderJoinWait(js.code, msg);
    js.timer = setTimeout(tryConnect, 2500);
  }
  /** The link to the host dropped (either phone paused): try to get back in. */
  function guestRejoin() {
    if (!joinState) return;
    const keepPhase = LIVE.phase;
    if (keepPhase !== "playing") stopRun(); else cancelAnimationFrame(runRaf);
    LIVE.active = false; LIVE.hostConn = null;
    LIVE.phase = keepPhase === "playing" ? "playing" : "lobby";
    joinState.started = Date.now();
    retryJoin("Reconnecting to the room…");
  }

  // ---- screens
  function renderLiveBlocked(code) {
    setMid("Live");
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Live match</h1><p>Live play runs on the web version, where browsers can connect directly.</p></div>
      <div class="btn-row"><a class="btn primary big" href="${WEB_URL}#${code ? `live-${code}` : "live"}" target="_blank" rel="noopener">Open live mode</a></div>
    </section>`;
  }
  function renderJoinWait(code, text) {
    setMid(`Room ${code}`);
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Joining room <span class="lv-code">${esc(code)}</span></h1><p role="status">${esc(text)}</p></div>
      <ul class="lv-players"><li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Looking for the host…</span></li></ul>
      <div class="btn-row"><a class="btn big" href="#live" id="live-cancel">Cancel</a></div>
    </section>`;
    $("#live-cancel").addEventListener("click", () => { if (joinState) { clearTimeout(joinState.timer); try { joinState.peer.destroy(); } catch { /* ignore */ } joinState = null; } });
  }
  function renderLiveStatus(text, retry) {
    setMid("Live");
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Live match</h1><p class="${retry ? "live-err" : ""}" role="status">${esc(text)}</p></div>
      ${retry ? `<div class="btn-row"><a class="btn primary big" href="#live">Back</a></div>` : ""}
    </section>`;
  }
  function renderLiveStart(code) {
    setMid("Live");
    const joining = !!code;
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>${joining ? "Join live match" : "Live match"}</h1>
        <p>${joining ? `Room ${esc(code)}. Same questions, same clock, scores live.` : "Make a room, send the link, play the same questions at the same time."}</p></div>
      <div class="vs-form">
        <label class="vs-field"><span>Your name</span><input class="search" id="live-name" maxlength="16" autocomplete="nickname" placeholder="Shown to everyone" value="${esc(myName())}"></label>
        ${joining ? "" : `<label class="lv-check"><input type="checkbox" id="live-public"><span>Public duo room: anyone can find it in Public rooms</span></label>`}
        <div class="btn-row"><button class="btn primary big" id="live-go">${joining ? "Join" : "Create room"}</button>${joining ? "" : `<a class="btn big" href="#rooms">Browse public rooms</a>`}</div>
      </div>
    </section>`;
    const go1 = () => {
      const name = cleanName($("#live-name").value) || "Player";
      joining ? liveJoin(code, name) : liveCreate(name, !!($("#live-public") && $("#live-public").checked));
    };
    $("#live-go").addEventListener("click", go1);
    $("#live-name").addEventListener("keydown", (e) => { if (e.key === "Enter") go1(); });
    $("#live-name").focus();
  }
  function avatar(name) { return `<span class="lv-av" aria-hidden="true">${esc((name || "?").slice(0, 1).toUpperCase())}</span>`; }
  function renderLobby() {
    if (!LIVE.active) return;
    setMid(`Room ${LIVE.code}`);
    const ps = playerList();
    const host = ps.find((p) => p.host);
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Room <span class="lv-code">${esc(LIVE.code)}</span></h1>
        <p>${LIVE.isPublic ? "Public duo room · listed in Public rooms. " : ""}${ps.length < 2 ? "Waiting for someone to join…" : `${ps.length} players ready. Tap Start.`}</p>
        ${LIVE.isHost ? `<p class="lv-note">Keep MLion open while friends join. If you switch apps, come back here and the room reconnects.</p>` : ""}</div>
      ${LIVE.flash ? `<div class="lv-banner" id="lv-banner" role="alert">${esc(LIVE.flash)}</div>` : ""}
      <div class="btn-row"><button class="btn ${ps.length < 2 ? "primary " : ""}big" id="live-invite">Invite friends</button><a class="btn big" href="#rooms">Leave</a></div>
      <ul class="lv-players" aria-live="polite">${ps.map((p) => `<li class="${p.id === LIVE.myId ? "me" : ""}">${avatar(p.name)}<b>${esc(p.name)}</b><span>${p.away ? "Reconnecting…" : `${p.host ? "Host" : ""}${p.id === LIVE.myId ? `${p.host ? " · " : ""}You` : ""}`}</span></li>`).join("")}
        ${ps.length < 2 ? `<li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Waiting for a friend…</span></li>` : ""}</ul>
      ${LIVE.isHost ? `<div class="vs-form">
        <div class="vs-field"><span>Questions</span><div class="vs-sizes" role="radiogroup" aria-label="Number of questions">${LIVE_SIZES.map((n) => `<button type="button" class="vs-size${n === LIVE.n ? " on" : ""}" role="radio" aria-checked="${n === LIVE.n}" data-n="${n}">${n}</button>`).join("")}</div></div>
        <button class="btn primary big" id="live-start" ${ps.length < 2 ? "disabled" : ""}>Start match</button>
      </div>` : `<p class="lv-note">${esc(host ? host.name : "The host")} starts the match.</p>`}
    </section>`;
    $("#live-invite").addEventListener("click", () => shareLink(`Play MLion live with me. Room ${LIVE.code}:\n${(SHARE_BASE ? WEB_URL : siteUrl() || WEB_URL)}#${liveHash()}`));
    $$(".vs-size").forEach((b) => b.addEventListener("click", () => { LIVE.n = +b.dataset.n; broadcast(lobbyMsg()); }));
    const st = $("#live-start");
    if (st) st.addEventListener("click", hostStart);
  }
  function renderStrip() {
    const el = $("#live-strip");
    if (!el || !RUN || RUN.mode !== "live") return;
    const i = RUN.round;
    el.innerHTML = inMatch().map((p) => {
      const done = !!p.ans[i];
      return `<span class="lp${p.id === LIVE.myId ? " me" : ""}${done ? " done" : ""}">${avatar(p.name)}<b>${esc(p.name)}</b><em>${shownTotal(p)}</em>${done && LIVE.revealed < i ? `<i class="lp-tick" aria-label="answered">✓</i>` : ""}</span>`;
    }).join("");
  }
  function renderLiveWait() {
    const el = $("#live-wait");
    if (!el || !RUN) return;
    const i = RUN.round;
    const left = inMatch().filter((p) => !p.ans[i]);
    el.textContent = left.length ? `Waiting for ${left.map((p) => p.name).join(", ")}…` : "Everyone's in. Revealing…";
  }
  function renderReveal(i) {
    if (!RUN || RUN.mode !== "live" || !$("#card")) return;
    const p = PROMPTS.get(RUN.promptIds[i]);
    const ps = inMatch().sort((a, b) => roundPts(b, i) - roundPts(a, i));
    const standings = inMatch().sort((a, b) => shownTotal(b) - shownTotal(a));
    const last = i + 1 >= LIVE.n;
    $("#card").innerHTML = `<div class="lv-reveal">
      <p class="fb-q">${esc(p.text)}</p>
      <ul class="lv-answers">${ps.map((pl) => {
        const a = pl.ans[i];
        return `<li class="t-${tierOf(a && a.tier)}${pl.id === LIVE.myId ? " me" : ""}">${avatar(pl.name)}<span><b>${esc(pl.name)}</b><span class="la">${a && a.answer ? esc(a.answer) : "No answer"}</span></span>${G(a && a.tier)}<em>+${roundPts(pl, i)}</em></li>`;
      }).join("")}</ul>
      <ol class="lv-standings">${standings.map((pl) => `<li class="${pl.id === LIVE.myId ? "me" : ""}"><b>${esc(pl.name)}</b><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
      <p class="lv-note">${last ? "Final standings coming up…" : `Question ${i + 2} of ${LIVE.n} coming up…`}</p>
    </div>`;
  }
  function renderPodium() {
    stopRun();
    setMid(`Room ${LIVE.code}`);
    scene("results");
    const ps = inMatch().sort((a, b) => shownTotal(b) - shownTotal(a));
    const top = ps.length ? shownTotal(ps[0]) : 0;
    const winners = ps.filter((p) => shownTotal(p) === top);
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>${winners.length > 1 ? "It's a tie" : `${esc(winners[0] ? winners[0].name : "")} wins`}</h1><p>${LIVE.n} questions · Room ${esc(LIVE.code)}</p></div>
      <ol class="lv-podium">${ps.map((pl, k) => `<li class="${k === 0 ? "first" : ""}${pl.id === LIVE.myId ? " me" : ""}">
        <span class="rk">${k + 1}</span>${avatar(pl.name)}<span class="nm"><b>${esc(pl.name)}</b>${tiersRow(Array.from({ length: LIVE.n }, (_, i) => (pl.ans[i] && pl.ans[i].tier) || "miss"))}</span><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
      <div class="btn-row">
        ${LIVE.isHost ? `<button class="btn primary big" id="live-again" ${LIVE.players.size < 2 ? "disabled" : ""}>Rematch</button>` : `<p class="lv-note">Waiting for the host to start a rematch…</p>`}
        <a class="btn big" href="#home" id="live-leave">Leave</a>
      </div>
    </section>`;
    const again = $("#live-again");
    if (again) again.addEventListener("click", hostStart);
  }
  /** Public rooms: ask each fixed public code who's there. */
  let browsePeer = null;
  async function renderRooms() {
    if (liveBlocked()) return renderLiveBlocked("");
    setMid("Public rooms");
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Public rooms</h1><p>Duo rooms anyone can join. Updates every 15 seconds.</p><p id="rooms-status" role="status">Looking for open rooms…</p></div>
      <ul class="lv-players" id="rooms-list"><li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Searching…</span></li></ul>
      <div class="btn-row"><button class="btn big" id="rooms-refresh">Refresh</button><a class="btn primary big" href="#live">Create a room</a></div>
    </section>`;
    $("#rooms-refresh").addEventListener("click", renderRooms);
    clearScreenTimers();
    every(15000, () => { if (location.hash === "#rooms") renderRooms(); });
    let Peer;
    try { Peer = await loadPeer(); } catch { $("#rooms-status").textContent = "Couldn't reach the live server. Check your connection and tap Refresh."; return; }
    try { if (browsePeer) browsePeer.destroy(); } catch { /* ignore */ }
    const peer = new Peer(peerOpts());
    browsePeer = peer;
    const found = new Map();
    const draw = (final) => {
      const list = $("#rooms-list"), st = $("#rooms-status");
      if (!list || browsePeer !== peer) return;
      const rooms = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      st.textContent = rooms.length ? `${rooms.length} open ${rooms.length === 1 ? "room" : "rooms"}` : final ? "No public rooms right now. Create one and friends can find it here." : "Looking for open rooms…";
      list.innerHTML = rooms.map(([code, r]) => {
        const full = r.players >= r.max;
        return `<li>${avatar(r.host)}<b>${esc(r.host)}'s room</b><span>${r.players}/${r.max} · ${full ? "full" : r.phase === "playing" ? "playing" : "open"}</span>${full ? "" : `<a class="btn sm primary" href="#live-${code}">Join</a>`}</li>`;
      }).join("") ||
        (final ? "" : `<li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Searching…</span></li>`);
    };
    peer.on("open", () => {
      for (let k = 1; k <= PUB_SLOTS; k++) {
        const code = pubCode(k);
        const conn = peer.connect(`mlion-live-${code}`, { reliable: true });
        conn.on("open", () => conn.send({ t: "info" }));
        conn.on("data", (d) => { if (d && d.t === "info") { found.set(code, { host: cleanName(d.host) || "Someone", players: +d.players || 1, max: +d.max || 8, phase: d.phase }); draw(false); } });
      }
      setTimeout(() => { draw(true); setTimeout(() => { try { if (browsePeer === peer) { peer.destroy(); browsePeer = null; } } catch { /* ignore */ } }, 500); }, 7000);
    });
    peer.on("error", () => { /* missing public codes report here; they simply aren't listed */ });
  }

  if (window.MLION_TEST) window.MLION_LIVE_STATE = LIVE;
  function openLive(code) {
    if (liveBlocked()) return renderLiveBlocked(code);
    if (LIVE.active && code === LIVE.code) return LIVE.phase === "done" ? renderPodium() : renderLobby();
    if (joinState && joinState.code === code) return renderJoinWait(code, "Connecting…");
    leaveLive();
    renderLiveStart(code);
  }

  // ============================================================ routing
  // Hash routes are plain names (#daily, #pack-blocks-3, #results-daily-2026-11-04)
  // so links survive hosts that only pass simple fragments through.
  const SIMPLE = {
    "": renderHome, home: renderHome,
    daily: () => openRun(dailySpec(today())),
    unlimited: renderUnlimited, packs: renderPacks, archive: renderArchive, library: renderLibrary,
    stats: renderStats, how: renderHow, faq: renderFaq, prefs: renderSettings,
    challenge: renderChallenge,
    live: () => openLive(""),
    rooms: renderRooms,
  };
  const slugFor = (key) => key.replace(/:/g, "-");
  function keyFromSlug(s) {
    let m;
    if ((m = s.match(/^(daily|archive)-(\d{4}-\d{2}-\d{2})$/))) return `${m[1]}:${m[2]}`;
    if ((m = s.match(/^unlimited-(\d+)$/))) return `unlimited:${m[1]}`;
    if ((m = s.match(/^pack-([a-z]+)-(\d+)$/))) return `pack:${m[1]}:${m[2]}`;
    if ((m = s.match(/^vs-([a-z0-9]+)$/))) return `vs:${m[1]}`;
    return s;
  }
  function go(name) {
    if (location.hash.replace(/^#/, "") === name) route();
    else location.hash = name;
  }
  function route() {
    closeDrawer();
    closeModal();
    if (!(LIVE.active && RUN && RUN.mode === "live")) stopRun();
    clearScreenTimers();
    window.scrollTo(0, 0);
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\//g, "-");
    if ((LIVE.active && h !== liveHash()) || (joinState && h !== `live-${joinState.code}`)) leaveLive();
    if (RUN && RUN.mode === "live" && !LIVE.active) stopRun();
    scene("page");
    $$("#drawer a.nav").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + (h || "home")));
    if (SIMPLE[h]) return SIMPLE[h]();
    if (/^vs-/.test(h)) return openChallenge(h);
    if (/^live-[a-z0-9]{5}$/.test(h)) return openLive(h.slice(5));
    let m;
    if ((m = h.match(/^unlimited-(\d+)$/))) return openRun(unlimitedSpec(Math.max(1, +m[1])));
    if ((m = h.match(/^pack-([a-z]+)$/))) return PACKS.has(m[1]) ? renderPack(m[1]) : go("packs");
    if ((m = h.match(/^pack-([a-z]+)-(\d+)$/))) return PACKS.has(m[1]) ? openRun(packSpec(m[1], Math.max(1, +m[2]))) : go("packs");
    if ((m = h.match(/^archive-(\d{4}-\d{2}-\d{2})$/))) return openArchive(m[1]);
    if ((m = h.match(/^practice-(.+)$/))) return PROMPTS.has(m[1]) ? openRun(practiceSpec(m[1])) : go("library");
    if ((m = h.match(/^answers-(.+)$/))) return PROMPTS.has(m[1]) ? renderAnswersPage(m[1]) : go("library");
    if ((m = h.match(/^results-(.+)$/))) return renderResults(keyFromSlug(m[1]));
    renderHome();
  }
  window.addEventListener("hashchange", route);

  // ============================================================== home
  function renderHome() {
    const date = today(), n = todayNumber();
    setMid(`#${n} · ${prettyDate(date, { weekday: "short", month: "short", day: "numeric" })}`);
    const rec = records[`daily:${date}`];
    const inProg = !rec && LS.get(`run:daily:${date}`);
    const s = statsSummary();
    let cta;
    if (rec) cta = `<a class="btn primary big" href="#results-${slugFor(rec.key)}">Today's run · ${rec.score}</a>
      <span class="countdown">Next in <b id="cd">${hhmmss(E.msUntilLocalMidnight())}</b></span>`;
    else if (inProg) cta = `<a class="btn primary big" href="#daily">Resume · ${Math.min(inProg.results.length + 1, 7)} of 7</a>`;
    else cta = `<a class="btn primary big" href="#daily">Start training</a>`;
    cta += `<a class="btn big" href="#live">Play live with friends</a>`;
    const progress = rec ? rec.score / 700 : inProg ? totalScore(inProg.results || []) / 700 : 0;
    const modes = [
      ["#live", "Live match", "Play friends in real time"],
      ["#rooms", "Public rooms", "Join anyone playing now"],
      ["#challenge", "Challenge a friend", "Same questions, one link"],
      ["#unlimited", "Unlimited", "Endless runs"],
      ["#packs", "Packs", `${DATA.packs.length} themes`],
      ["#archive", "Archive", "Past days"],
      ["#library", "Library", `${DATA.prompts.length} prompts`],
      ["#stats", "Stats", s.played ? `${s.played} played` : ""],
      ["#how", "How to play", ""],
    ];
    app.innerHTML = `<section class="screen home">
      <div class="home-hero arrive">
        <div class="brandmark">${V.mark("hero-mark")}<h1 class="wordmark" aria-label="MLion"><span class="line"><span>MLion</span></span></h1></div>
        <p class="pitch">A daily machine-learning word game. Rarer answers roll deeper.</p>
        <div class="hero-cta">${cta}</div>
      </div>
      <div class="home-rest">
        <section><h2>Six depths</h2>${depthList()}</section>
        <section>${s.played ? `<div class="figures">
          <div class="figure"><b>${s.cur}</b><span>Streak</span></div>
          <div class="figure"><b>${s.best || "—"}</b><span>Best</span></div>
          <div class="figure"><b>${s.gems}</b><span>Gems</span></div>
        </div>` : ""}<h2>More ways to play</h2><ul class="modes">${modes.map(([href, t, d]) => `<li><a href="${href}">${t}<span>${esc(d)}</span></a></li>`).join("")}</ul></section>
        <p class="home-close"><span>One in a MLion</span><a href="${REPO_URL}" target="_blank" rel="noopener">Source</a></p>
      </div>
    </section>`;
    scene("home", { progress, animate: true });
    if (rec) every(1000, () => { const el = $("#cd"); if (el) el.textContent = hhmmss(E.msUntilLocalMidnight()); if (today() !== date) route(); });
    if (!LS.get("seenHow")) { LS.set("seenHow", true); setTimeout(() => showHowModal(), 400); }
  }

  // ========================================================== the round
  let RUN = null; // live run object
  let runTimer = 0, runRaf = 0, descent = null, lastTick = -1;
  let hudRange = [0, 0]; // score the HUD may show while the ball rolls

  function stopRun() {
    clearTimeout(runTimer); cancelAnimationFrame(runRaf); runTimer = 0; runRaf = 0;
    if (descent) { descent.destroy(); descent = null; }
    RUN = null;
  }
  function persistRun() {
    if (!RUN || RUN.mode === "practice" || RUN.mode === "live") return;
    const { aiCtl, ...plain } = RUN; // eslint-disable-line no-unused-vars
    LS.set("run:" + RUN.key, plain);
  }
  function totalScore(results) { return results.reduce((s, r) => s + r.score, 0); }

  function openArchive(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < E.EPOCH || date > today()) return go("archive");
    if (date === today()) return go("daily");
    if (records[`daily:${date}`]) return go(`results-daily-${date}`);
    if (records[`archive:${date}`]) return go(`results-archive-${date}`);
    openRun(archiveSpec(date));
  }

  function openRun(spec) {
    if (records[spec.key] && spec.mode !== "practice") return go(`results-${slugFor(spec.key)}`);
    let run = spec.mode === "practice" ? null : LS.get("run:" + spec.key);
    if (!run || run.promptIds.join() !== spec.promptIds.join()) {
      run = { ...spec, round: 0, phase: "intro", results: [], tried: [], startedAt: Date.now() };
    }
    RUN = run;
    renderPlayShell();
    resumePhase();
  }

  function resumePhase() {
    const now = Date.now();
    if (RUN.phase === "preview" || RUN.phase === "answering") {
      if (now >= RUN.answerEndsAt) { RUN.phase = "answering"; return finishRound(null, "", { timeout: true, silent: true }); }
      if (now < RUN.previewEndsAt) RUN.phase = "preview"; else RUN.phase = "answering";
      return renderRound();
    }
    if (RUN.phase === "feedback") return renderFeedback(RUN.results[RUN.results.length - 1], false);
    if (RUN.phase === "done") return finalize();
    renderIntro();
  }

  function renderPlayShell() {
    setMid(RUN.label);
    app.innerHTML = `<section class="screen play">
      <div class="stage" id="stage">
        <canvas id="descent" aria-hidden="true"></canvas>
        <div class="hud"><span>Loss</span><b id="hud-loss">7.00</b></div>
        <div class="hud hud-r"><span>Score</span><b id="hud-score">0</b></div>
        <div class="play-head">
          <div class="dots" id="dots" aria-label="progress"></div>
          <div class="play-meta" id="play-meta"></div>
        </div>
      </div>
      <div class="prompt-card" id="card"></div>
    </section>`;
    scene("play");
    descent = V.Descent($("#descent"), {
      onFrame: (x) => {
        if (!RUN) return;
        const [lo, hi] = hudRange;
        const pts = Math.min(hi, Math.max(lo, Math.round(x / 10)));
        const l = $("#hud-loss"), sc = $("#hud-score");
        if (l) l.textContent = ((RUN.promptIds.length * 100 - pts) / 100).toFixed(2);
        if (sc) sc.textContent = pts;
      },
      onFlood: (on) => { const st = $("#stage"); if (st) st.classList.toggle("flood", on); },
    });
    descent.set(RUN.results);
    updateHead();
    setHud(totalScore(RUN.results));
    if (RUN.mode === "live") { $("#card").insertAdjacentHTML("beforebegin", `<div class="live-strip" id="live-strip" aria-live="polite"></div>`); renderStrip(); }
  }
  function updateHead() {
    if (!RUN) return;
    const n = RUN.promptIds.length;
    $("#dots").innerHTML = RUN.promptIds.map((_, i) => {
      const r = RUN.results[i];
      if (r) return r.tier ? `<i class="done t-${r.tier}" title="${esc(T[r.tier].name)}"></i>` : `<i class="miss" title="Miss"></i>`;
      return `<i class="${i === RUN.round && RUN.phase !== "intro" ? "cur" : ""}"></i>`;
    }).join("");
    $("#play-meta").innerHTML = `<b>${Math.min(RUN.round + 1, n)}</b> of ${n}`;
  }
  function setHud(score) {
    hudRange = [score, score];
    const n = RUN.promptIds.length;
    $("#hud-score").textContent = score;
    $("#hud-loss").textContent = ((n * 100 - score) / 100).toFixed(2);
  }

  function renderIntro() {
    const n = RUN.promptIds.length;
    if (RUN.mode === "live") {
      $("#card").innerHTML = `<div class="intro-card"><div><h2>Get ready</h2><p class="sub">${n} questions. Same clock for everyone. Answers are revealed after each one.</p></div></div>`;
      return;
    }
    const title = RUN.mode === "daily" ? `MLion #${RUN.number}` : RUN.mode === "vs" && RUN.opp ? `${RUN.opp.name} challenged you` : RUN.label;
    const sub = RUN.mode === "daily" ? prettyDate(RUN.date, { weekday: "long", month: "long", day: "numeric" }) :
      RUN.mode === "archive" ? `${prettyDate(RUN.date)} · no streak` :
      RUN.mode === "practice" ? "Answers shown after" :
      RUN.mode === "vs" ? (RUN.opp ? `Score to beat: ${tierPoints(RUN.opp.tiers)}. You'll see their result after each answer.` : "Send the link now to play at the same time, or play first and send your score.") : "";
    $("#card").innerHTML = `<div class="intro-card">
      <div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>
      <ul class="beats">
        <li><b>${n}</b><span>${n === 1 ? "prompt" : "prompts"}</span></li>
        <li><b>3 s</b><span>to read</span></li>
        <li><b>25 s</b><span>to answer</span></li>
      </ul>
      <p class="rule">Any valid answer counts. Wrong ones bounce, so keep trying. Rarer answers score more.</p>
      ${RUN.mode === "vs" ? `<label class="vs-field"><span>Your name</span><input class="search" id="vs-name" maxlength="16" autocomplete="nickname" placeholder="So ${RUN.opp ? esc(RUN.opp.name) : "your friend"} knows who played" value="${esc(myName())}"></label>` : ""}
      <div class="btn-row">
        <button class="btn primary big" id="begin">Begin</button>
        ${RUN.mode === "vs" && !RUN.opp ? `<button class="btn big" id="vs-send-now">Send link now</button>` : ""}
      </div>
      <p class="hint"><kbd>Enter</kbd> submits and continues</p>
    </div>`;
    const sendNow = $("#vs-send-now");
    if (sendNow) sendNow.addEventListener("click", () => {
      const nm = $("#vs-name");
      if (nm) LS.set("name", nm.value.trim().slice(0, 16));
      shareLink(`Play MLion with me: the same ${RUN.n} ML questions. Send me your score when you're done:\n${challengeLink(RUN.seed, RUN.n, [])}`);
    });
    $("#begin").addEventListener("click", async () => {
      const nm = $("#vs-name");
      if (nm) LS.set("name", nm.value.trim().slice(0, 16));
      $("#begin").disabled = true; await aiConsentUpFront(); startRound();
    });
    $("#begin").focus();
  }

  function startRound() {
    Sound.unlock();
    const now = Date.now();
    RUN.phase = "preview";
    RUN.previewEndsAt = now + E.PREVIEW_MS;
    RUN.answerEndsAt = RUN.previewEndsAt + E.ANSWER_MS;
    RUN.tried = [];
    persistRun();
    renderRound();
  }

  function currentPrompt() { return PROMPTS.get(RUN.promptIds[RUN.round]); }

  function renderRound() {
    const p = currentPrompt();
    updateHead();
    if (descent) descent.calm();
    $("#card").innerHTML = `<div class="round">
      <div class="ask">
        <p class="prompt-text" id="prompt-text">${esc(p.text)}${p.example ? ` <span class="eg">(e.g. ${esc(p.example)})</span>` : ""}</p>
        ${p.scope ? `<p class="prompt-note">${esc(p.scope)}</p>` : ""}
      </div>
      <div class="act">
        <div class="timer" id="timer">
          <div class="timer-row"><span id="timer-label">Starts in</span><b id="timer-num">25.0</b></div>
          <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>
        </div>
        <div class="input-zone">
          <form class="answer-form" id="answer-form" autocomplete="off">
            <input class="answer-input" id="answer" maxlength="${E.MAX_ANSWER_LENGTH}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Your answer" placeholder="Type an answer">
            <button class="btn primary step-btn" id="step" type="submit">Step</button>
          </form>
          <div class="preview-veil" id="veil"><span>Read the prompt</span><b id="veil-n">3</b></div>
        </div>
        <div class="status" id="status" role="status" aria-live="polite"></div>
        <div class="chips" id="chips"></div>
        <div class="tried" id="tried"></div>
      </div>
    </div>`;
    const input = $("#answer");
    if (RUN.draft) input.value = RUN.draft;
    input.addEventListener("input", () => {
      RUN.draft = input.value;
      input.classList.remove("corrected");
      RUN.pendingCorrection = null;
      if (RUN.aiCtl) { RUN.aiCtl.abort(); RUN.aiCtl = null; }
      showChips([]);
      clearTimeout(input._p); input._p = setTimeout(persistRun, 300);
    });
    $("#answer-form").addEventListener("submit", (e) => { e.preventDefault(); submit(false); });
    renderTried();
    lastTick = -1;
    tickLoop();
  }
  function renderTried() {
    const el = $("#tried");
    if (el) el.innerHTML = (RUN.tried || []).slice(-8).map((t) => `<span>${esc(t)}</span>`).join("");
  }

  function tickLoop() {
    cancelAnimationFrame(runRaf);
    const loop = () => {
      if (!RUN || (RUN.phase !== "preview" && RUN.phase !== "answering")) return;
      const now = Date.now();
      const input = $("#answer"), veil = $("#veil");
      if (!input) return;
      if (now < RUN.previewEndsAt) {
        RUN.phase = "preview";
        input.disabled = true; $("#step").disabled = true;
        veil.classList.remove("hidden");
        $("#veil-n").textContent = Math.ceil((RUN.previewEndsAt - now) / 1000);
        $("#timer-label").textContent = "Starts in";
        $("#timer-num").textContent = "25.0";
        $("#timer-fill").style.transform = "scaleX(1)";
      } else {
        if (RUN.phase === "preview" || input.disabled) {
          RUN.phase = "answering"; persistRun();
          input.disabled = false; $("#step").disabled = false;
          veil.classList.add("hidden");
          input.focus({ preventScroll: true });
          $("#timer-label").textContent = "Time left";
        }
        const left = Math.max(0, RUN.answerEndsAt - now);
        $("#timer-num").textContent = (left / 1000).toFixed(1);
        $("#timer-fill").style.transform = `scaleX(${left / E.ANSWER_MS})`;
        const low = left <= 5000;
        $("#timer").classList.toggle("low", low);
        const sec = Math.ceil(left / 1000);
        if (low && sec !== lastTick && sec > 0) { lastTick = sec; Sound.tick(); }
        if (left <= 0) { submit(true); return; }
      }
      runRaf = requestAnimationFrame(loop);
    };
    runRaf = requestAnimationFrame(loop);
  }

  function setStatus(msg, cls) {
    const s = $("#status");
    if (!s) return;
    s.className = "status" + (cls ? " " + cls : "");
    s.textContent = msg;
  }

  /** Tappable "did you mean" answers under the input. */
  function showChips(list, label) {
    const el = $("#chips");
    if (!el) return;
    if (!list.length) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="chips-label">${esc(label || "Did you mean")}</span>` +
      list.map((a, i) => `<button type="button" class="chip" data-i="${i}">${esc(a.a)}</button>`).join("");
    $$(".chip", el).forEach((b) => b.addEventListener("click", () => {
      if (!RUN || RUN.phase !== "answering") return;
      const raw = ($("#answer") || {}).value || "";
      finishRound(list[+b.dataset.i], raw.trim() || list[+b.dataset.i].a, { corrected: true });
    }));
  }

  function reject(raw, input) {
    RUN.tried = (RUN.tried || []).concat(raw);
    Sound.reject();
    setStatus(`“${raw}” isn't in the key: no gradient. Try again.`, "bad");
    input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
    if (settings.clearRejected) { input.value = ""; RUN.draft = ""; }
    else input.select();
    renderTried();
    persistRun();
  }

  function submit(force) {
    if (!RUN || RUN.phase !== "answering") return;
    const input = $("#answer");
    const raw = (input ? input.value : RUN.draft || "").trim();
    const p = currentPrompt();
    if (!raw) { if (force) finishRound(null, "", { timeout: true }); return; }
    const m = E.matchAnswer(p, raw);
    showChips([]);
    if (m.kind === "exact") return finishRound(m.answer, raw, {});
    if (force) {
      // Time's up: take a confident near miss, otherwise it's a miss.
      if (m.kind === "correction") return finishRound(m.answer, raw, { corrected: true });
      if (m.kind === "suggest" && m.confidence >= 0.75 && m.suggestions.length === 1) return finishRound(m.suggestions[0], raw, { corrected: true });
      return finishRound(null, raw, { timeout: true });
    }
    if (m.kind === "correction") {
      if (!settings.previewCorrections) return finishRound(m.answer, raw, { corrected: true });
      input.value = m.answer.a; RUN.draft = m.answer.a;
      input.classList.add("corrected");
      RUN.pendingCorrection = { from: raw, to: m.answer.a };
      setStatus(`Did you mean “${m.answer.a}”? Step to confirm.`, "info");
      input.focus();
      return;
    }
    if (m.kind === "suggest") {
      setStatus(`“${raw}” is close. Tap the one you meant.`, "info");
      showChips(m.suggestions);
      return;
    }
    if (settings.aiCheck && aiUsable()) return askClaude(p, raw, input);
    reject(raw, input);
  }

  async function askClaude(p, raw, input) {
    const round = RUN.round, key = RUN.key;
    if (RUN.aiCtl) RUN.aiCtl.abort();
    const ctl = new AbortController();
    RUN.aiCtl = ctl;
    setStatus(`Checking “${raw}” with Claude…`, "info");
    let found = null;
    try { found = await aiResolve(p, raw, ctl.signal); }
    catch (e) {
      const code = e && e.code;
      if (code === "cancelled") return;
      if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) AI.state = "denied";
    }
    if (!RUN || RUN.key !== key || RUN.round !== round || RUN.phase !== "answering" || ctl.signal.aborted) return;
    RUN.aiCtl = null;
    const now = $("#answer");
    if (!now) return;
    if (found) {
      setStatus(`Claude thinks you meant:`, "info");
      showChips([found], "Tap to confirm");
    } else reject(raw, now);
  }

  function finishRound(answer, raw, { corrected = false, timeout = false, silent = false } = {}) {
    cancelAnimationFrame(runRaf);
    if (RUN.aiCtl) { RUN.aiCtl.abort(); RUN.aiCtl = null; }
    const p = currentPrompt();
    const res = {
      promptId: p.id, promptText: p.text, raw: raw || null,
      answer: answer ? answer.a : null, tier: answer ? answer.t : null,
      score: answer ? T[answer.t].score : 0, quip: answer && answer.q ? answer.q : null,
      corrected: !!corrected, timeout: !answer && timeout,
    };
    RUN.results.push(res);
    RUN.phase = "feedback";
    RUN.draft = ""; RUN.pendingCorrection = null;
    markSeen(p.id);
    persistRun();
    if (!silent) Sound.submit();
    renderFeedback(res, !silent);
  }

  function renderFeedback(res, animate) {
    updateHead();
    const isLast = RUN.results.length >= RUN.promptIds.length;
    const p = PROMPTS.get(res.promptId);
    const t = res.tier ? T[res.tier] : null;
    const card = $("#card");
    card.innerHTML = `
      <div class="feedback ${res.tier || "miss"} t-${tierOf(res.tier)}${animate ? "" : " landed"}" id="fb" aria-live="polite">
        <p class="fb-q">${esc(p.text)}</p>
        <div class="fb-answer">${res.answer ? esc(res.answer) : res.raw ? `“${esc(res.raw)}” <span class="muted">isn't in the key</span>` : `<span class="muted">No answer</span>`}</div>
        <div class="fb-tier">${G(res.tier)}<span class="fb-name">${t ? esc(t.name) : "Miss"}</span><span class="fb-points">+${res.score}</span></div>
        ${res.quip ? `<p class="fb-quip">${esc(res.quip)}</p>` : !t ? `<p class="fb-quip">${res.timeout ? "Out of time." : "No gradient, no descent."}</p>` : ""}
        ${res.corrected && res.raw ? `<p class="fb-note">Autocorrected from “${esc(res.raw)}”</p>` : ""}
        ${RUN.mode === "vs" && RUN.opp ? oppLine(RUN.opp, RUN.results.length - 1) : ""}
        <button class="btn primary big" id="next" ${animate ? "disabled" : ""}>${isLast ? "See results" : "Next"}</button>
      </div>`;
    if (RUN.mode === "live") {
      $("#next").outerHTML = `<p class="lv-note" id="live-wait" aria-live="polite"></p>`;
      liveLocalAnswer(res);
      renderLiveWait();
      renderStrip();
    }
    const next = $("#next") || document.createElement("button"), fb = $("#fb");
    next.addEventListener("click", advance);
    const done = () => {
      if (fb.isConnected) fb.classList.add("landed");
      if (next.isConnected) { next.disabled = false; next.focus({ preventScroll: true }); }
    };
    const total = totalScore(RUN.results);
    if (animate && descent) {
      hudRange = [total - res.score, total];
      if (res.tier) Sound.tier(res.tier); else Sound.miss();
      descent.roll(res.tier, res.score, () => { const el = $("#hud-score"); if (el) { el.classList.remove("crank"); void el.offsetWidth; el.classList.add("crank"); } done(); });
      // never hold the player behind the animation
      setTimeout(done, 1500);
    } else { setHud(total); done(); }
  }

  function oppLine(opp, i) {
    const t = opp.tiers[i];
    const pts = T[t] ? T[t].score : 0;
    const mine = totalScore(RUN.results), theirs = tierPoints(opp.tiers.slice(0, i + 1));
    const lead = mine === theirs ? "Level" : mine > theirs ? `You lead by ${mine - theirs}` : `${esc(opp.name)} leads by ${theirs - mine}`;
    return `<p class="fb-opp t-${tierOf(t)}">${G(t)}<span><b>${esc(opp.name)}</b> ${T[t] ? esc(T[t].name) : "missed"} +${pts}</span><span class="lead">${lead}</span></p>`;
  }

  function advance() {
    if (!RUN || RUN.phase !== "feedback" || RUN.mode === "live") return;
    if (RUN.results.length >= RUN.promptIds.length) { RUN.phase = "done"; persistRun(); return finalize(); }
    RUN.round = RUN.results.length;
    startRound();
  }

  function finalize() {
    const score = totalScore(RUN.results);
    const rec = {
      key: RUN.key, mode: RUN.mode, number: RUN.number, date: RUN.date || null, pack: RUN.pack || null,
      label: RUN.label, promptIds: RUN.promptIds, results: RUN.results, score,
      tiers: RUN.results.map((r) => r.tier || "miss"), completedAt: Date.now(),
    };
    if (RUN.mode === "vs") Object.assign(rec, { seed: RUN.seed, n: RUN.n, opp: RUN.opp || null, name: myName() || "You" });
    if (RUN.mode === "practice") {
      const r = RUN.results[0];
      const prev = practiceBest[r.promptId];
      if (!prev || (r.tier && (!T[prev] || T[r.tier].score > T[prev].score))) { practiceBest[r.promptId] = r.tier || "miss"; LS.set("practice", practiceBest); }
      LS.set("lastPractice", rec);
      stopRun();
      return renderResults("practice", rec);
    }
    saveRecord(rec);
    LS.del("run:" + RUN.key);
    const key = RUN.key;
    stopRun();
    go(`results-${slugFor(key)}`);
  }

  // Global keyboard: Enter continues from feedback.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && RUN && RUN.phase === "feedback") {
      const n = $("#next");
      if (n && !n.disabled && document.activeElement !== n) { e.preventDefault(); advance(); }
    }
    if (e.key === "Escape") { closeDrawer(); closeModal(); }
  });

  // ============================================================ results
  function answerKey(p, yourAnswer, open) {
    const counts = Object.fromEntries(E.TIER_IDS.map((t) => [t, 0]));
    p.answers.forEach((a) => counts[a.t]++);
    const gem = p.answers.find((a) => a.t === "mlion");
    const you = yourAnswer ? E.fullKey(yourAnswer) : "";
    return `<details class="key" ${open ? "open" : ""} data-pid="${esc(p.id)}">
      <summary><span class="grow"><b>${esc(p.text)}</b><span class="cnt-s">${fmt(p.answers.length)} answers</span></span>${CHEV}</summary>
      <div class="body">
        ${gem ? `<div class="gem-line">${G("mlion")}<span><b>${esc(gem.a)}</b>${gem.q ? `<span class="gq">${esc(gem.q)}</span>` : ""}</span></div>` : ""}
        <div class="tier-counts">${E.TIERS_BY_SCORE.map((t) => `<span title="${esc(t.name)}">${G(t.id)}${counts[t.id]}</span>`).join("")}</div>
        <input class="search" type="search" placeholder="Search ${fmt(p.answers.length)} answers" aria-label="Search answers" data-you="${esc(you)}">
        <ul class="ans-list"></ul>
        <div class="list-foot"><span class="cnt"></span><button class="linkish more hidden" type="button">Show all</button></div>
      </div>
    </details>`;
  }
  function wireAnswerKeys(root) {
    $$("details.key", root).forEach((d) => {
      const p = PROMPTS.get(d.dataset.pid);
      const input = $(".search", d), list = $(".ans-list", d), cnt = $(".cnt", d), more = $(".more", d);
      const you = input.dataset.you;
      let limit = 120;
      function draw() {
        const q = E.fullKey(input.value);
        const m = q ? p.answers.filter((a) => [a.a].concat(a.aka || []).some((n) => E.fullKey(n).includes(q))) : p.answers;
        const shown = m.slice(0, limit);
        list.innerHTML = shown.map((a) => {
          const isYou = you && [a.a].concat(a.aka || []).some((n) => E.fullKey(n) === you);
          return `<li class="t-${a.t}${isYou ? " you" : ""}">${G(a.t)}
            <span><span class="nm">${esc(a.a)}</span>${isYou ? `<span class="you-tag">You</span>` : ""}
            ${a.aka && a.aka.length ? `<span class="ak">${esc(a.aka.slice(0, 3).join(", "))}</span>` : ""}</span>
            <span class="pt">+${T[a.t].score}</span></li>`;
        }).join("") || `<li><span></span><span class="muted">No matches</span><span></span></li>`;
        cnt.textContent = `${fmt(shown.length)} of ${fmt(m.length)}`;
        more.classList.toggle("hidden", m.length <= limit);
      }
      d.addEventListener("toggle", () => { if (d.open && !list.childElementCount) draw(); });
      input.addEventListener("input", () => { limit = 120; draw(); });
      more.addEventListener("click", () => { limit = Infinity; draw(); });
      if (d.open) draw();
    });
  }

  function renderResults(key, recOverride) {
    const rec = recOverride || records[key];
    if (!rec) return go("home");
    const n = rec.results.length;
    const max = n * 100;
    const band = n === 7 ? E.bandFor(rec.score) : null;
    const scoreTier = band ? band.tier : rec.results[0] && rec.results[0].tier;
    setMid(rec.label);
    const share = E.shareText({ mode: rec.mode, number: rec.number, score: rec.score, tiers: rec.tiers, label: rec.mode === "pack" ? PACKS.get(rec.pack).name : rec.label });
    const isDailyToday = rec.mode === "daily" && rec.date === today();
    const nextHref = rec.mode === "unlimited" ? `#unlimited-${nextUnlimited()}` :
      rec.mode === "pack" ? `#pack-${rec.pack}-${nextPackRun(rec.pack) > E.packRunCount(DATA, rec.pack) ? 1 : nextPackRun(rec.pack)}` :
      rec.mode === "practice" ? "#library" : "#unlimited";
    const nextLabel = rec.mode === "unlimited" ? "Next run" : rec.mode === "pack" ? "Next pack run" : rec.mode === "practice" ? "Library" : "Play Unlimited";
    const accepted = rec.results.filter((r) => r.tier).length;
    const isVs = rec.mode === "vs";
    scene("results");
    app.innerHTML = `<section class="screen results">
      <div class="side">
        <div class="score-hero">
          <p class="label">${esc(rec.label)}${rec.date ? ` · ${esc(prettyDate(rec.date, { month: "short", day: "numeric" }))}` : ""}</p>
          <div class="score-big">${rec.score}<small>/${max}</small></div>
          ${isVs && rec.opp ? (() => { const me = rec.score, them = tierPoints(rec.opp.tiers); return `<p class="band ${me >= them ? "t-mlion" : ""}">${me === them ? "Draw" : me > them ? "You win" : `${esc(rec.opp.name)} wins`} · ${me} vs ${them}</p>`; })() : band ? `<p class="band t-${band.tier}">${esc(band.name)}</p>` : ""}
          ${tiersRow(rec.tiers, "grid-tiers")}
          <p class="loss-line">Loss ${((max - rec.score) / 100).toFixed(2)} · ${accepted} of ${n} accepted</p>
          <div class="btn-row">
            ${isVs ? `<button class="btn primary big" id="send-vs">${rec.opp ? "Send result back" : "Send my score"}</button>
              <a class="btn big" href="#challenge">New challenge</a>` : `${rec.mode !== "practice" ? `<button class="btn primary big" id="share">Share</button>` : ""}
            <a class="btn big" href="${nextHref}">${esc(nextLabel)}</a>`}
          </div>
          ${isDailyToday ? `<p class="countdown">Next descent in <b id="cd">${hhmmss(E.msUntilLocalMidnight())}</b></p>` : ""}
        </div>
      </div>
      <div class="main">
        ${isVs && rec.opp ? duelBoard(rec.promptIds, { name: rec.name || "You", tiers: rec.tiers, you: true }, rec.opp) : ""}
        ${n > 1 ? `<figure class="profile-wrap">${V.profileSvg(rec.results, `Your descent: loss ${((max - rec.score) / 100).toFixed(2)}`)}</figure>` : ""}
        <section>
          <h2 class="block-title">Your answers</h2>
          <ul class="run-list">${rec.results.map((r) => `
            <li class="run-item t-${tierOf(r.tier)}">${G(r.tier)}
              <span><span class="q">${esc(r.promptText)}</span>
                <span class="a ${r.answer ? "" : "missed"}">${r.answer ? esc(r.answer) : r.raw ? `“${esc(r.raw)}”` : "No answer"}</span></span>
              <span class="pts">+${r.score}</span>
            </li>`).join("")}</ul>
        </section>
        <section>
          <h2 class="block-title">Answer keys</h2>
          ${rec.promptIds.map((id, i) => PROMPTS.has(id) ? answerKey(PROMPTS.get(id), rec.results[i] && rec.results[i].answer, rec.mode === "practice") : "").join("")}
        </section>
        <div class="btn-row">
          <a class="btn" href="#home">Home</a>
          <a class="btn" href="#stats">Stats</a>
          <a class="btn" href="#archive">Archive</a>
        </div>
      </div>
    </section>`;
    wireAnswerKeys(app);
    const sb = $("#share");
    if (sb) sb.addEventListener("click", async () => {
      const url = settings.shareLink ? siteUrl() : "";
      const text = url ? `${share}\n\n${url}` : share;
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
      }
      if (await copyText(text)) return toast("Copied to clipboard");
      showModal("Share your run", `<p class="muted">Copying is blocked here. Select the text and copy it.</p>
        <textarea class="search share-box" id="share-box" readonly aria-label="Share text">${esc(text)}</textarea>`);
      const box = $("#share-box"); box.focus(); box.select();
    });
    if (isDailyToday) every(1000, () => { const el = $("#cd"); if (el) el.textContent = hhmmss(E.msUntilLocalMidnight()); });
    const sv = $("#send-vs");
    if (sv) sv.addEventListener("click", () => {
      const me = { name: rec.name || myName() || "A friend", tiers: rec.tiers };
      const players = rec.opp ? [rec.opp, me] : [me];
      const link = challengeLink(rec.seed, rec.n, players);
      const text = rec.opp ? `I scored ${rec.score} vs your ${tierPoints(rec.opp.tiers)} on MLion. See it:` : `Beat my ${rec.score} on MLion. Same ${rec.n} questions:`;
      shareLink(`${text}\n${link}`);
    });
  }

  async function shareLink(text) {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    if (await copyText(text)) return toast("Link copied. Send it to your friend");
    showModal("Send this to your friend", `<p class="muted">Copying is blocked here. Select the text and copy it.</p>
      <textarea class="search share-box" id="share-box" readonly aria-label="Challenge link">${esc(text)}</textarea>`);
    const box = $("#share-box"); box.focus(); box.select();
  }

  /** Head-to-head table: winner, both scores, question by question. */
  function duelBoard(promptIds, a, b) {
    const sa = tierPoints(a.tiers), sb = tierPoints(b.tiers);
    const head = sa === sb ? "It's a draw" : `${esc(sa > sb ? a.name : b.name)} wins`;
    return `<section class="duel" aria-label="Head to head">
      <h2 class="duel-head">${head}</h2>
      <div class="duel-scores">
        <div class="${sa >= sb ? "win" : ""}"><b>${sa}</b><span>${esc(a.name)}${a.you && a.name !== "You" ? " (you)" : ""}</span></div>
        <span class="duel-v">vs</span>
        <div class="${sb >= sa ? "win" : ""}"><b>${sb}</b><span>${esc(b.name)}${b.you && b.name !== "You" ? " (you)" : ""}</span></div>
      </div>
      <ul class="duel-rows">${promptIds.map((id, i) => {
        const p = PROMPTS.get(id);
        const ta = a.tiers[i], tb = b.tiers[i];
        const pa = T[ta] ? T[ta].score : 0, pb = T[tb] ? T[tb].score : 0;
        return `<li><span class="dq">${esc(p ? p.text : id)}</span>
          <span class="dc t-${tierOf(ta)}${pa > pb ? " win" : ""}">${G(ta)}<b>${pa}</b></span>
          <span class="dc t-${tierOf(tb)}${pb > pa ? " win" : ""}">${G(tb)}<b>${pb}</b></span></li>`;
      }).join("")}</ul>
    </section>`;
  }

  /** A finished duel opened from a link (both results inside it). */
  function renderDuel(c, a, b, bIsMe) {
    setMid("Head to head");
    scene("results");
    app.innerHTML = `<section class="screen results">
      <div class="side">
        <div class="page-head"><h1>Head to head</h1><p>${c.n} questions, same for both.</p></div>
        <div class="btn-row">
          ${bIsMe ? `<button class="btn primary big" id="send-vs">Send result back</button>` : ""}
          <a class="btn${bIsMe ? "" : " primary"} big" href="#challenge">Rematch</a>
        </div>
      </div>
      <div class="main">${duelBoard(challengePromptIds(c.seed, c.n), bIsMe ? { ...b, you: true } : a, bIsMe ? a : b)}</div>
    </section>`;
    const sv = $("#send-vs");
    if (sv) sv.addEventListener("click", () => shareLink(`I scored ${tierPoints(b.tiers)} vs your ${tierPoints(a.tiers)} on MLion. See it:\n${challengeLink(c.seed, c.n, [a, b])}`));
  }

  /** Pick a size and a name, then play first. */
  function renderChallenge() {
    setMid("Challenge");
    let size = LS.get("vsSize", 5);
    if (!VS_SIZES.includes(size)) size = 5;
    app.innerHTML = `<section class="screen challenge">
      <div class="page-head"><h1>Challenge a friend</h1><p>Play first, then send one link. Your friend plays the same questions and sees who won. No accounts.</p></div>
      <div class="vs-form">
        <label class="vs-field"><span>Your name</span><input class="search" id="vs-name" maxlength="16" autocomplete="nickname" placeholder="So your friend knows" value="${esc(myName())}"></label>
        <div class="vs-field"><span>Questions</span><div class="vs-sizes" role="radiogroup" aria-label="Number of questions">${VS_SIZES.map((n) => `<button type="button" class="vs-size${n === size ? " on" : ""}" role="radio" aria-checked="${n === size}" data-n="${n}">${n}</button>`).join("")}</div></div>
        <button class="btn primary big" id="vs-go">Start</button>
      </div>
    </section>`;
    $$(".vs-size").forEach((b) => b.addEventListener("click", () => {
      size = +b.dataset.n;
      $$(".vs-size").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); });
    }));
    $("#vs-go").addEventListener("click", () => {
      LS.set("name", $("#vs-name").value.trim().slice(0, 16));
      LS.set("vsSize", size);
      const seed = Math.random().toString(36).slice(2, 9).padEnd(6, "0");
      go(`vs-${seed}-${size}`);
    });
  }

  // =========================================================== unlimited
  function renderUnlimited() {
    setMid("Unlimited");
    const runs = Object.values(records).filter((r) => r.mode === "unlimited").sort((a, b) => b.number - a.number);
    const next = nextUnlimited();
    const inProg = LS.get(`run:unlimited:${next}`);
    const avg = runs.length ? Math.round(runs.reduce((s, r) => s + r.score, 0) / runs.length) : 0;
    const best = runs.reduce((m, r) => Math.max(m, r.score), 0);
    app.innerHTML = `<section class="screen ${runs.length ? "split" : ""}">
      <div class="side">
        <div class="page-head"><h1>Unlimited</h1><p>Runs of seven from all ${DATA.prompts.length} prompts.</p></div>
        ${runs.length ? `<div class="figures"><div class="figure"><b>${runs.length}</b><span>Runs</span></div><div class="figure"><b>${avg}</b><span>Average</span></div><div class="figure"><b>${best}</b><span>Best</span></div></div>` : ""}
        <div><a class="btn primary big" href="#unlimited-${next}">${inProg ? `Resume run ${next}` : `Start run ${next}`}</a></div>
      </div>
      ${runs.length ? `<div class="main"><ul class="list">${runs.slice(0, 50).map((r) => `
        <li><a class="list-item" href="#results-${slugFor(r.key)}"><span class="main"><span class="title">Run ${r.number}</span><span class="sub">${tiersRow(r.tiers)}</span></span><span class="right"><b>${r.score}</b></span></a></li>`).join("")}</ul></div>` : ""}
    </section>`;
  }

  // =============================================================== packs
  function renderPacks() {
    setMid("Packs");
    app.innerHTML = `<section class="screen split">
      <div class="side"><div class="page-head"><h1>Packs</h1><p>${DATA.packs.length} corners of the field, seven prompts a run.</p></div></div>
      <div class="main"><ul class="list big">${DATA.packs.map((pk) => {
        const count = DATA.prompts.filter((p) => p.pack === pk.id).length;
        const runs = E.packRunCount(DATA, pk.id);
        const done = Array.from({ length: runs }, (_, i) => records[`pack:${pk.id}:${i + 1}`]).filter(Boolean).length;
        return `<li><a class="list-item" href="#pack-${pk.id}">
          <span class="main"><span class="title">${esc(pk.name)}</span><span class="sub">${count} prompts · ${done} of ${runs} ${runs === 1 ? "run" : "runs"}</span>
          <span class="progress" aria-hidden="true"><i style="width:${(100 * done / runs).toFixed(0)}%"></i></span></span>
          ${CHEV.replace('class="chev"', 'class="chev go-r"')}</a></li>`;
      }).join("")}</ul></div>
    </section>`;
  }
  function renderPack(id) {
    const pk = PACKS.get(id);
    setMid(pk.name);
    const prompts = DATA.prompts.filter((p) => p.pack === id);
    const runs = E.packRunCount(DATA, id);
    app.innerHTML = `<section class="screen split">
      <div class="side">
        <div class="page-head"><h1>${esc(pk.name)}</h1><p>${esc(pk.tagline)}</p></div>
        <div class="figures"><div class="figure"><b>${prompts.length}</b><span>Prompts</span></div><div class="figure"><b>${fmt(prompts.reduce((s, p) => s + p.answers.length, 0))}</b><span>Answers</span></div></div>
        <div><a class="btn ghost" href="#packs">All packs</a></div>
      </div>
      <div class="main"><ul class="list big">${Array.from({ length: runs }, (_, i) => {
        const n = i + 1, rec = records[`pack:${id}:${n}`], prog = LS.get(`run:pack:${id}:${n}`);
        const ids = E.packPromptIds(DATA, id, n);
        return `<li><a class="list-item" href="#${rec ? `results-${slugFor(rec.key)}` : `pack-${id}-${n}`}">
          <span class="main"><span class="title">Run ${n}</span><span class="sub">${rec ? tiersRow(rec.tiers) : `${ids.length} prompts${prog ? " · in progress" : ""}`}</span></span>
          <span class="right">${rec ? `<b>${rec.score}</b>/${ids.length * 100}` : `<span class="go">${prog ? "Resume" : "Play"}</span>`}</span></a></li>`;
      }).join("")}</ul></div>
    </section>`;
  }

  // ============================================================= archive
  function renderArchive() {
    setMid("Archive");
    const n = todayNumber();
    const rows = [];
    for (let d = n; d >= 1; d--) {
      const date = E.dateForDay(d);
      const rec = records[`daily:${date}`] || records[`archive:${date}`];
      const prog = !rec && (LS.get(`run:daily:${date}`) || LS.get(`run:archive:${date}`));
      rows.push(`<li><a class="list-item" href="#${rec ? `results-${slugFor(rec.key)}` : d === n ? "daily" : `archive-${date}`}">
        <span class="main"><span class="title">MLion #${d}${d === n ? " · Today" : ""}</span><span class="sub">${rec ? tiersRow(rec.tiers) : esc(prettyDate(date))}${prog ? " · in progress" : ""}</span></span>
        <span class="right">${rec ? `<b>${rec.score}</b>/700` : `<span class="go">Play</span>`}</span></a></li>`);
    }
    app.innerHTML = `<section class="screen split">
      <div class="side"><div class="page-head"><h1>Archive</h1><p>Replay any past day. It won't touch your streak.</p></div></div>
      <div class="main"><ul class="list big">${rows.join("")}</ul></div>
    </section>`;
  }

  // ============================================================= library
  function renderLibrary() {
    setMid("Library");
    const total = DATA.prompts.reduce((s, p) => s + p.answers.length, 0);
    app.innerHTML = `<section class="screen split">
      <div class="side">
        <div class="page-head"><h1>Library</h1><p>${DATA.prompts.length} prompts, ${fmt(total)} answers. Keys open once you've played a prompt.</p></div>
        <input class="search" id="lib-q" type="search" placeholder="Filter prompts" aria-label="Filter prompts">
      </div>
      <div class="main" id="lib"></div>
    </section>`;
    const draw = () => {
      const q = E.fullKey($("#lib-q").value);
      const hit = (p) => !q || E.fullKey(p.text).includes(q);
      const row = (p) => {
        const best = practiceBest[p.id];
        const unlocked = seen.has(p.id);
        return `<li class="list-item lib-row">
            <span class="main"><span class="title">${esc(p.text)}</span><span class="sub">${fmt(p.answers.length)} answers${best ? ` · best ${G(best)}` : ""}</span></span>
            <span class="row"><a class="btn sm" href="#practice-${p.id}">Play</a>${unlocked ? `<a class="btn sm" href="#answers-${p.id}">Key</a>` : `<span class="locked" title="Play it once to unlock the key" aria-label="Key locked">${LOCK}</span>`}</span>
          </li>`;
      };
      const extras = EXTRAS.filter(hit);
      $("#lib").innerHTML = (DATA.packs.map((pk) => {
        const ps = DATA.prompts.filter((p) => p.pack === pk.id && hit(p));
        if (!ps.length) return "";
        return `<section class="lib-pack"><h2>${esc(pk.name)}</h2><ul class="list">${ps.map(row).join("")}</ul></section>`;
      }).join("") + (extras.length ? `<section class="lib-pack"><h2>Off-topic extras</h2><p class="muted">AI trivia, not ML. Practice only; never in a run.</p><ul class="list">${extras.map(row).join("")}</ul></section>` : "")) || `<p class="muted">No prompts match.</p>`;
    };
    $("#lib-q").addEventListener("input", draw);
    draw();
  }
  function renderAnswersPage(id) {
    const p = PROMPTS.get(id);
    setMid("Answer key");
    if (!seen.has(id)) {
      app.innerHTML = `<section class="screen"><div class="page-head"><h1>Locked</h1><p>Play “${esc(p.text)}” once to open its key.</p></div><a class="btn primary big" href="#practice-${id}">Practice it</a></section>`;
      return;
    }
    app.innerHTML = `<section class="screen narrow"><div class="page-head"><h1>Answer key</h1></div>${answerKey(p, null, true)}<a class="btn ghost" href="#library">Library</a></section>`;
    wireAnswerKeys(app);
  }

  // =============================================================== stats
  function renderStats() {
    setMid("Stats");
    const s = statsSummary();
    const tierMax = Math.max(1, ...Object.values(s.tierCounts));
    const bandMax = Math.max(1, ...s.bands.map((b) => b.n));
    const figs = [["Played", s.played], ["Average", s.avg || "—"], ["Best", s.best || "—"], ["Streak", s.cur], ["Max streak", s.max], ["Gems", s.gems]];
    app.innerHTML = `<section class="screen split">
      <div class="side">
        <div class="page-head"><h1>Stats</h1><p>Daily descents, kept in this browser.</p></div>
        <div class="stat-grid">${figs.map(([l, v]) => `<div class="figure"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
      </div>
      <div class="main">
        <section><h2 class="block-title">Score bands</h2><div class="bars">${s.bands.slice().reverse().map((b) => `
          <div class="bar-row t-${b.tier}"><span class="lab"><span>${esc(b.name)}</span><span class="muted">${b.range}</span></span><span class="tr"><i style="width:${(100 * b.n / bandMax).toFixed(0)}%"></i></span><span class="v">${b.n}</span></div>`).join("")}</div></section>
        <section><h2 class="block-title">Tiers landed</h2><div class="bars">${[...E.TIERS_BY_SCORE.map((t) => t.id), "miss"].map((t) => `
          <div class="bar-row t-${t}"><span class="lab">${G(t === "miss" ? null : t)}${t === "miss" ? "Miss" : esc(T[t].name)}</span><span class="tr"><i style="width:${(100 * s.tierCounts[t] / tierMax).toFixed(0)}%"></i></span><span class="v">${s.tierCounts[t]}</span></div>`).join("")}</div></section>
      </div>
    </section>`;
  }

  // ======================================================== how / faq
  function howHtml() {
    return `<div class="how">
      <ul class="beats">
        <li><b>7</b><span>prompts a day</span></li>
        <li><b>3 s</b><span>to read</span></li>
        <li><b>25 s</b><span>to answer</span></li>
      </ul>
      <p>Type any valid answer. Wrong ones bounce, so keep trying. Near misses get a “did you mean”. Rarer answers roll deeper:</p>
      ${depthList()}
      <p class="muted">Loss starts at 7.00 and falls by points ÷ 100. Max 700 a day.</p>
    </div>`;
  }
  function renderHow() {
    setMid("How to play");
    app.innerHTML = `<section class="screen narrow"><div class="page-head"><h1>How to play</h1></div>${howHtml()}
      <a class="btn primary big" href="#daily">Play today</a></section>`;
  }
  function renderFaq() {
    setMid("FAQ");
    const total = DATA.prompts.reduce((s, p) => s + p.answers.length, 0);
    app.innerHTML = `<section class="screen narrow"><div class="page-head"><h1>FAQ</h1></div>
      <dl class="faq">
        <dt>Where do the answers come from?</dt>
        <dd>Framework docs, papers, textbooks and model cards, cleaned up, with aliases so short and long names both count. ${fmt(total)} answers in all.</dd>
        <dt>How is rarity decided?</dt>
        <dd>By how many ML people would think of it in 25 seconds. Tiers are fixed, so a score never changes.</dd>
        <dt>Why isn't the lion the most obscure answer?</dt>
        <dd>It's picked for delight: a real answer that a few strong players land.</dd>
        <dt>My answer is real but wasn't accepted.</dt>
        <dd>Then the set is missing it. <a href="${REPO_URL}/issues" target="_blank" rel="noopener">Open an issue</a> with the prompt and your answer.</dd>
        <dt>When does it reset?</dt>
        <dd>At local midnight. Everyone gets the same seven.</dd>
        <dt>Is anything tracked?</dt>
        <dd>No. Runs, streaks and settings stay in this browser.</dd>
      </dl></section>`;
  }

  // ============================================================ settings
  function renderSettings() {
    setMid("Settings");
    const items = [
      ["previewCorrections", "Confirm autocorrect", "Off accepts corrections at once"],
      ["clearRejected", "Clear wrong answers", ""],
      ["sound", "Sound", ""],
      ["reducedMotion", "Reduce motion", ""],
      ["shareLink", "Add a link when sharing", ""],
      ["aiCheck", "Ask Claude when nothing matches", "Uses your Claude usage. You confirm every match."],
    ];
    app.innerHTML = `<section class="screen split">
      <div class="side"><div class="page-head"><h1>Settings</h1></div></div>
      <div class="main">
        <div class="settings-list">${items.map(([k, t, d]) => `
          <label class="setting" ${k === "aiCheck" ? `id="ai-setting" ${aiUsable() ? "" : "hidden"}` : ""}><span class="txt"><span class="t">${esc(t)}</span>${d ? `<span>${esc(d)}</span>` : ""}</span>
            <span class="switch"><input type="checkbox" role="switch" data-k="${k}" ${settings[k] ? "checked" : ""}><i></i></span></label>`).join("")}</div>
        <section><h2 class="block-title">Progress</h2><p class="muted" style="margin-top:8px">Move your history to another browser.</p>
          <div class="btn-row" style="margin-top:20px"><button class="btn" id="exp">Export</button><button class="btn" id="imp">Import</button><button class="btn danger" id="reset">Reset all</button></div></section>
      </div>
    </section>`;
    $$("input[data-k]").forEach((i) => i.addEventListener("change", () => { settings[i.dataset.k] = i.checked; saveSettings(); }));
    $("#exp").addEventListener("click", async () => {
      const blob = JSON.stringify({ v: 1, records, seen: [...seen], practice: practiceBest, settings });
      toast((await copyText(blob)) ? "Progress copied. Paste it into Import elsewhere" : "Couldn't copy");
    });
    $("#imp").addEventListener("click", () => {
      showModal("Import progress", `<p class="muted">Paste exported progress. The higher score wins on a clash.</p>
        <textarea id="imp-t" class="search area" aria-label="Exported progress"></textarea>
        <div class="btn-row"><button class="btn primary big" id="imp-go">Import</button></div>`);
      $("#imp-go").addEventListener("click", () => {
        try {
          const d = JSON.parse($("#imp-t").value);
          let n = 0;
          for (const [k, r] of Object.entries(d.records || {})) {
            if (!r || !Array.isArray(r.results)) continue;
            if (!records[k] || records[k].score < r.score) { records[k] = r; n++; }
          }
          LS.set("records", records);
          (d.seen || []).forEach((id) => seen.add(id)); LS.set("seen", [...seen]);
          closeModal(); toast(`Imported ${n} run${n === 1 ? "" : "s"}`);
        } catch { toast("That doesn't look like MLion progress"); }
      });
    });
    $("#reset").addEventListener("click", () => {
      showModal("Reset all progress?", `<p class="muted">Every run, streak and stat in this browser goes. This can't be undone.</p>
        <div class="btn-row"><button class="btn" id="rs-no">Keep it</button><button class="btn danger" id="rs-yes">Delete everything</button></div>`);
      $("#rs-no").addEventListener("click", closeModal);
      $("#rs-yes").addEventListener("click", () => {
        try { Object.keys(localStorage).filter((k) => k.startsWith("mlion:")).forEach((k) => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
        records = {}; seen = new Set(); practiceBest = {};
        closeModal(); toast("All progress reset"); go("home");
      });
    });
  }

  // ======================================================= drawer/modal
  function openDrawer() { document.body.classList.add("drawer-open"); $("#drawer").setAttribute("aria-hidden", "false"); }
  function closeDrawer() { document.body.classList.remove("drawer-open"); $("#drawer").setAttribute("aria-hidden", "true"); }
  function showModal(title, html) {
    const m = $("#modal");
    m.innerHTML = `<div class="modal-backdrop" id="mb"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" id="mclose" aria-label="Close">${XICON}</button></div>${html}</div></div>`;
    $("#mclose").addEventListener("click", closeModal);
    $("#mb").addEventListener("click", (e) => { if (e.target.id === "mb") closeModal(); });
    $("#mclose").focus();
  }
  function closeModal() { $("#modal").innerHTML = ""; }
  function showHowModal() {
    showModal("How to play", howHtml() + `<div class="btn-row"><button class="btn primary big block" id="how-go">Got it</button></div>`);
    $("#how-go").addEventListener("click", closeModal);
    $("#how-go").focus();
  }

  $("#menu-btn").addEventListener("click", openDrawer);
  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#brand").addEventListener("click", () => go("home"));

  // A phone keyboard shrinks the visual viewport (on iOS only that), so flag it
  // and let the play screen fold the stage to keep the prompt and input in view.
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const kb = () => document.documentElement.classList.toggle("kb", window.innerHeight - vv.height > 140);
    vv.addEventListener("resize", kb);
    kb();
  }

  V.initBackdrop();
  route();
})();
