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

  // ============================================================ routing
  // Hash routes are plain names (#daily, #pack-blocks-3, #results-daily-2026-11-04)
  // so links survive hosts that only pass simple fragments through.
  const SIMPLE = {
    "": renderHome, home: renderHome,
    daily: () => openRun(dailySpec(today())),
    unlimited: renderUnlimited, packs: renderPacks, archive: renderArchive, library: renderLibrary,
    stats: renderStats, how: renderHow, faq: renderFaq, prefs: renderSettings,
    challenge: renderChallenge,
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
    stopRun();
    clearScreenTimers();
    window.scrollTo(0, 0);
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\//g, "-");
    scene("page");
    $$("#drawer a.nav").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + (h || "home")));
    if (SIMPLE[h]) return SIMPLE[h]();
    if (/^vs-/.test(h)) return openChallenge(h);
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
    cta += `<a class="btn big" href="#challenge">Challenge a friend</a>`;
    const progress = rec ? rec.score / 700 : inProg ? totalScore(inProg.results || []) / 700 : 0;
    const modes = [
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
    if (!RUN || RUN.mode === "practice") return;
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
    const title = RUN.mode === "daily" ? `MLion #${RUN.number}` : RUN.mode === "vs" && RUN.opp ? `${RUN.opp.name} challenged you` : RUN.label;
    const sub = RUN.mode === "daily" ? prettyDate(RUN.date, { weekday: "long", month: "long", day: "numeric" }) :
      RUN.mode === "archive" ? `${prettyDate(RUN.date)} · no streak` :
      RUN.mode === "practice" ? "Answers shown after" :
      RUN.mode === "vs" ? (RUN.opp ? `Score to beat: ${tierPoints(RUN.opp.tiers)}. You'll see their result after each answer.` : "Play first, then send the link.") : "";
    $("#card").innerHTML = `<div class="intro-card">
      <div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>
      <ul class="beats">
        <li><b>${n}</b><span>${n === 1 ? "prompt" : "prompts"}</span></li>
        <li><b>3 s</b><span>to read</span></li>
        <li><b>25 s</b><span>to answer</span></li>
      </ul>
      <p class="rule">Any valid answer counts. Wrong ones bounce, so keep trying. Rarer answers score more.</p>
      ${RUN.mode === "vs" ? `<label class="vs-field"><span>Your name</span><input class="search" id="vs-name" maxlength="16" autocomplete="nickname" placeholder="So ${RUN.opp ? esc(RUN.opp.name) : "your friend"} knows who played" value="${esc(myName())}"></label>` : ""}
      <button class="btn primary big" id="begin">Begin</button>
      <p class="hint"><kbd>Enter</kbd> submits and continues</p>
    </div>`;
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
    if (!RUN || RUN.phase !== "feedback") return;
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
            ${isVs ? `<button class="btn primary big" id="send-vs">${rec.opp ? "Send result back" : "Send challenge"}</button>
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
