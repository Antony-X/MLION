/* MLion — app shell, round state machine and screens. */
(function () {
  "use strict";
  const E = window.MLION_ENGINE;
  const V = window.MLION_VISUALS;
  const DATA = window.MLION_DATA;
  const PROMPTS = new Map(DATA.prompts.map((p) => [p.id, p]));
  const PACKS = new Map(DATA.packs.map((p) => [p.id, p]));
  const T = E.TIERS;
  const REPO_URL = "https://github.com/Antony-X/MLION";

  const app = document.getElementById("app");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tierVar = (t) => `--tc: var(--t-${t || "miss"})`;
  const fmt = (n) => Number(n).toLocaleString("en-US");

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
    return { key: `unlimited:${n}`, mode: "unlimited", number: n, label: `∞ Run #${n}`, promptIds: E.unlimitedPromptIds(DATA, n) };
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

  // ============================================================ routing
  // Hash routes are plain names (#daily, #pack-blocks-3, #results-daily-2026-11-04)
  // so links survive hosts that only pass simple fragments through.
  const SIMPLE = {
    "": renderHome, home: renderHome,
    daily: () => openRun(dailySpec(today())),
    unlimited: renderUnlimited, packs: renderPacks, archive: renderArchive, library: renderLibrary,
    stats: renderStats, how: renderHow, faq: renderFaq, prefs: renderSettings,
  };
  const slugFor = (key) => key.replace(/:/g, "-");
  function keyFromSlug(s) {
    let m;
    if ((m = s.match(/^(daily|archive)-(\d{4}-\d{2}-\d{2})$/))) return `${m[1]}:${m[2]}`;
    if ((m = s.match(/^unlimited-(\d+)$/))) return `unlimited:${m[1]}`;
    if ((m = s.match(/^pack-([a-z]+)-(\d+)$/))) return `pack:${m[1]}:${m[2]}`;
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
    if (SIMPLE[h]) return SIMPLE[h]();
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
  function tierLegend() {
    return `<ul class="tier-list">${E.TIERS_BY_SCORE.slice().reverse().map((t) => `
      <li class="tier-row ${t.id}" style="${tierVar(t.id)}">
        <span class="e" aria-hidden="true">${t.emoji}</span>
        <span class="n">${esc(t.name)}<span class="b">${esc(t.blurb)}</span></span>
        <span class="p">+${t.score}</span>
      </li>`).join("")}</ul>`;
  }
  function renderHome() {
    setMid("the daily descent");
    const date = today(), n = todayNumber();
    const rec = records[`daily:${date}`];
    const inProg = !rec && LS.get(`run:daily:${date}`);
    const s = statsSummary();
    let cta;
    if (rec) cta = `<a class="btn primary big block" href="#results-${slugFor(rec.key)}">View today's run · ${rec.score}/700</a>
      <div class="countdown">next descent in <b id="cd">${hhmmss(E.msUntilLocalMidnight())}</b></div>`;
    else if (inProg) cta = `<a class="btn primary big block" href="#daily">Resume · prompt ${Math.min(inProg.results.length + 1, 7)} of 7 ▶</a>`;
    else cta = `<a class="btn primary big block" href="#daily">▶ Start training</a>`;
    app.innerHTML = `<section class="screen">
      <div class="hero">
        <div class="wordmark" aria-label="MLion">${"MLION".split("").map((c, i) => `<span class="${i < 2 ? "ml" : ""}" style="animation-delay:${i * 0.18}s">${c}</span>`).join("")}</div>
        <div class="tagline">THE DAILY DESCENT</div>
        <div class="subline">7 prompts · 25 seconds each · rarer answers descend deeper</div>
        <div class="daytag">MLion #${n} · ${esc(prettyDate(date, { weekday: "long", month: "short", day: "numeric" }))}</div>
        <div class="hero-cta">${cta}</div>
        <div class="quick-stats">
          <div class="qs"><b>${s.cur}</b><span>streak</span></div>
          <div class="qs"><b>${s.best || "—"}</b><span>best</span></div>
          <div class="qs"><b>${s.gems}</b><span>🦁 found</span></div>
        </div>
      </div>
      <div class="panel" style="margin-top:22px">
        <p class="kicker">rarity tiers · <span class="hl">fixed, hand-curated</span></p>
        ${tierLegend()}
        <p class="small muted" style="margin:12px 0 0">Every prompt has thousands of possible answers but exactly one 🦁 gem. Misses score 0 and leave the loss at NaN.</p>
      </div>
      <div class="nav-grid" style="margin-top:14px">
        <a class="nav-card" href="#unlimited"><span class="t"><span class="g">∞</span>Unlimited</span><span class="d">Endless runs from all ${DATA.prompts.length} prompts.</span></a>
        <a class="nav-card" href="#packs"><span class="t"><span class="g">◆</span>Themed packs</span><span class="d">${DATA.packs.length} packs: blocks, models, LLMs, theory…</span></a>
        <a class="nav-card" href="#archive"><span class="t"><span class="g">⟲</span>Archive</span><span class="d">Replay any past daily descent.</span></a>
        <a class="nav-card" href="#library"><span class="t"><span class="g">≡</span>Library</span><span class="d">Every prompt, practice mode & answer keys.</span></a>
        <a class="nav-card" href="#stats"><span class="t"><span class="g">↗</span>Stats</span><span class="d">Streaks, averages and tier counts.</span></a>
        <a class="nav-card" href="#how"><span class="t"><span class="g">?</span>How to play</span><span class="d">Rules, scoring and autocorrect.</span></a>
      </div>
    </section>`;
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
      <div class="play-head">
        <div class="dots" id="dots" aria-label="progress"></div>
        <div class="play-meta" id="play-meta"></div>
      </div>
      <div class="descent-wrap">
        <canvas id="descent" aria-hidden="true"></canvas>
        <div class="hud"><span>loss</span><b id="hud-loss">7.00</b></div>
        <div class="hud hud-r"><span>score</span><b id="hud-score">0</b></div>
      </div>
      <div class="panel prompt-card" id="card"></div>
    </section>`;
    descent = V.Descent($("#descent"), {
      onFrame: (x) => {
        if (!RUN) return;
        const [lo, hi] = hudRange;
        const pts = Math.min(hi, Math.max(lo, Math.round(x / 10)));
        const l = $("#hud-loss"), sc = $("#hud-score");
        if (l) l.textContent = ((RUN.promptIds.length * 100 - pts) / 100).toFixed(2);
        if (sc) sc.textContent = pts;
      },
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
      if (r) return r.tier ? `<i class="done" style="${tierVar(r.tier)}" title="${esc(T[r.tier].name)}"></i>` : `<i class="miss" title="miss"></i>`;
      return `<i class="${i === RUN.round && RUN.phase !== "intro" ? "cur" : ""}"></i>`;
    }).join("");
    $("#play-meta").innerHTML = `prompt <b>${Math.min(RUN.round + 1, n)}</b>/${n}`;
  }
  function setHud(score) {
    hudRange = [score, score];
    const n = RUN.promptIds.length;
    $("#hud-score").textContent = score;
    $("#hud-loss").textContent = ((n * 100 - score) / 100).toFixed(2);
  }

  function renderIntro() {
    const n = RUN.promptIds.length;
    const title = RUN.mode === "daily" ? `MLion #${RUN.number}` : RUN.label;
    const sub = RUN.mode === "daily" ? prettyDate(RUN.date, { weekday: "long", month: "long", day: "numeric" }) :
      RUN.mode === "archive" ? `${prettyDate(RUN.date)} · doesn't affect your streak` :
      RUN.mode === "practice" ? "one prompt · answers revealed after" : `${n} prompts`;
    $("#card").innerHTML = `<div class="intro-card">
      <p class="kicker"><span class="hl">${esc(title)}</span> · ${esc(sub)}</p>
      <h2>Ready to descend?</h2>
      <ul class="rules">
        <li>${n === 1 ? "One prompt" : `${n} prompts`}, each shown for 3 seconds before a 25-second clock</li>
        <li>Wrong answers just bounce. Keep trying until time runs out</li>
        <li>Rarer accepted answers descend deeper</li>
      </ul>
      <button class="btn primary big block" id="begin">▶ Begin descent</button>
      <p class="small muted" style="margin:10px 0 0">Tip: press <kbd>Enter</kbd> to submit and to continue.</p>
    </div>`;
    $("#begin").addEventListener("click", async () => { $("#begin").disabled = true; await aiConsentUpFront(); startRound(); });
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
    const n = RUN.promptIds.length;
    updateHead();
    $("#card").innerHTML = `
      <div class="prompt-num">prompt ${String(RUN.round + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")} · ${esc(PACKS.get(p.pack).name)}</div>
      <div class="prompt-text" id="prompt-text">${esc(p.text)}</div>
      ${p.note ? `<p class="prompt-note">${esc(p.note)}</p>` : ""}
      <div class="timer" id="timer">
        <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>
        <div class="timer-row"><span id="timer-label">clock starts in</span><b id="timer-num">25.0</b></div>
      </div>
      <div class="input-zone">
        <form class="answer-form" id="answer-form" autocomplete="off">
          <input class="answer-input" id="answer" maxlength="${E.MAX_ANSWER_LENGTH}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Your answer" placeholder="type an answer…">
          <button class="btn primary step-btn" id="step" type="submit">Step ▼</button>
        </form>
        <div class="preview-veil" id="veil"><div>the clock starts in<b id="veil-n">3</b></div></div>
      </div>
      <div class="status" id="status" role="status" aria-live="polite"></div>
      <div class="chips" id="chips"></div>
      <div class="tried" id="tried"></div>`;
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
        $("#timer-label").textContent = "clock starts in";
        $("#timer-num").textContent = "25.0";
        $("#timer-fill").style.transform = "scaleX(1)";
      } else {
        if (RUN.phase === "preview" || input.disabled) {
          RUN.phase = "answering"; persistRun();
          input.disabled = false; $("#step").disabled = false;
          veil.classList.add("hidden");
          input.focus({ preventScroll: true });
          $("#timer-label").textContent = "time left";
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
    el.innerHTML = `<span class="chips-label">${esc(label || "did you mean")}</span>` +
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
    setStatus(`“${raw}”: no gradient. try again`, "bad");
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
      setStatus(`did you mean “${m.answer.a}”? Press Step to confirm, or keep typing.`, "info");
      input.focus();
      return;
    }
    if (m.kind === "suggest") {
      setStatus(`“${raw}” isn't an exact match.`, "info");
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
    setStatus(`“${raw}”: no exact match. Asking Claude what you meant…`, "info");
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
      setStatus(`Claude thinks “${raw}” means:`, "info");
      showChips([found], "Claude thinks you meant");
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
    const nextLabel = isLast ? "See results ▶" : "Next prompt ▶";
    card.innerHTML = `
      <div class="prompt-num">prompt ${String(RUN.results.length).padStart(2, "0")} / ${String(RUN.promptIds.length).padStart(2, "0")}</div>
      <div class="prompt-text" style="font-size:18px">${esc(p.text)}</div>
      <div class="feedback ${res.tier || "miss"}" style="${tierVar(res.tier)}" id="fb" aria-live="polite">
        <div class="fb-tier"><span class="em">${t ? t.emoji : E.MISS_EMOJI}</span><span>${t ? esc(t.name) : "NaN"}</span><span class="fb-points">+${res.score}</span></div>
        <div class="fb-answer">${res.answer ? `“${esc(res.answer.toUpperCase())}”` : res.raw ? `“${esc(res.raw)}” <span class="muted">isn't in the answer key</span>` : `<span class="muted">no answer</span>`}</div>
        <p class="fb-blurb">${t ? esc(t.blurb) : res.timeout ? "Out of time. The gradient vanished." : "No gradient, no descent."}</p>
        ${res.quip ? `<p class="fb-quip">${esc(res.quip)}</p>` : ""}
        ${res.corrected && res.raw ? `<p class="fb-note">autocorrected from “${esc(res.raw)}”</p>` : ""}
        <button class="btn primary block" id="next" ${animate ? "disabled" : ""}>${nextLabel}</button>
      </div>`;
    const next = $("#next");
    next.addEventListener("click", advance);
    const done = () => { if (next.isConnected) { next.disabled = false; next.focus({ preventScroll: true }); } };
    const total = totalScore(RUN.results);
    if (animate && descent) {
      hudRange = [total - res.score, total];
      if (res.tier) Sound.tier(res.tier); else Sound.miss();
      if (res.tier === "mlion" && !settings.reducedMotion) {
        const f = document.createElement("div"); f.className = "gold-flash"; document.body.appendChild(f);
        setTimeout(() => f.remove(), 1200);
      }
      descent.roll(res.tier, res.score, () => { const el = $("#hud-score"); if (el) { el.classList.remove("crank"); void el.offsetWidth; el.classList.add("crank"); } done(); });
      // never trap the player behind the animation
      setTimeout(done, 2800);
    } else { setHud(total); done(); }
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
  function logChart(results) {
    const n = results.length;
    return `<div class="log-chart" style="--n:${n}">
      ${[0, 0.25, 0.5, 0.75, 1].map((f) => `<div class="rule" style="top:${f * 100}%"><span>${f === 0 ? "surface" : f === 1 ? "deep" : ""}</span></div>`).join("")}
      <div class="log-cols">${results.map((r, i) => {
        const d = r.tier ? T[r.tier].depth : 0.03;
        return `<div class="log-col" style="${tierVar(r.tier)};--h:${(d * 100).toFixed(1)}%;--d:${0.12 * i}s">
          <div class="bar"></div><div class="pin" title="${r.tier ? esc(T[r.tier].name) : "miss"}">${r.tier ? T[r.tier].emoji : E.MISS_EMOJI}</div>
          <div class="lbl">${i + 1}</div></div>`;
      }).join("")}</div>
    </div>`;
  }

  function answerKey(p, yourAnswer, open) {
    const counts = Object.fromEntries(E.TIER_IDS.map((t) => [t, 0]));
    p.answers.forEach((a) => counts[a.t]++);
    const gem = p.answers.find((a) => a.t === "mlion");
    const you = yourAnswer ? E.fullKey(yourAnswer) : "";
    return `<details class="key" ${open ? "open" : ""} data-pid="${esc(p.id)}">
      <summary><span class="grow"><b>${esc(p.text)}</b><br><span class="small muted">${fmt(p.answers.length)} accepted answers</span></span><span class="chev">▸</span></summary>
      <div class="body">
        ${gem ? `<div class="gem-line"><span>🦁</span><span><b>${esc(gem.a)}</b>${gem.q ? ` <span class="small muted">— ${esc(gem.q)}</span>` : ""}</span></div>` : ""}
        <div class="tier-counts">${E.TIERS_BY_SCORE.map((t) => `<span class="badge" style="${tierVar(t.id)}">${t.emoji} ${counts[t.id]}</span>`).join("")}</div>
        <input class="search" type="search" placeholder="search ${fmt(p.answers.length)} answers…" aria-label="Search answers" data-you="${esc(you)}">
        <ul class="ans-list"></ul>
        <div class="list-foot"><span class="cnt"></span><button class="linkish more hidden" type="button">show all</button></div>
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
          return `<li class="${isYou ? "you" : ""}" style="${tierVar(a.t)}"><span class="e">${T[a.t].emoji}</span>
            <span><span class="nm">${esc(a.a)}</span>${isYou ? `<span class="you-tag">YOU</span>` : ""}
            ${a.aka && a.aka.length ? `<span class="ak">aka ${esc(a.aka.slice(0, 4).join(" · "))}</span>` : ""}
            ${a.q ? `<span class="qp">${esc(a.q)}</span>` : ""}</span>
            <span class="pt">+${T[a.t].score}</span></li>`;
        }).join("") || `<li><span></span><span class="muted">No matching answers</span><span></span></li>`;
        cnt.textContent = `${fmt(shown.length)} of ${fmt(m.length)} answers`;
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
    const nextLabel = rec.mode === "unlimited" ? `Next ∞ run #${nextUnlimited()} ▶` : rec.mode === "pack" ? "Next pack run ▶" : rec.mode === "practice" ? "Back to library" : "Keep playing: ∞ Unlimited";
    app.innerHTML = `<section class="screen stack">
      <div class="panel score-hero" style="${tierVar(scoreTier)}">
        <p class="kicker">${esc(rec.label)}${rec.date ? ` · ${esc(prettyDate(rec.date))}` : ""}</p>
        <div class="score-big">${rec.score}<small>/${max}</small></div>
        ${band ? `<div class="verdict">${esc(band.verdict)}</div>` : ""}
        <div class="loss-line">final loss ${((max - rec.score) / 100).toFixed(2)} · ${rec.results.filter((r) => r.tier).length}/${n} accepted</div>
        <div class="grid-emoji" aria-label="tier grid">${rec.tiers.map(E.tierEmoji).join("")}</div>
        <div class="btn-row" style="margin-top:16px">
          ${rec.mode !== "practice" ? `<button class="btn primary" id="share">Share</button>` : ""}
          <a class="btn" href="${nextHref}">${esc(nextLabel)}</a>
        </div>
        ${isDailyToday ? `<div class="countdown">next descent in <b id="cd">${hhmmss(E.msUntilLocalMidnight())}</b></div>` : ""}
      </div>
      ${n > 1 ? `<div class="panel"><p class="kicker">training log · <span class="hl">deeper = rarer</span></p>${logChart(rec.results)}<div style="height:22px"></div></div>` : ""}
      <div class="panel">
        <p class="kicker">your run</p>
        <ul class="run-list">${rec.results.map((r) => `
          <li class="run-item" style="${tierVar(r.tier)}">
            <span class="e">${r.tier ? T[r.tier].emoji : E.MISS_EMOJI}</span>
            <span><span class="q">${esc(r.promptText)}</span><br>
              <span class="a ${r.answer ? "" : "missed"}">${r.answer ? esc(r.answer) : r.raw ? `“${esc(r.raw)}” ✗` : "— no answer —"}</span>
              ${r.quip ? `<span class="qp" style="display:block">${esc(r.quip)}</span>` : ""}</span>
            <span class="pts">+${r.score}</span>
          </li>`).join("")}</ul>
      </div>
      <div class="panel">
        <p class="kicker">answer keys · <span class="hl">every accepted answer</span></p>
        ${rec.promptIds.map((id, i) => PROMPTS.has(id) ? answerKey(PROMPTS.get(id), rec.results[i] && rec.results[i].answer, rec.mode === "practice") : "").join("")}
      </div>
      <div class="btn-row">
        <a class="btn" href="#home">Home</a>
        <a class="btn" href="#stats">Stats</a>
        <a class="btn" href="#archive">Archive</a>
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
      showModal("Share your run", `<p class="small muted">Copying isn't allowed here. Select the text below and copy it.</p>
        <textarea class="search share-box" id="share-box" readonly aria-label="Share text">${esc(text)}</textarea>`);
      const box = $("#share-box"); box.focus(); box.select();
    });
    if (isDailyToday) every(1000, () => { const el = $("#cd"); if (el) el.textContent = hhmmss(E.msUntilLocalMidnight()); });
  }

  // =========================================================== unlimited
  function renderUnlimited() {
    setMid("∞ unlimited");
    const runs = Object.values(records).filter((r) => r.mode === "unlimited").sort((a, b) => b.number - a.number);
    const next = nextUnlimited();
    const inProg = LS.get(`run:unlimited:${next}`);
    const avg = runs.length ? Math.round(runs.reduce((s, r) => s + r.score, 0) / runs.length) : 0;
    app.innerHTML = `<section class="screen stack">
      <div class="panel center">
        <p class="kicker"><span class="hl">∞ the endless descent</span></p>
        <h2>Every prompt, every depth</h2>
        <p class="muted">Run after run of 7 prompts dealt from all ${DATA.prompts.length} prompts across ${DATA.packs.length} packs. Progress saves on this device.</p>
        <a class="btn primary big block" href="#unlimited-${next}">${inProg ? `Resume run #${next}` : `Start run #${next}`} ▶</a>
        <div class="quick-stats"><div class="qs"><b>${runs.length}</b><span>runs</span></div><div class="qs"><b>${avg || "—"}</b><span>average</span></div><div class="qs"><b>${runs.reduce((m, r) => Math.max(m, r.score), 0) || "—"}</b><span>best</span></div></div>
      </div>
      ${runs.length ? `<div class="panel"><p class="kicker">past runs</p><ul class="list">${runs.slice(0, 50).map((r) => `
        <li><a class="list-item" href="#results-${slugFor(r.key)}"><span class="em">∞</span><span class="main"><span class="title">Run #${r.number}</span><span class="sub" style="display:block">${r.tiers.map(E.tierEmoji).join("")}</span></span><span class="right">${r.score}/700</span></a></li>`).join("")}</ul></div>` : ""}
    </section>`;
  }

  // =============================================================== packs
  function renderPacks() {
    setMid("themed packs");
    app.innerHTML = `<section class="screen stack">
      <div class="panel"><p class="kicker">themed packs</p><h2>Pick a corner of the field</h2>
        <p class="muted small" style="margin:6px 0 0">Each pack deals its prompts into runs of 7. Clear every run to complete the pack.</p></div>
      <ul class="list">${DATA.packs.map((pk) => {
        const count = DATA.prompts.filter((p) => p.pack === pk.id).length;
        const runs = E.packRunCount(DATA, pk.id);
        const done = Array.from({ length: runs }, (_, i) => records[`pack:${pk.id}:${i + 1}`]).filter(Boolean).length;
        return `<li><a class="list-item" href="#pack-${pk.id}"><span class="em">${pk.emoji}</span>
          <span class="main"><span class="title">${esc(pk.name)}</span><span class="sub" style="display:block">${esc(pk.tagline)}</span>
          <span class="progress"><i style="width:${(100 * done / runs).toFixed(0)}%"></i></span></span>
          <span class="right">${count} prompts<br><span class="muted">${done}/${runs} runs</span></span></a></li>`;
      }).join("")}</ul>
    </section>`;
  }
  function renderPack(id) {
    const pk = PACKS.get(id);
    setMid(pk.name);
    const prompts = DATA.prompts.filter((p) => p.pack === id);
    const runs = E.packRunCount(DATA, id);
    app.innerHTML = `<section class="screen stack">
      <div class="panel"><div class="pack-head"><span class="em">${pk.emoji}</span><div><h2>${esc(pk.name)}</h2><p class="muted small" style="margin:4px 0 0">${esc(pk.tagline)} · ${prompts.length} prompts · ${fmt(prompts.reduce((s, p) => s + p.answers.length, 0))} answers</p></div></div></div>
      <ul class="list">${Array.from({ length: runs }, (_, i) => {
        const n = i + 1, rec = records[`pack:${id}:${n}`], prog = LS.get(`run:pack:${id}:${n}`);
        const ids = E.packPromptIds(DATA, id, n);
        return `<li><a class="list-item" href="#${rec ? `results-${slugFor(rec.key)}` : `pack-${id}-${n}`}">
          <span class="em">${rec ? "✓" : prog ? "…" : "▶"}</span>
          <span class="main"><span class="title">Run ${n}</span><span class="sub" style="display:block">${rec ? rec.tiers.map(E.tierEmoji).join("") : `${ids.length} prompts${prog ? " · in progress" : ""}`}</span></span>
          <span class="right">${rec ? `${rec.score}/${ids.length * 100}` : ""}</span></a></li>`;
      }).join("")}</ul>
      <a class="btn ghost" href="#packs">← All packs</a>
    </section>`;
  }

  // ============================================================= archive
  function renderArchive() {
    setMid("archive");
    const n = todayNumber();
    const rows = [];
    for (let d = n; d >= 1; d--) {
      const date = E.dateForDay(d);
      const rec = records[`daily:${date}`] || records[`archive:${date}`];
      const prog = !rec && (LS.get(`run:daily:${date}`) || LS.get(`run:archive:${date}`));
      rows.push(`<li><a class="list-item" href="#${rec ? `results-${slugFor(rec.key)}` : d === n ? "daily" : `archive-${date}`}">
        <span class="em">${d === n ? "☀" : rec ? (rec.mode === "daily" ? "✓" : "⟲") : "·"}</span>
        <span class="main"><span class="title">MLion #${d}${d === n ? " · today" : ""}</span><span class="sub" style="display:block">${esc(prettyDate(date))}${rec ? ` · ${rec.tiers.map(E.tierEmoji).join("")}` : prog ? " · in progress" : ""}</span></span>
        <span class="right">${rec ? `${rec.score}/700` : "play ▶"}</span></a></li>`);
    }
    app.innerHTML = `<section class="screen stack">
      <div class="panel"><p class="kicker">⟲ archive</p><h2>Every daily descent</h2>
        <p class="muted small" style="margin:6px 0 0">Missed a day? Replay it here. Archive runs don't count toward your streak.${n === 1 ? " MLion launched today, so tomorrow's archive gets its first entry." : ""}</p></div>
      <ul class="list">${rows.join("")}</ul>
    </section>`;
  }

  // ============================================================= library
  function renderLibrary() {
    setMid("library");
    const total = DATA.prompts.reduce((s, p) => s + p.answers.length, 0);
    app.innerHTML = `<section class="screen stack">
      <div class="panel"><p class="kicker">library</p><h2>${DATA.prompts.length} prompts · ${fmt(total)} answers</h2>
        <p class="muted small" style="margin:6px 0 10px">Practice any prompt on its own. Answer keys unlock once you've answered a prompt in any mode, so nothing gets spoiled.</p>
        <input class="search" id="lib-q" type="search" placeholder="filter prompts…" aria-label="Filter prompts"></div>
      <div id="lib"></div>
    </section>`;
    const draw = () => {
      const q = E.fullKey($("#lib-q").value);
      $("#lib").innerHTML = DATA.packs.map((pk) => {
        const ps = DATA.prompts.filter((p) => p.pack === pk.id && (!q || E.fullKey(p.text).includes(q)));
        if (!ps.length) return "";
        return `<div class="panel"><p class="kicker">${pk.emoji} ${esc(pk.name)}</p><ul class="list">${ps.map((p) => {
          const best = practiceBest[p.id];
          const unlocked = seen.has(p.id);
          return `<li class="list-item" style="cursor:default">
            <span class="main"><span class="title">${esc(p.text)}</span><span class="sub" style="display:block">${fmt(p.answers.length)} answers${best ? ` · practice best ${best === "miss" ? E.MISS_EMOJI : T[best].emoji}` : ""}</span></span>
            <span class="row"><a class="btn sm" href="#practice-${p.id}">Play</a>${unlocked ? `<a class="btn sm ghost" href="#answers-${p.id}">Key</a>` : `<span class="btn sm ghost" style="opacity:.4" title="Answer this prompt once to unlock">🔒</span>`}</span>
          </li>`;
        }).join("")}</ul></div>`;
      }).join("") || `<div class="panel muted">No prompts match.</div>`;
    };
    $("#lib-q").addEventListener("input", draw);
    draw();
  }
  function renderAnswersPage(id) {
    const p = PROMPTS.get(id);
    setMid("answer key");
    if (!seen.has(id)) {
      app.innerHTML = `<section class="screen stack"><div class="panel center"><h2>Locked</h2><p class="muted">Answer “${esc(p.text)}” once to unlock its key.</p><a class="btn primary" href="#practice-${id}">Practice it ▶</a></div></section>`;
      return;
    }
    app.innerHTML = `<section class="screen stack"><div class="panel">${answerKey(p, null, true)}</div><a class="btn ghost" href="#library">← Library</a></section>`;
    wireAnswerKeys(app);
  }

  // =============================================================== stats
  function renderStats() {
    setMid("stats");
    const s = statsSummary();
    const tierMax = Math.max(1, ...Object.values(s.tierCounts));
    const bandMax = Math.max(1, ...s.bands.map((b) => b.n));
    app.innerHTML = `<section class="screen stack">
      <div class="panel"><p class="kicker">your stats · daily descents</p>
        <div class="stat-grid">
          <div class="qs"><b>${s.played}</b><span>played</span></div>
          <div class="qs"><b>${s.avg || "—"}</b><span>average</span></div>
          <div class="qs"><b>${s.best || "—"}</b><span>best</span></div>
          <div class="qs"><b>${s.cur}</b><span>streak</span></div>
          <div class="qs"><b>${s.max}</b><span>max streak</span></div>
          <div class="qs"><b>${s.gems}</b><span>🦁 gems</span></div>
        </div></div>
      <div class="panel"><p class="kicker">score bands · daily</p><div class="bars">${s.bands.slice().reverse().map((b) => `
        <div class="bar-row" style="${tierVar(b.tier)}"><span class="lab">${esc(b.name)}</span><span class="tr"><i style="width:${(100 * b.n / bandMax).toFixed(0)}%"></i></span><span class="v">${b.n}</span></div>`).join("")}</div>
        <p class="small muted" style="margin:10px 0 0">${E.BANDS.map((b) => `${esc(b.name)} ${b.range}`).join(" · ")}</p></div>
      <div class="panel"><p class="kicker">tiers landed · all modes (${s.allRuns} runs)</p><div class="bars">${[...E.TIERS_BY_SCORE.map((t) => t.id), "miss"].map((t) => `
        <div class="bar-row" style="${tierVar(t)}"><span class="lab">${t === "miss" ? `${E.MISS_EMOJI} Miss` : `${T[t].emoji} ${esc(T[t].name)}`}</span><span class="tr"><i style="width:${(100 * s.tierCounts[t] / tierMax).toFixed(0)}%"></i></span><span class="v">${s.tierCounts[t]}</span></div>`).join("")}</div></div>
      <p class="small muted center">Stats live in this browser only. Clearing site data resets them.</p>
    </section>`;
  }

  // ======================================================== how / faq
  function howHtml() {
    return `<div class="prose">
      <p>Every day there are <b>7 ML prompts</b>, the same for everyone: “Name a loss function”, “Name a vision transformer”, “Name a Greek letter used in ML notation”…</p>
      <ol>
        <li>Each prompt shows for <b>3 seconds</b>, then you get <b>25 seconds</b> to answer.</li>
        <li>Type any valid answer and press <kbd>Enter</kbd>. If it isn't in the answer key you'll see <i>“no gradient”</i>; try again as often as you like until time runs out.</li>
        <li>Close misspellings trigger <b>autocorrect</b>, which suggests the nearest accepted answer. Press Step again to confirm, or keep typing. If several answers are close, tap the one you meant.</li>
        <li>Rarer accepted answers <b>descend deeper</b>. Your optimizer rolls down the loss landscape and your loss drops by points ÷ 100.</li>
      </ol>
      ${tierLegend()}
      <p style="margin-top:12px"><b>Max 700 a day.</b> ${E.BANDS.map((b) => `${esc(b.name)} ${b.range}`).join(" · ")}.</p>
      <p>When you finish, share your grid and browse every accepted answer for each prompt.</p>
    </div>`;
  }
  function renderHow() {
    setMid("how to play");
    app.innerHTML = `<section class="screen stack"><div class="panel"><p class="kicker">how to play</p><h2 style="margin-bottom:8px">Descend the loss landscape</h2>${howHtml()}
      <a class="btn primary block" href="#daily" style="margin-top:14px">▶ Start today's descent</a></div></section>`;
  }
  function renderFaq() {
    setMid("faq");
    const total = DATA.prompts.reduce((s, p) => s + p.answers.length, 0);
    app.innerHTML = `<section class="screen stack"><div class="panel"><p class="kicker">faq</p>
      <dl class="faq">
        <dt>How were the answer sets built?</dt>
        <dd>By merging what the field actually uses: framework docs (PyTorch, scikit-learn, Hugging Face), survey papers, textbooks, model cards and community lists. Each set is then deduplicated and cleaned, and aliases are added so abbreviations and full names both count. There are ${fmt(total)} accepted answers across ${DATA.prompts.length} prompts right now.</dd>
        <dt>How is rarity decided?</dt>
        <dd>By familiarity, not quality. Picture a thousand ML people with 25 seconds each. The tier reflects how many would think of the answer, judged by how visible it is in intro courses, docs, papers and ML social media. Tiers are fixed, so a score never changes after you play.</dd>
        <dt>Why isn't the 🦁 always the most obscure answer?</dt>
        <dd>Past a certain depth, “rarest” stops being meaningful and nobody would ever type it. The gem is picked for delight: a real, satisfying answer that a few strong players actually land.</dd>
        <dt>What is “Overfit”?</dt>
        <dd>The famous “obscure” pick, the one you type to look clever. So many people memorized it that it barely scores.</dd>
        <dt>Why did autocorrect suggest something odd?</dt>
        <dd>Autocorrect checks every alias, and some prompts have hundreds. A one-letter typo can land near an alias you didn't expect. With suggestions on (Settings), nothing is accepted until you confirm.</dd>
        <dt>My answer wasn't accepted, but it's real!</dt>
        <dd>Then the set is missing it. Please <a href="${REPO_URL}/issues" target="_blank" rel="noopener">open an issue</a> with the prompt and your answer. Each prompt is one JSON file in <code>data/prompts/</code>.</dd>
        <dt>When does the daily reset?</dt>
        <dd>At local midnight. Everyone gets the same 7 prompts for the same calendar date.</dd>
        <dt>Is anything tracked?</dt>
        <dd>No. There are no accounts, analytics or servers. Your runs, streaks and settings live in this browser's local storage.</dd>
      </dl></div></section>`;
  }

  // ============================================================ settings
  function renderSettings() {
    setMid("settings");
    const items = [
      ["previewCorrections", "Preview autocorrect", "Show the corrected answer and wait for you to confirm it. Off accepts corrections straight away."],
      ["clearRejected", "Clear rejected answers", "Empty the input after a wrong answer instead of selecting it."],
      ["sound", "Sound effects", "Ticks, chimes and the lion's roar."],
      ["reducedMotion", "Reduce motion", "Shorter animations and fewer particles."],
      ["shareLink", "Include link when sharing", "Append this page's address to your share text."],
      ["aiCheck", "Ask Claude when nothing matches", "If an answer isn't recognized, Claude checks whether you meant a listed answer, and you confirm it. Uses your Claude usage. Only on the claude.ai page."],
    ];
    app.innerHTML = `<section class="screen stack">
      <div class="panel"><p class="kicker">settings</p><div class="settings-list">${items.map(([k, t, d]) => `
        <label class="setting" ${k === "aiCheck" ? `id="ai-setting" ${aiUsable() ? "" : "hidden"}` : ""}><span class="txt"><b>${esc(t)}</b><span>${esc(d)}</span></span>
          <span class="switch"><input type="checkbox" data-k="${k}" ${settings[k] ? "checked" : ""}><i></i></span></label>`).join("")}</div></div>
      <div class="panel"><p class="kicker">progress</p>
        <p class="small muted" style="margin-top:0">Move your history to another browser: export it here and import it there.</p>
        <div class="btn-row"><button class="btn" id="exp">Export</button><button class="btn" id="imp">Import</button><button class="btn danger" id="reset">Reset all</button></div></div>
    </section>`;
    $$("input[data-k]").forEach((i) => i.addEventListener("change", () => { settings[i.dataset.k] = i.checked; saveSettings(); }));
    $("#exp").addEventListener("click", async () => {
      const blob = JSON.stringify({ v: 1, records, seen: [...seen], practice: practiceBest, settings });
      toast((await copyText(blob)) ? "Progress copied. Paste it into Import elsewhere" : "Couldn't copy");
    });
    $("#imp").addEventListener("click", () => {
      showModal("Import progress", `<p class="small muted">Paste exported progress. It merges with what's here; on a clash, the higher score wins.</p>
        <textarea id="imp-t" class="search" style="height:140px;padding:10px" aria-label="Exported progress"></textarea>
        <button class="btn primary block" id="imp-go" style="margin-top:10px">Import</button>`);
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
      showModal("Reset all progress?", `<p class="muted">This deletes every run, streak and stat stored in this browser. It can't be undone.</p>
        <div class="btn-row"><button class="btn" id="rs-no">Keep my progress</button><button class="btn danger" id="rs-yes">Delete everything</button></div>`);
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
    m.innerHTML = `<div class="modal-backdrop" id="mb"><div class="panel modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" id="mclose" aria-label="Close">✕</button></div>${html}</div></div>`;
    $("#mclose").addEventListener("click", closeModal);
    $("#mb").addEventListener("click", (e) => { if (e.target.id === "mb") closeModal(); });
    $("#mclose").focus();
  }
  function closeModal() { $("#modal").innerHTML = ""; }
  function showHowModal() {
    showModal("How to play", howHtml() + `<button class="btn primary block" id="how-go" style="margin-top:14px">Got it</button>`);
    $("#how-go").addEventListener("click", closeModal);
  }

  $("#menu-btn").addEventListener("click", openDrawer);
  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#brand").addEventListener("click", () => go("home"));

  V.initBackdrop();
  route();
})();
