#!/usr/bin/env node
/* Render the background music (js/music.js) and the real sound effects (Sound in js/app.js) offline in
 * headless Chromium, write WAVs, and measure them: loudness (BS.1770 LUFS), peaks, clipping and
 * spectral balance. Nothing here ships; it is how the music was tuned without ears.
 *   node tools/music-render.js <outdir> [name-prefix ...]
 * Writes <outdir>/demo.wav (a 90 s descent: menu, seven answers, results), state_*.wav (each depth
 * and reaction, with one answer sound at 1 s as a level reference), transition_sweep.wav,
 * fx_reference.wav, stems/ (music-only and effects-only renders of the same scripts) and report.json.
 * Every render suspends the OfflineAudioContext every 50 ms to pump the music's scheduler (what the
 * 50 ms timer does in the game) and to fire the scripted game events through the same hooks. */
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tests", "out", "music"));
const ONLY = process.argv.slice(3);
const { chromium } = require("playwright");
fs.mkdirSync(path.join(OUT, "stems"), { recursive: true });

// Sound, cut out of app.js unchanged
const app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
const a = app.indexOf("  const Sound = (() => {");
const b = app.indexOf("\n  })();\n", a);
if (a < 0 || b < 0) throw new Error("Sound block not found in js/app.js");
const SOUND_SRC = app.slice(a, b) + "\n  })();\n  return Sound;";
const MUSIC_SRC = fs.readFileSync(path.join(ROOT, "js/music.js"), "utf8");

// ------------------------------------------------------------------ scripts
// [t, action, ...args]: view(name), depth(d), ramp(d0, d1, secs), sound(method, arg), streak(n) (the level
// only, no chord), clock(ms at t; counts down), clockstop, resolve(d)
const depthAt = (pts) => { const d = Math.min(1, (pts * 10) / 7000); return 1 - (1 - d) * (1 - d); }; // landscape.js on the daily hill
const ROLL = { baseline: 0.6, overfit: 1.0, indist: 0.8, outlier: 0.95, longtail: 1.15, mlion: 1.3 };
/** One daily round: 3 s preview, then the clock until the answer (or the buzzer), the roll, the streak chord. */
function round(tStart, answerAt, tier, prevPts, pts, opts = {}) {
  const clockAt = tStart + 3, secs = opts.secs || 25, ev = [[clockAt, "clock", secs * 1000]];
  if (tier === "miss") {
    const end = clockAt + secs;
    for (let s = 5; s >= 1; s--) ev.push([end - s, "sound", "tick"]);
    ev.push([end, "clockstop"], [end, "sound", "miss"]);
    if (opts.fizzle) ev.push([end + 0.3, "sound", "fizzle"]);
    return ev;
  }
  ev.push([answerAt, "clockstop"], [answerAt, "sound", "submit"], [answerAt + 0.02, "sound", "tier", tier]);
  ev.push([answerAt + 0.02, "ramp", depthAt(prevPts), depthAt(pts), ROLL[tier]]);
  if (opts.streak) ev.push([answerAt + 0.02 + ROLL[tier], "sound", "streak", opts.streak]);
  return ev;
}
const DEMO = [
  [0, "view", "page"], // home: the calm menu variant
  [4, "view", "play"], [4, "depth", 0],
  ...round(4, 11, "indist", 0, 30),
  ...round(13, 19, "outlier", 30, 90, { streak: 2 }),
  ...round(22, 28, "longtail", 90, 175, { streak: 3 }),
  ...round(31, 0, "miss", 175, 175, { secs: 10, fizzle: true }), // a 10 s clock runs out: low time, ticks, a miss
  ...round(46, 52, "outlier", 175, 235),
  ...round(54, 60, "mlion", 235, 335, { streak: 2 }),
  ...round(63, 69, "longtail", 335, 420, { streak: 3 }),
  [72, "view", "results"], [72, "resolve", depthAt(420)],
];
const SCRIPTS = {
  fx_reference: { secs: 54, fxOnly: true, script: [
    ...["baseline", "overfit", "indist", "outlier", "longtail", "mlion"].map((t, i) => [1 + 4 * i, "sound", "tier", t]),
    [26, "sound", "streak", 3], [30, "sound", "streak", 7], [34, "sound", "miss"], [38, "sound", "submit"],
    [40, "sound", "tick"], [41, "sound", "tick"], [42, "sound", "tick"], [45, "sound", "fizzle"], [49, "sound", "chat"]] },
  state_menu: { secs: 45, script: [[0, "view", "page"]] },
  state_plateau: { secs: 45, script: [[0, "view", "play"], [0, "depth", 0.03]] },
  state_ravine: { secs: 45, script: [[0, "view", "play"], [0, "depth", 0.45]] },
  state_basin: { secs: 45, script: [[0, "view", "play"], [0, "depth", 0.97]] },
  state_basin_streak7: { secs: 45, script: [[0, "view", "play"], [0, "depth", 0.97], [0.5, "streak", 7]] },
  state_lowtime: { secs: 45, script: [[0, "view", "play"], [0, "depth", 0.5], [16, "clock", 14000], [30, "clockstop"], [30, "sound", "miss"]] },
  state_results: { secs: 55, script: [[0, "view", "play"], [0, "depth", 0.85], [15, "view", "results"], [15, "resolve", 0.85]] },
  transition_sweep: { secs: 85, script: [[0, "view", "play"], [0, "depth", 0], [2, "ramp", 0, 1, 76]] },
  demo: { secs: 90, script: DEMO },
};
const REF = [[12, "sound", "submit"], [12.02, "sound", "tier", "indist"]]; // a level reference in each state file, once the music has settled
const JOBS = [];
for (const [name, s] of Object.entries(SCRIPTS)) {
  if (s.fxOnly) { JOBS.push({ name, file: `${name}.wav`, secs: s.secs, script: s.script, fx: true, music: false }); continue; }
  const script = name.startsWith("state_") ? REF.concat(s.script) : s.script;
  JOBS.push({ name, file: `${name}.wav`, secs: s.secs, script, fx: true, music: true });
  JOBS.push({ name: `${name}__music`, file: `stems/${name}__music.wav`, secs: s.secs, script, fx: false, music: true });
  JOBS.push({ name: `${name}__fx`, file: `stems/${name}__fx.wav`, secs: s.secs, script, fx: true, music: false });
}
// --solo: each layer alone in the state where it lives (for balancing the layers against each other)
if (process.argv.includes("--solo")) {
  ONLY.splice(ONLY.indexOf("--solo"), 1);
  for (const [state, layers] of [["state_plateau", ["pad", "far", "air"]], ["state_ravine", ["pad", "bass", "pulse", "far"]], ["state_basin", ["pad", "bass", "arp", "far"]]]) {
    for (const solo of layers) JOBS.push({ name: `solo_${state.slice(6)}_${solo}__music`, file: `stems/solo_${state.slice(6)}_${solo}.wav`, secs: 40, script: SCRIPTS[state].script, fx: false, music: true, solo });
  }
}

