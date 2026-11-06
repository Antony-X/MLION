/* MLion hero: a loss surface in 3D and a ball doing momentum SGD down it.
 *   const hero = MLionHero.mount(canvas, { progress, onStage });
 *   hero.setProgress(t) / hero.resize() / hero.destroy() / hero.ok
 * progress(): 0..1, read on scroll and resize (default: page scroll). After
 *   setProgress(t) the instance is manual and ignores scrolling.
 * onStage(i): depth 0..5 the ball is in, on mount and at every crossing.
 * MLionHero.stages: the progress at which each depth begins.
 * ok: false without WebGL (the canvas stays blank).
 * Raw WebGL: the surface is opaque in the page colour so the depth buffer hides
 * lines behind it; lines are computed per pixel, thin and anti-aliased at any
 * distance. Draws only when progress or size changes, never offscreen. */
(function () {
  "use strict";

  // wide basin near the viewer, high far wall, decoy pit and saddle, ripples
  const GX = 0.55, GZ = 0.5, DX = -0.55, DZ = -0.12, HS = 0.55; // HS: loss to height
  function loss(x, z) {
    const dx = x - GX, dz = z - GZ, b = Math.min(0, z - 0.35);
    const basin = Math.exp(-dx * dx / 0.6 - dz * dz / 0.5);
    const rip = 0.032 * Math.sin(5.3 * x + 1.9 * z) * Math.cos(4.4 * z - 1.3 * x) +
      0.012 * Math.sin(11.5 * x + 0.7) * Math.sin(9.5 * z + 1.1);
    return -basin + 0.15 * x * x + 0.1 * (z - 0.35) ** 2 + 0.32 * b * b -
      0.5 * Math.exp(-((x - DX) ** 2 + (z - DZ) ** 2) / 0.07) + rip * (1 - 0.8 * basin);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  /** Tells the game's stage whether a real GPU draws the page (window.MLION_GPU): no WebGL, or WebGL drawn on the
   *  CPU (SwiftShader and the like), means the browser draws canvases on the CPU too, and the stage draws its long
   *  lines whole there (landscape.js, PIECE). Free here: this context is made anyway. */
  function noteGpu(gl) {
    if (!gl) { window.MLION_GPU = false; return; }
    try {
      const d = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      window.MLION_GPU = !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (e) { /* unknown: leave it */ }
  }

  // heavy-ball momentum from rest on the far wall, v = 0.965 v - 0.001 grad L,
  // resampled by 3D arc length so progress is distance travelled
  const PATH = (function () {
    let x = -1.05, z = -1.5, vx = 0, vz = 0;
    const raw = [[x, z, loss(x, z)]], e = 1e-4;
    for (let i = 0; i < 3000; i++) {
      vx = 0.965 * vx - 0.001 * (loss(x + e, z) - loss(x - e, z)) / (2 * e);
      vz = 0.965 * vz - 0.001 * (loss(x, z + e) - loss(x, z - e)) / (2 * e);
      x += vx; z += vz; raw.push([x, z, loss(x, z)]);
      if (i > 200 && Math.hypot(vx, vz) < 4e-5) break;
    }
    const len = [0];
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1], b = raw[i];
      len.push(len[i - 1] + Math.hypot(b[0] - a[0], (b[2] - a[2]) * HS, b[1] - a[1]));
    }
    const out = [], M = 600, total = len[len.length - 1];
    for (let k = 0, j = 0; k < M; k++) {
      const s = (k / (M - 1)) * total;
      while (j < len.length - 2 && len[j + 1] < s) j++;
      const f = Math.min(1, (s - len[j]) / (len[j + 1] - len[j] || 1));
      const x = lerp(raw[j][0], raw[j + 1][0], f), z = lerp(raw[j][1], raw[j + 1][1], f);
      out.push([x, loss(x, z), z]);
    }
    return out;
  })();
  const LAST = PATH.length - 1, END = PATH[LAST];
  const L0 = PATH[0][1], LMIN = Math.min(...PATH.map((p) => p[1]));

  // each tier is a loss level: the share of the total drop the game calls its
  // depth. A depth begins where the ball first gets that low.
  const TIER = ["#857f76", "#a59a88", "#c4ae88", "#dfbf7e", "#f5d999", "#f2b53c"].map(rgb);
  const MARKS = [0, 0.18, 0.36, 0.6, 0.82, 0.97].map((q) => {
    const level = L0 - q * (L0 - LMIN);
    let k = 0;
    while (k < LAST && PATH[k][1] > level + 1e-9) k++;
    return { level, x: PATH[k][0], z: PATH[k][2], t: k / LAST };
  });
  const STAGES = MARKS.map((m) => m.t);
  const stageAt = (t) => { let i = 0; while (i < 5 && t >= STAGES[i + 1]) i++; return i; };
  const BG = rgb("#0b0a08"), INK = rgb("#e4d6bd");

  // a slow orbit and dolly down to the basin; reduced motion keeps the opening pose
  function camera(t, w, h, still) {
    const e = still ? 0 : smooth(t), tall = h > w * 1.1;
    const yaw = lerp(-0.24, 0.16, e), pitch = lerp(0.4, 0.7, e), dist = lerp(5.9, 4.8, e);
    const tg = [lerp(-0.3, END[0] - 0.05, e), lerp(0.3, END[1] * HS + 0.05, e), lerp(-0.45, END[2] - 0.05, e)];
    const eye = [tg[0] + dist * Math.sin(yaw) * Math.cos(pitch), tg[1] + dist * Math.sin(pitch), tg[2] + dist * Math.cos(yaw) * Math.cos(pitch)];
    // target on screen: phone, under the copy, then up out of the text's way;
    // wide, right of the copy
    const lift = still ? 0.3 : smooth(clamp(t / 0.3, 0, 1));
    const fx = tall ? 0.5 : 0.66, fy = tall ? lerp(0.76, 0.4, lift) : lerp(0.76, 0.55, lift); // wide: the ball starts beside the buttons, clear of the wordmark
    const f = 1 / Math.tan((tall ? 1 : 0.66) / 2), n = 0.1, far = 40;
    // view basis: forward, side, up
    let F = tg.map((v, i) => v - eye[i]), l = Math.hypot(...F);
    F = F.map((v) => v / l);
    let S = [-F[2], 0, F[0]]; l = Math.hypot(...S); S = S.map((v) => v / l);
    const U = [S[1] * F[2] - S[2] * F[1], S[2] * F[0] - S[0] * F[2], S[0] * F[1] - S[1] * F[0]];
    const d = (a) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
    const V = [S[0], U[0], -F[0], 0, S[1], U[1], -F[1], 0, S[2], U[2], -F[2], 0, -d(S), -d(U), d(F), 1];
    // perspective with the lens shifted so the target lands at (fx, fy)
    const P = [f * h / w, 0, 0, 0, 0, f, 0, 0, 1 - fx * 2, fy * 2 - 1, (far + n) / (n - far), -1, 0, 0, (2 * far * n) / (n - far), 0];
    const m = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) m[c * 4 + r] += P[k * 4 + r] * V[c * 4 + k];
    return { m, eye, f, dist };
  }

  const SURF_VS = `attribute vec3 p;uniform mat4 M;uniform vec3 E;varying vec3 P;varying float D;
void main(){P=p;D=distance(p,E);gl_Position=M*vec4(p,1.);}`;
  // ridges (const z), faint cross lines (const x), brighter as loss falls, faded
  // far and at the edges, warmed round the ball; depth notches; the goal ring
  const SURF_FS = `#extension GL_OES_standard_derivatives:enable
precision highp float;varying vec3 P;varying float D;
uniform vec3 BG,INK,TC[6];uniform vec4 MK[6],BALL;uniform vec2 FOG;uniform float W,HS;
float ln(float u){float fw=length(vec2(dFdx(u),dFdy(u)));float d=abs(fract(u-.5)-.5)/fw;
return clamp(W*.5+.5-d,0.,1.)*(1.-smoothstep(.16,.38,fw));}
void main(){float L=P.y/HS;vec2 q=P.xz;
float a=max(ln(q.y*12.),.18*ln(q.x*4.));
float sd=distance(q,BALL.xy),lit=exp(-sd*sd/.16);
float lum=max(mix(.42,.95,smoothstep(1.,-.95,L)),.9*lit);
float fog=1.-.5*smoothstep(FOG.x,FOG.y,D);
float edge=(1.-smoothstep(2.3,3.,abs(q.x)))*smoothstep(-2.6,-2.05,q.y)*(1.-smoothstep(2.5,3.2,q.y));
vec3 c=mix(BG,mix(INK,TC[5],.55*lit),a*lum*max(fog,lit)*edge);
float gl=max(length(vec2(dFdx(L),dFdy(L))),1e-6);
for(int i=1;i<6;i++){vec4 m=MK[i];float d=abs(L-m.z)/gl;float r=distance(q,m.xy);
float k=clamp(W*.75+.5-d,0.,1.)*(i==5?1.-smoothstep(.3,.5,r):1.-smoothstep(.05,.14,r));
c=mix(c,TC[i],k*m.w*fog);if(i==5)c+=TC[5]*BALL.w*.16*exp(-d*d/(W*W*10.))*(1.-smoothstep(.3,.5,r));}
c=mix(BG,c,smoothstep(BALL.z*.5,BALL.z*1.4,sd));
gl_FragColor=vec4(c,1.);}`;
  // round sprites sized in world units: the trail dots and the ball
  const DOT_VS = `attribute vec4 p;attribute vec4 c;uniform mat4 M;uniform float K,MX;varying vec4 C;varying float S;
void main(){vec4 q=M*vec4(p.xyz,1.);gl_Position=q;S=clamp(2.*p.w*K/q.w,1.6,MX-2.);gl_PointSize=S+2.;C=c;}`;
  const DOT_FS = `precision mediump float;varying vec4 C;varying float S;
void main(){vec2 q=gl_PointCoord*2.-1.;float r=length(q)*(S+2.)/S;
float a=clamp((1.-r)*S*.5+.5,0.,1.),sh=1.05-.22*smoothstep(.1,1.5,length(q-vec2(-.42,-.5)));
gl_FragColor=vec4(C.rgb*sh,C.a*a);}`;

  function mount(canvas, opts) {
    opts = opts || {};
    const mq = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
    const reduced = () => !!(mq && mq.matches) || document.documentElement.classList.contains("reduce-motion");
    const source = typeof opts.progress === "function" ? opts.progress : () => {
      const el = document.scrollingElement || document.documentElement;
      const max = el.scrollHeight - el.clientHeight; // clientHeight, not innerHeight: the iOS address bar changes innerHeight mid-scroll
      return max > 0 ? scrollY / max : 0;
    };
    const st = { target: 0, shown: -1, w: 0, h: 0, dpr: 1, raf: 0, last: 0, manual: false, onScreen: true, stage: -1, dead: false };
    const R = 0.075, STEP = Math.round(LAST / 80);
    const dotData = new Float32Array((Math.ceil(LAST / STEP) + 2) * 8);
    let gl = null, surf, dots, buf, ibuf, dbuf, nIdx, maxPt = 64;

    function program(vs, fs) {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
        const name = gl.getActiveUniform(p, i).name.replace("[0]", "");
        u[name] = gl.getUniformLocation(p, name);
      }
      return { p, u, a: [gl.getAttribLocation(p, "p"), gl.getAttribLocation(p, "c")] };
    }
    function init() {
      try {
        gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: "low-power" });
        noteGpu(gl);
        if (!gl || !gl.getExtension("OES_standard_derivatives")) throw 0;
        const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        surf = program(SURF_VS, hp && hp.precision > 0 ? SURF_FS : SURF_FS.replace("highp", "mediump"));
        dots = program(DOT_VS, DOT_FS);
        maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || maxPt;
        // the surface mesh: x across, z toward the viewer, y = loss
        const N = 161, pos = new Float32Array(N * N * 3), idx = new Uint16Array((N - 1) * (N - 1) * 6);
        for (let j = 0, o = 0; j < N; j++) for (let i = 0; i < N; i++, o += 3) {
          const x = lerp(-3, 3, i / (N - 1)), z = lerp(-2.6, 3.2, j / (N - 1));
          pos[o] = x; pos[o + 1] = loss(x, z) * HS; pos[o + 2] = z;
        }
        for (let j = 0, o = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++, o += 6) {
          const a = j * N + i;
          idx.set([a, a + N, a + 1, a + 1, a + N, a + N + 1], o);
        }
        nIdx = idx.length;
        buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        ibuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        dbuf = gl.createBuffer();
        return true;
      } catch (err) {
        if (err && window.console) console.warn("MLionHero:", err);
        gl = null;
        return false;
      }
    }

    function draw() {
      if (!gl || st.w < 2) return;
      const t = clamp(st.shown, 0, 1), H = canvas.height;
      const cam = camera(t, st.w, st.h, reduced());
      const f = t * LAST, i0 = Math.min(LAST - 1, Math.floor(f));
      const bx = lerp(PATH[i0][0], PATH[i0 + 1][0], f - i0), bz = lerp(PATH[i0][2], PATH[i0 + 1][2], f - i0);
      const ball = [bx, loss(bx, bz), bz];
      gl.viewport(0, 0, canvas.width, H);
      gl.clearColor(BG[0], BG[1], BG[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND);

      // reached depths are notched across the path; the last is the goal ring
      const mk = [];
      MARKS.forEach((m, i) => {
        const lit = smooth(clamp((t - m.t) / 0.025 + 0.5, 0, 1));
        if (i === 5) mk.push(END[0], END[2], m.level, 0.22 + 0.78 * lit);
        else mk.push(m.x, m.z, m.level, 0.85 * lit);
      });
      const u = surf.u;
      gl.useProgram(surf.p);
      gl.uniformMatrix4fv(u.M, false, cam.m);
      gl.uniform3fv(u.E, cam.eye);
      gl.uniform3fv(u.BG, BG); gl.uniform3fv(u.INK, INK);
      gl.uniform3fv(u.TC, [].concat(...TIER));
      gl.uniform4fv(u.MK, mk);
      gl.uniform4f(u.BALL, bx, bz, R * 1.15, smooth(clamp((t - 0.9) / 0.1, 0, 1)));
      gl.uniform2f(u.FOG, cam.dist * 0.75, cam.dist * 1.9);
      gl.uniform1f(u.W, 1.15 * st.dpr);
      gl.uniform1f(u.HS, HS);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
      gl.enableVertexAttribArray(surf.a[0]); gl.vertexAttribPointer(surf.a[0], 3, gl.FLOAT, false, 0, 0);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(surf.a[0]);

      // trail: grey warming to gold with depth, fading behind; then the ball
      let n = 0;
      const put = (p, r, c, a) => { dotData.set([p[0], p[1] * HS + r * 0.6, p[2], r, c[0], c[1], c[2], a], 8 * n++); };
      for (let k = 0; k < f - STEP * 0.6; k += STEP) put(PATH[k], 0.016, TIER[stageAt(k / LAST)], 0.14 + 0.82 * Math.exp(-(f - k) / LAST / 0.12));
      put(ball, R, TIER[5], 1);
      gl.useProgram(dots.p);
      gl.uniformMatrix4fv(dots.u.M, false, cam.m);
      gl.uniform1f(dots.u.K, cam.f * H * 0.5);
      gl.uniform1f(dots.u.MX, maxPt);
      gl.bindBuffer(gl.ARRAY_BUFFER, dbuf);
      gl.bufferData(gl.ARRAY_BUFFER, dotData.subarray(0, n * 8), gl.DYNAMIC_DRAW);
      const [a0, a1] = dots.a;
      gl.enableVertexAttribArray(a0); gl.enableVertexAttribArray(a1);
      gl.vertexAttribPointer(a0, 4, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(a1, 4, gl.FLOAT, false, 32, 16);
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      if (n > 1) gl.drawArrays(gl.POINTS, 0, n - 1);
      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.POINTS, n - 1, 1);
      gl.disableVertexAttribArray(a0); gl.disableVertexAttribArray(a1);

      const s = stageAt(t);
      if (s !== st.stage) { st.stage = s; if (opts.onStage) opts.onStage(s); }
    }

    // ease the shown progress toward the target, and stop once it arrives
    function frame(now) {
      st.raf = 0;
      if (st.dead || !st.onScreen || document.hidden) return;
      const dt = Math.min(64, now - (st.last || now)), d = st.target - st.shown;
      st.last = now;
      if (st.shown < 0 || reduced() || Math.abs(d) < 1e-4) st.shown = st.target;
      else st.shown += d * (1 - Math.exp(-dt / 110));
      draw();
      if (st.shown !== st.target) st.raf = requestAnimationFrame(frame); else st.last = 0;
    }
    function kick() { if (!st.raf && !st.dead && st.onScreen && !document.hidden) st.raf = requestAnimationFrame(frame); }
    function sample() { if (!st.manual) { const p = +source(); st.target = clamp(isFinite(p) ? p : 0, 0, 1); } }
    function read() { sample(); if (st.target !== st.shown) kick(); }
    function resize() {
      const r = canvas.getBoundingClientRect();
      st.dpr = Math.min(2, window.devicePixelRatio || 1);
      st.w = r.width; st.h = r.height;
      const W = Math.round(st.w * st.dpr), H = Math.round(st.h * st.dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      sample();
      if (st.shown < 0) st.shown = st.target;
      draw();
      kick();
    }

    const onVis = () => { if (!document.hidden) { draw(); read(); } };
    const onLost = (e) => { e.preventDefault(); gl = null; };
    const onRestored = () => { if (init()) draw(); };
    const io = window.IntersectionObserver && new IntersectionObserver((es) => {
      st.onScreen = es[es.length - 1].isIntersecting;
      if (st.onScreen) read();
    });
    const ro = window.ResizeObserver && new ResizeObserver(resize);

    if (!init()) return { ok: false, setProgress() {}, resize() {}, destroy() {} };
    const listen = [[window, "scroll", read], [window, "resize", read], [document, "visibilitychange", onVis],
      [canvas, "webglcontextlost", onLost], [canvas, "webglcontextrestored", onRestored]];
    listen.forEach(([o, e, fn]) => o.addEventListener(e, fn, e === "scroll" ? { passive: true } : false));
    if (io) io.observe(canvas);
    if (ro) ro.observe(canvas);
    resize();

    return {
      ok: true,
      setProgress(t) { st.manual = true; st.target = clamp(+t || 0, 0, 1); kick(); },
      resize,
      destroy() {
        st.dead = true; cancelAnimationFrame(st.raf);
        listen.forEach(([o, e, fn]) => o.removeEventListener(e, fn));
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (gl) {
          [buf, ibuf, dbuf].forEach((b) => gl.deleteBuffer(b)); gl.deleteProgram(surf.p); gl.deleteProgram(dots.p);
          const lose = gl.getExtension("WEBGL_lose_context"); // free the context now: browsers cap how many stay alive
          if (lose) lose.loseContext();
          gl = null;
        }
      },
    };
  }

  window.MLionHero = { mount, stages: STAGES };
})();
