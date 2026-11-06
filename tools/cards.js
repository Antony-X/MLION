#!/usr/bin/env node
/* Render sample share cards (js/sharecard.js) from the real data, for design review.
 *
 *   node tools/cards.js [outDir] [only=name,name] [thumbs]
 *
 * Writes <name>-card.png and <name>-story.png for every sample run (default outDir:
 * tests/out/cards), prints each file's size, and with `thumbs` also screenshots each card at
 * chat sizes (550 px and 330 px wide on a Discord-grey page). Needs Playwright (chromium) and
 * a network connection for the Geologica font. */
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SITE = (fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(/<meta property="og:url" content="([^"]+)"/) || [])[1] || "";
const args = process.argv.slice(2);
const OUT = path.resolve(args.find((a) => !a.includes("=") && a !== "thumbs") || path.join(ROOT, "tests", "out", "cards"));
const only = (args.find((a) => a.startsWith("only=")) || "").slice(5).split(",").filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geologica:wght,SHRP@300..800,0..100&display=swap" rel="stylesheet">
<style>body{margin:0;background:#222;font-family:Geologica}</style></head><body>
<script src="js/engine.js"></script><script src="js/data.js"></script><script src="js/explain.js"></script><script src="js/landscape.js"></script><script src="js/sharecard.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(HARNESS); }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": url.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

/** Sample runs, built in the page from the real prompts and quiz bank. */
function samples(only) {
  const E = window.MLION_ENGINE, D = window.MLION_DATA, T = E.TIERS;
  const P = new Map(D.prompts.map((p) => [p.id, p]));
  const RQ = new Map(D.reasoning.map((r) => [r.id, r]));
  const pool = D.daily.pool;
  const pick = (pid, t) => P.get(pid).answers.find((x) => x.t === t);
  function rarity(mode, ids, tiers, extra = {}) {
    const results = ids.map((pid, i) => {
      const t = tiers[i], p = P.get(pid);
      const a = t && t !== "miss" ? (extra.answers && extra.answers[i] ? { a: extra.answers[i], t } : pick(pid, t)) : null;
      return { promptId: pid, promptText: p.text, raw: a ? a.a : "zzz", answer: a ? a.a : null, tier: a ? t : null, score: a ? T[t].score : 0 };
    });
    const score = results.reduce((s, r) => s + r.score, 0);
    return Object.assign({ key: `${mode}:x`, mode, number: 12, date: "2026-11-05", label: "MLion #12", promptIds: ids, results, score, tiers: results.map((r) => r.tier || "miss"), secs: 25 }, extra.rec || {});
  }
  function quiz(mode, ids, oks, msArr, extra = {}) {
    const results = ids.map((id, i) => {
      const q = RQ.get(id), ok = oks[i], ms = msArr[i];
      const score = ok ? (mode === "dquiz" ? E.quizPoints(Math.round(ms / 100)) : 100) : 0;
      return { promptId: id, promptText: q.q, raw: q.options[ok ? q.answer : (q.answer + 1) % 4], answer: ok ? q.options[q.answer] : null, tier: ok ? "indist" : null, score, picked: ok ? q.answer : (q.answer + 1) % 4, correct: q.answer, ms };
    });
    const score = results.reduce((s, r) => s + r.score, 0);
    const qs = ids.map((id) => { const q = RQ.get(id); return { promptId: id, options: q.options, correct: q.answer }; });
    return Object.assign({ key: `${mode}:x`, mode, number: 3, date: "2026-11-05", label: "x", promptIds: ids, results, score, tiers: results.map((r) => r.tier || "miss"), secs: 25, fmt: "quiz", quiz: qs, picks: results.map((r) => r.picked + 1), tenths: Math.round(msArr.reduce((a, b) => a + b, 0) / 100) }, extra.rec || {});
  }
  const bank = D.reasoning.filter((r) => !r.retired);
  const lv = (l) => bank.filter((r) => r.lvl === l).map((r) => r.id);
  const longest = (l) => bank.filter((r) => r.lvl === l).sort((a, b) => b.q.length - a.q.length)[0].id;
  const qIds = [lv("easy")[0], lv("easy")[1], lv("medium")[0], lv("medium")[1], lv("hard")[0], longest("hard"), lv("hard")[2]];
  const ids7 = pool.slice(0, 7);
  const S = {
    "typical-300": rarity("daily", ids7, ["overfit", "mlion", "baseline", "outlier", "longtail", "miss", "indist"]),
    "strong-505": rarity("daily", ids7, ["longtail", "outlier", "longtail", "mlion", "outlier", "indist", "longtail"]),
    "baseline-70": rarity("daily", ids7, Array(7).fill("baseline")),
    "all-miss": rarity("daily", ids7, Array(7).fill("miss")),
    "perfect-700": rarity("daily", ids7, Array(7).fill("mlion")),
    "long-answer": rarity("daily", ["ml-paper", ...ids7.slice(1)], ["longtail", "indist", "baseline", "outlier", "miss", "indist", "overfit"], { answers: ["BLIP: Bootstrapping Language-Image Pre-training for Unified Vision-Language Understanding and Generation"] }),
    "long-prompt": rarity("daily", ["divergence", ...ids7.slice(1)], ["outlier", "indist", "baseline", "indist", "overfit", "miss", "baseline"]),
    "dquiz": quiz("dquiz", qIds, [1, 1, 1, 0, 1, 1, 0], [2100, 4300, 8800, 35000, 6100, 12400, 20000]),
    "quiz-allwrong": quiz("quiz", qIds, [0, 0, 0, 0, 0, 0, 0], Array(7).fill(5000), { rec: { number: 7 } }),
    "vs-win": rarity("vs", ids7.slice(0, 5), ["outlier", "indist", "longtail", "baseline", "miss"], { rec: { name: "Ana", opp: { name: "Benedict the Great", tiers: ["baseline", "baseline", "indist", "miss", "overfit"] }, n: 5 } }),
    "vs-lose": rarity("vs", ids7.slice(0, 3), ["baseline", "miss", "baseline"], { rec: { name: "Ana", opp: { name: "Ben", tiers: ["mlion", "outlier", "longtail"] }, n: 3 } }),
    "vq-win": quiz("vq", qIds.slice(0, 5), [1, 1, 0, 1, 1], [3000, 4000, 9000, 7000, 8000], { rec: { name: "Ana", opp: { name: "Ben", picks: [], tenths: 400 }, n: 5 } }),
    "unlimited-23": rarity("unlimited", pool.slice(0, 23), ["indist", "baseline", "outlier", "miss", "overfit", "indist", "longtail", "baseline", "baseline", "indist", "miss", "outlier", "indist", "baseline", "overfit", "indist", "outlier", "baseline", "indist", "miss", "longtail", "indist", "baseline"], { rec: { number: 4 } }),
    "archive": rarity("archive", ids7, ["indist", "indist", "outlier", "baseline", "overfit", "indist", "outlier"], { rec: { number: 9, date: "2026-11-02" } }),
  };
  S["vq-win"].opp.picks = S["vq-win"].quiz.map((q, i) => (i < 2 ? q.correct + 1 : ((q.correct + 1) % 4) + 1));
  return Object.entries(S).filter(([k]) => !only.length || only.includes(k));
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => window.MLION_CARD && window.MLION_DATA);
    const out = await page.evaluate(async ({ src, only, site }) => {
      const list = new Function(`return (${src})`)()(only);
      const res = {};
      for (const [name, rec] of list) {
        const spec = window.MLION_CARD.specFor(rec, { url: site });
        for (const fmt of ["card", "story"]) {
          const t0 = performance.now();
          const { canvas, blob } = await window.MLION_CARD.render(spec, fmt);
          const ms = Math.round(performance.now() - t0);
          const u8 = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          res[`${name}-${fmt}`] = { b64: btoa(bin), size: blob.size, ms, w: canvas.width, h: canvas.height };
        }
      }
      return res;
    }, { src: samples.toString(), only, site: SITE });
    for (const [k, v] of Object.entries(out)) {
      fs.writeFileSync(path.join(OUT, `${k}.png`), Buffer.from(v.b64, "base64"));
      console.log(`${k.padEnd(24)} ${v.w}x${v.h}  ${(v.size / 1024).toFixed(0).padStart(4)} KB  ${v.ms} ms`);
    }
    console.log("Geologica loaded:", await page.evaluate(() => document.fonts.check('300 40px "Geologica"')));
    if (args.includes("thumbs")) {
      await page.setViewportSize({ width: 582, height: 512 });
      for (const k of Object.keys(out).filter((x) => x.endsWith("-card"))) {
        const src = `data:image/png;base64,${out[k].b64}`;
        await page.setContent(`<body style="margin:0;background:#313338;padding:16px"><img src="${src}" style="width:550px;display:block"><img src="${src}" style="width:330px;display:block;margin-top:16px"></body>`);
        await page.screenshot({ path: path.join(OUT, `thumb-${k}.png`) });
      }
    }
    if (errors.length) { console.error("page errors:", errors.join(" | ")); process.exitCode = 1; }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
