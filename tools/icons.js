#!/usr/bin/env node
/* Render the site icons from the lion mark (MARK in js/landscape.js).
 *
 *   node tools/icons.js     writes img/favicon.svg, img/icon-192.png, img/icon-512.png,
 *                           img/apple-touch-icon.png and img/og.png
 *
 * Needs Playwright (chromium) and a network connection for the Archivo font
 * used on the share image. */
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

// Share card: lockup and line on the home screen's own loss surface.
function ogHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${FONT_CSS}">
<style>
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: ${COL.bg}; }
body { font-family: Archivo, sans-serif; color: ${COL.ink}; }
#landscape { position: absolute; inset: 0; width: 1200px; height: 630px; }
.card { position: absolute; left: 88px; top: 132px; }
.lockup { display: flex; align-items: center; gap: 0.16em; font-size: 176px; }
.lockup svg { width: 0.9em; height: 0.9em; flex: none; overflow: visible; }
.wm { font-stretch: 125%; font-weight: 300; letter-spacing: -0.045em; line-height: 0.9; }
.tag { margin: 34px 0 0 6px; font-size: 40px; letter-spacing: -0.01em; line-height: 1.2; }
</style></head><body>
<canvas id="landscape"></canvas>
<div class="card">
  <div class="lockup"><svg viewBox="-32 -32 64 64">${markSvg(COL.gold)}</svg><span class="wm">MLion</span></div>
  <p class="tag">A daily machine-learning word game</p>
</div>
</body></html>`;
}

(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  fs.writeFileSync(path.join(IMG, "favicon.svg"), faviconSvg());
  console.log("wrote img/favicon.svg");

  const browser = await chromium.launch();
  try {
    for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(appIconHtml(size));
      await page.screenshot({ path: path.join(IMG, file) });
      await page.close();
      console.log(`wrote img/${file}`);
    }

    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(ogHtml(), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const fontOk = await page.evaluate(() => document.fonts.check('300 100px "Archivo"'));
    if (!fontOk) throw new Error("Archivo did not load; the share image needs it (check the network)");
    await page.addScriptTag({ path: LANDSCAPE });
    await page.evaluate(() => {
      window.MLION_VISUALS.initBackdrop();
      window.MLION_VISUALS.scene("page");
      // the page view is drawn faint for a busy screen; lift the lines away from the ground for a thumbnail
      const c = document.getElementById("landscape"), x = c.getContext("2d");
      const im = x.getImageData(0, 0, c.width, c.height), d = im.data, bg = [11, 10, 8];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = bg[k] + (d[i + k] - bg[k]) * 1.7;
      x.putImageData(im, 0, 0);
    });
    await page.screenshot({ path: path.join(IMG, "og.png") });
    console.log("wrote img/og.png");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
