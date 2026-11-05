/* MLion background music: a generative ambient score. Everything is Web Audio: no files, no libraries.
 *
 * The music follows the descent. The ball's depth (0 on the misty plateau, 1 in the gold basin) moves
 * the harmony from A (open fifths, no thirds, high and thin) through a falling bass in the ravines to
 * C major (spread ninth chords, low and full), and fades layers in and out with the same three acts the
 * landscape draws. Only the white keys are used, so nothing rubs against the effect bells on C, E and G.
 * It ducks under every sound effect, swells a little with the streak, thins out while the clock runs
 * low, resolves to C on the results screen, and stops when the tab is hidden or Sound or Music is off.
 *
 *   const music = MLION_MUSIC.init({ graph, unlock, settings })
 *     graph()    -> { ctx, room } once Sound has an AudioContext, else null (never creates one)
 *     unlock()   creates/resumes Sound's context; called only inside a user gesture
 *     settings() -> the live settings object (sound, music, musicVol)
 *   music.view(name)   the screen: "play", "results"; anything else is a menu (a quieter plateau)
 *   music.depth(d)     the ball's depth 0..1, from the Descent (MLION_VISUALS.depthAt(x))
 *   music.resolve(d)   the results screen: the final tonic chord is as warm as the run went deep
 *   music.clock(ms)    time left on the answer clock, called every frame it shows: the low-time hook
 *   music.duck(kind, arg)  an effect just played (Sound's method name and its first argument)
 *   music.sync()       settings or visibility changed
 * CONTEXT.md ("Background music") has the harmonic plan, the layers and the hooks. */
