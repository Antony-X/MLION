/* MLion visuals.
 *  - initBackdrop/scene: the page's loss surface, drawn as perspective ridge
 *    slices, with a real momentum-SGD trajectory running into its basin.
 *  - Descent: the play stage, where each answer rolls the optimizer down a
 *    1-D slice of that surface. One point = 10 world units, so a perfect day
 *    travels 7,000 units and lands in the global minimum. The world changes on
 *    the way down: a cold, misty plateau, terraced ravines, then a basin lit
 *    gold from below; ridges behind the path move in parallax, and the camera
 *    keeps the path clear of the numbers drawn over the stage. The ball rolls
 *    in a groove (sunk a few px into the path). In the last seconds of a clock
 *    the world drains of colour and beats red (tension/beat/release); a rare
 *    landing flashes the stage in its tier colour and spills coins.
 *  - flame: the streak mark (answers in a row): the ball on fire, heating up
 *    through the colours of fire to the lion's gold. From three in a row the
 *    stage's ball burns with the same flame (flameOutline draws both).
 *  - glyph: the tier marks. Five are tiny charts of what the tier means, a
 *    curve and the ball on it; the gem is the lion, the sign of Leo, which is
 *    a curve and a ball too.
 *  - profileSvg: a finished run drawn on the same terrain. */
