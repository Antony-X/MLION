#!/usr/bin/env node
/* The installable app: a manifest the browser accepts, and a service worker that lets the game
 * open and play with no network after one visit.
 *   node tests/pwa.e2e.js
 * The worker only registers on https or when mlion:sw is set; this test sets it on 127.0.0.1
 * (a secure context), so it runs without certificates. */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const served = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  served.push(url);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
const check = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓ " + msg); };

(async () => {
  // the manifest and the precache list
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  check(man.name === "MLion" && man.display === "standalone" && man.start_url === "./", "the manifest names the app and opens it standalone");
  check(man.icons.some((i) => i.sizes === "192x192") && man.icons.some((i) => i.sizes === "512x512") && man.icons.every((i) => fs.existsSync(path.join(ROOT, i.src))), "the manifest's 192 and 512 icons exist");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const assets = JSON.parse(sw.match(/\/\*ASSETS\*\/([\s\S]*?)\/\*END\*\//)[1]);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const linked = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+\?v=[a-z0-9]+)"/g)].map((m) => m[1]);
  check(linked.length >= 6 && linked.every((u) => assets.includes(u)), `the worker precaches every file index.html loads, at the same hashes (${linked.length})`);

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  await ctx.addInitScript(() => { try { localStorage.setItem("mlion:sw", "true"); localStorage.setItem("mlion:seenHow", "true"); } catch { /* */ } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base);
  await page.waitForSelector(".wordmark");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => null);
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find((k) => k.startsWith("mlion-"))); return (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); });
  check(cached.length >= assets.length, `the worker installed and cached the app (${cached.length} files)`);

  // a second visit with no network at all
  await ctx.setOffline(true);
  const before = served.length;
  await page.goto(base + "#daily");
  await page.waitForSelector("#begin", { timeout: 15000 });
  check(served.length === before, "offline: the page and every script come from the cache (no requests reach the server)");
  await page.click("#begin");
  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 10000 });
  check(!!(await page.$("#answer")), "offline: today's daily starts and takes answers");
  await page.goto(base + "#quiz-1");
  await page.waitForSelector("#begin", { timeout: 10000 });
  check(true, "offline: the quiz opens too");

  // the Install entry stays hidden until the browser offers installation
  check(await page.$eval("#install", (b) => b.hidden), "the menu's Install entry is hidden until the browser offers it");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
  await browser.close();
  server.close();
  console.log("pwa e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