(function () {
  "use strict";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const u = clamp((t - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const dbGain = (db) => Math.pow(10, db / 20);
  /** The descent's three acts as weights that sum to 1, on the landscape's own breakpoints (landscape.js acts()). */
  const acts = (d) => { const r = smooth(0.16, 0.4, d), b = smooth(0.62, 0.88, d); return { plateau: 1 - r, ravine: r * (1 - b), basin: b }; };

  // ---------------------------------------------------------------- harmony
  // Pitch classes C0 D2 E4 F5 G7 A9 B11. Each chord has three voicings, spread wide on purpose (no close
  // thirds low down, which is where mud lives): cold (root, fifth, ninth: no third), mid (a seventh chord)
  // and warm (a ninth chord). `home` is the depth where the chord belongs: A minor up on the plateau, C at
  // the bottom.
  const CHORDS = {
    Am: { root: 9, home: 0.04, v: [[0, 7, 14], [0, 7, 15, 22], [0, 7, 15, 22, 26]] },
    Em: { root: 4, home: 0.22, v: [[0, 7, 10], [0, 7, 15, 22], [0, 7, 15, 22, 29]] },
    Dm: { root: 2, home: 0.32, v: [[0, 7, 14], [0, 7, 15, 22], [0, 7, 15, 22, 26]] },
    G: { root: 7, home: 0.5, v: [[0, 7, 14], [0, 7, 14, 21], [0, 7, 16, 21, 26]] },
    F: { root: 5, home: 0.66, v: [[0, 7, 11], [0, 7, 16, 23], [0, 7, 16, 23, 26]], glow: [0, 7, 16, 23, 30] }, // glow: maj7#11
    C: { root: 0, home: 0.92, v: [[0, 7, 14], [0, 7, 16, 23], [0, 7, 16, 23, 26]] },
  };
  // Where each chord likes to go (weights). Depth and the falling bass reweight these at every change.
  const NEXT = {
    Am: { F: 3, G: 2, Em: 2, Dm: 2, C: 1 },
    Em: { Am: 3, F: 2, C: 2, G: 1, Dm: 1 },
    Dm: { Am: 2, F: 2, G: 2, C: 2, Em: 1 },
    G: { Am: 2, Em: 2, C: 3, F: 2 },
    F: { C: 3, Am: 2, G: 2, Dm: 1 },
    C: { F: 3, Am: 2, G: 2, Em: 1, Dm: 1 },
  };
  const PENTA = [9, 0, 2, 4, 7]; // A minor pentatonic: the distant notes' home set

  // ---------------------------------------------------------------- timing and levels
  const TEMPO = 64, STEP = 60 / TEMPO / 2, BAR = STEP * 8; // eighth notes; a bar is 3.75 s
  const LOOKAHEAD = 0.35; // seconds of audio scheduled ahead of the audio clock
  const MAX_OSC = 40, MAX_OPTIONAL = 32; // pads may use the whole budget; shimmer and distant notes stop earlier
  // Per-layer levels and the master, set by measurement (offline renders against the effects): at the
  // default volume the music sits about 15 dB under a typical answer sound.
  const LEVEL = { pad: 0.16, bass: 0.13, pulse: 0.19, arp: 0.07, far: 0.07, air: 0.012 };
  const MASTER = 0.032; // owner: "too loud" after the first listen, so about 6 dB under the first mix
  const SCENE_DB = { play: 0, results: -1.5, menu: -3 };
  // How far each effect pushes the music down: [dB, hold s, release s].
  const DUCK = { tier: [6, 0.35, 1.2], streak: [6, 0.3, 1.4], miss: [5, 0.3, 1.0], reject: [3, 0.15, 0.5], submit: [2, 0.1, 0.4],
    tick: [1.5, 0.05, 0.25], chat: [3, 0.25, 0.6], quick: [3, 0.2, 0.6], fizzle: [4, 0.4, 1.0] };
  const TIER_DUCK = { baseline: 5, overfit: 5, indist: 6, outlier: 7, longtail: 8, mlion: 10 };
  const ECHO = { outlier: 2, longtail: 4, mlion: 0 }; // rare tiers: the landscape answers the bell's root, far away

  /** A long dark hall (decaying noise that loses its highs as it goes), for the music only. */
  function hallIR(ctx, secs, rng) {
    const sr = ctx.sampleRate, n = Math.round(sr * secs), pre = Math.round(sr * 0.025), buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const k = 0.5 * Math.exp(-2.4 * t / secs) + 0.035; // one-pole lowpass: bright early reflections, a dark tail
        lp += k * ((rng() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t / (secs / 6.2)) * Math.min(1, t / 0.06);
      }
    }
    return buf;
  }
  /** A few seconds of soft pink noise for the plateau's wind. */
  function pinkNoise(ctx, secs, rng) {
    const n = Math.round(ctx.sampleRate * secs), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    const fade = Math.round(ctx.sampleRate * 0.05); // the loop seam crossfades into itself
    for (let i = 0; i < fade; i++) { const a = i / fade; d[i] = d[i] * a + d[n - fade + i] * (1 - a); }
    return buf;
  }

  // =============================================================== the engine
  /** All the audio: one per AudioContext. `opts.room` is Sound's shared room; `opts.rng` a seeded random (tests). */
  function Engine(ctx, opts = {}) {
    const rng = opts.rng || Math.random;
    const R = (a, b) => a + (b - a) * rng();
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const F = (type, freq, q = 0.707) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
    const P = (pan) => { if (!ctx.createStereoPanner) return G(1); const p = ctx.createStereoPanner(); p.pan.value = pan; return p; };
    const wave = (amps) => { const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1); amps.forEach((a, i) => { im[i + 1] = a; }); return ctx.createPeriodicWave(re, im); };
    // Soft timbres: harmonics roll off steeply, odd ones lead in the cold waves (hollow, flute-like) and the
    // even ones fill in as it warms. Nothing here has a raw sawtooth's buzz.
    const WARM = [[2.9, 0.3], [2.4, 0.5], [2.0, 0.75], [1.7, 0.95]].map(([p, even]) => wave(Array.from({ length: 18 }, (_, i) => Math.pow(i + 1, -p) * ((i + 1) % 2 ? 1 : even))));
    const GLASS = wave([1, 0.06, 0.16, 0.02, 0.05, 0, 0.012]);
    const PLUCK = wave([1, 0.22, 0.09, 0.04, 0.02, 0.01]);
    const BASSW = wave([1, 0.32, 0.1, 0.04, 0.015]);
    const SCURVE = Float32Array.from({ length: 48 }, (_, i) => Math.pow(Math.sin((Math.PI / 2) * (i / 47)), 2));

    // ---- the bus: layers -> (dry + hall) -> thinning highpass -> darkening lowpass -> duck -> volume -> gate
    const dry = G(), wet = G(), hall = ctx.createConvolver(), hallRet = G(0.6);
    hall.buffer = hallIR(ctx, 2.6, rng);
    wet.connect(hall).connect(hallRet);
    const thin = F("highpass", 28, 0.6), tone = F("lowpass", 11000, 0.5), duckG = G(1), out = G(0), gate = G(0);
    dry.connect(thin); hallRet.connect(thin);
    thin.connect(tone).connect(duckG).connect(out).connect(gate);
    const roomSend = opts.room ? G(0.3) : null; // into the same room the effects ring in
    if (roomSend) roomSend.connect(opts.room);
    // The gate is connected only while the music plays. Unplugged, nothing upstream is pulled, so a stopped
    // engine (music off, the tab hidden) costs nothing; plugged in, the echo loop would keep the graph busy.
    const plug = (on) => { try { gate.disconnect(); } catch { /* not connected */ } if (on) { gate.connect(opts.dest || ctx.destination); if (roomSend) gate.connect(roomSend); } };
    function layer(key, wetAmt) { const g = G(0); g.connect(dry); const s = G(wetAmt); g.connect(s).connect(wet); return { key, g, w: 0, set: -1 }; }
    const L = { pad: layer("pad", 0.55), bass: layer("bass", 0.12), pulse: layer("pulse", 0.3), arp: layer("arp", 0.45), far: layer("far", 0.9), air: layer("air", 0.5) };
    // pad: the two detuned oscillators of every note go left and right, through one shared lowpass
    const padF = F("lowpass", 2400, 0.5), padL = P(-0.55), padR = P(0.55);
    const padEQ = F("peaking", 300, 0.9); padEQ.gain.value = -3.5; // a dip where close voicings turn to mud
    padL.connect(padEQ); padR.connect(padEQ); padEQ.connect(padF); padF.connect(L.pad.g);
    const bassF = F("lowpass", 260, 0.6), bassH = F("highpass", 38, 0.7);
    bassH.connect(bassF).connect(L.bass.g);
    const pulseF = F("lowpass", 820, 0.6); pulseF.connect(L.pulse.g);
    const arpL = P(-0.45), arpR = P(0.45), arpF = F("lowpass", 4200, 0.5);
    arpL.connect(arpF); arpR.connect(arpF); arpF.connect(L.arp.g);
    const farIn = G(); farIn.connect(L.far.g);
    // a dark ping-pong echo behind the shimmer and the distant notes
    const dIn = G(), dl = ctx.createDelay(2), dr = ctx.createDelay(2), dlp = F("lowpass", 2400, 0.5), drp = F("lowpass", 2000, 0.5), fb1 = G(0.34), fb2 = G(0.34), merge = ctx.createChannelMerger(2), dOut = G(0.55);
    dl.delayTime.value = STEP * 1.5; dr.delayTime.value = STEP * 1.5;
    dIn.connect(dl); dl.connect(dlp); dlp.connect(merge, 0, 0); dlp.connect(fb1).connect(dr);
    dr.connect(drp); drp.connect(merge, 0, 1); drp.connect(fb2).connect(dl);
    merge.connect(dOut); dOut.connect(dry); const dWet = G(0.4); dOut.connect(dWet).connect(wet);
    const arpSend = G(0.5); arpF.connect(arpSend).connect(dIn);
    const farSend = G(0.35); farIn.connect(farSend).connect(dIn);
    // the plateau's wind: pink noise through a wandering bandpass
    const airBuf = pinkNoise(ctx, 4, rng), airF = F("bandpass", 900, 0.8);
    airF.connect(L.air.g);
    let airSrc = null;

    // ---- state
    const st = {
      on: false, view: "menu", depth: 0.06, depthT: 0.06, tension: 0, tensT: 0, lastClock: -1, streak: 0, swell: 0,
      dark: 0, glow: 0, vol: 0.5, sceneDb: SCENE_DB.menu, sceneSince: 0, last: 0, lastCtl: -1,
      next: 0, idx: 0, chord: null, prev: null, chordEnd: 0, voicing: [], warm: 0, queue: [], pattern: null,
      arpPos: 0, far: [], duckUntil: 0, duckLevel: 1,
    };
    let live = []; // end times of running oscillators: the voice budget
    const sources = new Set();
    function budget(n, optional) {
      const t = ctx.currentTime;
      if (live.length > 8) live = live.filter((e) => e > t);
      return live.length + n <= (optional ? MAX_OPTIONAL : MAX_OSC);
    }
    function osc(type, freq, t, end) {
      const o = ctx.createOscillator();
      if (typeof type === "string") o.type = type; else o.setPeriodicWave(type);
      o.frequency.value = freq;
      // detune drifts slowly: once per 128-sample block is plenty, and spares Chrome's per-sample phase path
      try { o.detune.automationRate = "k-rate"; } catch { /* older engines: a-rate */ }
      o.start(t); o.stop(end);
      sources.add(o); o.onended = () => sources.delete(o);
      live.push(end);
      return o;
    }
    /** A slow swell: an S-curve up to `vel`, held, then an exponential release. */
    function swellEnv(g, t, atk, hold, rel, vel) {
      try { g.gain.automationRate = "k-rate"; } catch { /* a-rate */ } // seconds-long swells need no per-sample values
      g.gain.setValueCurveAtTime(SCURVE.map((v) => v * vel), t, atk);
      g.gain.setTargetAtTime(0, t + Math.max(atk + 0.02, hold), rel / 4);
    }
    /** A struck note: a few milliseconds up, then a long exponential fall. */
    function strikeEnv(g, t, atk, tau, vel) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + atk);
      g.gain.setTargetAtTime(0, t + atk, tau);
    }

    // ---- voices
    function padNote(midi, t, hold, vel, atk, rel, warm) {
      if (!budget(2, false)) return;
      const end = t + hold + rel * 1.25; // five time constants: about 43 dB under the note
      for (const side of [-1, 1]) {
        const o = osc(WARM[warm], mtof(midi), t, end), g = G(0);
        o.detune.setValueAtTime(side * R(3, 7), t); // two voices that drift apart and back: slow, living beats
        o.detune.linearRampToValueAtTime(side * R(1.5, 9), end);
        swellEnv(g, t, atk, hold, rel, vel);
        o.connect(g).connect(side < 0 ? padL : padR);
      }
    }
    function bassNote(midi, t, hold) {
      if (!budget(1, false)) return;
      const rel = 2.6, end = t + hold + rel * 1.25, o = osc(BASSW, mtof(midi), t, end), g = G(0);
      o.detune.setValueAtTime(R(-3, 3), t);
      swellEnv(g, t, 1.4, hold, rel, 0.9);
      o.connect(g).connect(bassH);
    }
    function pluck(dest, type, midi, t, vel, tau) {
      if (!budget(1, true)) return;
      const end = t + tau * 5.5, o = osc(type, mtof(midi), t, end), g = G(0);
      o.detune.value = R(-4, 4);
      strikeEnv(g, t, 0.006, tau, vel);
      o.connect(g).connect(dest);
    }
    /** A distant note: soft attack, a long tail, and an octave partial a hair sharp that fades first (a slow shimmer). */
    function farNote(midi, t, vel) {
      if (!budget(2, true)) return;
      const tau = R(0.8, 1.2), end = t + tau * 5.5, f = mtof(midi);
      const o = osc(GLASS, f, t, end), g = G(0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.07); g.gain.setTargetAtTime(0, t + 0.07, tau);
      o.connect(g).connect(farIn);
      const o2 = osc("sine", f * 2 + R(0.4, 0.9), t, t + tau * 3.5), g2 = G(0);
      g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(vel * 0.22, t + 0.05); g2.gain.setTargetAtTime(0, t + 0.05, tau * 0.45);
      o2.connect(g2).connect(farIn);
    }

    // ---- harmony
    function choose() {
      const target = st.view === "results" ? 0.9 : st.depth;
      if (!st.chord) return Object.keys(CHORDS).reduce((best, k) => (Math.abs(CHORDS[k].home - target) < Math.abs(CHORDS[best].home - target) ? k : best)); // start at home
      const cur = st.chord, from = NEXT[cur], A = acts(st.depth);
      const opts = [];
      let total = 0;
      for (const [name, w0] of Object.entries(from)) {
        const c = CHORDS[name];
        let w = w0 * (0.05 + Math.exp(-((c.home - target) ** 2) / (2 * 0.2 * 0.2)));
        const fall = (CHORDS[cur].root - c.root + 12) % 12; // semitones the bass steps down
        if (fall >= 1 && fall <= 4) w *= 1 + 2 * A.ravine; // the ravines: a bass line that keeps falling
        if (name === st.prev) w *= 0.5; // no A-B-A rocking
        opts.push([name, w]); total += w;
      }
      let r = rng() * total;
      for (const [name, w] of opts) if ((r -= w) <= 0) return name;
      return opts[opts.length - 1][0];
    }
    function barsFor() {
      if (st.view === "menu") return [4, 4, 5][Math.floor(rng() * 3)];
      if (st.view === "results") return [3, 4][Math.floor(rng() * 2)];
      const A = acts(st.depth);
      if (A.plateau > 0.6) return [3, 4, 4][Math.floor(rng() * 3)];
      return [2, 2, 3][Math.floor(rng() * 3)];
    }
    function nextChord(t) {
      let name, bars, cadence = false;
      if (st.queue.length) { [name, bars] = st.queue.shift(); cadence = true; } else { name = choose(); bars = barsFor(); }
      const ch = CHORDS[name], d = st.depth, A = acts(d);
      const level = clamp(d + R(-0.06, 0.06), 0, 1);
      let ints = ch.v[level < 0.3 ? 0 : level < 0.62 ? 1 : 2];
      if (ch.glow && level > 0.8 && rng() < 0.5) ints = ch.glow;
      const lo = Math.round(lerp(64, 47, d)); // high and thin up top, low and full at the bottom
      let root = lo + ((ch.root - lo) % 12 + 12) % 12;
      const voicing = ints.map((i) => root + i);
      st.prev = st.chord; st.chord = name; st.voicing = voicing;
      const dur = bars * BAR;
      st.chordEnd = t + dur;
      st.warm = clamp(Math.round(d * 3 + R(-0.45, 0.45)), 0, 3);
      st.pattern = PULSES[Math.floor(rng() * PULSES.length)];
      // pads: a slow strum, each voice a little later, the top ones softer
      const atk = cadence ? 1.6 : lerp(4.8, 2.6, d), rel = lerp(5.5, 4.0, d), n = voicing.length;
      const up = rng() < 0.6;
      voicing.forEach((m, k) => {
        const order = up ? k : n - 1 - k;
        const vel = (0.95 / Math.sqrt(n)) * (1 - 0.3 * (k / Math.max(1, n - 1))) * R(0.82, 1.05);
        padNote(m, t + order * R(0.09, 0.26), dur + 0.5 * atk - order * 0.15, vel, atk, rel, st.warm); // overlaps the next chord's swell: no gap
      });
      // bass: the root, low (A1 up to G#2), once the ravines begin
      if (A.ravine + A.basin > 0.04 || st.view === "results") bassNote(33 + ((ch.root - 33) % 12 + 12) % 12, t + R(0, 0.06), dur);
      // the wind wanders to a new colour each chord
      if (airSrc) airF.frequency.setTargetAtTime(R(650, 1500), t, dur / 3);
    }
    // the ravines' slow pulse: three bar shapes, chosen per chord (a 3-3-2, plain quarters, a sparse one)
    const PULSES = [[1, 0, 0, 0.6, 0, 0, 0.8, 0], [1, 0, 0.5, 0, 0.8, 0, 0.5, 0], [1, 0, 0, 0, 0.75, 0, 0, 0.45]];
    function pulseStep(t, k) {
      const a = st.pattern ? st.pattern[k] : 0;
      if (!a || rng() > (k === 0 ? 0.95 : 0.75)) return;
      const ch = CHORDS[st.chord], base = 45 + ((ch.root - 45) % 12 + 12) % 12; // A2..G#3
      const midi = k === 0 || rng() < 0.6 ? base : rng() < 0.5 ? base + 7 : base + 12;
      pluck(pulseF, PLUCK, midi, t + R(0, 0.018), a * R(0.75, 1), 0.2);
    }
    // the basin's shimmer: a random walk over the chord's tones up high, gated, so it never runs a figure
    function arpStep(t, i) {
      const k = i % 8, phrase = 0.75 + 0.25 * Math.sin((t / 23) * 2 * Math.PI); // a 23 s breath
      const dens = clamp(0.12 + 0.42 * L.arp.w + 0.03 * Math.max(0, st.streak - 2), 0, 0.75) * phrase;
      if (rng() > (k === 0 ? Math.min(1, dens * 1.6) : dens)) return;
      const pcs = [...new Set(st.voicing.map((m) => m % 12))];
      const pool = [];
      for (let m = 72; m <= 91; m++) if (pcs.includes(m % 12)) pool.push(m);
      if (!pool.length) return;
      st.arpPos = clamp(st.arpPos + [-2, -1, -1, 1, 1, 2][Math.floor(rng() * 6)], 0, pool.length - 1);
      const vel = (k % 4 === 0 ? 1 : 0.72) * R(0.6, 1);
      pluck(st.arpPos % 2 ? arpL : arpR, GLASS, pool[st.arpPos], t + R(0, 0.02), vel, R(0.38, 0.55));
    }
    // distant notes: three loops of lengths that never line up (7.7, 12.3, 18.1 s), each a fragment
    const FAR_LOOPS = [{ period: 7.7, p: 0.5, notes: 1 }, { period: 12.3, p: 0.45, notes: 2 }, { period: 18.1, p: 0.5, notes: 3 }];
    function farPitch(prefer) {
      const lo = Math.round(lerp(76, 70, st.depth)), hi = lo + 16;
      const chordPcs = st.voicing.map((m) => m % 12);
      const set = rng() < 0.7 && chordPcs.length ? chordPcs : PENTA;
      const pc = prefer != null ? prefer : set[Math.floor(rng() * set.length)];
      const opts = [];
      for (let m = lo; m <= hi; m++) if (m % 12 === pc) opts.push(m);
      return opts[Math.floor(rng() * opts.length)];
    }
    function farFire(t, loop) {
      const first = farPitch(), vel = R(0.55, 0.9);
      farNote(first, t, vel);
      if (loop.notes === 2) { const d = [-2, -3, -5][Math.floor(rng() * 3)], m = snap(first + d); farNote(m, t + R(0.6, 0.95), vel * 0.8); }
      if (loop.notes === 3) { let m = first; for (let j = 1; j < 3; j++) { m = snap(m + [2, 3, 5][Math.floor(rng() * 3)]); farNote(m, t + j * R(0.9, 1.2), vel * (1 - 0.15 * j)); } }
    }
    /** The nearest white key at or below `m`. */
    function snap(m) { while ([1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)) m--; return m; }

    // ---- control: smoothed state into the layer gains and the filters, ten times a second
    function setP(param, v, t, tau, last) {
      if (last != null && Math.abs(v - last) <= Math.abs(last) * 0.004 + 1e-5) return last;
      param.setTargetAtTime(v, t, tau);
      return v;
    }
    const ctl = {};
    function control(t) {
      const A = acts(st.depth), T = st.tension, calm = 1 - T;
      const results = st.view === "results";
      const w = {
        pad: lerp(0.85, 1, A.basin) * (1 + 0.3 * st.glow) * (1 - 0.3 * T) * (1 - 0.2 * st.dark),
        air: A.plateau * (1 - 0.6 * T) * (st.view === "menu" ? 0.8 : 1),
        far: (0.95 * A.plateau + 0.65 * A.ravine + 0.55 * A.basin) * (1 - 0.7 * T),
        bass: (results ? Math.max(0.6, A.ravine + 0.85 * A.basin) : 0.8 * A.ravine + 0.85 * A.basin) * calm,
        pulse: results ? 0 : A.ravine * calm,
        arp: clamp(A.basin + 0.04 * Math.max(0, st.streak - 2), 0, 1) * calm,
      };
      for (const k in L) { L[k].w = w[k]; L[k].set = setP(L[k].g.gain, LEVEL[k] * w[k], t, 0.9, L[k].set); }
      const padCut = (3000 * A.plateau + 1500 * A.ravine + 2500 * A.basin) * (1 + 0.06 * st.swell) * (1 + 0.3 * st.glow);
      ctl.pad = setP(padF.frequency, padCut, t, 0.8, ctl.pad);
      // low time closes the top down to 1.3 kHz; a miss dims it towards 1 kHz for a few seconds (the stage dims too)
      const cut = lerp(Math.log(11000), Math.log(1300), T);
      ctl.tone = setP(tone.frequency, Math.exp(lerp(cut, Math.log(1000), 0.75 * st.dark)), t, 0.25, ctl.tone);
      ctl.thin = setP(thin.frequency, 28 + 300 * Math.pow(T, 1.5), t, 0.25, ctl.thin);
      const volG = st.vol <= 0 ? 0 : Math.pow(st.vol / 0.5, 1.2);
      ctl.out = setP(out.gain, MASTER * volG * dbGain(st.sceneDb + 0.2 * st.swell), t, 0.7, ctl.out);
    }

    // ---- the clock: called with the audio time up to which everything should be scheduled
    function pump(now = ctx.currentTime) {
      const dt = clamp(now - (st.last || now), 0, 1);
      st.last = now;
      // smoothing: depth glides (the music warms over a few seconds after the ball lands)
      st.depth += (st.depthT - st.depth) * (1 - Math.exp(-dt / (st.view === "play" ? 2.5 : 4)));
      if (st.lastClock >= 0 && now - st.lastClock > 0.4) { st.tensT = 0; st.lastClock = -1; } // the clock went away
      st.tension += (st.tensT - st.tension) * (1 - Math.exp(-dt / (st.tensT > st.tension ? 0.5 : 0.9)));
      st.swell += (Math.min(7, st.streak) - st.swell) * (1 - Math.exp(-dt / 1.5));
      st.dark *= Math.exp(-dt / 2.5); st.glow *= Math.exp(-dt / 4);
      if (st.view === "results" && now - st.sceneSince > 24) st.sceneDb = SCENE_DB.menu; // the afterglow settles
      if (!st.on) return;
      if (now - st.lastCtl >= 0.1) { st.lastCtl = now; control(now); }
      const horizon = now + LOOKAHEAD;
      if (st.next < now - STEP) { st.next = now + 0.02; st.idx = 0; } // a late timer: pick the grid up again
      while (st.next < horizon) {
        const t = st.next, k = st.idx % 8;
        if (k === 0 && t >= st.chordEnd - 0.01) nextChord(t);
        if (st.chord && st.tension < 0.35) {
          if (L.pulse.w > 0.03) pulseStep(t, k);
          if (L.arp.w > 0.03) arpStep(t, st.idx);
        }
        st.idx++; st.next += STEP;
      }
      const farScale = st.view === "menu" ? 1.35 : 1;
      FAR_LOOPS.forEach((loop, i) => {
        if (st.far[i] == null || st.far[i] < now - 1) st.far[i] = now + R(1, loop.period);
        while (st.far[i] < horizon) {
          if (st.chord && st.tension < 0.5 && rng() < loop.p * Math.min(1, L.far.w + 0.2)) farFire(st.far[i], loop);
          st.far[i] += loop.period * farScale * R(0.92, 1.08);
        }
      });
    }

    // ---- public
    const api = {
      ctx,
      get on() { return st.on; },
      state: st,
      pump,
      /** Oscillators sounding or scheduled right now (the voice budget's count). */
      voices() { const t = ctx.currentTime; live = live.filter((e) => e > t); return live.length; },
      start() {
        if (st.on) return;
        const t = ctx.currentTime;
        st.on = true; st.depth = st.depthT; st.tension = 0; st.last = t; st.lastCtl = -1;
        st.next = t + 0.05; st.idx = 0; st.chord = null; st.chordEnd = 0; st.far = [];
        for (const k in L) L[k].set = -1;
        Object.keys(ctl).forEach((k) => { ctl[k] = null; });
        control(t);
        plug(true);
        gate.gain.cancelScheduledValues(t); gate.gain.setValueAtTime(0, t); gate.gain.setTargetAtTime(1, t, 1.0);
        airSrc = ctx.createBufferSource(); airSrc.buffer = airBuf; airSrc.loop = true;
        airSrc.connect(airF); airSrc.start(t, R(0, 3.5));
        pump(t);
      },
      /** Fade out; halt() later stops every voice. */
      stop(fast) {
        if (!st.on) return;
        st.on = false;
        const t = ctx.currentTime, p = gate.gain;
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
        p.setTargetAtTime(0, t, fast ? 0.06 : 0.25);
      },
      halt() {
        const t = ctx.currentTime;
        sources.forEach((o) => { try { o.stop(t); } catch { /* already stopped */ } });
        sources.clear(); live = [];
        if (airSrc) { try { airSrc.stop(t); } catch { /* ignore */ } airSrc = null; }
        plug(false);
      },
      volume(v) { st.vol = clamp(Number.isFinite(v) ? v : 0.5, 0, 1); if (st.on) control(ctx.currentTime); },
      view(name) {
        const v = name === "play" ? "play" : name === "results" ? "results" : "menu";
        if (v === st.view) return;
        st.view = v; st.sceneSince = ctx.currentTime; st.sceneDb = SCENE_DB[v];
        if (v !== "play") { st.streak = 0; st.tensT = 0; st.lastClock = -1; }
        if (v === "menu") st.depthT = 0.06;
        if (v !== "results") st.queue = [];
        if (v === "results") {
          st.depthT = Math.max(0.3, st.depthT);
          // the cadence: the next bar line moves to F (or straight on from F or G) and lands on C
          st.queue = st.chord === "F" || st.chord === "G" ? [["C", 5]] : [["F", 1], ["C", 5]];
          st.chordEnd = Math.min(st.chordEnd, ctx.currentTime + 0.2);
        }
      },
      depth(d) { if (Number.isFinite(d)) st.depthT = clamp(d, 0, 1); },
      resolve(d) { if (Number.isFinite(d)) st.depthT = clamp(d, 0.3, 1); },
      clock(ms) {
        if (!Number.isFinite(ms)) { st.tensT = 0; st.lastClock = -1; return; }
        st.lastClock = ctx.currentTime;
        st.tensT = smooth(6000, 500, ms); // nothing above six seconds left, all of it at the last half second
      },
      duck(kind, arg) {
        if (kind === "streak") st.streak = Math.max(0, Math.floor(+arg) || 0);
        if (kind === "miss" || kind === "fizzle") st.streak = 0;
        if (kind === "miss") st.dark = 1;
        if (kind === "tier" && st.streak < 1) st.streak = 1;
        if (!st.on) return;
        let [db, hold, rel] = DUCK[kind] || [3, 0.2, 0.6];
        if (kind === "tier") { db = TIER_DUCK[arg] || 6; if (arg === "mlion") { hold = 1.4; rel = 2.6; } }
        const t = ctx.currentTime, level = dbGain(-db);
        const holding = st.duckUntil > t;
        const lvl = holding ? Math.min(level, st.duckLevel) : level;
        const until = Math.max(t + hold, holding ? st.duckUntil : 0);
        const p = duckG.gain;
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
        p.setTargetAtTime(lvl, t, 0.015);
        p.setTargetAtTime(1, until, rel / 3);
        st.duckUntil = until; st.duckLevel = lvl;
        if (kind === "tier" && ECHO[arg] != null && st.chord) farNote(farPitch(ECHO[arg]), t + R(1.5, 1.9), 0.55);
        if (kind === "tier" && arg === "mlion") { // the global minimum: glow, and the next bar lands on C
          st.glow = 1;
          if (st.chord !== "C" && !st.queue.length) { st.queue = [["C", 3]]; st.chordEnd = Math.min(st.chordEnd, t + 0.2); }
        }
      },
    };
    return api;
  }

  // =============================================================== the controller app.js holds
  function init(o) {
    const graph = o.graph, unlock = o.unlock || (() => {}), settings = o.settings || (() => ({}));
    const manual = !!o.manual; // offline renders drive the clock themselves
    let eng = null, timer = 0, haltTimer = 0;
    const memo = { view: "menu", depth: null };
    const vol = () => { const v = (settings() || {}).musicVol; return Number.isFinite(v) ? clamp(v, 0, 1) : 0.5; };
    const hidden = () => !manual && typeof document !== "undefined" && document.visibilityState === "hidden";
    // only during a run and on its results: menus and the home page stay silent (owner's call)
    const wanted = () => { const s = settings() || {}; return memo.view !== "menu" && !!s.sound && s.music !== false && vol() > 0 && !hidden(); };
    function engine() {
      if (eng) return eng;
      const g = graph();
      if (!g || !g.ctx) return null;
      eng = Engine(g.ctx, { room: g.room, rng: o.rng, dest: o.dest });
      eng.view(memo.view);
      if (memo.depth != null) { if (memo.view === "results") eng.resolve(memo.depth); else eng.depth(memo.depth); }
      if (!manual && g.ctx.addEventListener) g.ctx.addEventListener("statechange", () => sync(false));
      return eng;
    }
    function halt() { clearTimeout(haltTimer); haltTimer = 0; if (eng && !eng.on) eng.halt(); }
    function sync(gesture) {
      if (!wanted()) {
        if (eng && eng.on) {
          eng.stop(hidden());
          clearInterval(timer); timer = 0;
          if (manual) eng.halt(); else haltTimer = setTimeout(halt, 1500);
        }
        return;
      }
      if (!eng && gesture) unlock();
      const e = engine();
      if (!e) return;
      e.volume(vol());
      if (!manual && e.ctx.state !== "running") { if (gesture) e.ctx.resume().catch(() => {}); return; }
      if (e.on) return;
      if (haltTimer) halt(); else e.halt();
      e.start();
      if (!manual) timer = setInterval(() => { try { e.pump(); } catch { /* never break the game */ } }, 50);
    }
    if (!manual && typeof document !== "undefined") {
      const onGesture = () => { if (!(eng && eng.on) && wanted()) sync(true); };
      ["pointerup", "keydown", "touchend", "click"].forEach((ev) => document.addEventListener(ev, onGesture, true));
      document.addEventListener("visibilitychange", () => sync(false));
      window.addEventListener("pagehide", () => { if (eng && eng.on) { eng.stop(true); clearInterval(timer); timer = 0; } });
      window.addEventListener("pageshow", () => sync(false));
    }
    const safe = (f) => (...a) => { try { return f(...a); } catch { return undefined; } };
    const api = {
      view: safe((name) => { memo.view = name; if (eng) eng.view(name); sync(false); }),
      depth: safe((d) => { memo.depth = d; if (eng) eng.depth(d); }),
      resolve: safe((d) => { memo.depth = d; if (eng) eng.resolve(d); }),
      clock: safe((ms) => { if (eng && eng.on) eng.clock(ms); }),
      duck: safe((kind, arg) => { if (eng) eng.duck(kind, arg); }),
      sync: safe(() => sync(!!(typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.isActive))),
      get engine() { return eng; },
      pump: manual ? safe(() => { if (eng) eng.pump(); }) : undefined,
      start: manual ? safe(() => sync(true)) : undefined,
    };
    window.MLION_MUSIC.current = api; // the page's one controller, for tests and the console
    return api;
  }

  window.MLION_MUSIC = { init, Engine, CHORDS, LEVEL, acts };
})();