// ------------------------------------------------------------------ in the page
async function renderInPage({ job, SOUND_SRC }) {
  const sr = 48000, secs = job.secs, STEP = 0.05;
  const OFF = new OfflineAudioContext(2, Math.round(secs * sr), sr);
  const realResume = OfflineAudioContext.prototype.resume.bind(OFF);
  OFF.resume = () => Promise.resolve(); // Sound resumes a suspended context; offline we resume it ourselves
  window.AudioContext = function () { return OFF; };
  const settings = { sound: true, music: job.music, musicVol: 0.5, haptics: false };
  const Sound = new Function("settings", SOUND_SRC)(settings);
  Sound.unlock();
  let seed = 20261105; // mulberry32: every render of a script plays the same notes, so stems line up
  const rng = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const LEVEL = window.MLION_MUSIC.LEVEL, saved = Object.assign({}, LEVEL);
  if (job.solo) for (const k in LEVEL) if (k !== job.solo) LEVEL[k] = 0;
  const M = window.MLION_MUSIC.init({ graph: () => Sound.graph(), settings: () => settings, manual: true, rng });
  // what app.js's wrapper does: the effect plays, then the music hears about it (a music-only stem skips the effect)
  const fire = (k, arg) => { if (job.fx) Sound[k](arg); M.duck(k, arg); };
  const script = job.script.slice().sort((p, q) => p[0] - q[0]);
  let si = 0, ramp = null, clock = null, maxVoices = 0;
  function at(t) {
    while (si < script.length && script[si][0] <= t + 1e-6) {
      const [t0, act, ...args] = script[si++];
      if (act === "view") M.view(args[0]);
      else if (act === "depth") M.depth(args[0]);
      else if (act === "resolve") M.resolve(args[0]);
      else if (act === "ramp") ramp = { t0, d0: args[0], d1: args[1], dur: args[2] };
      else if (act === "sound") fire(args[0], args[1]);
      else if (act === "streak") M.duck("streak", args[0]);
      else if (act === "clock") clock = { t0, ms: args[0] };
      else if (act === "clockstop") clock = null;
    }
    if (ramp) { const u = Math.min(1, (t - ramp.t0) / ramp.dur); M.depth(ramp.d0 + (ramp.d1 - ramp.d0) * u); if (u >= 1) ramp = null; }
    if (clock) M.clock(Math.max(0, clock.ms - (t - clock.t0) * 1000));
  }
  at(0);
  if (job.music) M.start();
  M.pump();
  for (let k = 1; k * STEP < secs - 0.01; k++) {
    OFF.suspend(k * STEP).then(() => {
      at(OFF.currentTime); M.pump();
      const e = M.engine;
      if (e) maxVoices = Math.max(maxVoices, e.voices());
      realResume();
    });
  }
  const t0 = performance.now();
  const buf = await OFF.startRendering();
  Object.assign(LEVEL, saved);
  const ms = performance.now() - t0;
  const ch = [buf.getChannelData(0), buf.getChannelData(1)], n = ch[0].length;
  // float32 stereo, interleaved, as base64 (the measurements need the real samples)
  const f32 = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { f32[2 * i] = ch[0][i]; f32[2 * i + 1] = ch[1][i]; }
  const bytes = new Uint8Array(f32.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), sr, ms, maxVoices };
}

