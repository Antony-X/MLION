#!/usr/bin/env node
/* Render the site icons from the lion mark (MARK in js/landscape.js), and the link-preview image.
 *
 *   node tools/icons.js            writes img/favicon.svg, img/icon-192.png, img/icon-512.png,
 *                                  img/apple-touch-icon.png and img/og.png
 *   node tools/icons.js og         only img/og.png (then run tools/build.js: it stamps og.png's hash
 *                                  into the og:image URL, so chat apps fetch the new one)
 *   node tools/icons.js og mock [--out=dir]
 *                                  also screenshots the image inside mock Discord embeds (desktop and
 *                                  phone widths, the real title/description/theme-color from index.html)
 *                                  and its square crop; with --out, og.png goes there instead of img/
 *
 * The preview image is drawn on a canvas with the share card's own pieces (js/sharecard.js `kit`:
 * the descent, tier glyphs, lockup), so it speaks the same visual language as a shared result.
 * Needs Playwright (chromium) and a network connection for the Archivo font. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const IMG = path.join(ROOT, "img");
const LANDSCAPE = path.join(ROOT, "js", "landscape.js");
const COL = { bg: "#0b0a08", gold: "#f2b53c", goldDeep: "#b5770a", ink: "#f2ede4", muted: "#a39b90" };
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,300..600&display=swap";
const args = process.argv.slice(2);
const onlyOg = args.includes("og");
const mock = args.includes("mock");
const outArg = (args.find((a) => a.startsWith("--out=")) || "").slice(6);
const OG_DIR = outArg ? path.resolve(outArg) : IMG;
const MOCK_DIR = outArg ? path.resolve(outArg) : path.join(ROOT, "tests", "out", "og");

// landscape.js is a browser script; run it with just enough of a window to read MARK.
function loadMark() {
  const sandbox = { window: {}, document: { documentElement: { classList: { contains: () => false } } } };
  vm.runInNewContext(fs.readFileSync(LANDSCAPE, "utf8"), sandbox);
  return sandbox.window.MLION_VISUALS.MARK;
}
const M = loadMark();

/** The mark as SVG elements. `k` scales it about the centre; `stroke` and `ball` let small sizes run heavier. */
function markSvg(color, { k = 1, stroke = M.stroke, ball = M.ball[2] } = {}) {
  const [cx, cy] = M.ball;
  return `<g transform="scale(${k})"><path d="${M.d}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${ball}" fill="${color}"/></g>`;
}

