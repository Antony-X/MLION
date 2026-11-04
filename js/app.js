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
  const XICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  // ---- quiz marks: a right answer in a quiz run carries one neutral tier, only to colour the
  // descent; it says nothing about rarity (every right answer scores the same 100).
  const QUIZ_TIER = "indist";
  const isQuizMode = (m) => m === "quiz" || m === "vq";
  /** "a loss function": what a prompt asks for, for labelling a wrong option by where it belongs. */
  const kindOf = (id) => { const p = PROMPTS.get(id); return p ? p.text.replace(/^Name\s+/i, "") : "something else"; };
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
  const DEFAULTS = { previewCorrections: true, clearRejected: false, sound: true, reducedMotion: sysReduced, shareLink: true, aiCheck: true, answerSecs: 25 };
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
      chat() { tone(988, 0.07, { vol: 0.03 }); tone(1319, 0.1, { vol: 0.03, delay: 0.07 }); },
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
  function nextQuiz() { let n = 1; while (records[`quiz:${n}`]) n++; return n; }
  function quizSpec(n) {
    const quiz = E.quizRun(DATA, n);
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
  function qPicker(n) {
    const custom = !Q_PRESETS.includes(n);
    return `<div class="vs-field"><span>Questions</span><div class="vs-sizes" role="radiogroup" aria-label="Number of questions">${Q_PRESETS.map((k) => `<button type="button" class="vs-size q-size${k === n ? " on" : ""}" role="radio" aria-checked="${k === n}" data-n="${k}">${k}</button>`).join("")}
      <input class="q-custom${custom ? " on" : ""}" id="q-custom" type="number" inputmode="numeric" min="1" max="${Q_MAX}" step="1" placeholder="1–${Q_MAX}" aria-label="Custom number of questions, 1 to ${Q_MAX}" value="${custom ? n : ""}"></div></div>`;
  }
  /** Wire a qPicker: onPick(n) gets a valid count; a bad custom entry snaps back to the current one. */
  function wireQPicker(cur, onPick) {
    $$(".q-size").forEach((b) => b.addEventListener("click", () => onPick(+b.dataset.n)));
    const box = $("#q-custom");
    if (!box) return;
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") box.blur(); });
    box.addEventListener("change", () => {
      const v = Math.round(+box.value);
      if (box.value !== "" && validQ(v)) return onPick(v);
      if (box.value !== "") toast(`Pick 1 to ${Q_MAX} questions`);
      box.value = Q_PRESETS.includes(cur()) ? "" : String(cur());
    });
  }
  // Seconds to answer each question: a personal setting for solo runs, the host's
  // choice in live rooms, carried inside challenge links so both players match.
  const TIME_PRESETS = [10, 15, 25, 40, 60];
  const DEFAULT_SECS = E.ANSWER_MS / 1000;
  const validSecs = (x) => TIME_PRESETS.includes(x);
  const answerMs = () => (RUN && RUN.answerMs) || E.ANSWER_MS; // runs saved before this setting existed get 25 s
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
  function challengePromptIds(seed, n) { return E.makeStream(DATA, `vs-${seed}`).take(n); }
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
  const quizChallengeQuiz = (seed, n) => E.quizFor(DATA, `vq-${seed}`, n);
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
  const LIVE = { active: false, code: "", isHost: false, client: null, conns: new Map(), myId: "",
    players: new Map(), n: 7, seed: "", phase: "lobby", revealed: -1, timers: [], intervals: [], status: "",
    fmt: "rarity", mfmt: "rarity", quiz: null }; // fmt: the lobby's choice; mfmt and quiz: the running match's format and questions
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
    const c = LIVE.client;
    if (c) {
      try { if (LIVE.isHost && !LIVE.quietLeave) pubJSON(c, `${roomTopic(LIVE.code)}/down`, { t: "closed", ep: LIVE.ep || 0 }); } catch { /* ignore */ }
      try { if (LIVE.isHost && LIVE.isPublic) c.publish(infoTopic(LIVE.code), "", { retain: true, qos: 1 }); } catch { /* ignore */ }
      setTimeout(() => { try { c.end(true); } catch { /* ignore */ } }, 300);
    }
    Object.assign(LIVE, { active: false, code: "", isHost: false, isPublic: false, flash: "", ep: 0, offset: null, countdownAt: 0, client: null, conns: new Map(), myId: "",
      players: new Map(), seed: "", ids: [], phase: "lobby", revealed: -1, status: "", skip: null, fmt: "rarity", mfmt: "rarity", quiz: null });
    chatRate.clear();
    syncChat();
  }
  function leaveLive(quiet) {
    LIVE.quietLeave = quiet !== false;
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
  const roundPts = (pl, i) => (pl.ans[i] ? pl.ans[i].score : 0);
  const liveQuiz = () => LIVE.mfmt === "quiz";
  // quiz matches keep each verdict back until the reveal, so a total counts revealed rounds only
  const shownTotal = (pl) => { let s = 0; for (const k in pl.ans) if (!liveQuiz() || +k <= LIVE.revealed) s += roundPts(pl, +k); return s; };
  /** A player's whole answer time in a quiz match; a question they never answered counts as the full clock. */
  const liveTotalMs = (pl) => { let s = 0; for (let k = 0; k < LIVE.n; k++) s += pl.ans[k] ? pl.ans[k].ms : (LIVE.secs || DEFAULT_SECS) * 1000; return s; };
  /** Standing order: points, then (quiz) the faster total time. */
  const rankCmp = (a, b) => shownTotal(b) - shownTotal(a) || (liveQuiz() ? liveTotalMs(a) - liveTotalMs(b) : 0);
  const hostNow = () => Date.now() + (LIVE.isHost ? 0 : LIVE.offset || 0); // clocks synced to the host

  // ---- messages: everyone (host included) applies the same events
  function apply(m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "lobby" && Array.isArray(m.players)) {
      const before = new Set(LIVE.players.keys());
      const next = new Map();
      for (const p of m.players.slice(0, 12)) {
        if (!p || typeof p.id !== "string") continue;
        // Update the existing object in place: the host's grace timer and last-seen time
        // live on it, and a fresh copy would let a stale timer free a seat its owner came back to.
        const old = LIVE.players.get(p.id);
        next.set(p.id, Object.assign(old || { ans: {}, typing: null }, { id: p.id, name: cleanName(p.name) || "Player", host: !!p.host, late: !!p.late, away: !!p.away, ready: !!p.ready }));
        if (!before.has(p.id) && p.id !== LIVE.myId && before.size) {
          LIVE.flash = `${cleanName(p.name) || "Someone"} joined`;
          toast(LIVE.flash); Sound.tier("mlion");
          try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch { /* ignore */ }
          setTimeout(() => { LIVE.flash = ""; const b = $("#lv-banner"); if (b) b.remove(); }, 6000);
        }
      }
      for (const id of before) if (!next.has(id) && LIVE.players.get(id)) toast(`${LIVE.players.get(id).name} left`);
      LIVE.players = next;
      if (validQ(+m.n)) LIVE.n = +m.n;
      if (validSecs(+m.secs)) LIVE.secs = +m.secs;
      if (!LIVE.isHost) LIVE.isPublic = !!m.pub;
      if (["off", "typos", "full"].includes(m.assist)) LIVE.assist = m.assist;
      if (["rarity", "quiz"].includes(m.fmt) && LIVE.phase !== "playing") LIVE.fmt = m.fmt;
      if (LIVE.phase === "lobby" || LIVE.phase === "done") (LIVE.phase === "done" ? renderPodium : renderLobby)();
      else renderStrip();
    } else if (m.t === "start" && /^[a-z0-9]{4,12}$/.test(m.seed) && validQ(+m.n)) {
      LIVE.seed = m.seed; LIVE.n = +m.n; LIVE.phase = "playing"; LIVE.revealed = -1; LIVE.countdownAt = 0;
      for (const pl of LIVE.players.values()) { pl.ans = {}; pl.late = false; pl.ready = false; pl.typing = null; }
      stopRun();
      // a quiz match: every page builds the same questions from the room's seed and the host's prompt list
      const quiz = m.fmt === "quiz" ? E.quizFor(DATA, m.seed, LIVE.n, { promptIds: Array.isArray(m.ids) ? m.ids.filter((id) => PROMPTS.has(id)) : [] }) : null;
      if (quiz) LIVE.n = quiz.length;
      LIVE.mfmt = quiz ? "quiz" : "rarity"; LIVE.quiz = quiz;
      RUN = { key: `live:${m.seed}`, mode: "live", number: 0, label: "Live match", seed: m.seed, n: LIVE.n,
        assist: ["off", "typos", "full"].includes(m.assist) ? m.assist : "typos",
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
        RUN.results.push({ promptId: p.id, promptText: p.text, raw: null, answer: null, tier: null, score: 0, quip: null, corrected: false, timeout: true, ...(RUN.fmt === "quiz" ? { picked: -1, correct: RUN.quiz[RUN.results.length].correct, ms: answerMs() } : {}) });
      }
      RUN.round = m.i;
      const go1 = () => { if (RUN && RUN.mode === "live" && RUN.round === m.i) { startRound(); renderStrip(); } };
      const wait = Number.isFinite(+m.at) ? Math.min(3000, Math.max(0, +m.at - hostNow())) : 0;
      if ($("#card")) $("#card").innerHTML = `<div class="intro-card"><div><h2>Question ${m.i + 1} of ${RUN.promptIds.length}</h2><p class="sub">Starting together…</p></div></div>`;
      renderStrip();
      setTimeout(go1, wait);
    } else if (m.t === "ans" && typeof m.id === "string" && Number.isInteger(m.i)) {
      const pl = LIVE.players.get(m.id);
      if (!pl || pl.ans[m.i]) return;
      if (liveQuiz()) { // the pick is an index into the options every page built from the same seed; correctness is recomputed here
        const q = LIVE.quiz && LIVE.quiz[m.i];
        if (!q || !Number.isInteger(m.pick) || m.pick < -1 || m.pick >= E.QUIZ_OPTIONS) return;
        const ok = m.pick >= 0 && m.pick === q.correct;
        const ms = Math.max(0, Math.min(Math.round(+m.ms) || 0, (LIVE.secs || DEFAULT_SECS) * 1000));
        pl.ans[m.i] = { pick: m.pick, ok, ms, answer: m.pick >= 0 ? q.options[m.pick] : null, tier: ok ? QUIZ_TIER : null, score: ok ? E.QUIZ_POINTS : 0 };
        renderStrip();
        renderLiveWait();
        if (LIVE.revealed >= m.i) renderReveal(m.i);
        return;
      }
      const tier = T[m.tier] ? m.tier : null;
      pl.ans[m.i] = { answer: tier ? String(m.answer || "").slice(0, 80) : null, tier, score: tier ? T[tier].score : 0 };
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
      updateHead();
      if ($("#card")) $("#card").innerHTML = `<div class="intro-card"><div><h2>Skipped</h2><p class="sub">A new question is on its way…</p></div></div>`;
      renderStrip();
      toast("Question skipped");
    } else if (m.t === "reveal" && Number.isInteger(m.i)) {
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
  function lobbyMsg() {
    return { t: "lobby", n: LIVE.n, secs: LIVE.secs || DEFAULT_SECS, assist: LIVE.assist || "typos", fmt: LIVE.fmt || "rarity", phase: LIVE.phase, pub: !!LIVE.isPublic, players: playerList().map((p) => ({ id: p.id, name: p.name, host: p.host, late: !!p.late, away: !!p.away, ready: !!p.ready })) };
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
    }
  }
  function hostAnswer(id, m) {
    if (LIVE.phase !== "playing" || !Number.isInteger(m.i) || m.i <= LIVE.revealed) return;
    if (m.pid && RUN && RUN.mode === "live" && RUN.promptIds[m.i] !== m.pid) return; // answered a question that was skipped
    if (liveQuiz()) { // the host decides what counts: a real option index (or none), a time inside the clock
      if (!LIVE.quiz || !LIVE.quiz[m.i] || !Number.isInteger(m.pick) || m.pick < -1 || m.pick >= E.QUIZ_OPTIONS) return;
      const ms = Math.max(0, Math.min(Math.round(+m.ms) || 0, (LIVE.secs || DEFAULT_SECS) * 1000));
      broadcast({ t: "ans", id, i: m.i, pick: m.pick, ms });
    } else broadcast({ t: "ans", id, i: m.i, answer: m.answer, tier: m.tier });
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
    let ids = challengePromptIds(seed, LIVE.n);
    let fresh = [];
    const used = new Set(LS.get("liveUsed", []));
    if (LIVE.noRepeat !== false) {
      fresh = E.shuffled(DATA.prompts.map((p) => p.id).filter((id) => !used.has(id)), E.mulberry32(E.hashString(seed)));
      if (fresh.length >= LIVE.n) ids = fresh.slice(0, LIVE.n);
    }
    if (LIVE.fmt === "quiz") { // the host fixes which prompts get a question, so every page builds the same ones
      const quiz = E.quizFor(DATA, seed, LIVE.n, { promptIds: fresh.length >= LIVE.n ? fresh : ids });
      if (!quiz.length) { LIVE.phase = "lobby"; toast("This question set can't make a quiz"); return; }
      ids = quiz.map((q) => q.promptId);
      LIVE.n = ids.length;
    }
    if (LIVE.noRepeat !== false) LS.set("liveUsed", fresh.length >= LIVE.n ? [...used, ...ids].slice(-400) : ids);
    broadcast({ t: "start", seed, n: LIVE.n, secs: LIVE.secs || DEFAULT_SECS, ids, assist: LIVE.assist || "typos", fmt: LIVE.fmt === "quiz" ? "quiz" : "rarity" });
    broadcast(lobbyMsg());
    liveLater(() => hostRound(0), 1800);
  }
  function hostRound(i) {
    broadcast({ t: "round", i, at: Date.now() + 1500 });
    // nobody moves on until everyone has answered; this cap only covers a player who vanished
    liveLater(() => hostReveal(i), 1500 + E.PREVIEW_MS + (LIVE.secs || DEFAULT_SECS) * 1000 + 12000);
  }
  function hostReveal(i) {
    if (LIVE.revealed >= i || LIVE.phase !== "playing") return;
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
    const pool = DATA.prompts.map((p) => p.id).filter((id) => !inMatchIds.has(id));
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
    const m = { t: "ans", i: RUN.round, pid: RUN.promptIds[RUN.round], answer: res.answer, tier: res.tier };
    if (RUN.fmt === "quiz") Object.assign(m, { pick: res.picked, ms: res.ms });
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
      if (m.hid && m.hid !== LIVE.myId && (+m.ep || 0) > (LIVE.ep || 0)) {
        const code = LIVE.code, me = LIVE.players.get(LIVE.myId), name = me ? me.name : myName();
        const keepId = LIVE.myId;
        toast("Reconnected. Your friend is hosting now");
        leaveLive(true);
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
    if (LIVE.phase === "playing" && RUN && RUN.mode === "live") {
      const i = RUN.round;
      if (LIVE.revealed >= i) liveLater(() => { if (i + 1 < LIVE.n) hostRound(i + 1); else { broadcast({ t: "end" }); LIVE.phase = "done"; broadcast(lobbyMsg()); } }, 1500);
      else { hostCheckRound(); liveLater(() => hostReveal(i), E.PREVIEW_MS + (LIVE.secs || DEFAULT_SECS) * 1000 + 8000); }
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
        Object.assign(LIVE, { active: true, code, isHost: false, isPublic: !!isPublic, client, myId: id, phase: "lobby", ep: 0, noRepeat: LS.get("liveNoRepeat", true) !== false, secs: validSecs(LS.get("liveSecs", DEFAULT_SECS)) ? LS.get("liveSecs", DEFAULT_SECS) : DEFAULT_SECS, fmt: LS.get("liveFmt", "rarity") === "quiz" ? "quiz" : "rarity" });
        LIVE.players.set(id, { id, name, host: true, ans: {}, seen: Date.now() });
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
      if (d.t === "full") { leaveLive(); return renderLiveStatus("That room is full. Duo rooms take 2 players.", true); }
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
        if (RUN && RUN.mode === "live") {
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
  function renderLobby() {
    if (!LIVE.active) return;
    const typingN = document.activeElement && document.activeElement.id === "q-custom" ? document.activeElement.value : null;
    setMid(`Room ${LIVE.code}`);
    const ps = playerList();
    const host = ps.find((p) => p.host);
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Room <span class="lv-code">${esc(LIVE.code)}</span></h1>
        <p>${LIVE.isPublic ? "Public duo room · listed in Public rooms. " : ""}${ps.length < 2 ? "Waiting for someone to join…" : `${ps.length} players here.`}</p>
        ${LIVE.isHost ? `<p class="lv-note">Keep MLion open while friends join. If you switch apps, come back here and the room reconnects.</p>` : ""}</div>
      ${LIVE.flash ? `<div class="lv-banner" id="lv-banner" role="alert">${esc(LIVE.flash)}</div>` : ""}
      <div class="btn-row"><button class="btn ${ps.length < 2 ? "primary " : ""}big" id="live-invite">Invite friends</button><a class="btn big" href="#rooms" id="live-leave-lobby">Leave</a></div>
      <ul class="lv-players" aria-live="polite">${ps.map((p) => `<li class="${p.id === LIVE.myId ? "me" : ""}">${avatar(p.name)}<b>${esc(p.name)}</b><span>${p.away ? "Reconnecting…" : `${p.ready ? "Ready ✓" : "Not ready"}${p.id === LIVE.myId ? " · You" : ""}`}</span></li>`).join("")}
        ${ps.length < 2 ? `<li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Waiting for a friend…</span></li>` : ""}</ul>
      ${LIVE.isHost ? `<div class="vs-form">
        <div class="vs-field"><span>Format</span><div class="vs-sizes" role="radiogroup" aria-label="Format">${[["rarity", "Rarity"], ["quiz", "Quiz"]].map(([k, l]) => `<button type="button" class="vs-size lv-fmt${(LIVE.fmt || "rarity") === k ? " on" : ""}" role="radio" aria-checked="${(LIVE.fmt || "rarity") === k}" data-f="${k}">${l}</button>`).join("")}</div></div>
        ${LIVE.fmt === "quiz" ? "" : `<div class="vs-field"><span>Autocorrect help</span><div class="vs-sizes" role="radiogroup" aria-label="Autocorrect help">${[["off", "Off"], ["typos", "Typos only"], ["full", "Full"]].map(([k, l]) => `<button type="button" class="vs-size lv-assist${(LIVE.assist || "typos") === k ? " on" : ""}" role="radio" aria-checked="${(LIVE.assist || "typos") === k}" data-a="${k}">${l}</button>`).join("")}</div></div>`}
        <label class="lv-check"><input type="checkbox" id="live-norepeat" ${LIVE.noRepeat !== false ? "checked" : ""}><span>No repeat questions across matches</span></label>
        ${qPicker(LIVE.n)}
        ${timePicker(LIVE.secs || DEFAULT_SECS)}
      </div>` : `<p class="lv-note">${esc(host ? host.name : "The host")} picks the settings. ${LIVE.n} ${LIVE.n === 1 ? "question" : "questions"} · ${LIVE.secs || DEFAULT_SECS} s each · ${LIVE.fmt === "quiz" ? "Quiz format, pick one of four." : `autocorrect ${({ off: "off", typos: "typos only", full: "full" })[LIVE.assist || "typos"]}. Rarity format.`}</p>`}
      ${readyBlock("Ready")}
    </section>`;
    $("#live-invite").addEventListener("click", () => shareLink(`Play MLion live with me. Room ${LIVE.code}:\n${(SHARE_BASE ? WEB_URL : siteUrl() || WEB_URL)}#${liveHash()}`));
    wireQPicker(() => LIVE.n, (n) => { LIVE.n = n; broadcast(lobbyMsg()); });
    wireTimePicker((secs) => { LIVE.secs = secs; LS.set("liveSecs", secs); broadcast(lobbyMsg()); });
    const ll = $("#live-leave-lobby");
    if (ll) ll.addEventListener("click", () => leaveLive(false));
    $$(".lv-assist").forEach((b) => b.addEventListener("click", () => { LIVE.assist = b.dataset.a; broadcast(lobbyMsg()); }));
    $$(".lv-fmt").forEach((b) => b.addEventListener("click", () => { LIVE.fmt = b.dataset.f; LS.set("liveFmt", LIVE.fmt); broadcast(lobbyMsg()); }));
    if (typingN !== null && $("#q-custom")) { const box = $("#q-custom"); box.value = typingN; box.focus(); }
    const nr = $("#live-norepeat");
    if (nr) nr.addEventListener("change", () => { LIVE.noRepeat = nr.checked; LS.set("liveNoRepeat", nr.checked); });
    wireReady();
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
        return `<li class="t-${tierOf(a && a.tier)}${pl.id === LIVE.myId ? " me" : ""}">${avatar(pl.name)}<span><b>${esc(pl.name)}</b><span class="la">${a && a.answer ? esc(a.answer) : "No answer"}</span>${x ? `<span class="lx">${esc(x)}</span>` : ""}</span>${G(a && a.tier)}<em>+${roundPts(pl, i)}</em></li>`;
      }).join("")}</ul>
      <ol class="lv-standings">${standings.map((pl) => `<li class="${pl.id === LIVE.myId ? "me" : ""}"><b>${esc(pl.name)}</b><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
      <p class="lv-note">${last ? "Final standings coming up…" : `Question ${i + 2} of ${LIVE.n} coming up…`}</p>
    </div>`;
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
          <span class="mcq-t"><b>${esc(o)}</b>${k === q.correct ? (x ? `<span class="mcq-x">${esc(x)}</span>` : "") : `<span class="mcq-from">That's ${esc(kindOf(q.from[k]))}</span>`}</span>
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
      descent.roll(res.tier, res.score, () => { const el = $("#hud-score"); if (el) { el.classList.remove("crank"); void el.offsetWidth; el.classList.add("crank"); } });
      setTimeout(() => { if (RUN && RUN.fmt === "quiz") setHud(totalScore(RUN.results.slice(0, Math.max(i, LIVE.revealed) + 1))); }, 1500);
    } else setHud(total);
  }
  function renderPodium() {
    stopRun();
    setMid(`Room ${LIVE.code}`);
    scene("results");
    const quiz = liveQuiz();
    const ps = inMatch().sort(rankCmp);
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
        ${ids.map((pid, i) => quiz ? (() => { const q = LIVE.quiz[i], x = q && explainOf(pid, rightOf(i)); return q ? `<div class="rc"><p class="rc-q">${esc(PROMPTS.get(pid).text)}</p>
          <p class="rc-right">${qmark(true)}<span><b>${esc(rightOf(i))}</b>${x ? `<span class="rx">${esc(x)}</span>` : ""}</span></p>
          <ul class="rc-list">${ps.map((pl) => { const a = pl.ans[i]; return `<li class="t-${a && a.ok ? QUIZ_TIER : "miss"}${pl.id === LIVE.myId ? " me" : ""}">${qmark(a && a.ok)}<span><span class="rn">${esc(pl.name)}</span><span class="ra">${a && a.pick >= 0 ? esc(q.options[a.pick]) : "No answer"}</span></span><em>+${roundPts(pl, i)}</em></li>`; }).join("")}</ul></div>` : ""; })() : `<div class="rc"><p class="rc-q">${esc(PROMPTS.get(pid).text)}</p><ul class="rc-list">${ps.map((pl) => {
          const a = pl.ans[i], x = a && explainOf(pid, a.answer);
          return `<li class="t-${tierOf(a && a.tier)}${pl.id === LIVE.myId ? " me" : ""}">${G(a && a.tier)}<span><span class="rn">${esc(pl.name)}</span><span class="ra">${a && a.answer ? esc(a.answer) : "No answer"}</span>${x ? `<span class="rx">${esc(x)}</span>` : ""}</span><em>+${roundPts(pl, i)}</em></li>`;
        }).join("")}</ul></div>`).join("")}
      </section>
      <section>
        <h2 class="block-title">Answer keys</h2>
        ${ids.map((pid, i) => answerKey(PROMPTS.get(pid), quiz ? rightOf(i) : me && me.ans[i] && me.ans[i].answer, openKeys.has(pid))).join("")}
      </section>` : "";
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>${winners.length > 1 ? "It's a tie" : `${esc(winners[0] ? winners[0].name : "")} wins`}</h1><p>${LIVE.n} questions${quiz ? " · Quiz" : ""} · Room ${esc(LIVE.code)}${timeNote}</p></div>
      <ol class="lv-podium">${ps.map((pl, k) => `<li class="${k === 0 ? "first" : ""}${pl.id === LIVE.myId ? " me" : ""}">
        <span class="rk">${k + 1}</span>${avatar(pl.name)}<span class="nm"><b>${esc(pl.name)}</b>${quiz ? `${qmarksRow(Array.from({ length: LIVE.n }, (_, i) => !!(pl.ans[i] && pl.ans[i].ok)))}<span class="nm-t">${fmtSecs(liveTotalMs(pl) / 100)}</span>` : tiersRow(Array.from({ length: LIVE.n }, (_, i) => (pl.ans[i] && pl.ans[i].tier) || "miss"))}</span><em>${shownTotal(pl)}</em></li>`).join("")}</ol>
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
  /** While a question is open, a message that names one of its answers would spoil it
   *  for anyone still thinking, so it waits for the reveal. Exact matches only. */
  function chatSpoiler(text) {
    if (!RUN || RUN.mode !== "live" || LIVE.phase !== "playing" || RUN.round <= LIVE.revealed) return null;
    const p = currentPrompt();
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
  async function renderRooms() {
    if (liveBlocked()) return renderLiveBlocked("");
    setMid("Public rooms");
    app.innerHTML = `<section class="screen live">
      <div class="page-head"><h1>Public rooms</h1><p>Duo rooms anyone can join. This list updates live.</p><p id="rooms-status" role="status">Connecting…</p></div>
      <ul class="lv-players" id="rooms-list"><li class="lv-wait"><span class="lv-av lv-pulse"></span><span>Looking for rooms…</span></li></ul>
      <div class="btn-row"><a class="btn primary big" href="#live">Create a room</a></div>
    </section>`;
    if (roomsWatch) { try { roomsWatch.end(true); } catch { /* ignore */ } roomsWatch = null; }
    let latest = new Map(), settled = false;
    const draw = () => {
      const list = $("#rooms-list"), st = $("#rooms-status");
      if (!list || location.hash !== "#rooms") return;
      const rooms = [...latest.entries()].filter(([, r]) => Date.now() - (+r.at || 0) < 45000).sort((a, b) => a[0].localeCompare(b[0]));
      st.textContent = rooms.length ? `${rooms.length} open ${rooms.length === 1 ? "room" : "rooms"}` : settled ? "No public rooms right now. Create one and it shows up here for everyone." : "Looking for rooms…";
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
    unlimited: renderUnlimited, quiz: renderQuizHub, packs: renderPacks, archive: renderArchive, library: renderLibrary,
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
    if ((m = s.match(/^quiz-(\d+)$/))) return `quiz:${m[1]}`;
    if ((m = s.match(/^vq-([a-z0-9]+)$/))) return `vq:${m[1]}`;
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
    syncChat();
    if (h !== "rooms" && typeof roomsWatch !== "undefined" && roomsWatch) { try { roomsWatch.end(true); } catch { /* ignore */ } roomsWatch = null; }
    if (RUN && RUN.mode === "live" && !LIVE.active) stopRun();
    scene("page");
    $$("#drawer a.nav").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + (h || "home")));
    if (!BROWSE && /^(packs|library|pack-|practice-|answers-)/.test(h)) return go("home");
    if (!BROWSE && /^unlimited-\d+$/.test(h) && +h.slice(10) > nextUnlimited()) return go(`unlimited-${nextUnlimited()}`);
    if (!BROWSE && /^quiz-\d+$/.test(h) && +h.slice(5) > nextQuiz()) return go(`quiz-${nextQuiz()}`); // same launch rule as Unlimited: no jumping ahead
    if (SIMPLE[h]) return SIMPLE[h]();
    if (/^vs-/.test(h)) return openChallenge(h);
    if (/^vq-/.test(h)) return openQuizChallenge(h);
    if (/^quiz-\d+$/.test(h)) return openQuiz(Math.max(1, +h.slice(5)));
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
    else if (inProg) cta = `<a class="btn primary big" href="#daily">Resume · ${Math.min(inProg.results.length + 1, 7)} of 7</a>`;
    else cta = `<a class="btn primary big" href="#daily">Start training</a>`;
    cta += `<a class="btn big" href="#live">Play live with friends</a>`;
    const progress = rec ? rec.score / 700 : inProg ? totalScore(inProg.results || []) / 700 : 0;
    const modes = [
      ["#live", "Live match", "Play friends in real time"],
      ["#rooms", "Public rooms", "Join anyone playing now"],
      ["#challenge", "Challenge a friend", "Same questions, one link"],
      ["#unlimited", "Unlimited", "Endless runs"],
      ["#quiz", "Quiz", "Four answers, one fits"],
      ["#packs", "Packs", `${DATA.packs.length} themes`],
      ["#archive", "Archive", "Past days"],
      ["#library", "Library", `${DATA.prompts.length} prompts`],
      ["#stats", "Stats", s.played ? `${s.played} played` : ""],
      ["#how", "How to play", ""],
    ].filter(([href]) => BROWSE || (href !== "#packs" && href !== "#library"));
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
    app.innerHTML = `<section class="screen play${RUN.fmt === "quiz" ? " quiz" : ""}">
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
    V.setRounds(RUN.promptIds.length);
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
    if (RUN.mode === "live") { $("#card").insertAdjacentHTML("beforebegin", `<div class="live-strip" id="live-strip" aria-live="polite"></div><div class="live-rivals" id="live-rivals"></div><div class="live-skip" id="live-skip"></div>`); renderStrip(); }
  }
  function updateHead() {
    if (!RUN) return;
    const n = RUN.promptIds.length;
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
    $("#hud-loss").textContent = ((n * 100 - score) / 100).toFixed(2);
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
      RUN.mode === "quiz" ? `Pick the one that fits. ${E.QUIZ_POINTS} a right answer.` : "";
    $("#card").innerHTML = `<div class="intro-card">
      <div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>
      <ul class="beats">
        <li><b>${n}</b><span>${n === 1 ? "prompt" : "prompts"}</span></li>
        <li><b>3 s</b><span>to read</span></li>
        <li><b>${answerMs() / 1000} s</b><span>to answer</span></li>
      </ul>
      <p class="rule">${quiz ? "Four answers, one fits. Tap one before the clock runs out. A wrong answer or no answer scores nothing." : "Any valid answer counts. Wrong ones bounce, so keep trying. Rarer answers score more."}</p>
      ${vsLike ? `<label class="vs-field"><span>Your name</span><input class="search" id="vs-name" maxlength="16" autocomplete="nickname" placeholder="So ${RUN.opp ? esc(RUN.opp.name) : "your friend"} knows who played" value="${esc(myName())}"></label>` : ""}
      <div class="btn-row">
        <button class="btn primary big" id="begin">Begin</button>
        ${vsLike && !RUN.opp ? `<button class="btn big" id="vs-send-now">Send link now</button>` : ""}
      </div>
      <p class="hint">${quiz ? `<kbd>1</kbd> to <kbd>4</kbd> pick an answer` : `<kbd>Enter</kbd> submits and continues`}</p>
    </div>`;
    const sendNow = $("#vs-send-now");
    if (sendNow) sendNow.addEventListener("click", () => {
      const nm = $("#vs-name");
      if (nm) LS.set("name", nm.value.trim().slice(0, 16));
      const link = quiz ? vqLink(RUN.seed, RUN.n, [], answerMs() / 1000) : challengeLink(RUN.seed, RUN.n, [], answerMs() / 1000);
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
    persistRun();
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
        <p class="prompt-text" id="prompt-text">${esc(p.text)}</p>
        <p class="prompt-note">${p.scope ? `${esc(p.scope)}. ` : ""}Which one fits?</p>
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
      </div>
    </div>`;
    $$(".mcq-opt").forEach((b) => b.addEventListener("click", () => pickQuiz(+b.dataset.i)));
    lastTick = -1;
    tickLoop();
  }
  /** Lock in an option (index 0 to 3) while the clock is running. */
  function pickQuiz(i) {
    if (!RUN || RUN.fmt !== "quiz" || RUN.phase !== "answering" || !(i >= 0 && i < E.QUIZ_OPTIONS)) return;
    finishQuiz(i, {});
  }

  function renderRound() {
    if (RUN.fmt === "quiz") return renderQuizRound();
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
    lastTick = -1;
    tickLoop();
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
        $$(".mcq-opt", mcq).forEach((b) => { b.disabled = false; });
        veil.classList.add("hidden");
        $("#timer-label").textContent = "Time left";
      }
      const left = Math.max(0, RUN.answerEndsAt - now);
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

  function reject(raw, input) {
    RUN.tried = (RUN.tried || []).concat(raw);
    liveTyping();
    Sound.reject();
    setStatus(`“${raw}” isn't in the key: no gradient. Try again.`, "bad");
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
    RUN.results.push(res);
    RUN.phase = "feedback";
    markSeen(p.id);
    persistRun();
    if (!silent) Sound.submit();
    renderFeedback(res, !silent);
  }

  function finishRound(answer, raw, { corrected = false, timeout = false, skipped = false, silent = false } = {}) {
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
        <span class="mcq-t"><b>${esc(o)}</b>${right ? (x ? `<span class="mcq-x">${esc(x)}</span>` : "") : `<span class="mcq-from">That's ${esc(kindOf(q.from[k]))}</span>`}</span>${mine ? `<span class="mcq-you">You</span>` : ""}</li>`;
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
      if (next.isConnected) { next.disabled = false; next.focus({ preventScroll: true }); }
    };
    const total = totalScore(RUN.results);
    if (animate && descent) {
      hudRange = [total - res.score, total];
      if (res.tier) Sound.tier(res.tier); else Sound.miss();
      descent.roll(res.tier, res.score, () => { const el = $("#hud-score"); if (el) { el.classList.remove("crank"); void el.offsetWidth; el.classList.add("crank"); } done(); });
      setTimeout(done, 1500); // never hold the player behind the animation
    } else { setHud(total); done(); }
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
    const isLast = RUN.results.length >= RUN.promptIds.length;
    const p = PROMPTS.get(res.promptId);
    const t = res.tier ? T[res.tier] : null;
    const card = $("#card");
    card.innerHTML = `
      <div class="feedback ${res.tier || "miss"} t-${tierOf(res.tier)}${animate ? "" : " landed"}" id="fb" aria-live="polite">
        <p class="fb-q">${esc(p.text)}</p>
        <div class="fb-answer">${res.answer ? esc(res.answer) : res.raw ? `“${esc(res.raw)}” <span class="muted">isn't in the key</span>` : `<span class="muted">No answer</span>`}</div>
        <div class="fb-tier">${G(res.tier)}<span class="fb-name">${t ? esc(t.name) : "Miss"}</span><span class="fb-points">+${res.score}</span></div>
        ${res.quip ? `<p class="fb-quip">${esc(res.quip)}</p>` : !t ? `<p class="fb-quip">${res.timeout ? "Out of time." : res.skipped ? "Skipped." : "No gradient, no descent."}</p>` : ""}
        ${res.corrected && res.raw ? `<p class="fb-note">Autocorrected from “${esc(res.raw)}”</p>`
          : res.answer && res.raw && E.fullKey(res.raw) !== E.fullKey(res.answer) ? `<p class="fb-note">“${esc(res.raw)}” counts as ${esc(res.answer)}</p>` : ""}
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
      tiers: RUN.results.map((r) => r.tier || "miss"), completedAt: Date.now(), secs: answerMs() / 1000,
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
    if (e.key === "Escape") { closeDrawer(); closeModal(); if (CHAT.open) setChatOpen(false); }
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
    const isDailyToday = rec.mode === "daily" && rec.date === today();
    const picked = !BROWSE && (rec.mode === "pack" || rec.mode === "practice"); // those pages are hidden
    const nextHref = picked ? "#unlimited" : rec.mode === "unlimited" ? `#unlimited-${nextUnlimited()}` :
      rec.mode === "quiz" ? `#quiz-${nextQuiz()}` :
      rec.mode === "pack" ? `#pack-${rec.pack}-${nextPackRun(rec.pack) > E.packRunCount(DATA, rec.pack) ? 1 : nextPackRun(rec.pack)}` :
      rec.mode === "practice" ? "#library" : "#unlimited";
    const nextLabel = picked ? "Play Unlimited" : rec.mode === "unlimited" || rec.mode === "quiz" ? "Next run" : rec.mode === "pack" ? "Next pack run" : rec.mode === "practice" ? "Library" : "Play Unlimited";
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
          ${isDailyToday ? `<p class="countdown">Next descent in <b id="cd">${hhmmss(E.msUntilLocalMidnight())}</b></p>` : ""}
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
                ${x ? `<span class="qp">${esc(x)}</span>` : ""}</span>
              <span class="pts">+${r.score}</span>
            </li>`; }).join("") : rec.results.map((r) => `
            <li class="run-item t-${tierOf(r.tier)}">${G(r.tier)}
              <span><span class="q">${esc(r.promptText)}</span>
                <span class="a ${r.answer ? "" : "missed"}">${r.answer ? esc(r.answer) : r.raw ? `“${esc(r.raw)}”` : r.skipped ? "Skipped" : "No answer"}</span>
                ${(() => { const x = r.answer && (explainOf(r.promptId, r.answer) || r.quip); return x ? `<span class="qp">${esc(x)}</span>` : ""; })()}</span>
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
        <div class="vs-field"><span>Format</span><div class="vs-sizes" role="radiogroup" aria-label="Format">${[["rarity", "Rarity"], ["quiz", "Quiz"]].map(([k, l]) => `<button type="button" class="vs-size fmt-size${fmt === k ? " on" : ""}" role="radio" aria-checked="${fmt === k}" data-f="${k}">${l}</button>`).join("")}</div></div>
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
      const seed = Math.random().toString(36).slice(2, 9).padEnd(6, "0");
      LS.set("vsFormat", fmt);
      go(`${fmt === "quiz" ? "vq" : "vs"}-${seed}-${size}${secs !== DEFAULT_SECS ? `t${secs}` : ""}`);
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
        <div class="page-head"><h1>Quiz</h1><p>Seven questions a run. Four answers each, one fits. ${E.QUIZ_POINTS} a right answer.</p></div>
        ${runs.length ? `<div class="figures"><div class="figure"><b>${runs.length}</b><span>Runs</span></div><div class="figure"><b>${avg}</b><span>Average</span></div><div class="figure"><b>${best}</b><span>Best</span></div></div>` : ""}
        <div class="btn-row"><a class="btn primary big" href="#quiz-${next}">${inProg ? `Resume run ${next}` : `Start run ${next}`}</a><a class="btn big" href="#challenge">Challenge a friend</a></div>
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
        <div class="vs-form">${timePicker(validSecs(settings.answerSecs) ? settings.answerSecs : DEFAULT_SECS)}<p class="muted small">For your own runs. A run already in progress keeps its time. Live rooms and challenges use the time their host or link sets.</p></div>
        <div class="settings-list">${items.map(([k, t, d]) => `
          <label class="setting" ${k === "aiCheck" ? `id="ai-setting" ${aiUsable() ? "" : "hidden"}` : ""}><span class="txt"><span class="t">${esc(t)}</span>${d ? `<span>${esc(d)}</span>` : ""}</span>
            <span class="switch"><input type="checkbox" role="switch" data-k="${k}" ${settings[k] ? "checked" : ""}><i></i></span></label>`).join("")}</div>
        <section><h2 class="block-title">Progress</h2><p class="muted" style="margin-top:8px">Move your history to another browser.</p>
          <div class="btn-row" style="margin-top:20px"><button class="btn" id="exp">Export</button><button class="btn" id="imp">Import</button><button class="btn danger" id="reset">Reset all</button></div></section>
      </div>
    </section>`;
    $$("input[data-k]").forEach((i) => i.addEventListener("change", () => { settings[i.dataset.k] = i.checked; saveSettings(); }));
    wireTimePicker((secs) => { settings.answerSecs = secs; saveSettings(); toast(`${secs} s per question`); });
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
