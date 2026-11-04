/* MLion visuals: the page's topographic backdrop and the gradient-descent
 * view, where each answer rolls the optimizer down a 1-D loss landscape.
 * One point = 10 world units, so a perfect day travels 7,000 units. */
(function () {
  "use strict";

  const TIER_COLORS = {
    baseline: "#a0a8b9", overfit: "#ff9150", indist: "#3fd99a",
    outlier: "#47c6ff", longtail: "#b991ff", mlion: "#ffd23f", miss: "#4a5468",
  };
  const prefersReduced = () => document.documentElement.classList.contains("reduce-motion");

  // ---------------------------------------------------------- backdrop
  function field(x, y, t) {
    return (
      Math.sin(x * 0.0042 + t) * Math.cos(y * 0.0037 - t * 0.6) * 1.1 +
      Math.sin((x + y) * 0.0021 + 1.7) * 0.9 +
      Math.cos(Math.hypot(x - 700, y - 380) * 0.006) * 0.8 +
      Math.sin(x * 0.011 - y * 0.007) * 0.18
    );
  }
  function drawBackdrop(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const step = 14;
    const cols = Math.ceil(w / step) + 1, rows = Math.ceil(h / step) + 1;
    const vals = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) vals[j * cols + i] = field(i * step, j * step, 0.4);
    const levels = [];
    for (let l = -2.4; l <= 2.4; l += 0.3) levels.push(l);
    levels.forEach((lv, li) => {
      const gold = li === 9;
      ctx.strokeStyle = gold ? "rgba(245,185,66,0.16)" : `rgba(120,135,170,${0.05 + 0.025 * (li % 3)})`;
      ctx.lineWidth = gold ? 1.2 : 1;
      ctx.beginPath();
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = vals[j * cols + i], b = vals[j * cols + i + 1];
          const c = vals[(j + 1) * cols + i + 1], d = vals[(j + 1) * cols + i];
          const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          const x = i * step, y = j * step;
          const lerp = (p, q) => (lv - p) / (q - p || 1e-6);
          const top = [x + step * lerp(a, b), y];
          const right = [x + step, y + step * lerp(b, c)];
          const bottom = [x + step * lerp(d, c), y + step];
          const left = [x, y + step * lerp(a, d)];
          const segs = {
            1: [left, bottom], 2: [bottom, right], 3: [left, right], 4: [top, right],
            5: [left, top, bottom, right], 6: [top, bottom], 7: [left, top], 8: [left, top],
            9: [top, bottom], 10: [left, bottom, top, right], 11: [top, right], 12: [left, right],
            13: [bottom, right], 14: [left, bottom],
          }[idx];
          for (let s = 0; s < segs.length; s += 2) {
            ctx.moveTo(segs[s][0], segs[s][1]);
            ctx.lineTo(segs[s + 1][0], segs[s + 1][1]);
          }
        }
      }
      ctx.stroke();
    });
    // vignette
    const g = ctx.createRadialGradient(w / 2, h * 0.3, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
    g.addColorStop(0, "rgba(9,11,16,0)");
    g.addColorStop(1, "rgba(9,11,16,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  function initBackdrop() {
    const c = document.getElementById("landscape");
    if (!c) return;
    let t = null;
    const go = () => drawBackdrop(c);
    go();
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(go, 150); });
  }

  // ------------------------------------------------------------ descent
  /** Height of the loss landscape at world x (y grows downward). */
  function terrain(x) {
    return 0.42 * x + 34 * Math.sin(x / 173) + 17 * Math.sin(x / 57 + 1.3) + 7 * Math.sin(x / 21 + 0.4);
  }
  const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    back: (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  };

  function Descent(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const st = {
      w: 0, h: 0, dpr: 1, view: 1000,
      x: 0, camX: 0, camY: 0, rot: 0,
      marks: [], // {x, tier}
      segs: [], // {x0, x1, tier}
      particles: [], rings: [], texts: [],
      anim: null, shake: 0, glow: 0, raf: 0,
      onFrame: opts.onFrame || null,
    };
    function resize() {
      const r = canvas.getBoundingClientRect();
      st.dpr = Math.min(2, window.devicePixelRatio || 1);
      st.w = Math.max(10, r.width); st.h = Math.max(10, r.height);
      canvas.width = Math.floor(st.w * st.dpr); canvas.height = Math.floor(st.h * st.dpr);
      st.view = st.w < 500 ? 900 : 1150;
      draw();
    }
    const scale = () => st.w / st.view;
    function toScreen(x, y) {
      const s = scale();
      return [(x - st.camX) * s + st.w * 0.36, (y - st.camY) * s + st.h * 0.5];
    }

    function spawn(x, y, n, color, speed, life, size) {
      if (prefersReduced()) n = Math.min(n, 4);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random());
        st.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life, max: life, color, size: size * (0.5 + Math.random()) });
      }
    }

    function draw() {
      const { w, h } = st;
      const s = scale();
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const sx = st.shake ? (Math.random() - 0.5) * st.shake : 0;
      const sy = st.shake ? (Math.random() - 0.5) * st.shake : 0;
      ctx.save();
      ctx.translate(sx, sy);

      // sky
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0d111b"); sky.addColorStop(1, "#080a10");
      ctx.fillStyle = sky; ctx.fillRect(-10, -10, w + 20, h + 20);

      // faint grid
      ctx.strokeStyle = "rgba(90,105,140,0.08)"; ctx.lineWidth = 1;
      const gs = 100 * s;
      const offX = ((-st.camX * s + w * 0.36) % gs + gs) % gs, offY = ((-st.camY * s + h * 0.5) % gs + gs) % gs;
      ctx.beginPath();
      for (let gx = offX; gx < w; gx += gs) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (let gy = offY; gy < h; gy += gs) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();

      const x0 = st.camX - w * 0.36 / s - 40, x1 = st.camX + (w * 0.64) / s + 40;
      const stepX = 6 / s;
      // contour bands below the surface
      for (let k = 5; k >= 0; k--) {
        ctx.beginPath();
        let first = true;
        for (let x = x0; x <= x1; x += stepX) {
          const [px, py] = toScreen(x, terrain(x) + k * 26);
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
        if (k === 0) {
          ctx.lineTo(w + 20, h + 20); ctx.lineTo(-20, h + 20); ctx.closePath();
          const g = ctx.createLinearGradient(0, h * 0.3, 0, h);
          g.addColorStop(0, "rgba(28,34,50,0.95)"); g.addColorStop(1, "rgba(13,16,24,0.98)");
          ctx.fillStyle = g; ctx.fill();
        } else {
          ctx.strokeStyle = `rgba(110,125,165,${0.05 + 0.03 * (5 - k)})`; ctx.lineWidth = 1; ctx.stroke();
        }
      }

      // loss checkpoints every 1.00
      ctx.font = "600 10px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      for (let L = 6; L >= 0; L--) {
        const wx = (7 - L) * 1000;
        if (wx < x0 - 50 || wx > x1 + 50) continue;
        const [px, py] = toScreen(wx, terrain(wx));
        const passed = st.x >= wx;
        const col = L === 0 ? "rgba(255,210,63," : passed ? "rgba(245,185,66," : "rgba(140,150,175,";
        ctx.strokeStyle = col + (passed || L === 0 ? "0.6)" : "0.35)");
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 46); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col + (passed || L === 0 ? "0.95)" : "0.6)");
        ctx.fillText(L === 0 ? "GLOBAL MIN" : `loss ${L}.00`, px, py - 52);
        if (L === 0) { ctx.font = "18px serif"; ctx.fillText("🦁", px, py - 66); ctx.font = "600 10px 'IBM Plex Mono', monospace"; }
      }

      // surface line, colored along the path already travelled
      ctx.lineWidth = 2.2; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(160,170,195,0.55)";
      ctx.beginPath();
      let first = true;
      for (let x = x0; x <= x1; x += stepX) {
        const [px, py] = toScreen(x, terrain(x));
        if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      const segs = st.segs.slice();
      if (st.anim && st.anim.tier && st.anim.tier !== "miss") segs.push({ x0: st.anim.from, x1: st.x, tier: st.anim.tier });
      for (const sg of segs) {
        const a = Math.max(sg.x0, x0), b = Math.min(sg.x1, x1);
        if (b <= a) continue;
        ctx.strokeStyle = TIER_COLORS[sg.tier];
        ctx.shadowColor = TIER_COLORS[sg.tier]; ctx.shadowBlur = 10;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        for (let x = a, f = true; x <= b + 0.01; x += stepX) {
          const xx = Math.min(x, b);
          const [px, py] = toScreen(xx, terrain(xx) - 1);
          if (f) { ctx.moveTo(px, py); f = false; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // landing marks
      for (const m of st.marks) {
        const [px, py] = toScreen(m.x, terrain(m.x));
        if (px < -20 || px > w + 20) continue;
        ctx.fillStyle = TIER_COLORS[m.tier];
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
      }

      // rings
      for (const r of st.rings) {
        const [px, py] = toScreen(r.x, r.y);
        const t = 1 - r.life / r.max;
        ctx.strokeStyle = r.color.replace("ALPHA", (1 - t).toFixed(3));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 8 + t * r.size, 0, Math.PI * 2); ctx.stroke();
      }

      // ball
      const by = terrain(st.x) - 10;
      const [bx, byy] = toScreen(st.x, by);
      const R = Math.max(7, 9.5 * Math.min(1.25, s * 1.6));
      if (st.glow > 0) {
        const gg = ctx.createRadialGradient(bx, byy, 0, bx, byy, R * 6);
        gg.addColorStop(0, `rgba(255,210,63,${0.45 * st.glow})`); gg.addColorStop(1, "rgba(255,210,63,0)");
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(bx, byy, R * 6, 0, Math.PI * 2); ctx.fill();
      }
      const bg = ctx.createRadialGradient(bx - R * 0.35, byy - R * 0.4, R * 0.1, bx, byy, R);
      bg.addColorStop(0, "#fff3c4"); bg.addColorStop(0.45, "#f5b942"); bg.addColorStop(1, "#a86d0c");
      ctx.fillStyle = bg;
      ctx.shadowColor = "rgba(245,185,66,0.7)"; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(bx, byy, R, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(70,40,0,0.55)"; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(st.rot) * R * 0.2, byy + Math.sin(st.rot) * R * 0.2);
      ctx.lineTo(bx + Math.cos(st.rot) * R * 0.85, byy + Math.sin(st.rot) * R * 0.85);
      ctx.stroke();

      // particles
      for (const p of st.particles) {
        const [px, py] = toScreen(p.x, p.y);
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // floating texts
      for (const t of st.texts) {
        const [px, py] = toScreen(t.x, t.y);
        ctx.globalAlpha = Math.max(0, t.life / t.max);
        ctx.fillStyle = t.color;
        ctx.font = `700 ${t.size}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = "center";
        ctx.fillText(t.text, px, py - (1 - t.life / t.max) * 26);
      }
      ctx.globalAlpha = 1;
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
          st.x = a.from + Math.sin(a.t * Math.PI * 7) * 18 * (1 - a.t);
          st.shake = 4 * (1 - a.t);
        } else if (a.tier === "overfit") {
          // overshoot the target, then oscillate back: textbook overfitting
          const e = ease.back(a.t);
          st.x = a.from + (a.to - a.from) * e + Math.sin(a.t * 22) * 24 * (1 - a.t) * (a.t > 0.5 ? 1 : 0);
        } else {
          st.x = a.from + (a.to - a.from) * (a.tier === "baseline" ? ease.out(a.t) : ease.inOut(a.t));
        }
        st.rot += (st.x - prevX) * 0.12;
        const by = terrain(st.x) - 10;
        if (a.tier === "longtail" && Math.random() < 0.6) spawn(st.x - 6, by, 1, TIER_COLORS.longtail, 0.6, 700, 2.6);
        if (a.tier === "outlier" && Math.random() < 0.35) spawn(st.x, by, 1, TIER_COLORS.outlier, 1.2, 600, 2.2);
        if (a.tier === "mlion" && Math.random() < 0.7) spawn(st.x - 4, by, 2, TIER_COLORS.mlion, 1, 800, 2.4);
        if (a.tier === "indist" && Math.random() < 0.25) spawn(st.x, by, 1, TIER_COLORS.indist, 0.8, 500, 2);
        if (a.tier === "mlion") st.glow = Math.min(1, st.glow + dt / 600);
        if (a.t >= 1) {
          st.x = a.tier === "miss" ? a.from : a.to;
          st.shake = 0;
          if (a.tier !== "miss") {
            st.segs.push({ x0: a.from, x1: a.to, tier: a.tier });
            st.marks.push({ x: a.to, tier: a.tier });
          }
          landFx(a.tier, st.x);
          st.anim = null;
          a.done && a.done();
        }
      }
      // camera
      const k = a ? 0.14 : 0.1;
      st.camX += (st.x - st.camX) * k;
      st.camY += (terrain(st.x) - st.camY) * k;
      if (!a && st.glow > 0 && !st.holdGlow) st.glow = Math.max(0, st.glow - dt / 1600);
      // particles
      for (const p of st.particles) { p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06; p.vy += 0.004 * dt; p.life -= dt; }
      st.particles = st.particles.filter((p) => p.life > 0);
      for (const r of st.rings) r.life -= dt;
      st.rings = st.rings.filter((r) => r.life > 0);
      for (const t of st.texts) t.life -= dt;
      st.texts = st.texts.filter((t) => t.life > 0);
      draw();
      st.onFrame && st.onFrame(st.x);
      const settling = Math.abs(st.camX - st.x) > 0.5 || Math.abs(st.camY - terrain(st.x)) > 0.5;
      if (st.anim || st.particles.length || st.rings.length || st.texts.length || settling || st.glow > 0) {
        st.raf = requestAnimationFrame(frame);
      } else { st.raf = 0; last = 0; }
    }
    function kick() { if (!st.raf) { last = 0; st.raf = requestAnimationFrame(frame); } }

    function landFx(tier, x) {
      const y = terrain(x) - 10;
      const c = TIER_COLORS[tier] || TIER_COLORS.miss;
      switch (tier) {
        case "miss":
          st.texts.push({ x, y: y - 22, text: "NaN", color: "#8b95ab", size: 16, life: 1300, max: 1300 });
          spawn(x, y, 8, "#59627a", 0.8, 700, 2);
          break;
        case "baseline":
          spawn(x, y, 8, c, 0.7, 600, 2);
          break;
        case "overfit":
          spawn(x, y, 14, c, 1.1, 700, 2.4);
          st.texts.push({ x, y: y - 24, text: "val loss ↑", color: c, size: 12, life: 1500, max: 1500 });
          break;
        case "indist":
          spawn(x, y, 16, c, 1.2, 800, 2.4);
          break;
        case "outlier":
          spawn(x, y, 24, c, 1.6, 900, 2.6);
          st.rings.push({ x, y, life: 700, max: 700, size: 40, color: "rgba(71,198,255,ALPHA)" });
          break;
        case "longtail":
          spawn(x, y, 30, c, 1.8, 1100, 2.8);
          st.rings.push({ x, y, life: 900, max: 900, size: 60, color: "rgba(185,145,255,ALPHA)" });
          break;
        case "mlion":
          spawn(x, y, 60, c, 2.4, 1500, 3);
          st.rings.push({ x, y, life: 1100, max: 1100, size: 90, color: "rgba(255,210,63,ALPHA)" });
          st.rings.push({ x, y, life: 1500, max: 1500, size: 140, color: "rgba(255,210,63,ALPHA)" });
          st.texts.push({ x, y: y - 28, text: "ROAR", color: "#ffd23f", size: 18, life: 1600, max: 1600 });
          break;
      }
    }

    function durationFor(tier) {
      if (prefersReduced()) return 250;
      return { miss: 900, baseline: 900, overfit: 1500, indist: 1200, outlier: 1500, longtail: 1900, mlion: 2400 }[tier] || 1000;
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
        st.x = x; st.camX = x; st.camY = terrain(x); st.anim = null;
        draw();
      },
      /** Animate one round's result; calls done() on landing. */
      roll(tier, points, done) {
        const from = st.x;
        st.anim = { from, to: from + points * 10, tier: tier || "miss", start: performance.now(), dur: durationFor(tier || "miss"), t: 0, done };
        kick();
      },
      get x() { return st.x; },
      destroy() { cancelAnimationFrame(st.raf); st.raf = 0; window.removeEventListener("resize", onResize); },
    };
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    resize();
    return api;
  }

  window.MLION_VISUALS = { initBackdrop, Descent, TIER_COLORS, terrain };
})();
