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
const override = new Map(); // path -> body: a "new deploy" for the update test
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  served.push(url);
  const key = url === "/" ? "/index.html" : url;
  if (override.has(key)) { res.writeHead(200, { "Content-Type": TYPES[path.extname(key)] || "text/plain" }); return res.end(override.get(key)); }
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
  await page.waitForSelector("#answer", { timeout: 15000 });
  check(served.length === before, "offline: the page and every script come from the cache (no requests reach the server)");
  await page.waitForSelector("#veil.hidden", { state: "attached", timeout: 10000 });
  check(!!(await page.$("#answer")), "offline: today's daily starts and takes answers");
  await page.goto(base + "#quiz-1");
  await page.waitForSelector(".mcq-opt", { timeout: 10000 });
  check(true, "offline: the quiz opens too");

  // the Install entry stays hidden until the browser offers installation
  check(await page.$eval("#install", (b) => b.hidden), "the menu's Install entry is hidden until the browser offers it");

  // ---- updates are atomic: a stamped file is only stored with the content its hash names
  await ctx.setOffline(false);
  await page.goto(base);
  await page.waitForSelector(".wordmark");
  const bogus = await page.evaluate(async () => {
    await fetch("js/app.js?v=bogus1"); // the server ignores ?v, like GitHub Pages: this is today's app.js under a wrong name
    await new Promise((r) => setTimeout(r, 300));
    const c = await caches.open((await caches.keys()).find((k) => k.startsWith("mlion-")));
    return !!(await c.match("js/app.js?v=bogus1"));
  });
  check(!bogus, "a file whose content doesn't match its ?v= stamp is served but never cached under that name");

  // ---- a new deploy: new app.js, index.html and sw.js. While a daily is running nothing changes; on the
  // next screen between games the new worker takes over and the page reloads once onto the new files.
  const E = require("../js/engine.js");
  const oldApp = linked.find((u) => u.startsWith("js/app.js"));
  const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8") + "\n// a new release\n";
  const newApp = `js/app.js?v=${E.hashString(appSrc).toString(36)}`;
  const pageApp = () => page.evaluate(() => document.querySelector('script[src*="js/app.js"]').getAttribute("src"));
  check((await pageApp()) === oldApp, "the page runs the old release");
  override.set("/js/app.js", appSrc);
  override.set("/index.html", html.replace(oldApp, newApp));
  override.set("/sw.js", sw.replace(JSON.stringify(oldApp), JSON.stringify(newApp)));
  await page.evaluate(() => { window.__before = true; location.hash = "daily"; }); // same page, now mid-daily
  await page.waitForSelector("#answer", { timeout: 15000 });
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
  await page.waitForFunction(async () => { const reg = await navigator.serviceWorker.getRegistration(); return !!reg.waiting; }, null, { timeout: 15000, polling: 200 });
  await page.waitForTimeout(800);
  check(await page.evaluate(() => window.__before === true && !!document.querySelector("#answer")), "mid-daily: the new worker waits and the page is left alone");
  const reloaded = page.waitForEvent("load", { timeout: 15000 });
  await page.evaluate(() => { location.hash = "home"; });
  await reloaded;
  await page.waitForSelector(".wordmark");
  check(await page.evaluate(() => window.__before === undefined), "back home between games: the page reloaded once");
  check((await pageApp()) === newApp, "and runs the new release");
  await page.waitForTimeout(500);
  const keys = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("mlion-")));
  const newCached = await page.evaluate(async (u) => !!(await caches.match(u)), newApp);
  check(keys.length === 1 && newCached, "one cache left, holding the new release");
  await ctx.setOffline(true);
  await page.goto(base + "#daily");
  await page.waitForSelector("#answer", { timeout: 15000 });
  check((await pageApp()) === newApp, "offline after the update: the daily opens on the new release");
  await ctx.setOffline(false);
  // a worker whose files come back as another version (a cache still holding the old ones) never installs
  override.set("/sw.js", sw.replace(JSON.stringify(oldApp), JSON.stringify("js/app.js?v=zzzzzz")));
  await page.goto(base);
  await page.waitForSelector(".wordmark");
  const staleInstalled = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update().catch(() => null);
    await new Promise((r) => setTimeout(r, 1500));
    return !!(reg.waiting || reg.installing);
  });
  check(!staleInstalled, "a release whose files don't match their stamps fails to install; the working version stays");
  override.clear();
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
  await browser.close();
  server.close();
  console.log("pwa e2e passed");
})().catch((e) => { console.error(e); process.exit(1); });
