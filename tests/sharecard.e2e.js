#!/usr/bin/env node
/* The share card (js/sharecard.js) end to end, with the system share sheet and the clipboard mocked:
 *   desktop  results -> Share opens the sheet, the preview is a real 1200x630 PNG under 300 KB,
 *            Copy image writes an image/png ClipboardItem, Copy text keeps the text grid, Story
 *            redraws at 1080x1920 and is remembered, Save image downloads mlion-12-story.png;
 *            a challenge result gets its own card (no text grid), the Daily Quiz gets the quiz card.
 *   phone    Share image hands navigator.share a File (image/png, real PNG); Share text shares the
 *            grid; a refused share falls back to a download, a cancelled one does nothing.
 *   link     the link-preview tags (og:*, twitter:card, theme-color) and img/og.png agree; the page
 *            itself turns theme-color back to the dark room; a #fragment never reaches the server.
 *   node tests/sharecard.e2e.js           (Google Fonts blocked; the card falls back to the system sans)
 *   node tests/sharecard.e2e.js --fonts   (loads Archivo from Google Fonts)
 * Screenshots land in tests/out/. */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const withFonts = process.argv.includes("--fonts");
const E = require("../js/engine.js");
global.window = {};
require(path.join(ROOT, "js", "data.js")); require(path.join(ROOT, "js", "explain.js"));
const DATA = global.window.MLION_DATA;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const requested = [];
const server = http.createServer((req, res) => {
  requested.push(req.url);
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const check = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };
const KB300 = 300 * 1024;

// ---- finished runs, built from the real prompts and quiz bank (the shapes app.js saves)
const PROMPT = new Map(DATA.prompts.map((p) => [p.id, p]));
const RQ = new Map((DATA.reasoning || []).map((r) => [r.id, r]));
function rarityRec(key, mode, ids, tiers, extra) {
  const results = ids.map((pid, i) => {
    const p = PROMPT.get(pid), t = tiers[i];
    const a = t !== "miss" ? p.answers.find((x) => x.t === t) : null;
    return { promptId: pid, promptText: p.text, raw: a ? a.a : "zzz", answer: a ? a.a : null, tier: a ? t : null, score: a ? E.TIERS[t].score : 0 };
  });
  return { key, mode, promptIds: ids, results, score: results.reduce((s, r) => s + r.score, 0), tiers: results.map((r) => r.tier || "miss"), secs: 25, completedAt: Date.now(), ...extra };
}
const ids7 = DATA.daily.pool.slice(0, 7);
const daily = rarityRec("daily:2026-11-01", "daily", ids7, ["overfit", "mlion", "baseline", "outlier", "longtail", "miss", "indist"], { number: 12, date: "2026-11-01", label: "MLion #12" });
const vs = rarityRec("vs:abc123", "vs", ids7.slice(0, 5), ["outlier", "indist", "longtail", "baseline", "miss"],
  { number: 0, seed: "abc123", n: 5, name: "Ana", opp: { name: "Benedict the Great", tiers: ["baseline", "baseline", "indist", "miss", "overfit"] }, label: "Vs Benedict the Great" });
const bank = DATA.reasoning.filter((r) => !r.retired);
const qIds = [["easy", 0], ["easy", 1], ["medium", 0], ["medium", 1], ["hard", 0], ["hard", 1], ["hard", 2]].map(([l, k]) => bank.filter((r) => r.lvl === l)[k].id);
const oks = [1, 1, 1, 0, 1, 1, 0], ms = [2100, 4300, 8800, 25000, 6100, 12400, 20000];
const qResults = qIds.map((id, i) => {
  const q = RQ.get(id), wrong = (q.answer + 1) % 4;
  return { promptId: id, promptText: q.q, raw: q.options[oks[i] ? q.answer : wrong], answer: oks[i] ? q.options[q.answer] : null, tier: oks[i] ? "indist" : null,
    score: oks[i] ? E.quizPoints(Math.round(ms[i] / 100)) : 0, picked: oks[i] ? q.answer : wrong, correct: q.answer, ms: ms[i] };
});
const dquiz = { key: "dquiz:2026-11-01", mode: "dquiz", fmt: "quiz", number: 3, date: "2026-11-01", label: "Daily Quiz #3", promptIds: qIds, results: qResults,
  score: qResults.reduce((s, r) => s + r.score, 0), tiers: qResults.map((r) => r.tier || "miss"), secs: 25, completedAt: Date.now(),
  quiz: qIds.map((id) => ({ promptId: id, options: RQ.get(id).options, correct: RQ.get(id).answer })), picks: qResults.map((r) => r.picked + 1), tenths: Math.round(ms.reduce((a, b) => a + b, 0) / 100) };
const RECORDS = { [daily.key]: daily, [vs.key]: vs, [dquiz.key]: dquiz };

/** In-page: the first bytes of a PNG blob (signature, width, height) and its size. */
function pageHelpers(records) {
  window.__png = async (blob) => {
    const b = new Uint8Array(await blob.slice(0, 24).arrayBuffer()), dv = new DataView(b.buffer);
    return { png: b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, w: dv.getUint32(16), h: dv.getUint32(20), size: blob.size, type: blob.type };
  };
  try { localStorage.setItem("mlion:seenHow", "true"); localStorage.setItem("mlion:records", JSON.stringify(records)); } catch { /* */ }
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(tag, opts, mocks) {
    const ctx = await browser.newContext({ deviceScaleFactor: 1, acceptDownloads: true, ...opts });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(`${tag}: ${m.text()}`); });
    if (!withFonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.addInitScript(pageHelpers, RECORDS);
    await page.addInitScript(mocks);
    return { ctx, page };
  }
  const toast = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#toast").textContent), re.source, { timeout: 4000 });
  /** Wait for the sheet's preview to finish drawing; return what the <img> carries. */
  async function preview(page, h) {
    await page.waitForFunction((hh) => {
      const i = document.querySelector("#card-img"), box = document.querySelector("#card-preview");
      return i && box && !box.classList.contains("busy") && +i.dataset.h === hh && i.complete && i.naturalWidth > 0;
    }, h, { timeout: 15000 });
    return page.$eval("#card-img", (i) => ({ w: +i.dataset.w, h: +i.dataset.h, bytes: +i.dataset.bytes, nw: i.naturalWidth, nh: i.naturalHeight, alt: i.alt }));
  }
  /** Screenshot once the modal has finished its entrance and the buttons their transitions. */
  async function shot(page, opts) {
    await page.evaluate(() => Promise.all(document.querySelector(".modal").getAnimations({ subtree: true }).map((a) => a.finished)));
    await page.screenshot(opts);
  }
  const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  try {
    // ---------------------------------------------------------------- link preview
    console.log("link preview");
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const meta = (k) => { const m = html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)"`)); return m ? m[1] : null; };
    const site = meta("og:url");
    check(/^https:\/\/[^/]+\/(.*\/)?$/.test(site), `og:url is the site's absolute address (${site})`);
    const og = fs.readFileSync(path.join(ROOT, "img", "og.png"));
    const ogHash = E.hashString(og.toString("base64")).toString(36);
    check(meta("og:image") === `${site}img/og.png?v=${ogHash}` && meta("twitter:image") === meta("og:image"), "og:image and twitter:image point at img/og.png under og:url, stamped with its hash");
    check(og.readUInt32BE(16) === +meta("og:image:width") && og.readUInt32BE(20) === +meta("og:image:height") && +meta("og:image:width") === 1200 && +meta("og:image:height") === 630, "og.png is 1200x630, as its tags say");
    check(og.length < KB300, `og.png is under 300 KB (${(og.length / 1024).toFixed(0)} KB)`);
    const words = (t) => t.trim().split(/\s+/).length;
    check(words(meta("og:title")) < 10 && words(meta("og:description")) < 10, `title and description stay under 10 words ("${meta("og:title")}" / "${meta("og:description")}")`);
    check(meta("og:type") === "website" && meta("og:site_name") === "MLion" && meta("twitter:card") === "summary_large_image" && !!meta("og:image:alt"), "og:type, og:site_name, twitter:card and the image's alt text are set");
    check(meta("theme-color") === "#f2b53c", "chat embeds read a gold theme-color (Discord's side bar)");

    // ---------------------------------------------------------------- desktop
    console.log("desktop");
    const { ctx: dctx, page } = await open("desktop", { viewport: { width: 1280, height: 860 } }, () => {
      window.__wrote = [];
      Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: async (items) => {
        for (const it of items) window.__wrote.push({ types: [...it.types], ...(await window.__png(await it.getType("image/png"))) });
      } });
    });
    requested.length = 0;
    await page.goto(base + "#results-daily-2026-11-01");
    await page.waitForSelector("#share", { timeout: 10000 });
    check(requested[0] === "/" && !requested.some((u) => u.includes("#") || u.includes("results")), "a link's #fragment never reaches the server, so every MLion link gets the same preview");
    check(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content) === "#0b0a08", "the page itself keeps the dark theme-color");
    check((await page.textContent("#share")).trim() === "Share", "the daily result keeps its Share button");
    await page.click("#share");
    await page.waitForSelector(".sc-sheet", { timeout: 4000 });
    let img = await preview(page, 630);
    check(img.w === 1200 && img.h === 630 && img.nw === 1200 && img.nh === 630, `the preview is the wide card at full size (${img.nw}x${img.nh})`);
    check(img.bytes > 20 * 1024 && img.bytes < KB300, `the wide PNG is under 300 KB (${(img.bytes / 1024).toFixed(0)} KB)`);
    check(/^MLion #12: \d+ of 700, loss \d\.\d\d\./.test(img.alt) && /Rarest answer: .+ \(One in a MLion\)/.test(img.alt), `the preview has alt text (${img.alt})`);
    check(!(await page.$("#card-share")) && !!(await page.$("#card-copy:not([disabled])")), "desktop offers Copy image, not the phone share sheet");
    check((await page.textContent("#card-text")).trim() === "Copy text" && !!(await page.$("#card-save")), "Copy text and Save image are there too");
    await shot(page, { path: path.join(OUT, "60-share-sheet-desktop.png") });

    await page.click("#card-copy");
    await toast(page, /Image copied/);
    const w = await page.evaluate(() => window.__wrote);
    check(w.length === 1 && w[0].types.join() === "image/png" && w[0].png && w[0].w === 1200 && w[0].h === 630, "Copy image writes one image/png ClipboardItem with the card");

    await page.click("#card-text");
    await toast(page, /Text copied/);
    const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    check(clip.startsWith(`MLion #12 🦁\n${daily.score}/700 · loss ${((700 - daily.score) / 100).toFixed(2)}\n\n`), "Copy text keeps the text grid");

    await page.click('.sc-sheet [data-fmt="story"]');
    img = await preview(page, 1920);
    check(img.w === 1080 && img.nh === 1920, "Story redraws at 1080x1920");
    check(img.bytes < KB300, `the story PNG is under 300 KB (${(img.bytes / 1024).toFixed(0)} KB)`);
    check(await page.evaluate(() => localStorage.getItem("mlion:cardFormat")) === "story", "the chosen shape is remembered");
    await shot(page, { path: path.join(OUT, "61-share-sheet-desktop-story.png") });
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }), page.click("#card-save")]);
    const dlSize = fs.statSync(await dl.path()).size;
    check(dl.suggestedFilename() === "mlion-12-story.png" && dlSize === img.bytes, `Save image downloads ${dl.suggestedFilename()} (${(dlSize / 1024).toFixed(0)} KB)`);
    await page.click("#mclose");
    check(await page.evaluate(() => !document.querySelector("#modal").innerHTML), "the sheet closes");
    await page.click("#share");
    await preview(page, 1920);
    check(await page.$eval('.sc-sheet [data-fmt="story"]', (b) => b.classList.contains("on")), "the sheet reopens on Story");
    await page.click('.sc-sheet [data-fmt="card"]');
    await preview(page, 630);
    await page.click("#mclose");

    // a challenge: the card names the friend; the link stays on Send result back
    await page.goto(base + "#results-vs-abc123");
    await page.waitForSelector("#send-vs", { timeout: 10000 });
    check((await page.textContent("#share")).trim() === "Share image", "a challenge result gets a Share image button beside Send result back");
    await page.click("#share");
    img = await preview(page, 630);
    check(/^MLion Challenge: \d+ of 500/.test(img.alt) && /I win by \d+/.test(img.alt), `the challenge card says who won (${img.alt})`);
    check(!(await page.$("#card-text")), "no text grid on a challenge (its link is Send result back)");
    await shot(page, { path: path.join(OUT, "62-share-sheet-vs.png") });
    await page.click("#mclose");

    // the Daily Quiz: right/wrong marks, speed points, the hardest question right
    await page.goto(base + "#results-dquiz-2026-11-01");
    await page.waitForSelector("#share", { timeout: 10000 });
    await page.click("#share");
    img = await preview(page, 630);
    check(new RegExp(`^MLion Daily Quiz #3: ${dquiz.score} of 700, loss ${((700 - dquiz.score) / 100).toFixed(2)}\\. 5 of 7 right\\. Hardest question right: `).test(img.alt), `the Daily Quiz card (${img.alt.slice(0, 80)}…)`);
    await page.click("#card-text");
    await toast(page, /Text copied/);
    check((await page.evaluate(() => navigator.clipboard.readText())).startsWith("MLion Daily Quiz #3"), "the Daily Quiz text grid is still one tap away");
    await dctx.close();

    // ---------------------------------------------------------------- phone
    console.log("phone");
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const { ctx: pctx, page: ph } = await open("phone", { viewport: { width: 390, height: 844 }, userAgent: iphone, isMobile: true, hasTouch: true }, () => {
      window.__shared = []; window.__shareFail = null;
      Object.defineProperty(navigator, "canShare", { configurable: true, value: (d) => !!d && (Array.isArray(d.files) ? d.files.every((f) => f instanceof File && f.type === "image/png") : typeof d.text === "string") });
      Object.defineProperty(navigator, "share", { configurable: true, value: async (d) => {
        if (window.__shareFail) throw new DOMException("refused", window.__shareFail);
        window.__shared.push({ text: d.text || null, files: d.files ? await Promise.all(d.files.map(async (f) => ({ name: f.name, ...(await window.__png(f)) }))) : null });
      } });
    });
    await ph.goto(base + "#results-daily-2026-11-01");
    await ph.waitForSelector("#share", { timeout: 10000 });
    await ph.tap("#share");
    img = await preview(ph, 630);
    check(!!(await ph.$("#card-share:not([disabled])")) && !(await ph.$("#card-copy")), "a phone offers Share image (the system share sheet)");
    check((await ph.textContent("#card-text")).trim() === "Share text", "and Share text");
    check(await noSideScroll(ph), "the sheet fits the phone without side scroll");
    const box = await ph.$eval(".modal", (m) => m.getBoundingClientRect().width);
    check(box <= 390, `the sheet is phone-wide (${box}px)`);
    await shot(ph, { path: path.join(OUT, "63-share-sheet-phone.png") });

    await ph.tap("#card-share");
    await ph.waitForFunction(() => window.__shared.length === 1, null, { timeout: 4000 });
    let s = (await ph.evaluate(() => window.__shared))[0];
    check(s.files && s.files.length === 1 && !s.text, "Share image passes exactly one file and no text");
    const f = s.files[0];
    check(f.name === "mlion-12.png" && f.type === "image/png" && f.png && f.w === 1200 && f.h === 630 && f.size < KB300, `the file is the card as a PNG (${f.name}, ${(f.size / 1024).toFixed(0)} KB)`);

    await ph.tap("#card-text");
    await ph.waitForFunction(() => window.__shared.length === 2, null, { timeout: 4000 });
    s = (await ph.evaluate(() => window.__shared))[1];
    check(!s.files && s.text.startsWith("MLion #12 🦁\n"), "Share text shares the text grid");

    await ph.tap('.sc-sheet [data-fmt="story"]');
    img = await preview(ph, 1920);
    await shot(ph, { path: path.join(OUT, "64-share-sheet-phone-story.png") });
    check(await noSideScroll(ph), "the story preview fits the phone too");
    await ph.evaluate(() => { window.__shareFail = "NotAllowedError"; });
    const [pdl] = await Promise.all([ph.waitForEvent("download", { timeout: 4000 }), ph.tap("#card-share")]);
    check(pdl.suggestedFilename() === "mlion-12-story.png", "a refused share falls back to saving the image");
    await ph.evaluate(() => { window.__shareFail = "AbortError"; });
    const none = await Promise.all([ph.waitForEvent("download", { timeout: 1200 }).catch(() => null), ph.tap("#card-share")]);
    check(none[0] === null, "a cancelled share does nothing");
    await pctx.close();

    check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    console.log("\nshare card e2e passed");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
