/* MLion — app shell, round state machine and screens. */
(function () {
  "use strict";
  const E = window.MLION_ENGINE;
  const V = window.MLION_VISUALS;
  const DATA = window.MLION_DATA;
  const EXTRAS = DATA.extras || []; // off-topic prompts: practice only, never in a run
  const REASONING = (DATA.reasoning || []).map((r) => ({ id: r.id, text: r.q, title: r.title, cat: r.cat, lvl: r.lvl, reasoning: true,
    answers: [{ a: r.options[r.answer], t: "baseline", q: r.why }] }));
  const PROMPTS = new Map(DATA.prompts.concat(EXTRAS, REASONING).map((p) => [p.id, p]));
  // Core questions follow the IOAI syllabus. Extra ones (display.json `extra`, plus the off-topic
  // extras) join only a player's own Unlimited and Quiz runs, when Settings → Extra questions is on.
  // The daily, challenges and live rooms always deal from the core set, so everyone shares it.
  const CORE = { version: `${DATA.version}:core`, packs: DATA.packs, prompts: DATA.prompts.filter((p) => !p.extra), reasoning: DATA.reasoning || [] };
  const WIDE = { version: `${DATA.version}:wide`, packs: DATA.packs, prompts: DATA.prompts.concat(EXTRAS), reasoning: DATA.reasoning || [] };
  const EXTRA_COUNT = WIDE.prompts.length - CORE.prompts.length;
  const soloPool = () => (settings.extraQuestions ? WIDE : CORE);
  // The prompts a day's daily deals from: those added on or before it, so adding prompts later
  // never changes a day that has already been dealt (or is being played right now).
  function asOf(data, date) {
    const prompts = data.prompts.filter((p) => !p.added || p.added <= date);
    const all = data.reasoning || [];
    const reasoning = all.filter((r) => !r.added || r.added <= date);
    if (prompts.length === data.prompts.length && reasoning.length === all.length) return data;
    const upTo = prompts.concat(reasoning).reduce((m, p) => (p.added && p.added > m ? p.added : m), "");
    return { version: `${data.version}:asof${upTo}`, packs: data.packs, prompts, reasoning };
  }
  // ---- the shared dailies' questions (data/daily.json)
  // The daily and the Daily Quiz deal only from a hand-picked pool that a typical IOAI contestant
  // can answer at once; the rest of the core set stays in Unlimited, Quiz and live rooms.
  const POOL = new Set(((DATA.daily && DATA.daily.pool) || CORE.prompts.map((p) => p.id)).filter((id) => PROMPTS.has(id)));
  const DAILY = { version: `${CORE.version}:daily`, packs: CORE.packs, prompts: CORE.prompts.filter((p) => POOL.has(p.id)), reasoning: CORE.reasoning };
  // Launch week: the first seven days after launch, hand-picked, in order.
  const LAUNCH_DAYS = ((DATA.daily && DATA.daily.launch) || []).map((ids) => ids.filter((id) => POOL.has(id)));
  const LAUNCH_IDS = new Set(LAUNCH_DAYS.flat());
  // Before launch: the whole pool, fresh each day (the deal counts days from PRE_FROM).
  const PRE_FROM = "2026-11-05";
  const preLaunch = (date) => !E.LAUNCH || date < E.LAUNCH;
  const preDay = (date) => Math.max(1, E.daysBetween(PRE_FROM, date) + 1);
  function dailyIds(date) {
    if (preLaunch(date)) return E.runFor(DAILY, "prelaunch-v2", preDay(date), null, true);
    const n = E.dayNumberFor(date);
    if (n <= LAUNCH_DAYS.length) return LAUNCH_DAYS[n - 1];
    // after the launch week, the usual shuffle; its first pass deals the pool prompts the week didn't use
    return E.runFor(asOf(DAILY, date), "daily-v4", n - LAUNCH_DAYS.length, null, true, LAUNCH_IDS);
  }
  /** MLion #n for a date: #1 every day until launch, then counted from launch day. */
  const dayNo = (date) => Math.max(1, E.dayNumberFor(date));
  const PACKS = new Map(DATA.packs.map((p) => [p.id, p]));
  const T = E.TIERS;
  // Launch mode: the daily, endless Unlimited, live rooms and challenges. Packs and
  // the Library let people pick questions (and read a key, then replay), which turns
  // the game into memorising, so they stay hidden. true brings them back unchanged.
  const BROWSE = false;
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
  /** The one-line explanation an answer carries in the key (about a quarter of answers have one). */
  function explainOf(promptId, name) {
    const p = PROMPTS.get(promptId);
    const a = p && name ? p.answers.find((x) => x.a === name) : null;
    return a && a.q ? a.q : null;
  }
  const tiersRow = (tiers, cls = "") =>`<span class="tiers ${cls}" role="img" aria-label="${esc(tiers.map((t) => (T[t] ? T[t].name : "Miss")).join(", "))}">${tiers.map((t) => G(t)).join("")}</span>`;
  const CHEV = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
  const LOCK = `<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
  const DUO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.2 19.5c0-3.3 2.6-5.6 5.8-5.6s5.8 2.3 5.8 5.6"/><circle cx="16.8" cy="8.6" r="2.6"/><path d="M16.9 13.9c2.3.3 3.9 2.3 3.9 5.1"/></svg>`;
  const XICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  // ---- quiz marks: a right answer in a quiz run carries one neutral tier, only to colour the
  // descent; it says nothing about rarity (every right answer scores the same 100).
  const QUIZ_TIER = "indist";
  const isQuizMode = (m) => m === "quiz" || m === "vq" || m === "dquiz";
  /** "a loss function": what a prompt asks for, for labelling a wrong option by where it belongs. */
  const kindOf = (id) => { const p = PROMPTS.get(id); return p ? p.text.replace(/^Name\s+/i, "") : "something else"; };
  const fromLabel = (q, k) => (q.from && q.from[k] ? `<span class="mcq-from">That's ${esc(kindOf(q.from[k]))}</span>` : "");
  /** The clock for a quiz question: a reasoning one gets E.REASONING_CLOCK times the base. */
  const qMs = (q, base) => (q && q.reasoning ? Math.round(base * E.REASONING_CLOCK) : base);
  const qmark = (ok, cls = "") => `<svg class="glyph qm ${ok ? "t-" + QUIZ_TIER : "t-miss"} ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ok ? `<path d="M4.5 12.5l4.8 4.8L19.5 6.8"/>` : `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`}</svg>`;
  const qmarksRow = (oks, cls = "") => `<span class="tiers ${cls}" role="img" aria-label="${oks.filter(Boolean).length} of ${oks.length} right">${oks.map((ok) => qmark(ok)).join("")}</span>`;
  /** What a quiz result card says in one word. */
  const quizVerdict = (res) => (res.score > 0 ? "Correct" : res.timeout ? "Out of time" : "Not quite");
  /** Quiz duels: picks are one digit per question (0 none, 1 to 4 the option), so either side's score is recomputed from the seed. */
  const quizPts = (quiz, picks) => picks.reduce((s, p, i) => s + (quiz[i] && p - 1 === quiz[i].correct ? E.QUIZ_POINTS : 0), 0);
  /** Negative when `a` is ahead: more points, then less total time. */
  const quizCompare = (quiz, a, b) => (quizPts(quiz, b.picks) - quizPts(quiz, a.picks)) || (a.tenths - b.tenths);
  const fmtSecs = (tenths) => `${(tenths / 10).toFixed(1)} s`;
  /** What the page backdrop shows: the full surface at home, a horizon elsewhere. */
  function scene(view, opts) { document.body.dataset.view = view; if (V.scene) V.scene(view, opts); }
  /** The six tiers, each set as deep as it scores. */
  const DEPTH_LINES = { baseline: "The answer everyone blurts out.", overfit: "The famous obscure pick.", indist: "Right in the fat middle.", outlier: "Genuinely uncommon.", longtail: "Few sample this far out.", mlion: "The global minimum." };
  function depthList(lines = false) {
    const order = E.TIERS_BY_SCORE.slice().reverse();
    return `<ol class="depths" aria-label="Rarity tiers">${order.map((t, i) => `<li class="t-${t.id}" style="--d:${(i / (order.length - 1)).toFixed(2)}">${G(t.id)}<span class="n">${esc(t.name)}${lines ? `<small>${DEPTH_LINES[t.id]}</small>` : ""}</span><span class="p">+${t.score}</span></li>`).join("")}</ol>`;
  }

  // ------------------------------------------------------------ storage
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("mlion:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("mlion:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem("mlion:" + k); } catch { /* ignore */ } },
  };
  // Launch reset (the user, 2026-11-05: "we need to clear beta players"). The first visit after this ships drops
  // everything the beta saved in this browser, once: runs, records, streaks, sprint bests, name and sign-in.
  // Settings stay. Browsers driven by tests (navigator.webdriver) are skipped unless MLION_RESET_TEST is set:
  // the data a test stores before loading the page is the point of that test.
  const RESET_ID = "launch-2026-11";
  try {
    if (localStorage.getItem("mlion:reset") !== RESET_ID && !(navigator.webdriver && !window.MLION_RESET_TEST)) {
      Object.keys(localStorage).filter((k) => k.startsWith("mlion:") && k !== "mlion:settings").forEach((k) => localStorage.removeItem(k));
      localStorage.setItem("mlion:reset", RESET_ID);
    }
  } catch { /* storage unavailable */ }
  // The admin panel (#admin) sets three things everyone's game reads: the launch day (MLion #1), a home banner, and
  // `reset_at`, the moment an admin reset every player. They live in one public row (Supabase app_config), cached
  // here so the day number is right from the first paint; cfgFetch() refreshes it after start.
  const CFG_KEEP = new Set(["mlion:settings", "mlion:reset", "mlion:cfg", "mlion:since"]);
  let CFG = LS.get("cfg", null) || {};
  E.setLaunch(CFG.launch);
  function wipeLocal(keep = (k) => CFG_KEEP.has(k)) {
    try { Object.keys(localStorage).filter((k) => k.startsWith("mlion:") && !keep(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* storage unavailable */ }
  }
  /** An admin reset everyone after this browser's progress began (`mlion:since`). Test browsers are left alone. */
  const resetDue = (c) => !!(c && c.reset_at) && !(navigator.webdriver && !window.MLION_RESET_TEST)
    && Date.parse(c.reset_at) > Date.parse(LS.get("since", "") || "1970-01-01T00:00:00Z");
  try {
    if (!LS.get("since", "")) { // progress from before this shipped counts as old
      const old = Object.keys(localStorage).some((k) => k.startsWith("mlion:") && !CFG_KEEP.has(k) && k !== "mlion:seenHow");
      LS.set("since", old ? "1970-01-01T00:00:00Z" : new Date().toISOString());
    }
    if (resetDue(CFG)) { wipeLocal(); LS.set("since", new Date().toISOString()); }
  } catch { /* storage unavailable */ }
  const sysReduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const DEFAULTS = { previewCorrections: true, clearRejected: false, sound: true, haptics: true, reducedMotion: sysReduced, shareLink: true, aiCheck: true, answerSecs: 25, extraQuestions: false };
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
    // Everything is synthesised here (no audio files): bells from FM pairs, whooshes from filtered
    // noise, a soft thump for the ball landing, all through one compressor and a short generated room.
    let ctx = null, bus = null, room = null, noiseBuf = null;
    function ac() {
      if (!settings.sound) return null;
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
        const master = ctx.createGain(); master.gain.value = 0.9;
        bus = ctx.createGain(); bus.connect(comp).connect(master).connect(ctx.destination);
        // a small room: a second of decaying stereo noise as the impulse, mixed in quietly
        const len = Math.round(ctx.sampleRate * 1.1), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
        const conv = ctx.createConvolver(); conv.buffer = ir;
        room = ctx.createGain(); room.gain.value = 0.22; room.connect(conv).connect(comp);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    const at = (c, o) => c.currentTime + 0.005 + (o.delay || 0);
    function out(c, node, wet) { node.connect(bus); if (wet) { const s = c.createGain(); s.gain.value = wet; node.connect(s).connect(room); } }
    function env(c, g, t0, vol, attack, dur) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    /** A warm voice: two detuned oscillators through a lowpass that closes as the note dies. */
    function voice(freq, dur, o = {}) {
      const c = ac(); if (!c) return;
      const t0 = at(c, o), g = c.createGain(), f = c.createBiquadFilter();
      f.type = "lowpass"; f.Q.value = 0.8;
      f.frequency.setValueAtTime(o.bright || 4200, t0); f.frequency.exponentialRampToValueAtTime(Math.max(200, (o.bright || 4200) * 0.25), t0 + dur);
      for (const cents of o.detune === 0 ? [0] : [-(o.detune || 7), o.detune || 7]) {
        const osc = c.createOscillator(); osc.type = o.type || "triangle"; osc.detune.value = cents;
        osc.frequency.setValueAtTime(freq, t0);
        if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * o.slide), t0 + dur);
        osc.connect(f); osc.start(t0); osc.stop(t0 + dur + 0.05);
      }
      env(c, g, t0, o.vol || 0.05, o.attack || 0.008, dur);
      out(c, f.connect(g), o.wet == null ? 0.5 : o.wet);
    }
    /** A glassy bell: a sine carrier whose FM modulator (ratio 3.5) fades, so the strike is bright and the tail pure. */
    function bell(freq, dur, o = {}) {
      const c = ac(); if (!c) return;
      const t0 = at(c, o), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
      car.frequency.value = freq; mod.frequency.value = freq * (o.ratio || 3.5);
      mg.gain.setValueAtTime(freq * (o.index || 2.2), t0); mg.gain.exponentialRampToValueAtTime(freq * 0.02, t0 + dur * 0.6);
      mod.connect(mg).connect(car.frequency);
      env(c, g, t0, o.vol || 0.05, 0.004, dur);
      car.connect(g); out(c, g, o.wet == null ? 0.7 : o.wet);
      car.start(t0); mod.start(t0); car.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05);
    }
    /** Filtered noise swept between two frequencies: whoosh, hiss, sparkle, strike. */
    function noise(dur, o = {}) {
      const c = ac(); if (!c) return;
      const t0 = at(c, o), src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noiseBuf; src.loop = true;
      f.type = o.filter || "bandpass"; f.Q.value = o.q || 1.2;
      f.frequency.setValueAtTime(o.from || 800, t0); f.frequency.exponentialRampToValueAtTime(o.to || o.from || 800, t0 + dur);
      env(c, g, t0, o.vol || 0.04, o.attack || 0.01, dur);
      src.connect(f).connect(g); out(c, g, o.wet == null ? 0.3 : o.wet);
      src.start(t0); src.stop(t0 + dur + 0.05);
    }
    /** The ball landing: a sine that drops in pitch, felt more than heard. */
    function thump(o = {}) {
      const c = ac(); if (!c) return;
      const t0 = at(c, o), osc = c.createOscillator(), g = c.createGain();
      osc.frequency.setValueAtTime(o.from || 150, t0); osc.frequency.exponentialRampToValueAtTime(o.to || 48, t0 + 0.18);
      env(c, g, t0, o.vol || 0.12, 0.004, 0.24);
      osc.connect(g); out(c, g, 0.1); osc.start(t0); osc.stop(t0 + 0.3);
    }
    const st = (root, semis) => root * Math.pow(2, semis / 12);
    // each rarity: how hard it lands, and the bell run that answers it (higher and longer as it gets rarer)
    const TIER_SOUND = {
      baseline: { hit: 0.07, notes: [0, 7], root: 523.25 },
      overfit: { hit: 0.06, notes: [0, -2], root: 466.16 },
      indist: { hit: 0.09, notes: [0, 4, 7], root: 523.25 },
      outlier: { hit: 0.11, notes: [0, 4, 7, 11], root: 587.33 },
      longtail: { hit: 0.13, notes: [0, 4, 7, 12, 16], root: 659.25 },
      mlion: { hit: 0.16, notes: [0, 4, 7, 12, 16, 19, 24], root: 523.25 },
    };
    // A short buzz with each verdict, where the browser can (Android; iOS Safari can't).
    const buzz = (pattern) => { if (settings.haptics && navigator.vibrate) try { navigator.vibrate(pattern); } catch { /* ignore */ } };
    return {
      unlock() { ac(); },
      /** the last seconds of the clock: a dry woodblock */
      tick() { noise(0.035, { from: 2600, q: 6, vol: 0.05, wet: 0 }); voice(1760, 0.04, { type: "sine", vol: 0.012, detune: 0, wet: 0 }); },
      reject() { buzz([30, 50, 30]); voice(233, 0.12, { type: "square", vol: 0.03, bright: 900, wet: 0.1 }); voice(196, 0.18, { type: "square", vol: 0.03, bright: 800, wet: 0.1, delay: 0.11 }); },
      submit() { noise(0.14, { from: 500, to: 2600, vol: 0.03, wet: 0.1 }); voice(660, 0.08, { type: "sine", vol: 0.02, slide: 1.5, detune: 0, wet: 0.1 }); },
      miss() {
        buzz(60);
        thump({ from: 110, to: 40, vol: 0.1 });
        voice(392, 0.6, { type: "sawtooth", vol: 0.035, slide: 0.5, bright: 1800, wet: 0.35, delay: 0.03 });
        voice(370, 0.6, { type: "sawtooth", vol: 0.025, slide: 0.5, bright: 1400, wet: 0.35, delay: 0.03 });
      },
      chat() { bell(1318.5, 0.35, { vol: 0.025 }); bell(1975.5, 0.45, { vol: 0.02, delay: 0.08 }); },
      tier(t) {
        const s = TIER_SOUND[t] || TIER_SOUND.baseline;
        buzz(t === "mlion" ? [20, 60, 20, 60, 90] : 18);
        thump({ vol: s.hit });
        noise(0.05, { from: 3000, q: 0.7, vol: s.hit * 0.25, wet: 0.2 }); // the strike
        const gap = t === "mlion" ? 0.07 : 0.075;
        s.notes.forEach((n, i) => bell(st(s.root, n), 0.5 + 0.08 * i, { vol: 0.045, delay: 0.03 + i * gap, index: t === "overfit" ? 1.2 : 2.2 }));
        if (t === "outlier" || t === "longtail" || t === "mlion") noise(0.5 + 0.1 * s.notes.length, { from: 3500, to: 9000, vol: 0.012 + 0.004 * s.notes.length, wet: 0.6, delay: 0.05 }); // shimmer
        if (t === "mlion") { // the full fanfare: a held chord under the bells and a last high sparkle
          [0, 4, 7, 12].forEach((n) => voice(st(261.63, n), 1.4, { type: "sawtooth", vol: 0.018, bright: 2400, attack: 0.08, wet: 0.7, delay: 0.1 }));
          bell(st(523.25, 36), 1.2, { vol: 0.02, delay: 0.62 });
        }
      },
      /** n in a row: a whoosh of fire that grows with the streak, then a chord one step higher each time */
      streak(n) {
        const lv = Math.min(7, n);
        buzz(lv >= 7 ? [16, 40, 16, 40, 16, 40, 70] : Array.from({ length: Math.min(lv, 5) * 2 - 1 }, (_, i) => (i % 2 ? 40 : 14)));
        noise(0.22 + 0.05 * lv, { from: 300, to: 1800 + 500 * lv, q: 0.9, vol: 0.025 + 0.005 * lv, attack: 0.08, wet: 0.3 });
        const root = st(523.25, [0, 0, 0, 2, 4, 7, 9, 12][lv]);
        [0, 4, 7].concat(lv >= 5 ? [12] : []).forEach((s, i) => bell(st(root, s), 0.35 + 0.05 * lv, { vol: 0.035, delay: 0.12 + i * 0.05 }));
        voice(root / 2, 0.5 + 0.06 * lv, { type: "sawtooth", vol: 0.012 + 0.002 * lv, bright: 1500 + 300 * lv, attack: 0.05, wet: 0.5, delay: 0.1 });
        if (lv >= 7) { bell(st(root, 24), 0.9, { vol: 0.02, delay: 0.4 }); noise(0.9, { from: 5000, to: 11000, vol: 0.02, wet: 0.8, delay: 0.3 }); }
      },
      quick() { bell(1567.98, 0.2, { vol: 0.022, delay: 0.02 }); bell(2093, 0.3, { vol: 0.02, delay: 0.09 }); },
      /** the streak goes out: a hiss like water on a flame, and the pitch sinking under it */
      fizzle() { buzz(28); noise(0.55, { from: 6000, to: 900, filter: "highpass", q: 0.5, vol: 0.035, attack: 0.005, wet: 0.2 }); voice(330, 0.45, { type: "triangle", vol: 0.025, slide: 0.45, wet: 0.2, delay: 0.05 }); },
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
  function todayNumber() { return dayNo(today()); }
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
    const all = Object.values(records).filter((r) => !isQuizMode(r.mode)); // quiz runs score 100 a hit, not by rarity: kept out of the tier stats
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
    const n = dayNo(date);
    return { key: `daily:${date}`, mode: "daily", number: n, date, label: `MLion #${n}`, promptIds: dailyIds(date), secs: DEFAULT_SECS }; // fixed clock: the leaderboard compares dailies
  }
  function archiveSpec(date) {
    const n = dayNo(date);
    return { key: `archive:${date}`, mode: "archive", number: n, date, label: `Archive #${n}`, promptIds: dailyIds(date) };
  }
  function unlimitedSpec(n) {
    return { key: `unlimited:${n}`, mode: "unlimited", number: n, label: `Unlimited #${n}`, promptIds: E.runFor(soloPool(), "unlimited-v2", n, null, true) };
  }
  function packSpec(packId, n) {
    const pk = PACKS.get(packId);
    return { key: `pack:${packId}:${n}`, mode: "pack", pack: packId, number: n, label: `${pk.name} #${n}`, promptIds: E.packPromptIds(DATA, packId, n) };
  }
  function practiceSpec(promptId) {
    return { key: `practice:${promptId}`, mode: "practice", number: 1, label: "Practice", promptIds: [promptId] };
  }
  function nextUnlimited() { let n = 1; while (records[`unlimited:${n}`]) n++; return n; }
  // Unlimited is one endless session at a time, dealt from one long shuffled deck per question set
  // (core, or core plus extras): no prompt comes back until the whole deck has been dealt, across
  // sessions. LS unlPos:<pool> counts the prompts dealt so far.
  const UNL_STREAM = "unlimited-v3";
  const unlPoolName = () => (settings.extraQuestions ? "wide" : "core");
  function unlDeal(pool) {
    const data = pool === "wide" ? WIDE : CORE, key = `unlPos:${pool}`;
    const at = Math.max(0, +LS.get(key, 0) || 0);
    LS.set(key, at + 1);
    return E.streamIds(data, `${UNL_STREAM}:${pool}`, at + 1)[at];
  }
  function nextQuiz() { let n = 1; while (records[`quiz:${n}`]) n++; return n; }
  // The daily quiz: everyone's same seven questions, on the fixed 25 s clock so the board compares.
  // Numbered like the daily (#1 until launch). From launch, days 1..QUIZ_DAYS.length play the
  // hand-picked days in data/daily.json `quiz`; later days deal from the whole bank.
  const QUIZ_BANK = E.quizBank(DATA);
  const QUIZ_DAYS = ((DATA.daily && DATA.daily.quiz) || []).filter((ids) => ids.every((id) => PROMPTS.has(id)));
  const dquizNumber = dayNo;
  function dquizSpec(date) {
    const num = dquizNumber(date);
    const n = E.dayNumberFor(date);
    const quiz = preLaunch(date) ? E.dailyQuiz(DAILY, preDay(date), "dquiz-pre2")
      : n <= QUIZ_DAYS.length ? E.quizFor(DAILY, `dquiz-v3:${n}`, E.QUIZ_ROUNDS, { promptIds: QUIZ_DAYS[n - 1] })
      : E.dailyQuiz(DAILY, n - QUIZ_DAYS.length, "dquiz-v3");
    return { key: `dquiz:${date}`, mode: "dquiz", fmt: "quiz", number: num, date, label: `Daily Quiz #${num}`, promptIds: quiz.map((q) => q.promptId), quiz, secs: DEFAULT_SECS };
  }
  function quizSpec(n) {
    const quiz = E.quizRun(soloPool(), n);
    return { key: `quiz:${n}`, mode: "quiz", fmt: "quiz", number: n, label: `Quiz #${n}`, promptIds: quiz.map((q) => q.promptId), quiz };
  }
  function nextPackRun(packId) { let n = 1; while (records[`pack:${packId}:${n}`]) n++; return n; }

  // ----------------------------------------------------------- challenges
  // A challenge travels entirely in its link, so friends need no account and
  // no server: #vs-<seed>-<n>[-<tiers>-<name>][-<tiers>-<name>]. Tiers are one
  // digit per question, names are UTF-8 hex (links allow only a-z, 0-9, -).
  const TIER_CODE = ["miss", "baseline", "overfit", "indist", "outlier", "longtail", "mlion"];
  // Question counts for challenges and live rooms: quick picks, or any count up to Q_MAX.
  const Q_PRESETS = [3, 5, 7, 10];
  const Q_MAX = 25;
  const validQ = (n) => Number.isInteger(n) && n >= 1 && n <= Q_MAX;
  /** The presets as a radio row plus a number box for anything else (1 to Q_MAX). */
  function qPicker(n, noun = "questions") {
    const custom = !Q_PRESETS.includes(n);
    return `<div class="vs-field"><span>${noun[0].toUpperCase() + noun.slice(1)}</span><div class="vs-sizes" role="radiogroup" aria-label="Number of ${noun}">${Q_PRESETS.map((k) => `<button type="button" class="vs-size q-size${k === n ? " on" : ""}" role="radio" aria-checked="${k === n}" data-n="${k}">${k}</button>`).join("")}
      <input class="q-custom${custom ? " on" : ""}" id="q-custom" type="number" inputmode="numeric" min="1" max="${Q_MAX}" step="1" placeholder="1–${Q_MAX}" aria-label="Custom number of ${noun}, 1 to ${Q_MAX}" value="${custom ? n : ""}"></div></div>`;
  }
  /** Wire a qPicker: onPick(n) gets a valid count; a bad custom entry snaps back to the current one. */
  function wireQPicker(cur, onPick, noun = "questions") {
    $$(".q-size").forEach((b) => b.addEventListener("click", () => onPick(+b.dataset.n)));
    const box = $("#q-custom");
    if (!box) return;
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") box.blur(); });
    box.addEventListener("change", () => {
      const v = Math.round(+box.value);
      if (box.value !== "" && validQ(v)) return onPick(v);
      if (box.value !== "") toast(`Pick 1 to ${Q_MAX} ${noun}`);
      box.value = Q_PRESETS.includes(cur()) ? "" : String(cur());
    });
  }
  // Seconds to answer each question: a personal setting for solo runs, the host's
  // choice in live rooms, carried inside challenge links so both players match.
  const TIME_PRESETS = [10, 15, 25, 40, 60];
  const DEFAULT_SECS = E.ANSWER_MS / 1000;
  const validSecs = (x) => TIME_PRESETS.includes(x);
  const baseMs = () => (RUN && RUN.answerMs) || E.ANSWER_MS; // runs saved before this setting existed get 25 s
  /** The clock for question `i` (default: the current one); a reasoning question gets longer. */
  const answerMs = (i) => qMs(RUN && RUN.quiz && RUN.quiz[i === undefined ? RUN.round : i], baseMs());
  const liveMs = (i) => qMs(LIVE.quiz && LIVE.quiz[i], (LIVE.secs || DEFAULT_SECS) * 1000);
  function timePicker(secs) {
    return `<div class="vs-field"><span>Time per question</span><div class="vs-sizes" role="radiogroup" aria-label="Seconds per question">${TIME_PRESETS.map((k) => `<button type="button" class="vs-size t-size${k === secs ? " on" : ""}" role="radio" aria-checked="${k === secs}" data-s="${k}">${k} s</button>`).join("")}</div></div>`;
  }
  function wireTimePicker(onPick) {
    $$(".t-size").forEach((b) => b.addEventListener("click", () => {
      $$(".t-size").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
      onPick(+b.dataset.s);
    }));
  }
  const SHARE_BASE = ((document.querySelector('meta[name="mlion:url"]') || {}).content || "").trim();
  const encTiers = (tiers) => tiers.map((t) => Math.max(0, TIER_CODE.indexOf(t || "miss"))).join("");
  const decTiers = (str) => str.split("").map((c) => TIER_CODE[+c] || "miss");
  const encName = (name) => [...new TextEncoder().encode(String(name || "").slice(0, 16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  function decName(hex) {
    try { return new TextDecoder().decode(new Uint8Array((hex.match(/../g) || []).map((h) => parseInt(h, 16)))).trim(); } catch { return ""; }
  }
  const tierPoints = (tiers) => tiers.reduce((sum, t) => sum + (T[t] ? T[t].score : 0), 0);
  const myName = () => String(LS.get("name", "") || "").slice(0, 16);
  function challengePromptIds(seed, n) { return E.makeStream(CORE, `vs-${seed}`, null, true).take(n); }
  function challengeLink(seed, n, players, secs) {
    const tail = players.map((pl) => `-${encTiers(pl.tiers)}-${encName(pl.name)}`).join("");
    const t = validSecs(secs) && secs !== DEFAULT_SECS ? `t${secs}` : "";
    return `${SHARE_BASE || siteUrl()}#vs-${seed}-${n}${t}${tail}`;
  }
  function parseChallenge(h) {
    const m = h.match(/^vs-([a-z0-9]{4,12})-(\d{1,2})(?:t(\d{2}))?((?:-[0-6]{1,25}-[0-9a-f]{0,64}){0,2})$/);
    if (!m) return null;
    const n = +m[2], secs = m[3] ? +m[3] : DEFAULT_SECS;
    if (!validQ(n) || !validSecs(secs)) return null;
    const parts = m[4].split("-").filter((x, i) => i > 0);
    const players = [];
    for (let i = 0; i + 1 < parts.length + 1; i += 2) {
      if (parts[i] === undefined) break;
      if (parts[i].length !== n) return null;
      players.push({ tiers: decTiers(parts[i]), name: decName(parts[i + 1] || "") || "A friend" });
    }
    return { seed: m[1], n, secs, players };
  }
  function vsSpec(seed, n, opp, secs) {
    return {
      key: `vs:${seed}`, mode: "vs", number: 0, seed, n, opp: opp || null, secs,
      label: opp ? `Vs ${opp.name}` : "Challenge", promptIds: challengePromptIds(seed, n),
    };
  }
  function openChallenge(h) {
    const c = parseChallenge(h);
    if (!c) return go("challenge");
    const mine = records[`vs:${c.seed}`];
    const mineTiers = mine ? encTiers(mine.tiers) : null;
    if (!c.players.length) return mine ? go(`results-vs-${c.seed}`) : openRun(vsSpec(c.seed, c.n, null, c.secs));
    const [a, b] = c.players;
    if (b) {
      if (mineTiers === encTiers(a.tiers)) a.you = true;
      else if (mineTiers === encTiers(b.tiers)) b.you = true;
      return renderDuel(c, a, b);
    }
    // One result in the link: either my own link, or a friend's challenge to me.
    if (mineTiers && mineTiers === encTiers(a.tiers)) return go(`results-vs-${c.seed}`);
    if (mine) return renderDuel(c, a, { name: mine.name || myName() || "You", tiers: mine.tiers }, true);
    return openRun(vsSpec(c.seed, c.n, a, c.secs));
  }

  // ---- quiz challenges: #vq-<seed>-<n>[tNN][-<picks>-<tenths>-<nameHex>]x2. Picks are one digit per
  // question (0 none, 1 to 4 the option chosen), so the score is recomputed from the seed; tenths is
  // the total answer time in tenths of a second, which breaks a tie on points.
  // Links made since the hard questions arrived (2026-11-05) have 10-character seeds and deal the level mix;
  // older links (6-7 characters) rebuild from the bank as it was then, so the picks they carry still line up.
  const CORE_BANK1 = { ...CORE, reasoning: CORE.reasoning.filter((r) => r.retired || +r.id.slice(3) <= 247) };
  const quizChallengeQuiz = (seed, n) => (seed.length >= 10
    ? E.quizFor(CORE, `vq-${seed}`, n, { promptIds: [], reasoningIds: E.mixedDeal(CORE, `vq-${seed}`, n) })
    : E.quizFor(CORE_BANK1, `vq-${seed}`, n));
  function vqLink(seed, n, players, secs) {
    const tail = players.map((pl) => `-${pl.picks.join("")}-${Math.min(99999, pl.tenths)}-${encName(pl.name)}`).join("");
    const t = validSecs(secs) && secs !== DEFAULT_SECS ? `t${secs}` : "";
    return `${SHARE_BASE || siteUrl()}#vq-${seed}-${n}${t}${tail}`;
  }
  function parseQuizChallenge(h) {
    const m = h.match(/^vq-([a-z0-9]{4,12})-(\d{1,2})(?:t(\d{2}))?((?:-[0-4]{1,25}-\d{1,5}-[0-9a-f]{0,64}){0,2})$/);
    if (!m) return null;
    const n = +m[2], secs = m[3] ? +m[3] : DEFAULT_SECS;
    if (!validQ(n) || !validSecs(secs)) return null;
    const parts = m[4].split("-").slice(1);
    const players = [];
    for (let i = 0; i < parts.length; i += 3) {
      if (parts[i].length !== n) return null;
      players.push({ picks: parts[i].split("").map(Number), tenths: +parts[i + 1], name: decName(parts[i + 2] || "") || "A friend" });
    }
    return { seed: m[1], n, secs, players };
  }
  function vqSpec(seed, n, opp, secs) {
    const quiz = quizChallengeQuiz(seed, n);
    return {
      key: `vq:${seed}`, mode: "vq", fmt: "quiz", number: 0, seed, n: quiz.length, opp: opp || null, secs,
      label: opp ? `Quiz vs ${opp.name}` : "Quiz challenge", promptIds: quiz.map((q) => q.promptId), quiz,
    };
  }
  const picksSig = (pl) => `${pl.picks.join("")}-${pl.tenths}`;
  function openQuizChallenge(h) {
    const c = parseQuizChallenge(h);
    if (!c) return go("challenge");
    if (quizChallengeQuiz(c.seed, c.n).length !== c.n) { toast("This question set can't make that many quiz questions"); return go("challenge"); }
    const mine = records[`vq:${c.seed}`];
    const me = mine ? { picks: mine.picks, tenths: mine.tenths, name: mine.name || myName() || "You" } : null;
    if (!c.players.length) return mine ? go(`results-vq-${c.seed}`) : openRun(vqSpec(c.seed, c.n, null, c.secs));
    const [a, b] = c.players;
    if (b) {
      if (me && picksSig(me) === picksSig(a)) a.you = true;
      else if (me && picksSig(me) === picksSig(b)) b.you = true;
      return renderQuizDuel(c, a, b);
    }
    if (me && picksSig(me) === picksSig(a)) return go(`results-vq-${c.seed}`);
    if (me) return renderQuizDuel(c, a, me, true);
    return openRun(vqSpec(c.seed, c.n, a, c.secs));
  }

  // ================================================================ live
  // Real-time matches. Browsers talk directly over WebRTC; PeerJS's public
  // server only introduces them, so nobody needs an account. The host's page
  // is the authority: it admits players, paces rounds and relays answers.
  // claude.ai blocks WebRTC inside artifacts, so there live mode points to the
  // web version.
  const WEB_URL = "https://antony-x.github.io/MLION/";
  const MQTT_SRC = "https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js";
  const BROKER = "wss://public.cloud.shiftr.io";
  const TOPIC = "mlion/v2";
  const PUB_SLOTS = 10; // public rooms live at fixed codes pub01..pub10 so anyone can find them
  const pubCode = (k) => `pub${String(k).padStart(2, "0")}`;
  const AWAY_GRACE_MS = 15000;
  const REVEAL_MS = 4500;
  const CODE_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
  const liveBlocked = () => !!SHARE_BASE; // only the artifact build sets SHARE_BASE
  // Room rules: the host's "More options" for Classic and Quiz rooms (user, 2026-11-05: hints and first letters,
  // wrong-answer penalties, a speed multiplier, more fun options, tucked away so the lobby isn't crowded).
  // Scoring is E.liveScore; clash is applied at the reveal (it needs everyone's answers).
  const RULES_DEFAULT = { hints: "off", miss: "free", speed: "off", final: false, clash: false };
  const RULE_CHOICES = {
    speed: [["off", "Off"], ["1.5", "Up to ×1.5"], ["2", "Up to ×2"]],
    hints: [["off", "Off"], ["half", "Half points"], ["free", "Free"]],
    miss: [["free", "Free"], ["5", "−5"], ["10", "−10"], ["strike", "One strike"]],
  };
  const ASSISTS = ["off", "typos", "full", "generous"];
  function cleanRules(r) {
    const o = { ...RULES_DEFAULT };
    if (r && typeof r === "object") {
      for (const k of Object.keys(RULE_CHOICES)) if (RULE_CHOICES[k].some(([v]) => v === r[k])) o[k] = r[k];
      o.final = r.final === true; o.clash = r.clash === true;
    }
    return o;
  }
  /** The rules that are on, in words, for a format (Sprint has its own). */
  function activeRules(r, fmt) {
    if (!r || fmt === "sprint") return [];
    const quiz = fmt === "quiz", out = [];
    if (r.speed !== "off") out.push(`speed bonus up to ×${r.speed}`);
    if (r.hints !== "off") out.push(`${quiz ? "50:50" : "hints"}${r.hints === "half" ? " for half points" : ""}`);
    if (!quiz && r.miss !== "free") out.push(r.miss === "strike" ? "one strike" : `−${r.miss} a wrong answer`);
    if (r.final) out.push("final question ×2");
    if (!quiz && r.clash) out.push("clash");
    return out;
  }
  const LIVE = { active: false, code: "", isHost: false, client: null, conns: new Map(), myId: "",
    players: new Map(), n: 7, seed: "", phase: "lobby", revealed: -1, timers: [], intervals: [], status: "",
    fmt: "rarity", mfmt: "rarity", rules: { ...RULES_DEFAULT }, mrules: { ...RULES_DEFAULT }, quiz: null, gone: new Map() }; // rules and mrules: the lobby's and the running match's room rules; fmt: the lobby's choice; mfmt and quiz: the running match's format and questions; gone: players who left a sprint match, kept for its standings
  let mqttLib = null;
  function loadMqtt() {
    if (window.mqtt) return Promise.resolve(window.mqtt);
    if (!mqttLib) mqttLib = new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = MQTT_SRC; el.async = true;
      el.onload = () => (window.mqtt ? res(window.mqtt) : rej(new Error("no mqtt")));
      el.onerror = () => { mqttLib = null; rej(new Error("load failed")); };
      setTimeout(() => { if (!window.mqtt) { mqttLib = null; rej(new Error("timeout")); } }, 12000);
      document.head.appendChild(el);
    });
    return mqttLib;
  }
  const cleanName = (s) => String(s || "").replace(/[^\p{L}\p{N} _.'-]/gu, "").trim().slice(0, 16);
  const liveLater = (fn, ms) => { const id = setTimeout(fn, ms); LIVE.timers.push(id); return id; };
  function liveReset() {
    LIVE.timers.forEach(clearTimeout); LIVE.timers = [];
    LIVE.intervals.forEach(clearInterval); LIVE.intervals = [];
    for (const p of LIVE.players.values()) clearTimeout(p.awayTimer); // a seat's grace timer must not outlive the room
    const c = LIVE.client;
    if (c) {
      try { if (LIVE.isHost && !LIVE.quietLeave) pubJSON(c, `${roomTopic(LIVE.code)}/down`, { t: "closed", ep: LIVE.ep || 0 }); } catch { /* ignore */ }
      try { if (LIVE.isHost && LIVE.isPublic) c.publish(infoTopic(LIVE.code), "", { retain: true, qos: 1 }); } catch { /* ignore */ }
      setTimeout(() => { try { c.end(true); } catch { /* ignore */ } }, 300);
    }
    const n = LIVE.fmt === "sprint" || LIVE.mfmt === "sprint" ? (validQ(LIVE.nOther) ? LIVE.nOther : 7) : LIVE.n; // a Sprint room's count stays with Sprint
    Object.assign(LIVE, { active: false, code: "", isHost: false, isPublic: false, flash: "", ep: 0, offset: null, countdownAt: 0, client: null, conns: new Map(), myId: "",
      players: new Map(), seed: "", ids: [], phase: "lobby", revealed: -1, status: "", skip: null, fmt: "rarity", mfmt: "rarity", rules: { ...RULES_DEFAULT }, mrules: { ...RULES_DEFAULT }, moreOpen: false, quiz: null, gone: new Map(), spRec: null, n });
    liveSprintStop();
    chatRate.clear();
    syncChat();
  }
  function leaveLive(quiet) {
    LIVE.quietLeave = quiet !== false;
    spCarry = null;
    if (joinState) {
      clearInterval(joinState.helloTimer);
      const c = joinState.client;
      if (!LIVE.active || LIVE.client !== c) setTimeout(() => { try { c.end(true); } catch { /* ignore */ } }, 300);
      joinState = null;
    }
    if (LIVE.active) liveReset();
  }
  const liveHash = () => `live-${LIVE.code}`;
  const playerList = () => [...LIVE.players.values()];
  const inMatch = () => playerList().filter((p) => !p.late); // late joiners wait for the next match
  /** Clash (a room rule): once a Classic round is revealed, an answer someone else in the match also gave scores half. */
  const clashed = (pl, i) => !!(LIVE.mrules && LIVE.mrules.clash && LIVE.mfmt === "rarity" && i <= LIVE.revealed && pl.ans[i] && pl.ans[i].tier
    && inMatch().some((o) => o !== pl && o.ans[i] && o.ans[i].tier && o.ans[i].answer === pl.ans[i].answer));
  const roundPts = (pl, i) => (pl.ans[i] ? (clashed(pl, i) ? Math.round(pl.ans[i].score / 2) : pl.ans[i].score) : 0);
  const liveQuiz = () => LIVE.mfmt === "quiz";
  const liveSprint = () => LIVE.mfmt === "sprint";
  // quiz and sprint matches keep a round's points back until its reveal, so a total counts revealed rounds only
  const shownTotal = (pl) => { let s = 0; for (const k in pl.ans) if (!(liveQuiz() || liveSprint()) || +k <= LIVE.revealed) s += roundPts(pl, +k); return s; };
  /** A player's whole answer time in a quiz match; a question they never answered counts as the full clock. */
  const liveTotalMs = (pl) => { let s = 0; for (let k = 0; k < LIVE.n; k++) s += pl.ans[k] ? pl.ans[k].ms : liveMs(k); return s; };
  /** Standing order: points, then (quiz) the faster total time. */
  const rankCmp = (a, b) => shownTotal(b) - shownTotal(a) || (liveQuiz() ? liveTotalMs(a) - liveTotalMs(b) : 0);
  const hostNow = () => Date.now() + (LIVE.isHost ? 0 : LIVE.offset || 0); // clocks synced to the host

  // ---- messages: everyone (host included) applies the same events
  function apply(m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "lobby" && Array.isArray(m.topics)) LIVE.topics = m.topics.filter((id) => PACKS.has(id));
    if (m.t === "lobby" && Array.isArray(m.players)) {
      const before = new Set(LIVE.players.keys());
      const next = new Map();
      for (const p of m.players.slice(0, 12)) {
        if (!p || typeof p.id !== "string") continue;
        // Update the existing object in place: the host's grace timer and last-seen time
        // live on it, and a fresh copy would let a stale timer free a seat its owner came back to.
        const old = LIVE.players.get(p.id);
        const kept = !old && LIVE.spRec && LIVE.spRec.get(p.id); // a sprint match this page rebuilt after a takeover
        next.set(p.id, Object.assign(old || { ans: kept ? kept.ans : {}, sp: kept ? kept.sp : {}, typing: null }, { id: p.id, name: cleanName(p.name) || "Player", host: !!p.host, late: !!p.late, away: !!p.away, ready: !!p.ready }));
        if (!before.has(p.id) && p.id !== LIVE.myId && before.size) {
          LIVE.flash = `${cleanName(p.name) || "Someone"} joined`;
          toast(LIVE.flash); Sound.tier("mlion");
          try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch { /* ignore */ }
          setTimeout(() => { LIVE.flash = ""; const b = $("#lv-banner"); if (b) b.remove(); }, 6000);
        }
      }
      for (const id of before) if (!next.has(id) && LIVE.players.get(id)) toast(`${LIVE.players.get(id).name} left`);
      liveSprintKeep(before, next);
      LIVE.players = next;
      if (validQ(+m.n)) LIVE.n = +m.n;
      if (validSecs(+m.secs)) LIVE.secs = +m.secs;
      if (!LIVE.isHost) LIVE.isPublic = !!m.pub;
      if (ASSISTS.includes(m.assist)) LIVE.assist = m.assist;
      if (m.rules && typeof m.rules === "object") LIVE.rules = cleanRules(m.rules);
      if (["rarity", "quiz", "sprint"].includes(m.fmt) && LIVE.phase !== "playing") LIVE.fmt = m.fmt;
      if (LIVE.phase === "lobby" || LIVE.phase === "done") (LIVE.phase === "done" ? renderPodium : renderLobby)();
      else renderStrip();
    } else if (m.t === "start" && /^[a-z0-9]{4,12}$/.test(m.seed) && validQ(+m.n)) {
      LIVE.seed = m.seed; LIVE.n = +m.n; LIVE.phase = "playing"; LIVE.revealed = -1; LIVE.countdownAt = 0; LIVE.spRec = null;
      for (const pl of LIVE.players.values()) { pl.ans = {}; pl.late = false; pl.ready = false; pl.typing = null; }
      stopRun();
      liveSprintStop();
      LIVE.mrules = cleanRules(m.rules);
      if (m.fmt === "sprint") return liveSprintStart(m);
      // a quiz match: every page builds the same questions from the room's seed and the host's prompt list
      const quiz = m.fmt === "quiz" ? E.quizFor(CORE, m.seed, LIVE.n, { promptIds: Array.isArray(m.ids) ? m.ids.filter((id) => PROMPTS.has(id)) : [], ...(Array.isArray(m.topics) && m.topics.length ? { reasoningIds: [] } : {}) }) : null; // the host's dealt bank ids, rebuilt exactly
      if (quiz) LIVE.n = quiz.length;
      LIVE.mfmt = quiz ? "quiz" : "rarity"; LIVE.quiz = quiz;
      RUN = { key: `live:${m.seed}`, mode: "live", number: 0, label: "Live match", seed: m.seed, n: LIVE.n,
        assist: ASSISTS.includes(m.assist) ? m.assist : "typos", rules: LIVE.mrules,
        answerMs: (validSecs(+m.secs) ? +m.secs : DEFAULT_SECS) * 1000,
        promptIds: quiz ? quiz.map((q) => q.promptId) : Array.isArray(m.ids) && m.ids.length === LIVE.n && m.ids.every((id) => PROMPTS.has(id)) ? m.ids.slice() : challengePromptIds(m.seed, LIVE.n), round: 0, phase: "intro", results: [], tried: [], startedAt: Date.now() };
      if (quiz) { RUN.fmt = "quiz"; RUN.quiz = quiz; } // the same array as LIVE.quiz: a skip replaces a question in both
      LIVE.skip = null;
      LIVE.ids = RUN.promptIds; // same array: kept for the recap after RUN is gone, and skips update both
      renderPlayShell();
      renderIntro();
    } else if (m.t === "round" && RUN && RUN.mode === "live" && Number.isInteger(m.i) && m.i < RUN.promptIds.length) {
      cancelAnimationFrame(runRaf);
      while (RUN.results.length < m.i) { // missed a round (lag or tab asleep): count it as a miss
        const p = PROMPTS.get(RUN.promptIds[RUN.results.length]);
        RUN.results.push({ promptId: p.id, promptText: p.text, raw: null, answer: null, tier: null, score: 0, quip: null, corrected: false, timeout: true, ...(RUN.fmt === "quiz" ? { picked: -1, correct: RUN.quiz[RUN.results.length].correct, ms: answerMs(RUN.results.length) } : {}) });
      }
      RUN.round = m.i;
      const go1 = () => { if (RUN && RUN.mode === "live" && RUN.round === m.i) { startRound(); renderStrip(); } };
      const wait = Number.isFinite(+m.at) ? Math.min(3000, Math.max(0, +m.at - hostNow())) : 0;
      if ($("#card")) $("#card").innerHTML = `<div class="intro-card"><div><h2>Question ${m.i + 1} of ${RUN.promptIds.length}</h2><p class="sub">${RUN.rules && RUN.rules.final && m.i === RUN.promptIds.length - 1 ? "Final question: double points" : "Starting together…"}</p></div></div>`;
      renderStrip();
      setTimeout(go1, wait);
    } else if (m.t === "spround" || m.t === "spp" || m.t === "spans") {
      liveSprintMsg(m);
    } else if (m.t === "ans" && typeof m.id === "string" && Number.isInteger(m.i)) {
      const pl = LIVE.players.get(m.id);
      if (!pl || pl.ans[m.i] || liveSprint()) return; // a sprint match has no one-answer rounds
      if (liveQuiz()) { // the pick is an index into the options every page built from the same seed; correctness is recomputed here
        const q = LIVE.quiz && LIVE.quiz[m.i];
        if (!q || !Number.isInteger(m.pick) || m.pick < -1 || m.pick >= E.QUIZ_OPTIONS) return;
        const ok = m.pick >= 0 && m.pick === q.correct;
        const ms = Math.max(0, Math.min(Math.round(+m.ms) || 0, liveMs(m.i)));
        const hint = m.hint === true;
        pl.ans[m.i] = { pick: m.pick, ok, ms, hint, answer: m.pick >= 0 ? q.options[m.pick] : null, tier: ok ? QUIZ_TIER : null,
          score: E.liveScore(LIVE.mrules, { base: ok ? E.QUIZ_POINTS : 0, ms, total: liveMs(m.i), hinted: hint, last: m.i === LIVE.n - 1 }) };
        renderStrip();
        renderLiveWait();
        if (LIVE.revealed >= m.i) renderReveal(m.i);
        return;
      }
      const tier = T[m.tier] ? m.tier : null;
      const ms = Number.isFinite(+m.ms) ? Math.max(0, Math.min(Math.round(+m.ms), liveMs(m.i))) : liveMs(m.i); // no time sent: no speed bonus
      const miss = Math.max(0, Math.min(99, Math.round(+m.miss) || 0)), hint = m.hint === true;
      pl.ans[m.i] = { answer: tier ? String(m.answer || "").slice(0, 80) : null, tier, ms, miss, hint,
        score: tier ? E.liveScore(LIVE.mrules, { base: T[tier].score, ms, total: liveMs(m.i), misses: miss, hinted: hint, last: m.i === LIVE.n - 1 }) : 0 };
      renderStrip();
      renderLiveWait();
      if (LIVE.revealed >= m.i) renderReveal(m.i);
    } else if (m.t === "countdown" && Number.isFinite(+m.at)) {
      LIVE.countdownAt = +m.at;
      (LIVE.phase === "done" ? renderPodium : renderLobby)();
    } else if (m.t === "typing" && typeof m.id === "string" && Number.isInteger(m.i)) {
      const pl = LIVE.players.get(m.id);
      if (!pl || m.id === LIVE.myId) return;
      pl.typing = { i: m.i, draft: String(m.draft || "").slice(0, 60), tried: Array.isArray(m.tried) ? m.tried.slice(-6).map((x) => String(x).slice(0, 40)) : [] };
      renderRivals();
    } else if (m.t === "chat" && typeof m.id === "string") {
      chatIncoming(m);
    } else if (m.t === "skipvotes" && Number.isInteger(m.i) && Array.isArray(m.ids)) {
      const before = LIVE.skip && LIVE.skip.i === m.i ? LIVE.skip.ids : [];
      LIVE.skip = { i: m.i, ids: m.ids.filter((x) => typeof x === "string").slice(0, 12), need: Math.max(1, Math.min(12, Math.round(+m.need) || 1)) };
      for (const id of LIVE.skip.ids) {
        const pl = LIVE.players.get(id);
        if (!before.includes(id) && id !== LIVE.myId && pl) Sound.tick(); // the skip row names them; a toast would cover the answer box
      }
      renderSkip();
    } else if (m.t === "skip" && RUN && RUN.mode === "live" && Number.isInteger(m.i) && m.i < RUN.promptIds.length && m.i > LIVE.revealed && PROMPTS.has(m.id)) {
      // the room voted this question out: a fresh one takes its slot, and nobody keeps points from it
      cancelAnimationFrame(runRaf);
      if (liveQuiz()) { const q = E.quizQuestion(DATA, LIVE.seed, m.id); if (!q) return; RUN.quiz[m.i] = q; }
      RUN.promptIds[m.i] = m.id;
      RUN.results.length = Math.min(RUN.results.length, m.i);
      Object.assign(RUN, { round: m.i, phase: "intro", draft: "", tried: [], pendingCorrection: null });
      for (const pl of LIVE.players.values()) { delete pl.ans[m.i]; pl.typing = null; }
      LIVE.skip = null;
      if (descent) descent.set(RUN.results);
      setHud(totalScore(RUN.results));
      showStreak(streakOf(RUN.results), "set");
      updateHead();
      if ($("#card")) $("#card").innerHTML = `<div class="intro-card"><div><h2>Skipped</h2><p class="sub">A new question is on its way…</p></div></div>`;
      renderStrip();
      toast("Question skipped");
    } else if (m.t === "reveal" && Number.isInteger(m.i)) {
      if (liveSprint()) return liveSprintReveal(m);
      LIVE.revealed = Math.max(LIVE.revealed, m.i);
      if (RUN && RUN.mode === "live" && RUN.results.length <= m.i && (RUN.phase === "preview" || RUN.phase === "answering")) submit(true);
      renderStrip();
      renderReveal(m.i);
      if (liveQuiz()) liveQuizSettle(m.i);
    } else if (m.t === "closed" && !LIVE.isHost) {
      leaveLive();
      renderLiveStatus("The host closed the room.", true);
    } else if (m.t === "end") {
      LIVE.phase = "done";
      LIVE.revealed = LIVE.n - 1;
      stopRun();
      renderPodium();
    }
  }
  function broadcast(m) {
    m.ep = LIVE.ep || 0; m.hid = LIVE.myId; m.now = Date.now();
    if (LIVE.client) pubJSON(LIVE.client, `${roomTopic(LIVE.code)}/down`, m);
    if (m.t === "lobby") publishInfo();
    apply(m);
  }
  /** The packs a room plays (empty: every topic), and the prompt ids they hold. */
  const liveTopics = () => (Array.isArray(LIVE.topics) ? LIVE.topics.filter((id) => PACKS.has(id)) : []);
  /** A live quiz's questions laid out like a solo run (E.QUIZ_PATTERN: easy, easy, medium, medium, hard, hard, hard),
   *  taken from the host's candidates in order; when a level runs out, the next candidate fills the slot. */
  function mixByLevel(cand, n) {
    const lvl = new Map(QUIZ_BANK.map((r) => [r.id, r.lvl || "medium"]));
    const left = cand.slice(), out = [];
    for (let k = 0; k < n && left.length; k++) {
      const j = left.findIndex((id) => lvl.get(id) === E.QUIZ_PATTERN[k % E.QUIZ_PATTERN.length]);
      out.push(left.splice(Math.max(0, j), 1)[0]);
    }
    return out;
  }
  function livePool(sprint, quiz) { // a sprint needs prompts with enough answers to fill its minute
    const t = liveTopics();
    if (quiz) return QUIZ_BANK.filter((r) => !t.length || t.includes(r.pack)).map((r) => r.id); // a quiz deals bank questions, by topic
    return CORE.prompts.filter((p) => (!t.length || t.includes(p.pack)) && (!sprint || sprintOk(p))).map((p) => p.id);
  }
  function topicPicker() {
    const t = liveTopics();
    const chip = (id, label, on) => `<button type="button" class="chip lv-topic${on ? " on" : ""}" aria-pressed="${on}" data-p="${id}">${esc(label)}</button>`;
    return `<div class="vs-field"><span>Topics</span><div class="chips" role="group" aria-label="Topics">${chip("", "All topics", !t.length)}${DATA.packs.map((pk) => chip(pk.id, pk.name, t.includes(pk.id))).join("")}</div></div>`;
  }
  function lobbyMsg() {
    return { t: "lobby", n: LIVE.n, secs: LIVE.secs || DEFAULT_SECS, assist: LIVE.assist || "typos", rules: LIVE.rules || RULES_DEFAULT, fmt: LIVE.fmt || "rarity", topics: liveTopics(), phase: LIVE.phase, pub: !!LIVE.isPublic, players: playerList().map((p) => ({ id: p.id, name: p.name, host: p.host, late: !!p.late, away: !!p.away, ready: !!p.ready })) };
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
      clearTimeout(pl.awayTimer); pl.awayTimer = 0; pl.away = false;
      LIVE.conns.set(conn.peer, conn);
      broadcast(lobbyMsg());
      if (LIVE.phase === "playing") try { conn.send({ t: "resume", seed: LIVE.seed, n: LIVE.n, ...(liveSprint() ? { fmt: "sprint", ids: LIVE.ids, i: SPR ? SPR.i : 0, revealed: LIVE.revealed } : {}) }); } catch { /* ignore */ }
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
    } else if (m.t === "ready" && LIVE.players.has(conn.peer)) {
      hostReady(conn.peer, !!m.v);
    } else if (m.t === "typing" && LIVE.players.has(conn.peer)) {
      broadcast({ t: "typing", id: conn.peer, i: m.i, draft: m.draft, tried: m.tried });
    } else if (m.t === "ans" && LIVE.players.has(conn.peer)) {
      hostAnswer(conn.peer, m);
    } else if (m.t === "chat" && LIVE.players.has(conn.peer)) {
      hostChat(conn.peer, m.text, m.k);
    } else if (m.t === "skipvote" && LIVE.players.has(conn.peer)) {
      hostSkipVote(conn.peer, m.i, !!m.v);
    } else if (m.t === "spp" && LIVE.players.has(conn.peer)) {
      hostSprintProgress(conn.peer, m);
    } else if (m.t === "spans" && LIVE.players.has(conn.peer)) {
      hostSprintFinal(conn.peer, m);
    }
  }
  function hostAnswer(id, m) {
    if (LIVE.phase !== "playing" || !Number.isInteger(m.i) || m.i <= LIVE.revealed || liveSprint()) return;
    if (m.pid && RUN && RUN.mode === "live" && RUN.promptIds[m.i] !== m.pid) return; // answered a question that was skipped
    if (liveQuiz()) { // the host decides what counts: a real option index (or none), a time inside the clock
      if (!LIVE.quiz || !LIVE.quiz[m.i] || !Number.isInteger(m.pick) || m.pick < -1 || m.pick >= E.QUIZ_OPTIONS) return;
      const ms = Math.max(0, Math.min(Math.round(+m.ms) || 0, liveMs(m.i)));
      broadcast({ t: "ans", id, i: m.i, pick: m.pick, ms, hint: m.hint === true });
    } else {
      const ms = Number.isFinite(+m.ms) ? Math.max(0, Math.min(Math.round(+m.ms), liveMs(m.i))) : undefined;
      broadcast({ t: "ans", id, i: m.i, answer: m.answer, tier: m.tier, ms, miss: Math.max(0, Math.min(99, Math.round(+m.miss) || 0)), hint: m.hint === true });
    }
    const everyone = inMatch().every((p) => p.ans[m.i]);
    if (everyone) liveLater(() => hostReveal(m.i), 700);
  }
  function hostDrop(id) {
    const pl = LIVE.players.get(id);
    if (!pl || pl.away || pl.host) return;
    LIVE.conns.delete(id);
    pl.away = true; // keep their seat for a while: phones pause pages when you switch apps
    broadcast(lobbyMsg());
    pl.awayTimer = setTimeout(() => {
      if (!pl.away || !LIVE.isHost || LIVE.players.get(id) !== pl) return; // this page may have been taken over since
      liveSprintKeep([id], new Map()); // before the seat goes, so a sprint match keeps their score
      LIVE.players.delete(id);
      broadcast(lobbyMsg());
      hostCheckRound();
    }, AWAY_GRACE_MS);
  }
  function hostCheckRound() {
    if (LIVE.phase === "playing" && liveSprint()) return SPR && hostSprintCheck(SPR.i);
    if (LIVE.phase === "playing" && RUN && RUN.mode === "live") {
      const i = RUN.round;
      if (i > LIVE.revealed && inMatch().every((p) => p.ans[i])) liveLater(() => hostReveal(i), 700);
    }
  }
  function hostReady(id, v) {
    const pl = LIVE.players.get(id);
    if (!pl || LIVE.phase === "playing") return;
    pl.ready = v;
    broadcast(lobbyMsg());
    const ps = playerList().filter((p) => !p.away);
    if (ps.length >= 2 && ps.every((p) => p.ready)) {
      broadcast({ t: "countdown", at: Date.now() + 3000 });
      liveLater(() => { const all = playerList().filter((p) => !p.away); if (all.length >= 2 && all.every((p) => p.ready)) hostStart(); }, 3000);
    }
  }
  function hostStart() {
    if (!LIVE.isHost || LIVE.players.size < 2) return;
    if (!validQ(LIVE.n)) LIVE.n = 7;
    LIVE.timers.forEach(clearTimeout); LIVE.timers = [];
    LIVE.phase = "playing";
    const seed = Math.random().toString(36).slice(2, 9).padEnd(6, "0");
    const topics = liveTopics();
    const sprint = LIVE.fmt === "sprint";
    const pool = livePool(sprint, LIVE.fmt === "quiz");
    if (topics.length && pool.length < LIVE.n) { LIVE.n = pool.length; toast(`These topics have ${pool.length} ${sprint ? "prompts" : "questions"}, so the match has ${pool.length}`); }
    let ids = topics.length || sprint || LIVE.fmt === "quiz" ? E.shuffled(pool, E.mulberry32(E.hashString(seed))).slice(0, LIVE.n) : challengePromptIds(seed, LIVE.n);
    let fresh = [];
    const used = new Set(LS.get("liveUsed", []));
    if (LIVE.noRepeat !== false) {
      fresh = E.shuffled(pool.filter((id) => !used.has(id)), E.mulberry32(E.hashString(seed)));
      if (fresh.length >= LIVE.n) ids = fresh.slice(0, LIVE.n);
    }
    if (LIVE.fmt === "quiz") { // the host fixes which prompts get a question, so every page builds the same ones
      // the dealt ids are all bank questions (of the match's topics, if any), so every page builds exactly them
      const cand = fresh.length >= LIVE.n ? fresh : E.shuffled(pool, E.mulberry32(E.hashString(seed)));
      const quiz = E.quizFor(CORE, seed, LIVE.n, { promptIds: mixByLevel(cand, LIVE.n), ...(topics.length ? { reasoningIds: [] } : {}) });
      if (!quiz.length) { LIVE.phase = "lobby"; toast("This question set can't make a quiz"); return; }
      ids = quiz.map((q) => q.promptId);
      LIVE.n = ids.length;
    }
    if (LIVE.noRepeat !== false) LS.set("liveUsed", fresh.length >= LIVE.n ? [...used, ...ids].slice(-400) : ids);
    broadcast({ t: "start", seed, n: LIVE.n, secs: LIVE.secs || DEFAULT_SECS, ids, assist: LIVE.assist || "typos", rules: LIVE.rules || RULES_DEFAULT, fmt: LIVE.fmt === "quiz" || sprint ? LIVE.fmt : "rarity", topics }); // guests rebuild a quiz knowing whether it was a topic match
    broadcast(lobbyMsg());
    liveLater(() => hostRound(0), 1800);
  }
  function hostRound(i) {
    if (liveSprint()) return hostSprintRound(i);
    broadcast({ t: "round", i, at: Date.now() + 1500 });
    // nobody moves on until everyone has answered; this cap only covers a player who vanished
    liveLater(() => hostReveal(i), 1500 + E.PREVIEW_MS + (liveQuiz() ? liveMs(i) : (LIVE.secs || DEFAULT_SECS) * 1000) + 12000);
  }
  function hostReveal(i) {
    if (LIVE.revealed >= i || LIVE.phase !== "playing") return;
    if (liveSprint()) return hostSprintReveal(i);
    broadcast({ t: "reveal", i });
    // explanations take reading: hold the reveal a little longer for each one on screen
    const pid = RUN && RUN.mode === "live" ? RUN.promptIds[i] : "";
    const notes = liveQuiz() ? (LIVE.quiz[i] && explainOf(pid, LIVE.quiz[i].options[LIVE.quiz[i].correct]) ? 1 : 0)
      : new Set(inMatch().map((pl) => pl.ans[i] && explainOf(pid, pl.ans[i].answer)).filter(Boolean)).size;
    liveLater(() => { if (i + 1 < LIVE.n) hostRound(i + 1); else { broadcast({ t: "end" }); LIVE.phase = "done"; broadcast(lobbyMsg()); } }, REVEAL_MS + Math.min(3000, 1200 * notes));
  }
  /** Players present for the question; a skip needs more than half of them (both, in a duo). */
  const skipNeed = () => Math.floor(inMatch().filter((p) => !p.away).length / 2) + 1;
  function hostSkipVote(id, i, v) {
    if (LIVE.phase !== "playing" || !RUN || RUN.mode !== "live" || i !== RUN.round || i <= LIVE.revealed) return;
    const pl = LIVE.players.get(id);
    if (!pl || pl.late) return;
    const votes = new Set(LIVE.skip && LIVE.skip.i === i ? LIVE.skip.ids : []);
    if (v) votes.add(id); else votes.delete(id);
    const need = skipNeed();
    broadcast({ t: "skipvotes", i, ids: [...votes], need });
    const present = new Set(inMatch().filter((p) => !p.away).map((p) => p.id));
    if ([...votes].filter((x) => present.has(x)).length >= need) hostSkip(i);
  }
  function hostSkip(i) {
    LIVE.timers.forEach(clearTimeout); LIVE.timers = []; // this question's time cap and any pending reveal
    const inMatchIds = new Set(RUN.promptIds);
    const used = new Set(LS.get("liveUsed", []));
    const pool = livePool(false, liveQuiz()).filter((id) => !inMatchIds.has(id));
    const fresh = LIVE.noRepeat !== false ? pool.filter((id) => !used.has(id)) : pool;
    const from = fresh.length ? fresh : pool;
    if (!from.length) return;
    // a quiz needs a prompt that can make a fair question; try them in random order until one does
    const id = liveQuiz() ? E.shuffled(from, Math.random).find((x) => E.quizQuestion(DATA, LIVE.seed, x)) : from[Math.floor(Math.random() * from.length)];
    if (!id) return;
    if (LIVE.noRepeat !== false) LS.set("liveUsed", [...used, id].slice(-400));
    broadcast({ t: "skip", i, id });
    liveLater(() => hostRound(i), 1200);
  }
  /** Called from renderFeedback when this player's answer for the round is final. */
  function liveLocalAnswer(res) {
    const m = { t: "ans", i: RUN.round, pid: RUN.promptIds[RUN.round], answer: res.answer, tier: res.tier, ms: res.ms, miss: res.misses || 0, hint: !!res.hinted };
    if (RUN.fmt === "quiz") Object.assign(m, { pick: res.picked });
    if (LIVE.isHost) hostAnswer(LIVE.myId, m);
    else guestSend(m);
  }

  // ---- connecting
  // ---- transport: a public MQTT broker over WebSocket on port 443.
  // Works on any network (no peer-to-peer); public rooms announce themselves
  // with retained messages so the room list is instant.
  const rid = (n) => Array.from({ length: n }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join("");
  async function mqttConnect(extra) {
    const m = await loadMqtt();
    return m.connect(BROKER, Object.assign({ username: "public", password: "public", clientId: "mlion-" + rid(12),
      keepalive: 15, reconnectPeriod: 1500, connectTimeout: 9000, clean: true }, extra || {}));
  }
  const roomTopic = (code) => `${TOPIC}/r/${code}`;
  const infoTopic = (code) => `${TOPIC}/pub/${code}`;
  const pubJSON = (client, topic, m, opts) => { try { client.publish(topic, JSON.stringify(m), opts || {}); } catch { /* offline: mqtt queues */ } };
  const hostSendTo = (id, m) => LIVE.client && pubJSON(LIVE.client, `${roomTopic(LIVE.code)}/to/${id}`, m);
  const guestSend = (m) => LIVE.client && pubJSON(LIVE.client, `${roomTopic(LIVE.code)}/up`, Object.assign({ from: LIVE.myId }, m));
  function publishInfo() {
    if (!LIVE.isHost || !LIVE.isPublic || !LIVE.client) return;
    const host = playerList().find((p) => p.host);
    pubJSON(LIVE.client, infoTopic(LIVE.code), { host: host ? host.name : "Someone", players: LIVE.players.size, max: 2, phase: LIVE.phase, at: Date.now() }, { retain: true, qos: 1 });
  }
  const liveEvery = (fn, ms) => { const id = setInterval(fn, ms); LIVE.intervals.push(id); return id; };
  function fakeConn(id) { return { peer: id, send: (x) => hostSendTo(id, x), close() {} }; }
  /** This page runs the room: heartbeat, presence checks, public listing. */
  function becomeHost() {
    LIVE.isHost = true;
    for (const p of LIVE.players.values()) p.host = p.id === LIVE.myId;
    const client = LIVE.client, code = LIVE.code;
    client.subscribe([`${roomTopic(code)}/up`, `${roomTopic(code)}/down`]);
    publishInfo();
    liveEvery(() => { broadcast({ t: "hb" }); publishInfo(); }, 3000);
    liveEvery(() => { // a player who went quiet: hold the seat, then free it
      const now = Date.now();
      for (const p of LIVE.players.values()) if (!p.host && !p.away && now - (p.seen || now) > 9000) hostDrop(p.id);
    }, 2000);
  }
  function hostIncoming(topic, payload) {
    let m; try { m = JSON.parse(payload.toString()); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (topic.endsWith("/down")) { // another page claims the room with a newer epoch: hand over and rejoin
      if (!LIVE.active || !LIVE.isHost) return; // already handed over: a second claim reaching the old client must not undo the rejoin
      if (m.hid && m.hid !== LIVE.myId && (+m.ep || 0) > (LIVE.ep || 0)) {
        const code = LIVE.code, me = LIVE.players.get(LIVE.myId), name = me ? me.name : myName();
        const keepId = LIVE.myId, carry = LIVE.phase === "playing" && liveSprint() ? spSnapshot() : null;
        toast("Reconnected. Your friend is hosting now");
        leaveLive(true);
        spCarry = carry; // picked up when the new host says "resume"
        liveJoin(code, name, keepId);
      }
      return;
    }
    if (!LIVE.isHost || typeof m.from !== "string" || m.from.length > 20) return;
    const pl = LIVE.players.get(m.from);
    if (pl) pl.seen = Date.now();
    if (m.t === "hb") { if (pl && pl.away) hostHandle(fakeConn(m.from), { t: "hello" }); return; }
    hostHandle(fakeConn(m.from), m);
  }
  /** The host vanished: the remaining player with the smallest id takes over. */
  function maybeTakeOver() {
    if (LIVE.isHost || !LIVE.active) return;
    const oldHost = playerList().find((p) => p.host);
    const rest = playerList().filter((p) => !p.host && !p.away).map((p) => p.id).sort();
    if (!rest.length || rest[0] !== LIVE.myId) return;
    if (oldHost) { oldHost.host = false; oldHost.seen = Date.now(); }
    LIVE.ep = (LIVE.ep || 0) + 1;
    LIVE.offset = 0;
    for (const p of LIVE.players.values()) p.seen = Date.now();
    becomeHost();
    if (oldHost) hostDrop(oldHost.id); // their seat is held for the grace period
    LIVE.client.removeAllListeners("message");
    LIVE.client.on("message", (topic, payload) => hostIncoming(topic, payload));
    if (joinState) { clearInterval(joinState.helloTimer); joinState = null; }
    toast(`${oldHost ? oldHost.name : "The host"} left. You're hosting now`);
    broadcast(lobbyMsg());
    if (LIVE.phase === "playing" && liveSprint()) return hostSprintTakeover();
    if (LIVE.phase === "playing" && RUN && RUN.mode === "live") {
      const i = RUN.round;
      if (LIVE.revealed >= i) liveLater(() => { if (i + 1 < LIVE.n) hostRound(i + 1); else { broadcast({ t: "end" }); LIVE.phase = "done"; broadcast(lobbyMsg()); } }, 1500);
      else { hostCheckRound(); liveLater(() => hostReveal(i), E.PREVIEW_MS + (liveQuiz() ? liveMs(i) : (LIVE.secs || DEFAULT_SECS) * 1000) + 8000); }
    }
  }

  /** Read the public room list once (or keep listening with onUpdate). */
  async function scanPublic(ms, onUpdate) {
    const client = await mqttConnect();
    const rooms = new Map();
    client.on("connect", () => client.subscribe(`${TOPIC}/pub/+`));
    client.on("message", (topic, payload) => {
      const code = topic.split("/").pop();
      let d = null; try { d = payload.length ? JSON.parse(payload.toString()) : null; } catch { d = null; }
      if (!d || Date.now() - (+d.at || 0) > 45000) rooms.delete(code); else rooms.set(code, d);
      if (onUpdate) onUpdate(rooms);
    });
    if (!ms) return { client, rooms };
    await new Promise((r) => setTimeout(r, ms));
    try { client.end(true); } catch { /* ignore */ }
    return { rooms };
  }

  async function liveCreate(name, isPublic) {
    LS.set("name", name);
    renderLiveStatus("Opening a room…");
    let code = window.MLION_LIVE_CODE || rid(5);
    try {
      if (isPublic) {
        renderLiveStatus("Finding a free public room…");
        const { rooms } = await scanPublic(1800);
        code = "";
        for (let k = 1; k <= PUB_SLOTS && !code; k++) if (!rooms.has(pubCode(k))) code = pubCode(k);
        if (!code) return renderLiveStatus("All public rooms are in use. Join one, or make a private room.", true);
      }
      renderLiveStatus("Connecting to the live server…");
      const client = await mqttConnect(isPublic ? { will: { topic: infoTopic(code), payload: "", retain: true, qos: 1 } } : {});
      const id = "h" + rid(8);
      let ready = false;
      const fail = setTimeout(() => { if (!ready) { try { client.end(true); } catch { /* ignore */ } renderLiveStatus("Couldn't reach the live server. Check your connection and try again.", true); } }, 15000);
      client.on("connect", () => {
        client.subscribe([`${roomTopic(code)}/up`, `${roomTopic(code)}/down`]);
        if (ready) { broadcast(lobbyMsg()); return; } // reconnected after a blip
        ready = true; clearTimeout(fail);
        Object.assign(LIVE, { active: true, code, isHost: false, isPublic: !!isPublic, client, myId: id, phase: "lobby", ep: 0, noRepeat: LS.get("liveNoRepeat", true) !== false, rules: cleanRules(LS.get("liveRules", null)), secs: validSecs(LS.get("liveSecs", DEFAULT_SECS)) ? LS.get("liveSecs", DEFAULT_SECS) : DEFAULT_SECS, fmt: ["quiz", "sprint"].includes(LS.get("liveFmt", "rarity")) ? LS.get("liveFmt") : "rarity", topics: (LS.get("liveTopics", []) || []).filter((id) => PACKS.has(id)) });
        LIVE.players.set(id, { id, name, host: true, ans: {}, seen: Date.now() });
        if (LIVE.fmt === "sprint") liveSetFmt("sprint", true);
        becomeHost();
        go(liveHash());
      });
      client.on("message", (topic, payload) => hostIncoming(topic, payload));
    } catch {
      renderLiveStatus("Couldn't load live play. Check your connection and try again.", true);
    }
  }

  const JOIN_PATIENCE_MS = 120000;
  let joinState = null; // { code, name, client, id, started, joined, lastHost }
  async function liveJoin(code, name, keepId) {
    LS.set("name", name);
    leaveLive(true);
    renderJoinWait(code, "Connecting to the live server…");
    let client;
    try { client = await mqttConnect(); } catch { return renderLiveStatus("Couldn't load live play. Check your connection and try again.", true); }
    const id = keepId || "g" + rid(8);
    const js = joinState = { code, name, client, id, started: Date.now(), joined: false, lastHost: 0, tries: 0 };
    const hello = () => pubJSON(client, `${roomTopic(code)}/up`, { from: id, t: "hello", name, v: 2 });
    client.on("connect", () => {
      client.subscribe([`${roomTopic(code)}/down`, `${roomTopic(code)}/to/${id}`]);
      if (LIVE.isHost && LIVE.client === client) { client.subscribe(`${roomTopic(code)}/up`); broadcast(lobbyMsg()); return; }
      if (!js.joined) { renderJoinWait(code, "Connected. Asking the host to let you in…"); hello(); }
    });
    client.on("offline", () => { if (js.joined) toast("Connection lost. Reconnecting…"); });
    js.helloTimer = setInterval(() => {
      if (joinState !== js) return clearInterval(js.helloTimer);
      if (js.joined) {
        pubJSON(client, `${roomTopic(code)}/up`, { from: id, t: "hb" });
        const quiet = Date.now() - js.lastHost;
        if (quiet > 11000 && client.connected) maybeTakeOver();
        if (joinState !== js) return;
        if (quiet > 60000) { clearInterval(js.helloTimer); leaveLive(); renderLiveStatus("The host left the room.", true); }
        else if (quiet > 6000 && !js.warned) { js.warned = true; toast("Lost the host. Reconnecting…"); }
        return;
      }
      if (Date.now() - js.started > JOIN_PATIENCE_MS) {
        clearInterval(js.helloTimer); leaveLive();
        return renderLiveStatus("The host didn't answer. Check they still have MLion open, then try again.", true);
      }
      js.tries++;
      if (client.connected) {
        renderJoinWait(code, js.lastHost ? `Room found. Joining… (try ${js.tries})` : `Waiting for the host to answer… (try ${js.tries}). If they switched apps, ask them to go back to MLion.`);
        hello();
      } else renderJoinWait(code, "Reaching the live server…");
    }, 3000);
    client.on("message", (topic, payload) => {
      let d; try { d = JSON.parse(payload.toString()); } catch { return; }
      if (joinState !== js || !d || typeof d !== "object") return;
      if (Number.isFinite(+d.ep)) { if (+d.ep < (LIVE.ep || 0)) return; LIVE.ep = +d.ep; }
      js.lastHost = Date.now(); js.warned = false;
      if (Number.isFinite(+d.now)) { const o = +d.now - Date.now(); LIVE.offset = LIVE.offset == null ? o : LIVE.offset * 0.7 + o * 0.3; }
      if (d.t === "hb") return;
      if (d.t === "full") { leaveLive(); return renderLiveStatus("That room is full. Open rooms take two players.", true); }
      if (!LIVE.active) {
        if (d.t !== "lobby" || !Array.isArray(d.players) || !d.players.some((p) => p && p.id === id)) return;
        js.joined = true;
        const me = d.players.find((p) => p.id === id);
        Object.assign(LIVE, { active: true, code, isHost: false, client, myId: id, phase: me.late && d.phase === "playing" ? "waiting" : "lobby" });
        syncChat();
        if (LIVE.phase === "waiting") { renderLiveStatus("You're in. A match is in progress, so you'll play the next one.", false); return; }
      }
      if (d.t === "lobby" && Array.isArray(d.players) && !d.players.some((p) => p && p.id === id)) { hello(); return; } // our seat expired: ask again
      if (d.t === "busy") { LIVE.phase = "waiting"; renderLiveStatus("You're in. A match is in progress, so you'll play the next one.", false); return; }
      if (d.t === "resume") {
        LIVE.phase = "playing";
        toast("Back in the match");
        if (d.fmt === "sprint" && !(liveSprint() && SPR)) liveSprintRestore(d);
        if (liveSprint() && SPR) liveSprintBackIn();
        else if (RUN && RUN.mode === "live") {
          if (descent) { descent.destroy(); descent = null; }
          renderPlayShell();
          $("#card").innerHTML = `<div class="intro-card"><div><h2>You're back</h2><p class="sub">The next question starts in a moment.</p></div></div>`;
        }
        return;
      }
      if (d.t === "lobby" && LIVE.phase === "waiting" && d.phase !== "playing") LIVE.phase = "lobby";
      if (LIVE.phase === "waiting" && d.t !== "lobby" && d.t !== "start" && d.t !== "chat") return; // sitting out still hears the room
      apply(d);
    });
  }
  document.addEventListener("visibilitychange", () => {
    const c = LIVE.client || (joinState && joinState.client);
    if (document.visibilityState === "visible" && c && !c.connected) { try { c.reconnect(); } catch { /* auto-reconnect continues */ } }
  });

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
    $("#live-cancel").addEventListener("click", () => leaveLive());
  }
  function renderLiveStatus(text, retry) {
    setMid("Live");
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Live match</h1><p class="${retry ? "live-err" : ""}" role="status">${esc(text)}</p></div>
      ${retry ? `<div class="btn-row"><a class="btn primary big" href="#live">Back</a></div>` : ""}
    </section>`;
  }
  function renderLiveStart(code) {
    const joining = !!code;
    setMid(joining ? "Live" : "Play with friends");
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>${joining ? "Join live match" : "Play with friends"}</h1>
        <p>${joining ? `Room ${esc(code)}. Same questions, same clock, scores live.` : "Make a room and send the link, or join an open room below. Same questions, same clock."}</p>
        ${joining ? "" : `<p class="lv-note" id="live-fmt-line">Your room opens as <b>${({ rarity: "Classic", quiz: "Quiz", sprint: "Sprint" })[["quiz", "sprint"].includes(LS.get("liveFmt", "rarity")) ? LS.get("liveFmt") : "rarity"]}</b>. You can change it in the room.</p>`}</div>
      <div class="vs-form">
        <label class="vs-field"><span>Your name</span><input class="search" id="live-name" maxlength="16" autocomplete="nickname" placeholder="Shown to everyone" value="${esc(myName())}"></label>
        ${joining ? "" : `<label class="lv-check"><input type="checkbox" id="live-public"><span>List it under open rooms, so one stranger can join you</span></label>`}
        <div class="btn-row"><button class="btn primary big" id="live-go">${joining ? "Join" : "Create room"}</button></div>
      </div>
      ${joining ? "" : `<section class="lv-open"><h2 class="block-title">Open rooms</h2><p id="rooms-status" role="status">Looking for rooms…</p>
        <ul class="lv-players" id="rooms-list"></ul>
        <p class="lv-note">Not online at the same time? <a href="#challenge">Send a challenge link</a>: same questions, play whenever.</p></section>`}
    </section>`;
    if (!joining) watchRooms();
    const go1 = () => {
      const name = cleanName($("#live-name").value) || "Player";
      joining ? liveJoin(code, name) : liveCreate(name, !!($("#live-public") && $("#live-public").checked));
    };
    $("#live-go").addEventListener("click", go1);
    $("#live-name").addEventListener("keydown", (e) => { if (e.key === "Enter") go1(); });
    $("#live-name").focus();
  }
  function avatar(name) { return `<span class="lv-av" aria-hidden="true">${esc((name || "?").slice(0, 1).toUpperCase())}</span>`; }
  function sendReady(v) {
    if (LIVE.isHost) hostReady(LIVE.myId, v); else guestSend({ t: "ready", v });
  }
  function readyBlock(label) {
    const me = LIVE.players.get(LIVE.myId);
    const ps = playerList();
    const cd = LIVE.countdownAt && LIVE.countdownAt > hostNow() ? Math.ceil((LIVE.countdownAt - hostNow()) / 1000) : 0;
    if (cd) return `<div class="lv-banner" role="status">Starting in <b id="lv-cd">${cd}</b>…</div>`;
    const waiting = ps.filter((p) => !p.ready).map((p) => (p.id === LIVE.myId ? "you" : p.name));
    return `<div class="btn-row"><button class="btn ${me && me.ready ? "" : "primary "}big" id="live-ready" ${ps.length < 2 ? "disabled" : ""}>${me && me.ready ? "Not ready" : label}</button></div>
      <p class="lv-note">${ps.length < 2 ? "The match starts when two players are here and both tap Ready." : waiting.length ? `Waiting for ${esc(waiting.join(" and "))} to tap Ready.` : "Everyone's ready…"}</p>`;
  }
  function wireReady() {
    const b = $("#live-ready");
    if (b) b.addEventListener("click", () => { const me = LIVE.players.get(LIVE.myId); sendReady(!(me && me.ready)); });
    if (LIVE.countdownAt && LIVE.countdownAt > hostNow()) {
      const tick = () => { const el = $("#lv-cd"); if (!el) return; const left = Math.ceil((LIVE.countdownAt - hostNow()) / 1000); if (left > 0) { el.textContent = left; setTimeout(tick, 200); } };
      tick();
    }
  }
  /** The host picks a format. Sprint keeps its own prompt count (a minute each makes 7 far too long); the old count returns with the other formats. */
  function liveSetFmt(f, init) {
    const was = init ? "rarity" : LIVE.fmt; // a new room already holds the saved format but not its count
    if (f === "sprint" && was !== "sprint") { LIVE.nOther = validQ(LIVE.n) ? LIVE.n : 7; const k = LS.get("liveSprintN", SP_DEFAULT_N); LIVE.n = validQ(k) ? k : SP_DEFAULT_N; }
    else if (was === "sprint" && f !== "sprint") LIVE.n = validQ(LIVE.nOther) ? LIVE.nOther : 7;
    LIVE.fmt = f;
    if (!init) { LS.set("liveFmt", f); broadcast(lobbyMsg()); }
  }
  function renderLobby() {
    if (!LIVE.active) return;
    const typingN = document.activeElement && document.activeElement.id === "q-custom" ? document.activeElement.value : null;
    setMid(`Room ${LIVE.code}`);
    const ps = playerList();
    const host = ps.find((p) => p.host);
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Room <span class="lv-code">${esc(LIVE.code)}</span></h1>
        <p>${LIVE.isPublic ? "Open room for two, listed for anyone to join. " : ""}${ps.length < 2 ? "Waiting for someone to join…" : `${ps.length} players here.`}</p>
        ${LIVE.isHost ? `<p class="lv-note">Keep MLion open while friends join. If you switch apps, come back here and the room reconnects.</p>` : ""}</div>
      ${LIVE.flash ? `<div class="lv-banner" id="lv-banner" role="alert">${esc(LIVE.flash)}</div>` : ""}
      <div class="btn-row"><button class="btn ${ps.length < 2 ? "primary " : ""}big" id="live-invite">Invite friends</button><a class="btn big" href="#live" id="live-leave-lobby">Leave</a></div>
      <ul class="lv-players" aria-live="polite">${ps.map((p) => `<li class="${p.id === LIVE.myId ? "me" : ""}">${avatar(p.name)}<b>${esc(p.name)}</b><span>${p.away ? "Reconnecting…" : `${p.ready ? "Ready ✓" : "Not ready"}${p.id === LIVE.myId ? " · You" : ""}`}</span></li>`).join("")}
        ${ps.length < 2 ? `<li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Waiting for a friend…</span></li>` : ""}</ul>
      ${LIVE.isHost ? `<div class="vs-form">
        <div class="vs-field"><span>Format</span><div class="vs-sizes" role="radiogroup" aria-label="Format">${[["rarity", "Classic"], ["quiz", "Quiz"], ["sprint", "Sprint"]].map(([k, l]) => `<button type="button" class="vs-size lv-fmt${(LIVE.fmt || "rarity") === k ? " on" : ""}" role="radio" aria-checked="${(LIVE.fmt || "rarity") === k}" data-f="${k}">${l}</button>`).join("")}</div></div>
        ${LIVE.fmt === "quiz" || LIVE.fmt === "sprint" ? "" : `<div class="vs-field"><span>Autocorrect help</span><div class="vs-sizes" role="radiogroup" aria-label="Autocorrect help">${[["off", "Off"], ["typos", "Typos"], ["full", "Full"], ["generous", "Generous"]].map(([k, l]) => `<button type="button" class="vs-size lv-assist${(LIVE.assist || "typos") === k ? " on" : ""}" role="radio" aria-checked="${(LIVE.assist || "typos") === k}" data-a="${k}">${l}</button>`).join("")}</div></div>`}
        ${topicPicker()}
        ${qPicker(LIVE.n, LIVE.fmt === "sprint" ? "sprints" : "questions")}
        ${LIVE.fmt === "sprint" ? "" : timePicker(LIVE.secs || DEFAULT_SECS)}
        ${LIVE.fmt === "sprint" ? "" : rulesPanel()}
        <label class="lv-check"><input type="checkbox" id="live-norepeat" ${LIVE.noRepeat !== false ? "checked" : ""}><span>Skip questions this room already played</span></label>
      </div>` : `<p class="lv-note">${esc(host ? host.name : "The host")} picks the settings. ${LIVE.fmt === "sprint" ? `${LIVE.n} ${LIVE.n === 1 ? "sprint" : "sprints"} of ${SPRINT_SECS} s` : `${LIVE.n} ${LIVE.n === 1 ? "question" : "questions"} · ${LIVE.secs || DEFAULT_SECS} s each`} · ${liveTopics().length ? `${liveTopics().map((id) => PACKS.get(id).name).join(", ")} · ` : ""}${LIVE.fmt === "sprint" ? "Sprint format: name as many as you can, rarer scores more and adds time." : LIVE.fmt === "quiz" ? "Quiz format, pick one of four." : `autocorrect ${({ off: "off", typos: "typos only", full: "full", generous: "generous" })[LIVE.assist || "typos"]}. Classic format: type answers, rarer scores more.`}${activeRules(LIVE.rules, LIVE.fmt).length ? ` Options: ${esc(activeRules(LIVE.rules, LIVE.fmt).join(", "))}.` : ""}</p>`}
      ${readyBlock("Ready")}
    </section>`;
    $("#live-invite").addEventListener("click", () => shareLink(`Play MLion live with me. Room ${LIVE.code}:\n${(SHARE_BASE ? WEB_URL : siteUrl() || WEB_URL)}#${liveHash()}`));
    wireQPicker(() => LIVE.n, (n) => { LIVE.n = n; if (LIVE.fmt === "sprint") LS.set("liveSprintN", n); broadcast(lobbyMsg()); }, LIVE.fmt === "sprint" ? "sprints" : "questions");
    wireTimePicker((secs) => { LIVE.secs = secs; LS.set("liveSecs", secs); broadcast(lobbyMsg()); });
    const ll = $("#live-leave-lobby");
    if (ll) ll.addEventListener("click", () => leaveLive(false));
    $$(".lv-assist").forEach((b) => b.addEventListener("click", () => { LIVE.assist = b.dataset.a; broadcast(lobbyMsg()); }));
    $$(".lv-topic").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.p, t = liveTopics();
      LIVE.topics = !id ? [] : t.includes(id) ? t.filter((x) => x !== id) : t.concat(id);
      if (LIVE.topics.length === DATA.packs.length) LIVE.topics = []; // every topic picked is the same as all
      LS.set("liveTopics", LIVE.topics);
      broadcast(lobbyMsg());
    }));
    $$(".lv-fmt").forEach((b) => b.addEventListener("click", () => liveSetFmt(b.dataset.f)));
    $$(".lv-rule").forEach((b) => b.addEventListener("click", () => setRule(b.dataset.k, b.dataset.v)));
    $$(".lv-rule-x").forEach((x) => x.addEventListener("change", () => setRule(x.dataset.k, x.checked)));
    const more = $("#lv-more");
    if (more) more.addEventListener("toggle", () => { LIVE.moreOpen = more.open; });
    if (typingN !== null && $("#q-custom")) { const box = $("#q-custom"); box.value = typingN; box.focus(); }
    const nr = $("#live-norepeat");
    if (nr) nr.addEventListener("change", () => { LIVE.noRepeat = nr.checked; LS.set("liveNoRepeat", nr.checked); });
    wireReady();
  }
  /** The host's More options: closed by default, so the lobby stays short; the summary counts what's on. */
  function rulesPanel() {
    const r = LIVE.rules || RULES_DEFAULT, quiz = LIVE.fmt === "quiz";
    const seg = (key, label, choices) => `<div class="vs-field"><span>${label}</span><div class="vs-sizes" role="radiogroup" aria-label="${label}">${choices.map(([k, l]) => `<button type="button" class="vs-size lv-rule${r[key] === k ? " on" : ""}" role="radio" aria-checked="${r[key] === k}" data-k="${key}" data-v="${k}">${l}</button>`).join("")}</div></div>`;
    const tog = (key, label) => `<label class="lv-check"><input type="checkbox" class="lv-rule-x" data-k="${key}"${r[key] ? " checked" : ""}><span>${label}</span></label>`;
    const on = activeRules(r, LIVE.fmt).length;
    return `<details class="lv-more" id="lv-more"${LIVE.moreOpen ? " open" : ""}><summary>More options${on ? `<b>${on} on</b>` : ""}</summary>
      <div class="lv-more-body">
        ${seg("speed", "Speed bonus: answer early for more points", RULE_CHOICES.speed)}
        ${seg("hints", quiz ? "50:50: remove two wrong answers" : "Hints: first letter and a clue", RULE_CHOICES.hints)}
        ${quiz ? "" : seg("miss", "Wrong answers", RULE_CHOICES.miss)}
        ${tog("final", "Final question counts double")}
        ${quiz ? "" : tog("clash", "Clash: an answer someone else also gave scores half")}
      </div></details>`;
  }
  function setRule(k, v) {
    LIVE.rules = cleanRules({ ...LIVE.rules, [k]: v });
    LS.set("liveRules", LIVE.rules);
    broadcast(lobbyMsg());
  }
  /** Everyone else, live: what they're typing, what bounced, what they locked in. */
  function renderRivals() {
    const el = $("#live-rivals");
    if (!el || !RUN || RUN.mode !== "live") return;
    const i = RUN.round;
    const iDone = RUN.results.length > i || LIVE.revealed >= i; // no peeking until you've answered
    const mask = (x) => "•".repeat(Math.min(24, String(x).length));
    const others = inMatch().filter((p) => p.id !== LIVE.myId);
    if (liveQuiz()) { // no typing in a quiz: "answered" until you've answered yourself, then what they picked (the verdict waits for the reveal)
      const q = LIVE.quiz[i];
      el.innerHTML = others.map((p) => {
        const a = p.ans[i];
        const line = !a ? `<span class="rv-typing"><span class="muted">thinking</span></span>`
          : !iDone ? `<span class="rv-locked"><b>Locked in ✓</b></span>`
          : `<span class="rv-locked">${a.pick >= 0 && q ? `<span class="rv-pick">${esc(String(a.pick + 1))}</span><b>${esc(q.options[a.pick])}</b>` : `<b>No answer</b>`}</span>`;
        return `<div class="rv${a ? " done" : ""}">${avatar(p.name)}<div class="rv-main"><span class="rv-name">${esc(p.name)}${p.away ? " · reconnecting" : ""}</span>${line}</div></div>`;
      }).join("");
      return;
    }
    el.innerHTML = others.map((p) => {
      const a = p.ans[i];
      const ty = p.typing && p.typing.i === i ? p.typing : { draft: "", tried: [] };
      const line = a
        ? (iDone ? `<span class="rv-locked t-${tierOf(a.tier)}">${G(a.tier)}<b>${a.answer ? esc(a.answer) : "No answer"}</b><em>+${a.score}</em></span>`
          : `<span class="rv-locked"><b>Locked in ✓</b></span>`)
        : `<span class="rv-typing">${ty.draft ? (iDone ? `<span class="rv-draft">${esc(ty.draft)}</span>` : `<span class="rv-mask">${mask(ty.draft)}</span>`) : `<span class="muted">thinking</span>`}<i class="rv-caret"></i></span>`;
      // once you've answered, watch them type for real: draft and bounced guesses in the clear
      const tried = a || !ty.tried.length ? ""
        : iDone ? `<span class="rv-tried">${ty.tried.map((x) => `<s>${esc(x)}</s>`).join("")}</span>`
        : `<span class="rv-tried">${ty.tried.length} wrong ${ty.tried.length === 1 ? "guess" : "guesses"}</span>`;
      return `<div class="rv${a ? " done" : ""}">${avatar(p.name)}<div class="rv-main"><span class="rv-name">${esc(p.name)}${p.away ? " · reconnecting" : ""}</span>${line}${tried}</div></div>`;
    }).join("");
  }
  let typingSent = 0, typingTimer = 0;
  /** Tell the room what this player is typing (throttled). */
  function liveTyping() {
    if (!RUN || RUN.mode !== "live" || !LIVE.active) return;
    const send = () => {
      typingSent = Date.now();
      const m = { t: "typing", i: RUN.round, draft: String(RUN.draft || "").slice(0, 60), tried: (RUN.tried || []).slice(-6) };
      if (LIVE.isHost) broadcast(Object.assign({ id: LIVE.myId }, m)); else guestSend(m);
    };
    clearTimeout(typingTimer);
    const wait = 220 - (Date.now() - typingSent);
    if (wait <= 0) send(); else typingTimer = setTimeout(send, wait);
  }
  function renderStrip() {
    if (liveSprint()) return liveSprintBoard();
    renderRivals();
    renderSkip();
    const el = $("#live-strip");
    if (!el || !RUN || RUN.mode !== "live") return;
    const i = RUN.round;
    el.innerHTML = inMatch().map((p) => {
      const done = !!p.ans[i];
      const iDone = RUN.results.length > i || LIVE.revealed >= i;
      const tot = shownTotal(p) - (!liveQuiz() && !iDone && p.id !== LIVE.myId ? roundPts(p, i) : 0); // quiz totals already count revealed rounds only
      return `<span class="lp${p.id === LIVE.myId ? " me" : ""}${done ? " done" : ""}">${avatar(p.name)}<b>${esc(p.name)}</b><em>${tot}</em>${done && LIVE.revealed < i ? `<i class="lp-tick" aria-label="answered">✓</i>` : ""}</span>`;
    }).join("");
  }
  /** Vote to skip the open question; shows who else wants to. */
  function renderSkip() {
    const el = $("#live-skip");
    if (!el || !RUN || RUN.mode !== "live") return;
    const i = RUN.round;
    if (LIVE.phase !== "playing" || i <= LIVE.revealed || RUN.phase === "intro") { el.innerHTML = ""; return; }
    const cur = LIVE.skip && LIVE.skip.i === i ? LIVE.skip : { ids: [], need: skipNeed() };
    const mine = cur.ids.includes(LIVE.myId);
    const others = cur.ids.filter((id) => id !== LIVE.myId).map((id) => (LIVE.players.get(id) || {}).name).filter(Boolean);
    el.innerHTML = `<button type="button" class="btn sm${mine ? " on" : ""}" id="skip-vote" aria-pressed="${mine}">${mine ? "Voted to skip" : "Vote to skip"}${cur.ids.length ? ` · ${cur.ids.length} of ${cur.need}` : ""}</button>${others.length ? `<span class="skip-who">${esc(others.join(", "))} ${others.length === 1 ? "wants" : "want"} to skip</span>` : ""}`;
    $("#skip-vote").addEventListener("click", () => {
      const m = { t: "skipvote", i, v: !mine };
      if (LIVE.isHost) hostSkipVote(LIVE.myId, i, m.v); else guestSend(m);
    });
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
    if (liveQuiz()) return renderQuizReveal(i);
    const p = PROMPTS.get(RUN.promptIds[i]);
    const ps = inMatch().sort((a, b) => roundPts(b, i) - roundPts(a, i));
    const standings = inMatch().sort((a, b) => shownTotal(b) - shownTotal(a));
    const last = i + 1 >= LIVE.n;
    $("#card").innerHTML = `<div class="lv-reveal">
      <p class="fb-q">${esc(p.text)}</p>
      <ul class="lv-answers">${ps.map((pl) => {
        const a = pl.ans[i];
        const x = a && explainOf(p.id, a.answer);
        return `<li class="t-${tierOf(a && a.tier)}${pl.id === LIVE.myId ? " me" : ""}">${avatar(pl.name)}<span><b>${esc(pl.name)}</b><span class="la">${a && a.answer ? esc(a.answer) : "No answer"}</span>${x ? `<span class="lx">${esc(x)}</span>` : ""}${liveTags(pl, i)}</span>${G(a && a.tier)}<em>+${roundPts(pl, i)}</em></li>`;
      }).join("")}</ul>
      <ol class="lv-standings">${standings.map((pl) => `<li class="${pl.id === LIVE.myId ? "me" : ""}"><b>${esc(pl.name)}</b><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
      <p class="lv-note">${last ? "Final standings coming up…" : `Question ${i + 2} of ${LIVE.n} coming up…`}</p>
    </div>`;
  }
  /** Under a player's answer in the reveal: what the room's rules did to it. */
  function liveTags(pl, i) {
    const r = LIVE.mrules, a = pl.ans[i];
    if (!r || !a || !a.tier) return "";
    const t = [];
    if (r.speed !== "off") t.push(`×${E.speedMult(r, a.ms, liveMs(i)).toFixed(1)} speed`);
    if (a.hint) t.push("hint");
    if ((r.miss === "5" || r.miss === "10") && a.miss) t.push(`−${+r.miss * a.miss}`);
    if (r.final && i === LIVE.n - 1) t.push("×2 final");
    if (clashed(pl, i)) t.push("clash: half");
    return t.length ? `<span class="lv-tags">${t.join(" · ")}</span>` : "";
  }
  /** The reveal of a quiz question: the four options, who picked which, the right one lit, standings underneath. */
  function renderQuizReveal(i) {
    const q = LIVE.quiz && LIVE.quiz[i];
    if (!q) return;
    const p = PROMPTS.get(q.promptId);
    const ps = inMatch();
    const standings = ps.slice().sort(rankCmp);
    const x = explainOf(q.promptId, q.options[q.correct]);
    const silent = ps.filter((pl) => !pl.ans[i] || pl.ans[i].pick < 0);
    const last = i + 1 >= LIVE.n;
    $("#card").innerHTML = `<div class="lv-reveal">
      <p class="fb-q">${esc(p.text)}</p>
      <ul class="mq-opts">${q.options.map((o, k) => {
        const who = ps.filter((pl) => pl.ans[i] && pl.ans[i].pick === k);
        return `<li class="${k === q.correct ? "right" : ""}"><span class="mcq-k">${k === q.correct ? qmark(true) : k + 1}</span>
          <span class="mcq-t"><b>${esc(o)}</b>${k === q.correct ? (x ? `<span class="mcq-x">${esc(x)}</span>` : "") : fromLabel(q, k)}</span>
          <span class="mcq-who">${who.map((pl) => `<i class="${pl.id === LIVE.myId ? "me" : ""}">${esc(pl.name)}</i>`).join("")}</span></li>`;
      }).join("")}</ul>
      ${silent.length ? `<p class="lv-note">No answer: ${esc(silent.map((pl) => pl.name).join(", "))}</p>` : ""}
      <ol class="lv-standings">${standings.map((pl) => `<li class="${pl.id === LIVE.myId ? "me" : ""}"><b>${esc(pl.name)}</b><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
      <p class="lv-note">${last ? "Final standings coming up…" : `Question ${i + 2} of ${LIVE.n} coming up…`}</p>
    </div>`;
  }
  /** Quiz verdicts wait for the reveal: only then do the dots, score and ball move for the round. */
  function liveQuizSettle(i) {
    if (!RUN || RUN.mode !== "live" || RUN.fmt !== "quiz" || RUN.settled >= i) return;
    const res = RUN.results[i];
    if (!res) return;
    RUN.settled = i;
    updateHead();
    const total = totalScore(RUN.results.slice(0, i + 1));
    if (descent) {
      descent.set(RUN.results.slice(0, i));
      hudRange = [total - res.score, total];
      if (res.tier) Sound.tier(res.tier); else Sound.miss();
      const upTo = RUN.results.slice(0, i + 1);
      descent.roll(res.tier, res.score, () => { const el = $("#hud-score"); if (el) { el.classList.remove("crank"); void el.offsetWidth; el.classList.add("crank"); } celebrate(upTo, res.ms); });
      setTimeout(() => { if (RUN && RUN.fmt === "quiz") setHud(totalScore(RUN.results.slice(0, Math.max(i, LIVE.revealed) + 1))); }, 1500);
    } else { setHud(total); showStreak(streakOf(RUN.results.slice(0, i + 1)), "set"); }
  }
  function renderPodium() {
    stopRun();
    liveSprintStop();
    setMid(`Room ${LIVE.code}`);
    scene("results");
    const quiz = liveQuiz(), sprint = liveSprint();
    const ps = (sprint ? spPlayers() : inMatch()).sort(rankCmp);
    const top = ps.length ? ps[0] : null;
    const winners = top ? ps.filter((p) => rankCmp(p, top) === 0) : [];
    const timeNote = quiz && ps.length > 1 && shownTotal(ps[0]) === shownTotal(ps[1]) && liveTotalMs(ps[0]) !== liveTotalMs(ps[1])
      ? ` · level on points, ${esc(ps[0].name)} was faster (${fmtSecs(liveTotalMs(ps[0]) / 100)} to ${fmtSecs(liveTotalMs(ps[1]) / 100)})` : "";
    const ids = (LIVE.ids || []).slice(0, LIVE.n).filter((id) => PROMPTS.has(id));
    const me = LIVE.players.get(LIVE.myId);
    const openKeys = new Set($$("details.key[open]", app).map((d) => d.dataset.pid)); // redraws (Ready taps) keep what you opened
    const rightOf = (i) => (quiz && LIVE.quiz[i] ? LIVE.quiz[i].options[LIVE.quiz[i].correct] : null);
    const recap = ids.length ? `
      <section class="lv-recap">
        <h2 class="block-title">Answers</h2>
        ${ids.map((pid, i) => sprint ? `<div class="rc"><p class="rc-q">${esc(PROMPTS.get(pid).text)}</p>${spRowsHtml(i)}</div>` : quiz ? (() => { const q = LIVE.quiz[i], x = q && explainOf(pid, rightOf(i)); return q ? `<div class="rc"><p class="rc-q">${esc(PROMPTS.get(pid).text)}</p>
          <p class="rc-right">${qmark(true)}<span><b>${esc(rightOf(i))}</b>${x ? `<span class="rx">${esc(x)}</span>` : ""}</span></p>
          <ul class="rc-list">${ps.map((pl) => { const a = pl.ans[i]; return `<li class="t-${a && a.ok ? QUIZ_TIER : "miss"}${pl.id === LIVE.myId ? " me" : ""}">${qmark(a && a.ok)}<span><span class="rn">${esc(pl.name)}</span><span class="ra">${a && a.pick >= 0 ? esc(q.options[a.pick]) : "No answer"}</span></span><em>+${roundPts(pl, i)}</em></li>`; }).join("")}</ul></div>` : ""; })() : `<div class="rc"><p class="rc-q">${esc(PROMPTS.get(pid).text)}</p><ul class="rc-list">${ps.map((pl) => {
          const a = pl.ans[i], x = a && explainOf(pid, a.answer);
          return `<li class="t-${tierOf(a && a.tier)}${pl.id === LIVE.myId ? " me" : ""}">${G(a && a.tier)}<span><span class="rn">${esc(pl.name)}</span><span class="ra">${a && a.answer ? esc(a.answer) : "No answer"}</span>${x ? `<span class="rx">${esc(x)}</span>` : ""}</span><em>+${roundPts(pl, i)}</em></li>`;
        }).join("")}</ul></div>`).join("")}
      </section>
      <section>
        <h2 class="block-title">Answer keys</h2>
        ${ids.map((pid, i) => (PROMPTS.get(pid).reasoning ? "" : answerKey(PROMPTS.get(pid), quiz ? rightOf(i) : me && me.ans[i] && me.ans[i].answer, openKeys.has(pid)))).join("")}
      </section>` : "";
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>${winners.length > 1 ? "It's a tie" : `${esc(winners[0] ? winners[0].name : "")} wins`}</h1><p>${sprint ? `${LIVE.n} ${LIVE.n === 1 ? "sprint" : "sprints"}` : `${LIVE.n} questions`}${quiz ? " · Quiz" : ""} · Room ${esc(LIVE.code)}${timeNote}</p></div>
      <ol class="lv-podium">${ps.map((pl, k) => `<li class="${k === 0 ? "first" : ""}${pl.id === LIVE.myId ? " me" : ""}">
        <span class="rk">${k + 1}</span>${avatar(pl.name)}<span class="nm"><b>${esc(pl.name)}</b>${sprint ? `<span class="nm-t">${spCount(pl)} ${spCount(pl) === 1 ? "answer" : "answers"}${LIVE.gone.has(pl.id) ? " · left" : ""}</span>` : quiz ? `${qmarksRow(Array.from({ length: LIVE.n }, (_, i) => !!(pl.ans[i] && pl.ans[i].ok)))}<span class="nm-t">${fmtSecs(liveTotalMs(pl) / 100)}</span>` : tiersRow(Array.from({ length: LIVE.n }, (_, i) => (pl.ans[i] && pl.ans[i].tier) || "miss"))}</span><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
      <div class="btn-row">
        <a class="btn big" href="#home" id="live-leave">Leave</a>
      </div>
      ${recap}
    </section>`;
    wireAnswerKeys(app);
    $("#live-leave").addEventListener("click", () => leaveLive(false));
    $("#live-leave").insertAdjacentHTML("beforebegin", readyBlock("Ready for rematch"));
    wireReady();
  }
  // ---- chat: room messages ride the same relay as everything else. Guests send
  // {t:"chat"} up, the host stamps who said it and broadcasts it down. The panel
  // lives outside #app so screen redraws never eat a half-typed message.
  const CHAT_MAX = 200;
  const CHAT = { code: "", msgs: [], unread: 0, open: false, shown: false, leftAt: 0, sent: [] };
  const chatRate = new Map(); // host side: recent message times per player, a flood guard
  const cleanChat = (s) => String(s || "").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
  const chatTyping = () => document.activeElement === $("#chat-input");

  /** Show the chat button only inside a room; keep a room's history if you step out briefly. */
  function syncChat() {
    const on = LIVE.active;
    if (on && (CHAT.code !== LIVE.code || (CHAT.leftAt && Date.now() - CHAT.leftAt > 10 * 60000))) {
      Object.assign(CHAT, { code: LIVE.code, msgs: [], unread: 0, sent: [] });
    }
    if (on) CHAT.leftAt = 0; else if (CHAT.shown) CHAT.leftAt = Date.now();
    CHAT.shown = on;
    $("#chat-btn").hidden = !on;
    $(".topbar").classList.toggle("has-chat", on);
    if (!on) { setChatOpen(false); $("#chat-peek").hidden = true; }
    drawChatBadge();
  }
  function setChatOpen(v, focus) {
    CHAT.open = !!v && LIVE.active;
    $("#chat").hidden = !CHAT.open;
    $("#chat-btn").setAttribute("aria-expanded", String(CHAT.open));
    $("#chat-btn").classList.toggle("on", CHAT.open);
    if (!CHAT.open) { if (chatTyping()) $("#chat-input").blur(); return; }
    CHAT.unread = 0;
    drawChatBadge();
    $("#chat-peek").hidden = true;
    chatViewport();
    drawChatLog();
    if (focus !== false) $("#chat-input").focus({ preventScroll: true });
  }
  function drawChatBadge() {
    const b = $("#chat-badge");
    b.hidden = !CHAT.unread;
    b.textContent = CHAT.unread > 9 ? "9+" : String(CHAT.unread);
    $("#chat-btn").setAttribute("aria-label", CHAT.unread ? `Room chat, ${CHAT.unread} new` : "Room chat");
  }
  function drawChatLog() {
    const log = $("#chat-log");
    if (!CHAT.open) return;
    log.innerHTML = CHAT.msgs.length ? CHAT.msgs.map((m) => {
      const me = m.id === LIVE.myId;
      return `<li class="${me ? "me" : ""}${m.pending ? " pending" : ""}">${me ? "" : avatar(m.name)}<div class="chat-msg">${me ? "" : `<b>${esc(m.name)}</b>`}<p>${esc(m.text)}</p>${m.failed ? `<em>Not sent</em>` : ""}</div></li>`;
    }).join("") : `<li class="chat-empty">No messages yet.</li>`;
    log.scrollTop = log.scrollHeight;
  }
  function chatNote(text) { $("#chat-note").textContent = text || ""; }
  /** A new message from someone else while the panel is shut: a short preview under the button. */
  function peekChat(name, text) {
    const el = $("#chat-peek");
    el.innerHTML = `<b>${esc(name)}</b><span>${esc(text)}</span>`;
    el.hidden = false;
    el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
    clearTimeout(peekChat._t);
    peekChat._t = setTimeout(() => { el.hidden = true; }, 5000);
  }
  function chatIncoming(m) {
    const text = cleanChat(m.text);
    if (!text) return;
    const pl = LIVE.players.get(m.id);
    const name = cleanName(m.name) || (pl && pl.name) || "Player";
    const k = typeof m.k === "string" ? m.k : "";
    const mine = m.id === LIVE.myId;
    const echo = mine && k ? CHAT.msgs.find((x) => x.k === k && x.id === m.id) : null;
    if (echo) { echo.pending = 0; echo.failed = false; drawChatLog(); return; } // our own message came back: delivered
    CHAT.msgs.push({ id: m.id, name, text, k });
    if (CHAT.msgs.length > 150) CHAT.msgs.splice(0, CHAT.msgs.length - 150);
    if (CHAT.open) drawChatLog();
    if (mine) return;
    if (!CHAT.open) { CHAT.unread++; drawChatBadge(); peekChat(name, text); }
    Sound.chat();
  }
  /** The prompt of the question (or sprint) that is open right now, if any. */
  function liveOpenPrompt() {
    if (LIVE.phase !== "playing") return null;
    if (liveSprint()) return SPR && SPR.i > LIVE.revealed ? SPR.p : null;
    if (!RUN || RUN.mode !== "live" || RUN.round <= LIVE.revealed) return null;
    return currentPrompt();
  }
  /** While a question is open, a message that names one of its answers would spoil it
   *  for anyone still thinking, so it waits for the reveal. Exact matches only. */
  function chatSpoiler(text) {
    const p = liveOpenPrompt();
    if (!p) return null;
    const w = text.split(" ").filter(Boolean).slice(0, 40);
    for (let n = Math.min(5, w.length); n >= 1; n--) {
      for (let s = 0; s + n <= w.length; s++) {
        const part = w.slice(s, s + n).join(" ");
        if (E.fullKey(part).length < 3) continue; // "go", "R": too common to block
        const m = E.matchAnswer(p, part);
        if (m.kind === "exact") return m.answer.a;
      }
    }
    return null;
  }
  function sendChat() {
    const input = $("#chat-input");
    const text = cleanChat(input.value);
    if (!text || !LIVE.active) return;
    const spoil = chatSpoiler(text);
    if (spoil) return chatNote(`“${spoil}” answers this question. Send it after the reveal.`);
    const now = Date.now();
    CHAT.sent = CHAT.sent.filter((t) => now - t < 8000);
    if (CHAT.sent.length >= 5) return chatNote("Slow down a little.");
    CHAT.sent.push(now);
    input.value = "";
    chatNote("");
    const k = rid(6);
    if (LIVE.isHost) return hostChat(LIVE.myId, text, k);
    CHAT.msgs.push({ id: LIVE.myId, name: "You", text, k, pending: now });
    drawChatLog();
    guestSend({ t: "chat", text, k });
    setTimeout(() => {
      const msg = CHAT.msgs.find((x) => x.k === k && x.pending);
      if (msg) { msg.pending = 0; msg.failed = true; drawChatLog(); }
    }, 10000);
  }
  function hostChat(id, text, k) {
    const pl = LIVE.players.get(id);
    const clean = cleanChat(text);
    if (!pl || !clean) return;
    const now = Date.now();
    const recent = (chatRate.get(id) || []).filter((t) => now - t < 8000);
    if (recent.length >= 6) return; // a little looser than the sender's own limit, so honest pages never hit it
    recent.push(now);
    chatRate.set(id, recent);
    broadcast({ t: "chat", id, name: pl.name, text: clean, k: typeof k === "string" ? k.slice(0, 8) : "" });
  }
  /** Phones: keep the panel inside the part of the screen the keyboard leaves visible. */
  function chatViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    document.documentElement.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    document.documentElement.style.setProperty("--vv-h", `${vv.height}px`);
  }
  if (window.visualViewport) { visualViewport.addEventListener("resize", chatViewport); visualViewport.addEventListener("scroll", chatViewport); }
  $("#chat-btn").addEventListener("click", () => setChatOpen(!CHAT.open));
  $("#chat-close").addEventListener("click", () => setChatOpen(false));
  $("#chat-peek").addEventListener("click", () => setChatOpen(true));
  $("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat(); });
  $("#chat-input").addEventListener("input", () => chatNote(""));
  document.addEventListener("pointerdown", (e) => { // tap anywhere else to close, like any popover
    if (CHAT.open && !e.target.closest("#chat, #chat-btn, #chat-peek")) setChatOpen(false);
  });

  /** Public rooms: ask each fixed public code who's there. */
  let roomsWatch = null;
  async function watchRooms() {
    if (roomsWatch) { try { roomsWatch.end(true); } catch { /* ignore */ } roomsWatch = null; }
    let latest = new Map(), settled = false;
    const draw = () => {
      const list = $("#rooms-list"), st = $("#rooms-status");
      if (!list || location.hash !== "#live") return;
      const rooms = [...latest.entries()].filter(([, r]) => Date.now() - (+r.at || 0) < 45000).sort((a, b) => a[0].localeCompare(b[0]));
      st.textContent = rooms.length ? `${rooms.length} open ${rooms.length === 1 ? "room" : "rooms"}` : settled ? "No open rooms right now. Make one and tick the box above to list it here." : "Looking for rooms…";
      list.innerHTML = rooms.map(([code, r]) => {
        const max = +r.max || 2, n = +r.players || 1, full = n >= max;
        return `<li>${avatar(r.host)}<b>${esc(cleanName(r.host) || "Someone")}'s room</b><span>${n}/${max} · ${full ? "full" : r.phase === "playing" ? "playing" : "open"}</span>${full ? "" : `<a class="btn sm primary" href="#live-${code}">Join</a>`}</li>`;
      }).join("") || (settled ? "" : `<li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Looking for rooms…</span></li>`);
    };
    try {
      const { client, rooms } = await scanPublic(0, (r) => { latest = r; draw(); });
      roomsWatch = client;
      latest = rooms;
      client.on("connect", () => { const st = $("#rooms-status"); if (st && !latest.size) st.textContent = "Looking for rooms…"; });
      setTimeout(() => { settled = true; draw(); }, 2000);
      every(5000, draw);
    } catch {
      const st = $("#rooms-status"); if (st) st.textContent = "Couldn't reach the live server. Check your connection and reload.";
    }
  }

  if (window.MLION_TEST) window.MLION_LIVE_STATE = LIVE;
  function openLive(code) {
    if (liveBlocked()) return renderLiveBlocked(code);
    if (LIVE.active && code === LIVE.code) return LIVE.phase === "done" ? renderPodium() : LIVE.phase === "playing" && liveSprint() && SPR ? renderSprintShell() : renderLobby();
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
    unlimited: renderUnlimited, quiz: renderQuizHub, packs: renderPacks, archive: renderArchive, library: renderLibrary,
    stats: renderStats, how: renderHow, faq: renderFaq, prefs: renderSettings,
    challenge: renderChallenge,
    admin: renderAdmin,
    live: () => openLive(""),
    rooms: () => go("live"), // old links: the room list is part of #live now
    board: () => renderBoard(""),
    "board-quiz": () => renderBoard("", "quiz"),
    "daily-quiz": () => openRun(dquizSpec(today())),
    sprint: () => renderSprint(""),
  };
  const slugFor = (key) => key.replace(/:/g, "-");
  function keyFromSlug(s) {
    let m;
    if ((m = s.match(/^(daily|archive)-(\d{4}-\d{2}-\d{2})$/))) return `${m[1]}:${m[2]}`;
    if ((m = s.match(/^unlimited-(\d+)$/))) return `unlimited:${m[1]}`;
    if ((m = s.match(/^pack-([a-z]+)-(\d+)$/))) return `pack:${m[1]}:${m[2]}`;
    if ((m = s.match(/^vs-([a-z0-9]+)$/))) return `vs:${m[1]}`;
    if ((m = s.match(/^quiz-(\d+)$/))) return `quiz:${m[1]}`;
    if ((m = s.match(/^vq-([a-z0-9]+)$/))) return `vq:${m[1]}`;
    if ((m = s.match(/^dquiz-(\d{4}-\d{2}-\d{2})$/))) return `dquiz:${m[1]}`;
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
    unmountHomeHero();
    window.scrollTo(0, 0);
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\//g, "-");
    if ((LIVE.active && h !== liveHash()) || (joinState && h !== `live-${joinState.code}`)) leaveLive();
    syncChat();
    if (h !== "live" && typeof roomsWatch !== "undefined" && roomsWatch) { try { roomsWatch.end(true); } catch { /* ignore */ } roomsWatch = null; }
    if (RUN && RUN.mode === "live" && !LIVE.active) stopRun();
    scene("page");
    const navOn = "#" + (/^sprint-/.test(h) ? "sprint" : h || "home");
    $$("#drawer a.nav").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === navOn));
    if (!BROWSE && /^(packs|library|pack-|practice-|answers-|archive)/.test(h)) return go("home");
    if (!BROWSE && /^quiz-\d+$/.test(h) && +h.slice(5) > nextQuiz()) return go(`quiz-${nextQuiz()}`); // same launch rule as Unlimited: no jumping ahead
    if (h === "unlimited-play") return openUnlimited();
    if (SIMPLE[h]) return SIMPLE[h]();
    if (/^vs-/.test(h)) return openChallenge(h);
    if (/^vq-/.test(h)) return openQuizChallenge(h);
    if (/^quiz-\d+$/.test(h)) return openQuiz(Math.max(1, +h.slice(5)));
    if (/^live-[a-z0-9]{5}$/.test(h)) return openLive(h.slice(5));
    if (/^sprint-.+$/.test(h)) return renderSprint(h.slice(7));
    let m;
    if ((m = h.match(/^unlimited-(\d+)$/))) return records[`unlimited:${+m[1]}`] ? go(`results-unlimited-${+m[1]}`) : openUnlimited(); // old run links
    if ((m = h.match(/^pack-([a-z]+)$/))) return PACKS.has(m[1]) ? renderPack(m[1]) : go("packs");
    if ((m = h.match(/^pack-([a-z]+)-(\d+)$/))) return PACKS.has(m[1]) ? openRun(packSpec(m[1], Math.max(1, +m[2]))) : go("packs");
    if ((m = h.match(/^archive-(\d{4}-\d{2}-\d{2})$/))) return openArchive(m[1]);
    if ((m = h.match(/^practice-(.+)$/))) return PROMPTS.has(m[1]) ? openRun(practiceSpec(m[1])) : go("library");
    if ((m = h.match(/^answers-(.+)$/))) return PROMPTS.has(m[1]) ? renderAnswersPage(m[1]) : go("library");
    if ((m = h.match(/^results-(.+)$/))) return renderResults(keyFromSlug(m[1]));
    if ((m = h.match(/^board-(\d{4}-\d{2}-\d{2})$/))) return m[1] >= E.epoch() && m[1] <= today() ? renderBoard(m[1]) : go("board");
    if ((m = h.match(/^board-quiz-(\d{4}-\d{2}-\d{2})$/))) return m[1] >= E.epoch() && m[1] <= today() ? renderBoard(m[1], "quiz") : go("board-quiz");
    renderHome();
  }
  window.addEventListener("hashchange", route);
  if (!BROWSE) $$('#drawer a[href="#packs"], #drawer a[href="#library"]').forEach((a) => a.remove());

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
    else if (inProg) cta = `<a class="btn primary big" href="#daily">${resumeLabel(inProg)}</a>`;
    else cta = `<a class="btn primary big" href="#daily">Start training</a>`;
    cta += `<a class="btn big" href="#live">Play with friends</a>`;
    const progress = rec ? rec.score / 700 : inProg ? totalScore(inProg.results || []) / 700 : 0;
    const unl = LS.get(`run:unlimited:${nextUnlimited()}`);
    const modes = [
      // [href, title, line, class, live format for the "With a friend" button beside it]
      ["#daily", "Daily", rec ? `Today's run · ${rec.score}` : inProg ? `${resumeLabel(inProg)}` : `MLion #${n} · seven prompts`, "hl", "rarity"],
      ["#unlimited-play", "Unlimited", unl && unl.results && unl.results.length ? `Resume · ${unl.results.length} answered` : "Endless prompts, no repeats"],
      ["#quiz", "Quiz", records[`dquiz:${date}`] ? `Today's quiz · ${records[`dquiz:${date}`].score}` : "Multiple choice, a daily one too", "", "quiz"],
      ["#sprint", "Sprint", "60 s, rare answers add time", "", "sprint"],
      ["#board", "Leaderboard", "Today's top scores"],
      ["#prefs", "Settings", "Clock, sound, extra questions"],
    ].filter(([href]) => BOARD_ON || href !== "#board");
    const html = `<section class="screen home">
      <canvas id="hero3d" aria-hidden="true"></canvas>
      ${bannerHtml()}
      <div class="home-hero arrive">
        <div class="brandmark">${V.mark("hero-mark")}<h1 class="wordmark" aria-label="MLion"><span class="line"><span>MLion</span></span></h1></div>
        <p class="pitch">A daily machine-learning word game. Rarer answers roll deeper.</p>
        <div class="hero-cta">${cta}</div>
      </div>
      <section class="depths-sec"><h2>Six depths</h2>${depthList(true)}</section>
      <div class="home-rest">
        <section><h2>More</h2><ul class="modes">${modes.map(([href, t, d, c, f]) => `<li${f ? ` class="duo"` : ""}><a href="${href}"${c ? ` class="${c}"` : ""}>${t}<span>${esc(d)}</span></a>${f ? `<a class="friend" href="#live" data-fmt="${f}" aria-label="Play ${t === "Daily" ? "Classic" : t} with a friend">${DUO}<span>With a friend</span></a>` : ""}</li>`).join("")}</ul></section>
        ${s.played ? `<section><h2>Your descent</h2><div class="figures">
          <div class="figure"><b>${s.cur}</b><span>Streak</span></div>
          <div class="figure"><b>${s.best || "—"}</b><span>Best</span></div>
          <div class="figure"><b>${s.gems}</b><span>Gems</span></div>
        </div></section>` : ""}
        <p class="home-close"><span>One in a MLion</span></p>
      </div>
    </section>`;
    // On a first visit index.html already drew this hero while the questions downloaded. Build the home
    // around that node rather than replacing it, so its entrance carries on instead of restarting.
    const tpl = document.createElement("template"); tpl.innerHTML = html;
    const pre = $(".pre-home .home-hero"), hero = tpl.content.querySelector(".home-hero");
    if (pre && pre.textContent.replace(/\s+/g, "") === hero.textContent.replace(/\s+/g, "")) {
      const sec = pre.parentNode;
      sec.className = "screen home";
      sec.querySelectorAll(":scope > :not(.home-hero)").forEach((el) => el.remove());
      pre.before(tpl.content.querySelector("#hero3d"));
      const ann = tpl.content.querySelector("#announce");
      if (ann) pre.before(ann);
      pre.after(...tpl.content.querySelectorAll(".home > :not(canvas):not(.home-hero)"));
    } else app.replaceChildren(tpl.content);
    $$(".modes a.friend").forEach((a) => a.addEventListener("click", () => LS.set("liveFmt", a.dataset.fmt))); // the room opens in that format
    const annX = $("#announce-x");
    if (annX) annX.addEventListener("click", () => { LS.set("bannerSeen", CFG.banner); $("#announce").remove(); });
    if (mountHomeHero()) document.body.dataset.view = "home"; // the 3D descent replaces the flat backdrop
    else scene("home", { progress, animate: true });
    if (rec) every(1000, () => { const el = $("#cd"); if (el) el.textContent = hhmmss(E.msUntilLocalMidnight()); if (today() !== date) route(); });
  }

  // The 3D descent behind home. Scroll drives the ball piecewise, so each depth row reaches the
  // reading line just as the ball reaches that depth, and it has settled by the end of the list.
  let homeHero = null, homeHeroOff = null;
  function unmountHomeHero() {
    if (homeHeroOff) { homeHeroOff(); homeHeroOff = null; }
    if (homeHero) { homeHero.destroy(); homeHero = null; }
    document.body.classList.remove("hero3d");
  }
  function mountHomeHero() {
    const canvas = $("#hero3d"), rows = $$(".depths-sec .depths li");
    if (!canvas || !window.MLionHero || rows.length !== 6) return false;
    const phone = () => innerWidth < 760;
    let xs = [0, 1], ts = [0, 1];
    function anchors() {
      const line = innerHeight * (phone() ? 0.8 : 0.56); // a phone reads under the basin, a wide screen beside it
      const ys = rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + scrollY + b.height / 2 - line; });
      xs = [0].concat(ys.slice(1), [ys[5] + innerHeight * (phone() ? 0.12 : 0.3)]);
      for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + 1);
      ts = [0].concat(MLionHero.stages.slice(1), [1]);
    }
    function progress() {
      const y = scrollY;
      if (y <= xs[0]) return 0;
      for (let i = 1; i < xs.length; i++) if (y < xs[i]) return ts[i - 1] + ((ts[i] - ts[i - 1]) * (y - xs[i - 1])) / (xs[i] - xs[i - 1]);
      return 1;
    }
    function fade() { // on a phone, rows already read fade as they rise into the basin
      const p = phone();
      for (const r of rows) r.style.setProperty("--fade", p ? Math.max(0, Math.min(1, (r.getBoundingClientRect().top / innerHeight - 0.45) / 0.2)).toFixed(2) : "1");
    }
    document.body.classList.add("hero3d");
    anchors(); fade();
    const h = MLionHero.mount(canvas, {
      progress,
      onStage(i) { rows.forEach((r, k) => { r.classList.toggle("on", k === i); r.classList.toggle("past", k < i); }); },
    });
    if (!h.ok) { h.destroy(); document.body.classList.remove("hero3d"); canvas.remove(); rows.forEach((r) => r.style.removeProperty("--fade")); return false; }
    const onResize = () => { anchors(); fade(); };
    addEventListener("resize", onResize);
    addEventListener("scroll", fade, { passive: true });
    homeHero = h;
    homeHeroOff = () => { removeEventListener("resize", onResize); removeEventListener("scroll", fade); };
    return true;
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
  /** "Resume · 2 of 7 done": what the daily in progress has behind it (a question left open times out). */
  function resumeLabel(run) {
    const done = Math.min((run.results || []).length, 7);
    return done ? `Resume · ${done} of 7 done` : "Resume";
  }
  function totalScore(results) { return results.reduce((s, r) => s + r.score, 0); }

  function openArchive(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < E.epoch() || date > today()) return go("archive");
    if (date === today()) return go("daily");
    if (records[`daily:${date}`]) return go(`results-daily-${date}`);
    if (records[`archive:${date}`]) return go(`results-archive-${date}`);
    openRun(archiveSpec(date));
  }

  function openRun(spec) {
    if (records[spec.key] && spec.mode !== "practice") return go(`results-${slugFor(spec.key)}`);
    let run = spec.mode === "practice" ? null : LS.get("run:" + spec.key);
    if (!run || run.promptIds.join() !== spec.promptIds.join() || (spec.quiz && JSON.stringify(run.quiz) !== JSON.stringify(spec.quiz))) {
      run = { ...spec, answerMs: (validSecs(spec.secs) ? spec.secs : validSecs(settings.answerSecs) ? settings.answerSecs : DEFAULT_SECS) * 1000,
        round: 0, phase: "intro", results: [], tried: [], startedAt: Date.now() };
    }
    RUN = run;
    renderPlayShell();
    resumePhase();
  }

  function openQuiz(n) {
    const spec = quizSpec(n);
    if (!spec.quiz.length) {
      setMid("Quiz");
      app.innerHTML = `<section class="screen"><div class="page-head"><h1>Quiz</h1><p>This question set can't make quiz questions.</p></div><a class="btn big" href="#home">Home</a></section>`;
      return;
    }
    openRun(spec);
  }

  /** Unlimited: resume the session in progress, or start a new one with the next prompt of the deck. */
  function openUnlimited() {
    const n = nextUnlimited(), saved = LS.get(`run:unlimited:${n}`);
    if (saved && !saved.endless) return openRun(unlimitedSpec(n)); // a run of seven from before endless sessions: finish it
    if (saved && saved.promptIds.every((id) => PROMPTS.has(id))) RUN = saved;
    else {
      const pool = unlPoolName();
      RUN = { key: `unlimited:${n}`, mode: "unlimited", endless: true, pool, number: n, label: `Unlimited #${n}`, promptIds: [unlDeal(pool)],
        answerMs: (validSecs(settings.answerSecs) ? settings.answerSecs : DEFAULT_SECS) * 1000, round: 0, phase: "intro", results: [], tried: [], startedAt: Date.now() };
    }
    renderPlayShell();
    resumePhase();
  }
  /** Stop an endless session: the prompt on screen is dropped unless answered, and what was answered becomes the session's result. */
  function stopEndless() {
    if (!RUN || !RUN.endless) return;
    clearTimeout(runTimer); cancelAnimationFrame(runRaf); runTimer = 0; runRaf = 0;
    if (RUN.aiCtl) { try { RUN.aiCtl.abort(); } catch { /* ignore */ } RUN.aiCtl = null; }
    RUN.promptIds = RUN.promptIds.slice(0, RUN.results.length);
    if (!RUN.results.length) { LS.del("run:" + RUN.key); stopRun(); return go("unlimited"); }
    RUN.round = RUN.results.length - 1;
    RUN.phase = "done";
    persistRun();
    finalize();
  }
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#stop-run, #stop-here")) stopEndless(); });

  function resumePhase() {
    const now = Date.now();
    if (RUN.phase === "preview" || RUN.phase === "answering") {
      if (now >= RUN.answerEndsAt) { RUN.phase = "answering"; return finishRound(null, "", { timeout: true, silent: true }); }
      if (now < RUN.previewEndsAt) RUN.phase = "preview"; else RUN.phase = "answering";
      return renderRound();
    }
    if (RUN.phase === "feedback") return renderFeedback(RUN.results[RUN.results.length - 1], false);
    if (RUN.phase === "done") return finalize();
    // solo runs start straight away (the first question has its own read time); a challenge keeps its
    // intro for the name and the send-now link, and a live match waits for the host
    if (RUN.mode === "vs" || RUN.mode === "vq" || RUN.mode === "live") return renderIntro();
    startRound();
  }

  function renderPlayShell() {
    setMid(RUN.label);
    app.innerHTML = `<section class="screen play${RUN.fmt === "quiz" ? " quiz" : ""}">
      <div class="stage" id="stage">
        <canvas id="descent" aria-hidden="true"></canvas>
        <div class="hud"><span>${RUN.endless ? "Answered" : "Loss"}</span><b id="hud-loss">${RUN.endless ? RUN.results.length : "7.00"}</b></div>
        <div class="hud hud-r"><span>Score</span><b id="hud-score">0</b></div>
        <div class="streak-wrap" aria-live="polite"><div class="streak" id="streak" hidden></div><span class="sk-quick" id="sk-quick" hidden>Quick</span></div>
        <div class="play-head">
          <div class="dots" id="dots" aria-label="progress"></div>
          <div class="play-meta" id="play-meta"></div>
        </div>
      </div>
      <div class="prompt-card" id="card"></div>
    </section>`;
    scene("play");
    V.setRounds(RUN.endless ? 100000 : RUN.promptIds.length); // an endless session's hill never bottoms out
    descent = V.Descent($("#descent"), {
      onFrame: (x) => {
        if (!RUN) return;
        const [lo, hi] = hudRange;
        const pts = Math.min(hi, Math.max(lo, Math.round(x / 10)));
        const l = $("#hud-loss"), sc = $("#hud-score");
        if (l) l.textContent = RUN.endless ? RUN.results.length : ((RUN.promptIds.length * 100 - pts) / 100).toFixed(2);
        if (sc) sc.textContent = pts;
      },
      onFlood: (on) => { const st = $("#stage"); if (st) st.classList.toggle("flood", on); },
      avoid: stageBoxes,
    });
    descent.set(RUN.results);
    updateHead();
    setHud(totalScore(RUN.results));
    showStreak(streakOf(RUN.results), "set");
    if (RUN.mode === "live") { $("#card").insertAdjacentHTML("beforebegin", `<div class="live-strip" id="live-strip" aria-live="polite"></div><div class="live-rivals" id="live-rivals"></div><div class="live-skip" id="live-skip"></div>`); renderStrip(); }
  }
  function updateHead() {
    if (!RUN) return;
    const n = RUN.promptIds.length;
    if (RUN.endless) { // the last few answers, the prompt on screen, and a way out
      const done = RUN.results.slice(-6).map((r) => (r.tier ? `<i class="done t-${r.tier}" title="${esc(T[r.tier].name)}"></i>` : `<i class="miss" title="Miss"></i>`)).join("");
      $("#dots").innerHTML = done + (RUN.phase === "feedback" ? "" : `<i class="cur"></i>`);
      $("#play-meta").innerHTML = `Prompt <b>${RUN.round + 1}</b><button class="btn stop-run" id="stop-run" type="button">Stop</button>`;
      const c = $("#hud-loss"); if (c) c.textContent = RUN.results.length; // a miss doesn't roll the ball, so count here
      return;
    }
    $("#dots").innerHTML = RUN.promptIds.map((_, i) => {
      const r = RUN.results[i];
      if (r && RUN.mode === "live" && RUN.fmt === "quiz" && i > LIVE.revealed) return `<i class="done t-baseline" title="Locked in"></i>`; // the verdict waits for the reveal
      if (r) return r.tier ? `<i class="done t-${r.tier}" title="${esc(T[r.tier].name)}"></i>` : `<i class="miss" title="Miss"></i>`;
      return `<i class="${i === RUN.round && RUN.phase !== "intro" ? "cur" : ""}"></i>`;
    }).join("");
    $("#play-meta").innerHTML = `<b>${Math.min(RUN.round + 1, n)}</b> of ${n}`;
  }
  function setHud(score) {
    hudRange = [score, score];
    const n = RUN.promptIds.length;
    $("#hud-score").textContent = score;
    $("#hud-loss").textContent = RUN.endless ? RUN.results.length : ((n * 100 - score) / 100).toFixed(2);
  }
  /** The boxes drawn over the stage, in canvas coordinates: the camera keeps the path out of them. */
  function stageBoxes() {
    const c = $("#descent");
    if (!c) return [];
    const cr = c.getBoundingClientRect();
    return $$("#stage .hud, #stage .dots, #stage .play-meta, #stage .streak:not([hidden])").map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
    });
  }

  // ---- streaks: answers in a row (accepted in Classic, right in a quiz). The flame over the stage
  // climbs through the colours of fire; a miss puts it out.
  const QUICK_MS = 5000; // an answer inside this gets the Quick flourish
  function streakOf(results) { let n = 0; for (let i = results.length - 1; i >= 0 && results[i].tier; i--) n++; return n; }
  /** mode: "set" (no fuss: resume, a new screen), "up" (one more in a row), "out" (a miss put it out). */
  function showStreak(n, mode) {
    const el = $("#streak");
    if (!el) return;
    const still = !!settings.reducedMotion;
    clearTimeout(el._out);
    el.classList.remove("out");
    if (mode === "out" && !el.hidden && !still) {
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("out");
      el.insertAdjacentHTML("beforeend", `<i class="sk-smoke"></i><i class="sk-smoke"></i><i class="sk-smoke"></i>`);
      el._out = setTimeout(() => { el.hidden = true; el.classList.remove("out"); el.innerHTML = ""; if (descent) descent.layout(); }, 760);
      return;
    }
    if (n < 2) {
      if (!el.hidden) { el.hidden = true; el.innerHTML = ""; if (descent) descent.layout(); }
      return;
    }
    const lv = V.flameLevel(n);
    el.hidden = false;
    el.className = `streak sk-${lv}`;
    el.setAttribute("aria-label", `${n} in a row`);
    el.innerHTML = `${V.flame(n)}<b>${n}</b>${lv >= 7 ? `<span class="sk-name">MLion</span>` : ""}`;
    if (mode === "up" && !still) {
      void el.offsetWidth;
      el.classList.add("pop");
      const cols = V.FLAME[lv];
      const k = Math.min(18, 4 + 2 * lv);
      let sparks = "";
      for (let i = 0; i < k; i++) {
        const a = (-Math.PI / 2) + (i / k - 0.5) * Math.PI * 1.5, d = 26 + 6 * lv + (i % 3) * 8;
        sparks += `<i class="sk-spark" style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--c:${cols[i % 3]};--d:${(i % 4) * 30}ms"></i>`;
      }
      el.insertAdjacentHTML("beforeend", sparks);
    }
    if (descent) descent.layout();
  }
  function flashQuick() {
    const q = $("#sk-quick");
    if (!q) return;
    clearTimeout(q._t);
    q.hidden = false;
    q.classList.remove("on"); void q.offsetWidth; q.classList.add("on");
    q._t = setTimeout(() => { q.hidden = true; q.classList.remove("on"); }, settings.reducedMotion ? 1200 : 1500);
  }
  /** The ball has landed: the streak grows (with its chord and buzz) or goes out, and a fast answer gets its flourish. */
  function celebrate(results, ms) {
    if (!RUN) return;
    const res = results[results.length - 1];
    if (!res) return;
    const n = streakOf(results), before = streakOf(results.slice(0, -1));
    if (res.tier) {
      showStreak(n, "up");
      if (n >= 2) Sound.streak(n);
      if (Number.isFinite(ms) && ms < QUICK_MS) { flashQuick(); Sound.quick(); }
    } else if (before >= 2) {
      showStreak(0, "out");
      Sound.fizzle();
    }
  }

  function renderIntro() {
    const n = RUN.promptIds.length;
    if (RUN.mode === "live") {
      $("#card").innerHTML = `<div class="intro-card"><div><h2>Get ready</h2><p class="sub">${n} questions. Same clock for everyone. Answers are revealed after each one.</p></div></div>`;
      return;
    }
    const quiz = RUN.fmt === "quiz";
    const vsLike = RUN.mode === "vs" || RUN.mode === "vq";
    const title = RUN.mode === "daily" ? `MLion #${RUN.number}` : vsLike && RUN.opp ? `${RUN.opp.name} challenged you` : RUN.label;
    const sub = RUN.mode === "daily" ? prettyDate(RUN.date, { weekday: "long", month: "long", day: "numeric" }) :
      RUN.mode === "archive" ? `${prettyDate(RUN.date)} · no streak` :
      RUN.mode === "practice" ? "Answers shown after" :
      vsLike ? (RUN.opp ? `Score to beat: ${quiz ? quizPts(RUN.quiz, RUN.opp.picks) : tierPoints(RUN.opp.tiers)}. You'll see their ${quiz ? "pick" : "result"} after each answer.` : "Send the link now to play at the same time, or play first and send your score.") :
      RUN.mode === "quiz" ? `Pick the one that fits. ${E.QUIZ_POINTS} a right answer.` :
      RUN.mode === "dquiz" ? `${prettyDate(RUN.date, { weekday: "long", month: "long", day: "numeric" })} · the same questions for everyone` : "";
    $("#card").innerHTML = `<div class="intro-card">
      <div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>
      <ul class="beats">
        <li><b>${n}</b><span>${quiz ? "questions" : n === 1 ? "prompt" : "prompts"}</span></li>
        <li><b>3 s</b><span>to read</span></li>
        <li><b>${baseMs() / 1000} s</b><span>to answer</span></li>
      </ul>
      <p class="rule">${quiz ? "Four answers, one fits. Tap one before the clock runs out. A wrong answer or no answer scores nothing." : "Any valid answer counts. Wrong ones bounce, so keep trying. Rarer answers score more."}${!quiz && !Object.keys(records).length ? ` <button class="linkish" id="how-open" type="button">How scoring works</button>` : ""}</p>
      ${vsLike ? `<label class="vs-field"><span>Your name</span><input class="search" id="vs-name" maxlength="16" autocomplete="nickname" placeholder="So ${RUN.opp ? esc(RUN.opp.name) : "your friend"} knows who played" value="${esc(myName())}"></label>` : ""}
      <div class="btn-row">
        <button class="btn primary big" id="begin">Begin</button>
        ${vsLike && !RUN.opp ? `<button class="btn big" id="vs-send-now">Send link now</button>` : ""}
      </div>
      <p class="hint">${quiz ? `<kbd>1</kbd> to <kbd>4</kbd> pick an answer` : `<kbd>Enter</kbd> submits and continues`}</p>
    </div>`;
    const howOpen = $("#how-open"); // first run only: the tiers, in context, instead of a dialog on arrival
    if (howOpen) howOpen.addEventListener("click", showHowModal);
    const sendNow = $("#vs-send-now");
    if (sendNow) sendNow.addEventListener("click", () => {
      const nm = $("#vs-name");
      if (nm) LS.set("name", nm.value.trim().slice(0, 16));
      const link = quiz ? vqLink(RUN.seed, RUN.n, [], baseMs() / 1000) : challengeLink(RUN.seed, RUN.n, [], baseMs() / 1000);
      shareLink(`Play MLion with me: the same ${RUN.n} ${quiz ? "quiz" : "ML"} questions. Send me your score when you're done:\n${link}`);
    });
    $("#begin").addEventListener("click", async () => {
      const nm = $("#vs-name");
      if (nm) LS.set("name", nm.value.trim().slice(0, 16));
      $("#begin").disabled = true; if (!quiz) await aiConsentUpFront(); startRound();
    });
    $("#begin").focus();
  }

  function startRound() {
    Sound.unlock();
    const now = Date.now();
    RUN.phase = "preview";
    RUN.previewEndsAt = now + E.PREVIEW_MS;
    RUN.answerEndsAt = RUN.previewEndsAt + answerMs();
    RUN.tried = [];
    RUN.misses = 0; RUN.hinted = false; // room rules: wrong answers so far, and whether a hint was used
    persistRun();
    if (window.scrollY) window.scrollTo(0, 0); // Next may have been scrolled up to; the new question starts at the top
    // a new question: fold the chat away so the prompt is in view, unless they're mid-message
    if (RUN.mode === "live" && CHAT.open && !(chatTyping() && $("#chat-input").value)) setChatOpen(false);
    renderRound();
  }

  function currentPrompt() { return PROMPTS.get(RUN.promptIds[RUN.round]); }

  /** A quiz question: the prompt, then four options to tap (or press 1 to 4). */
  function renderQuizRound() {
    const p = currentPrompt(), q = RUN.quiz[RUN.round];
    updateHead();
    if (descent) descent.calm();
    $("#card").innerHTML = `<div class="round quiz">
      <div class="ask">
        ${finalBanner()}
        ${p.reasoning ? `<p class="rq-eyebrow">${esc(p.cat)}${p.lvl ? ` · ${esc(p.lvl)}` : ""}</p>` : ""}
        <p class="prompt-text${p.reasoning ? " rq-text" : ""}" id="prompt-text">${esc(p.text)}</p>
        <p class="prompt-note">${p.reasoning ? "Pick the best answer." : `${p.scope ? `${esc(p.scope)}. ` : ""}Which one fits?`}</p>
      </div>
      <div class="act">
        <div class="timer" id="timer">
          <div class="timer-row"><span id="timer-label">Starts in</span><b id="timer-num">${(answerMs() / 1000).toFixed(1)}</b></div>
          <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>
        </div>
        <div class="mcq-zone">
          <div class="mcq locked" id="mcq" role="group" aria-label="Choose one answer">
            ${q.options.map((o, i) => `<button type="button" class="mcq-opt" data-i="${i}" disabled aria-keyshortcuts="${i + 1}"><span class="mcq-k">${i + 1}</span><span class="mcq-t">${esc(o)}</span></button>`).join("")}
          </div>
          <div class="preview-veil" id="veil"><span>Read the question</span><b id="veil-n">3</b></div>
        </div>
        ${hintRow(true)}
      </div>
    </div>`;
    $$(".mcq-opt").forEach((b) => b.addEventListener("click", () => pickQuiz(+b.dataset.i)));
    wireHint(true);
    lastTick = -1;
    tickLoop();
  }
  /** Lock in an option (index 0 to 3) while the clock is running. */
  function pickQuiz(i) {
    if (!RUN || RUN.fmt !== "quiz" || RUN.phase !== "answering" || !(i >= 0 && i < E.QUIZ_OPTIONS)) return;
    if ($(`.mcq-opt.cut[data-i="${i}"]`)) return; // removed by the 50:50
    finishQuiz(i, {});
  }

  function renderRound() {
    if (RUN.fmt === "quiz") return renderQuizRound();
    const p = currentPrompt();
    updateHead();
    if (descent) descent.calm();
    $("#card").innerHTML = `<div class="round">
      <div class="ask">
        ${finalBanner()}
        <p class="prompt-text" id="prompt-text">${esc(p.text)}${p.example ? ` <span class="eg">(e.g. ${esc(p.example)})</span>` : ""}</p>
        ${p.scope ? `<p class="prompt-note">${esc(p.scope)}</p>` : ""}
      </div>
      <div class="act">
        <div class="timer" id="timer">
          <div class="timer-row"><span id="timer-label">Starts in</span><b id="timer-num">${(answerMs() / 1000).toFixed(1)}</b></div>
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
        ${hintRow(false)}
      </div>
    </div>`;
    const input = $("#answer");
    if (RUN.draft) input.value = RUN.draft;
    input.addEventListener("input", () => {
      RUN.draft = input.value;
      syncStep();
      liveTyping();
      input.classList.remove("corrected");
      RUN.pendingCorrection = null;
      if (RUN.aiCtl) { RUN.aiCtl.abort(); RUN.aiCtl = null; }
      showChips([]);
      clearTimeout(input._p); input._p = setTimeout(persistRun, 300);
    });
    $("#answer-form").addEventListener("submit", (e) => { e.preventDefault(); submit(false); });
    syncStep();
    renderTried();
    wireHint(false);
    lastTick = -1;
    tickLoop();
  }
  // ---- room rules in a round (live only)
  const ruled = () => RUN && RUN.mode === "live" && RUN.rules;
  const finalBanner = () => (ruled() && RUN.rules.final && RUN.round === RUN.promptIds.length - 1 ? `<p class="final-x2">Final question · double points</p>` : "");
  /** The timer label while answering, with the speed multiplier when that rule is on. */
  const timeLeftLabel = (left) => (ruled() && RUN.rules.speed !== "off" ? `Time left · ×${E.speedMult(RUN.rules, answerMs() - left, answerMs()).toFixed(1)}` : "Time left");
  function hintRow(quiz) {
    if (!ruled() || RUN.rules.hints === "off") return "";
    return `<div class="hint-row" id="hint-row">${RUN.hinted ? hintShown(quiz) : `<button type="button" class="btn sm hint-btn" id="hint-btn">${quiz ? "50:50" : "Hint"}${RUN.rules.hints === "half" ? " · half points" : ""}</button>`}</div>`;
  }
  /** A Classic hint: the first letter and shape of a rarer answer, with its explanation as a clue (its name masked). The same for everyone in the room. */
  function liveHint(p, seed, i) {
    const rare = p.answers.filter((a) => a.t === "indist" || a.t === "outlier" || a.t === "longtail");
    const clued = rare.filter((a) => explainOf(p.id, a.a));
    const pool = clued.length ? clued : rare.length ? rare : p.answers;
    const a = pool[Math.floor(E.mulberry32(E.hashString(`hint:${seed}:${i}:${p.id}`))() * pool.length)];
    const mask = (text, name) => {
      if (!name || name.length < 2) return text;
      const low = text.toLowerCase(), n = name.toLowerCase();
      let out = "", k = 0, j;
      while ((j = low.indexOf(n, k)) >= 0) { out += text.slice(k, j) + "…"; k = j + n.length; }
      return out + text.slice(k);
    };
    const clue = [a.a].concat(a.aka || []).sort((x, y) => y.length - x.length).reduce(mask, explainOf(p.id, a.a) || "");
    let seen = false;
    const shape = [...a.a].map((c) => (/[\p{L}\p{N}]/u.test(c) ? (seen ? "_" : ((seen = true), c.toUpperCase())) : c === " " ? " " : c)).join("");
    return { shape, len: [...a.a].filter((c) => /[\p{L}\p{N}]/u.test(c)).length, digits: /\p{N}/u.test(a.a), clue };
  }
  function hintShown(quiz) {
    if (quiz) return `<p class="hint">Two wrong answers removed.</p>`;
    const h = liveHint(currentPrompt(), RUN.seed, RUN.round);
    return `<p class="hint"><span class="hint-shape">${esc(h.shape)}</span><span class="hint-len">${h.len} ${h.digits ? "characters" : "letters"}</span>${h.clue ? `<span class="hint-clue">${esc(h.clue)}</span>` : ""}</p>`;
  }
  /** The 50:50: the same two wrong options go for everyone. */
  function cutTwo() {
    const q = RUN.quiz[RUN.round];
    const wrong = [...Array(E.QUIZ_OPTIONS).keys()].filter((k) => k !== q.correct);
    for (const k of E.shuffled(wrong, E.mulberry32(E.hashString(`cut:${RUN.seed}:${RUN.round}`))).slice(0, 2)) {
      const b = $(`.mcq-opt[data-i="${k}"]`);
      if (b) { b.classList.add("cut"); b.disabled = true; }
    }
  }
  function wireHint(quiz) {
    if (quiz && ruled() && RUN.hinted) cutTwo();
    const b = $("#hint-btn");
    if (!b) return;
    b.addEventListener("click", () => {
      if (!ruled() || RUN.hinted || (RUN.phase !== "answering" && RUN.phase !== "preview")) return;
      RUN.hinted = true;
      persistRun();
      $("#hint-row").innerHTML = hintShown(quiz);
      if (quiz) cutTwo();
      else if (!chatTyping() && $("#answer") && !$("#answer").disabled) $("#answer").focus({ preventScroll: true });
    });
  }
  /** Under a live answer: how the room's rules turned the tier's points into this round's. */
  function ruleNote(res) {
    if (!ruled() || !res.tier) return "";
    const r = RUN.rules, i = RUN.results.indexOf(res), parts = [];
    if (r.speed !== "off") parts.push(`×${E.speedMult(r, res.ms, answerMs(i)).toFixed(1)} for speed`);
    if (res.hinted && r.hints === "half") parts.push("half for the hint");
    if (r.final && i === RUN.promptIds.length - 1) parts.push("×2 on the final question");
    if ((r.miss === "5" || r.miss === "10") && res.misses) parts.push(`−${+r.miss * res.misses} for ${res.misses === 1 ? "a wrong answer" : `${res.misses} wrong answers`}`);
    return parts.length ? `<p class="fb-note rule-note">${RUN.fmt === "quiz" ? E.QUIZ_POINTS : T[res.tier].score} points, ${parts.join(", ")}</p>` : "";
  }
  /** Solo: an empty box offers Skip (a quiet button); typing turns it back into the gold Step. */
  function syncStep() {
    const b = $("#step"), input = $("#answer");
    if (!b || !input || !RUN) return;
    const skip = RUN.mode !== "live" && !input.value.trim();
    b.textContent = skip ? "Skip" : "Step";
    b.classList.toggle("primary", !skip);
  }
  function renderTried() {
    const el = $("#tried");
    if (el) el.innerHTML = (RUN.tried || []).slice(-8).map((t) => `<span>${esc(t)}</span>`).join("");
  }

  function tickLoop() {
    cancelAnimationFrame(runRaf);
    const loop = () => {
      if (!RUN || (RUN.phase !== "preview" && RUN.phase !== "answering")) return;
      if (RUN.fmt === "quiz") return quizTick();
      const now = Date.now();
      const input = $("#answer"), veil = $("#veil");
      if (!input) return;
      if (now < RUN.previewEndsAt) {
        RUN.phase = "preview";
        input.disabled = true; $("#step").disabled = true;
        veil.classList.remove("hidden");
        $("#veil-n").textContent = Math.ceil((RUN.previewEndsAt - now) / 1000);
        $("#timer-label").textContent = "Starts in";
        $("#timer-num").textContent = (answerMs() / 1000).toFixed(1);
        $("#timer-fill").style.transform = "scaleX(1)";
      } else {
        if (RUN.phase === "preview" || input.disabled) {
          RUN.phase = "answering"; persistRun();
          input.disabled = false; $("#step").disabled = false;
          veil.classList.add("hidden");
          if (!chatTyping()) input.focus({ preventScroll: true }); // never yank someone out of a chat message
          $("#timer-label").textContent = "Time left";
        }
        const left = Math.max(0, RUN.answerEndsAt - now);
        if (ruled()) $("#timer-label").textContent = timeLeftLabel(left);
        $("#timer-num").textContent = (left / 1000).toFixed(1);
        $("#timer-fill").style.transform = `scaleX(${left / answerMs()})`;
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

  /** The quiz clock: options are covered and locked through the preview, then free until time runs out. */
  function quizTick() {
    if (!RUN || (RUN.phase !== "preview" && RUN.phase !== "answering")) return;
    const now = Date.now();
    const mcq = $("#mcq"), veil = $("#veil");
    if (!mcq) return;
    if (now < RUN.previewEndsAt) {
      RUN.phase = "preview";
      veil.classList.remove("hidden");
      $("#veil-n").textContent = Math.ceil((RUN.previewEndsAt - now) / 1000);
      $("#timer-label").textContent = "Starts in";
      $("#timer-num").textContent = (answerMs() / 1000).toFixed(1);
      $("#timer-fill").style.transform = "scaleX(1)";
    } else {
      if (RUN.phase === "preview" || mcq.classList.contains("locked")) {
        RUN.phase = "answering"; persistRun();
        mcq.classList.remove("locked");
        $$(".mcq-opt:not(.cut)", mcq).forEach((b) => { b.disabled = false; });
        veil.classList.add("hidden");
        $("#timer-label").textContent = "Time left";
      }
      const left = Math.max(0, RUN.answerEndsAt - now);
      if (ruled()) $("#timer-label").textContent = timeLeftLabel(left);
      $("#timer-num").textContent = (left / 1000).toFixed(1);
      $("#timer-fill").style.transform = `scaleX(${left / answerMs()})`;
      const low = left <= 5000;
      $("#timer").classList.toggle("low", low);
      const sec = Math.ceil(left / 1000);
      if (low && sec !== lastTick && sec > 0) { lastTick = sec; Sound.tick(); }
      if (left <= 0) { submit(true); return; }
    }
    runRaf = requestAnimationFrame(quizTick);
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

  /** "ReLU" typed under "Name an optimizer": the prompt it does answer, so a miss still teaches. */
  function otherHome(raw, pid) {
    const ids = E.whereElse(raw, pid).filter((id) => PROMPTS.has(id));
    const core = ids.find((id) => !PROMPTS.get(id).extra) || ids[0];
    return core ? PROMPTS.get(core) : null;
  }
  function reject(raw, input) {
    RUN.tried = (RUN.tried || []).concat(raw);
    if (RUN.mode === "live") {
      RUN.misses = (RUN.misses || 0) + 1;
      if (RUN.rules && RUN.rules.miss === "strike") { liveTyping(); Sound.reject(); return finishRound(null, raw, { struck: true }); }
    }
    liveTyping();
    Sound.reject();
    const other = otherHome(raw, currentPrompt().id);
    setStatus(other ? `“${raw}” answers “${other.text}”, not this one. Try again.` : `“${raw}” isn't in the key: no gradient. Try again.`, "bad");
    input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
    if (settings.clearRejected) { input.value = ""; RUN.draft = ""; syncStep(); }
    else input.select();
    renderTried();
    persistRun();
  }

  function submit(force) {
    if (!RUN || RUN.phase !== "answering") return;
    if (RUN.fmt === "quiz") { if (force) finishQuiz(-1, { timeout: true }); return; } // a quiz answer is a tap, not a submission
    const input = $("#answer");
    const raw = (input ? input.value : RUN.draft || "").trim();
    const p = currentPrompt();
    if (!raw) {
      if (force) finishRound(null, "", { timeout: true });
      else if (RUN.mode !== "live") finishRound(null, "", { skipped: true });
      return;
    }
    let m = E.matchAnswer(p, raw);
    // Live matches: the host decides how much autocorrect may help.
    const assist = RUN.mode === "live" ? RUN.assist || "typos" : "full";
    if (assist === "off" && m.kind !== "exact") m = { kind: "none" };
    if (assist === "typos" && (m.kind === "suggest" || (m.kind === "correction" && m.confidence !== undefined && m.confidence < 0.88))) m = { kind: "none" };
    showChips([]);
    if (m.kind === "exact") return finishRound(m.answer, raw, {});
    // Generous (a live room setting): a close guess counts at once, no "did you mean"
    if (assist === "generous" && (m.kind === "correction" || (m.kind === "suggest" && m.suggestions.length && !(m.confidence < 0.6)))) return finishRound(m.kind === "correction" ? m.answer : m.suggestions[0], raw, { corrected: true });
    if (force) {
      // Time's up: take a confident near miss, otherwise it's a miss.
      if (m.kind === "correction") return finishRound(m.answer, raw, { corrected: true });
      if (m.kind === "suggest" && m.confidence >= 0.75 && m.suggestions.length === 1) return finishRound(m.suggestions[0], raw, { corrected: true });
      if (assist === "generous" && m.kind === "suggest" && m.suggestions.length && m.confidence >= 0.5) return finishRound(m.suggestions[0], raw, { corrected: true });
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
    if (settings.aiCheck && aiUsable() && RUN.mode !== "live") return askClaude(p, raw, input);
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

  /** A quiz answer is final: score it, keep it, show the verdict (a live match holds the verdict for the reveal). */
  function finishQuiz(pick, { timeout = false, silent = false } = {}) {
    cancelAnimationFrame(runRaf);
    const p = currentPrompt(), q = RUN.quiz[RUN.round];
    const ok = pick >= 0 && pick === q.correct;
    const ms = pick < 0 ? answerMs() : Math.max(0, Math.min(answerMs(), Date.now() - RUN.previewEndsAt));
    const res = {
      promptId: p.id, promptText: p.text, raw: pick >= 0 ? q.options[pick] : null,
      answer: ok ? q.options[q.correct] : null, tier: ok ? QUIZ_TIER : null, score: ok ? E.QUIZ_POINTS : 0, quip: null,
      corrected: false, timeout: pick < 0 && !!timeout, skipped: false,
      picked: pick, correct: q.correct, ms: Math.round(ms),
    };
    if (RUN.mode === "dquiz" && ok) res.score = E.quizPoints(Math.round(ms / 100)); // faster, more: 100 within 3 s, 50 at the 35 s buzzer
    if (ruled()) {
      res.hinted = !!RUN.hinted;
      res.score = E.liveScore(RUN.rules, { base: res.score, ms: res.ms, total: answerMs(), hinted: res.hinted, last: RUN.round === RUN.promptIds.length - 1 });
    }
    RUN.results.push(res);
    RUN.phase = "feedback";
    markSeen(p.id);
    persistRun();
    if (!silent) Sound.submit();
    renderFeedback(res, !silent);
  }

  function finishRound(answer, raw, { corrected = false, timeout = false, skipped = false, silent = false, struck = false } = {}) {
    if (RUN.fmt === "quiz") return finishQuiz(-1, { timeout: true, silent });
    cancelAnimationFrame(runRaf);
    if (RUN.aiCtl) { RUN.aiCtl.abort(); RUN.aiCtl = null; }
    const p = currentPrompt();
    const res = {
      promptId: p.id, promptText: p.text, raw: raw || null,
      answer: answer ? answer.a : null, tier: answer ? answer.t : null,
      score: answer ? T[answer.t].score : 0, quip: answer && answer.q ? answer.q : null,
      corrected: !!corrected, timeout: !answer && timeout, skipped: !answer && skipped,
    };
    if (RUN.mode === "live") { // the facts the room scores by (E.liveScore), sent with the answer
      res.ms = answer ? Math.round(Math.max(0, Math.min(answerMs(), Date.now() - RUN.previewEndsAt))) : answerMs();
      res.misses = RUN.misses || 0; res.hinted = !!RUN.hinted; res.struck = !!struck;
      if (answer && RUN.rules) res.score = E.liveScore(RUN.rules, { base: T[answer.t].score, ms: res.ms, total: answerMs(), misses: res.misses, hinted: res.hinted, last: RUN.round === RUN.promptIds.length - 1 });
    }
    RUN.results.push(res);
    RUN.phase = "feedback";
    RUN.draft = ""; RUN.pendingCorrection = null;
    markSeen(p.id);
    persistRun();
    if (!silent) Sound.submit();
    renderFeedback(res, !silent);
  }

  /** After a quiz answer. Solo: right or wrong, the right option lit, each wrong one labelled with where it belongs.
   *  Live: just "Locked in"; the verdict arrives with the room's reveal. */
  function renderQuizFeedback(res, animate) {
    updateHead();
    const n = RUN.results.length;
    const isLast = n >= RUN.promptIds.length;
    const q = RUN.quiz[n - 1], p = PROMPTS.get(res.promptId);
    const card = $("#card");
    if (RUN.mode === "live") {
      card.innerHTML = `<div class="feedback t-baseline landed" id="fb" aria-live="polite">
        <p class="fb-q">${esc(p.text)}</p>
        <div class="fb-answer">${res.picked >= 0 ? `<span class="mcq-n">${res.picked + 1}</span> ${esc(q.options[res.picked])}` : `<span class="muted">No answer</span>`}</div>
        <div class="fb-tier t-baseline"><span class="fb-name">Locked in</span></div>
        <p class="lv-note" id="live-wait" aria-live="polite"></p>
      </div>`;
      liveLocalAnswer(res);
      renderLiveWait();
      renderStrip();
      return;
    }
    const ok = res.score > 0;
    const row = (o, k) => {
      const right = k === q.correct, mine = k === res.picked;
      const x = right ? explainOf(res.promptId, o) : null;
      return `<li class="${right ? "right" : ""}${mine ? " mine" : ""}"><span class="mcq-k">${right ? qmark(true) : mine ? qmark(false) : k + 1}</span>
        <span class="mcq-t"><b>${esc(o)}</b>${right ? (x ? `<span class="mcq-x">${esc(x)}</span>` : "") : fromLabel(q, k)}</span>${mine ? `<span class="mcq-you">You</span>` : ""}</li>`;
    };
    card.innerHTML = `
      <div class="feedback ${ok ? QUIZ_TIER : "miss"} t-${ok ? QUIZ_TIER : "miss"}${animate ? "" : " landed"}" id="fb" aria-live="polite">
        <p class="fb-q">${esc(p.text)}</p>
        <div class="fb-tier">${qmark(ok)}<span class="fb-name">${quizVerdict(res)}</span><span class="fb-points">+${res.score}</span></div>
        <ul class="mcq-key">${q.options.map(row).join("")}</ul>
        ${RUN.mode === "vq" && RUN.opp ? quizOppLine(RUN.opp, n - 1) : ""}
        <button class="btn primary big" id="next" ${animate ? "disabled" : ""}>${isLast ? "See results" : "Next"}</button>
      </div>`;
    const next = $("#next"), fb = $("#fb");
    next.addEventListener("click", advance);
    const done = () => {
      if (fb.isConnected) fb.classList.add("landed");
      if (next.isConnected) { next.disabled = false; next.focus({ preventScroll: true }); revealNext(next); }
    };
    const total = totalScore(RUN.results);
    if (animate && descent) {
      hudRange = [total - res.score, total];
      if (res.tier) Sound.tier(res.tier); else Sound.miss();
      const upTo = RUN.results.slice();
      descent.roll(res.tier, res.score, () => { const el = $("#hud-score"); if (el) { el.classList.remove("crank"); void el.offsetWidth; el.classList.add("crank"); } celebrate(upTo, res.ms); done(); });
      setTimeout(done, 1500); // never hold the player behind the animation
    } else { setHud(total); showStreak(streakOf(RUN.results), "set"); done(); }
  }
  /** vq: what the challenger picked on this question, and who leads. */
  function quizOppLine(opp, i) {
    const q = RUN.quiz[i], pick = opp.picks[i] - 1, ok = pick === q.correct;
    const mine = totalScore(RUN.results), theirs = quizPts(RUN.quiz.slice(0, i + 1), opp.picks.slice(0, i + 1));
    const lead = mine === theirs ? "Level" : mine > theirs ? `You lead by ${mine - theirs}` : `${esc(opp.name)} leads by ${theirs - mine}`;
    return `<p class="fb-opp t-${ok ? QUIZ_TIER : "miss"}">${qmark(ok)}<span><b>${esc(opp.name)}</b> ${pick >= 0 ? `picked ${esc(q.options[pick])}` : "didn't answer"}${ok ? ` +${E.QUIZ_POINTS}` : ""}</span><span class="lead">${lead}</span></p>`;
  }

  function renderFeedback(res, animate) {
    if (RUN.fmt === "quiz") return renderQuizFeedback(res, animate);
    updateHead();
    const isLast = !RUN.endless && RUN.results.length >= RUN.promptIds.length;
    const p = PROMPTS.get(res.promptId);
    const t = res.tier ? T[res.tier] : null;
    const card = $("#card");
    card.innerHTML = `
      <div class="feedback ${res.tier || "miss"} t-${tierOf(res.tier)}${animate ? "" : " landed"}" id="fb" aria-live="polite">
        <p class="fb-q">${esc(p.text)}</p>
        <div class="fb-answer">${res.answer ? esc(res.answer) : res.raw ? `“${esc(res.raw)}” <span class="muted">isn't in the key</span>` : `<span class="muted">No answer</span>`}</div>
        <div class="fb-tier">${G(res.tier)}<span class="fb-name">${t ? esc(t.name) : "Miss"}</span><span class="fb-points">+${res.score}</span></div>
        ${ruleNote(res)}
        ${res.quip ? `<p class="fb-quip">${esc(res.quip)}</p>` : !t ? `<p class="fb-quip">${res.struck ? "One strike: a wrong answer ends your round." : res.timeout ? "Out of time." : res.skipped ? "Skipped." : "No gradient, no descent."}</p>` : ""}
        ${res.corrected && res.raw ? `<p class="fb-note">Autocorrected from “${esc(res.raw)}”</p>`
          : res.answer && res.raw && E.fullKey(res.raw) !== E.fullKey(res.answer) ? `<p class="fb-note">“${esc(res.raw)}” counts as ${esc(res.answer)}</p>` : ""}
        ${RUN.mode === "vs" && RUN.opp ? oppLine(RUN.opp, RUN.results.length - 1) : ""}
        ${RUN.endless ? `<div class="fb-acts"><button class="btn primary big" id="next" ${animate ? "disabled" : ""}>Next</button><button class="btn big" id="stop-here" type="button">Stop</button></div>`
          : `<button class="btn primary big" id="next" ${animate ? "disabled" : ""}>${isLast ? "See results" : "Next"}</button>`}
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
      if (next.isConnected) { next.disabled = false; next.focus({ preventScroll: true }); revealNext(next); }
    };
    const total = totalScore(RUN.results);
    if (animate && descent) {
      hudRange = [total - res.score, total];
      if (res.tier) Sound.tier(res.tier); else Sound.miss();
      const upTo = RUN.results.slice(), ms = Number.isFinite(res.ms) ? res.ms : Date.now() - RUN.previewEndsAt;
      descent.roll(res.tier, res.score, () => { const el = $("#hud-score"); if (el) { el.classList.remove("crank"); void el.offsetWidth; el.classList.add("crank"); } celebrate(upTo, ms); done(); });
      // never hold the player behind the animation
      setTimeout(done, 1500);
    } else { setHud(total); showStreak(streakOf(RUN.results), "set"); done(); }
  }

  /** Once the ball has landed, bring Next up if the feedback pushed it below the fold (short laptops, long explanations). */
  function revealNext(el) {
    if (!el.isConnected || !RUN || RUN.phase !== "feedback") return;
    const over = el.getBoundingClientRect().bottom + 16 - innerHeight;
    if (over > 0) window.scrollBy({ top: over, behavior: settings.reducedMotion ? "auto" : "smooth" });
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
    if (RUN.endless) { RUN.promptIds.push(unlDeal(RUN.pool)); RUN.round = RUN.results.length; return startRound(); }
    if (RUN.results.length >= RUN.promptIds.length) { RUN.phase = "done"; persistRun(); return finalize(); }
    RUN.round = RUN.results.length;
    startRound();
  }

  function finalize() {
    const score = totalScore(RUN.results);
    const rec = {
      key: RUN.key, mode: RUN.mode, number: RUN.number, date: RUN.date || null, pack: RUN.pack || null,
      label: RUN.label, promptIds: RUN.promptIds, results: RUN.results, score,
      tiers: RUN.results.map((r) => r.tier || "miss"), completedAt: Date.now(), secs: baseMs() / 1000,
    };
    if (RUN.mode === "vs") Object.assign(rec, { seed: RUN.seed, n: RUN.n, opp: RUN.opp || null, name: myName() || "You" });
    if (isQuizMode(RUN.mode)) { // keep the questions with the record, so old runs still read right if the generator changes
      Object.assign(rec, { fmt: "quiz", quiz: RUN.quiz, picks: RUN.results.map((r) => r.picked + 1), tenths: Math.min(99999, Math.round(RUN.results.reduce((s, r) => s + (r.ms || 0), 0) / 100)) });
      if (RUN.mode === "vq") Object.assign(rec, { seed: RUN.seed, n: RUN.n, opp: RUN.opp || null, name: myName() || "You" });
    }
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
    if (e.target && e.target.id === "chat-input") { if (e.key === "Escape") setChatOpen(false); return; } // chat keys stay in chat
    if (e.key === "Enter" && RUN && RUN.phase === "feedback") {
      const n = $("#next");
      if (n && !n.disabled && document.activeElement !== n) { e.preventDefault(); advance(); }
    }
    if (RUN && RUN.fmt === "quiz" && RUN.phase === "answering" && /^[1-4]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey
      && !(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) && !$("#modal").firstElementChild) { e.preventDefault(); pickQuiz(+e.key - 1); } // keys 1 to 4 pick an option
    if (e.key === "Escape") { closeDrawer(true); closeModal(); if (CHAT.open) setChatOpen(false); }
  });

  // ========================================================= leaderboard
  // Daily leaderboard on Supabase. Opt-in: only players who log in (Google or Discord)
  // appear, under a name they choose. The database recomputes the score from the tier
  // digits and only takes today's daily (supabase/schema.sql), so nobody can post a
  // typed-in number. Answers still ship in js/data.js, so it can't stop a determined
  // cheater who reads them; that needs answer checking on a server.
  // Fill these two in from Supabase → Project Settings → API. The anon key is public.
  const BOARD_CONFIG = { url: "https://ozqnznvxxxnefeetidwq.supabase.co", key: "sb_publishable_xztj1Nx4sRbgltpd0u3XWg_2cASIAG5" };
  const BOARD_CFG = window.MLION_BOARD || BOARD_CONFIG; // tests inject a fake project
  const BOARD_ON = !!(BOARD_CFG.url && BOARD_CFG.key) && /^https?:$/.test(location.protocol) && window.top === window;
  const SB_SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js";
  const SB_STORE = "mlion:sb";
  const PROVIDERS = [["google", "Google"], ["discord", "Discord"]];
  // anon: a publish-only account made by "Publish my score" (Supabase anonymous sign-in), no login
  const AUTH = { uid: null, user: null, profile: null, admin: false, anon: false, loading: null, ready: !BOARD_ON };
  const boardPosted = LS.get("boardPosted", {}) || {};
  let sbClient = null, sbLoading = null;

  function loadSupabase() {
    if (sbClient) return Promise.resolve(sbClient);
    if (!sbLoading) sbLoading = new Promise((res, rej) => {
      const make = () => {
        if (!window.supabase || !window.supabase.createClient) { sbLoading = null; return rej(new Error("no supabase")); }
        sbClient = window.supabase.createClient(BOARD_CFG.url, BOARD_CFG.key, {
          auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: SB_STORE },
        });
        res(sbClient);
      };
      if (window.supabase) return make();
      const el = document.createElement("script");
      el.src = SB_SRC; el.async = true;
      el.onload = make;
      el.onerror = () => { sbLoading = null; rej(new Error("load failed")); };
      document.head.appendChild(el);
    });
    return sbLoading;
  }

  // Load the client only for people who have logged in (or are coming back from login),
  // so everyone else downloads nothing extra.
  async function boardBoot() {
    if (!BOARD_ON) return;
    const q = new URLSearchParams(location.search);
    const returning = q.has("code") || q.has("error");
    let stored = false;
    try { stored = Object.keys(localStorage).some((k) => k.startsWith(SB_STORE)); } catch { /* storage blocked */ }
    if (!returning && !stored) { AUTH.ready = true; drawAccount(); return; }
    try {
      const sb = await loadSupabase();
      watchAuth(sb);
      const { data } = await sb.auth.getSession(); // also swaps ?code= for a session
      if (returning) {
        if (q.has("error")) toast(`Login didn't work: ${q.get("error_description") || q.get("error")}`);
        let back = "";
        try { back = sessionStorage.getItem("mlion:back") || ""; sessionStorage.removeItem("mlion:back"); } catch { /* ignore */ }
        history.replaceState(null, "", location.pathname + (back || location.hash || "#board"));
        route();
      }
      await onSession(data && data.session);
    } catch { if (returning) toast("Couldn't reach the leaderboard. Try again later."); }
    AUTH.ready = true;
    boardRedraw();
  }

  let authWatched = false;
  function watchAuth(sb) {
    if (authWatched) return;
    authWatched = true;
    sb.auth.onAuthStateChange((ev, session) => { setTimeout(() => onSession(session), 0); }); // no awaits inside the callback
  }
  /** A new session (or none): load its profile once; a second call for the same account waits for the first. */
  function onSession(session) {
    const user = (session && session.user) || null;
    const uid = user ? user.id : null;
    if (uid === AUTH.uid) return AUTH.loading || Promise.resolve();
    AUTH.uid = uid; AUTH.user = user; AUTH.profile = null; AUTH.admin = false; AUTH.anon = !!(user && user.is_anonymous);
    AUTH.loading = (async () => {
      if (user) {
        try {
          AUTH.profile = await loadProfile(user);
          if (AUTH.uid !== uid) return;
          if (!AUTH.profile && await accountGone()) return;
          AUTH.admin = AUTH.anon ? false : await checkAdmin();
          if (AUTH.uid !== uid) return;
          if (AUTH.profile && !myName()) LS.set("name", AUTH.profile.name); // rooms and challenges use it
          if (!AUTH.anon) await postDaily(records[`daily:${today()}`]); // a login posts by itself; a publish-only account waits for the button
        } catch { /* offline: the board page retries */ }
      }
      boardRedraw();
    })();
    return AUTH.loading;
  }

  function defaultBoardName(user) {
    const own = cleanName(myName());
    if (own && E.nameOk(own)) return own;
    const m = (user && user.user_metadata) || {};
    const raw = (m.custom_claims && m.custom_claims.global_name) || m.full_name || m.name || m.user_name || "";
    const first = cleanName(String(raw).split(/\s+/)[0]); // first name only: the board is public
    return first && E.nameOk(first) ? first : "Player";
  }
  async function loadProfile(user) {
    const got = await sbClient.from("profiles").select("id,name").eq("id", user.id).maybeSingle();
    if (got.data) return got.data;
    const ins = await sbClient.from("profiles").insert({ id: user.id, name: defaultBoardName(user) }).select("id,name").maybeSingle();
    if (ins.data) return ins.data;
    const again = await sbClient.from("profiles").select("id,name").eq("id", user.id).maybeSingle(); // another tab won the race
    return again.data || null;
  }

  // Post today's daily once per account. 23505 means it's already there (the first post counts).
  const BOARDS = { daily: { table: "daily_scores", mode: "daily" }, quiz: { table: "daily_quiz_scores", mode: "dquiz" } };
  const missingTable = (error) => !!error && (error.code === "PGRST205" || error.code === "42P01" || /schema cache|does not exist/i.test(error.message || ""));
  const postMark = (rec) => (rec.mode === "dquiz" ? `q:${rec.date}` : rec.date);
  const isPosted = (rec) => !!(rec && AUTH.user && boardPosted[postMark(rec)] === AUTH.user.id);
  async function postDaily(rec) {
    if (!sbClient || !AUTH.user || !AUTH.profile || !rec || rec.date !== today() || rec.tiers.length !== E.ROUNDS) return false;
    if (rec.mode !== "daily" && rec.mode !== "dquiz") return false;
    const quiz = rec.mode === "dquiz", mark = postMark(rec);
    if (boardPosted[mark] === AUTH.user.id) return true;
    const quizRow = quiz && { user_id: AUTH.user.id, day: rec.date, marks: rec.results.map((r) => (r.score > 0 ? "1" : "0")).join(""), tenths: Math.max(0, Math.min(99999, rec.tenths || 0)),
      times: rec.results.map((r) => Math.max(0, Math.min(350, Math.round((r.ms || 0) / 100)))).join(",") };
    let { error } = quiz
      ? await sbClient.from("daily_quiz_scores").insert(quizRow)
      : await sbClient.from("daily_scores").insert({ user_id: AUTH.user.id, day: rec.date, tiers: encTiers(rec.tiers) });
    if (quiz && error && (error.code === "PGRST204" || /times/.test(error.message || ""))) { // the speed column isn't there yet
      const { times, ...plain } = quizRow; // eslint-disable-line no-unused-vars
      ({ error } = await sbClient.from("daily_quiz_scores").insert(plain));
    }
    if (error && error.code !== "23505") return false;
    boardPosted[mark] = AUTH.user.id;
    LS.set("boardPosted", boardPosted);
    return true;
  }

  async function boardLogin(provider) {
    try { sessionStorage.setItem("mlion:back", location.hash); } catch { /* ignore */ }
    try {
      const sb = await loadSupabase();
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
      if (error) toast(`Login didn't work: ${error.message}`);
    } catch { toast("Couldn't reach the leaderboard. Try again later."); }
  }
  async function boardLogout() {
    try { if (sbClient) await sbClient.auth.signOut(); } catch { /* ignore */ }
    AUTH.uid = null; AUTH.user = null; AUTH.profile = null; AUTH.admin = false; AUTH.anon = false; AUTH.loading = null;
    boardRedraw();
  }
  // An account deleted on the server (by an admin reset, or in the dashboard) still has a working-looking
  // login in this browser until its token runs out. Ask the server; if the account is gone, log out here.
  const GONE = "That login was for an account that no longer exists. Log in again.";
  async function accountGone() {
    if (!sbClient || !AUTH.user) return false;
    let res;
    try { res = await sbClient.auth.getUser(); } catch { return false; } // offline: can't tell
    const err = res && res.error;
    if (!err && res.data && res.data.user) return false;
    if (err && !(err.status === 401 || err.status === 403 || err.status === 404 || /not.?found|jwt|session/i.test(`${err.code || ""} ${err.message || ""}`))) return false;
    try { await sbClient.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
    AUTH.uid = null; AUTH.user = null; AUTH.profile = null; AUTH.admin = false; AUTH.anon = false; AUTH.loading = null;
    toast(GONE);
    boardRedraw();
    return true;
  }
  const NAME_BAD = "That name isn't allowed. Pick another.";
  /** Save a new public name; returns an error to show, or "". */
  async function saveBoardName(name) {
    if (!name) return "Pick a name with letters or digits.";
    if (!E.nameOk(name)) return NAME_BAD;
    if (AUTH.profile && AUTH.profile.name === name) return "";
    const { data, error } = await sbClient.from("profiles").update({ name }).eq("id", AUTH.user.id).select("id,name").maybeSingle();
    if (error && error.code === "23514") return NAME_BAD; // the database's own check (supabase/names.sql)
    if (!error && !data) { // no profile row to rename: the account was deleted, or only its profile was
      if (await accountGone()) return GONE;
      const ins = await sbClient.from("profiles").insert({ id: AUTH.user.id, name }).select("id,name").maybeSingle();
      if (ins.error && ins.error.code === "23514") return NAME_BAD;
      if (!ins.data) return "Couldn't save the name. Try again.";
      AUTH.profile = ins.data;
      return "";
    }
    if (error || !data) return "Couldn't save the name. Try again.";
    AUTH.profile = data;
    return "";
  }

  // "Publish my score": no login needed. The first publish makes a publish-only account (Supabase
  // anonymous sign-in) under the name you type; later days ask again with that name filled in.
  async function publishScore(rec, name) {
    if (!name) return "Pick a name with letters or digits.";
    if (!E.nameOk(name)) return NAME_BAD;
    try {
      const sb = await loadSupabase();
      watchAuth(sb);
      if (!AUTH.user) {
        LS.set("name", name); // the new account's profile takes this name
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) return /anonymous/i.test(`${error.code || ""} ${error.message || ""}`) ? "Publishing without a login isn't switched on yet. Log in instead." : "Couldn't publish. Try again.";
        await onSession(data && data.session);
      } else await (AUTH.loading || Promise.resolve());
      if (!AUTH.profile) return "Couldn't publish. Try again.";
      const bad = await saveBoardName(name);
      if (bad) return bad;
      if (!myName() || AUTH.anon) LS.set("name", name);
      return (await postDaily(rec)) ? "" : "Couldn't publish. Try again.";
    } catch { return "Couldn't reach the leaderboard. Try again later."; }
  }
  function publishModal(rec) {
    const quiz = rec.mode === "dquiz";
    const cur = (AUTH.profile && AUTH.profile.name) || myName() || "";
    showModal("Publish your score", `<p class="muted">Your ${rec.score} goes on today's ${quiz ? "quiz " : ""}leaderboard under this name. Everyone can see it.</p>
      <form id="pub-form" class="vs-form"><input class="search" id="pub-name" maxlength="16" autocomplete="nickname" placeholder="Your name" value="${esc(cur)}" aria-label="Name on the leaderboard">
      <p class="pub-err" id="pub-err" role="alert"></p>
      <div class="btn-row"><button class="btn primary" type="submit" id="pub-go">Publish</button></div></form>`);
    const inp = $("#pub-name"), err = $("#pub-err"), btn = $("#pub-go");
    inp.focus(); inp.select();
    inp.addEventListener("input", () => { err.textContent = ""; });
    $("#pub-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!E.nameOk(inp.value)) { err.textContent = NAME_BAD; inp.focus(); return; } // as typed: cleaning drops the @ of "f@ggot"
      const name = cleanName(inp.value);
      inp.value = name;
      btn.disabled = true; btn.textContent = "Publishing…";
      const bad = await publishScore(rec, name);
      if (!$("#pub-form")) return;
      btn.disabled = false; btn.textContent = "Publish";
      if (bad) { err.textContent = bad; inp.focus(); return; }
      closeModal(); toast("Published"); boardRedraw();
    });
  }
  function boardRename() {
    if (!AUTH.profile) return;
    showModal("Leaderboard name", `<p class="muted">Everyone can see this name. Up to 16 letters or digits.</p>
      <form id="bn-form" class="vs-form"><input class="search" id="bn-input" maxlength="16" value="${esc(AUTH.profile.name)}" aria-label="Leaderboard name">
      <div class="btn-row"><button class="btn primary" type="submit">Save</button></div></form>`);
    const inp = $("#bn-input"); inp.focus(); inp.select();
    $("#bn-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const bad = E.nameOk(inp.value) ? await saveBoardName(cleanName(inp.value)) : NAME_BAD; // as typed, then cleaned
      if (bad === GONE) return closeModal();
      if (bad) return toast(bad);
      if (AUTH.anon) LS.set("name", AUTH.profile.name);
      closeModal();
      boardRedraw();
    });
  }

  // Redraw whatever leaderboard UI is on screen after a login change.
  function boardRedraw() {
    drawAccount();
    const h = location.hash.replace(/^#/, "");
    if (/^board(-quiz)?(-\d{4}-\d{2}-\d{2})?$/.test(h) || h === "admin") return route();
    const box = $("#board-box");
    if (box) fillBoardBox(box, records[box.dataset.key || `daily:${today()}`]);
  }

  // Only the providers switched on in the Supabase dashboard get a button, read from the
  // project's public auth settings, so turning Google on later needs no code change.
  let providersOn = null;
  function loadProviders() {
    if (!providersOn) providersOn = fetch(`${BOARD_CFG.url}/auth/v1/settings`, { headers: { apikey: BOARD_CFG.key } })
      .then((r) => r.json())
      .then((j) => PROVIDERS.filter(([id]) => j && j.external && j.external[id]))
      .catch(() => { providersOn = null; return []; });
    return providersOn;
  }
  // The account lives in the menu on every page: optional, Discord only for now.
  function drawAccount() {
    const box = $("#drawer-acct");
    if (!box) return;
    box.hidden = !BOARD_ON;
    if (!BOARD_ON || !AUTH.ready) { box.innerHTML = ""; return; }
    if (AUTH.user && AUTH.anon) {
      box.innerHTML = `<p class="acct-who">On the leaderboard as <b>${esc((AUTH.profile && AUTH.profile.name) || "…")}</b>. Log in to keep one name on every device.</p>
        <div class="btn-row"><button class="btn sm" id="acct-name">Change name</button></div>${loginButtons()}`;
      $("#acct-name", box).addEventListener("click", () => { closeDrawer(); boardRename(); });
      wireLogin(box);
    } else if (AUTH.user) {
      box.innerHTML = `<p class="acct-who">Logged in as <b>${esc((AUTH.profile && AUTH.profile.name) || "…")}</b></p>
        <div class="btn-row">${AUTH.admin ? `<a class="btn sm acct-admin" href="#admin">Admin panel</a>` : ""}<button class="btn sm" id="acct-name">Change name</button><button class="btn sm" id="acct-out">Log out</button></div>`;
      $("#acct-out", box).addEventListener("click", () => { closeDrawer(); boardLogout(); });
      $("#acct-name", box).addEventListener("click", () => { closeDrawer(); boardRename(); });
    } else {
      box.innerHTML = `<p class="acct-who">Log in to keep one name on every device. Your daily score posts by itself.</p>${loginButtons()}`;
      wireLogin(box);
    }
  }
  function loginButtons() { return `<div class="btn-row board-login"></div>`; }
  async function wireLogin(root) {
    const list = await loadProviders();
    $$(".board-login", root).forEach((row) => {
      row.innerHTML = list.length ? list.map(([id, label]) => `<button class="btn" data-login="${id}">Log in with ${label}</button>`).join("")
        : `<p class="muted small">Login isn't available right now.</p>`;
      $$("[data-login]", row).forEach((b) => b.addEventListener("click", () => boardLogin(b.dataset.login)));
    });
  }

  async function rankFor(day, uid, kind = "daily") {
    const table = BOARDS[kind].table, quiz = kind === "quiz";
    const mine = await sbClient.from(table).select(quiz ? "score,tenths" : "score").eq("day", day).eq("user_id", uid).maybeSingle();
    if (!mine.data) return null;
    const head = { count: "exact", head: true };
    const [above, tied, all] = await Promise.all([
      sbClient.from(table).select("user_id", head).eq("day", day).gt("score", mine.data.score),
      quiz ? sbClient.from(table).select("user_id", head).eq("day", day).eq("score", mine.data.score).lt("tenths", mine.data.tenths) : Promise.resolve({ count: 0 }),
      sbClient.from(table).select("user_id", head).eq("day", day),
    ]);
    return { rank: (above.count || 0) + (tied.count || 0) + 1, total: all.count || 0 };
  }

  // Today's top five, read with the public key alone (no login, no client library).
  async function boardTop(day, kind, n = 5) {
    const quiz = kind === "quiz";
    const order = quiz ? "score.desc,tenths.asc,created_at.asc" : "score.desc,created_at.asc";
    const url = `${BOARD_CFG.url}/rest/v1/${BOARDS[kind].table}?select=user_id,score${quiz ? ",tenths" : ""},profiles(name)&day=eq.${day}&order=${order}&limit=${n}`;
    const r = await fetch(url, { headers: { apikey: BOARD_CFG.key } });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).slice(0, n);
  }
  async function fillMiniBoard(el, day, kind) {
    const href = kind === "quiz" ? "#board-quiz" : "#board";
    let rows;
    try { rows = await boardTop(day, kind); } catch { if (el.isConnected) el.innerHTML = ""; return; }
    if (!el.isConnected) return;
    let rank = 0, last = null;
    el.innerHTML = `<div class="mb-head"><span>Today's leaderboard</span><a href="${href}">See all</a></div>
      ${rows.length ? `<ol class="mb-list">${rows.map((row, i) => {
        const tie = kind === "quiz" ? `${row.score}|${row.tenths}` : row.score;
        if (tie !== last) { rank = i + 1; last = tie; }
        const me = AUTH.user && row.user_id === AUTH.user.id;
        return `<li class="${me ? "me" : ""}"><span class="rank">${rank}</span><span class="nm">${esc((row.profiles && row.profiles.name) || "Player")}${me ? " · you" : ""}</span><b>${row.score}</b></li>`;
      }).join("")}</ol>` : `<p class="muted small">No scores yet. Be the first.</p>`}`;
  }

  // The box under today's results: publish (or where you placed), then today's top five.
  async function fillBoardBox(box, rec) {
    if (!BOARD_ON || !rec) return;
    const kind = rec.mode === "dquiz" ? "quiz" : "daily", href = kind === "quiz" ? "#board-quiz" : "#board";
    if (!AUTH.ready) { box.innerHTML = `<p class="muted small">Checking the leaderboard…</p>`; return; }
    const mini = `<div class="mini-board" id="mini-board"></div>`;
    const drawMini = () => { const m = $("#mini-board", box); if (m) fillMiniBoard(m, rec.date, kind); };
    if (!AUTH.user || (AUTH.anon && !isPosted(rec))) {
      box.innerHTML = `<div class="btn-row"><button class="btn primary" id="pub-btn">Publish my score</button></div>
        <p class="muted small">Or log in to keep one name on every device; then it posts by itself.</p>${loginButtons()}${mini}`;
      $("#pub-btn", box).addEventListener("click", () => publishModal(rec));
      wireLogin(box);
      return drawMini();
    }
    box.innerHTML = `<p class="muted small">Posting to the leaderboard…</p>`;
    const ok = await postDaily(rec).catch(() => false);
    if (!ok && await accountGone()) return;
    const r = ok ? await rankFor(rec.date, AUTH.user.id, kind).catch(() => null) : null;
    if (!box.isConnected) return;
    box.innerHTML = (r ? `<p class="board-pitch"><b>#${r.rank}</b> of ${r.total} today as ${esc(AUTH.profile.name)} · <a href="${href}">Leaderboard</a></p>`
      : kind === "quiz" ? "" // the quiz board isn't open on this server yet
      : `<p class="muted small">Couldn't post your score. <a href="${href}">Leaderboard</a></p>`) + mini;
    drawMini();
  }

  async function renderBoard(date, kind = "daily") {
    const quizBoard = kind === "quiz";
    const day = date || today();
    const n = dayNo(day);
    const base = quizBoard ? "board-quiz" : "board";
    setMid("Leaderboard");
    if (!BOARD_ON) {
      app.innerHTML = `<section class="screen narrow"><div class="page-head"><h1>Leaderboard</h1><p>The leaderboard isn't switched on yet.</p></div></section>`;
      return;
    }
    const prev = day > E.epoch() ? E.addDays(day, -1) : null;
    const next = day < today() ? E.addDays(day, 1) : null;
    const played = records[`${quizBoard ? "dquiz" : "daily"}:${today()}`];
    const canPublish = day === today() && played && AUTH.ready && (!AUTH.user || (AUTH.anon && !isPosted(played)));
    const acct = !AUTH.ready ? `<p class="muted small">Checking your login…</p>`
      : (AUTH.user ? `<p class="board-acct">You're on the board as <b>${esc((AUTH.profile && AUTH.profile.name) || "…")}</b>. <button class="linkish" id="bn-edit">Change name</button></p>` : "")
      + (canPublish ? `<div class="btn-row"><button class="btn primary" id="pub-btn">Publish my score</button></div>` : "")
      + (!AUTH.user || AUTH.anon ? `<p class="board-acct">${AUTH.user ? "" : "Publish your score under any name, or "}log in to keep one name on every device.</p>${loginButtons()}` : "");
    const arrow = (to, dir) => (to ? `<a class="icon-btn" href="#${to === today() ? base : `${base}-${to}`}" aria-label="${dir < 0 ? "Previous" : "Next"} day">${CHEV.replace('class="chev"', `class="chev ${dir < 0 ? "go-l" : "go-r"}"`)}</a>` : `<span class="icon-btn off" aria-hidden="true"></span>`);
    app.innerHTML = `<section class="screen split">
      <div class="side">
        <div class="page-head"><h1>Leaderboard</h1></div>
        <nav class="tabs" aria-label="Which leaderboard"><a href="#${day === today() ? "board" : `board-${day}`}" class="${quizBoard ? "" : "on"}" ${quizBoard ? "" : 'aria-current="page"'}>Daily</a><a href="#${day === today() || day < E.epoch() ? "board-quiz" : `board-quiz-${day}`}" class="${quizBoard ? "on" : ""}" ${quizBoard ? 'aria-current="page"' : ""}>Quiz</a></nav>
        <div class="board-days">${arrow(prev, -1)}<p><b>${esc(prettyDate(day, { weekday: "long", month: "short", day: "numeric" }))}</b><span>${quizBoard ? `Daily Quiz #${dquizNumber(day)}` : `MLion #${n}`}</span></p>${arrow(next, 1)}</div>
        ${day === today() && !played ? `<div><a class="btn primary big" href="#${quizBoard ? "daily-quiz" : "daily"}">Play today's ${quizBoard ? "quiz" : "daily"}</a></div>` : ""}
      </div>
      <div class="main"><ol class="list big board-list" id="board-list"><li class="muted">Loading…</li></ol>
        <div class="board-side">${acct}<p class="muted small">One score per person per day, on the 25 s clock: the first ${quizBoard ? "daily quiz" : "daily"} you publish. Logged in, it posts by itself.${quizBoard ? " Equal scores rank by total time." : ""}</p></div>
      </div>
    </section>`;
    wireLogin(app);
    const ed = $("#bn-edit"); if (ed) ed.addEventListener("click", boardRename);
    const pub = $("#pub-btn"); if (pub) pub.addEventListener("click", () => publishModal(played));
    const list = $("#board-list");
    try {
      const sb = await loadSupabase();
      if (AUTH.user && !AUTH.anon && day === today()) await postDaily(played).catch(() => false);
      let q = sb.from(BOARDS[kind].table).select(`user_id,score,${quizBoard ? "marks,tenths" : "tiers"},created_at,profiles(name)`).eq("day", day).order("score", { ascending: false });
      if (quizBoard) q = q.order("tenths", { ascending: true });
      const { data, error } = await q.order("created_at", { ascending: true }).limit(100);
      if (missingTable(error)) { if (list.isConnected) list.innerHTML = `<li class="muted">The quiz leaderboard opens soon.</li>`; return; }
      if (error) throw error;
      if (!list.isConnected) return;
      if (!data.length) { list.innerHTML = `<li class="muted">No scores yet${day === today() ? ". Be the first" : ""}.</li>`; return; }
      let rank = 0, last = null;
      list.innerHTML = data.map((row, i) => {
        const tie = quizBoard ? `${row.score}|${row.tenths}` : row.score; // the quiz board breaks ties on time
        if (tie !== last) { rank = i + 1; last = tie; }
        const me = AUTH.user && row.user_id === AUTH.user.id;
        return `<li><div class="list-item${me ? " me" : ""}">
          <span class="rank">${rank}</span>
          <span class="main"><span class="title">${esc((row.profiles && row.profiles.name) || "Player")}${me ? " · you" : ""}</span><span class="sub">${quizBoard ? `${qmarksRow(String(row.marks || "").split("").map((c) => c === "1"))}<span class="nm-t">${fmtSecs(row.tenths || 0)}</span>` : tiersRow(decTiers(row.tiers))}</span></span>
          <span class="right"><b>${row.score}</b>/700</span></div></li>`;
      }).join("");
    } catch {
      if (list.isConnected) list.innerHTML = `<li class="muted">Couldn't load the leaderboard. Check your connection and try again.</li>`;
    }
  }

  // ============================================================ results
  /** An answer key folded under a results row: the row already names the prompt. */
  const inlineKey = (pid, yourAnswer) => { const p = PROMPTS.get(pid); return p && !p.reasoning ? answerKey(p, yourAnswer, false, true) : ""; };
  function answerKey(p, yourAnswer, open, inline) {
    const counts = Object.fromEntries(E.TIER_IDS.map((t) => [t, 0]));
    p.answers.forEach((a) => counts[a.t]++);
    const gem = p.answers.find((a) => a.t === "mlion");
    const you = yourAnswer ? E.fullKey(yourAnswer) : "";
    return `<details class="key${inline ? " inline" : ""}" ${open ? "open" : ""} data-pid="${esc(p.id)}">
      <summary>${inline ? `<span class="grow"><span class="cnt-s">All ${fmt(p.answers.length)} answers</span></span>` : `<span class="grow"><b>${esc(p.text)}</b><span class="cnt-s">${fmt(p.answers.length)} answers</span></span>`}${CHEV}</summary>
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
            ${a.aka && a.aka.length ? `<span class="ak">${esc(a.aka.slice(0, 3).join(", "))}</span>` : ""}
            ${a.q ? `<span class="ex">${esc(a.q)}</span>` : ""}</span>
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
    const isQ = isQuizMode(rec.mode); // quiz runs: 100 a hit, no rarity bands
    const quiz = isQ ? rec.quiz || [] : null;
    const hits = rec.results.filter((r) => r.score > 0).length;
    const band = !isQ && n === 7 ? E.bandFor(rec.score) : null;
    setMid(rec.label);
    const share = E.shareText({ mode: rec.mode, number: rec.number, score: rec.score, tiers: rec.tiers, secs: rec.secs, label: rec.mode === "pack" ? PACKS.get(rec.pack).name : rec.label });
    const isDailyToday = (rec.mode === "daily" || rec.mode === "dquiz") && rec.date === today();
    const picked = !BROWSE && (rec.mode === "pack" || rec.mode === "practice"); // those pages are hidden
    const nextHref = picked ? "#unlimited" : rec.mode === "unlimited" ? "#unlimited-play" :
      rec.mode === "quiz" || rec.mode === "dquiz" ? `#quiz-${nextQuiz()}` :
      rec.mode === "pack" ? `#pack-${rec.pack}-${nextPackRun(rec.pack) > E.packRunCount(DATA, rec.pack) ? 1 : nextPackRun(rec.pack)}` :
      rec.mode === "practice" ? "#library" : "#unlimited";
    const nextLabel = picked ? "Play Unlimited" : rec.mode === "dquiz" ? "Practice quiz" : rec.mode === "unlimited" ? "Keep going" : rec.mode === "quiz" ? "Next run" : rec.mode === "pack" ? "Next pack run" : rec.mode === "practice" ? "Library" : "Play Unlimited";
    const accepted = rec.results.filter((r) => r.tier).length;
    const isVs = rec.mode === "vs" || rec.mode === "vq";
    const meQ = isQ ? { name: rec.name || "You", picks: rec.picks || [], tenths: rec.tenths || 0, you: true } : null;
    V.setRounds(n); // the results chart uses the same hill as the run
    scene("results");
    app.innerHTML = `<section class="screen results">
      <div class="side">
        <div class="score-hero">
          <p class="label">${esc(rec.label)}${rec.date ? ` · ${esc(prettyDate(rec.date, { month: "short", day: "numeric" }))}` : ""}</p>
          <div class="score-big">${rec.score}<small>/${max}</small></div>
          ${rec.mode === "vq" && rec.opp ? (() => { const me = rec.score, them = quizPts(quiz, rec.opp.picks), c = quizCompare(quiz, meQ, rec.opp); return `<p class="band ${c < 0 ? "t-mlion" : ""}">${c === 0 ? "Draw" : c < 0 ? "You win" : `${esc(rec.opp.name)} wins`} · ${me} vs ${them}${me === them && c ? (c < 0 ? " · faster" : " · slower") : ""}</p>`; })()
            : isVs && rec.opp ? (() => { const me = rec.score, them = tierPoints(rec.opp.tiers); return `<p class="band ${me >= them ? "t-mlion" : ""}">${me === them ? "Draw" : me > them ? "You win" : `${esc(rec.opp.name)} wins`} · ${me} vs ${them}</p>`; })()
            : isQ ? `<p class="band">${hits} of ${n} right</p>` : band ? `<p class="band t-${band.tier}">${esc(band.name)}</p>` : ""}
          ${isQ ? qmarksRow(rec.results.map((r) => r.score > 0), "grid-tiers") : tiersRow(rec.tiers, "grid-tiers")}
          <p class="loss-line">Loss ${((max - rec.score) / 100).toFixed(2)} · ${isQ ? `${hits} of ${n} right · ${fmtSecs(rec.tenths || 0)}` : `${accepted} of ${n} accepted`}</p>
          <div class="btn-row">
            ${isVs ? `<button class="btn primary big" id="send-vs">${rec.opp ? "Send result back" : "Send my score"}</button>
              <a class="btn big" href="#challenge">New challenge</a>` : `${rec.mode !== "practice" ? `<button class="btn primary big" id="share">Share</button>` : ""}
            <a class="btn big" href="${nextHref}">${esc(nextLabel)}</a>`}
          </div>
          ${isDailyToday && BOARD_ON ? `<div class="board-box" id="board-box" data-key="${esc(rec.key)}"></div>` : ""}
          ${isDailyToday ? `<p class="countdown">${rec.mode === "dquiz" ? "Next quiz in" : "Next descent in"} <b id="cd">${hhmmss(E.msUntilLocalMidnight())}</b></p>` : ""}
        </div>
      </div>
      <div class="main">
        ${rec.mode === "vq" && rec.opp ? quizDuelBoard(quiz, meQ, rec.opp) : isVs && rec.opp ? duelBoard(rec.promptIds, { name: rec.name || "You", tiers: rec.tiers, you: true }, rec.opp) : ""}
        ${n > 1 ? `<figure class="profile-wrap">${V.profileSvg(rec.results, `Your descent: loss ${((max - rec.score) / 100).toFixed(2)}`)}</figure>` : ""}
        <section>
          <h2 class="block-title">Your answers</h2>
          <ul class="run-list">${isQ ? rec.results.map((r, i) => {
            const q = quiz[i], right = q ? q.options[q.correct] : r.answer, x = right && explainOf(r.promptId, right), ok = r.score > 0;
            return `<li class="run-item t-${ok ? QUIZ_TIER : "miss"}">${qmark(ok)}
              <span><span class="q">${esc(r.promptText)}</span>
                <span class="a">${esc(right || "")}</span>
                ${ok ? "" : `<span class="qp">${r.raw ? `You picked ${esc(r.raw)}` : r.timeout ? "Out of time" : "No answer"}</span>`}
                ${x ? `<span class="qp">${esc(x)}</span>` : ""}${inlineKey(r.promptId, right)}</span>
              <span class="pts">+${r.score}</span>
            </li>`; }).join("") : rec.results.map((r) => `
            <li class="run-item t-${tierOf(r.tier)}">${G(r.tier)}
              <span><span class="q">${esc(r.promptText)}</span>
                <span class="a ${r.answer ? "" : "missed"}">${r.answer ? esc(r.answer) : r.raw ? `“${esc(r.raw)}”` : r.skipped ? "Skipped" : "No answer"}</span>
                ${(() => { const x = r.answer && (explainOf(r.promptId, r.answer) || r.quip); return x ? `<span class="qp">${esc(x)}</span>` : ""; })()}${inlineKey(r.promptId, r.answer)}</span>
              <span class="pts">+${r.score}</span>
            </li>`).join("")}</ul>
        </section>
        <div class="btn-row">
          <a class="btn" href="#home">Home</a>
          <a class="btn" href="#stats">Stats</a>
        </div>
      </div>
    </section>`;
    wireAnswerKeys(app);
    const bbox = $("#board-box");
    if (bbox) fillBoardBox(bbox, rec);
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
      if (rec.mode === "vq") {
        const me = { name: rec.name || myName() || "A friend", picks: rec.picks, tenths: rec.tenths };
        const link = vqLink(rec.seed, rec.n, rec.opp ? [rec.opp, me] : [me], rec.secs);
        const text = rec.opp ? `I scored ${rec.score} vs your ${quizPts(quiz, rec.opp.picks)} on the MLion quiz. See it:` : `Beat my ${rec.score} on the MLion quiz. Same ${rec.n} questions:`;
        return shareLink(`${text}\n${link}`);
      }
      const me = { name: rec.name || myName() || "A friend", tiers: rec.tiers };
      const players = rec.opp ? [rec.opp, me] : [me];
      const link = challengeLink(rec.seed, rec.n, players, rec.secs);
      const text = rec.opp ? `I scored ${rec.score} vs your ${tierPoints(rec.opp.tiers)} on MLion. See it:` : `Beat my ${rec.score} on MLion. Same ${rec.n} questions:`;
      shareLink(`${text}\n${link}`);
    });
  }

  /** Quiz head-to-head: winner (points, then the faster total time), both scores, question by question. */
  function quizDuelBoard(quiz, a, b) {
    const sa = quizPts(quiz, a.picks), sb = quizPts(quiz, b.picks), c = quizCompare(quiz, a, b);
    const head = c === 0 ? "It's a draw" : `${esc(c < 0 ? a.name : b.name)} wins`;
    const side = (pl, s, win) => `<div class="${win ? "win" : ""}"><b>${s}</b><span>${esc(pl.name)}${pl.you && pl.name !== "You" ? " (you)" : ""} · ${fmtSecs(pl.tenths)}</span></div>`;
    return `<section class="duel" aria-label="Head to head">
      <h2 class="duel-head">${head}</h2>
      ${sa === sb && c ? `<p class="duel-tie">Level on points: the faster ${c < 0 ? esc(a.name) : esc(b.name)} takes it.</p>` : ""}
      <div class="duel-scores">${side(a, sa, c <= 0)}<span class="duel-v">vs</span>${side(b, sb, c >= 0)}</div>
      <ul class="duel-rows">${quiz.map((q, i) => {
        const ra = a.picks[i] - 1 === q.correct, rb = b.picks[i] - 1 === q.correct;
        const p = PROMPTS.get(q.promptId);
        return `<li><span class="dq">${esc(p ? p.text : q.promptId)}</span>
          <span class="dc t-${ra ? QUIZ_TIER : "miss"}${ra && !rb ? " win" : ""}">${qmark(ra)}<b>${ra ? E.QUIZ_POINTS : 0}</b></span>
          <span class="dc t-${rb ? QUIZ_TIER : "miss"}${rb && !ra ? " win" : ""}">${qmark(rb)}<b>${rb ? E.QUIZ_POINTS : 0}</b></span></li>`;
      }).join("")}</ul>
    </section>`;
  }
  /** A finished quiz duel opened from a link (both results inside it). */
  function renderQuizDuel(c, a, b, bIsMe) {
    setMid("Head to head");
    scene("results");
    const quiz = quizChallengeQuiz(c.seed, c.n);
    app.innerHTML = `<section class="screen results">
      <div class="side">
        <div class="page-head"><h1>Head to head</h1><p>${c.n} quiz questions, same for both.</p></div>
        <div class="btn-row">
          ${bIsMe ? `<button class="btn primary big" id="send-vs">Send result back</button>` : ""}
          <a class="btn${bIsMe ? "" : " primary"} big" href="#challenge">Rematch</a>
        </div>
      </div>
      <div class="main">${quizDuelBoard(quiz, bIsMe ? { ...b, you: true } : a, bIsMe ? a : b)}</div>
    </section>`;
    const sv = $("#send-vs");
    if (sv) sv.addEventListener("click", () => shareLink(`I scored ${quizPts(quiz, b.picks)} vs your ${quizPts(quiz, a.picks)} on the MLion quiz. See it:\n${vqLink(c.seed, c.n, [a, b], c.secs)}`));
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
    if (sv) sv.addEventListener("click", () => shareLink(`I scored ${tierPoints(b.tiers)} vs your ${tierPoints(a.tiers)} on MLion. See it:\n${challengeLink(c.seed, c.n, [a, b], c.secs)}`));
  }

  /** Pick a size and a name, then play first. */
  function renderChallenge() {
    setMid("Challenge");
    let size = LS.get("vsSize", 5);
    if (!validQ(size)) size = 5;
    let secs = LS.get("vsSecs", settings.answerSecs);
    if (!validSecs(secs)) secs = DEFAULT_SECS;
    let fmt = LS.get("vsFormat", "rarity") === "quiz" ? "quiz" : "rarity";
    app.innerHTML = `<section class="screen challenge">
      <div class="page-head"><h1>Challenge a friend</h1><p>Play first, then send one link. Your friend plays the same questions and sees who won. No accounts.</p></div>
      <div class="vs-form">
        <div class="vs-field"><span>Format</span><div class="vs-sizes" role="radiogroup" aria-label="Format">${[["rarity", "Classic"], ["quiz", "Quiz"]].map(([k, l]) => `<button type="button" class="vs-size fmt-size${fmt === k ? " on" : ""}" role="radio" aria-checked="${fmt === k}" data-f="${k}">${l}</button>`).join("")}</div></div>
        <label class="vs-field"><span>Your name</span><input class="search" id="vs-name" maxlength="16" autocomplete="nickname" placeholder="So your friend knows" value="${esc(myName())}"></label>
        ${qPicker(size)}
        ${timePicker(secs)}
        <button class="btn primary big" id="vs-go">Start</button>
      </div>
    </section>`;
    wireQPicker(() => size, (n) => {
      size = n;
      $$(".q-size").forEach((x) => { const on = +x.dataset.n === n; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
      const box = $("#q-custom");
      box.classList.toggle("on", !Q_PRESETS.includes(n));
      if (Q_PRESETS.includes(n)) box.value = "";
    });
    wireTimePicker((v) => { secs = v; });
    $$(".fmt-size").forEach((b) => b.addEventListener("click", () => {
      fmt = b.dataset.f;
      $$(".fmt-size").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
    }));
    $("#vs-go").addEventListener("click", () => {
      const box = $("#q-custom"); // a number typed but not yet confirmed still counts
      if (box.value !== "" && validQ(Math.round(+box.value))) size = Math.round(+box.value);
      LS.set("name", $("#vs-name").value.trim().slice(0, 16));
      LS.set("vsSize", size);
      LS.set("vsSecs", secs);
      const seed = fmt === "quiz" ? Math.random().toString(36).slice(2, 12).padEnd(10, "0") : Math.random().toString(36).slice(2, 9).padEnd(6, "0");
      LS.set("vsFormat", fmt);
      go(`${fmt === "quiz" ? "vq" : "vs"}-${seed}-${size}${secs !== DEFAULT_SECS ? `t${secs}` : ""}`);
    });
  }

  // =========================================================== unlimited
  function renderUnlimited() {
    setMid("Unlimited");
    const runs = Object.values(records).filter((r) => r.mode === "unlimited").sort((a, b) => b.number - a.number);
    const inProg = LS.get(`run:unlimited:${nextUnlimited()}`);
    const answered = runs.reduce((s, r) => s + r.results.length, 0);
    const points = runs.reduce((s, r) => s + r.score, 0);
    const deck = soloPool().prompts.length;
    const label = inProg && inProg.results && inProg.results.length ? `Resume · ${inProg.results.length} answered` : runs.length ? "Keep going" : "Start";
    app.innerHTML = `<section class="screen ${runs.length ? "split" : ""}">
      <div class="side">
        <div class="page-head"><h1>Unlimited</h1><p>Prompt after prompt from one shuffled deck of ${deck}${settings.extraQuestions ? ", extras included" : ""}. Nothing repeats until you've seen them all. Stop whenever you like; next time picks up where you left off.</p></div>
        ${runs.length ? `<div class="figures"><div class="figure"><b>${runs.length}</b><span>Sessions</span></div><div class="figure"><b>${answered}</b><span>Answered</span></div><div class="figure"><b>${answered ? Math.round(points / answered) : 0}</b><span>Avg points</span></div></div>` : ""}
        <div><a class="btn primary big" href="#unlimited-play">${label}</a></div>
      </div>
      ${runs.length ? `<div class="main"><ul class="list">${runs.slice(0, 50).map((r) => `
        <li><a class="list-item" href="#results-${slugFor(r.key)}"><span class="main"><span class="title">Session ${r.number} · ${r.results.length} ${r.results.length === 1 ? "prompt" : "prompts"}</span><span class="sub">${tiersRow(r.tiers.slice(-14))}</span></span><span class="right"><b>${r.score}</b></span></a></li>`).join("")}</ul></div>` : ""}
    </section>`;
  }


  // =============================================================== sprint
  // One prompt, sixty seconds, every answer you can name. Each answer scores its tier's points, so
  // rare ones still count for more. Unranked: bests stay in this browser (mlion:sprints).
  const SPRINT_SECS = 60;
  // Every accepted answer adds time to the clock, more for a rarer one, up to a minute in all (user request).
  const SPRINT_BONUS = { baseline: 1, overfit: 2, indist: 3, outlier: 4, longtail: 5, mlion: 8 };
  const SPRINT_BONUS_CAP = 60000;
  const SPRINT_BONUS_MAX = 8000; // the most one answer adds: a tally claiming more than this per answer is forged
  /** Adds the seconds an answer of tier t earns to sprint S (solo or live) and flashes "+N s" by the clock. */
  function sprintAddTime(S, t) {
    const add = Math.min((SPRINT_BONUS[t] || 0) * 1000, SPRINT_BONUS_CAP - S.bonus);
    if (add <= 0) return 0;
    S.bonus += add;
    if (S.endsAt) S.endsAt += add; // a live round runs on its own end time
    const plus = $("#sp-plus");
    if (plus) { plus.textContent = `+${add / 1000} s`; plus.classList.remove("on"); void plus.offsetWidth; plus.classList.add("on"); }
    return add;
  }
  const sprintTimer = (secs, label, ended) => `<div class="timer sp-timer${ended ? " low" : ""}" id="sp-timer"><div class="timer-row"><span id="sp-label">${label}</span><b id="sp-secs">${secs.toFixed(1)}</b></div><em class="sp-plus" id="sp-plus" aria-hidden="true"></em><div class="timer-track"><div class="timer-fill" id="sp-fill"${ended ? ' style="transform:scaleX(0)"' : ""}></div></div></div>`;
  let sprints = LS.get("sprints", {}); // prompt id -> { best (points), n (answers then), plays, at }
  let SPRINT = null; // the sprint on screen
  const SPRINT_MIN = 40; // answers a prompt needs for a whole minute to be worth playing
  const sprintOk = (p) => !!p && !p.reasoning && p.answers.length >= SPRINT_MIN;
  const sprintPool = () => soloPool().prompts.filter(sprintOk);
  function sprintPick(not) {
    const pool = sprintPool().filter((p) => p.id !== not);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const sprintAsk = (p) => `<p class="prompt-text">${esc(p.text)}${p.example ? ` <span class="eg">(e.g. ${esc(p.example)})</span>` : ""}</p>
    ${p.scope ? `<p class="prompt-note">${esc(p.scope)}</p>` : ""}`;

  /** A sprint link can carry a friend's result to beat: #sprint-<prompt>~<points>~<answers>[~<nameHex>]. */
  function sprintVs(parts) {
    const pts = +parts[0], n = +parts[1];
    if (!Number.isInteger(pts) || !Number.isInteger(n) || pts < 0 || pts > 99999 || n < 0 || n > 999) return null;
    return { pts, n, name: (parts[2] && /^(?:[0-9a-f]{2}){1,32}$/.test(parts[2]) && decName(parts[2]).slice(0, 16)) || "Your friend" };
  }
  const sprintLink = (pid, pts, n) => `${SHARE_BASE || siteUrl()}#sprint-${pid}~${pts}~${n}${myName() ? "~" + encName(myName()) : ""}`;

  function renderSprint(id) {
    setMid("Sprint");
    SPRINT = null;
    if (!id) { const p = sprintPick(); return p ? location.replace("#sprint-" + p.id) : go("home"); }
    const [pid, ...rest] = id.split("~");
    const p = PROMPTS.get(pid);
    if (!p || p.reasoning) return go("sprint");
    let vs = rest.length >= 2 ? sprintVs(rest) : null;
    const mine = sprints[p.id];
    if (vs && mine && mine.best === vs.pts && myName() && vs.name === myName()) vs = null; // my own link (a nameless one stays a duel)
    const recent = Object.entries(sprints).filter(([pid]) => PROMPTS.has(pid)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 8);
    app.innerHTML = `<section class="screen narrow sprint" id="sprint">
      <div class="page-head"><h1>Sprint</h1><p>One prompt, ${SPRINT_SECS} seconds. Name every answer you can. Rarer ones score more and add more time.</p></div>
      <div class="sp-card" id="sp-card">
        ${sprintAsk(p)}
        ${vs ? `<p class="sp-vs">${esc(vs.name)} named ${vs.n} for ${vs.pts} points. Beat that.</p>` : ""}
        <p class="sp-meta">${fmt(p.answers.length)} answers in the key${mine ? `. Your best: ${mine.best} points` : ""}</p>
        <div class="btn-row"><button class="btn primary big" id="sp-go" type="button">Start</button><button class="btn big" id="sp-other" type="button">Another prompt</button></div>
      </div>
      ${recent.length ? `<section class="sp-recent"><h2 class="block-title">Your sprints</h2><ul class="list">${recent.map(([pid, r]) => `
        <li><a class="list-item" href="#sprint-${esc(pid)}"><span class="main"><span class="title">${esc(PROMPTS.get(pid).text)}</span><span class="sub">${r.plays} ${r.plays === 1 ? "run" : "runs"}</span></span><span class="right"><b>${r.best}</b></span></a></li>`).join("")}</ul></section>` : ""}
    </section>`;
    $("#sp-go").addEventListener("click", () => startSprint(p, vs));
    $("#sp-other").addEventListener("click", () => { const q = sprintPick(p.id); if (q) location.replace("#sprint-" + q.id); });
    $("#sp-go").focus({ preventScroll: true }); // like Begin on the daily: Enter starts
  }

  function startSprint(p, vs) {
    Sound.unlock();
    window.scrollTo(0, 0);
    $("#sprint").classList.add("playing");
    $("#sp-card").innerHTML = `${sprintAsk(p)}
      ${sprintTimer(SPRINT_SECS, "Time left")}
      <form class="answer-form" id="sp-form" autocomplete="off">
        <input class="answer-input" id="sp-answer" maxlength="${E.MAX_ANSWER_LENGTH}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Your answer" placeholder="Type an answer">
        <button class="btn primary step-btn" type="submit">Step</button>
      </form>
      <div class="status" id="status" role="status" aria-live="polite"></div>
      <p class="sp-tally"><b id="sp-n">0</b> answers <b id="sp-pts">0</b> points${vs ? `<span class="sp-target">${esc(vs.name)}: ${vs.pts}</span>` : ""}</p>
      <ol class="sp-found" id="sp-found"></ol>`;
    const input = $("#sp-answer"), total = SPRINT_SECS * 1000;
    const S = SPRINT = { p, vs, t0: performance.now(), found: [], got: new Set(), pts: 0, bonus: 0, done: false, lastTick: SPRINT_SECS };
    input.focus();
    every(100, () => {
      if (S !== SPRINT || S.done) return;
      const left = Math.max(0, total + S.bonus - (performance.now() - S.t0));
      const secs = $("#sp-secs"), fill = $("#sp-fill"), timer = $("#sp-timer");
      if (!secs) return;
      secs.textContent = (left / 1000).toFixed(1);
      fill.style.transform = `scaleX(${Math.min(1, left / total).toFixed(4)})`;
      timer.classList.toggle("low", left < 10000);
      const whole = Math.ceil(left / 1000);
      if (whole > S.lastTick) S.lastTick = whole; // time was just added
      else if (whole < S.lastTick) { S.lastTick = whole; if (whole <= 5 && whole > 0) Sound.tick(); }
      if (left <= 0) finishSprint();
    });
    $("#sp-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!S.done) sprintSubmit(S, input);
    });
  }

  /** One typed sprint answer against a prompt: a hit (exact, or a confident typo), a near miss, or nothing. */
  function sprintJudge(p, raw) {
    const m = E.matchAnswer(p, raw);
    const a = m.kind === "exact" || (m.kind === "correction" && !(m.confidence < 0.88)) ? m.answer : null;
    if (a) return { kind: "hit", a, idx: p.answers.indexOf(a), corrected: m.kind === "correction" };
    if (m.kind === "suggest" || m.kind === "correction") return { kind: "close", name: (m.kind === "suggest" ? m.suggestions[0] : m.answer).a };
    return { kind: "miss" };
  }
  /** Take the typed answer in `input` for sprint state S (solo or live): count it, say why not, or clear the box. True when it counted. */
  function sprintSubmit(S, input) {
    const raw = input.value.trim();
    if (!raw) return false;
    const r = sprintJudge(S.p, raw);
    if (r.kind === "hit") {
      input.value = "";
      if (S.got.has(r.idx)) { setStatus(`Already counted: ${r.a.a}`, "info"); return false; }
      S.got.add(r.idx); S.found.push(r.a); S.pts += T[r.a.t].score;
      sprintAddTime(S, r.a.t);
      Sound.tier(r.a.t);
      setStatus(r.corrected ? `Counted as ${r.a.a}` : "");
      $("#sp-n").textContent = S.found.length; $("#sp-pts").textContent = S.pts;
      $("#sp-found").insertAdjacentHTML("afterbegin", `<li class="t-${r.a.t} pop">${G(r.a.t)}<span>${esc(r.a.a)}</span><b>+${T[r.a.t].score}</b></li>`);
      return true;
    }
    if (r.kind === "close") {
      setStatus(`Close to “${r.name}”. Check the spelling.`, "info");
      input.select();
      return false;
    }
    Sound.reject();
    const other = otherHome(raw, S.p.id);
    setStatus(other ? `“${raw}” answers “${other.text}”, not this one.` : `“${raw}” isn't in the key.`, "bad");
    input.value = "";
    input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
    return false;
  }

  function finishSprint() {
    const S = SPRINT;
    if (!S || S.done) return;
    S.done = true;
    clearScreenTimers();
    const box = $("#sp-answer");
    if (box) { box.disabled = true; box.blur(); } // an Enter typed as time runs out must not press anything
    const prev = sprints[S.p.id];
    const best = !prev || S.pts > prev.best;
    sprints[S.p.id] = { best: best ? S.pts : prev.best, n: best ? S.found.length : prev.n, plays: (prev ? prev.plays : 0) + 1, at: Date.now() };
    LS.set("sprints", sprints);
    if (S.found.length) Sound.tier(S.found.some((a) => a.t === "mlion") ? "mlion" : "outlier"); else Sound.miss();
    renderSprintDone(S, prev, best);
  }

  function renderSprintDone(S, prev, best) {
    const p = S.p, n = S.found.length;
    const counts = Object.fromEntries(E.TIER_IDS.map((t) => [t, 0]));
    S.found.forEach((a) => counts[a.t]++);
    // the most common answers first: what a strong player would have reached for
    const missed = p.answers.filter((a, i) => !S.got.has(i) && (a.t === "baseline" || a.t === "overfit" || a.t === "indist"))
      .sort((a, b) => T[a.t].score - T[b.t].score).slice(0, 8);
    const gem = p.answers.find((a) => a.t === "mlion");
    const gotGem = gem && S.got.has(p.answers.indexOf(gem));
    const share = sprintShare(S);
    const sec = $("#sprint");
    sec.classList.remove("playing"); sec.classList.add("done");
    const vs = S.vs, d = vs ? S.pts - vs.pts : 0;
    const verdict = vs ? (d > 0 ? `You beat ${esc(vs.name)} by ${d} ${d === 1 ? "point" : "points"}` : d < 0 ? `${esc(vs.name)} wins by ${-d} ${d === -1 ? "point" : "points"}` : `A tie with ${esc(vs.name)}`) : "";
    $("#sp-card").outerHTML = `<div class="sp-done" id="sp-done">
      <p class="sp-of">${esc(p.text)}</p>
      ${vs ? `<p class="sp-verdict${d > 0 ? " win" : ""}">${verdict}</p>` : ""}
      <div class="figures"><div class="figure"><b>${n}</b><span>${n === 1 ? "Answer" : "Answers"}</span></div><div class="figure"><b>${S.pts}</b><span>Points</span></div><div class="figure"><b>${SPRINT_SECS + S.bonus / 1000}</b><span>Seconds</span></div></div>
      <p class="sp-meta">${prev ? (best ? `New best on this prompt (was ${prev.best})` : `Your best here: ${prev.best} points`) : `${fmt(p.answers.length)} answers in the key`}</p>
      ${n ? `<div class="tier-counts">${E.TIERS_BY_SCORE.filter((t) => counts[t.id]).map((t) => `<span class="t-${t.id}" title="${esc(t.name)}">${G(t.id)}${counts[t.id]}</span>`).join("")}</div>` : ""}
      <div class="btn-row"><button class="btn primary big" id="sp-again" type="button">Again</button><button class="btn big" id="sp-next" type="button">Another prompt</button>${n ? `<button class="btn big" id="sp-share" type="button">Share</button>` : ""}</div>
      ${n ? `<section><h2 class="block-title">You named</h2><ol class="sp-found">${S.found.map((a) => `<li class="t-${a.t}">${G(a.t)}<span>${esc(a.a)}</span><b>+${T[a.t].score}</b></li>`).join("")}</ol></section>` : ""}
      ${missed.length ? `<section><h2 class="block-title">Common ones you missed</h2><ul class="sp-missed">${missed.map((a) => `<li class="t-${a.t}">${G(a.t)}<span>${esc(a.a)}</span></li>`).join("")}</ul></section>` : ""}
      ${gem && !gotGem ? `<div class="gem-line">${G("mlion")}<span><b>${esc(gem.a)}</b>${gem.q ? `<span class="gq">${esc(gem.q)}</span>` : ""}</span></div>` : ""}
      ${answerKey(p, null, false, true)}
    </div>`;
    wireAnswerKeys(app);
    $("#sp-again").addEventListener("click", () => renderSprint(vs ? `${p.id}~${vs.pts}~${vs.n}~${encName(vs.name)}` : p.id));
    $("#sp-next").addEventListener("click", () => { const q = sprintPick(p.id); if (q) location.replace("#sprint-" + q.id); });
    const sb = $("#sp-share");
    if (sb) sb.addEventListener("click", async () => {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        try { await navigator.share({ text: share }); return; } catch (e) { if (e && e.name === "AbortError") return; }
      }
      if (await copyText(share)) return toast("Copied to clipboard");
      showModal("Share your sprint", `<p class="muted">Copying is blocked here. Select the text and copy it.</p>
        <textarea class="search share-box" id="share-box" readonly aria-label="Share text">${esc(share)}</textarea>`);
      const box = $("#share-box"); box.focus(); box.select();
    });
  }

  /** "MLion Sprint", the prompt, the count and points, then one tier emoji per answer in the order named. */
  function sprintShare(S) {
    const grid = S.found.slice(0, 40).map((a) => E.tierEmoji(a.t)).join("") + (S.found.length > 40 ? "…" : "");
    const url = settings.shareLink && (SHARE_BASE || siteUrl()) ? `\n\nBeat me: ${sprintLink(S.p.id, S.pts, S.found.length)}` : "";
    return `MLion Sprint 🦁\n${S.p.text}\n${S.found.length} answers · ${S.pts} points in ${SPRINT_SECS + S.bonus / 1000} s${grid ? `\n\n${grid}` : ""}${url}`;
  }

  // ======================================================== live sprint
  // The Sprint format of a live room. Every player gets the same prompt on the same clock (the host-stamped
  // start Classic uses) and types as many answers as they can for a minute. Each accepted answer sends a
  // small progress message (answers, points), so rivals' counts tick up on every screen while the answers
  // themselves stay hidden. When a player's clock ends their list goes to the host; once every list is in
  // (or a straggler's grace runs out) the host reveals them all and starts the next prompt.
  // It sits beside the shared RUN engine (one answer per round) rather than inside it.
  const SP_CAP = 200;        // most answers one round can carry, so a forged list can't flood the room
  const SP_GRACE_MS = 6000;  // how long the host waits past the clock for a straggler's list
  const SP_REVEAL_MS = 9000; // how long a reveal stays up, plus 0.3 s for each answer in the longest list
  const SP_DEFAULT_N = 3;    // a minute a prompt makes the Classic default of 7 far too long
  let SPR = null;            // the round on screen: { i, p, phase, found, got, pts, ... }; phases: intro wait preview play ended reveal away
  /** Tests shorten the minute and the reveal through window.MLION_SPRINT_TEST; it is read only when MLION_TEST is set. */
  const spTest = () => (window.MLION_TEST && window.MLION_SPRINT_TEST) || {};
  const spMs = () => (+spTest().secs > 0 ? +spTest().secs : SPRINT_SECS) * 1000;
  const spRevealMs = (most) => (+spTest().reveal > 0 ? +spTest().reveal : Math.min(18000, SP_REVEAL_MS + 300 * most));
  const spRound = (i) => ({ i, p: PROMPTS.get(LIVE.ids[i]), phase: "intro", found: [], got: new Set(), pts: 0, bonus: 0, lastTick: Infinity, shown: {} });
  /** A progress tally that could be real: answers, their points, and the time they added (ms). */
  const spTallyOk = (n, pts, b) => n >= 0 && n <= SP_CAP && pts >= 0 && pts <= 100 * n && b >= 0 && b <= Math.min(SPRINT_BONUS_CAP, SPRINT_BONUS_MAX * n);

  /** Everyone who played this match: those still here, then those who left after it began. */
  function spPlayers() {
    const here = inMatch(), ids = new Set(here.map((p) => p.id));
    return here.concat([...LIVE.gone.values()].filter((g) => !ids.has(g.id)));
  }
  /** A player who drops out of a sprint match keeps what they scored: their record moves to `gone`. */
  function liveSprintKeep(before, next) {
    if (!liveSprint() || (LIVE.phase !== "playing" && LIVE.phase !== "done")) return;
    for (const id of before) {
      const pl = LIVE.players.get(id);
      if (!next.has(id) && pl && !pl.late) LIVE.gone.set(id, pl);
    }
  }
  /** A player's numbers for a round: their list if it came, else the progress they sent. */
  const spNow = (pl, i) => { const a = pl.ans[i], s = pl.sp && pl.sp[i]; return a ? { n: a.n, pts: a.score } : s || { n: 0, pts: 0 }; };
  const spCount = (pl) => { let n = 0; for (const k in pl.ans) if (+k <= LIVE.revealed) n += pl.ans[k].n || 0; return n; };
  /** A list of answer indexes into the prompt, each once; null when it isn't one. */
  function spCleanList(p, list) {
    if (!p || !Array.isArray(list) || list.length > SP_CAP) return null;
    const seen = new Set();
    for (const x of list) { if (!Number.isInteger(x) || x < 0 || x >= p.answers.length || seen.has(x)) return null; seen.add(x); }
    return list.slice();
  }
  const spScore = (p, list) => ({ n: list.length, score: list.reduce((s, x) => s + T[p.answers[x].t].score, 0), list });
  /** answer index -> how many players named it, for a revealed round */
  function spNamed(i) {
    const named = new Map();
    for (const pl of spPlayers()) { const a = pl.ans[i]; if (a && a.list) for (const x of a.list) named.set(x, (named.get(x) || 0) + 1); }
    return named;
  }

  // ---- every page
  function liveSprintStart(m) {
    const ids = Array.isArray(m.ids) && m.ids.length === LIVE.n && m.ids.every((id) => sprintOk(PROMPTS.get(id))) ? m.ids.slice()
      : E.shuffled(CORE.prompts.filter(sprintOk).map((p) => p.id), E.mulberry32(E.hashString(m.seed))).slice(0, LIVE.n);
    Object.assign(LIVE, { mfmt: "sprint", quiz: null, skip: null, gone: new Map(), ids, n: ids.length });
    for (const pl of LIVE.players.values()) pl.sp = {};
    SPR = spRound(0);
    renderSprintShell();
  }
  function liveSprintStop() {
    if (SPR) { clearInterval(SPR.loop); clearTimeout(SPR.beginTimer); }
    SPR = null;
  }
  function liveSprintMsg(m) {
    if (!liveSprint() || !LIVE.ids || !LIVE.ids.length || !Number.isInteger(m.i) || m.i < 0 || m.i >= LIVE.n) return;
    if (m.t === "spround") {
      if (m.i <= LIVE.revealed || (SPR && SPR.i === m.i && SPR.phase !== "intro")) return; // an old round, or one already running
      liveSprintStop();
      const S = SPR = spRound(m.i);
      S.phase = "wait";
      LIVE.skip = null;
      drawSprint();
      const wait = Number.isFinite(+m.at) ? Math.min(3000, Math.max(0, +m.at - hostNow())) : 0;
      S.beginTimer = setTimeout(() => { if (SPR === S) liveSprintBegin(); }, wait);
    } else if (m.t === "spp") {
      const pl = LIVE.players.get(m.id) || LIVE.gone.get(m.id);
      if (!pl || pl.ans[m.i]) return;
      const n = Math.round(+m.n), pts = Math.round(+m.pts), b = Math.round(+m.b || 0);
      if (!spTallyOk(n, pts, b)) return;
      if (!pl.sp) pl.sp = {};
      if (pl.sp[m.i] && n < pl.sp[m.i].n) return; // an older message arriving late
      pl.sp[m.i] = { n, pts, b };
      if (SPR && SPR.i === m.i && pl.id !== LIVE.myId) liveSprintBoard();
    } else if (m.t === "spans") {
      const pl = LIVE.players.get(m.id), p = PROMPTS.get(LIVE.ids[m.i]);
      if (!pl || pl.ans[m.i]) return;
      const list = spCleanList(p, m.list);
      if (!list) return;
      pl.ans[m.i] = spScore(p, list);
      if (!pl.sp) pl.sp = {};
      pl.sp[m.i] = { n: pl.ans[m.i].n, pts: pl.ans[m.i].score };
      if (SPR && SPR.i === m.i) { liveSprintBoard(); spWaitText(); }
    }
  }
  /** The reveal: lists for those who sent one, the host's last-known progress for those who didn't. */
  function liveSprintReveal(m) {
    const i = m.i;
    if (!LIVE.ids || i >= LIVE.n) return;
    LIVE.revealed = Math.max(LIVE.revealed, i);
    const part = new Map((Array.isArray(m.part) ? m.part.slice(0, 12) : []).filter((x) => x && typeof x.id === "string").map((x) => [x.id, x]));
    for (const pl of spPlayers()) {
      if (pl.ans[i]) continue;
      const s = part.get(pl.id) || (pl.sp && pl.sp[i]) || { n: 0, pts: 0 };
      const n = Math.max(0, Math.min(SP_CAP, Math.round(+s.n) || 0));
      pl.ans[i] = { n, score: Math.max(0, Math.min(100 * n, Math.round(+s.pts) || 0)), list: null };
    }
    if (!SPR || SPR.i !== i) { liveSprintStop(); SPR = spRound(i); } // this page never saw the round start
    const S = SPR;
    clearInterval(S.loop); clearTimeout(S.beginTimer);
    S.phase = "reveal";
    S.nextAt = Number.isFinite(+m.nextAt) ? +m.nextAt : 0;
    drawSprint();
    S.loop = setInterval(() => { const el = S === SPR && $("#sp-next"); if (el) el.textContent = spNextLine(S); }, 250);
  }
  let spCarry = null; // a taken-over host's sprint match, kept until the new host says "resume"
  function spSnapshot() {
    return { ids: LIVE.ids.slice(), gone: LIVE.gone, S: SPR, rec: new Map(playerList().map((p) => [p.id, { ans: p.ans, sp: p.sp || {} }])) };
  }
  /** Back in a sprint match this page lost track of (it was the host and was taken over, or it reloaded):
   *  the format, prompts and round come from the host's "resume"; answers so far from what this page kept. */
  function liveSprintRestore(d) {
    const c = spCarry; spCarry = null;
    const ids = Array.isArray(d.ids) && d.ids.length && d.ids.length <= Q_MAX && d.ids.every((id) => sprintOk(PROMPTS.get(id))) ? d.ids.slice() : null;
    if (!ids) return;
    const i = Number.isInteger(d.i) && d.i >= 0 && d.i < ids.length ? d.i : 0;
    const same = !!c && c.ids.join() === ids.join();
    Object.assign(LIVE, { mfmt: "sprint", quiz: null, skip: null, ids, n: ids.length, gone: same ? c.gone : new Map(), spRec: same ? c.rec : null,
      revealed: Number.isInteger(d.revealed) ? Math.max(-1, Math.min(d.revealed, ids.length - 1)) : -1 });
    for (const pl of LIVE.players.values()) { const k = same && c.rec.get(pl.id); pl.ans = k ? k.ans : {}; pl.sp = k ? k.sp : {}; }
    liveSprintStop();
    SPR = same && c.S && c.S.i === i ? c.S : spRound(i);
    if (SPR.phase === "ended") spSendFinal(SPR); // its list may only have reached the old host: this page
    if (SPR.phase === "intro" || SPR.phase === "reveal") SPR.phase = "away";
    renderSprintShell();
  }
  /** A returning player waits for the next sprint, like Classic: this one ends for them with what they have. */
  function liveSprintBackIn() {
    const S = SPR;
    if (!["wait", "preview", "play"].includes(S.phase)) return;
    clearInterval(S.loop); clearTimeout(S.beginTimer);
    spSendFinal(S);
    S.phase = "away";
    drawSprint();
  }

  // ---- this player's round
  function liveSprintBegin() {
    const S = SPR;
    if (!S || S.phase !== "wait") return;
    Sound.unlock();
    S.phase = "preview";
    S.previewEndsAt = Date.now() + E.PREVIEW_MS;
    S.endsAt = S.previewEndsAt + spMs();
    if (CHAT.open && !(chatTyping() && $("#chat-input").value)) setChatOpen(false); // a new prompt: fold the chat away unless they're mid-message
    drawSprint();
    S.loop = setInterval(() => spTick(S), 100);
  }
  function spTick(S) {
    if (S !== SPR || (S.phase !== "preview" && S.phase !== "play")) return;
    const now = Date.now(), input = $("#sp-answer");
    if (!input) return;
    if (now < S.previewEndsAt) { $("#sp-veil-n").textContent = Math.ceil((S.previewEndsAt - now) / 1000); return; }
    if (S.phase === "preview") { // the minute starts
      S.phase = "play";
      input.disabled = false; $("#sp-step").disabled = false;
      $("#sp-veil").classList.add("hidden");
      $("#sp-label").textContent = "Time left";
      if (!chatTyping()) input.focus({ preventScroll: true }); // never yank someone out of a chat message
    }
    const left = Math.max(0, S.endsAt - now), total = spMs();
    $("#sp-secs").textContent = (left / 1000).toFixed(1);
    $("#sp-fill").style.transform = `scaleX(${Math.min(1, left / total).toFixed(4)})`;
    $("#sp-timer").classList.toggle("low", left < Math.min(10000, total / 3));
    const whole = Math.ceil(left / 1000);
    if (whole > S.lastTick && S.lastTick !== Infinity) S.lastTick = whole; // time was just added
    else if (whole < S.lastTick) { S.lastTick = whole; if (whole <= 5 && whole > 0) Sound.tick(); }
    if (left <= 0) liveSprintEnd();
  }
  function spSendFinal(S) {
    const m = { t: "spans", i: S.i, list: S.found.map((a) => S.p.answers.indexOf(a)) };
    if (LIVE.isHost) hostSprintFinal(LIVE.myId, m); else guestSend(m);
  }
  function liveSprintEnd() {
    const S = SPR;
    if (!S || (S.phase !== "preview" && S.phase !== "play")) return;
    clearInterval(S.loop);
    S.phase = "ended";
    drawSprint(); // the box is replaced by a disabled one: an Enter typed as time runs out can't press anything
    spSendFinal(S);
  }
  function liveSprintProgress() {
    const S = SPR;
    if (!S) return;
    const m = { t: "spp", i: S.i, n: S.found.length, pts: S.pts, b: S.bonus };
    if (LIVE.isHost) hostSprintProgress(LIVE.myId, m); else guestSend(m);
    liveSprintBoard();
  }

  // ---- screens
  function renderSprintShell() {
    setMid("Live sprint");
    scene("page");
    app.innerHTML = `<section class="screen narrow sprint playing live-sp" id="sprint">
      <div class="live-strip sp-strip" id="sp-strip" hidden></div>
      <div class="sp-card" id="sp-card"></div>
    </section>`;
    drawSprint();
  }
  const spFoundRow = (a) => `<li class="t-${a.t}">${G(a.t)}<span>${esc(a.a)}</span><b>+${T[a.t].score}</b></li>`;
  /** Draws the card for the round's phase. Typing never comes through here: answers update the page in place. */
  function drawSprint() {
    const S = SPR, card = $("#sp-card");
    if (!S) return;
    if (!card) return renderSprintShell();
    window.scrollTo(0, 0);
    if (S.phase === "intro") card.innerHTML = `<div class="intro-card"><div><h2>Get ready</h2><p class="sub">${LIVE.n} ${LIVE.n === 1 ? "sprint" : "sprints"} of ${spMs() / 1000} s. Everyone gets the same prompt at the same moment. Each answer adds time to your clock, rarer ones more. Each sprint is revealed when every clock has run out.</p></div></div>`;
    else if (S.phase === "wait") card.innerHTML = `<div class="intro-card"><div><h2>Sprint ${S.i + 1} of ${LIVE.n}</h2><p class="sub">Starting together…</p></div></div>`;
    else if (S.phase === "away") card.innerHTML = `<div class="intro-card"><div><h2>You're back</h2><p class="sub">The next sprint starts in a moment.</p></div></div>`;
    else if (S.phase === "reveal") card.innerHTML = spRevealHtml(S.i);
    else {
      const playing = S.phase === "play", ended = S.phase === "ended";
      card.innerHTML = `<p class="sp-round">Sprint ${S.i + 1} of ${LIVE.n}</p>
        ${sprintAsk(S.p)}
        ${sprintTimer(ended ? 0 : spMs() / 1000, S.phase === "preview" ? "Starts in" : ended ? "Time" : "Time left", ended)}
        <div class="input-zone">
          <form class="answer-form" id="sp-form" autocomplete="off">
            <input class="answer-input" id="sp-answer" maxlength="${E.MAX_ANSWER_LENGTH}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Your answer" placeholder="Type an answer"${playing ? "" : " disabled"}>
            <button class="btn primary step-btn" id="sp-step" type="submit"${playing ? "" : " disabled"}>Step</button>
          </form>
          <div class="preview-veil${S.phase === "preview" ? "" : " hidden"}" id="sp-veil"><span>Read the prompt</span><b id="sp-veil-n">${Math.max(1, Math.ceil(((S.previewEndsAt || 0) - Date.now()) / 1000))}</b></div>
        </div>
        ${ended ? `<p class="lv-note" id="sp-wait" aria-live="polite"></p>` : ""}
        <div class="status" id="status" role="status" aria-live="polite"></div>
        <p class="sp-tally"><b id="sp-n">${S.found.length}</b> answers <b id="sp-pts">${S.pts}</b> points</p>
        <ol class="sp-found" id="sp-found">${S.found.slice().reverse().map(spFoundRow).join("")}</ol>`;
      $("#sp-form").addEventListener("submit", (e) => {
        e.preventDefault();
        if (S === SPR && S.phase === "play" && sprintSubmit(S, $("#sp-answer"))) liveSprintProgress();
      });
      if (ended) spWaitText();
      if (playing && !chatTyping()) $("#sp-answer").focus({ preventScroll: true });
    }
    liveSprintBoard();
  }
  /** The strip: every player's answers and points for this sprint, ticking up as they send them. */
  function liveSprintBoard() {
    const S = SPR, el = $("#sp-strip");
    if (!el || !S) return;
    const on = S.phase === "preview" || S.phase === "play" || S.phase === "ended";
    el.hidden = !on;
    if (!on) return;
    const ps = spPlayers();
    el.classList.toggle("many", ps.length > 4); // up to eight players: drop the avatars so the strip stays a row or two
    el.innerHTML = ps.map((pl) => {
      const me = pl.id === LIVE.myId, s = me ? { n: S.found.length, pts: S.pts } : spNow(pl, S.i);
      const key = `${s.n}/${s.pts}`, bump = S.shown[pl.id] !== undefined && S.shown[pl.id] !== key;
      S.shown[pl.id] = key;
      const left = LIVE.gone.has(pl.id);
      return `<span class="lp sp-lp${me ? " me" : ""}${bump ? " bump" : ""}${left || pl.away ? " off" : ""}" title="${esc(pl.name)}: ${s.n} ${s.n === 1 ? "answer" : "answers"}, ${s.pts} points${left ? ", left" : pl.away ? ", reconnecting" : ""}">${avatar(pl.name)}<b>${esc(pl.name)}</b><span class="sp-ct">${s.n}</span><em>${s.pts}</em></span>`;
    }).join("");
  }
  /** After your own clock ends: who hasn't sent a list yet. */
  function spWaitText() {
    const el = $("#sp-wait"), S = SPR;
    if (!el || !S) return;
    const left = inMatch().filter((p) => p.id !== LIVE.myId && !p.ans[S.i]);
    el.textContent = left.length ? `Time. Waiting for ${left.map((p) => p.name).join(", ")}…` : "Time. Everyone's in. Revealing…";
  }
  function spNextLine(S) {
    const last = S.i + 1 >= LIVE.n, left = S.nextAt ? Math.ceil((S.nextAt - hostNow()) / 1000) : 0;
    return `${last ? "Final standings" : `Sprint ${S.i + 2} of ${LIVE.n} starts`} ${left > 0 ? `in ${left} s` : "in a moment"}…`;
  }
  /** One round's players, best first, each with the answers they named; ×2 and up marks an answer more than one of them named. */
  function spRowsHtml(i) {
    const p = PROMPTS.get(LIVE.ids[i]), named = spNamed(i);
    const rows = spPlayers().filter((pl) => pl.ans[i]).sort((a, b) => b.ans[i].score - a.ans[i].score || a.name.localeCompare(b.name));
    return `<ul class="sp-players">${rows.map((pl) => {
      const a = pl.ans[i], gone = LIVE.gone.has(pl.id);
      return `<li class="${pl.id === LIVE.myId ? "me" : ""}${gone ? " gone" : ""}"><div class="sp-ph">${avatar(pl.name)}<span><b>${esc(pl.name)}</b><span class="sp-sub">${a.n} ${a.n === 1 ? "answer" : "answers"}${gone ? " · left" : ""}</span></span><em>${a.score}</em></div>
        ${a.list && a.list.length ? `<ul class="sp-chips">${a.list.map((x) => { const an = p.answers[x], k = named.get(x); return `<li class="t-${an.t}${k > 1 ? " shared" : ""}">${G(an.t)}<span>${esc(an.a)}</span>${k > 1 ? `<i title="Named by ${k} players">×${k}</i>` : ""}</li>`; }).join("")}</ul>`
          : `<p class="sp-sub">${a.list ? "No answers." : a.n ? "Their list never arrived. The points they sent still count." : "No answers."}</p>`}</li>`;
    }).join("")}</ul>`;
  }
  function spRevealHtml(i) {
    const p = PROMPTS.get(LIVE.ids[i]), S = SPR;
    const shared = [...spNamed(i).values()].filter((k) => k > 1).length;
    return `<div class="lv-reveal sp-reveal">
      <div><p class="sp-round">Sprint ${i + 1} of ${LIVE.n}</p><p class="fb-q">${esc(p.text)}</p></div>
      ${spRowsHtml(i)}
      ${shared ? `<p class="lv-note">${shared === 1 ? "One answer was" : `${shared} answers were`} named by more than one player. ×2 means two did.</p>` : ""}
      <ol class="lv-standings">${spPlayers().sort(rankCmp).map((pl) => `<li class="${pl.id === LIVE.myId ? "me" : ""}"><b>${esc(pl.name)}</b><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
      <p class="lv-note" id="sp-next">${spNextLine(S)}</p>
    </div>`;
  }

  // ---- the host
  function hostSprintRound(i) {
    const at = Date.now() + 1500;
    broadcast({ t: "spround", i, at });
    LIVE.spEnd = { i, at: at + E.PREVIEW_MS + spMs() }; // when a clock with no added time runs out
    liveLater(() => hostSprintCap(i), LIVE.spEnd.at + SP_GRACE_MS - Date.now());
  }
  /** Each clock ends its own list; this cap only covers a player who vanished. Answers add time, so the cap
   *  moves out to the longest clock a player still owing a list has reported. */
  function hostSprintCap(i) {
    if (LIVE.revealed >= i || !LIVE.spEnd || LIVE.spEnd.i !== i) return;
    const extra = Math.max(0, ...inMatch().filter((pl) => !pl.ans[i]).map((pl) => (pl.sp && pl.sp[i] && pl.sp[i].b) || 0));
    const due = LIVE.spEnd.at + extra + SP_GRACE_MS - Date.now();
    if (due > 50) liveLater(() => hostSprintCap(i), due);
    else hostReveal(i);
  }
  /** Progress from a player: checked, then passed on so every screen can show it. */
  function hostSprintProgress(id, m) {
    const pl = LIVE.players.get(id);
    if (LIVE.phase !== "playing" || !liveSprint() || !SPR || !pl || pl.late || m.i !== SPR.i || m.i <= LIVE.revealed) return;
    const n = Math.round(+m.n), pts = Math.round(+m.pts), b = Math.round(+m.b || 0);
    if (!spTallyOk(n, pts, b)) return;
    broadcast({ t: "spp", id, i: m.i, n, pts, b });
  }
  /** A player's finished list: only the first one for the round counts, and every index must be a real answer. */
  function hostSprintFinal(id, m) {
    const pl = LIVE.players.get(id);
    if (LIVE.phase !== "playing" || !liveSprint() || !SPR || !pl || pl.late || m.i !== SPR.i || m.i <= LIVE.revealed || pl.ans[m.i]) return;
    const list = spCleanList(SPR.p, m.list);
    if (!list) return;
    broadcast({ t: "spans", id, i: m.i, list });
    hostSprintCheck(m.i);
  }
  function hostSprintCheck(i) {
    const ps = inMatch();
    if (i > LIVE.revealed && ps.length && ps.every((p) => p.ans[i])) liveLater(() => hostReveal(i), 700);
  }
  function hostSprintReveal(i) {
    const all = spPlayers();
    const part = all.filter((p) => !p.ans[i] && p.sp && p.sp[i]).map((p) => ({ id: p.id, n: p.sp[i].n, pts: p.sp[i].pts }));
    const most = Math.max(0, ...all.map((p) => spNow(p, i).n));
    const hold = spRevealMs(most);
    broadcast({ t: "reveal", i, part, nextAt: Date.now() + hold });
    liveLater(() => liveSprintNext(i), hold);
  }
  function liveSprintNext(i) {
    if (i + 1 < LIVE.n) hostRound(i + 1);
    else { broadcast({ t: "end" }); LIVE.phase = "done"; broadcast(lobbyMsg()); }
  }
  /** The old host vanished: carry on from wherever this page last saw the match. */
  function hostSprintTakeover() {
    const S = SPR;
    if (!S) return;
    const i = S.i;
    if (LIVE.revealed >= i) return void liveLater(() => liveSprintNext(i), 1500);
    if (S.phase === "intro") return void liveLater(() => hostSprintRound(i), 1500); // the round was never announced
    hostSprintCheck(i);
    LIVE.spEnd = { i, at: S.endsAt ? S.endsAt - S.bonus : Date.now() + E.PREVIEW_MS + spMs() };
    hostSprintCap(i);
  }

  // ================================================================= quiz
  function renderQuizHub() {
    setMid("Quiz");
    const runs = Object.values(records).filter((r) => r.mode === "quiz").sort((a, b) => b.number - a.number);
    const next = nextQuiz();
    const inProg = LS.get(`run:quiz:${next}`);
    const avg = runs.length ? Math.round(runs.reduce((s, r) => s + r.score, 0) / runs.length) : 0;
    const best = runs.reduce((m, r) => Math.max(m, r.score), 0);
    app.innerHTML = `<section class="screen ${runs.length ? "split" : ""}">
      <div class="side">
        <div class="page-head"><h1>Quiz</h1><p>Seven hand-written questions a run, from easy to hard, four answers each, and a short explanation after every one. ${E.QUIZ_POINTS} a right answer.</p></div>
        ${(() => { const d = records[`dquiz:${today()}`]; return `<div class="dq-card"><p><b>Today's quiz</b><span>The same seven questions for everyone${BOARD_ON ? ", with a leaderboard" : ""}. They start easy and get harder as you go. Answer fast: a right answer is worth 100 within 3 s, down to 50 at the buzzer.</span></p>${d ? `<a class="btn big" href="#results-dquiz-${today()}">Your score · ${d.score}</a>` : `<a class="btn primary big" href="#daily-quiz">Play today's quiz</a>`}</div>`; })()}
        <h2 class="block-title dq-practice">Practice runs</h2>
        ${runs.length ? `<div class="figures"><div class="figure"><b>${runs.length}</b><span>Runs</span></div><div class="figure"><b>${avg}</b><span>Average</span></div><div class="figure"><b>${best}</b><span>Best</span></div></div>` : ""}
        <div class="btn-row"><a class="btn big" href="#quiz-${next}">${inProg ? `Resume run ${next}` : `Start run ${next}`}</a><a class="btn big" href="#challenge">Challenge a friend</a></div>
      </div>
      ${runs.length ? `<div class="main"><ul class="list">${runs.slice(0, 50).map((r) => `
        <li><a class="list-item" href="#results-${slugFor(r.key)}"><span class="main"><span class="title">Run ${r.number}</span><span class="sub">${qmarksRow(r.results.map((x) => x.score > 0))}</span></span><span class="right"><b>${r.score}</b></span></a></li>`).join("")}</ul></div>` : ""}
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
            <span class="row"><a class="btn sm" href="#practice-${p.id}">Play</a>${unlocked ? `<a class="btn sm" href="#answers-${p.id}">Key</a>` : `<span class="key-lock" title="Play it once to unlock the key" aria-label="Key locked">${LOCK}</span>`}</span>
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
  /** The daily quiz in numbers: days played, right answers on average, best, and the current run of days. */
  function quizSummary() {
    const recs = Object.values(records).filter((r) => r.mode === "dquiz" && r.date).sort((a, b) => a.date.localeCompare(b.date));
    const right = (r) => r.results.filter((x) => x.score > 0).length;
    const days = new Set(recs.map((r) => r.date));
    let cur = 0;
    for (let d = days.has(today()) ? today() : E.addDays(today(), -1); days.has(d); d = E.addDays(d, -1)) cur++;
    return {
      played: recs.length,
      avg: recs.length ? (recs.reduce((t, r) => t + right(r), 0) / recs.length).toFixed(1) : null,
      best: recs.length ? Math.max(...recs.map(right)) : null,
      cur,
    };
  }
  function renderStats() {
    setMid("Stats");
    const s = statsSummary(), q = quizSummary();
    const quizBlock = q.played ? `<section><h2 class="block-title">Daily quiz</h2><div class="stat-grid quiz-grid">${[["Played", q.played], ["Average", `${q.avg}/7`], ["Best", `${q.best}/7`], ["Streak", q.cur]].map(([l, v]) => `<div class="figure"><b>${v}</b><span>${l}</span></div>`).join("")}</div></section>` : "";
    const sp = Object.values(sprints), spRuns = sp.reduce((t, r) => t + (r.plays || 0), 0);
    const sprintBlock = sp.length ? `<section><h2 class="block-title">Sprint</h2><div class="stat-grid quiz-grid">${[["Runs", spRuns], ["Prompts", sp.length], ["Best", Math.max(...sp.map((r) => r.best))], ["Most answers", Math.max(...sp.map((r) => r.n || 0))]].map(([l, v]) => `<div class="figure"><b>${v}</b><span>${l}</span></div>`).join("")}</div></section>` : "";
    const tierMax = Math.max(1, ...Object.values(s.tierCounts));
    const bandMax = Math.max(1, ...s.bands.map((b) => b.n));
    const figs = [["Played", s.played], ["Average", s.avg || "—"], ["Best", s.best || "—"], ["Streak", s.cur], ["Max streak", s.max], ["Gems", s.gems]];
    if (!s.played && !s.allRuns) {
      app.innerHTML = `<section class="screen narrow"><div class="page-head"><h1>Stats</h1><p>Your streak, best score and tier counts start with your first daily. They stay in this browser.</p></div>
        <div class="btn-row"><a class="btn primary big" href="#daily">Play today's daily</a></div>${quizBlock}${sprintBlock}</section>`;
      return;
    }
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
        ${quizBlock}
        ${sprintBlock}
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
    const ways = [
      ["#unlimited-play", "Unlimited", "Endless prompts, no repeats. Stop whenever you like"],
      ["#quiz", "Quiz", "Four answers, one fits. A daily one too"],
      ["#sprint", "Sprint", "One prompt, 60 seconds, as many as you can"],
      ["#live", "Play with friends", "A live room (Classic, Quiz or Sprint), or a challenge link"],
    ];
    app.innerHTML = `<section class="screen narrow"><div class="page-head"><h1>How to play</h1></div>${howHtml()}
      <div class="btn-row"><a class="btn primary big" href="#daily">Play today</a><a class="btn big" href="#faq">FAQ</a></div>
      <section><h2 class="block-title">Other ways to play</h2><ul class="modes how-modes">${ways.map(([href, t, d]) => `<li><a href="${href}">${t}<span>${esc(d)}</span></a></li>`).join("")}</ul></section></section>`;
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
        <dd>No analytics. Runs, streaks and settings stay in this browser. Log in with Discord and only your daily score and the name you pick go to the leaderboard.</dd>
      </dl></section>`;
  }

  // ============================================================ settings
  function renderSettings() {
    setMid("Settings");
    const row = ([k, t, d]) => `
          <label class="setting" ${k === "aiCheck" ? `id="ai-setting" ${aiUsable() ? "" : "hidden"}` : ""}><span class="txt"><span class="t">${esc(t)}</span>${d ? `<span>${esc(d)}</span>` : ""}</span>
            <span class="switch"><input type="checkbox" role="switch" data-k="${k}" ${settings[k] ? "checked" : ""}><i></i></span></label>`;
    const group = (title, body) => `<section class="set-group"><h2>${title}</h2><div class="settings-list">${body}</div></section>`;
    const secs = validSecs(settings.answerSecs) ? settings.answerSecs : DEFAULT_SECS;
    app.innerHTML = `<section class="screen split">
      <div class="side"><div class="page-head"><h1>Settings</h1><p>Saved in this browser.</p></div></div>
      <div class="main set-groups">
        ${group("Playing", `
          <div class="setting time-setting"><span class="txt"><span class="t">Time per question</span><span>For your own runs. The daily, the daily quiz, rooms and challenges set their own clock.</span></span>
            <div class="vs-sizes" role="radiogroup" aria-label="Seconds per question">${TIME_PRESETS.map((k) => `<button type="button" class="vs-size t-size${k === secs ? " on" : ""}" role="radio" aria-checked="${k === secs}" data-s="${k}">${k} s</button>`).join("")}</div></div>
          ${[
            ["previewCorrections", "Confirm autocorrect", "Off: a close spelling counts at once"],
            ["clearRejected", "Clear wrong answers", "Empty the box after a miss"],
            ["extraQuestions", "Extra questions", `${EXTRA_COUNT} more outside the IOAI syllabus (tools, datasets, AI in pop culture) in your Unlimited, Quiz and Sprint runs`],
            ["aiCheck", "Ask Claude when nothing matches", "Uses your Claude usage. You confirm every match."],
          ].map(row).join("")}`)}
        ${group("Feel", [["sound", "Sound", ""], ...("vibrate" in navigator && matchMedia("(pointer: coarse)").matches ? [["haptics", "Vibration", "A short buzz with each verdict"]] : []), ["reducedMotion", "Reduce motion", "No rolling ball or camera moves"]].map(row).join(""))}
        ${group("Sharing", `
          <label class="setting name-setting"><span class="txt"><span class="t">Your name</span><span>Shown in rooms and on challenge links</span></span>
            <input class="search" id="set-name" maxlength="16" autocomplete="nickname" placeholder="Not set" value="${esc(myName())}"></label>
          ${row(["shareLink", "Add a link when sharing", "Results text ends with the site address"])}`)}
        <section class="set-group"><h2>Your data</h2><p class="muted">Runs, streaks and stats live in this browser. Export copies them so you can import them elsewhere.</p>
          <div class="btn-row"><button class="btn" id="exp">Export</button><button class="btn" id="imp">Import</button><button class="btn danger" id="reset">Reset all</button></div></section>
      </div>
    </section>`;
    $$("input[data-k]").forEach((i) => i.addEventListener("change", () => { settings[i.dataset.k] = i.checked; saveSettings(); }));
    wireTimePicker((secs) => { settings.answerSecs = secs; saveSettings(); toast(`${secs} s per question`); });
    $("#set-name").addEventListener("change", (e) => {
      const v = e.target.value.trim().slice(0, 16);
      if (v && !E.nameOk(v)) { e.target.value = myName(); return toast("That name isn't allowed. Pick another."); }
      e.target.value = v; LS.set("name", v);
      toast(v ? "Name saved" : "Name cleared");
    });
    $("#exp").addEventListener("click", async () => {
      const blob = JSON.stringify({ v: 1, records, seen: [...seen], practice: practiceBest, settings, sprints });
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
          for (const [pid, r] of Object.entries(d.sprints || {})) {
            if (r && typeof r.best === "number" && (!sprints[pid] || sprints[pid].best < r.best)) sprints[pid] = r;
          }
          LS.set("sprints", sprints);
          closeModal(); toast(`Imported ${n} run${n === 1 ? "" : "s"}`);
        } catch { toast("That doesn't look like MLion progress"); }
      });
    });
    $("#reset").addEventListener("click", () => {
      showModal("Reset all progress?", `<p class="muted">Every run, streak and stat in this browser goes. Your settings, name and login stay. Scores already on the leaderboard stay there. This can't be undone.</p>
        <div class="btn-row"><button class="btn" id="rs-no">Keep it</button><button class="btn danger" id="rs-yes">Delete everything</button></div>`);
      $("#rs-no").addEventListener("click", closeModal);
      $("#rs-yes").addEventListener("click", () => {
        // keeps settings, name, login and the game's config; this browser's progress starts again from now
        wipeLocal((k) => CFG_KEEP.has(k) || k === "mlion:name" || k.startsWith(SB_STORE));
        LS.set("since", new Date().toISOString());
        records = {}; seen = new Set(); practiceBest = {}; sprints = {};
        closeModal(); toast("All progress reset"); go("home");
      });
    });
  }

  // ========================================================= config + admin panel
  /** The admin's home banner, until this player closes that note. */
  function bannerHtml() {
    const b = CFG.banner;
    if (!b || LS.get("bannerSeen", "") === b) return "";
    return `<aside class="announce" id="announce" role="status"><p>${esc(b)}</p><button class="icon-btn" id="announce-x" aria-label="Close the note">${XICON}</button></aside>`;
  }
  /** Take a config row: cache it, set the launch day, and if an admin reset everyone, clear this browser. */
  function cfgUse(row) {
    if (!row || typeof row !== "object") return;
    const next = { launch: /^\d{4}-\d{2}-\d{2}$/.test(row.launch || "") ? row.launch : null, banner: String(row.banner || "").slice(0, 200), reset_at: row.reset_at || null };
    const changed = JSON.stringify(next) !== JSON.stringify({ launch: CFG.launch || null, banner: CFG.banner || "", reset_at: CFG.reset_at || null });
    CFG = next;
    LS.set("cfg", CFG);
    if (!changed) return;
    E.setLaunch(CFG.launch);
    const idleHome = !RUN && !LIVE.active && /^#?(home)?$/.test(location.hash);
    if (resetDue(CFG)) { // mid-game, it waits for the next visit (the cached row does it then)
      if (idleHome) { wipeLocal(); LS.set("since", new Date().toISOString()); location.reload(); }
      return;
    }
    if (idleHome) route(); // the day number and the banner
  }
  let cfgLoading = null;
  function cfgFetch() {
    if (!BOARD_ON || (navigator.webdriver && !window.MLION_BOARD)) return Promise.resolve(); // tests never read the live project's settings
    if (!cfgLoading) cfgLoading = fetch(`${BOARD_CFG.url}/rest/v1/app_config?select=launch,banner,reset_at&id=eq.1`, { headers: { apikey: BOARD_CFG.key }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => { if (Array.isArray(rows) && rows[0]) cfgUse(rows[0]); })
      .catch(() => { /* offline: the cached row stands */ })
      .finally(() => { cfgLoading = null; });
    return cfgLoading;
  }

  // #admin (user, 2026-11-05: "an admin panel I can use to do everything, easily and visually"). It works for
  // Discord accounts listed in public.admins; every call is checked by the database (supabase/admin.sql), so
  // this page guards nothing itself. Tabs: Overview, Players, Scores, Game (launch day, banner, reset).
  const ADMIN = { tab: "overview", day: "", kind: "daily", q: "" };
  async function checkAdmin() {
    try { const { data, error } = await sbClient.rpc("is_admin"); return !error && data === true; } catch { return false; }
  }
  async function adminCall(fn, args) {
    const { data, error } = await sbClient.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }
  const adminFail = (e) => toast(e && e.code === "42501" ? "Only admins can do that" : `That didn't work: ${(e && e.message) || "no connection"}`);
  const whenTs = (ts) => (ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "never");
  function agoTs(ts) {
    if (!ts) return "never";
    const m = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 60000));
    return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  }
  /** What a launch day means today, in words. */
  function launchWords(L) {
    const t = today();
    if (!L) return "Not launched yet: every day is MLion #1, from a warm-up set of prompts.";
    if (L > t) return `Launches ${prettyDate(L)}. Until then every day is MLion #1.`;
    return `Launched ${prettyDate(L)}. Today is MLion #${E.daysBetween(L, t) + 1}.`;
  }
  function renderAdmin() {
    setMid("Admin");
    const head = (p) => `<div class="page-head"><h1>Admin</h1><p>${p}</p></div>`;
    const page = (inner) => { app.innerHTML = `<section class="screen narrow admin">${inner}</section>`; };
    if (!BOARD_ON) return page(head("The admin panel needs the leaderboard's database, which this copy of the game doesn't use."));
    if (!AUTH.ready) return page(head("Checking your login…"));
    if (!AUTH.user) { page(head("Log in with the Discord account that runs MLion.") + loginButtons()); wireLogin(app); return; }
    if (!AUTH.admin) return page(head(`This page is for MLion's admins. You're logged in as ${esc((AUTH.profile && AUTH.profile.name) || "a player")}.`));
    const tabs = [["overview", "Overview"], ["players", "Players"], ["scores", "Scores"], ["game", "Game"]];
    page(`${head("Who plays, the leaderboards, the launch day and the home banner.")}
      <div class="adm-tabs" role="tablist" aria-label="Admin">${tabs.map(([k, l]) => `<button type="button" role="tab" class="adm-tab${ADMIN.tab === k ? " on" : ""}" aria-selected="${ADMIN.tab === k}" data-t="${k}">${l}</button>`).join("")}</div>
      <div id="adm-body" class="adm-body" role="tabpanel"><p class="muted">Loading…</p></div>`);
    $$(".adm-tab").forEach((b) => b.addEventListener("click", () => { ADMIN.tab = b.dataset.t; renderAdmin(); }));
    ({ overview: adminOverview, players: adminPlayers, scores: adminScores, game: adminGame })[ADMIN.tab]();
  }
  /** Run a loader into #adm-body; drop the result if the page moved on meanwhile. */
  async function adminLoad(fn, args, draw) {
    const body = $("#adm-body");
    let data;
    try { data = await adminCall(fn, args); } catch (e) { if (body.isConnected) body.innerHTML = `<p class="muted">Couldn't load this: ${esc((e && e.message) || "no connection")}.</p>`; return; }
    if (body.isConnected) draw(body, data);
  }

  function adminOverview() {
    adminLoad("admin_overview", {}, (body, o) => {
      const days = o.days || [], max = Math.max(1, ...days.map((d) => d.daily + d.quiz));
      const fig = (v, l) => `<div class="figure"><b>${v}</b><span>${l}</span></div>`;
      const top = (rows, quiz) => (rows && rows.length ? `<ol class="adm-top">${rows.map((r) => `<li><span>${esc(r.name)}</span><b>${r.score}</b>${quiz ? `<em>${(r.tenths / 10).toFixed(1)} s</em>` : ""}</li>`).join("")}</ol>` : `<p class="muted">No scores yet today.</p>`);
      body.innerHTML = `
        <p class="adm-launch">${esc(launchWords(CFG.launch))}</p>
        <div class="stat-grid adm-figs">${fig(o.players, "Players")}${fig(o.new_today, "Joined today")}${fig(o.new_week, "Joined this week")}${fig(o.daily_today, "Dailies today")}${fig(o.quiz_today, "Daily quizzes today")}</div>
        <section><h2 class="block-title">Last 14 days</h2>
          <div class="adm-chart" role="img" aria-label="Dailies and daily quizzes posted each day">${days.map((d) => `
            <div class="col" title="${esc(prettyDate(d.day))}: ${d.daily} dailies, ${d.quiz} quizzes, ${d.joined} joined"><b>${d.daily + d.quiz || ""}</b>
              <span class="stack"><i class="d" style="height:${(100 * d.daily / max).toFixed(1)}%"></i><i class="q" style="height:${(100 * d.quiz / max).toFixed(1)}%"></i></span>
              <em>${+d.day.slice(8)}</em></div>`).join("")}</div>
          <p class="adm-legend"><span class="d"></span>Dailies <span class="q"></span>Daily quizzes</p></section>
        <div class="adm-two">
          <section><h2 class="block-title">Today's daily</h2>${top(o.top_daily)}</section>
          <section><h2 class="block-title">Today's quiz</h2>${top(o.top_quiz, true)}</section>
        </div>`;
    });
  }

  function adminPlayers() {
    const body = $("#adm-body");
    body.innerHTML = `<form class="adm-bar" id="adm-q-form" role="search"><input class="search" id="adm-q" type="search" placeholder="Search by name" value="${esc(ADMIN.q)}" aria-label="Search players"><button class="btn" type="submit">Search</button></form><div id="adm-list"><p class="muted">Loading…</p></div>`;
    $("#adm-q-form").addEventListener("submit", (e) => { e.preventDefault(); ADMIN.q = $("#adm-q").value.trim(); adminPlayers(); });
    adminLoad("admin_players", { p_q: ADMIN.q, p_limit: 200 }, (b, rows) => {
      const list = $("#adm-list", b);
      list.innerHTML = rows.length ? `<p class="muted small">${rows.length === 200 ? "The newest 200" : rows.length} player${rows.length === 1 ? "" : "s"}${ADMIN.q ? ` matching “${esc(ADMIN.q)}”` : ""}</p>
        <ul class="adm-rows">${rows.map((r) => `<li data-id="${esc(r.id)}" data-name="${esc(r.name)}">
          <div class="who"><b>${esc(r.name)}</b>${r.admin ? `<span class="adm-tag">Admin</span>` : ""}${r.account && r.account !== r.name ? `<span class="muted">${esc(r.account)} on Discord</span>` : ""}</div>
          <p class="meta">Joined ${whenTs(r.created_at)} · ${r.daily} ${r.daily === 1 ? "daily" : "dailies"} · ${r.quiz} ${r.quiz === 1 ? "quiz" : "quizzes"}${r.best != null ? ` · best ${r.best}` : ""} · last login ${agoTs(r.last_seen)}</p>
          <div class="acts"><button type="button" class="btn sm" data-a="rename">Rename</button>${r.admin ? "" : `<button type="button" class="btn sm danger" data-a="delete">Delete</button>`}</div>
        </li>`).join("")}</ul>` : `<p class="muted">${ADMIN.q ? "No player matches that name." : "No players yet."}</p>`;
      $$(".adm-rows [data-a]", list).forEach((btn) => btn.addEventListener("click", () => {
        const li = btn.closest("li"), id = li.dataset.id, name = li.dataset.name;
        if (btn.dataset.a === "rename") {
          showModal(`Rename ${name}`, `<p class="muted">The name everyone sees on the leaderboards. Up to 16 characters.</p>
            <form id="adm-rn" class="vs-form"><input class="search" id="adm-rn-name" maxlength="16" value="${esc(name)}" aria-label="New name"><div class="btn-row"><button class="btn primary" type="submit">Save name</button></div></form>`);
          const inp = $("#adm-rn-name"); inp.focus(); inp.select();
          $("#adm-rn").addEventListener("submit", async (e) => {
            e.preventDefault();
            try { await adminCall("admin_rename", { p_user: id, p_name: inp.value.trim() }); closeModal(); toast("Name saved"); adminPlayers(); } catch (err) { adminFail(err); }
          });
        } else {
          showModal(`Delete ${name}?`, `<p class="muted">Their account, their name and every score they posted go. They can log in again later, as a new player. This can't be undone.</p>
            <div class="btn-row"><button class="btn" id="adm-keep">Keep them</button><button class="btn danger" id="adm-del">Delete player</button></div>`);
          $("#adm-keep").addEventListener("click", closeModal);
          $("#adm-del").addEventListener("click", async () => {
            try { await adminCall("admin_delete_player", { p_user: id }); closeModal(); toast(`${name} deleted`); adminPlayers(); } catch (err) { adminFail(err); }
          });
        }
      }));
    });
  }

  function adminScores() {
    const body = $("#adm-body"), day = ADMIN.day || today();
    body.innerHTML = `<div class="adm-bar"><input type="date" class="search adm-date" id="adm-day" value="${day}" max="${today()}" aria-label="Day">
      <div class="vs-sizes" role="radiogroup" aria-label="Board">${[["daily", "Daily"], ["quiz", "Daily quiz"]].map(([k, l]) => `<button type="button" class="vs-size adm-kind${ADMIN.kind === k ? " on" : ""}" role="radio" aria-checked="${ADMIN.kind === k}" data-k="${k}">${l}</button>`).join("")}</div></div>
      <div id="adm-list"><p class="muted">Loading…</p></div>`;
    $("#adm-day").addEventListener("change", (e) => { ADMIN.day = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : ""; adminScores(); });
    $$(".adm-kind").forEach((b) => b.addEventListener("click", () => { ADMIN.kind = b.dataset.k; adminScores(); }));
    const kind = ADMIN.kind;
    adminLoad("admin_scores", { p_day: day, p_kind: kind }, (b, rows) => {
      const list = $("#adm-list", b);
      const detail = (r) => (kind === "quiz"
        ? `<span class="adm-marks">${[...String(r.detail || "")].map((c) => (c === "1" ? "●" : "○")).join("")}</span> ${((r.tenths || 0) / 10).toFixed(1)} s`
        : `<span class="adm-tiers">${decTiers(String(r.detail || "")).map((t) => G(t === "miss" ? null : t)).join("")}</span>`);
      list.innerHTML = rows.length ? `<p class="muted small">${rows.length} ${kind === "quiz" ? "quiz" : "daily"} score${rows.length === 1 ? "" : "s"} on ${esc(prettyDate(day))}</p>
        <ol class="adm-rows scores">${rows.map((r, i) => `<li data-id="${esc(r.user_id)}" data-name="${esc(r.name)}">
          <span class="rank">${i + 1}</span><div class="who"><b>${esc(r.name)}</b><span class="muted">${detail(r)}</span></div><b class="pts">${r.score}</b>
          <div class="acts"><button type="button" class="btn sm danger" data-a="remove">Remove</button></div></li>`).join("")}</ol>`
        : `<p class="muted">No ${kind === "quiz" ? "quiz" : "daily"} scores on ${esc(prettyDate(day))}.</p>`;
      $$(".adm-rows [data-a=remove]", list).forEach((btn) => btn.addEventListener("click", () => {
        const li = btn.closest("li"), name = li.dataset.name;
        showModal(`Remove ${name}'s score?`, `<p class="muted">It leaves the ${esc(prettyDate(day))} ${kind === "quiz" ? "quiz" : "daily"} board. ${esc(name)} keeps their account. This can't be undone.</p>
          <div class="btn-row"><button class="btn" id="adm-keep">Keep it</button><button class="btn danger" id="adm-rm">Remove score</button></div>`);
        $("#adm-keep").addEventListener("click", closeModal);
        $("#adm-rm").addEventListener("click", async () => {
          try { await adminCall("admin_remove_score", { p_kind: kind, p_user: li.dataset.id, p_day: day }); closeModal(); toast("Score removed"); adminScores(); } catch (err) { adminFail(err); }
        });
      }));
    });
  }

  async function adminGame() {
    await cfgFetch(); // show the settings as they are now, not as this browser last saw them
    const body = $("#adm-body");
    if (!body || ADMIN.tab !== "game") return;
    const L = CFG.launch || "";
    body.innerHTML = `
      <section class="adm-card"><h2 class="block-title">Launch day</h2>
        <p class="adm-launch" id="adm-launch-now">${esc(launchWords(L))}</p>
        <div class="adm-bar"><input type="date" class="search adm-date" id="adm-launch" value="${L}" aria-label="Launch day">
          <button type="button" class="btn sm" data-d="0">Today</button><button type="button" class="btn sm" data-d="1">Tomorrow</button></div>
        <p class="muted small" id="adm-launch-preview"></p>
        <div class="btn-row"><button type="button" class="btn primary" id="adm-launch-save">Save launch day</button>${L ? `<button type="button" class="btn" id="adm-launch-clear">Back to not launched</button>` : ""}</div>
        <p class="muted small">MLion #1 is the launch day's daily, and the seven hand-picked launch days play in order from there. Changing the day renumbers every daily for everyone, so set it once.</p>
      </section>
      <section class="adm-card"><h2 class="block-title">Home banner</h2>
        <p class="muted small">A short note at the top of everyone's home page. Up to 200 characters. A new note shows again to players who closed the last one.</p>
        <textarea class="search area" id="adm-banner" maxlength="200" aria-label="Banner text">${esc(CFG.banner || "")}</textarea>
        <div class="btn-row"><button type="button" class="btn primary" id="adm-banner-save">Show banner</button>${CFG.banner ? `<button type="button" class="btn" id="adm-banner-clear">Remove banner</button>` : ""}</div>
      </section>
      <section class="adm-card adm-danger"><h2 class="block-title">Reset all players</h2>
        <p>Deletes every daily and quiz score and every player account except admins. Everyone's saved progress on their own devices clears the next time they open MLion; settings stay. This can't be undone.</p>
        <div class="adm-bar"><input class="search" id="adm-reset-word" placeholder="Type RESET" autocomplete="off" spellcheck="false" aria-label="Type RESET to confirm"><button type="button" class="btn danger" id="adm-reset" disabled>Reset everyone</button></div>
      </section>`;
    const inp = $("#adm-launch");
    const preview = () => { $("#adm-launch-preview").textContent = inp.value && inp.value !== L ? `After saving: ${launchWords(inp.value)}` : ""; };
    inp.addEventListener("input", preview);
    $$("[data-d]", body).forEach((b) => b.addEventListener("click", () => { inp.value = E.addDays(today(), +b.dataset.d); preview(); }));
    const saveLaunch = async (v) => {
      try { cfgUse(await adminCall("admin_set_launch", { p_launch: v || null })); toast(v ? `Launch day saved. ${launchWords(v).split(". ")[1] || ""}` : "Back to not launched"); adminGame(); } catch (err) { adminFail(err); }
    };
    $("#adm-launch-save").addEventListener("click", () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return toast("Pick a day first");
      saveLaunch(inp.value);
    });
    if ($("#adm-launch-clear")) $("#adm-launch-clear").addEventListener("click", () => saveLaunch(null));
    const saveBanner = async (text) => {
      try { cfgUse(await adminCall("admin_set_banner", { p_text: text })); LS.del("bannerSeen"); toast(text ? "Banner is up" : "Banner removed"); adminGame(); } catch (err) { adminFail(err); }
    };
    $("#adm-banner-save").addEventListener("click", () => { const t = $("#adm-banner").value.trim(); if (!t) return toast("Write the note first"); saveBanner(t); });
    if ($("#adm-banner-clear")) $("#adm-banner-clear").addEventListener("click", () => saveBanner(""));
    const word = $("#adm-reset-word"), go = $("#adm-reset");
    word.addEventListener("input", () => { go.disabled = word.value.trim() !== "RESET"; });
    go.addEventListener("click", async () => {
      go.disabled = true;
      let r;
      try { r = await adminCall("admin_reset_all", { p_confirm: "RESET" }); } catch (err) { go.disabled = false; return adminFail(err); }
      // This device clears too, but keeps your login, and counts as starting after the reset
      wipeLocal((k) => CFG_KEEP.has(k) || k.startsWith(SB_STORE));
      LS.set("since", new Date(Math.max(Date.now(), Date.parse(r.reset_at) + 1000)).toISOString());
      records = {}; seen = new Set(); practiceBest = {}; sprints = {};
      cfgUse({ ...CFG, reset_at: r.reset_at });
      showModal("Everyone is reset", `<p>Removed ${r.players} player${r.players === 1 ? "" : "s"}, ${r.daily} daily score${r.daily === 1 ? "" : "s"} and ${r.quiz} quiz score${r.quiz === 1 ? "" : "s"}. Admin accounts stay.</p>
        <p class="muted">Each player's device clears their saved progress the next time they open MLion.</p>
        <div class="btn-row"><button class="btn primary" id="adm-done">Done</button></div>`);
      $("#adm-done").addEventListener("click", closeModal);
      adminGame();
    });
  }

  // ======================================================= drawer/modal
  function openDrawer() {
    document.body.classList.add("drawer-open");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#menu-btn").setAttribute("aria-expanded", "true");
    const first = $("#drawer a.nav.on") || $("#drawer a.nav");
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }
  /** giveBack: return focus to the menu button (Escape, the close button, the backdrop). */
  function closeDrawer(giveBack = false) {
    if (!document.body.classList.contains("drawer-open")) return;
    const inside = $("#drawer").contains(document.activeElement);
    document.body.classList.remove("drawer-open");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#menu-btn").setAttribute("aria-expanded", "false");
    if (inside) { if (giveBack) $("#menu-btn").focus({ preventScroll: true }); else document.activeElement.blur(); }
  }
  let modalOpener = null;
  function showModal(title, html) {
    const m = $("#modal");
    if (!m.innerHTML) modalOpener = document.activeElement;
    m.innerHTML = `<div class="modal-backdrop" id="mb"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" id="mclose" aria-label="Close">${XICON}</button></div>${html}</div></div>`;
    $("#mclose").addEventListener("click", closeModal);
    $("#mb").addEventListener("click", (e) => { if (e.target.id === "mb") closeModal(); });
    $("#mclose").focus();
  }
  function closeModal() {
    if (!$("#modal").innerHTML) return;
    $("#modal").innerHTML = "";
    if (modalOpener && modalOpener.isConnected && modalOpener !== document.body) modalOpener.focus({ preventScroll: true });
    modalOpener = null;
  }
  function showHowModal() {
    showModal("How to play", howHtml() + `<div class="btn-row"><button class="btn primary big block" id="how-go">Got it</button></div>`);
    $("#how-go").addEventListener("click", closeModal);
    $("#how-go").focus();
  }

  // An installable app that opens offline: the service worker runs on the live site (https),
  // or anywhere once mlion:sw is set (the offline test does that on localhost).
  if ("serviceWorker" in navigator && (location.protocol === "https:" || LS.get("sw"))) {
    addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* private mode, or blocked */ }); });
  }
  let installEvt = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#install").hidden = false; });
  addEventListener("appinstalled", () => { installEvt = null; $("#install").hidden = true; });
  $("#install").addEventListener("click", async () => {
    if (!installEvt) return;
    closeDrawer();
    installEvt.prompt();
    try { await installEvt.userChoice; } catch { /* dismissed */ }
    installEvt = null; $("#install").hidden = true;
  });

  $("#menu-btn").addEventListener("click", openDrawer);
  $("#drawer-backdrop").addEventListener("click", () => closeDrawer(true));
  $("#drawer-close").addEventListener("click", () => closeDrawer(true));
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
  // every answer key in the game, so a real answer from elsewhere is offered, never auto-corrected
  (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(() => E.setLexicon(DATA.prompts.concat(EXTRAS)));
  if (!BOARD_ON) $$('#drawer a[href="#board"]').forEach((a) => a.remove());
  boardBoot();
  cfgFetch();
  route();
})();
