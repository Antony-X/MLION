/* MLion engine: tiers, answer matching, scheduling, scoring, share text.
 * Shared by the browser game and the Node build/validation tools, so the
 * matching rules the validator checks are exactly the ones players hit. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MLION_ENGINE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- tiers
  const TIERS = {
    baseline: {
      id: "baseline", name: "Baseline", score: 10, emoji: "🐑", depth: 0.08,
      blurb: "The answer everyone blurts out.",
    },
    overfit: {
      id: "overfit", name: "Overfit", score: 15, emoji: "🦜", depth: 0.18,
      blurb: "The famous “obscure” pick. Everyone memorized it.",
    },
    indist: {
      id: "indist", name: "In-Distribution", score: 30, emoji: "📊", depth: 0.36,
      blurb: "Solid. Right in the fat middle of the bell curve.",
    },
    outlier: {
      id: "outlier", name: "Outlier", score: 60, emoji: "🦄", depth: 0.6,
      blurb: "Genuinely uncommon. Nice pull.",
    },
    longtail: {
      id: "longtail", name: "Long Tail", score: 85, emoji: "☄️", depth: 0.82,
      blurb: "True obscurity. Few sample this far out.",
    },
    mlion: {
      id: "mlion", name: "One in a MLion", score: 100, emoji: "🦁", depth: 0.97,
      blurb: "The designated gem. Global minimum.",
    },
  };
  const TIER_IDS = Object.keys(TIERS);
  const TIERS_BY_SCORE = TIER_IDS.map((k) => TIERS[k]).sort((a, b) => b.score - a.score);
  const MISS_EMOJI = "⬛";
  const ROUNDS = 7;
  const MAX_SCORE = ROUNDS * 100;
  const PREVIEW_MS = 3000;
  const ANSWER_MS = 25000;
  const MAX_ANSWER_LENGTH = 120;

  const BANDS = [
    { min: 0, tier: "baseline", name: "Underfit", range: "0–150", verdict: "Underfit. Plenty of loss left on the table." },
    { min: 151, tier: "indist", name: "Converging", range: "151–250", verdict: "Converging. Training with the herd." },
    { min: 251, tier: "outlier", name: "Generalizing", range: "251–350", verdict: "Generalizing. Past the saddle point. Nice." },
    { min: 351, tier: "longtail", name: "State of the Art", range: "351–449", verdict: "State of the art. Reviewer 2 is nervous." },
    { min: 450, tier: "mlion", name: "One in a MLion", range: "450+", verdict: "One in a MLion. Global minimum. Absurd." },
  ];
  function bandFor(score) {
    for (let i = BANDS.length - 1; i >= 0; i--) if (score >= BANDS[i].min) return BANDS[i];
    return BANDS[0];
  }
  /** Loss shown to players: starts at 7.00 and falls by points/100. */
  function lossFor(score) { return (MAX_SCORE - score) / 100; }

  // ---------------------------------------------------------- normalizing
  const GREEK = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ϵ": "epsilon",
    "ζ": "zeta", "η": "eta", "θ": "theta", "ϑ": "theta", "ι": "iota", "κ": "kappa",
    "λ": "lambda", "μ": "mu", "µ": "mu", "ν": "nu", "ξ": "xi", "ο": "omicron", "π": "pi",
    "ρ": "rho", "σ": "sigma", "ς": "sigma", "τ": "tau", "υ": "upsilon", "φ": "phi",
    "ϕ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
  };
  const GREEK_RE = new RegExp("[" + Object.keys(GREEK).join("") + "]", "g");
  const ARTICLES = new Set(["the", "a", "an"]);

  /** Split any string into lowercase ascii word tokens. */
  function tokens(s) {
    let t = String(s == null ? "" : s).toLowerCase();
    t = t.replace(GREEK_RE, (c) => " " + GREEK[c] + " ");
    t = t.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/\*/g, " star ").replace(/@/g, " at ");
    t = t.replace(/['’`]/g, ""); // don't split "Bayes'" / "Hinton's"
    return t.split(/[^a-z0-9]+/).filter(Boolean);
  }
  function fullKey(s) { return tokens(s).join(""); }
  /** Key with leading article and prompt-specific filler words removed. */
  function strippedKey(s, strip) {
    let tk = tokens(s);
    if (tk.length > 1 && ARTICLES.has(tk[0])) tk = tk.slice(1);
    if (strip && strip.size) {
      const kept = tk.filter((w) => !strip.has(w));
      if (kept.length) tk = kept;
    }
    return tk.join("");
  }
  function singular(k) {
    if (k.length > 4 && k.endsWith("es") && !k.endsWith("ses")) return k.slice(0, -2);
    if (k.length > 3 && k.endsWith("s") && !k.endsWith("ss")) return k.slice(0, -1);
    return k;
  }

  /** Optimal-string-alignment edit distance with early exit above `max`. */
  function editDistance(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let prev2 = null, prev = new Array(lb + 1), cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      const tmp = prev2 || new Array(lb + 1);
      prev2 = prev; prev = cur; cur = tmp;
    }
    return prev[lb];
  }
  function fuzzyBudget(len) {
    if (len <= 3) return 0;
    if (len <= 7) return 1;
    return 2;
  }

  /** Build the lookup index for one prompt. Returns {index, errors}. */
  function buildIndex(prompt) {
    const strip = new Set((prompt.strip || []).map((w) => fullKey(w)).filter(Boolean));
    const exact = new Map(); // key -> answer idx
    const errors = [];
    const answers = prompt.answers;
    function claim(key, idx, label) {
      if (!key) return;
      const had = exact.get(key);
      if (had === undefined) exact.set(key, idx);
      else if (had !== idx) {
        errors.push(`key "${key}" (from ${label}) collides: "${answers[had].a}" vs "${answers[idx].a}"`);
      }
    }
    answers.forEach((ans, idx) => {
      const names = [ans.a].concat(ans.aka || []);
      for (const n of names) {
        claim(fullKey(n), idx, `"${n}"`);
        claim(strippedKey(n, strip), idx, `"${n}" stripped`);
      }
    });
    // Plural-tolerant layer: only unambiguous singular forms.
    const loose = new Map();
    const looseBad = new Set();
    for (const [k, idx] of exact) {
      const s = singular(k);
      if (looseBad.has(s)) continue;
      const had = loose.get(s);
      if (had === undefined) loose.set(s, idx);
      else if (had !== idx) { loose.delete(s); looseBad.add(s); }
    }
    const keys = [...exact.keys()];
    return { index: { strip, exact, loose, keys }, errors };
  }

  /**
   * Match a raw player answer against a prompt.
   * Returns {kind:"exact", answer} | {kind:"correction", answer, from} | {kind:"none"}.
   */
  function matchAnswer(prompt, raw) {
    if (!prompt._index) prompt._index = buildIndex(prompt).index;
    const { strip, exact, loose, keys } = prompt._index;
    const text = String(raw || "").slice(0, MAX_ANSWER_LENGTH);
    const kf = fullKey(text);
    if (!kf) return { kind: "none" };
    const ks = strippedKey(text, strip);
    const answers = prompt.answers;
    for (const k of [kf, ks]) {
      if (exact.has(k)) return { kind: "exact", answer: answers[exact.get(k)] };
    }
    for (const k of [kf, ks]) {
      const s = singular(k);
      if (loose.has(s)) return { kind: "exact", answer: answers[loose.get(s)] };
      if (exact.has(s)) return { kind: "exact", answer: answers[exact.get(s)] };
    }
    // Fuzzy: nearest answer within the length-scaled budget. On a tie, a typo
    // is likelier to be aimed at the more common answer, so prefer the lower
    // tier; a tie inside the same tier stays ambiguous (no correction).
    let best = Infinity;
    let cands = new Set();
    for (const probe of ks === kf ? [kf] : [kf, ks]) {
      const budget = fuzzyBudget(probe.length);
      if (!budget) continue;
      for (const key of keys) {
        if (Math.abs(key.length - probe.length) > budget) continue;
        if (fuzzyBudget(key.length) === 0) continue;
        const d = editDistance(probe, key, Math.min(budget, best));
        if (d > budget) continue;
        const idx = exact.get(key);
        if (d < best) { best = d; cands = new Set([idx]); }
        else if (d === best) cands.add(idx);
      }
    }
    if (cands.size) {
      const list = [...cands].map((i) => answers[i]);
      const low = Math.min(...list.map((a) => TIERS[a.t].score));
      const pick = list.filter((a) => TIERS[a.t].score === low);
      if (pick.length === 1) return { kind: "correction", answer: pick[0], from: text };
    }
    return { kind: "none" };
  }

  // ------------------------------------------------------------- random
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x1000193); }
    return h >>> 0;
  }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ------------------------------------------------------------- dates
  const EPOCH = "2026-11-04"; // MLion #1
  function pad(n) { return String(n).padStart(2, "0"); }
  function localDateString(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }
  function dayNumberFor(dateStr) { return Math.round((parseDate(dateStr) - parseDate(EPOCH)) / 864e5) + 1; }
  function dateForDay(n) { return new Date(parseDate(EPOCH) + (n - 1) * 864e5).toISOString().slice(0, 10); }
  function addDays(dateStr, n) { return new Date(parseDate(dateStr) + n * 864e5).toISOString().slice(0, 10); }
  function msUntilLocalMidnight(now = new Date()) {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return next - now;
  }

  // --------------------------------------------------------- scheduling
  /**
   * An endless deterministic stream of prompt ids. Each cycle shuffles every
   * pack, then deals round-robin across packs so consecutive prompts vary.
   */
  function makeStream(data, seedLabel, packFilter) {
    const packs = data.packs.filter((p) => !packFilter || packFilter === p.id);
    const byPack = packs.map((p) => data.prompts.filter((q) => q.pack === p.id).map((q) => q.id));
    let cycle = 0, buf = [];
    function refill() {
      const rng = mulberry32(hashString(`${seedLabel}:${cycle++}`));
      const decks = shuffled(byPack.map((ids) => shuffled(ids, rng)), rng);
      const out = [];
      let more = true;
      for (let r = 0; more; r++) {
        more = false;
        for (const d of decks) if (r < d.length) { out.push(d[r]); more = true; }
      }
      buf = buf.concat(out);
    }
    return {
      /** Next `n` distinct ids (no repeats inside one run). */
      take(n) {
        const run = [];
        let guard = 0;
        while (run.length < n && guard++ < 10000) {
          if (!buf.length) refill();
          const id = buf.shift();
          if (!run.includes(id)) run.push(id);
          else buf.push(id);
        }
        return run;
      },
    };
  }
  const _runCache = new Map();
  /** The 7 prompt ids for run number `n` (1-based) of a stream. */
  function runFor(data, streamLabel, n, packFilter) {
    const key = `${streamLabel}|${packFilter || ""}|${data.version}`;
    let c = _runCache.get(key);
    if (!c) { c = { stream: makeStream(data, streamLabel, packFilter), runs: [] }; _runCache.set(key, c); }
    while (c.runs.length < n) c.runs.push(c.stream.take(ROUNDS));
    return c.runs[n - 1];
  }
  function dailyPromptIds(data, dayNumber) { return runFor(data, "daily-v1", Math.max(1, dayNumber)); }
  function unlimitedPromptIds(data, n) { return runFor(data, "unlimited-v1", n); }
  function packPromptIds(data, packId, n) {
    const pool = data.prompts.filter((p) => p.pack === packId).length;
    return runFor(data, `pack-${packId}-v1`, n, packId).slice(0, Math.min(ROUNDS, pool));
  }
  function packRunCount(data, packId) {
    const pool = data.prompts.filter((p) => p.pack === packId).length;
    return Math.max(1, Math.ceil(pool / ROUNDS));
  }

  // -------------------------------------------------------------- share
  function tierEmoji(t) { return t && TIERS[t] ? TIERS[t].emoji : MISS_EMOJI; }
  function shareText({ mode = "daily", number, score, tiers, label }) {
    const grid = tiers.map(tierEmoji).join("");
    const tag = mode === "daily" ? `MLion #${number}` :
      mode === "archive" ? `MLion ⟲ #${number}` :
      mode === "unlimited" ? `MLion ∞ #${number}` : `MLion · ${label || mode} #${number}`;
    const loss = (tiers.length * 100 - score) / 100;
    return `${tag} 🦁\n${score}/${tiers.length * 100} · loss ${loss.toFixed(2)}\n\n${grid}`;
  }

  return {
    TIERS, TIER_IDS, TIERS_BY_SCORE, MISS_EMOJI, ROUNDS, MAX_SCORE, PREVIEW_MS, ANSWER_MS,
    MAX_ANSWER_LENGTH, BANDS, bandFor, lossFor,
    tokens, fullKey, strippedKey, singular, editDistance, buildIndex, matchAnswer,
    mulberry32, hashString, shuffled,
    EPOCH, localDateString, dayNumberFor, dateForDay, addDays, msUntilLocalMidnight,
    makeStream, runFor, dailyPromptIds, unlimitedPromptIds, packPromptIds, packRunCount,
    tierEmoji, shareText,
  };
});