// Favicon: the bare mark at full size, a heavier cut so it holds at 16 px.
// Deep gold on light browser chrome, the brand gold on dark.
function faviconSvg() {
  const [cx, cy] = M.ball;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 -32 64 64">
<style>path{stroke:${COL.goldDeep}}circle{fill:${COL.goldDeep}}@media (prefers-color-scheme:dark){path{stroke:${COL.gold}}circle{fill:${COL.gold}}}</style>
<g transform="scale(1.09)"><path d="${M.d}" fill="none" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${cx}" cy="${cy}" r="6.45"/></g>
</svg>
`;
}

// App icons: full-bleed dark square, the mark at 62% so it stays inside the
// maskable safe zone (a centred circle of 80% diameter).
function appIconHtml(size) {
  return `<!doctype html><html><body style="margin:0;background:${COL.bg}">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-32 -32 64 64" style="display:block">
<rect x="-32" y="-32" width="64" height="64" fill="${COL.bg}"/>${markSvg(COL.gold, { k: 0.62, stroke: M.stroke * 1.08, ball: M.ball[2] * 1.04 })}</svg></body></html>`;
}

/** In the page: the link-preview image, 1200 x 630. One prompt and three right answers on the
 * descent: the common one barely leaves the rim, the rare one rolls to the global minimum. */
async function drawOg() {
  const K = window.MLION_CARD.kit, V = window.MLION_VISUALS, { COL, font, glyph, lockup, descent } = K;
  const W = 1200, H = 630, PAD = 64;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext("2d", { alpha: false });
  c.fillStyle = COL.bg; c.fillRect(0, 0, W, H);

  const stops = [
    { x: 700, tier: "baseline", answer: "ReLU", pts: 10 },
    { x: 2100, tier: "indist", answer: "GELU", pts: 30 },
    { x: 7000, tier: "mlion", answer: "Snake", pts: 100 },
  ];
  const spec = { n: 7, steps: stops.map((s, i) => ({ tier: s.tier, pts: (s.x - (i ? stops[i - 1].x : 0)) / 10 })), duel: null };
  const at = descent(c, spec, { x: 0, y: 300, w: W, h: 268 }, {
    lead: 0.06, tail: 0.12, smooth: 0.012, glow: 900, bands: 7, thin: 1.6, path: 3, run: 8, dot: 7.5, ball: 24, tick: 0, strata: [15, 32, 54],
  });
  /** The slope's highest point (smallest y) under [x0, x1], to keep text clear of it. */
  const top = (x0, x1) => { let m = Infinity; for (let x = x0; x <= x1; x += 6) m = Math.min(m, at.pathAt(x)); return m; };

  // the rule, then the brand
  lockup(c, PAD, 44, 44, "");
  font(c, 68, 500, "normal", -0.022 * 68);
  c.fillStyle = COL.ink; c.textAlign = "left"; c.textBaseline = "alphabetic";
  c.fillText("Name the rarest", PAD, 174);
  c.fillText("right answer you can.", PAD, 250);

  // the common answers, above where they landed (the slope falls away to their right)
  for (const s of stops.slice(0, 2)) {
    const [px, py] = at.P(s.x);
    const tx = px - 6, ty = py - 26;
    font(c, 38, 500, "normal", -0.01 * 38); c.fillStyle = COL.ink; c.fillText(s.answer, tx, ty);
    const w = c.measureText(s.answer).width;
    font(c, 32, 500); c.fillStyle = V.TIER_COLORS[s.tier]; c.fillText(`+${s.pts}`, tx + w + 12, ty);
  }

  // the rare one, in the basin: right-aligned over the ball, lifted until it clears the slope
  const b = at.me, rx = b.x + 34;
  font(c, 33, 500);
  const tierText = "One in a MLion  +100", tw = c.measureText(tierText).width + 48;
  let base = b.y - 70;
  while (base + 10 > top(rx - tw, rx) - 18) base -= 4;
  c.textAlign = "right";
  c.fillStyle = V.TIER_COLORS.mlion; c.fillText(tierText, rx, base);
  glyph(c, "mlion", rx - tw, base - 32, 37);
  font(c, 76, 500, "normal", -0.02 * 76); c.fillStyle = COL.ink;
  c.fillText("Snake", rx, base - 48);
  c.textAlign = "left";

  // the prompt they all answer
  font(c, 32, 400, "normal", -0.005 * 32); c.fillStyle = COL.muted;
  c.fillText("Three right answers to “Name an activation function”", PAD, H - 42);

  const blob = await K.toBlob(canvas);
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Read a meta tag's content from index.html. */
function meta(html, key) {
  const m = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "";
}
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A Discord-like message with the link and its embed (dark theme). `img` is the image width in px. */
function mockHtml(src, img, pageW) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const t = { site: meta(html, "og:site_name"), title: meta(html, "og:title"), desc: meta(html, "og:description"), url: meta(html, "og:url"), bar: meta(html, "theme-color") };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; width: ${pageW}px; background: #313338; color: #dbdee1; font: 16px/1.375 "gg sans", "Noto Sans", "Segoe UI", Helvetica, Arial, sans-serif; }
.msg { display: grid; grid-template-columns: 40px 1fr; gap: 0 16px; padding: 18px 16px 18px 16px; }
.av { width: 40px; height: 40px; border-radius: 50%; background: #5865f2; }
.who { font-weight: 600; color: #f2f3f5; } .who small { font-weight: 400; color: #949ba4; font-size: 12px; margin-left: 6px; }
.link { color: #00a8fc; }
.embed { grid-column: 2; margin-top: 8px; max-width: ${img + 32}px; box-sizing: border-box; background: #2b2d31; border-left: 4px solid ${t.bar}; border-radius: 4px; padding: 8px 16px 16px 12px; }
.site { margin-top: 8px; font-size: 12px; color: #b5bac1; }
.title { margin-top: 8px; font-size: 16px; font-weight: 600; color: #00a8fc; }
.desc { margin-top: 8px; font-size: 14px; color: #dbdee1; }
.embed img { display: block; margin-top: 16px; width: ${img}px; border-radius: 4px; }
</style></head><body><div class="msg"><div class="av"></div><div>
<div class="who">Ana <small>Today at 21:04</small></div>
<div class="link">${escHtml(t.url)}</div>
<div class="embed"><div class="site">${escHtml(t.site)}</div><div class="title">${escHtml(t.title)}</div><div class="desc">${escHtml(t.desc)}</div><img src="${src}"></div>
</div></div></body></html>`;
}