// ------------------------------------------------------------------ measurements
/** Biquad (RBJ / BS.1770 coefficients) over one channel. */
function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
/** BS.1770-4 K-weighting coefficients for any sample rate. */
function kWeights(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, hp];
}
function loudness(L, R, fs) {
  const [s, h] = kWeights(fs);
  const kl = biquad(biquad(L, s), h), kr = biquad(biquad(R, s), h);
  const blockPow = (len, hop) => {
    const out = [];
    for (let i = 0; i + len <= kl.length; i += hop) { let e = 0; for (let j = i; j < i + len; j++) e += kl[j] * kl[j] + kr[j] * kr[j]; out.push({ t: i / fs, p: e / len }); }
    return out;
  };
  const lufs = (p) => -0.691 + 10 * Math.log10(p + 1e-20);
  const mom = blockPow(Math.round(0.4 * fs), Math.round(0.1 * fs)); // momentary: 400 ms, 75% overlap
  const st = blockPow(Math.round(3 * fs), Math.round(1 * fs)); // short-term: 3 s, every second
  const abs = mom.filter((m) => lufs(m.p) > -70);
  const mean = (arr) => arr.reduce((x, m) => x + m.p, 0) / Math.max(1, arr.length);
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((m) => lufs(m.p) > rel);
  return { integrated: lufs(mean(gated)), momentary: mom.map((m) => ({ t: m.t, l: lufs(m.p) })), shortTerm: st.map((m) => ({ t: m.t, l: lufs(m.p) })) };
}
/** Peak after 4x oversampling (windowed sinc), the "true peak" a DAC can produce. */
function truePeak(x) {
  const taps = 32, up = 4, h = [];
  for (let p = 0; p < up; p++) {
    const row = [];
    for (let k = -taps / 2; k < taps / 2; k++) { const t = k - p / up, w = 0.5 + 0.5 * Math.cos((Math.PI * t) / (taps / 2 + 1)); row.push(t === 0 ? 1 : (Math.sin(Math.PI * t) / (Math.PI * t)) * w); }
    h.push(row);
  }
  let peak = 0;
  for (let i = taps / 2; i < x.length - taps / 2; i++) {
    if (Math.abs(x[i]) < peak * 0.5) continue; // quiet stretches can't hold the peak
    for (let p = 0; p < up; p++) { let v = 0; const row = h[p]; for (let k = 0; k < taps; k++) v += row[k] * x[i + k - taps / 2]; if (Math.abs(v) > peak) peak = Math.abs(v); }
  }
  return peak;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const BANDS = [["sub <45", 0, 45], ["bass 45-150", 45, 150], ["lowmid 150-500", 150, 500], ["mid 500-2k", 500, 2000], ["presence 2k-5k", 2000, 5000], ["air >5k", 5000, 24000]];
/** Welch power spectrum (8192-point Hann windows) -> share of energy per band and the centroid. */
function spectrum(L, R, fs, from = 0, to = Infinity) {
  const N = 8192, hop = 4096, win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const acc = new Float64Array(N / 2);
  const i0 = Math.max(0, Math.round(from * fs)), i1 = Math.min(L.length, Math.round(to * fs));
  for (let s = i0; s + N <= i1; s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = 0.5 * (L[s + i] + R[s + i]) * win[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  const total = acc.reduce((x, v) => x + v, 0) || 1;
  const share = {};
  let cen = 0;
  for (let k = 0; k < N / 2; k++) cen += ((k * fs) / N) * acc[k];
  for (const [name, lo, hi] of BANDS) { let e = 0; for (let k = 0; k < N / 2; k++) { const f = (k * fs) / N; if (f >= lo && f < hi) e += acc[k]; } share[name] = +((100 * e) / total).toFixed(1); }
  return { share, centroid: Math.round(cen / total) };
}
function wav16(L, R, sr) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (const c of [L, R]) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767 + Math.random() - Math.random()))), o); o += 2; } // TPDF dither
  return buf;
}
const r1 = (v) => Math.round(v * 10) / 10;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text()); });
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: MUSIC_SRC });
  const report = {};
  const audio = {};
  for (const job of JOBS) {
    if (ONLY.length && !ONLY.some((o) => job.name.startsWith(o))) continue;
    const r = await page.evaluate(renderInPage, { job, SOUND_SRC });
    const f = new Float32Array(Buffer.from(r.b64, "base64").buffer.slice(0));
    const n = f.length / 2, L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
    fs.writeFileSync(path.join(OUT, job.file), wav16(L, R, r.sr));
    let peak = 0, clips = 0;
    for (let i = 0; i < n; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > peak) peak = v; if (v >= 0.999) clips++; }
    const lo = loudness(L, R, r.sr);
    const tp = Math.max(truePeak(L), truePeak(R));
    const rep = { secs: job.secs, renderMs: Math.round(r.ms), maxOscillators: r.maxVoices, integratedLUFS: r1(lo.integrated), maxMomentaryLUFS: r1(Math.max(...lo.momentary.map((m) => m.l))),
      maxShortTermLUFS: r1(Math.max(...lo.shortTerm.map((m) => m.l))), samplePeakDBFS: r1(20 * Math.log10(peak + 1e-12)), truePeakDBTP: r1(20 * Math.log10(tp + 1e-12)), clippedSamples: clips };
    if (job.music && !job.fx) { rep.spectrum = spectrum(L, R, r.sr, 4); rep.trace = lo.momentary.filter((q) => Math.abs(q.t - Math.round(q.t)) < 0.01).map((q) => r1(q.l)); } // music alone: balance after the fade-in, and its level each second
    report[job.name] = rep;
    audio[job.name] = { L, R, sr: r.sr, lo };
    console.log(job.name.padEnd(30), JSON.stringify(rep));
  }
  // music against the effects: each effect's loudest 400 ms against the music's level just before it
  const win = (arr, a0, a1) => arr.filter((q) => q.t >= a0 && q.t + 0.4 <= a1);
  const power = (ls) => 10 * Math.log10(ls.reduce((s, l) => s + Math.pow(10, l / 10), 0) / Math.max(1, ls.length));
  const label = (e) => e[2] + (e[3] != null ? `(${e[3]})` : "");
  const cmp = {};
  for (const name of Object.keys(SCRIPTS)) {
    const x = audio[`${name}__fx`] || (SCRIPTS[name].fxOnly && audio[name]), m = audio[`${name}__music`];
    if (!x) continue;
    const events = SCRIPTS[name].script.concat(name.startsWith("state_") ? REF : []).filter((e) => e[1] === "sound" && !(e[2] === "submit" && !SCRIPTS[name].fxOnly));
    const rows = events.map((e) => {
      const t = e[0], fxMax = Math.max(...win(x.lo.momentary, t - 0.05, t + 1.5).map((q) => q.l));
      const row = { t, sound: label(e), fxMomentaryMax: r1(fxMax) };
      if (m) { const before = power(win(m.lo.momentary, t - 3, t - 0.05).map((q) => q.l)); row.musicBefore = r1(before); row.gapDB = r1(fxMax - before); }
      return row;
    });
    cmp[name] = { musicIntegratedLUFS: m ? report[`${name}__music`].integratedLUFS : null, events: rows };
    console.log(`\n${name}${m ? `  (music integrated ${report[`${name}__music`].integratedLUFS} LUFS)` : ""}`);
    for (const r of rows) console.log(`  ${String(r.t).padStart(6)} s  ${r.sound.padEnd(18)} fx ${String(r.fxMomentaryMax).padStart(6)}  ${m ? `music ${String(r.musicBefore).padStart(6)}  gap ${r.gapDB}` : ""}`);
  }
  report.musicVsEffects = cmp;
  // the demo, second by second: how loud the music is (short-term) as the ball goes down
  if (audio.demo__music) report.demoMusicShortTerm = audio.demo__music.lo.shortTerm.map((q) => [q.t, r1(q.l)]);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