(function () {
  "use strict";

  const COL = {
    bg: "#0b0a08", ink: "#f2ede4", muted: "#a39b90", line: "#5c544a",
    gold: "#f2b53c", goldBand: "#e6a52c", goldInk: "#1a1306",
  };
  // Rarity is depth, and depth is light: grey at the surface, warming to gold.
  const TIER_COLORS = {
    baseline: "#857f76", overfit: "#a59a88", indist: "#c4ae88", outlier: "#dfbf7e",
    longtail: "#f5d999", mlion: "#f2b53c", miss: "#6c665d",
  };
  const prefersReduced = () => document.documentElement.classList.contains("reduce-motion");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`; };
  const ease = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  };

  // ------------------------------------------------------------- glyphs
  // 24x24, 2px round strokes; every mark is a curve and the ball on it.
  const GLYPHS = {
    baseline: { d: "M3 17.5H21", ball: [12, 13.6, 2.7] },
    overfit: { d: "M2.5 14C4.6 14 5.3 19.5 7.6 19.5S10.4 9.5 12.6 9.5 15.4 19.5 17.6 19.5 20.2 15 21.5 15", ball: [12.6, 5.8, 2.7] },
    indist: { d: "M2.5 19.5C7 19.5 8.6 9.6 12 9.6S17 19.5 21.5 19.5", ball: [12, 5.9, 2.7] },
    outlier: { d: "M2.5 19.5C4.6 19.5 5.4 12 7.6 12S10.6 19.5 12.7 19.5H21.5", ball: [19, 15.8, 2.7] },
    longtail: { d: "M3 4.5C4.6 13 8.4 19.5 21.5 19.5", ball: [18.6, 15.8, 2.7] },
    mlion: { d: "M2.5 5.5C7.2 5.5 7.8 19.5 12 19.5S16.8 5.5 21.5 5.5", ball: [12, 15.6, 2.9] },
    miss: { d: "", ring: [12, 12, 5] },
  };
  // The lion: the sign of Leo, drawn the way every tier is, a curve and the
  // ball. The ball sits at the lowest point, where a descent ends; the curve
  // climbs out of it as the mane and falls away as the tail. 64-unit box.
  const MARK = {
    d: "M-20.71 13.44C-20.71 -0.08 -17.59 -10.48 -11.35 -16.72C-7.19 -20.88 -1.99 -22.44 2.69 -22.44C11.53 -22.44 17.77 -15.16 16.21 -5.28C14.97 2.52 10.49 9.8 13.09 15.52C15.17 20.2 21.41 20.72 24.01 16.04",
    ball: [-20.71, 19.16, 6.1],
    stroke: 5.6,
    len: 108.17, // arc length of d, so the curve can be drawn growing out of the ball
  };
  /** The lion mark: one stroke and the ball, both in currentColor. */
  function mark(cls, label) {
    const a = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
    const [cx, cy, r] = MARK.ball;
    return `<svg class="mark${cls ? " " + cls : ""}" viewBox="-32 -32 64 64" ${a} focusable="false"><path class="mk-curve" d="${MARK.d}" fill="none" stroke="currentColor" stroke-width="${MARK.stroke}" stroke-linecap="round" stroke-linejoin="round"/><circle class="mk-ball" cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/></svg>`;
  }
  /** Inline SVG of a tier mark. `t` is a tier id or null for a miss. */
  function glyph(t, cls) {
    const id = GLYPHS[t] ? t : "miss";
    if (id === "mlion") return mark(`glyph g-mlion t-mlion${cls ? " " + cls : ""}`);
    const g = GLYPHS[id];
    const body = g.ring
      ? `<circle cx="${g.ring[0]}" cy="${g.ring[1]}" r="${g.ring[2]}" fill="none"/>`
      : `<path d="${g.d}" fill="none"/><circle cx="${g.ball[0]}" cy="${g.ball[1]}" r="${g.ball[2]}" stroke="none" fill="currentColor"/>`;
    return `<svg class="glyph g-${id} t-${id}${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  // ------------------------------------------------------- the surface
  /** Loss over the backdrop's ground plane: one wide basin, a decoy minimum
   * on the way down, and the ripples every real landscape has. */
  function surface(X, Z) {
    const bx = 0.9, bz = 7.6;
    const dx = X - bx, dz = Z - bz;
    const bowl = -1.6 * Math.exp(-(dx * dx) / 9 - (dz * dz) / 6.5);
    // a high far wall to start from, a low near rim so the bowl stays in view
    const raw = (dz > 0 ? 0.05 : 0.007) * dz * dz + 0.018 * dx * dx;
    const wall = 2.6 * Math.tanh(raw / 2.6);
    const decoy = -0.42 * Math.exp(-((X + 3.3) ** 2) / 1.3 - ((Z - 11.2) ** 2) / 1.5);
    const rip = 0.13 * Math.sin(X * 1.25 + Z * 0.6) * Math.cos(Z * 0.85 - X * 0.45) +
      0.05 * Math.sin(X * 3.1 + 1.3) * Math.sin(Z * 2.2);
    return bowl + wall + decoy + rip;
  }
  /** Gradient descent with momentum from the far rim: the backdrop's path. */
  function trajectory() {
    let x = -4.6, z = 14.6, vx = 0, vz = 0;
    const pts = [[x, z]];
    const lr = 0.16, beta = 0.86, e = 1e-3;
    for (let i = 0; i < 260; i++) {
      const gx = (surface(x + e, z) - surface(x - e, z)) / (2 * e);
      const gz = (surface(x, z + e) - surface(x, z - e)) / (2 * e);
      vx = beta * vx - lr * gx; vz = beta * vz - lr * gz;
      x += vx; z += vz;
      pts.push([x, z]);
      if (i > 40 && Math.hypot(vx, vz) < 0.002) break;
    }
    // resample by arc length so progress reads evenly along the path
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[len.length - 1] || 1;
    const out = [];
    for (let k = 0, j = 0; k <= 160; k++) {
      const s = (k / 160) * total;
      while (j < len.length - 2 && len[j + 1] < s) j++;
      const f = clamp((s - len[j]) / (len[j + 1] - len[j] || 1), 0, 1);
      out.push([lerp(pts[j][0], pts[j + 1][0], f), lerp(pts[j][1], pts[j + 1][1], f)]);
    }
    return out;
  }
  const PATH = trajectory();

  // ---------------------------------------------------------- backdrop
  const BD = { canvas: null, ctx: null, view: "home", progress: 0, shown: 0, raf: 0, w: 0, h: 0, dpr: 1 };
  function camera(w, h, view) {
    const phone = w < 700;
    const horizon = view === "home" ? h * (phone ? 0.44 : 0.46) : h * (phone ? 0.74 : 0.72);
    const f = phone ? w * 1.25 : w * 0.66;
    // put the basin where the screen has room for it: right of the title on
    // a wide screen, under it on a phone
    const cx = phone ? w * 0.5 + 0.1 * f : w * 0.75 - (0.9 * f) / 7.6;
    const Znear = 2.4, Zfar = 21;
    const Hc = ((h * 1.02 - horizon) * Znear) / f;
    const cam = { horizon, f, cx, Znear, Zfar, Hc, amp: 1 };
    return cam;
  }
  function project(cam, X, Z, Y) {
    return [cam.cx + (X * cam.f) / Z, cam.horizon + ((cam.Hc - Y) * cam.f) / Z];
  }
  const SHADES = [0.9, 0.62, 0.42, 0.28, 0.19];
  const shadeOf = (L) => (L < -1.1 ? 0 : L < -0.6 ? 1 : L < -0.1 ? 2 : L < 0.7 ? 3 : 4);
  function drawBackdrop() {
    const { ctx, w, h, dpr, view } = BD;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, h);
    const cam = camera(w, h, view);
    const N = w < 700 ? 34 : 42;
    const home = view === "home";
    // which slice each path sample sits in front of, for occlusion
    const zs = [];
    for (let k = 0; k < N; k++) { const t = k / (N - 1); zs.push(cam.Zfar * Math.pow(cam.Znear / cam.Zfar, t)); }
    const sliceOf = (Z) => { let k = 0; while (k < N - 1 && zs[k + 1] >= Z) k++; return k; };
    const upto = BD.shown * (PATH.length - 1);
    const buckets = home ? PATH.map((p) => sliceOf(p[1])) : null;
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1), Z = zs[k];
      const pts = [];
      const steps = w < 700 ? 150 : 260;
      for (let i = 0; i <= steps; i++) {
        const sx = (w * i) / steps;
        const X = ((sx - cam.cx) * Z) / cam.f;
        const L = surface(X, Z);
        pts.push([sx, project(cam, X, Z, cam.amp * L)[1], shadeOf(L)]);
      }
      ctx.beginPath();
      ctx.moveTo(0, h + 4);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(w, h + 4);
      ctx.closePath();
      ctx.fillStyle = COL.bg;
      ctx.fill();
      // light pools in the basin: the lower the loss, the brighter the line
      ctx.lineWidth = 1.1;
      const fade = home ? 1 : 0.42;
      for (let b = 0; b < SHADES.length; b++) {
        ctx.strokeStyle = mix(COL.bg, "#dccbad", SHADES[b] * fade * (0.7 + 0.3 * (1 - t)));
        ctx.beginPath();
        let open = false;
        for (let i = 1; i < pts.length; i++) {
          if (pts[i][2] !== b) { open = false; continue; }
          if (!open) { ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); open = true; }
          ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.stroke();
      }
      if (home) drawPathIn(cam, k, buckets, upto);
    }
    if (home) drawBall(cam, upto);
  }
  function pathPoint(cam, i) {
    const a = PATH[Math.floor(i)], b = PATH[Math.min(PATH.length - 1, Math.floor(i) + 1)], f = i - Math.floor(i);
    const X = lerp(a[0], b[0], f), Z = lerp(a[1], b[1], f);
    return project(cam, X, Z, cam.amp * surface(X, Z) + 0.12);
  }
  function drawPathIn(cam, k, buckets, upto) {
    const ctx = BD.ctx;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let i = 0; i < PATH.length - 1; i++) {
      if (buckets[i] !== k) continue;
      const [x, y] = pathPoint(cam, i);
      if (i < upto) {
        const [x2, y2] = pathPoint(cam, Math.min(upto, i + 1));
        ctx.strokeStyle = COL.gold; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      } else if (i % 2 === 0) {
        ctx.fillStyle = mix(COL.bg, COL.ink, 0.5);
        ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function drawBall(cam, upto) {
    const ctx = BD.ctx;
    const [x, y] = pathPoint(cam, upto);
    const R = BD.w < 700 ? 8 : 10;
    ctx.fillStyle = COL.gold;
    ctx.beginPath(); ctx.arc(x, y - R + 2, R, 0, Math.PI * 2); ctx.fill();
  }
  function sizeBackdrop() {
    const c = BD.canvas;
    const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width) || window.innerWidth, h = Math.round(r.height) || window.innerHeight;
    if (w === BD.w && h === BD.h && dpr === BD.dpr) return; // resizing a canvas clears it: only when it really changed
    BD.dpr = dpr; BD.w = w; BD.h = h;
    c.width = Math.floor(BD.w * BD.dpr); c.height = Math.floor(BD.h * BD.dpr);
    drawBackdrop();
  }
  function initBackdrop() {
    const c = document.getElementById("landscape");
    if (!c) return;
    BD.canvas = c; BD.ctx = c.getContext("2d");
    let t = null;
    sizeBackdrop();
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(sizeBackdrop, 120); });
  }
  /** Set what the backdrop shows: "home" (the full surface and today's
   * position on the path, progress 0..1), "page" (a low horizon) or "play". */
  function scene(view, opts = {}) {
    if (!BD.ctx) return;
    const p = clamp(opts.progress || 0, 0, 1);
    const changed = view !== BD.view;
    BD.view = view; BD.progress = p;
    cancelAnimationFrame(BD.raf);
    if (view !== "home") { if (changed) drawBackdrop(); return; }
    if (prefersReduced() || !opts.animate) { BD.shown = p; drawBackdrop(); return; }
    // the ball rolls from the rim to where today's score has carried it
    BD.shown = 0; drawBackdrop();
    const t0 = performance.now(), dur = 600 + 900 * p;
    const step = (now) => {
      const t = clamp((now - t0 - 250) / dur, 0, 1);
      BD.shown = p * ease.inOut(t);
      drawBackdrop();
      if (t < 1) BD.raf = requestAnimationFrame(step);
    };
    BD.raf = requestAnimationFrame(step);
  }

  // --------------------------------------------------------- the terrain
  // The global minimum sits at a perfect score (10 world units per point). Seven
  // questions is the daily; longer matches stretch the hill so the ball never climbs.
  let END = 7000;
  function setRounds(n) { END = Math.max(7, Math.round(+n) || 7) * 1000; }
  const endless = () => END >= 1e6; // an endless session's hill (setRounds(100000)) has no floor in reach
  const smooth = (a, b, t) => { const u = clamp((t - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  /** How deep world x looks: 0 on the rim, 1 in the global minimum. The curve is front-loaded, so a
   * typical day (about 300 of 700) already reaches the warm light; endless sessions creep towards 1. */
  function depthAt(x) {
    const d = endless() ? 1 - Math.exp(-Math.max(0, x) / 6000) : clamp(x / END, 0, 1);
    return 1 - (1 - d) * (1 - d);
  }
  /** The three acts of a descent as weights that sum to 1: the high plateau, the ravines, the basin. */
  function acts(d) { const r = smooth(0.16, 0.4, d), b = smooth(0.62, 0.88, d); return { plateau: 1 - r, ravine: r * (1 - b), basin: b }; }
  function wig(x, z, A) {
    const swell = 34 * Math.sin(x / 173 + z * 0.9) * (1 + 0.25 * z);
    const rough = 17 * Math.sin(x / 57 + 1.3 + z * 1.7) + 7 * Math.sin(x / 21 + 0.4 + z * 2.9);
    return swell * (1 - 0.5 * A.basin) + rough * (0.5 + 0.8 * A.ravine) * (1 - 0.75 * A.basin);
  }
  /** Height of the play landscape at world x (y grows downward). It falls all the way to the
   * minimum and rises after it, so the end is the floor. Its character changes on the way down:
   * long swells on the plateau; terraces in the ravines (flat stretches and sudden drops, the
   * shape of a loss curve under a step schedule); a smooth bowl at the bottom. */
  function terrain(x, z = 0) {
    const k = 260, P = 380;
    const A = acts(depthAt(x));
    const sp = k * Math.log1p(Math.exp((x - END) / k));
    const taper = 1 - Math.exp(-(((x - END) / 520) ** 2));
    const steps = A.ravine * 0.78 * (P / (2 * Math.PI)) * Math.sin((2 * Math.PI * x) / P);
    return 0.42 * (x - steps) - 1.5 * sp + wig(x, z, A) * taper;
  }

  // ------------------------------------------------------ light by depth
  // The surface is cold and grey. Every step down the light warms, until the minimum glows
  // gold: the same rule as the tiers (rarity is depth, depth is light). Keys at depth 0, .4, .75, 1.
  const KEYS = [0, 0.4, 0.75, 1];
  const PAL = {
    skyTop: ["#0a0b0d", "#0b0a09", "#0e0a06", "#110b04"],
    skyLow: ["#1b1f24", "#1f1a15", "#2a1c0d", "#3a2509"],
    fog: ["#262b31", "#2b231b", "#3a2813", "#52350d"],
    range: ["#111316", "#13100d", "#160f08", "#1a1006"],
    rim: ["#8a949e", "#a99272", "#d9a24c", "#f2b53c"],
    ground: ["#0b0c0d", "#0d0b09", "#0f0a06", "#120b04"],
    strata: ["#2b3035", "#382e23", "#523818", "#714b12"],
    path: ["#737a82", "#85745f", "#ad8140", "#d89c34"],
    mote: ["#b4bec7", "#c9b593", "#f3bb62", "#ffd47e"],
    body: ["#efe0bf", "#f2cf86", "#f2b53c", "#f7a62a"],
    edge: ["#8a7b60", "#a57e3e", "#b3711a", "#b0580c"],
  };
  for (const k in PAL) PAL[k] = PAL[k].map(rgb);
  const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a, 0, 1).toFixed(3)})`;
  const GOLD = rgb(COL.gold);
  function lightAt(d) {
    let i = 0;
    while (i < KEYS.length - 2 && d > KEYS[i + 1]) i++;
    const t = clamp((d - KEYS[i]) / (KEYS[i + 1] - KEYS[i]), 0, 1);
    const L = { d, A: acts(d) };
    for (const k in PAL) L[k] = mixC(PAL[k][i], PAL[k][i + 1], t);
    L.glow = 0.05 + 0.55 * Math.pow(d, 1.5); // the minimum's light
    L.haze = 0.7 * L.A.plateau + 0.3 * L.A.ravine + 0.6 * L.A.basin; // cold mist up top, clear ravines, gold haze below
    return L;
  }

  // ------------------------------------------------------------ streaks
  // Answers in a row light a flame. It heats up through the colours of real fire, all of them warm
  // like the rest of the stage: red-orange, orange, amber, yellow, white-hot, and from seven the
  // lion's gold. Outer, inner, core. (It used to pass through purple and blue, which no other light
  // in the game has; on the warm stage they read as a sticker from somewhere else.)
  const FLAME = [null, null,
    ["#e5532d", "#ff8c3a", "#ffc98a"],
    ["#f06a1e", "#ffa53d", "#ffdca0"],
    ["#f7841a", "#ffbf4d", "#ffe9b8"],
    ["#fb9e1c", "#ffd35e", "#fff3cf"],
    ["#ffb52e", "#ffe39a", "#ffffff"],
    ["#f2b53c", "#f7c862", "#fff4d2"],
  ];
  const flameLevel = (n) => Math.min(7, Math.max(0, Math.floor(+n) || 0));
  /** One flame, the shape both fires share: the ball's round base (radius r, centred on x, y) rising
   * into a tip h radii above its centre, leaning back by `lean` radii, with a smaller tongue on the
   * forward shoulder (`side`, 0 for none). `rot` turns the whole flame (radians). It draws with the
   * canvas path methods, into a 2D context or into svgPath() for the badge. */
  function flameOutline(c, x, y, r, o) {
    const h = o.h, ln = o.lean || 0, s = o.side || 0, rot = o.rot || 0;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const X = (u, v) => x + r * (u * cs - v * sn), Y = (u, v) => y + r * (u * sn + v * cs);
    const curve = (a, b, d, e, u, v) => c.bezierCurveTo(X(a, b), Y(a, b), X(d, e), Y(d, e), X(u, v), Y(u, v));
    // where the two sides leave the round base (a, b), and the direction the base runs there (ta, tb)
    const aA = -0.35, aB = Math.PI + 0.5;
    const a = [Math.cos(aA), Math.sin(aA)], b = [Math.cos(aB), Math.sin(aB)];
    const ta = [-a[1], a[0]], tb = [-b[1], b[0]];
    c.moveTo(X(ln - 0.1, -h + 0.06), Y(ln - 0.1, -h + 0.06));
    curve(ln - 0.04, -h - 0.02, ln + 0.04, -h - 0.02, ln + 0.05, -h + 0.05); // a soft point, not a needle
    if (s > 0) {
      const nu = 0.3 + 0.1 * ln, nv = -h * 0.42; // the notch between the body and the tongue
      const su = 0.86, sv = -0.3 - h * 0.42 * s; // the tongue's tip
      curve(ln + 0.2, -h + 0.45, nu - 0.05, nv - 0.3, nu, nv);
      curve(nu + 0.14, nv - 0.02, su - 0.12, sv + 0.25, su, sv);
      curve(su + 0.16, sv + 0.3, a[0] - 0.5 * ta[0], a[1] - 0.5 * ta[1], a[0], a[1]);
    } else {
      curve(ln + 0.3, -h + 0.5, a[0] - 0.75 * ta[0], a[1] - 0.75 * ta[1], a[0], a[1]);
    }
    c.arc(x, y, r, aA + rot, aB + rot, false);
    curve(b[0] + 0.75 * tb[0], b[1] + 0.75 * tb[1], ln - 0.2, -h + 0.75, ln - 0.1, -h + 0.06);
    c.closePath();
  }
  /** Records the path methods flameOutline() calls as SVG path data. */
  function svgPath(draw) {
    let d = "";
    const f = (v) => +v.toFixed(2);
    draw({
      moveTo: (x, y) => { d += `M${f(x)} ${f(y)}`; },
      bezierCurveTo: (a, b, c, e, x, y) => { d += `C${f(a)} ${f(b)} ${f(c)} ${f(e)} ${f(x)} ${f(y)}`; },
      arc: (cx, cy, r, a0, a1) => { d += `A${f(r)} ${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(cx + r * Math.cos(a1))} ${f(cy + r * Math.sin(a1))}`; },
      closePath: () => { d += "Z"; },
    });
    return d;
  }
  /** The streak badge's flame as inline SVG: the ball on fire. Flat colour, no outlines: a deep outer
   * flame, a brighter inner one, and the ball at the core with the stage ball's highlight on it (the
   * canvas draws the same flame round the real ball). It grows a little with every answer in a row.
   * From seven it turns the gem's gold and the core becomes the lion, in ink, as on the gem. The
   * viewBox's bottom edge sits just under the ball, so the count's baseline lines up with it. */
  function flame(n, cls) {
    const lv = Math.max(2, flameLevel(n)), [o, m, w] = FLAME[lv], g = lv - 2, gem = lv >= 7;
    const outer = svgPath((p) => flameOutline(p, 0, 0, 10, { h: 1.85 + 0.05 * g, lean: -0.32, side: 0.85 + 0.06 * g }));
    const inner = svgPath((p) => flameOutline(p, 0.2, 2, 7.4, { h: 1.35 + 0.04 * g, lean: -0.24 }));
    const [mx, my, mr] = MARK.ball;
    const core = gem
      ? `<g class="fl-core"><g transform="translate(0.4 -2.2) scale(0.3)"><path d="${MARK.d}" fill="none" stroke="${COL.goldInk}" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${mx}" cy="${my}" r="${mr + 0.6}" fill="${COL.goldInk}"/></g></g>`
      : `<g class="fl-core"><circle cx="0.3" cy="3.6" r="4.6" fill="${w}"/><ellipse class="fl-hi" cx="-1.36" cy="1.76" rx="1.56" ry="1.01" transform="rotate(-35 -1.36 1.76)" fill="#fff" opacity="0.9"/></g>`;
    return `<svg class="flame fl-${lv}${cls ? " " + cls : ""}" viewBox="-12 -22 24 31.6" aria-hidden="true" focusable="false">` +
      `<path class="fl-out" fill="${o}" d="${outer}"/><path class="fl-in" fill="${gem ? COL.goldBand : m}" d="${inner}"/>${core}</svg>`;
  }

  // ------------------------------------------------------------ descent
  // The play stage. One motion language throughout: the camera rides with the ball, leans
  // ahead of it while it rolls and settles on it when it lands; the light warms with every
  // step down; a landing presses the ball flat and throws sparks in proportion to how rare
  // the answer was and how long the streak is. Under Reduce motion nothing moves: each
  // state is drawn once, still.
  const RANGES = [ // background ridges, far to near: parallax, baseline and relief (shares of the room above the ball)
    { p: 0.12, base: 0.62, amp: 0.62, seed: 1.7 },
    { p: 0.22, base: 0.86, amp: 0.7, seed: 4.1 },
    { p: 0.36, base: 1.1, amp: 0.76, seed: 2.6 },
    { p: 0.54, base: 1.36, amp: 0.8, seed: 5.3 },
  ];
  /** A background ridge's height (about 0..1) at layer coordinate ul; u is the matching world x,
   * which sets its character: rolling hills on the plateau, peaks in the ravines, a bowl below. */
  function ridge(ul, u, sd) {
    const A = acts(depthAt(u));
    const gentle = 0.52 + 0.26 * Math.sin(ul / 520 + sd) + 0.12 * Math.sin(ul / 190 + 2.1 * sd) + 0.04 * Math.sin(ul / 67 + sd);
    const jag = 0.28 + 0.6 * Math.pow(1 - Math.abs(Math.sin(ul / 230 + sd)), 1.7) + 0.1 * Math.sin(ul / 79 + 3 * sd) + 0.05 * Math.sin(ul / 29 + sd);
    const bowl = 0.46 + 0.26 * Math.cos(ul / 760 + sd) + 0.06 * Math.sin(ul / 250 + sd);
    let v = gentle * A.plateau + jag * A.ravine + bowl * A.basin;
    if (!endless()) v *= 1 - 0.5 * Math.exp(-(((u - END) / 2200) ** 2)); // the ranges part around the minimum
    return v;
  }
  const RIPPLE = { baseline: [22, 1], overfit: [30, 1], indist: [48, 2], outlier: [78, 3], longtail: [120, 4], mlion: [120, 4] };
  const POWER = { baseline: 0.35, overfit: 0.5, indist: 0.6, outlier: 0.8, longtail: 1, mlion: 1 };
  const SPARKS = { baseline: 0, overfit: 2, indist: 5, outlier: 12, longtail: 24, mlion: 30 };
  const KICK = { outlier: 0.025, longtail: 0.055, mlion: 0.045 };
  const HOLD = { outlier: 70, longtail: 130, mlion: 220 }; // hit-stop at a rare landing, ms (see land())
  // the jackpots, for the rare tiers only (the common ones stay modest): how strongly the stage
  // flashes in the tier's colour and for how long (ms), and how many coins spill out of the ball
  const JACKPOT = {
    outlier: { wash: [0.22, 450], coins: 14, cols: ["#dfbf7e", "#f2b53c"] },
    longtail: { wash: [0.32, 520], coins: 24, cols: ["#f5d999", "#f2b53c", "#fff1cf"] },
    mlion: { wash: [0.38, 560], coins: 36, cols: ["#f2b53c", "#fff1cf", "#f5d999"] },
  };
  const COIN_G = 0.0019; // px per ms², the coins' gravity
  const TENSE_RED = rgb("#e8412f"); // a deeper cousin of the house's negative red
  const SMOKE = "#8c857b";
  const glows = new Map();
  /** A soft round glow in one colour, painted once and then only scaled: a phone draws a cached
   * image far more cheaply than a new gradient (or a shadow blur) every frame. */
  function glowSprite(col) {
    let s = glows.get(col);
    if (!s) {
      s = document.createElement("canvas");
      s.width = s.height = 128;
      const g = s.getContext("2d"), c = rgb(col), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      [[0, 1], [0.2, 0.62], [0.45, 0.24], [0.7, 0.07], [1, 0]].forEach(([at, a]) => gr.addColorStop(at, css(c, a)));
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      glows.set(col, s);
    }
    return s;
  }

  function Descent(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const world = document.createElement("canvas"); // the landscape: redrawn only when the camera or the path changes
    const wctx = world.getContext("2d");
    const AX = 0.38;
    const st = {
      w: 0, h: 0, dpr: 1, view: 1000, R: 10,
      x: 0, vel: 0, camX: 0, camY: 0, lead: 0, by: 0, sy: 1, zoom: 1, kick: 0, shake: 0,
      topY: 0, T: null, framed: false, rects: [], sig: "", t: 0,
      tier: null, streak: 0,
      marks: [], segs: [], ripples: [], texts: [], sparks: [], trail: [], motes: [],
      flood: null, land: null, flash: null, dim: null, shiver: 0, coins: [], wash: null, hold: 0, holdAt: 0,
      tense: 0, tenseTo: 0, beat: 0, exhale: null, // the last seconds of the clock
      // the ball's fire: how far the flames lean (px, a spring), how fast the ball moves through the air,
      // the flare at a landing, how far it has caught (0 to 1), embers, wisps and smoke, and the fire going out
      fx: { lean: 0, leanV: 0, speed: 0, flare: 0, grow: 1, acc: 0, bits: [], out: null, tip: null },
      anim: null, raf: 0, onScreen: true, reported: NaN,
      onFrame: opts.onFrame || null, onFlood: opts.onFlood || null,
    };
    const still = prefersReduced; // read on every frame: the setting can change mid-run
    if (window.MLION_TEST) window.MLION_STAGE = st; // tests time the hit-stop (tests/feel.e2e.js)
    const scale = () => (st.w / st.view) * st.zoom;
    const toScreen = (x, y) => { const s = scale(); return [(x - st.camX) * s + st.w * AX, (y - st.camY) * s * st.sy + st.by]; };
    const onPath = (x) => toScreen(x, terrain(x));
    /** How far the ball sinks into the path: enough to cover the lit line and its glow where it ends. */
    const sink = () => Math.min(st.R * 0.38, 7);
    /** The ball's centre when it stands at x: out along the slope's normal (not straight up), r from the path. */
    const ballAt = (x, r) => {
      const e = st.view / 400, [px, py] = onPath(x), [lx, ly] = onPath(x - e), [rx, ry] = onPath(x + e);
      const th = Math.atan2(ry - ly, rx - lx);
      return [px + Math.sin(th) * r, py - Math.cos(th) * r, th];
    };

    function measure() {
      let list = [];
      try { list = (opts.avoid && opts.avoid()) || []; } catch { list = []; }
      st.rects = list.filter((r) => r && r.w > 0 && r.h > 0);
    }
    function seedMotes() {
      st.motes = [];
      const n = st.w < 560 ? 18 : 34;
      for (let i = 0; i < n; i++) st.motes.push({ x: Math.random() * st.w, y: Math.random() * st.h, f: 0.25 + Math.random() * 0.75, ph: Math.random() * 6.3, sp: 0.6 + Math.random() * 0.8 });
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      st.dpr = Math.min(2, window.devicePixelRatio || 1);
      st.w = Math.max(10, r.width); st.h = Math.max(10, r.height);
      canvas.width = world.width = Math.floor(st.w * st.dpr);
      canvas.height = world.height = Math.floor(st.h * st.dpr);
      st.view = st.w < 560 ? 820 : st.w < 1000 ? 1100 : 1500;
      st.R = st.w < 560 ? 10.5 : 13;
      st.sig = ""; st.framed = false;
      measure();
      seedMotes();
      snap();
    }

    /** Where the camera wants the ball: low enough that the path stays clear of the boxes along the
     * top (the HUD, the streak), high enough to clear the dots along the bottom. When a short stage
     * can't do both, the slope is drawn flatter (a vertical squash), never through the numbers. */
    function targets() {
      const { w, h, R } = st;
      const s = scale();
      const tops = [], foots = [];
      for (const r of st.rects) (r.y + r.h / 2 < h / 2 ? tops : foots).push(r);
      const topY = tops.length ? Math.max(...tops.map((r) => r.y + r.h)) : 8;
      const footY = foots.length ? Math.min(...foots.map((r) => r.y)) : h - 4;
      const floor = topY + 2 * R + 8;
      const maxBy = Math.max(floor, footY - 9);
      const cy = terrain(st.camX);
      const cons = tops.map((r) => {
        let rise = -Infinity;
        for (let px = r.x - 14; px <= r.x + r.w + 18; px += 6) rise = Math.max(rise, cy - terrain(st.camX + (px - w * AX) / s));
        return [r.y + r.h + 10, rise];
      });
      const minAt = (sy) => cons.reduce((m, [need, rise]) => Math.max(m, need + rise * s * sy), floor);
      let sy = 1;
      if (minAt(1) > maxBy) for (const [need, rise] of cons) if (rise > 0) sy = Math.min(sy, (maxBy - need) / (rise * s));
      sy = clamp(sy, 0.1, 1);
      const ideal = topY + (maxBy - topY) * 0.68;
      return { by: clamp(ideal, Math.min(minAt(sy), maxBy), maxBy), sy, topY, need: (s2) => Math.min(minAt(s2), maxBy) };
    }

    function step(now, dt) {
      const calm = still();
      st.t = now;
      const a = st.anim, prevX = st.x, pcx = st.camX, pcy = st.camY;
      if (a) {
        a.t = calm ? 1 : Math.min(1, (now - a.start) / a.dur);
        if (a.tier === "miss") st.x = a.from; // no gradient, no step
        else if (a.tier === "overfit") { // overshoot the target, then oscillate back: textbook overfitting
          st.x = a.from + (a.to - a.from) * ease.back(a.t) + Math.sin(a.t * 22) * 22 * (1 - a.t) * (a.t > 0.5 ? 1 : 0);
        } else st.x = a.from + (a.to - a.from) * (a.tier === "baseline" ? ease.out(a.t) : ease.inOut(a.t));
        if (a.t >= 1) {
          st.x = a.tier === "miss" ? a.from : a.to;
          if (a.tier !== "miss") { st.segs.push({ x0: a.from, x1: a.to, tier: a.tier }); st.marks.push({ x: a.to, tier: a.tier }); }
          st.anim = null;
          land(a, calm);
          if (a.done) a.done();
        }
      }
      st.vel = dt > 0 ? (st.x - prevX) / dt : 0;
      if (!calm && st.anim && Math.abs(st.x - prevX) > 0.01) st.trail.push({ x: st.x, t: now });
      while (st.trail.length && now - st.trail[0].t > 420) st.trail.shift();

      // camera
      const T = targets();
      st.T = T; st.topY = T.topY;
      const lead = st.anim ? clamp(st.vel * 240, -200, 260) : 0; // look where it's going
      st.kick *= Math.exp(-dt / 300);
      if (st.kick < 0.0005) st.kick = 0;
      if (calm || !st.framed) {
        st.lead = lead; st.camX = st.x + lead; st.by = T.by; st.sy = T.sy; st.zoom = 1; st.kick = 0; st.framed = true;
      } else {
        const k = 1 - Math.exp(-dt / 160), kv = 1 - Math.exp(-dt / 220), kz = 1 - Math.exp(-dt / 60);
        st.lead += (lead - st.lead) * k;
        // never look past where the ball will stop: the look-ahead used to carry the camera about 80 units beyond
        // the landing, and it drifted back after (user, 2026-11-06). Now it arrives with the ball.
        st.lead = Math.min(st.lead, st.anim ? Math.max(0, st.anim.to - st.x) : 0);
        st.camX += (st.x + st.lead - st.camX) * k;
        st.by += (T.by - st.by) * kv;
        st.sy += (T.sy - st.sy) * kv;
        st.zoom += (1 + st.kick - st.zoom) * kz;
      }
      // the easing may lag, but the path never crosses the numbers: hold the hard limit every frame
      if (!calm) st.by = Math.max(st.by, targets().need(st.sy));
      st.camY = terrain(st.camX);
      st.shake = st.shake > 0.2 && !calm ? st.shake * Math.exp(-dt / 120) : 0;

      // effects
      for (const r of st.ripples) r.life -= dt;
      st.ripples = st.ripples.filter((r) => r.life > 0);
      for (const t of st.texts) t.life -= dt;
      st.texts = st.texts.filter((t) => t.life > 0);
      for (const p of st.sparks) { p.life += dt; p.vy += 0.0011 * dt; p.vx *= Math.exp(-dt / 900); p.ox += p.vx * dt; p.oy += p.vy * dt; }
      st.sparks = st.sparks.filter((p) => p.life < p.max);
      for (const p of st.coins) { p.life += dt; p.vy += COIN_G * dt; p.ox += p.vx * dt; p.oy += p.vy * dt; p.spin += p.vs * dt; }
      st.coins = st.coins.filter((p) => p.life < p.max);
      if (st.wash && (st.wash.t += dt) > st.wash.max) st.wash = null;
      // low time: the tension eases in, and lets go at once when the answer is in
      if (st.tense !== st.tenseTo) {
        st.tense += (st.tenseTo - st.tense) * (1 - Math.exp(-dt / (st.tenseTo > st.tense ? 450 : 110)));
        if (Math.abs(st.tense - st.tenseTo) < 0.003) st.tense = st.tenseTo;
      }
      st.beat = st.beat > 0.01 ? st.beat * Math.exp(-dt / 230) : 0;
      if (st.exhale && (st.exhale.t += dt) > st.exhale.max) st.exhale = null;
      if (st.land && (st.land.t += dt) > 700) st.land = null;
      if (st.flash && (st.flash.t += dt) > st.flash.max) st.flash = null;
      if (st.dim && (st.dim.t += dt) > st.dim.max) st.dim = null;
      if (st.shiver > 0) st.shiver = Math.max(0, st.shiver - dt);
      if (st.flood) {
        const f = st.flood;
        f.t += dt;
        if (!f.inkOn && f.t > f.grow * 0.35) { f.inkOn = true; st.onFlood && st.onFlood(true); }
        if (f.inkOn && f.t > f.grow + f.hold + f.shrink * 0.5) { f.inkOn = false; st.onFlood && st.onFlood(false); }
        if (f.t >= f.grow + f.hold + f.shrink) st.flood = null;
      }

      // dust in the air: carried by the camera at its depth, drifting on its own. Grey dust on
      // the plateau, embers rising out of the basin.
      const s = scale();
      const dcx = (st.camX - pcx) * s, dcy = (st.camY - pcy) * s * st.sy;
      const A = acts(depthAt(st.camX));
      const vx = calm ? 0 : 0.01 * A.plateau + 0.004 * A.ravine - 0.002 * A.basin;
      const vy = calm ? 0 : 0.004 * A.plateau + 0.001 * A.ravine - 0.016 * A.basin;
      const W = st.w + 20, H = st.h + 20;
      for (const m of st.motes) {
        if (Number.isFinite(dcx) && Math.abs(dcx) < 400) { m.x -= dcx * m.f * 0.6; m.y -= dcy * m.f * 0.6; }
        m.x += vx * m.f * dt; m.y += vy * m.f * dt;
        m.x = ((m.x + 10) % W + W) % W - 10; m.y = ((m.y + 10) % H + H) % H - 10;
      }
      stepFire(dt, calm);
    }

    /** The fire moves with the ball. Its lean is a damped spring pulled towards the ball's speed through
     * the air: the flames stream back while it rolls and swing past upright when it stops. Embers and
     * small wisps break off the tips and stay where they were shed (they hold world coordinates, like
     * the sparks), so a rolling ball leaves them behind. */
    function stepFire(dt, calm) {
      const fx = st.fx, lv = flameLevel(st.streak), R = st.R;
      if (calm) { fx.lean = fx.leanV = fx.speed = fx.flare = fx.acc = 0; fx.grow = 1; fx.bits = []; fx.out = null; return; }
      if (dt <= 0) return; // the hit-stop holds the fire too
      const vx = st.vel * scale(); // px per ms
      fx.speed = Math.abs(vx);
      const pull = -clamp(vx * 52, -R * 0.9, R * 2.2);
      fx.leanV += ((pull - fx.lean) * 0.00011 - fx.leanV * 0.013) * dt;
      fx.lean += fx.leanV * dt;
      fx.flare *= Math.exp(-dt / 380);
      fx.grow = Math.min(1, fx.grow + dt / 420);
      if (fx.out && (fx.out.t += dt) > fx.out.max) fx.out = null;
      // embers off the top of the flames: a steady trickle, more the longer the streak, a gust when it rolls or lands
      if (lv >= 3 && fx.tip) {
        fx.acc += dt * (0.005 + 0.0015 * (lv - 3)) * (1 + 3 * Math.min(1, fx.speed * 2)) * (1 + 2 * fx.flare);
        while (fx.acc >= 1) {
          fx.acc -= 1;
          if (fx.bits.length >= 40) continue;
          // embers rise from anywhere in the flames; wisps tear off near the tip
          const t = fx.tip, wisp = Math.random() < 0.28, k = wisp ? 0.65 + 0.3 * Math.random() : Math.random() * 0.75;
          fx.bits.push({
            kind: wisp ? "wisp" : "ember", wx: st.x, wy: terrain(st.x),
            ox: lerp(t.x0, t.x1, k) + (Math.random() - 0.5) * R * (wisp ? 0.3 : 0.9), oy: lerp(t.y0, t.y1, k),
            vx: vx * 0.35 + (Math.random() - 0.5) * 0.03, vy: -(0.02 + 0.035 * Math.random()), ph: Math.random() * 6.3,
            size: wisp ? R * (0.15 + 0.1 * Math.random()) : 0.9 + 1.2 * Math.random(),
            hex: FLAME[lv][Math.random() < 0.5 ? 1 : 2], life: 0, max: wisp ? 260 + 200 * Math.random() : 650 + 700 * Math.random(),
          });
        }
      } else fx.acc = 0;
      for (const b of fx.bits) {
        b.life += dt;
        if (b.life < 0) continue; // a puff of smoke still waiting its turn
        b.vx *= Math.exp(-dt / 420);
        b.vy -= (b.kind === "smoke" ? 0.00002 : 0.00005) * dt; // hot air rises
        b.ox += (b.vx + Math.sin(b.life * 0.009 + b.ph) * 0.012) * dt;
        b.oy += b.vy * dt;
      }
      fx.bits = fx.bits.filter((b) => b.life < b.max);
    }

    function land(a, calm) {
      const tier = a.tier, x = st.x;
      if (tier === "miss") {
        const was = flameLevel(st.streak);
        st.streak = 0; st.tier = "miss";
        if (calm) return;
        if (was >= 3) putOut(was);
        st.ripples.push({ x, color: TIER_COLORS.miss, size: 22, rings: 1, life: 900, max: 900 });
        st.texts.push({ x, text: "NaN", color: COL.muted, size: 16, life: 1300, max: 1300 });
        st.dim = { t: 0, max: 560 };
        st.shiver = 360;
        return;
      }
      st.streak += 1; st.tier = tier;
      if (calm) return;
      const lv = flameLevel(st.streak);
      if (lv >= 3) { st.fx.flare = 1; if (lv === 3) st.fx.grow = 0; } // the fire flares at each landing; at three it catches
      const k = Math.min(1.3, (POWER[tier] || 0.5) * (1 + 0.07 * Math.max(0, lv - 1)));
      st.land = { t: 0, k };
      // hit-stop: a rare landing holds the whole stage still for a beat before it all bursts out, longer the rarer
      // (and a little more on a long streak), never more than 300 ms. Common landings don't stop: a beat on every
      // answer would only slow the game down.
      if (HOLD[tier]) { st.hold = Math.min(300, HOLD[tier] + (lv >= 4 ? 30 : 0)); st.holdAt = st.t; }
      const [size, rings] = RIPPLE[tier] || [30, 1];
      st.ripples.push({ x, color: TIER_COLORS[tier], size, rings, life: 900 + rings * 120, max: 900 + rings * 120 });
      const pts = Math.round((a.to - a.from) / 10);
      if (tier !== "mlion" && pts > 0) st.texts.push({ x, text: `−${(pts / 100).toFixed(2)}`, color: TIER_COLORS[tier], size: st.w < 560 ? 14 : 16, life: 1500, max: 1500 });
      const n = (SPARKS[tier] || 0) + (lv >= 2 ? 3 * lv : 0);
      if (n) burst(n, lv >= 2 ? FLAME[lv] : [TIER_COLORS[tier], COL.gold, "#fff1cf"], 0.7 + 0.5 * k);
      if (tier === "longtail" || tier === "mlion" || lv >= 5) st.flash = { t: 0, max: 460, col: rgb(lv >= 5 ? FLAME[lv][1] : TIER_COLORS[tier]) };
      st.kick = Math.max(KICK[tier] || 0, lv >= 4 ? 0.012 + 0.004 * lv : 0);
      if (tier === "longtail") st.shake = 4;
      if (tier === "mlion") st.flood = { t: 0, grow: 600, hold: 900, shrink: 500, inkOn: false };
      // the jackpot: the rare ones wash the whole stage in their colour and spill coins
      const jp = JACKPOT[tier];
      if (jp) {
        st.wash = { t: 0, max: jp.wash[1], a: jp.wash[0], col: rgb(TIER_COLORS[tier]) };
        coins(jp.coins, jp.cols);
      }
    }
    /** A miss puts the fire out: the flames sink into the ball and a puff of smoke rises off it. */
    function putOut(lv) {
      const fx = st.fx, R = st.R, t = fx.tip;
      fx.out = { t: 0, max: 480, lv };
      if (!t) return;
      for (let i = 0; i < 7; i++) {
        const k = 0.15 + 0.75 * (i / 6);
        fx.bits.push({
          kind: "smoke", wx: st.x, wy: terrain(st.x), ox: lerp(t.x0, t.x1, k * 0.6) + (Math.random() - 0.5) * R * 0.7, oy: lerp(t.y0, t.y1, k * 0.6),
          vx: (Math.random() - 0.5) * 0.02, vy: -(0.025 + 0.02 * Math.random()), ph: Math.random() * 6.3,
          size: R * (0.5 + 0.25 * Math.random()), life: -i * 35, max: 900 + 300 * Math.random(),
        });
      }
    }
    /** Coins thrown up out of the ball: they spin (a squashing ellipse), fall and fade. */
    function coins(n, cols) {
      // a fountain that stays under the numbers: each coin rises a third to nine tenths of the way up to them
      const T = st.T || targets(), room = Math.max(40, T.by - st.R * 2 - T.topY - 6);
      const side = clamp(st.w / 900, 0.5, 1.2);
      for (let i = 0; i < n; i++) {
        const col = rgb(cols[i % cols.length]);
        st.coins.push({
          wx: st.x, wy: terrain(st.x), ox: (Math.random() - 0.5) * st.R, oy: -st.R,
          vx: (Math.random() - 0.5) * 0.4 * side, vy: -Math.sqrt(2 * COIN_G * room * (0.35 + 0.55 * Math.random())),
          spin: Math.random() * 6, vs: 0.012 + 0.014 * Math.random(), tilt: (Math.random() - 0.5) * 0.5,
          r: st.R * (0.4 + 0.24 * Math.random()), col, dark: col.map((v) => v * 0.55),
          life: 0, max: 950 + 450 * Math.random(),
        });
      }
    }
    function burst(n, cols, power) {
      for (let i = 0; i < n; i++) {
        const ang = Math.PI * (0.1 + 0.8 * Math.random());
        const v = (0.1 + 0.32 * Math.random()) * power; // px per ms
        st.sparks.push({ wx: st.x, wy: terrain(st.x), ox: 0, oy: -st.R * 0.6, vx: Math.cos(ang) * v, vy: -Math.sin(ang) * v, life: 0, max: 480 + 560 * Math.random(), col: rgb(cols[i % cols.length]), size: 1 + Math.random() * 1.5 });
      }
    }

    // ---- drawing
    function glowAt(bx, by, L) {
      const diag = Math.hypot(st.w, st.h);
      let dx = 0.85, dy = 0.4, D = diag * (0.75 - 0.5 * L.d);
      if (!endless()) {
        const [mx, my] = onPath(END);
        const n = Math.hypot(mx - bx, my - by) || 1;
        dx = (mx - bx) / n; dy = (my - by) / n; D = Math.min(n, diag * 0.62);
      }
      return [clamp(bx + dx * D, -st.w * 0.1, st.w * 1.05), Math.min(by + dy * D, st.h * 0.86)];
    }
    function drawWorld(c, L) {
      const { w, h } = st;
      const s = scale();
      c.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      const [bx, by] = onPath(st.x);
      const G = glowAt(bx, by, L);

      // sky, and the minimum's light low on the horizon, where the descent is going
      const sky = c.createLinearGradient(0, 0, 0, Math.max(40, st.by));
      sky.addColorStop(0, css(L.skyTop)); sky.addColorStop(1, css(L.skyLow));
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      const r0 = Math.hypot(w, h) * (0.55 + 0.4 * L.d);
      let g = c.createRadialGradient(G[0], G[1], 0, G[0], G[1], r0);
      g.addColorStop(0, css(L.rim, L.glow)); g.addColorStop(0.45, css(L.rim, L.glow * 0.35)); g.addColorStop(1, css(L.rim, 0));
      c.fillStyle = g; c.fillRect(0, 0, w, h);

      // ridges behind, far to near: each one mistier than the one in front, its rim lit, its
      // contours stepping down into it
      const band = Math.max(24, st.by - st.topY);
      const stepPx = w < 560 ? 4 : 6;
      // the ridges part under the numbers at the top: a peak that would cross one sinks into a col below it
      const tops = st.rects.filter((r) => r.y + r.h / 2 < h / 2);
      const floorAt = (px) => {
        let lim = -Infinity;
        for (const r of tops) {
          const dx = px < r.x ? r.x - px : px > r.x + r.w ? px - r.x - r.w : 0;
          if (dx < 56) lim = Math.max(lim, r.y + r.h + 8 - 90 * smooth(0, 56, dx));
        }
        return lim;
      };
      c.lineJoin = "round"; c.lineCap = "round";
      RANGES.forEach((Rg, i) => {
        const near = (i + 1) / RANGES.length;
        const base = st.topY + band * (Rg.base - 0.16 * L.d * near);
        const amp = band * Rg.amp * (0.8 + 0.45 * L.d);
        const line = new Path2D();
        let top = Infinity;
        for (let px = -stepPx; px <= w + stepPx; px += stepPx) {
          const off = (px - w * AX) / s;
          const y = Math.max(floorAt(px), base - amp * ridge(off + st.camX * Rg.p, st.camX + off / Rg.p, Rg.seed));
          if (px < 0) line.moveTo(px, y); else line.lineTo(px, y);
          if (y < top) top = y;
        }
        const body = mixC(L.fog, L.range, 0.3 + 0.7 * near);
        const fill = new Path2D(line);
        fill.lineTo(w + stepPx, h + 2); fill.lineTo(-stepPx, h + 2); fill.closePath();
        const fg = c.createLinearGradient(0, top, 0, base + band * 0.3);
        fg.addColorStop(0, css(body)); fg.addColorStop(1, css(mixC(body, L.fog, L.haze)));
        c.fillStyle = fg; c.fill(fill);
        const rim = mixC(L.fog, L.rim, 0.25 + 0.45 * near);
        c.lineWidth = 1;
        c.strokeStyle = css(rim, 0.45 + 0.4 * near); c.stroke(line);
        const gap = 5 + 5 * near;
        for (let k = 1; k <= 2; k++) {
          c.save(); c.translate(0, gap * k);
          c.strokeStyle = css(rim, (0.2 - 0.06 * k) * (0.5 + near)); c.stroke(line);
          c.restore();
        }
      });

      // the path's own slice: the ground below it, strata pressed into the ground
      const x0 = st.camX - (w * AX) / s - 40, x1 = st.camX + (w * (1 - AX)) / s + 40;
      const stepX = (w < 560 ? 4 : 5) / s;
      const path = new Path2D();
      let pmin = Infinity;
      for (let x = x0, f = true; x <= x1; x += stepX) {
        const [px, py] = onPath(x);
        if (f) { path.moveTo(px, py); f = false; } else path.lineTo(px, py);
        if (py < pmin) pmin = py;
      }
      const ground = new Path2D(path);
      ground.lineTo(w + 40, h + 40); ground.lineTo(-40, h + 40); ground.closePath();
      const gg = c.createLinearGradient(0, Math.min(pmin, h - 1), 0, h);
      gg.addColorStop(0, css(mixC(L.ground, L.fog, 0.22))); gg.addColorStop(1, css(L.ground));
      c.fillStyle = gg; c.fill(ground);
      const gap = clamp(st.h * 0.045, 6, 14);
      c.lineWidth = 1;
      for (let j = 1; j <= 5; j++) {
        c.save(); c.translate(0, gap * j * (1 + j * 0.12));
        c.strokeStyle = css(L.strata, 0.78 - j * 0.12); c.stroke(path);
        c.restore();
      }
      // near the bottom the basin's own light falls on everything
      if (L.glow > 0.08) {
        c.globalCompositeOperation = "lighter";
        const r1 = Math.hypot(w, h) * 0.4;
        g = c.createRadialGradient(G[0], G[1], 0, G[0], G[1], r1);
        g.addColorStop(0, css(GOLD, L.glow * 0.32)); g.addColorStop(1, css(GOLD, 0));
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = "source-over";
      }

      // loss levels, set into the ground: they fade near the ball and never sit under a number
      if (!endless()) {
        const n = Math.round(END / 1000);
        c.font = `500 ${w < 560 ? 11 : 12}px Archivo, system-ui, sans-serif`;
        c.textAlign = "center";
        for (let lv = n - 1; lv >= 0; lv--) {
          const wx = (n - lv) * 1000;
          if (wx < x0 - 80 || wx > x1 + 80) continue;
          const [px, py] = onPath(wx);
          const ly = py + 26;
          let a = smooth(28, 70, Math.abs(px - bx));
          if (ly > h - 3) a = 0;
          for (const r of st.rects) if (px > r.x - 26 && px < r.x + r.w + 26 && ly > r.y - 6 && ly - 14 < r.y + r.h + 6) a = 0;
          if (a <= 0.01) continue;
          const passed = st.x >= wx - 0.5;
          c.globalAlpha = a * (passed ? 0.9 : 0.65);
          c.fillStyle = lv === 0 ? COL.gold : css(passed ? L.rim : L.path);
          c.fillRect(px - 0.75, py + 6, 1.5, 7);
          c.fillText(`${lv}.00`, px, ly);
        }
        c.globalAlpha = 1;
      }

      // the path: ahead in the light of its depth, behind painted by tier
      c.strokeStyle = css(L.path, 0.9); c.lineWidth = 2; c.stroke(path);
      const segs = st.segs.slice();
      if (st.anim && st.anim.tier !== "miss") segs.push({ x0: st.anim.from, x1: Math.max(st.anim.from, st.x), tier: st.anim.tier });
      for (const sg of segs) {
        const a = Math.max(sg.x0, x0), b = Math.min(sg.x1, x1);
        if (b <= a) continue;
        const p = new Path2D();
        for (let x = a, f = true; x <= b + 0.01; x += stepX) {
          const [px, py] = onPath(Math.min(x, b));
          if (f) { p.moveTo(px, py); f = false; } else p.lineTo(px, py);
        }
        c.strokeStyle = TIER_COLORS[sg.tier];
        c.globalAlpha = 0.16; c.lineWidth = 9; c.stroke(p);
        c.globalAlpha = 1; c.lineWidth = 3.5; c.stroke(p);
      }
      const [ballX] = onPath(st.x);
      for (const m of st.marks) {
        const [px, py] = onPath(m.x);
        if (px < -20 || px > w + 20) continue;
        if (Math.abs(px - ballX) < st.R * 1.6) continue; // the ball is standing on it
        c.fillStyle = TIER_COLORS[m.tier];
        c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2); c.fill();
      }
    }

    /** Three answers in a row and the ball catches fire: the badge's flame, wrapped round the real ball.
     * Its round base is the ball, so the flames rise off it instead of standing behind it. Measured
     * once a frame (fireOf), drawn in three passes: the light it throws (on the ground under the ball
     * and into the air), the flames behind the ball, and a translucent lick across its front. */
    function fireOf(cx, cy, bx, by, lv, calm) {
      const fx = st.fx, R = st.R, out = fx.out;
      const flv = lv >= 3 ? lv : out ? out.lv : 0;
      if (!flv) return null;
      let size = 1, alpha = 1;
      if (lv >= 3 && !calm) { size = ease.back(fx.grow); alpha = Math.min(1, fx.grow * 3); } // catching: it leaps up out of the ball
      else if (lv < 3) { const k = out.t / out.max; size = 1 - 0.8 * ease.out(k); alpha = 1 - k; } // going out: it sinks into the ball
      const t = st.t;
      const fl = calm ? 1 : 1 + 0.07 * Math.sin(t * 0.0123) + 0.05 * Math.sin(t * 0.0291 + 1.3) + 0.03 * Math.sin(t * 0.0517 + 0.4);
      // as tall as the streak, longer when it rolls fast, flaring at a landing; never up into the numbers
      // over the stage (the phone keyboard strip is short)
      const over = st.rects.filter((r) => r.y + r.h / 2 < st.h / 2 && r.x < cx + R * 2.5 && r.x + r.w > cx - R * 3.5);
      const ceil = over.length ? Math.max(...over.map((r) => r.y + r.h)) : -Infinity;
      let H = R * (2.35 + 0.2 * (flv - 3)) * fl * (1 + Math.min(0.45, fx.speed * 0.8)) * (1 + 0.4 * fx.flare);
      H = Math.min(H, Math.max(R * 1.3, cy - ceil - 4)) * size;
      // the spring's lean, and a slow waver of its own even at rest
      const lean = calm ? 0 : fx.lean + R * (0.12 * Math.sin(t * 0.0087) + 0.06 * Math.sin(t * 0.0213 + 0.7));
      // where embers break off (from the ball's crown to the tip, relative to where it stands), and the
      // tip's height on the stage (tests check it stays under the numbers)
      fx.tip = { x0: cx - bx, y0: cy - R - by, x1: cx + lean - bx, y1: cy - H - by, top: cy - H };
      return { lv: flv, cols: FLAME[flv].map(rgb), H, lean, alpha, fl, cx, cy, bx, by, calm };
    }
    function fireLight(c, F) {
      const R = st.R, k = F.alpha * F.fl * (0.78 + 0.06 * (F.lv - 3));
      // a wide, flat pool on the ground where the ball stands: the path and the strata under it catch the light
      c.globalAlpha = clamp(0.5 * k, 0, 1);
      c.drawImage(glowSprite(FLAME[F.lv][1]), F.bx - R * 5.5, F.by - R * 1.7, R * 11, R * 3.8);
      // and the air round the flames
      const ar = R * (3 + 0.3 * F.lv);
      c.globalAlpha = clamp(0.36 * k, 0, 1);
      c.drawImage(glowSprite(FLAME[F.lv][0]), F.cx + F.lean * 0.3 - ar, F.cy - F.H * 0.35 - ar, ar * 2, ar * 2);
      c.globalAlpha = 1;
    }
    function flames(c, F, front) {
      const R = st.R, [o, m, w] = F.cols, t = st.t;
      // one layer: base radius r (in R), its centre lifted above the ball's, its share of the height
      const layer = (r, lift, share, col, a, side, ph) => {
        r *= R;
        const y = F.cy - lift * R;
        const ht = Math.max(r * 0.6, F.H * share * (F.calm ? 1 : 1 + 0.07 * Math.sin(t * 0.017 + ph)) - lift * R);
        // the tip streams back with the lean; the flame half turns and half bends towards it, so it curves
        const lx = F.lean * share, rot = 0.5 * Math.atan2(lx, ht);
        const u = lx * Math.cos(rot) - ht * Math.sin(rot), h = lx * Math.sin(rot) + ht * Math.cos(rot);
        c.fillStyle = css(col, a * F.alpha);
        c.beginPath();
        flameOutline(c, F.cx, y, r, { h: h / r, lean: u / r - 0.3, side, rot });
        c.fill();
      };
      // fire is light, so the layers brighten what is under them (deep at the edge, yellow where they
      // overlap) and the scene shows faintly through. Screen rather than adding: added up, orange clips
      // to a lime yellow on the cold plateau. The badge draws the same layers flat.
      c.save();
      c.globalCompositeOperation = "screen";
      if (!front) {
        const sway = F.calm ? 0 : 0.1 * Math.sin(t * 0.021 + 2);
        layer(1.14, 0.34, 1, o, 1, 0.85 + 0.05 * (F.lv - 3) + sway, 0);
        layer(1.0, 0.3, 0.74, m, 0.85, 0, 1.9);
        if (F.lv >= 5) layer(0.74, 0.42, 0.54, w, 0.75, 0, 3.7); // white-hot: a pale core rises off the ball's crown
      } else {
        layer(0.78, -0.3, 0.58, m, 0.2, 0.7, 0.8);
      }
      c.restore();
    }
    /** The ball, lit twice: a cool key light from the sky (the specular), and from below the
     * minimum's glow, which grows as the ball goes deeper. Its aura takes the last answer's
     * colour, or the streak's fire. */
    function drawBall(c, L, bx, by, tint, lv) {
      const R = st.R, d = L.d, calm = still();
      let ax = 1, ay = 1;
      if (st.land) { const t = st.land.t, e = Math.exp(-t / 130) * Math.cos(t / 42); ax = 1 + 0.28 * st.land.k * e; ay = 1 - 0.3 * st.land.k * e; }
      else if (st.anim) { const v = clamp(Math.abs(st.vel) * 0.45, 0, 1); ax = 1 + 0.14 * v; ay = 1 - 0.1 * v; }
      let jx = st.shiver > 0 ? Math.sin(st.shiver * 0.11) * 3 * (st.shiver / 360) : 0;
      if (st.tense && !calm) jx += st.tense * (1.1 * Math.sin(st.t * 0.083) + 0.6 * Math.sin(st.t * 0.217)) * (0.5 + 0.5 * st.beat + 0.5 * st.tense); // it trembles as time runs out
      // it touches the path where it stands: the centre sits along the slope's normal, not straight up
      // (straight up leaves it floating beside its contact point on a slope)
      const e = st.view / 400, [lx, ly] = onPath(st.x - e), [rx, ry] = onPath(st.x + e);
      const th = Math.atan2(ry - ly, rx - lx), nx = Math.sin(th), ny = -Math.cos(th);
      const k = sink(), cx = bx + jx + nx * (R * ay - k), cy = by + ny * (R * ay - k);
      const F = fireOf(cx, cy, bx, by, lv, calm);
      const lit = F ? 1 - 0.55 * F.alpha : 1; // the fire's own light takes over from the aura
      c.save();
      c.globalCompositeOperation = "lighter";
      // a pool of light where it rests
      c.save(); c.translate(bx, by + 1); c.scale(1, 0.32);
      let g = c.createRadialGradient(0, 0, 0, 0, 0, R * 3.4);
      g.addColorStop(0, css(tint, 0.24 + 0.24 * d)); g.addColorStop(1, css(tint, 0));
      c.fillStyle = g; c.fillRect(-R * 3.4, -R * 3.4, R * 6.8, R * 6.8);
      c.restore();
      const ar = R * (2.3 + 1.3 * d + 0.18 * lv);
      g = c.createRadialGradient(cx, cy, R * 0.7, cx, cy, ar);
      g.addColorStop(0, css(tint, (0.2 + 0.26 * d + 0.03 * lv) * lit)); g.addColorStop(1, css(tint, 0));
      c.fillStyle = g; c.fillRect(cx - ar, cy - ar, ar * 2, ar * 2);
      if (F) fireLight(c, F);
      c.restore();
      if (F) flames(c, F, false);
      // a soft contact shadow where it sits in the groove, drawn under the ball, so it looks seated, not pasted on
      c.save();
      c.translate(cx, cy); c.rotate(th); c.translate(0, R * 0.62); c.scale(1, 0.42); // an ellipse along the slope
      g = c.createRadialGradient(0, 0, 0, 0, 0, R * 1.25);
      g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(0.6, "rgba(0,0,0,0.3)"); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(-R * 1.25, -R * 1.25, R * 2.5, R * 2.5);
      c.restore();
      c.save();
      // squash against the ground it lands on, then turn back so the light stays top-left
      c.translate(bx + jx - nx * k, by - ny * k); c.rotate(th); c.scale(ax, ay); c.translate(0, -R); c.rotate(-th);
      g = c.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.08, 0, 0, R * 1.05);
      g.addColorStop(0, "#fff7e2"); g.addColorStop(0.34, css(L.body)); g.addColorStop(1, css(L.edge));
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
      c.save(); c.clip();
      g = c.createRadialGradient(R * 0.5, R * 0.8, 0, R * 0.5, R * 0.8, R * 1.15);
      g.addColorStop(0, css(tint, 0.2 + 0.6 * d)); g.addColorStop(1, css(tint, 0));
      c.globalCompositeOperation = "lighter"; c.fillStyle = g; c.fillRect(-R, -R, 2 * R, 2 * R);
      if (F) { // the flames over it light its crown, and the side they stream back to
        c.globalAlpha = clamp(0.42 * F.alpha * F.fl, 0, 1);
        c.drawImage(glowSprite(FLAME[F.lv][1]), F.lean * 0.3 - R * 1.5, -R * 2.75, R * 3, R * 3);
        c.globalAlpha = 1;
      }
      c.restore();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath(); c.ellipse(-R * 0.36, -R * 0.42, R * 0.26, R * 0.17, -0.6, 0, Math.PI * 2); c.fill();
      c.restore();
      if (F) flames(c, F, true); // and its front: the ball sits inside the fire
      return [cx, cy];
    }

    /** What the fire sheds: embers (sparks of light), wisps (small flames that tear off the tips and
     * burn out as they rise) and, when it goes out, smoke. All of it fades before the numbers. */
    function drawBits(c) {
      const bits = st.fx.bits;
      if (!bits.length) return;
      const top = st.topY;
      c.save();
      for (const b of bits) {
        if (b.life < 0) continue;
        const [sx, sy] = toScreen(b.wx, b.wy);
        const x = sx + b.ox, y = sy + b.oy, k = b.life / b.max;
        const a = smooth(top, top + 26, y);
        if (a <= 0) continue;
        if (b.kind === "smoke") {
          const r = b.size * (1 + 1.8 * k);
          c.globalCompositeOperation = "source-over";
          c.globalAlpha = 0.55 * (1 - k) * Math.min(1, b.life / 90) * a;
          c.drawImage(glowSprite(SMOKE), x - r, y - r, r * 2, r * 2);
          continue;
        }
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 1;
        if (b.kind === "wisp") {
          const r = b.size * (1 - 0.7 * k);
          c.fillStyle = css(rgb(b.hex), 0.85 * (1 - k * k) * a);
          c.beginPath(); flameOutline(c, x, y, r, { h: 1.9, lean: clamp(-0.3 - b.vx * 8, -1.2, 0.5) }); c.fill();
        } else { // a hot point with a little glow round it
          c.globalAlpha = (1 - k) * a;
          const r = b.size * 1.8;
          c.drawImage(glowSprite(b.hex), x - r, y - r, r * 2, r * 2);
          c.globalAlpha = 1;
        }
      }
      c.restore();
    }

    function drawLive(c, L) {
      const { w, h, R } = st;
      const calm = still();
      const [bx, by] = onPath(st.x);
      const lv = flameLevel(st.streak);
      const tint = lv >= 2 ? rgb(FLAME[lv][1]) : st.tier && TIER_COLORS[st.tier] ? rgb(TIER_COLORS[st.tier]) : GOLD;

      // dust and embers
      const ember = L.A.basin;
      for (const m of st.motes) {
        const flick = calm ? 0.8 : 0.6 + 0.4 * Math.sin(st.t * 0.002 * m.sp * (1 + 2 * ember) + m.ph);
        c.fillStyle = css(L.mote, (0.14 + 0.36 * m.f) * flick * (0.7 + 0.5 * ember));
        const r = (0.6 + 1.3 * m.f) * (1 + 0.4 * ember);
        c.fillRect(m.x - r / 2, m.y - r / 2, r, r);
      }

      // landing rings, flat on the ground
      for (const r of st.ripples) {
        const t = 1 - r.life / r.max;
        const [px, py] = onPath(r.x);
        c.strokeStyle = r.color;
        for (let n = 0; n < r.rings; n++) {
          const tt = clamp(t * 1.25 - n * 0.14, 0, 1);
          if (tt <= 0 || tt >= 1) continue;
          const rad = 10 + ease.out(tt) * r.size * (1 - n * 0.1);
          c.globalAlpha = 0.6 * (1 - tt); c.lineWidth = 2.2 * (1 - tt) + 0.6;
          c.beginPath(); c.ellipse(px, py, rad, rad * 0.3, 0, 0, Math.PI * 2); c.stroke();
        }
      }
      c.globalAlpha = 1;

      // the wake behind a rolling ball: a ribbon that swells from nothing to the ball's width and
      // brightens towards it, with a hotter core
      if (st.trail.length > 1) {
        const pts = st.trail.map((p) => { const [x, y] = ballAt(p.x, R - sink()); return [x, y]; });
        const [hx, hy] = ballAt(st.x, R - sink()); pts.push([hx, hy]);
        const fade = clamp(1 - (st.t - st.trail[st.trail.length - 1].t) / 300, 0, 1);
        const n = pts.length, [x0, y0] = pts[0], [x1, y1] = pts[n - 1];
        if (fade > 0 && Math.hypot(x1 - x0, y1 - y0) > R) {
          c.save(); c.globalCompositeOperation = "lighter";
          const ribbon = (half, a, col) => {
            const left = [], right = [];
            for (let i = 0; i < n; i++) {
              const [ax, ay] = pts[Math.max(0, i - 1)], [cx2, cy2] = pts[Math.min(n - 1, i + 1)];
              const dl = Math.hypot(cx2 - ax, cy2 - ay) || 1;
              const nx = -(cy2 - ay) / dl, ny = (cx2 - ax) / dl;
              const wv = half * Math.pow(i / (n - 1), 1.4);
              left.push([pts[i][0] + nx * wv, pts[i][1] + ny * wv]);
              right.push([pts[i][0] - nx * wv, pts[i][1] - ny * wv]);
            }
            const g = c.createLinearGradient(x0, y0, x1, y1);
            g.addColorStop(0, css(col, 0)); g.addColorStop(1, css(col, a * fade));
            c.fillStyle = g;
            c.beginPath(); c.moveTo(left[0][0], left[0][1]);
            for (let i = 1; i < n; i++) c.lineTo(left[i][0], left[i][1]);
            for (let i = n - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
            c.closePath(); c.fill();
          };
          // on fire, the wake burns in the fire's own layers: deep outside, white-hot down the middle
          const [o, m, wh] = lv >= 3 ? FLAME[lv].map(rgb) : [tint, tint, tint];
          ribbon(R * 1.35, 0.1, o);
          ribbon(R * 0.85, 0.24, m);
          ribbon(R * 0.32, 0.42, wh);
          c.restore();
        }
      }

      // sparks
      if (st.sparks.length) {
        c.save(); c.globalCompositeOperation = "lighter"; c.lineCap = "round";
        for (const p of st.sparks) {
          const [sx, sy] = toScreen(p.wx, p.wy);
          const x = sx + p.ox, y = sy + p.oy, k = 1 - p.life / p.max;
          c.strokeStyle = css(p.col, k); c.lineWidth = p.size;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x - p.vx * 16, y - p.vy * 16); c.stroke();
        }
        c.restore();
      }

      const [cx, cy] = drawBall(c, L, bx, by, tint, lv);
      drawBits(c);

      // what the landing took off the loss, rising beside the ball on the open (downhill) side, clear
      // of the ball, its flames and every box at the top
      for (const t of st.texts) {
        const [px, py] = onPath(t.x);
        const k = t.life / t.max;
        c.font = `600 ${t.size}px Archivo, system-ui, sans-serif`;
        c.textAlign = "left";
        const tw = c.measureText(t.text).width;
        const tx = Math.min(px + R * 1.7, w - tw - 8);
        let y = py - R * 1.4 - (1 - k) * 16;
        for (const r of st.rects) if (tx + tw > r.x - 6 && tx < r.x + r.w + 6 && r.y + r.h / 2 < h / 2) y = Math.max(y, r.y + r.h + t.size + 4);
        c.globalAlpha = Math.min(1, k * 2.5);
        c.fillStyle = t.color;
        c.fillText(t.text, tx, y);
      }
      c.globalAlpha = 1;

      if (st.dim) { // a miss: the room goes dark for a moment
        c.fillStyle = css(L.skyTop, 0.38 * (1 - st.dim.t / st.dim.max));
        c.fillRect(0, 0, w, h);
      }
      if (st.wash) { // a jackpot: the whole stage flashes in the tier's colour
        const k = st.wash.t / st.wash.max;
        c.save(); c.globalCompositeOperation = "lighter";
        c.fillStyle = css(st.wash.col, st.wash.a * (k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 2)));
        c.fillRect(0, 0, w, h);
        c.restore();
      }
      if (st.flash) { // a rare landing lights the stage from the ball
        const k = st.flash.t / st.flash.max;
        const rr = R * (2.5 + 7 * ease.out(k));
        c.save(); c.globalCompositeOperation = "lighter";
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, rr);
        g.addColorStop(0, css(st.flash.col, 0.6 * (1 - k))); g.addColorStop(0.4, css(st.flash.col, 0.22 * (1 - k))); g.addColorStop(1, css(st.flash.col, 0));
        c.fillStyle = g; c.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        c.restore();
      }

      drawTension(c, L); // low time, under the edge fades so it melts into the page like the rest

      // the stage's edges dissolve into the page
      const bg = rgb(COL.bg);
      let g = c.createLinearGradient(0, h - 30, 0, h);
      g.addColorStop(0, css(bg, 0)); g.addColorStop(1, css(bg, 1));
      c.fillStyle = g; c.fillRect(0, h - 30, w, 30);
      g = c.createLinearGradient(0, 0, 0, 12);
      g.addColorStop(0, css(bg, 1)); g.addColorStop(1, css(bg, 0));
      c.fillStyle = g; c.fillRect(0, 0, w, 12);

      // a faint shade behind every number on the stage (the dust and the glow pass behind it)
      for (const r of st.rects) {
        const mx = r.x + r.w / 2, my = r.y + r.h / 2;
        c.save();
        c.translate(mx, my); c.scale(r.w * 0.72 + 18, r.h * 0.72 + 12);
        g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, css(bg, 0.5)); g.addColorStop(0.6, css(bg, 0.32)); g.addColorStop(1, css(bg, 0));
        c.fillStyle = g; c.fillRect(-1, -1, 2, 2);
        c.restore();
      }

      // the gem: the ball opens into the whole stage, ringed like a basin's contours
      if (st.flood) {
        const f = st.flood;
        const diag = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 8;
        let r;
        if (f.t < f.grow) r = lerp(R, diag, ease.expo(f.t / f.grow));
        else if (f.t < f.grow + f.hold) r = diag;
        else r = lerp(diag, R, ease.inOut(clamp((f.t - f.grow - f.hold) / f.shrink, 0, 1)));
        c.save();
        c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
        c.fillStyle = COL.gold; c.fillRect(0, 0, w, h);
        const bandW = w < 560 ? 22 : 30;
        const phase = (f.t * 0.05) % (bandW * 2);
        c.fillStyle = COL.goldBand;
        for (let rr = diag + bandW * 2 - phase; rr > R * 1.6; rr -= bandW * 2) {
          c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.arc(cx, cy, Math.max(0, rr - bandW), 0, Math.PI * 2, true); c.fill();
        }
        // the ball becomes the lion: it stays put and Leo's curve grows out of it, up to the numbers along
        // the top and no further (the streak sits right over it). The mane rises 44.4 units over the
        // ball's centre and the tail reaches 47.5 to its right, stroke included.
        const grow = clamp((r - R) / (diag * 0.4), 0, 1);
        const [mx, my, mr] = MARK.ball;
        const ms0 = R / mr, msBig = ms0 + (w < 560 ? 1 : 1.4);
        const over = st.rects.filter((b) => b.y + b.h / 2 < h / 2 && b.x < cx + 47.5 * msBig && b.x + b.w > cx - mr * msBig);
        const ceil = over.length ? Math.max(...over.map((b) => b.y + b.h)) : -Infinity;
        const ms = ms0 + grow * Math.max(0, Math.min(msBig, (cy - ceil - 6) / 44.4) - ms0);
        f.top = cy - 44.4 * ms; // the top of the mane on the stage (tests check it stays under the numbers)
        c.save();
        c.globalAlpha = clamp(grow * 5, 0, 1);
        c.translate(cx, cy); c.scale(ms, ms); c.translate(-mx, -my);
        c.strokeStyle = COL.goldInk; c.lineWidth = MARK.stroke; c.lineCap = "round"; c.lineJoin = "round";
        c.setLineDash([MARK.len * ease.out(grow), MARK.len + 1]);
        c.stroke(new Path2D(MARK.d));
        c.setLineDash([]);
        c.fillStyle = COL.goldInk;
        c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.fill();
        c.restore();
        c.restore();
      }

      // the coins, over everything (the gem's gold too): a dark rim keeps them readable on gold
      if (st.coins.length) {
        c.save(); c.lineWidth = 1; c.strokeStyle = "rgba(26,19,6,0.7)";
        for (const p of st.coins) {
          const [sx, sy] = toScreen(p.wx, p.wy);
          const x = sx + p.ox, y = sy + p.oy, k = p.life / p.max;
          const face = Math.cos(p.spin), rx = Math.max(0.9, Math.abs(face) * p.r);
          c.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          c.fillStyle = css(face >= 0 ? p.col : p.dark);
          c.beginPath(); c.ellipse(x, y, rx, p.r, p.tilt, 0, Math.PI * 2); c.fill(); c.stroke();
          if (face > 0.4) { // the glint on the face
            c.fillStyle = "rgba(255,255,255,0.75)";
            c.beginPath(); c.ellipse(x - rx * 0.32, y - p.r * 0.34, rx * 0.3, p.r * 0.2, p.tilt, 0, Math.PI * 2); c.fill();
          }
        }
        c.restore();
      }
    }

    /** Low time: the colour drains out of the world, fog closes in on the ball from the edges, and
     * the edges beat red with the heart. When the answer is in, a breath of warm light at the ball. */
    function drawTension(c, L) {
      const k = st.tense, ex = st.exhale;
      if (k < 0.003 && !ex) return;
      const { w, h, R } = st;
      const [bx, by] = ballAt(st.x, R - sink());
      if (k >= 0.003) {
        c.save();
        c.globalCompositeOperation = "saturation"; c.globalAlpha = Math.min(1, 0.85 * k);
        c.fillStyle = "#808080"; c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
        const diag = Math.hypot(w, h), fog = mixC(L.skyTop, [0, 0, 0], 0.4);
        let g = c.createRadialGradient(bx, by, diag * lerp(0.3, 0.05, k), bx, by, diag * lerp(0.8, 0.42, k));
        g.addColorStop(0, css(fog, 0)); g.addColorStop(0.55, css(fog, 0.55 * k)); g.addColorStop(1, css(fog, 0.94 * k));
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.translate(w / 2, h / 2); c.scale(w / 2, h / 2); // an ellipse fitted to the stage
        g = c.createRadialGradient(0, 0, 0.55, 0, 0, 1.45);
        g.addColorStop(0, css(TENSE_RED, 0)); g.addColorStop(1, css(TENSE_RED, k * (0.2 + 0.45 * st.beat)));
        c.fillStyle = g; c.fillRect(-1, -1, 2, 2);
        c.restore();
      }
      if (ex) {
        const t = ex.t / ex.max, r = R * (3 + 16 * ease.out(t));
        c.save(); c.globalCompositeOperation = "lighter";
        const g = c.createRadialGradient(bx, by, 0, bx, by, r);
        g.addColorStop(0, css(GOLD, 0.26 * (1 - t))); g.addColorStop(1, css(GOLD, 0));
        c.fillStyle = g; c.fillRect(bx - r, by - r, 2 * r, 2 * r);
        c.restore();
      }
    }

    function paint() {
      if (!st.w) return;
      const L = lightAt(depthAt(st.camX));
      const sig = [st.camX.toFixed(2), st.by.toFixed(2), st.sy.toFixed(4), st.zoom.toFixed(4), st.x.toFixed(1), st.segs.length, st.w, st.h, st.rects.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(";"), st.anim ? 1 : 0].join("|");
      if (sig !== st.sig) { st.sig = sig; drawWorld(wctx, L); }
      const { dpr } = st;
      const jx = st.shake ? (Math.random() - 0.5) * st.shake : 0, jy = st.shake ? (Math.random() - 0.5) * st.shake * 0.6 : 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (st.shake) { ctx.fillStyle = css(L.skyTop); ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(world, Math.round(jx * dpr), Math.round(jy * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, jx, jy);
      drawLive(ctx, L);
    }
    const busy = () => !!(st.hold > 0 || st.anim || st.ripples.length || st.texts.length || st.sparks.length || st.trail.length || st.flood || st.land || st.flash || st.dim || st.shiver || st.kick || st.shake ||
      st.coins.length || st.wash || st.exhale || st.beat || st.fx.out || (!still() && (st.tense || st.tenseTo)) ||
      (st.T && (Math.abs(st.camX - st.x - st.lead) > 0.3 || Math.abs(st.by - st.T.by) > 0.3 || Math.abs(st.sy - st.T.sy) > 0.002 || Math.abs(st.zoom - 1) > 0.0008)));

    let last = 0, lastPaint = 0;
    function frame(now) {
      st.raf = 0;
      let dt = last ? Math.min(50, now - last) : 16;
      last = now;
      if (st.hold > 0) { st.hold -= dt; dt = 0; now = st.holdAt; } // hit-stop: time stands still at the impact
      step(now, dt);
      const active = busy();
      // while something moves, every frame; at rest only the dust drifts, about 30 times a second
      if (active || now - lastPaint >= 32) { paint(); lastPaint = now; }
      if (st.onFrame && st.x !== st.reported) { st.reported = st.x; st.onFrame(st.x); }
      if (document.hidden) { last = 0; return; }
      if (active || (!still() && st.onScreen)) st.raf = requestAnimationFrame(frame);
      else last = 0;
    }
    function kick() { if (!st.raf && !document.hidden && st.w) { last = 0; st.raf = requestAnimationFrame(frame); } }
    /** Settle the camera and draw now (resume, a resize, a jump). */
    function snap() {
      st.framed = false;
      step(performance.now(), 0);
      paint();
      if (st.onFrame) { st.reported = st.x; st.onFrame(st.x); }
      kick();
    }
    function durationFor(tier) {
      return { miss: 280, baseline: 600, overfit: 1000, indist: 800, outlier: 950, longtail: 1150, mlion: 1300 }[tier] || 800;
    }
    function calm() {
      if (st.flood) { st.flood = null; st.onFlood && st.onFlood(false); }
      st.ripples = []; st.texts = []; st.sparks = []; st.trail = []; st.flash = null; st.dim = null; st.land = null; st.shiver = 0; st.hold = 0;
      st.coins = []; st.wash = null; st.tense = st.tenseTo = st.beat = 0; st.exhale = null;
      st.fx.bits = []; st.fx.out = null; st.fx.flare = 0; st.fx.grow = 1;
      if (st.w) paint();
    }

    const api = {
      resize,
      /** Jump straight to a state (used on resume and on the results screen). */
      set(results) {
        st.segs = []; st.marks = [];
        let x = 0, streak = 0, tier = null;
        for (const r of results) {
          if (r.tier) {
            const nx = x + r.score * 10;
            st.segs.push({ x0: x, x1: nx, tier: r.tier }); st.marks.push({ x: nx, tier: r.tier });
            x = nx; streak++; tier = r.tier;
          } else { streak = 0; tier = "miss"; }
        }
        st.streak = streak; st.tier = tier;
        st.x = x; st.anim = null;
        if (st.flood) { st.flood = null; st.onFlood && st.onFlood(false); }
        st.trail = []; st.sparks = []; st.land = null; st.coins = []; st.wash = null; st.hold = 0;
        Object.assign(st.fx, { lean: 0, leanV: 0, flare: 0, grow: 1, bits: [], out: null });
        measure();
        snap();
      },
      /** Animate one round's result; calls done() on landing. */
      roll(tier, points, done) {
        measure();
        if (st.flood) { st.flood = null; st.onFlood && st.onFlood(false); }
        st.anim = { from: st.x, to: st.x + points * 10, tier: tier || "miss", start: performance.now(), dur: durationFor(tier || "miss"), t: 0, done };
        kick();
      },
      /** Drop any landing effect still running (a new prompt is starting). */
      calm,
      /** The boxes over the stage moved or changed size (the streak lit or went out). */
      layout() { measure(); kick(); },
      /** The last seconds of the clock: k from 0 (calm) to 1 (out of time). Under Reduce motion, one still tint. */
      tension(k) {
        const to = clamp(+k || 0, 0, 1);
        if (still()) { const v = to > 0 ? 0.5 : 0; if (v !== st.tense || v !== st.tenseTo) { st.tense = st.tenseTo = v; st.beat = 0; if (st.w) paint(); } return; }
        st.tenseTo = to; kick();
      },
      /** Where the ball comes to rest on the stage (css px), its radius, and the bottom of the numbers over the stage. */
      spot() {
        const T = st.T || targets();
        return { x: st.w * AX, y: T.by - (st.R - sink()), r: st.R, top: T.topY, w: st.w, h: st.h };
      },
      /** A heartbeat: the red at the edges swells, then fades. */
      beat() { if (!still() && st.tenseTo) { st.beat = 1; kick(); } },
      /** The answer is in (or the round is over): everything lets go at once; exhale adds a breath of warm light. */
      release(exhale) {
        if (!st.tense && !st.tenseTo) return;
        st.tenseTo = 0; st.beat = 0;
        if (still()) { st.tense = 0; if (st.w) paint(); return; }
        if (exhale && st.tense > 0.05) st.exhale = { t: 0, max: 560 };
        kick();
      },
      get x() { return st.x; },
      get streak() { return st.streak; },
      destroy() {
        cancelAnimationFrame(st.raf); st.raf = 0;
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVis);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
      },
    };
    const onResize = () => resize();
    const onVis = () => { if (document.hidden) { cancelAnimationFrame(st.raf); st.raf = 0; last = 0; } else kick(); };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    // the stage folds when a phone keyboard opens, which no window resize reports
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
    if (ro) ro.observe(canvas);
    // off screen (scrolled down to Next on a short laptop) the dust stops drifting
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { st.onScreen = es[es.length - 1].isIntersecting; if (st.onScreen) kick(); }) : null;
    if (io) io.observe(canvas);
    resize();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { st.sig = ""; if (!st.raf && st.w) paint(); });
    return api;
  }

  // ----------------------------------------------------------- profile
  /** A finished run on the real terrain: the whole 7,000-unit slope, the
   * travelled part painted by tier, the ball where the run stopped. */
  function profileSvg(results, label) {
    const W = 1000, H = 300, padX = 16, top = 34, bottom = 36;
    const yMin = terrain(-40), yMax = terrain(END);
    const X = (x) => padX + (x / END) * (W - padX * 2);
    const Y = (y) => top + ((y - yMin) / (yMax - yMin)) * (H - top - bottom);
    const line = (a, b) => { let d = ""; for (let x = a; x <= b + 0.01; x += 20) { const xx = Math.min(x, b); d += `${d ? "L" : "M"}${X(xx).toFixed(1)} ${Y(terrain(xx)).toFixed(1)}`; } return d; };
    let x = 0;
    const segs = [], marks = [];
    for (const r of results) {
      if (!r.tier) continue;
      const nx = x + r.score * 10;
      segs.push(`<path d="${line(x, nx)}" stroke="${TIER_COLORS[r.tier]}" stroke-width="7"/>`);
      marks.push(`<circle cx="${X(nx).toFixed(1)}" cy="${Y(terrain(nx)).toFixed(1)}" r="5.5" fill="${TIER_COLORS[r.tier]}"/>`);
      x = nx;
    }
    const ground = `${line(0, END)}L${X(END)} ${H}L${X(0)} ${H}Z`;
    const bx = X(x), by = Y(terrain(x)) - 15;
    return `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label || "Your descent"}">
      <defs><linearGradient id="profile-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#13110e"/><stop offset="1" stop-color="#13110e" stop-opacity="0"/></linearGradient></defs>
      <path d="${ground}" fill="url(#profile-ground)"/>
      <path d="${line(0, END)}" fill="none" stroke="${COL.line}" stroke-width="3"/>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">${segs.join("")}</g>
      ${marks.join("")}
      <circle cx="${X(END).toFixed(1)}" cy="${Y(terrain(END)).toFixed(1)}" r="5" fill="none" stroke="${COL.gold}" stroke-width="2.5"/>
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="12" fill="${COL.gold}"/>
    </svg>`;
  }

  window.MLION_VISUALS = { initBackdrop, scene, Descent, TIER_COLORS, terrain, depthAt, glyph, mark, MARK, profileSvg, GLYPHS, setRounds, flame, FLAME, flameLevel };
})();