(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  if (!onlyOg) {
    fs.writeFileSync(path.join(IMG, "favicon.svg"), faviconSvg());
    console.log("wrote img/favicon.svg");
  }
  const browser = await chromium.launch();
  try {
    if (!onlyOg) {
      for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await page.setContent(appIconHtml(size));
        await page.screenshot({ path: path.join(IMG, file) });
        await page.close();
        console.log(`wrote img/${file}`);
      }
    }

    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONT_CSS}"></head><body style="background:${COL.bg}"></body></html>`, { waitUntil: "networkidle" });
    for (const f of ["engine.js", "landscape.js", "sharecard.js"]) await page.addScriptTag({ path: path.join(ROOT, "js", f) });
    const fontOk = await page.evaluate(async () => {
      await Promise.all(["300", "400", "500"].map((w) => document.fonts.load(`${w} 40px Archivo`, "MLion Name the rarest right answer you can. ReLU GELU Snake One in a MLion +100 “”")));
      return document.fonts.check('500 40px "Archivo"');
    });
    if (!fontOk) throw new Error("Archivo did not load; the preview image needs it (check the network)");
    const b64 = await page.evaluate(`(${drawOg.toString()})()`);
    fs.mkdirSync(OG_DIR, { recursive: true });
    const ogPath = path.join(OG_DIR, "og.png");
    fs.writeFileSync(ogPath, Buffer.from(b64, "base64"));
    console.log(`wrote ${path.relative(ROOT, ogPath)} (${(fs.statSync(ogPath).size / 1024).toFixed(0)} KB)`);

    if (mock) {
      fs.mkdirSync(MOCK_DIR, { recursive: true });
      const src = `data:image/png;base64,${b64}`;
      for (const [name, img, pageW, scale] of [["desktop", 400, 560, 1], ["desktop-wide", 516, 680, 1], ["phone", 300, 390, 2]]) {
        const p = await browser.newPage({ viewport: { width: pageW, height: 400 }, deviceScaleFactor: scale });
        await p.setContent(mockHtml(src, img, pageW));
        await p.screenshot({ path: path.join(MOCK_DIR, `embed-${name}.png`), fullPage: true });
        await p.close();
      }
      // square crops some apps use for a small preview (centre of the image), at 160 and 80 px
      const p = await browser.newPage({ viewport: { width: 280, height: 180 }, deviceScaleFactor: 1 });
      await p.setContent(`<body style="margin:0;background:#2b2d31;display:flex;gap:16px;padding:10px">${[160, 80].map((s) => `<div style="width:${s}px;height:${s}px;border-radius:4px;background:url(${src}) center/cover"></div>`).join("")}</body>`);
      await p.screenshot({ path: path.join(MOCK_DIR, "embed-square.png") });
      await p.close();
      console.log(`wrote mock embeds to ${path.relative(ROOT, MOCK_DIR)}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
