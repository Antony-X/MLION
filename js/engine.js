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

  const NUMBER_WORDS = {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  };
  // Generic words that never tell two answers apart; dropped in a soft layer.
  const SOFT_FILLER = new Set([
    "model", "models", "algorithm", "algorithms", "method", "methods", "technique", "techniques",
    "framework", "frameworks", "library", "libraries", "approach", "system", "tool", "tools",
  ]);
  const STOP = new Set(["of", "the", "and", "for", "with", "a", "an", "in", "on", "to", "via", "by", "using"]);

  /** Split any string into lowercase ascii word tokens. */
  function tokens(s) {
    let t = String(s == null ? "" : s).toLowerCase();
    t = t.replace(GREEK_RE, (c) => " " + GREEK[c] + " ");
    t = t.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/\*/g, " star ").replace(/@/g, " at ").replace(/([a-z])#/g, "$1 sharp ");
    t = t.replace(/['’`]/g, ""); // don't split "Bayes'" / "Hinton's"
    return t.split(/[^a-z0-9]+/).filter((w) => w && w !== "version").map((w) => NUMBER_WORDS[w] || w);
  }
  /** Join tokens into a key; "v" before a version number is dropped (YOLOv8 = YOLO 8). */
  function joinKey(tk) { return tk.join("").replace(/(^|[a-z])v(\d)/g, "$1$2"); }
  function fullKey(s) { return joinKey(tokens(s)); }
  function dropArticle(tk) { return tk.length > 1 && ARTICLES.has(tk[0]) ? tk.slice(1) : tk; }
  function without(tk, set) {
    if (!set || !set.size) return tk;
    const kept = tk.filter((w) => !set.has(w));
    return kept.length ? kept : tk;
  }
  /** Key with leading article and prompt-specific filler words removed. */
  function strippedKey(s, strip) { return joinKey(without(dropArticle(tokens(s)), strip)); }
  function softKey(s, strip) { return joinKey(without(without(dropArticle(tokens(s)), strip), SOFT_FILLER)); }
  /** Initials of a multi-word name: "long short-term memory" -> lstm, "mixture of experts" -> moe. */
  function acronyms(s) {
    const tk = dropArticle(tokens(s));
    const out = new Set();
    if (tk.length < 2) return out;
    for (const list of [tk.filter((w) => !STOP.has(w)), tk]) {
      if (list.length < 2) continue;
      const ac = list.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("");
      const longWords = list.every((w) => w.length >= 3);
      if (ac.length >= 3 || (ac.length === 2 && longWords)) out.add(joinKey([ac]));
    }
    return out;
  }
  /** The words that carry meaning, for word-by-word typo matching. */
  function contentWords(s, strip) {
    return without(without(dropArticle(tokens(s)), strip), SOFT_FILLER).filter((w) => !STOP.has(w));
  }
  /** Words in a fixed order, so a name typed back to front finds its answer. */
  function bagKey(w) { return [...w].sort().join(" "); }
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
  /** Typos allowed for a key of this length. */
  function fuzzyBudget(len) {
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    return 3;
  }
  function trigrams(key) {
    const s = "^^" + key + "$";
    const m = new Map();
    for (let i = 0; i + 3 <= s.length; i++) { const g = s.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  }

  /** Map of key -> answer index where ambiguous keys are dropped instead of erroring. */
  function softMap(pairs) {
    const m = new Map(), bad = new Set();
    for (const [k, idx] of pairs) {
      if (!k || bad.has(k)) continue;
      const had = m.get(k);
      if (had === undefined) m.set(k, idx);
      else if (had !== idx) { m.delete(k); bad.add(k); }
    }
    return m;
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
    const softPairs = [], acPairs = [], words = [];
    answers.forEach((ans, idx) => {
      for (const n of [ans.a].concat(ans.aka || [])) {
        claim(fullKey(n), idx, `"${n}"`);
        claim(strippedKey(n, strip), idx, `"${n}" stripped`);
        softPairs.push([softKey(n, strip), idx]);
        for (const ac of acronyms(n)) acPairs.push([ac, idx]);
        const seen = new Set();
        for (const w of [contentWords(n, strip), contentWords(n, null)]) {
          if (w.length >= 2 && !seen.has(w.join(" "))) { seen.add(w.join(" ")); words.push({ idx, w }); }
        }
      }
    });
    const keys = [...exact.keys()];
    // Plural-tolerant, filler-tolerant and acronym layers: only unambiguous keys survive.
    const loose = softMap(keys.map((k) => [singular(k), exact.get(k)]));
    const soft = softMap(softPairs);
    const acro = softMap(acPairs.filter(([k]) => !exact.has(k)));
    // Word order: "Knuth Donald", "Hastings Metropolis". Only names of two to four words, and only
    // when no other answer has the same words.
    const bag = softMap(words.filter(({ w }) => w.length <= 4).map(({ idx, w }) => [bagKey(w), idx]));
    // Character-trigram TF-IDF vectors: a small "embedding" for near-miss suggestions.
    const df = new Map();
    const grams = keys.map((k) => { const g = trigrams(k); for (const t of g.keys()) df.set(t, (df.get(t) || 0) + 1); return g; });
    const N = keys.length || 1;
    const idf = (t) => Math.log(1 + N / (df.get(t) || 0.5));
    const vecs = grams.map((g) => {
      let norm = 0;
      const w = new Map();
      for (const [t, c] of g) { const v = c * idf(t); w.set(t, v); norm += v * v; }
      return { w, norm: Math.sqrt(norm) || 1 };
    });
    return { index: { strip, exact, loose, soft, acro, bag, keys, vecs, idf, words }, errors };
  }

  /**
   * Match a raw player answer against a prompt. Returns one of:
   *   {kind: "exact", answer}                    accepted as typed
   *   {kind: "correction", answer, from}         one confident near miss ("did you mean X?")
   *   {kind: "suggest", suggestions: [answer]}   a few plausible near misses
   *   {kind: "none"}
   */
  /** True when an answer is listed under a name of two or more real words. */
  function hasLongForm(a) {
    return [a.a].concat(a.aka || []).some((n) => tokens(n).filter((w) => w.length >= 3 && !/^\d+$/.test(w)).length >= 2);
  }
  // Every answer key in the game (set by the app with setLexicon). A player who types something that
  // is a real answer somewhere else meant that thing, not a typo of an answer here: a fuzzy match is
  // only offered ("did you mean"), never accepted on its own.
  let LEXICON = null, LEXWHERE = null; // every answer key; key -> ids of the prompts it answers
  function setLexicon(prompts) {
    LEXICON = new Set(); LEXWHERE = new Map();
    for (const p of prompts) for (const a of p.answers || []) for (const n of [a.a].concat(a.aka || [])) {
      const k = fullKey(n);
      if (!k) continue;
      LEXICON.add(k);
      if (!LEXWHERE.has(k)) LEXWHERE.set(k, []);
      if (!LEXWHERE.get(k).includes(p.id)) LEXWHERE.get(k).push(p.id);
    }
  }
  /** The other prompts a typed answer belongs to, exactly as typed ("ReLU" under "Name an optimizer"). */
  function whereElse(raw, exceptId) {
    return LEXWHERE ? (LEXWHERE.get(fullKey(raw)) || []).filter((id) => id !== exceptId) : [];
  }
  function matchAnswer(prompt, raw) {
    const m = matchRaw(prompt, raw);
    if (m.kind === "correction" && LEXICON && LEXICON.has(fullKey(raw))) return { kind: "suggest", suggestions: [m.answer], confidence: Math.min(m.confidence || 0.9, 0.7), via: "known-elsewhere" };
    return m;
  }
  function matchRaw(prompt, raw) {
    if (!prompt._index) prompt._index = buildIndex(prompt).index;
    const { strip, exact, loose, soft, acro, bag, keys, vecs, idf, words } = prompt._index;
    const text = String(raw || "").slice(0, MAX_ANSWER_LENGTH);
    const kf = fullKey(text);
    if (!kf) return { kind: "none" };
    const ks = strippedKey(text, strip);
    const kso = softKey(text, strip);
    const answers = prompt.answers;
    const hit = (idx) => ({ kind: "exact", answer: answers[idx] });
    for (const k of [kf, ks]) if (exact.has(k)) return hit(exact.get(k));
    for (const k of [kf, ks]) {
      const s = singular(k);
      if (loose.has(s)) return hit(loose.get(s));
      if (exact.has(s)) return hit(exact.get(s));
    }
    for (const k of [kso, singular(kso)]) if (soft.has(k)) return hit(soft.get(k));
    for (const k of [kf, ks]) if (acro.has(k)) return hit(acro.get(k));
    for (const w of [contentWords(text, strip), contentWords(text, null)]) {
      if (w.length >= 2 && w.length <= 4 && bag.has(bagKey(w))) return { kind: "correction", answer: answers[bag.get(bagKey(w))], from: text, confidence: 0.92, via: "order" };
    }
    // The player typed the long form of an answer listed only as initials. Decided after the typo
    // check: "Binarized nural network" has the initials of BNN (Bayesian NN), but it is a typo.
    // Only for answers that have no long form of their own: "Prompt injection" is not PI when the
    // list already spells PI out as "Probability of improvement".
    let acIdx = -1;
    for (const ac of acronyms(text)) if (exact.has(ac) && !hasLongForm(answers[exact.get(ac)])) { acIdx = exact.get(ac); break; }
    // the same initials, long form or not: only a tie-breaker between close typos ("Geetic algorithm": GA)
    const acTie = [...acronyms(text)].map((ac) => (exact.has(ac) ? answers[exact.get(ac)] : null)).filter(Boolean);

    // ---- fuzzy: score every answer by its best key, then decide.
    const probes = [...new Set([kf, ks, kso])].filter(Boolean);
    const qv = probes.map((p) => {
      const w = new Map(); let norm = 0;
      for (const [t, c] of trigrams(p)) { const v = c * idf(t); w.set(t, v); norm += v * v; }
      return { p, w, norm: Math.sqrt(norm) || 1 };
    });
    const score = new Map(); // answer idx -> best score
    const typo = new Map(); // answer idx -> best edit-distance score
    const bump = (m, idx, s) => { if (s > (m.get(idx) || 0)) m.set(idx, s); };
    keys.forEach((key, ki) => {
      const idx = exact.get(key);
      const kv = vecs[ki];
      for (const q of qv) {
        // 1. typos: edit distance within a length-scaled budget
        const budget = Math.min(fuzzyBudget(q.p.length), fuzzyBudget(key.length));
        if (budget && Math.abs(key.length - q.p.length) <= budget) {
          const d = editDistance(q.p, key, budget);
          if (d <= budget) {
            const s = 1 - (0.6 * d) / Math.max(key.length, q.p.length);
            bump(typo, idx, s); bump(score, idx, s);
          }
        }
        // 2. character-trigram cosine similarity
        let dot = 0;
        for (const [t, v] of q.w) { const u = kv.w.get(t); if (u) dot += u * v; }
        bump(score, idx, dot / (q.norm * kv.norm));
        // 3. containment: "efficientnetb" contains "efficientnet"; "llama" sits inside "llama3"
        const short = q.p.length < key.length ? q.p : key, long = short === key ? q.p : key;
        if (short.length >= 4 && short.length / long.length >= 0.5 && long.includes(short)) {
          bump(score, idx, 0.45 + 0.5 * (short.length / long.length));
        }
      }
    });
    // 4. word by word: every word of a multi-word name within its own typo budget
    const iws = [contentWords(text, strip), contentWords(text, null)].filter((w, i, all) => w.length >= 2 && (i === 0 || w.join(" ") !== all[0].join(" ")));
    for (const iw of iws) {
      for (const { idx, w } of words) {
        if (w.length !== iw.length) continue;
        let edits = 0, okAll = true;
        for (let i = 0; i < w.length && okAll; i++) {
          const b = Math.min(fuzzyBudget(w[i].length), fuzzyBudget(iw[i].length));
          const d = w[i] === iw[i] ? 0 : editDistance(iw[i], w[i], b);
          if (d > b) okAll = false; else edits += d;
        }
        if (okAll && edits > 0) {
          const sc = Math.max(0.8, 0.96 - 0.03 * edits);
          bump(typo, idx, sc); bump(score, idx, sc);
        }
      }
    }
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || TIERS[answers[a[0]].t].score - TIERS[answers[b[0]].t].score);
    if (!ranked.length) return { kind: "none" };
    // A single clear typo wins outright; ties go to the more common answer only across tiers.
    const typos = [...typo.entries()].sort((a, b) => b[1] - a[1]);
    if (acIdx >= 0 && !(typos.length && typos[0][1] >= 0.85)) return { kind: "correction", answer: answers[acIdx], from: text, confidence: 0.9, via: "initials" };
    if (typos.length) {
      const best = typos[0][1];
      const near = typos.filter(([, s]) => s >= best - 0.04).map(([i]) => answers[i]);
      const tied = typos.filter(([, s]) => s === best).map(([i]) => answers[i]);
      const low = Math.min(...tied.map((a) => TIERS[a.t].score));
      const pick = tied.filter((a) => TIERS[a.t].score === low);
      if (near.length === 1 || (near.length === tied.length && pick.length === 1 && best >= 0.85)) {
        return { kind: "correction", answer: near.length === 1 ? near[0] : pick[0], from: text, confidence: best, via: "typo" };
      }
      // close typos of several answers, and the initials point at one of them: that one
      const byInitials = near.filter((a) => acTie.includes(a));
      if (near.length > 1 && byInitials.length === 1) return { kind: "correction", answer: byInitials[0], from: text, confidence: typo.get(answers.indexOf(byInitials[0])), via: "typo" };
      if (near.length > 1) return { kind: "suggest", suggestions: near.slice(0, 3), confidence: best };
    }
    const [i1, s1] = ranked[0];
    const s2 = ranked[1] ? ranked[1][1] : 0;
    if (s1 >= 0.8 && s1 - s2 >= 0.08) return { kind: "correction", answer: answers[i1], from: text, confidence: s1, via: "similar" };
    const sugg = ranked.filter(([, s]) => s >= 0.55).slice(0, 3).map(([i]) => answers[i]);
    if (sugg.length) return { kind: "suggest", suggestions: sugg, confidence: s1 };
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
  // Launch day: MLion #1 and Daily Quiz #1, and day 1 of the hand-picked launch week (data/daily.json).
  // null until the game launches: every day is #1 then, and the daily deals from a pre-launch
  // stream that never touches the launch week. Set it to the launch date ("YYYY-MM-DD") that day.
  const LAUNCH = (typeof window !== "undefined" && window.MLION_LAUNCH) || null; // tests set window.MLION_LAUNCH
  const epoch = () => LAUNCH || localDateString();
  function pad(n) { return String(n).padStart(2, "0"); }
  function localDateString(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }
  function dayNumberFor(dateStr) { return Math.round((parseDate(dateStr) - parseDate(epoch())) / 864e5) + 1; }
  function dateForDay(n) { return new Date(parseDate(epoch()) + (n - 1) * 864e5).toISOString().slice(0, 10); }
  /** Whole days from `a` to `b` (both YYYY-MM-DD). */
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 864e5); }
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
  // flat: one shuffled deck of every prompt, so each comes up equally often and runs aren't
  // forced to hold one prompt per pack (that bunched small packs together: a 5-prompt pack
  // showed up in five runs in a row). Without flat, the old pack-interleaved deal (kept so
  // dailies dealt with it keep their questions).
  // skipFirst (a Set of ids): the first flat cycle leaves these out, so a stream that follows a
  // hand-picked stretch (the launch week) deals the prompts that stretch didn't use first.
  function makeStream(data, seedLabel, packFilter, flat, skipFirst) {
    const packs = data.packs.filter((p) => !packFilter || packFilter === p.id);
    const byPack = packs.map((p) => data.prompts.filter((q) => q.pack === p.id).map((q) => q.id));
    let cycle = 0, buf = [];
    function refill() {
      const first = cycle === 0;
      const rng = mulberry32(hashString(`${seedLabel}:${cycle++}`));
      if (flat) {
        const ids = [].concat(...byPack), rest = first && skipFirst ? ids.filter((id) => !skipFirst.has(id)) : ids;
        buf = buf.concat(shuffled(rest.length ? rest : ids, rng));
        return;
      }
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
  function runFor(data, streamLabel, n, packFilter, flat, skipFirst) {
    const key = `${streamLabel}|${packFilter || ""}|${data.version}|${flat ? "flat" : "packs"}|${skipFirst ? [...skipFirst].sort().join(",") : ""}`;
    let c = _runCache.get(key);
    if (!c) { c = { stream: makeStream(data, streamLabel, packFilter, flat, skipFirst), runs: [] }; _runCache.set(key, c); }
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

  // --------------------------------------------------------------- quiz
  // Multiple choice built from the same data: the question is a prompt, the
  // right option is one of its well-known answers, the three wrong ones are
  // answers of other prompts that the prompt's own matcher would turn down.
  const QUIZ_TIERS = ["baseline", "overfit", "indist", "outlier"]; // familiar enough to be the right option
  const QUIZ_TIER_WEIGHT = { baseline: 0.25, overfit: 0.15, indist: 0.35, outlier: 0.25 };
  const QUIZ_OPTIONS = 4;
  const QUIZ_POINTS = 100;
  const QUIZ_ROUNDS = 7;
  const QUIZ_HIT_EMOJI = "🟩";
  // Reasoning questions (data.reasoning, ids rq-NN): hand-written, four options, one right. They
  // take two of every seven quiz slots and get a longer clock, since there is a paragraph to read.
  const REASONING_SHARE = 2 / 7;
  const REASONING_CLOCK = 2.4; // a reasoning question gets 2.4x the clock: 25 s becomes 60 s
  const isReasoningId = (id) => typeof id === "string" && id.startsWith("rq-");
  const reasoningCount = (data, n) => Math.min((data.reasoning || []).length, Math.round(n * REASONING_SHARE));
  function reasoningQuestion(data, id) {
    const r = (data.reasoning || []).find((x) => x.id === id);
    return r ? { promptId: r.id, options: r.options.slice(), correct: r.answer, from: r.options.map(() => null), reasoning: true } : null;
  }
  function reasoningStream(data, label) {
    return makeStream({ packs: [{ id: "rq" }], prompts: (data.reasoning || []).map((r) => ({ id: r.id, pack: "rq" })) }, label, null, true);
  }
  const _reasonRuns = new Map();
  /** The reasoning ids for solo quiz run `n`: dealt in order from one stream, so runs don't repeat until the bank is used up. */
  function reasoningRun(data, n, per, label = "reason-v1") {
    const key = `${label}|${(data.reasoning || []).map((r) => r.id).join()}|${per}`;
    let c = _reasonRuns.get(key);
    if (!c) { c = { stream: reasoningStream(data, label), runs: [] }; _reasonRuns.set(key, c); }
    while (c.runs.length < n) c.runs.push(c.stream.take(per));
    return c.runs[n - 1];
  }
  const _quizCtx = new WeakMap();
  /** On-topic prompts of a data bundle (never an `offtopic` one), indexed once. */
  function quizContext(data) {
    let c = _quizCtx.get(data);
    if (!c || c.n !== data.prompts.length) {
      const prompts = data.prompts.filter((p) => p && !p.offtopic && Array.isArray(p.answers) && p.answers.length);
      c = { n: data.prompts.length, prompts, byId: new Map(prompts.map((p) => [p.id, p])) };
      _quizCtx.set(data, c);
    }
    return c;
  }
  /** Every key an answer goes by: its name and its aliases. */
  function answerKeys(a) { return [a.a].concat(a.aka || []).map(fullKey).filter(Boolean); }
  /** A name the prompt's matcher doesn't recognise at all: no exact hit, no autocorrect, no "did you mean". */
  function foreignTo(prompt, a) {
    return [a.a].concat(a.aka || []).every((name) => matchAnswer(prompt, name).kind === "none");
  }
  /**
   * One question for one prompt, or null if the data can't supply a fair one.
   * Deterministic in (data, seedKey, promptId). Options are shuffled by the seed.
   * `trace`, if given, records where each distractor came from: {slots: [{stage, tierPass, from}]}
   * (stage 0 same pack, 1 another pack with a fresh prompt, 2 any prompt; tierPass 0 same tier
   * as the right answer, 1 any familiar tier, 2 any tier).
   */
  function quizQuestion(data, seedKey, promptId, trace) {
    if (isReasoningId(promptId)) return reasoningQuestion(data, promptId);
    const ctx = quizContext(data);
    const p = ctx.byId.get(promptId);
    if (!p) return null;
    const rng = mulberry32(hashString(`quiz:${seedKey}:${promptId}`));
    // the right option: pick a familiar tier by weight, then an answer inside it
    const byTier = new Map(QUIZ_TIERS.map((t) => [t, p.answers.filter((a) => a.t === t)]).filter(([, l]) => l.length));
    if (!byTier.size) return null;
    let roll = rng() * [...byTier.keys()].reduce((s, t) => s + QUIZ_TIER_WEIGHT[t], 0);
    let tier = [...byTier.keys()][0];
    for (const t of byTier.keys()) { roll -= QUIZ_TIER_WEIGHT[t]; if (roll < 0) { tier = t; break; } }
    const right = shuffled(byTier.get(tier), rng)[0];
    const picked = [{ text: right.a, from: p.id }];
    const keys = new Set(answerKeys(right));
    const usedFrom = new Set([p.id]);
    // wrong options: three of them, one slot at a time, widening the search only when a stage runs dry
    const others = shuffled(ctx.prompts.filter((q) => q.id !== p.id), rng);
    const stages = [
      () => others.filter((q) => q.pack === p.pack && !usedFrom.has(q.id)),
      () => others.filter((q) => q.pack !== p.pack && !usedFrom.has(q.id)),
      () => others,
    ];
    const tierPasses = [(a) => a.t === tier, (a) => QUIZ_TIERS.includes(a.t), () => true];
    const slots = [];
    while (picked.length < QUIZ_OPTIONS) {
      let found = null;
      search: for (let si = 0; si < stages.length; si++) {
        const pool = stages[si]();
        for (let ti = 0; ti < tierPasses.length; ti++) {
          for (const q of pool) {
            for (const a of shuffled(q.answers.filter(tierPasses[ti]), rng)) {
              const ks = answerKeys(a);
              if (!ks.length || ks.some((k) => keys.has(k))) continue; // same thing as an option already in
              if (!foreignTo(p, a)) continue; // the question's own matcher would take it
              found = { text: a.a, from: q.id, ks, si, ti };
              break search;
            }
          }
        }
      }
      if (!found) return null;
      picked.push({ text: found.text, from: found.from });
      found.ks.forEach((k) => keys.add(k));
      usedFrom.add(found.from);
      slots.push({ stage: found.si, tierPass: found.ti, from: found.from });
    }
    const order = shuffled(picked.map((_, i) => i), rng);
    const options = order.map((i) => picked[i].text);
    if (trace) trace.slots = slots;
    return { promptId: p.id, options, correct: order.indexOf(0), from: order.map((i) => picked[i].from) };
  }
  /**
   * `n` questions for a seed, each from a different prompt. Prompts come from `opts.promptIds`
   * first (when a run already has its prompts), then from the seed's own stream; a prompt that
   * can't make a fair question is passed over. Fewer than `n` come back only if the data runs out.
   */
  function quizFor(data, seedKey, n, opts) {
    const ctx = quizContext(data);
    const given = (opts && opts.promptIds) || [];
    // a list that already holds reasoning ids is a finished deal (a live guest rebuilding the
    // host's questions): build exactly that. Otherwise mix reasoning questions in by the seed.
    const exact = given.some(isReasoningId);
    const rIds = exact ? [] : (opts && opts.reasoningIds) || reasoningStream(data, `rq-${seedKey}`).take(reasoningCount(data, n));
    const dealt = ctx.prompts.filter((p) => data.packs.some((pk) => pk.id === p.pack)).length; // the stream only deals listed packs
    const want = Math.min(n - rIds.length, ctx.prompts.length + (exact ? given.filter(isReasoningId).length : 0));
    const stream = makeStream({ packs: data.packs, prompts: ctx.prompts }, `quiz-${seedKey}`, null, true);
    const ids = [...new Set(given.concat(stream.take(dealt)))];
    const out = [];
    for (const id of ids) {
      if (out.length >= want) break;
      const q = quizQuestion(data, seedKey, id);
      if (q) out.push(q);
    }
    if (!rIds.length) return out;
    // reasoning questions go into seeded slots, never two in a row when there's room
    const rng = mulberry32(hashString(`rq-slots:${seedKey}`));
    const total = out.length + rIds.length;
    let slots;
    for (let tries = 0; tries < 50; tries++) {
      slots = shuffled([...Array(total).keys()], rng).slice(0, rIds.length).sort((a, b) => a - b);
      if (slots.every((s, k) => k === 0 || s - slots[k - 1] > 1) || rIds.length * 2 > total) break;
    }
    const mixed = [], rq = rIds.map((id) => reasoningQuestion(data, id)).filter(Boolean);
    for (let i = 0, a = 0, b = 0; i < total; i++) {
      if (slots.includes(i) && b < rq.length) mixed.push(rq[b++]);
      else if (a < out.length) mixed.push(out[a++]);
    }
    return mixed;
  }
  /** Daily quiz `n` of a stream: the same seven questions for everyone, dealt like the daily so days don't repeat. */
  function dailyQuiz(data, n, label = "dquiz-v1") {
    return quizFor(data, `${label}:${n}`, QUIZ_ROUNDS, { promptIds: runFor(data, label, n, null, true), reasoningIds: reasoningRun(data, n, reasoningCount(data, QUIZ_ROUNDS), label === "dquiz-v1" ? "dquiz-reason-v1" : `${label}-reason`) });
  }
  /** Solo quiz run `n` (1-based): seven questions, the prompts dealt like Unlimited's so runs don't repeat. */
  function quizRun(data, n) {
    return quizFor(data, `quiz-v2:${n}`, QUIZ_ROUNDS, { promptIds: runFor(data, "quiz-v2", n, null, true), reasoningIds: reasoningRun(data, n, reasoningCount(data, QUIZ_ROUNDS)) });
  }

  // -------------------------------------------------------------- share
  function tierEmoji(t) { return t && TIERS[t] ? TIERS[t].emoji : MISS_EMOJI; }
  function shareText({ mode = "daily", number, score, tiers, label, secs }) {
    const quiz = mode === "quiz" || mode === "vq" || mode === "dquiz";
    const grid = quiz ? tiers.map((t) => (t && t !== "miss" ? QUIZ_HIT_EMOJI : MISS_EMOJI)).join("") : tiers.map(tierEmoji).join("");
    const tag = mode === "daily" ? `MLion #${number}` :
      mode === "archive" ? `MLion ⟲ #${number}` :
      mode === "unlimited" ? `MLion ∞ #${number}` :
      mode === "quiz" ? `MLion Quiz #${number}` :
      mode === "dquiz" ? `MLion Daily Quiz #${number}` : `MLion · ${label || mode} #${number}`;
    const loss = (tiers.length * 100 - score) / 100;
    const clock = secs && secs * 1000 !== ANSWER_MS ? ` · ${secs} s` : ""; // a different clock isn't the same game
    return `${tag} 🦁\n${score}/${tiers.length * 100} · loss ${loss.toFixed(2)}${clock}\n\n${grid}`;
  }

  return {
    TIERS, TIER_IDS, TIERS_BY_SCORE, MISS_EMOJI, ROUNDS, MAX_SCORE, PREVIEW_MS, ANSWER_MS,
    MAX_ANSWER_LENGTH, BANDS, bandFor, lossFor,
    tokens, fullKey, strippedKey, softKey, acronyms, singular, editDistance, buildIndex, matchAnswer, setLexicon, whereElse,
    mulberry32, hashString, shuffled,
    LAUNCH, epoch, localDateString, dayNumberFor, dateForDay, daysBetween, addDays, msUntilLocalMidnight,
    makeStream, runFor, dailyPromptIds, unlimitedPromptIds, packPromptIds, packRunCount,
    QUIZ_TIERS, QUIZ_OPTIONS, QUIZ_POINTS, QUIZ_ROUNDS, quizQuestion, quizFor, quizRun,
    REASONING_CLOCK, isReasoningId, reasoningQuestion, dailyQuiz,
    tierEmoji, shareText,
  };
});
