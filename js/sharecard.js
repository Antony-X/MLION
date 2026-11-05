/* MLion share card: a finished run as an image to post.
 *
 * The descent is the picture. The whole slope crosses the card from the rim (loss 7.00) to the
 * basin (0.00), painted by tier as far as the run went, the ball resting where it stopped. The
 * sky above the slope holds the result, the ground below it holds the hook (the rarest answer).
 * Two formats, drawn on a canvas at their real size:
 *   card   1200 x 630, the link-preview shape: wide enough for the slope, full width in a chat
 *   story  1080 x 1920, for Instagram stories; text stays clear of the app's top and bottom bars
 *
 *   MLION_CARD.specFor(rec, {url, packName})  what the card says, from a results record
 *   MLION_CARD.render(spec, format)           Promise<{canvas, blob}>, after the fonts are in
 *   MLION_CARD.draw(canvas, spec, format)     the drawing alone (sync)
 *   MLION_CARD.open({rec, text, url, packName, ui})  the share sheet: preview, format, actions
 *
 * Everything is drawn with canvas paths and the site's own font, never an image, so the canvas
 * is never tainted and toBlob always works. Uses MLION_ENGINE (tiers) and MLION_VISUALS
 * (the terrain, tier colours, glyphs and the lion mark). */
(function () {
  "use strict";
  const En = () => window.MLION_ENGINE;
  const Vi = () => window.MLION_VISUALS;

  const COL = {
    bg: "#0b0a08", earth: "#0f0d0a", ink: "#f2ede4", muted: "#a39b90", faint: "#8c857b", line: "#5c544a",
    gold: "#f2b53c", goldBand: "#e6a52c", goldInk: "#1a1306",
  };
  // the stage's light, from the rim (cold) to the basin (gold): js/landscape.js PAL, ends only
  const COLD = { path: "#737a82", strata: "#2b3035", rim: "#8a949e" };
  const WARM = { path: "#d89c34", strata: "#714b12", rim: "#f2b53c" };
  const FONT = 'Archivo, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const FORMATS = {
    card: { w: 1200, h: 630, name: "Card" },
    story: { w: 1080, h: 1920, name: "Story" },
  };
  const QUIZ_TIER = "indist"; // app.js colours a right quiz answer with this tier
  const LEVEL_RANK = { hard: 3, medium: 2, easy: 1 };
  const CHECK = "M4.5 12.5l4.8 4.8L19.5 6.8", CROSS = "M6.5 6.5l11 11M17.5 6.5l-11 11";

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };
  const mixHex = (a, b, t) => { const x = rgb(a), y = rgb(b); return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join(""); };

  // ------------------------------------------------------------------ spec
  /** Plain words for the address printed on the card. */
  function shortUrl(url) {
    let u = String(url || "").trim();
    if (!/^https?:\/\//.test(u) || /^https?:\/\/(localhost|127\.|\[::1\])/.test(u)) { // a dev server prints the public site
      u = ((document.querySelector('meta[property="og:url"]') || {}).content || "").trim();
    }
    return u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/index\.html$/, "").replace(/\/+$/, "");
  }
  function prettyDay(ds, long) {
    if (!ds) return "";
    const [y, m, d] = ds.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", long ? { weekday: "long", month: "long", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  const quizMode = (m) => m === "quiz" || m === "vq" || m === "dquiz";
  const clean = (s) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").trim();
  const trimName = (s) => { const t = clean(s); return t.length > 14 ? t.slice(0, 13).trimEnd() + "…" : t; };

  /** What the card says about a finished run. `rec` is a results record from app.js. */
  function specFor(rec, o = {}) {
    const E = En(), T = E.TIERS;
    const results = rec.results || [];
    const n = results.length, max = n * 100;
    const quiz = quizMode(rec.mode);
    const steps = results.map((r) => ({ tier: r.tier && T[r.tier] ? r.tier : null, pts: Math.max(0, +r.score || 0) }));
    const spec = {
      mode: rec.mode, quiz, n, max, score: rec.score, loss: ((max - rec.score) / 100).toFixed(2),
      steps, marks: steps.map((s) => (quiz ? (s.tier ? "hit" : "miss") : s.tier || "miss")),
      url: shortUrl(o.url), title: "", sub: "", band: null, hook: null, duel: null,
    };
    // the name line and the line under it
    const num = rec.number != null ? `#${rec.number}` : "";
    const day = prettyDay(rec.date, true);
    if (rec.mode === "daily") Object.assign(spec, { title: num, sub: day });
    else if (rec.mode === "archive") Object.assign(spec, { title: num, sub: `${day}, replayed` });
    else if (rec.mode === "dquiz") Object.assign(spec, { title: `Daily Quiz ${num}`, sub: day });
    else if (rec.mode === "quiz") Object.assign(spec, { title: `Quiz ${num}`, sub: "Seven questions, easy to hard" });
    else if (rec.mode === "unlimited") Object.assign(spec, { title: "Unlimited", sub: `Session ${rec.number || 1}, ${n} ${n === 1 ? "prompt" : "prompts"}` });
    else if (rec.mode === "vs") Object.assign(spec, { title: "Challenge", sub: `${n} ${n === 1 ? "prompt" : "prompts"}, head to head` });
    else if (rec.mode === "vq") Object.assign(spec, { title: "Quiz challenge", sub: `${n} ${n === 1 ? "question" : "questions"}, head to head` });
    else if (rec.mode === "pack") Object.assign(spec, { title: clean(o.packName || rec.label || "Pack"), sub: `Run ${rec.number || 1}` });
    else Object.assign(spec, { title: clean(rec.label || ""), sub: day });
    if (rec.secs && rec.secs * 1000 !== E.ANSWER_MS && rec.mode !== "dquiz") spec.sub += `${spec.sub ? ", " : ""}${rec.secs} s a question`;

    if (!quiz && n === 7) { const b = E.bandFor(rec.score); spec.band = { name: b.name, tier: b.tier }; }
    if (quiz) {
      const right = steps.filter((s) => s.tier).length;
      spec.band = { name: `${right} of ${n} right`, tier: right === n ? "mlion" : QUIZ_TIER };
    }

    // the hook: the rarest answer, or for a quiz the hardest question answered right
    if (!quiz) {
      let best = null, count = 0;
      for (const r of results) {
        if (!r.tier || !T[r.tier] || !r.answer) continue;
        if (!best || T[r.tier].score > T[best.tier].score) { best = r; count = 1; }
        else if (r.tier === best.tier) count++;
      }
      spec.hook = best
        ? { kind: "rarest", prompt: clean(best.promptText), answer: clean(best.answer), tier: best.tier, tierName: T[best.tier].name, count }
        : { kind: "none" };
    } else {
      const bank = new Map(((window.MLION_DATA && window.MLION_DATA.reasoning) || []).map((q) => [q.id, q]));
      let best = null;
      for (const r of results) {
        if (!(r.score > 0)) continue;
        const lv = (bank.get(r.promptId) || {}).lvl || "";
        const k = (LEVEL_RANK[lv] || 0) * 1e6 - (Number.isFinite(r.ms) ? r.ms : 1e5);
        if (!best || k > best.k) best = { r, lv, k };
      }
      spec.hook = best
        ? { kind: "quiz", question: clean(best.r.promptText), level: best.lv, secs: Number.isFinite(best.r.ms) ? best.r.ms / 1000 : null }
        : { kind: "none" };
    }

    // a challenge with both results in it: the friend's ball goes on the same slope
    if ((rec.mode === "vs" || rec.mode === "vq") && rec.opp) {
      let them, theirSteps;
      if (rec.mode === "vs") {
        theirSteps = (rec.opp.tiers || []).map((t) => ({ tier: T[t] ? t : null, pts: T[t] ? T[t].score : 0 }));
      } else {
        const qs = rec.quiz || [];
        theirSteps = (rec.opp.picks || []).map((p, i) => { const ok = !!qs[i] && p - 1 === qs[i].correct; return { tier: ok ? QUIZ_TIER : null, pts: ok ? E.QUIZ_POINTS : 0 }; });
      }
      them = theirSteps.reduce((s, x) => s + x.pts, 0);
      let c = rec.score - them; // positive: I'm ahead
      if (!c && rec.mode === "vq") c = (rec.opp.tenths || 0) - (rec.tenths || 0);
      const name = trimName(rec.opp.name) || "Friend";
      spec.duel = { name, score: them, steps: theirSteps, verdict: c > 0 ? "win" : c < 0 ? "lose" : "draw" };
      const by = Math.abs(rec.score - them);
      spec.band = { name: c > 0 ? (by ? `I win by ${by}` : "I win on time") : c < 0 ? (by ? `${name} wins by ${by}` : `${name} wins on time`) : "A draw", tier: c > 0 ? "mlion" : "baseline" };
    }
    return spec;
  }

  // ----------------------------------------------------------------- fonts
  /** Load the faces the card uses (the site's Archivo), for the text it will draw. Never waits long. */
  async function fontsReady(spec) {
    if (!document.fonts || !document.fonts.load) return;
    const text = [spec.title, spec.sub, spec.url, spec.hook && (spec.hook.prompt || spec.hook.question), spec.hook && spec.hook.answer,
      spec.duel && spec.duel.name, "MLion0123456789/., ofrightwinsdrawlossLongTail"].filter(Boolean).join(" ");
    const loads = ["300", "400", "500"].map((w) => document.fonts.load(`${w} 40px Archivo`, text).catch(() => null));
    await Promise.race([Promise.all(loads).then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 2500))]);
  }

  // ------------------------------------------------------------------ text
  function font(c, size, weight = 400, stretch = "normal", track = 0) {
    c.font = `${weight} ${size}px ${FONT}`;
    if ("fontStretch" in c) c.fontStretch = stretch;
    if ("letterSpacing" in c) c.letterSpacing = `${track}px`;
  }
  /** Break text into lines no wider than maxW; a word too long for a line is cut. */
  function wrap(c, text, maxW) {
    const lines = [];
    let line = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (c.measureText(t).width <= maxW) { line = t; continue; }
      if (line) lines.push(line);
      line = word;
      while (c.measureText(line).width > maxW && line.length > 1) { // one very long word: hard-break it
        let k = line.length - 1;
        while (k > 1 && c.measureText(line.slice(0, k)).width > maxW) k--;
        lines.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  function ellipsize(c, line, maxW) {
    let s = line;
    while (s.length > 1 && c.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s.replace(/[\s,.;:–-]+$/, "") + "…";
  }
  /** The largest size (from `sizes`) at which `text` fits in maxLines lines; at the smallest, the rest is cut with an ellipsis. */
  function fit(c, text, maxW, maxLines, sizes, weight = 400, stretch = "normal", trackEm = 0) {
    for (const s of sizes) {
      font(c, s, weight, stretch, s * trackEm);
      const lines = wrap(c, text, maxW);
      if (lines.length <= maxLines) return { size: s, lines };
    }
    const s = sizes[sizes.length - 1];
    font(c, s, weight, stretch, s * trackEm);
    const lines = wrap(c, text, maxW).slice(0, maxLines);
    lines[maxLines - 1] = ellipsize(c, lines[maxLines - 1], maxW);
    return { size: s, lines };
  }

  // ---------------------------------------------------------------- marks
  /** A tier mark (GLYPHS: a curve and the ball; the gem is the lion), `s` px tall, top-left at x, y. */
  function glyph(c, tier, x, y, s) {
    const V = Vi(), col = V.TIER_COLORS[tier] || V.TIER_COLORS.miss;
    c.save();
    c.strokeStyle = col; c.fillStyle = col; c.lineCap = "round"; c.lineJoin = "round";
    if (tier === "mlion") {
      const M = V.MARK, k = s / 64;
      c.translate(x + s / 2, y + s / 2); c.scale(k, k);
      c.lineWidth = M.stroke; c.stroke(new Path2D(M.d));
      c.beginPath(); c.arc(M.ball[0], M.ball[1], M.ball[2], 0, Math.PI * 2); c.fill();
    } else {
      const g = V.GLYPHS[tier] || V.GLYPHS.miss, k = s / 24;
      c.translate(x, y); c.scale(k, k);
      c.lineWidth = 2;
      if (g.ring) { c.beginPath(); c.arc(g.ring[0], g.ring[1], g.ring[2], 0, Math.PI * 2); c.stroke(); }
      else { c.stroke(new Path2D(g.d)); c.beginPath(); c.arc(g.ball[0], g.ball[1], g.ball[2], 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }
  function quizMark(c, ok, x, y, s) {
    const V = Vi();
    c.save();
    c.strokeStyle = ok ? V.TIER_COLORS[QUIZ_TIER] : V.TIER_COLORS.miss;
    c.lineCap = "round"; c.lineJoin = "round";
    c.translate(x, y); c.scale(s / 24, s / 24); c.lineWidth = 2.4;
    c.stroke(new Path2D(ok ? CHECK : CROSS));
    c.restore();
  }
  const ROW_MAX = 12; // more answers than this (a long session) and the row becomes a tally
  const TALLY = ["mlion", "longtail", "outlier", "indist", "overfit", "baseline", "miss"];
  /** The row of marks, one per answer like the text grid; past ROW_MAX, one mark per tier with its count. */
  function marksRow(c, spec, x, y, s, gap, align = "left") {
    const V = Vi();
    const items = spec.marks.length <= ROW_MAX ? spec.marks.map((m) => ({ m }))
      : (spec.quiz ? ["hit", "miss"] : TALLY).map((m) => ({ m, n: spec.marks.filter((k) => k === m).length })).filter((it) => it.n);
    const tally = items.some((it) => it.n);
    font(c, s * 0.75, 500);
    const wOf = (it) => s + (it.n ? s * 0.22 + c.measureText(String(it.n)).width : 0);
    const g = tally ? gap * 2.4 : gap;
    const w = items.reduce((a, it) => a + wOf(it), 0) + (items.length - 1) * g;
    let px = align === "right" ? x - w : x;
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    for (const it of items) {
      if (spec.quiz) quizMark(c, it.m === "hit", px, y, s);
      else glyph(c, it.m === "miss" ? null : it.m, px, y, s);
      if (it.n) {
        c.fillStyle = it.m === "hit" ? V.TIER_COLORS[QUIZ_TIER] : V.TIER_COLORS[it.m] || V.TIER_COLORS.miss;
        if (it.m === "miss") c.fillStyle = COL.muted;
        c.fillText(String(it.n), px + s * 1.22, y + s * 0.8);
      }
      px += wOf(it) + g;
    }
    return w;
  }
  /** The lion mark and the name: "MLion" set wide, as on the site. Returns the lockup's width. */
  function lockup(c, x, y, size, title) {
    const M = Vi().MARK, k = size / 64;
    c.save();
    c.translate(x + size * 0.5, y + size * 0.5); c.scale(k * 1.05, k * 1.05);
    c.strokeStyle = COL.gold; c.fillStyle = COL.gold; c.lineCap = "round"; c.lineJoin = "round"; c.lineWidth = M.stroke;
    c.stroke(new Path2D(M.d));
    c.beginPath(); c.arc(M.ball[0], M.ball[1], M.ball[2], 0, Math.PI * 2); c.fill();
    c.restore();
    const fs = size * 0.86;
    font(c, fs, 300, "expanded", -0.04 * fs);
    c.fillStyle = COL.ink; c.textBaseline = "alphabetic"; c.textAlign = "left";
    const base = y + size * 0.79;
    let tx = x + size * 1.16;
    c.fillText("MLion", tx, base);
    tx += c.measureText("MLion").width + fs * 0.3;
    if (title) {
      font(c, fs, 300, "normal", -0.01 * fs);
      c.fillStyle = COL.ink;
      c.fillText(title, tx, base);
      tx += c.measureText(title).width;
    }
    return tx - x;
  }

  // --------------------------------------------------------------- descent
  /** The slope, the run painted on it and the ball, inside box {x, y, w, h}. Returns where things
   * landed and `pathAt(sx)`, the slope's screen height at screen x, so text can keep clear of it. */
  function descent(c, spec, box, o) {
    const V = Vi();
    V.setRounds(spec.n);
    const END = Math.max(7, spec.n) * 1000;
    const xa = -o.lead * END, xb = END * (1 + o.tail);
    // the play stage's terrain, seen whole: its small ripples are smoothed away at this distance,
    // the swells and the terraces stay
    const N = 600, dx = (xb - xa) / N, raw = [];
    for (let i = 0; i <= N; i++) raw.push(V.terrain(xa + i * dx));
    const sig = (o.smooth * (xb - xa)) / dx, rad = Math.ceil(sig * 3), kern = [];
    for (let j = -rad; j <= rad; j++) kern.push(Math.exp(-(j * j) / (2 * sig * sig)));
    const ys = raw.map((_, i) => { let s = 0, w = 0; kern.forEach((k, j) => { const t = i + j - rad; if (t >= 0 && t <= N) { s += raw[t] * k; w += k; } }); return s / w; });
    let lo = Infinity, hi = -Infinity;
    ys.forEach((y) => { lo = Math.min(lo, y); hi = Math.max(hi, y); });
    const Y = (x) => { const f = clamp((x - xa) / dx, 0, N), i = Math.min(N - 1, Math.floor(f)), t = f - i; return ys[i] + (ys[i + 1] - ys[i]) * t; };
    const SX = (x) => box.x + ((x - xa) / (xb - xa)) * box.w;
    const SY = (y) => box.y + ((y - lo) / (hi - lo)) * box.h;
    const P = (x) => [SX(x), SY(Y(x))];
    const pathAt = (sx) => SY(Y(xa + ((sx - box.x) / box.w) * (xb - xa)));
    const step = (xb - xa) / (box.w / 2.5);
    const line = (a, b) => { const p = new Path2D(); for (let x = a, f = true; x <= b + 1e-6; x += step) { const [px, py] = P(Math.min(x, b)); if (f) { p.moveTo(px, py); f = false; } else p.lineTo(px, py); } const [ex, ey] = P(b); p.lineTo(ex, ey); return p; };
    const full = line(xa, xb);
    const [minX, minY] = P(END);
    const W = c.canvas.width, H = c.canvas.height;

    // the basin's light, in flat steps like the contours of the bowl it comes from
    // (flattened, so it lies on the basin floor rather than hanging in the sky like a sun)
    for (let k = o.bands; k >= 1; k--) {
      const r = o.glow * (k / o.bands) ** 1.15;
      c.fillStyle = rgba(COL.gold, 0.026);
      c.beginPath(); c.ellipse(minX, minY, r, r * 0.42, 0, 0, Math.PI * 2); c.fill();
    }

    // the ground under the slope, and the strata pressed into it
    const ground = new Path2D(full);
    ground.lineTo(SX(xb) + 4, H + 4); ground.lineTo(SX(xa) - 4, H + 4); ground.closePath();
    c.fillStyle = COL.earth; c.fill(ground);
    c.save(); c.clip(ground);
    o.strata.forEach((gap, j) => {
      const g = c.createLinearGradient(box.x, 0, box.x + box.w, 0);
      const a = 0.5 - j * 0.16;
      g.addColorStop(0, rgba("#3a4048", a)); g.addColorStop(0.7, rgba(WARM.strata, a + 0.08)); g.addColorStop(1, rgba(WARM.strata, a + 0.08));
      c.save(); c.translate(0, gap); c.strokeStyle = g; c.lineWidth = o.thin; c.stroke(full); c.restore();
    });
    c.restore();

    // the slope ahead: cold at the rim, warm in the basin
    const pg = c.createLinearGradient(box.x, 0, box.x + box.w, 0);
    pg.addColorStop(0, rgba(COLD.path, 0.7)); pg.addColorStop(0.75, rgba(WARM.path, 0.85)); pg.addColorStop(1, rgba(WARM.path, 0.85));
    c.strokeStyle = pg; c.lineWidth = o.path; c.lineCap = "round"; c.lineJoin = "round"; c.stroke(full);

    // loss levels set into the ground, one per question, faint
    const lv = Math.round(END / 1000);
    if (lv <= 12) {
      c.fillStyle = rgba(COL.muted, 0.5);
      for (let k = 0; k <= lv; k++) { const [px, py] = P(k * 1000); c.fillRect(px - o.thin / 2, py + o.path * 2.5, o.thin, o.tick); }
    }

    // the run, painted by tier
    const run = (steps) => { const out = []; let x = 0; for (const s of steps) { const nx = Math.min(END, x + s.pts * 10); out.push({ x0: x, x1: nx, tier: s.tier }); x = nx; } return { segs: out, end: x }; };
    const mine = run(spec.steps);
    for (const sg of mine.segs) {
      if (!sg.tier || sg.x1 <= sg.x0) continue;
      const p = line(sg.x0, sg.x1);
      c.strokeStyle = rgba(V.TIER_COLORS[sg.tier], 0.2); c.lineWidth = o.run * 3; c.stroke(p);
      c.strokeStyle = V.TIER_COLORS[sg.tier]; c.lineWidth = o.run; c.stroke(p);
    }
    for (const sg of mine.segs) { // where each answer landed (a miss stands still; a crowded run shows none)
      if (!sg.tier || SX(sg.x1) - SX(sg.x0) < o.dot * 3) continue;
      const [px, py] = P(sg.x1);
      c.fillStyle = V.TIER_COLORS[sg.tier]; c.beginPath(); c.arc(px, py, o.dot, 0, Math.PI * 2); c.fill();
    }

    // the global minimum: a gold ring; with the ball in it, the basin's contours around the ball
    const perfect = mine.end >= END - 0.5;
    if (!perfect) {
      c.strokeStyle = COL.gold; c.lineWidth = o.thin * 2.2;
      c.beginPath(); c.arc(minX, minY, o.dot * 1.6, 0, Math.PI * 2); c.stroke();
    } else {
      for (let k = 1; k <= 3; k++) {
        c.strokeStyle = rgba(COL.goldBand, 0.6 - k * 0.15); c.lineWidth = o.thin * 1.6;
        const r = o.ball * (1.5 + k * 1.1);
        c.beginPath(); c.ellipse(minX, minY, r, r * 0.3, 0, 0, Math.PI * 2); c.stroke();
      }
    }

    // a friend's run on the same slope: a hollow ball where they stopped
    let friend = null;
    if (spec.duel) friend = ball(c, P, run(spec.duel.steps).end, step, o.ball * 0.8, null);
    const lastTier = [...spec.steps].reverse().find((s) => s.tier);
    const me = ball(c, P, mine.end, step, o.ball, lastTier ? V.TIER_COLORS[lastTier.tier] : COL.gold);
    return { P, pathAt, minX, minY, me, friend, perfect };
  }

  /** The ball at world x: lit, resting on the slope along its normal. `tint` null draws a hollow one. */
  function ball(c, P, x, step, R, tint) {
    const [lx, ly] = P(x - step), [rx, ry] = P(x + step), [bx, by] = P(x);
    const th = Math.atan2(ry - ly, rx - lx), nx = Math.sin(th), ny = -Math.cos(th);
    const cx = bx + nx * (R + 1), cy = by + ny * (R + 1);
    if (!tint) {
      const lw = Math.max(2, R * 0.2);
      c.fillStyle = COL.bg; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = COL.ink; c.lineWidth = lw;
      c.beginPath(); c.arc(cx, cy, R - lw / 2, 0, Math.PI * 2); c.stroke();
      return { x: cx, y: cy, R };
    }
    c.save();
    c.globalCompositeOperation = "lighter";
    let g = c.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 4);
    g.addColorStop(0, rgba(tint, 0.4)); g.addColorStop(0.45, rgba(tint, 0.09)); g.addColorStop(1, rgba(tint, 0));
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R * 4, 0, Math.PI * 2); c.fill();
    c.restore();
    g = c.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.08, cx, cy, R * 1.05);
    g.addColorStop(0, "#fff7e2"); g.addColorStop(0.36, "#f6c768"); g.addColorStop(1, "#b3711a");
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.beginPath(); c.ellipse(cx - R * 0.36, cy - R * 0.42, R * 0.26, R * 0.17, -0.6, 0, Math.PI * 2); c.fill();
    return { x: cx, y: cy, R };
  }

  // ----------------------------------------------------------------- hook
  /** The hook's lines, bottom first, at scale k: {text, size, weight, color, mark, gap}. */
  function hookLines(c, spec, S, k, maxW) {
    const V = Vi(), h = spec.hook, out = [];
    const txt = (text, size, weight, color, gap = 0, track = 0) => ({ text, size, weight, color, gap, track });
    const small = Math.max(k, 0.9); // the small lines barely shrink: they are small already
    const block = (text, sizes, lines, weight, color, track, gap) => {
      const f = fit(c, text, maxW, lines, sizes.map((s) => Math.round(s * (s <= S.small ? small : k))), weight, "normal", track);
      f.lines.slice().reverse().forEach((ln, i) => out.push(txt(ln, f.size, weight, color, i === 0 ? gap : 0, track)));
    };
    if (!h || h.kind === "none") {
      block(spec.quiz ? `${spec.n} questions, no gradient.` : `${spec.n} prompts, no gradient.`, [S.small], 2, 400, COL.muted, 0, 0);
      block(spec.quiz ? "Not one right answer." : "Stuck on the plateau.", [S.answer, S.answer * 0.84], 2, 500, COL.ink, -0.02, S.small * 0.5);
    } else if (h.kind === "rarest") {
      block(`My rarest answer to “${h.prompt}”`, [S.small], 2, 400, COL.muted, 0, 0);
      out.push({ ...txt(h.count > 1 ? `${h.tierName} ×${h.count}` : h.tierName, Math.round(S.tier * small), 500, V.TIER_COLORS[h.tier], S.small * 0.5), mark: h.tier });
      block(h.answer, [S.answer, S.answer * 0.86, S.answer * 0.74, S.answer * 0.64], 2, 500, COL.ink, -0.02, S.tier * 0.3);
    } else {
      // the hardest question answered right: the question itself, then how it went
      const how = `${h.level ? `${h.level[0].toUpperCase()}${h.level.slice(1)} question, right` : "Right"}${h.secs != null ? ` in ${h.secs.toFixed(1)} s` : ""}`;
      out.push({ ...txt(how, Math.round(S.tier * small), 500, V.TIER_COLORS[QUIZ_TIER], 0), mark: "hit" });
      block(h.question, [S.answer * 0.62, S.answer * 0.56, S.answer * 0.5], 4, 500, COL.ink, -0.01, S.tier * 0.4);
    }
    return out;
  }
  /** The hook, bottom-aligned at `bottom`, left at x. It shrinks until every line clears the slope
   * above it by `clear` px (`ceilAt(x0, x1)` is the slope's lowest point over that stretch). */
  function hookBlock(c, spec, x, bottom, maxW, S, ceilAt, clear) {
    let plan = null;
    for (const k of [1, 0.92, 0.84, 0.76, 0.68, 0.6]) {
      const lines = hookLines(c, spec, S, k, maxW);
      let y = bottom, ok = true;
      const placed = lines.map((ln) => {
        y -= ln.gap;
        font(c, ln.size, ln.weight, "normal", ln.track * ln.size);
        const w = (ln.mark ? ln.size * 1.57 : 0) + c.measureText(ln.text).width;
        const top = y - ln.size * 0.78;
        if (ceilAt && top < ceilAt(x, x + w) + clear) ok = false;
        const at = { ...ln, y, w };
        y -= ln.size * (ln.size > S.small * 1.3 ? 1.1 : 1.32);
        return at;
      });
      plan = placed;
      if (ok) break;
    }
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    for (const ln of plan) {
      font(c, ln.size, ln.weight, "normal", ln.track * ln.size);
      c.fillStyle = ln.color;
      let tx = x;
      if (ln.mark) {
        const gs = ln.size * 1.15;
        if (ln.mark === "hit") quizMark(c, true, x, ln.y - gs * 0.8, gs); else glyph(c, ln.mark, x, ln.y - gs * 0.82, gs);
        tx += ln.size * 1.57;
      }
      c.fillText(ln.text, tx, ln.y);
    }
    return plan.length ? plan[plan.length - 1].y : bottom;
  }

  // -------------------------------------------------------------- layouts
  /** Score, band, the friend's line and the marks, aligned left or right at x. Returns the bottom. */
  function scoreBlock(c, spec, x, top, S, align) {
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    const ofText = `/${spec.max}`;
    font(c, S.of, 400); const ofW = c.measureText(ofText).width;
    font(c, S.score, 300, "semi-expanded", -0.05 * S.score);
    const sText = String(spec.score), sW = c.measureText(sText).width;
    const gap = S.of * 0.2, total = sW + gap + ofW;
    const left = align === "right" ? x - total : x - S.score * 0.04;
    const base = top + S.score * 0.72;
    c.fillStyle = COL.ink; c.fillText(sText, left, base);
    font(c, S.of, 400); c.fillStyle = COL.muted; c.fillText(ofText, left + sW + gap, base);
    c.textAlign = align === "right" ? "right" : "left";
    const ax = align === "right" ? x : x;
    let y = base;
    if (spec.band) {
      y += S.band * 1.55;
      font(c, S.band, 500, "normal", -0.01 * S.band);
      c.fillStyle = spec.band.tier === "baseline" ? COL.ink : Vi().TIER_COLORS[spec.band.tier];
      c.fillText(spec.band.name, ax, y);
    }
    if (spec.duel) {
      y += S.band * 1.3;
      font(c, S.small, 400); c.fillStyle = COL.muted;
      c.fillText(`${spec.duel.name} scored ${spec.duel.score}`, ax, y);
    }
    c.textAlign = "left";
    y += S.mark * 0.75;
    const k = Math.min(spec.marks.length, ROW_MAX), rowW = k * S.mark + (k - 1) * S.markGap;
    const fitMark = rowW > S.rowMax ? S.rowMax / rowW : 1; // a ten-question challenge's row shrinks to fit
    const ms = S.mark * fitMark, mg = S.markGap * fitMark;
    marksRow(c, spec, x, y, ms, mg, align);
    return y + ms;
  }
  /** The run's final loss, beside the ball on the open (downhill) side. Returns its box. */
  function lossLabel(c, spec, at, S) {
    font(c, S.lossLbl, 500);
    c.fillStyle = COL.ink; c.textBaseline = "alphabetic"; c.textAlign = "left";
    const t = `loss ${spec.loss}`, w = c.measureText(t).width;
    const right = at.x + at.R * 1.6 + w < c.canvas.width - 24;
    const x = right ? at.x + at.R * 1.6 : at.x - at.R * 1.6 - w, y = at.y - at.R * 1.1;
    c.fillText(t, x, y);
    return { x0: x, x1: x + w, y0: y - S.lossLbl * 0.8, y1: y + S.lossLbl * 0.2 };
  }
  /** The friend's name over their hollow ball; under it when that would run into my ball or my loss. */
  function friendLabel(c, spec, at, S, mine) {
    const f = at.friend;
    if (!f) return;
    font(c, S.small, 500); c.fillStyle = COL.ink; c.textAlign = "center"; c.textBaseline = "alphabetic";
    const w = c.measureText(spec.duel.name).width;
    const x = clamp(f.x, w / 2 + 16, c.canvas.width - w / 2 - 16);
    const clash = (yy) => {
      const a = { x0: x - w / 2 - 8, x1: x + w / 2 + 8, y0: yy - S.small * 0.8 - 8, y1: yy + 8 };
      const ball = { x0: at.me.x - at.me.R, x1: at.me.x + at.me.R, y0: at.me.y - at.me.R, y1: at.me.y + at.me.R };
      return [mine, ball].some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
    };
    let y = f.y - f.R - S.small * 0.6;
    if (clash(y)) y = f.y + f.R + S.small * 1.5 + 8;
    c.fillText(spec.duel.name, x, y);
    c.textAlign = "left";
  }
  /** The slope's highest screen y over [x0, x1] (the slope falls left to right, so that is its right end, plus ripples). */
  const ceilFrom = (at) => (x0, x1) => { let m = -Infinity; for (let x = x0; x <= x1; x += 8) m = Math.max(m, at.pathAt(x)); return Math.max(m, at.pathAt(x1)); };

  function drawCard(c, spec) {
    const W = 1200, H = 630, M = 64;
    const S = { score: 180, of: 36, band: 31, small: 24, answer: 60, tier: 28, lossLbl: 25, url: 21, mark: 31, markGap: 10, rowMax: 470 };
    const at = descent(c, spec, { x: 0, y: 204, w: W, h: 310 }, {
      lead: 0.06, tail: 0.12, smooth: 0.012, glow: 840, bands: 7, thin: 1.4, path: 2.6, run: 6.5, dot: 5.5, ball: 18, tick: 7, strata: [13, 28, 46],
    });
    lockup(c, M, 50, 48, spec.title);
    font(c, S.small, 400); c.fillStyle = COL.muted; c.textAlign = "left"; c.textBaseline = "alphabetic";
    if (spec.sub) c.fillText(spec.sub, M, 50 + 48 + 38);
    scoreBlock(c, spec, W - M, 30, S, "right");
    friendLabel(c, spec, at, S, lossLabel(c, spec, at.me, S));
    hookBlock(c, spec, M, H - 50, spec.quiz ? 540 : 580, S, ceilFrom(at), 30);
    font(c, S.url, 400); c.fillStyle = COL.muted; c.textAlign = "right"; c.fillText(spec.url, W - M, H - 30); c.textAlign = "left";
  }

  function drawStory(c, spec) {
    const W = 1080, H = 1920, M = 84;
    const S = { score: 300, of: 54, band: 48, small: 35, answer: 88, tier: 40, lossLbl: 35, url: 31, mark: 48, markGap: 15, rowMax: W - 2 * M };
    const at = descent(c, spec, { x: 0, y: 980, w: W, h: 470 }, {
      lead: 0.05, tail: 0.14, smooth: 0.012, glow: 1350, bands: 7, thin: 2, path: 3.4, run: 9, dot: 8, ball: 27, tick: 10, strata: [18, 38, 62],
    });
    lockup(c, M, 286, 68, spec.title);
    font(c, S.small, 400); c.fillStyle = COL.muted; c.textAlign = "left"; c.textBaseline = "alphabetic";
    if (spec.sub) c.fillText(spec.sub, M, 286 + 68 + 52);
    scoreBlock(c, spec, M, 480, S, "left");
    friendLabel(c, spec, at, S, lossLabel(c, spec, at.me, S));
    hookBlock(c, spec, M, 1610, spec.quiz ? 700 : 720, S, ceilFrom(at), 44);
    font(c, S.url, 400); c.fillStyle = COL.muted; c.textAlign = "left"; c.fillText(spec.url, M, 1690);
  }

  /** Draw the card into `canvas` (resized to the format). Synchronous; call after fontsReady. */
  function draw(canvas, spec, format = "card") {
    const F = FORMATS[format] || FORMATS.card;
    canvas.width = F.w; canvas.height = F.h;
    const c = canvas.getContext("2d", { alpha: false }); // opaque: the PNG drops its alpha channel
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = COL.bg; c.fillRect(0, 0, F.w, F.h);
    (format === "story" ? drawStory : drawCard)(c, spec);
    return canvas;
  }
  const toBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
  async function render(spec, format = "card") {
    await fontsReady(spec);
    const canvas = draw(document.createElement("canvas"), spec, format);
    return { canvas, blob: await toBlob(canvas) };
  }

  // ----------------------------------------------------------- share sheet
  // Phones get the system share sheet with the image (Web Share with files); everywhere else the
  // image goes to the clipboard or a download. The text grid stays one tap away, because Discord
  // people like text. The sheet lives in the app's own modal (ui.showModal).
  const CSS = `
.sc-sheet { display: grid; gap: 18px; }
.sc-prev { display: grid; place-items: center; margin: 0; }
.sc-prev img { display: block; width: 100%; height: auto; border-radius: 14px; background: #0b0a08; }
.sc-prev.story img { width: auto; max-width: 100%; height: min(46svh, 440px); }
.sc-prev.busy img { opacity: 0.4; }
.sc-sheet .vs-sizes { justify-self: start; }
.sc-sheet .btn-row { margin-top: 2px; }
.sc-sheet .share-box { margin-top: 0; }
@media (max-width: 420px) { .sc-sheet .btn.big { flex: 1 1 auto; padding: 0 22px; } }`;
  function injectCss() {
    if (document.getElementById("sc-css")) return;
    const st = document.createElement("style");
    st.id = "sc-css"; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const PREF = "mlion:cardFormat";
  const pref = () => { try { const v = localStorage.getItem(PREF); return FORMATS[v] ? v : "card"; } catch { return "card"; } };
  const keepPref = (v) => { try { localStorage.setItem(PREF, v); } catch { /* storage unavailable */ } };
  const isPhone = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  function canShareFiles() {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File([""], "mlion.png", { type: "image/png" })] })); } catch { return false; }
  }
  const canCopyImage = () => typeof ClipboardItem === "function" && !!(navigator.clipboard && navigator.clipboard.write);
  const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const fileName = (spec, format) => `${slug(`mlion ${spec.title || spec.mode}`) || "mlion"}${format === "story" ? "-story" : ""}.png`;
  function altText(spec) {
    const h = spec.hook || {};
    const hook = h.kind === "rarest" ? ` Rarest answer: ${h.answer} (${h.tierName}).` : h.kind === "quiz" ? ` Hardest question right: ${h.question}` : "";
    return `MLion ${spec.title}: ${spec.score} of ${spec.max}, loss ${spec.loss}.${spec.band ? ` ${spec.band.name}.` : ""}${hook}`;
  }
  let urls = []; // object URLs of the last sheet's images, freed when the next sheet opens

  /** Open the share sheet for a results record.
   *  opts: {rec, text (the text grid, or null for none), url (the site), packName, ui: {showModal, toast, copyText}} */
  function open(opts) {
    const { rec, ui } = opts;
    const spec = specFor(rec, opts);
    const phone = isPhone(), files = phone && canShareFiles(), copyImg = !files && canCopyImage();
    const text = opts.text || "";
    urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
    injectCss();
    let fmt = pref();
    const seg = Object.keys(FORMATS).map((k) => `<button type="button" class="vs-size fmt-size${k === fmt ? " on" : ""}" role="radio" aria-checked="${k === fmt}" data-fmt="${k}">${k === "card" ? "Wide" : "Story"}</button>`).join("");
    const main = files ? `<button class="btn primary big" id="card-share" disabled>Share image</button>`
      : copyImg ? `<button class="btn primary big" id="card-copy" disabled>Copy image</button>` : "";
    ui.showModal("Share your run", `<div class="sc-sheet">
      <figure class="sc-prev busy ${fmt}" id="card-preview"><img id="card-img" alt="" width="${FORMATS[fmt].w}" height="${FORMATS[fmt].h}"></figure>
      <div class="vs-sizes" role="radiogroup" aria-label="Image shape">${seg}</div>
      <div class="btn-row">${main}
        ${text ? `<button class="btn big" id="card-text">${phone ? "Share text" : "Copy text"}</button>` : ""}
        <button class="btn ${main ? "ghost" : "primary big"}" id="card-save" disabled>Save image</button>
      </div>
      <textarea class="search share-box" id="card-textbox" readonly aria-label="Share text" hidden></textarea>
    </div>`);
    const $ = (id) => document.getElementById(id);
    const jobs = {}, done = {}; // per shape: the render in flight, and the finished one (a tap shares it without waiting)
    const ready = (k) => (jobs[k] = jobs[k] || render(spec, k).then((r) => { r.url = URL.createObjectURL(r.blob); urls.push(r.url); done[k] = r; return r; }));
    const actions = ["card-share", "card-copy", "card-save"];
    async function show(k) {
      fmt = k;
      const box = $("card-preview");
      if (!box) return;
      box.className = `sc-prev busy ${k}`;
      $("card-img").setAttribute("width", FORMATS[k].w); $("card-img").setAttribute("height", FORMATS[k].h); // holds the shape while it draws
      actions.forEach((id) => { const b = $(id); if (b) b.disabled = true; });
      let r;
      try { r = await ready(k); } catch { if (ui.toast) ui.toast("Couldn't draw the image. Copy the text instead"); return; }
      if (fmt !== k || !$("card-img")) return; // switched again, or the sheet closed
      const img = $("card-img");
      img.src = r.url; img.alt = altText(spec);
      img.dataset.w = r.canvas.width; img.dataset.h = r.canvas.height; img.dataset.bytes = r.blob.size;
      box.className = `sc-prev ${k}`;
      actions.forEach((id) => { const b = $(id); if (b) b.disabled = false; });
    }
    function save() {
      const r = done[fmt];
      if (!r) return;
      const a = document.createElement("a");
      a.href = r.url; a.download = fileName(spec, fmt);
      document.body.appendChild(a); a.click(); a.remove();
      if (ui.toast) ui.toast("Image saved");
    }
    document.querySelectorAll(".sc-sheet [data-fmt]").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll(".sc-sheet [data-fmt]").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
      keepPref(b.dataset.fmt);
      show(b.dataset.fmt);
    }));
    const sh = $("card-share");
    if (sh) sh.addEventListener("click", () => {
      const r = done[fmt];
      if (!r) return;
      // called straight from the tap (no await before it), so the browser still counts it as the user's gesture
      navigator.share({ files: [new File([r.blob], fileName(spec, fmt), { type: "image/png" })] })
        .catch((e) => { if (!e || e.name !== "AbortError") save(); });
    });
    const cp = $("card-copy");
    if (cp) cp.addEventListener("click", () => {
      const r = done[fmt];
      if (!r) return;
      navigator.clipboard.write([new ClipboardItem({ "image/png": r.blob })])
        .then(() => { if (ui.toast) ui.toast("Image copied. Paste it into a chat"); })
        .catch(() => save());
    });
    const sv = $("card-save");
    if (sv) sv.addEventListener("click", save);
    const tx = $("card-text");
    if (tx) tx.addEventListener("click", async () => {
      if (phone && navigator.share) {
        try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
      }
      if (ui.copyText && (await ui.copyText(text))) { if (ui.toast) ui.toast("Text copied"); return; }
      const box = $("card-textbox");
      if (!box) return;
      box.value = text; box.hidden = false; box.focus(); box.select();
    });
    show(fmt);
    return spec;
  }

  // `kit`: the drawing pieces, for tools/icons.js (the site's link-preview image uses the same language)
  window.MLION_CARD = { FORMATS, specFor, fontsReady, draw, render, open, shortUrl, kit: { COL, font, fit, wrap, glyph, lockup, descent, toBlob } };
})();
