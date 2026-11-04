/* MLion visuals.
 *  - initBackdrop/scene: the page's loss surface, drawn as perspective ridge
 *    slices, with a real momentum-SGD trajectory running into its basin.
 *  - Descent: the play stage, where each answer rolls the optimizer down a
 *    1-D slice of that surface. One point = 10 world units, so a perfect day
 *    travels 7,000 units and lands in the global minimum.
 *  - glyph: the tier marks. Five are tiny charts of what the tier means, a
 *    curve and the ball on it; the gem is the lion, a mane around a nabla.
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
  // The lion: an 11-point mane around a nabla, the gradient's own symbol.
  const MARK = {
    mane: "M0 -30L6.6 -22.5L16.2 -25.2L17.8 -15.4L27.3 -12.5L23.3 -3.3L29.7 4.3L21.4 9.8L22.7 19.6L12.7 19.8L8.5 28.8L0 23.5L-8.5 28.8L-12.7 19.8L-22.7 19.6L-21.4 9.8L-29.7 4.3L-23.3 -3.3L-27.3 -12.5L-17.8 -15.4L-16.2 -25.2L-6.6 -22.5Z",
    face: "M-15.5 -8.5H15.5L0 16Z",
    eyes: [[-5.2, -1.6], [5.2, -1.6]],
  };
  /** The lion mark. The mane takes currentColor, the face --mark-ink. */
  function mark(cls, label) {
    const a = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
    return `<svg class="mark${cls ? " " + cls : ""}" viewBox="-32 -32 64 64" ${a} focusable="false"><path class="mk-mane" d="${MARK.mane}" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path class="mk-face" d="${MARK.face}" fill="none" stroke-width="5.5" stroke-linejoin="round"/>${MARK.eyes.map(([x, y]) => `<circle class="mk-eye" cx="${x}" cy="${y}" r="2.3"/>`).join("")}</svg>`;
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
    const horizon = view === "home" ? h * (phone ? 0.44 : 0.36) : h * (phone ? 0.72 : 0.68);
    const f = phone ? w * 1.25 : w * 0.66;
    // put the basin where the screen has room for it: right of the title on
    // a wide screen, under it on a phone
    const cx = phone ? w * 0.5 + 0.1 * f : w * 0.66 - (0.9 * f) / 7.6;
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
      const fade = home ? 1 : 0.55;
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
    BD.dpr = Math.min(2, window.devicePixelRatio || 1);
    BD.w = window.innerWidth; BD.h = window.innerHeight;
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
  const END = 7000; // the global minimum
  function wig(x, z) {
    return 34 * Math.sin(x / 173 + z * 0.9) * (1 + 0.25 * z) +
      17 * Math.sin(x / 57 + 1.3 + z * 1.7) + 7 * Math.sin(x / 21 + 0.4 + z * 2.9);
  }
  /** Height of the play landscape at world x (y grows downward). It falls
   * all the way to x = 7000 and rises after it, so the end is the floor. */
  function terrain(x, z = 0) {
    const k = 260;
    const sp = k * Math.log1p(Math.exp((x - END) / k));
    const taper = 1 - Math.exp(-(((x - END) / 520) ** 2));
    return 0.42 * x - 1.5 * sp + wig(x, z) * taper;
  }

  // ------------------------------------------------------------ descent
  function Descent(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const st = {
      w: 0, h: 0, dpr: 1, view: 1000,
      x: 0, camX: 0, camY: 0, rot: 0,
      marks: [], segs: [], ripples: [], texts: [], flood: null,
      anim: null, shake: 0, raf: 0,
      onFrame: opts.onFrame || null, onFlood: opts.onFlood || null,
    };
    function resize() {
      const r = canvas.getBoundingClientRect();
      st.dpr = Math.min(2, window.devicePixelRatio || 1);
      st.w = Math.max(10, r.width); st.h = Math.max(10, r.height);
      canvas.width = Math.floor(st.w * st.dpr); canvas.height = Math.floor(st.h * st.dpr);
      st.view = st.w < 560 ? 820 : st.w < 1000 ? 1100 : 1500;
      draw();
    }
    const scale = () => st.w / st.view;
    const AX = 0.38, AY = 0.6;
    const RIDGES = 9;
    // slice z sits deeper: it is drawn smaller and higher, so it trails the camera
    function sliceXY(x, z) {
      const s = scale() / (1 + z * 0.42);
      const lift = st.h * 0.62 * (1 - 1 / (1 + z * 0.42));
      return [(x - st.camX) * s + st.w * AX, (terrain(x, z) - st.camY) * s + st.h * AY - lift];
    }

    function draw() {
      const { w, h } = st;
      const s = scale();
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, w, h);
      const sx = st.shake ? (Math.random() - 0.5) * st.shake : 0;
      ctx.save();
      ctx.translate(sx, 0);

      // the surface behind the path, far slices first
      for (let k = RIDGES; k >= 1; k--) {
        const z = k * 0.55;
        const sk = s / (1 + z * 0.42);
        const x0 = st.camX - (w * AX) / sk - 60, x1 = st.camX + (w * (1 - AX)) / sk + 60;
        const stepX = 7 / sk;
        ctx.beginPath();
        let first = true;
        for (let x = x0; x <= x1; x += stepX) {
          const [px, py] = sliceXY(x, z);
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
        ctx.lineTo(w + 20, h + 20); ctx.lineTo(-20, h + 20); ctx.closePath();
        ctx.fillStyle = COL.bg; ctx.fill();
        ctx.strokeStyle = mix(COL.bg, "#c9bba3", 0.2 + 0.3 * (1 - k / RIDGES));
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        first = true;
        for (let x = x0; x <= x1; x += stepX) {
          const [px, py] = sliceXY(x, z);
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // the path's own slice: ground below it, the line on top
      const x0 = st.camX - (w * AX) / s - 40, x1 = st.camX + (w * (1 - AX)) / s + 40;
      const stepX = 5 / s;
      const front = (fn) => { let f = true; for (let x = x0; x <= x1; x += stepX) { const [px, py] = sliceXY(x, 0); if (f) { fn.moveTo(px, py); f = false; } else fn.lineTo(px, py); } };
      ctx.beginPath(); front(ctx); ctx.lineTo(w + 20, h + 20); ctx.lineTo(-20, h + 20); ctx.closePath();
      ctx.fillStyle = "#13110e"; ctx.fill();

      // loss levels, set into the ground under the path
      ctx.font = `500 ${w < 560 ? 12 : 13}px Archivo, system-ui, sans-serif`;
      ctx.textAlign = "center";
      for (let L = 6; L >= 0; L--) {
        const wx = (7 - L) * 1000;
        if (wx < x0 - 80 || wx > x1 + 80) continue;
        const [px, py] = sliceXY(wx, 0);
        const passed = st.x >= wx - 0.5;
        ctx.fillStyle = L === 0 ? COL.gold : passed ? COL.ink : COL.muted;
        ctx.fillRect(px - 1, py + 7, 2, 8);
        ctx.fillText(L === 0 ? "0.00" : `${L}.00`, px, py + 32);
      }

      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = COL.line; ctx.lineWidth = 2;
      ctx.beginPath(); front(ctx); ctx.stroke();
      const segs = st.segs.slice();
      if (st.anim && st.anim.tier !== "miss") segs.push({ x0: st.anim.from, x1: Math.max(st.anim.from, st.x), tier: st.anim.tier });
      for (const sg of segs) {
        const a = Math.max(sg.x0, x0), b = Math.min(sg.x1, x1);
        if (b <= a) continue;
        ctx.strokeStyle = TIER_COLORS[sg.tier];
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        for (let x = a, f = true; x <= b + 0.01; x += stepX) {
          const [px, py] = sliceXY(Math.min(x, b), 0);
          if (f) { ctx.moveTo(px, py); f = false; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      for (const m of st.marks) {
        const [px, py] = sliceXY(m.x, 0);
        if (px < -20 || px > w + 20) continue;
        ctx.fillStyle = TIER_COLORS[m.tier];
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
      }

      // landing ripples: the basin's contour rings, more of them the rarer the answer
      for (const r of st.ripples) {
        const t = 1 - r.life / r.max;
        const [px, py0] = sliceXY(r.x, 0);
        const py = py0 - (w < 560 ? 10 : 12);
        ctx.fillStyle = r.color;
        for (let n = 0; n < r.rings; n++) {
          const tt = clamp(t * 1.25 - n * 0.14, 0, 1);
          if (tt <= 0 || tt >= 1) continue;
          const rad = 12 + ease.out(tt) * r.size * (1 - n * 0.12);
          ctx.globalAlpha = 0.55 * (1 - tt);
          ctx.beginPath(); ctx.arc(px, py, rad + 3, 0, Math.PI * 2); ctx.arc(px, py, Math.max(0, rad - 3), 0, Math.PI * 2, true); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // the ball
      const [bx, by0] = sliceXY(st.x, 0);
      const R = w < 560 ? 9 : 11;
      const by = by0 - R - 1;
      ctx.fillStyle = COL.gold;
      ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.fill();

      for (const t of st.texts) {
        const [px, py] = sliceXY(t.x, 0);
        const k = t.life / t.max;
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = t.color;
        ctx.font = `600 ${t.size}px Archivo, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(t.text, px, py - R * 2 - 14 - (1 - k) * 22);
        ctx.globalAlpha = 1;
      }

      // the gem: the ball opens into the whole stage, ringed like a basin's contours
      if (st.flood) {
        const f = st.flood;
        const diag = Math.hypot(Math.max(bx, w - bx), Math.max(by, h - by)) + 8;
        let r;
        if (f.t < f.grow) r = lerp(R, diag, ease.expo(f.t / f.grow));
        else if (f.t < f.grow + f.hold) r = diag;
        else r = lerp(diag, R, ease.inOut(clamp((f.t - f.grow - f.hold) / f.shrink, 0, 1)));
        ctx.save();
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = COL.gold; ctx.fillRect(0, 0, w, h);
        const band = w < 560 ? 22 : 30;
        const phase = (f.t * 0.05) % (band * 2);
        ctx.fillStyle = COL.goldBand;
        for (let rr = diag + band * 2 - phase; rr > R * 1.6; rr -= band * 2) {
          ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI * 2); ctx.arc(bx, by, Math.max(0, rr - band), 0, Math.PI * 2, true); ctx.fill();
        }
        // the ball has become the lion
        const ms = clamp((r - R) / (diag * 0.4), 0, 1) * (w < 560 ? 1.15 : 1.5) + R / 30;
        ctx.save();
        ctx.translate(bx, by); ctx.scale(ms, ms);
        ctx.fillStyle = COL.goldInk; ctx.strokeStyle = COL.goldInk; ctx.lineWidth = 3; ctx.lineJoin = "round";
        const mane = new Path2D(MARK.mane); ctx.fill(mane); ctx.stroke(mane);
        ctx.strokeStyle = COL.gold; ctx.lineWidth = 5.5; ctx.stroke(new Path2D(MARK.face));
        ctx.fillStyle = COL.gold;
        for (const [ex, ey] of MARK.eyes) { ctx.beginPath(); ctx.arc(ex, ey, 2.3, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        ctx.restore();
      }
      ctx.restore();
    }

    let last = 0;
    function frame(now) {
      const dt = Math.min(50, now - (last || now)); last = now;
      const a = st.anim;
      if (a) {
        a.t = Math.min(1, (now - a.start) / a.dur);
        const prevX = st.x;
        if (a.tier === "miss") {
          st.x = a.from + Math.sin(a.t * Math.PI * 7) * 16 * (1 - a.t);
          st.shake = 3 * (1 - a.t);
        } else if (a.tier === "overfit") {
          // overshoot the target, then oscillate back: textbook overfitting
          const e = ease.back(a.t);
          st.x = a.from + (a.to - a.from) * e + Math.sin(a.t * 22) * 22 * (1 - a.t) * (a.t > 0.5 ? 1 : 0);
        } else {
          st.x = a.from + (a.to - a.from) * (a.tier === "baseline" ? ease.out(a.t) : ease.inOut(a.t));
        }
        st.rot += (st.x - prevX) * 0.1;
        if (a.t >= 1) {
          st.x = a.tier === "miss" ? a.from : a.to;
          st.shake = 0;
          if (a.tier !== "miss") {
            st.segs.push({ x0: a.from, x1: a.to, tier: a.tier });
            st.marks.push({ x: a.to, tier: a.tier });
          }
          st.anim = null;
          landFx(a.tier, st.x);
          a.done && a.done();
        }
      }
      // camera
      const k = a ? 0.14 : 0.1;
      st.camX += (st.x - st.camX) * k;
      st.camY += (terrain(st.x) - st.camY) * k;
      for (const r of st.ripples) r.life -= dt;
      st.ripples = st.ripples.filter((r) => r.life > 0);
      for (const t of st.texts) t.life -= dt;
      st.texts = st.texts.filter((t) => t.life > 0);
      if (st.flood) {
        st.flood.t += dt;
        const f = st.flood;
        if (!f.inkOn && f.t > f.grow * 0.35) { f.inkOn = true; st.onFlood && st.onFlood(true); }
        if (f.inkOn && f.t > f.grow + f.hold + f.shrink * 0.5) { f.inkOn = false; st.onFlood && st.onFlood(false); }
        if (f.t >= f.grow + f.hold + f.shrink) st.flood = null;
      }
      draw();
      st.onFrame && st.onFrame(st.x);
      const settling = Math.abs(st.camX - st.x) > 0.5 || Math.abs(st.camY - terrain(st.x)) > 0.5;
      if (st.anim || st.ripples.length || st.texts.length || st.flood || settling) st.raf = requestAnimationFrame(frame);
      else { st.raf = 0; last = 0; }
    }
    function kick() { if (!st.raf) { last = 0; st.raf = requestAnimationFrame(frame); } }

    const RIPPLE = { baseline: [22, 1], overfit: [30, 1], indist: [48, 2], outlier: [78, 3], longtail: [120, 4] };
    function landFx(tier, x) {
      if (tier === "miss") { st.texts.push({ x, text: "NaN", color: COL.muted, size: 16, life: 1300, max: 1300 }); return; }
      if (tier === "mlion") {
        if (prefersReduced()) return;
        st.flood = { t: 0, grow: 600, hold: 900, shrink: 500, inkOn: false };
        return;
      }
      const [size, rings] = RIPPLE[tier] || [30, 1];
      st.ripples.push({ x, color: TIER_COLORS[tier], size, rings, life: 900 + rings * 120, max: 900 + rings * 120 });
    }
    function durationFor(tier) {
      if (prefersReduced()) return 250;
      return { miss: 650, baseline: 600, overfit: 1000, indist: 800, outlier: 950, longtail: 1150, mlion: 1300 }[tier] || 800;
    }
    function calm() {
      if (st.flood) { st.flood = null; st.onFlood && st.onFlood(false); }
      st.ripples = []; st.texts = [];
      draw();
    }

    const api = {
      resize,
      /** Jump straight to a state (used on resume and on the results screen). */
      set(results) {
        st.segs = []; st.marks = []; let x = 0;
        for (const r of results) {
          if (r.tier) {
            const nx = x + r.score * 10;
            st.segs.push({ x0: x, x1: nx, tier: r.tier }); st.marks.push({ x: nx, tier: r.tier }); x = nx;
          }
        }
        st.x = x; st.camX = x; st.camY = terrain(x); st.anim = null; st.flood = null;
        draw();
      },
      /** Animate one round's result; calls done() on landing. */
      roll(tier, points, done) {
        const from = st.x;
        st.flood = null;
        st.anim = { from, to: from + points * 10, tier: tier || "miss", start: performance.now(), dur: durationFor(tier || "miss"), t: 0, done };
        kick();
      },
      /** Drop any landing effect still running (a new prompt is starting). */
      calm,
      get x() { return st.x; },
      destroy() { cancelAnimationFrame(st.raf); st.raf = 0; window.removeEventListener("resize", onResize); },
    };
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    resize();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!st.raf) draw(); });
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
      <path d="${ground}" fill="#13110e"/>
      <path d="${line(0, END)}" fill="none" stroke="${COL.line}" stroke-width="3"/>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">${segs.join("")}</g>
      ${marks.join("")}
      <circle cx="${X(END).toFixed(1)}" cy="${Y(terrain(END)).toFixed(1)}" r="5" fill="none" stroke="${COL.gold}" stroke-width="2.5"/>
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="12" fill="${COL.gold}"/>
    </svg>`;
  }

  window.MLION_VISUALS = { initBackdrop, scene, Descent, TIER_COLORS, terrain, glyph, mark, MARK, profileSvg, GLYPHS };
})();
