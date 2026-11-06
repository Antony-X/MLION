/* MLion service worker: after the first visit the game opens instantly and plays offline.
 *   - the page: network first (revalidated, never the browser's 10-minute HTTP cache), so a new release
 *     shows at once; the cached copy when offline
 *   - our own files: cache first (tools/build.js stamps them with content hashes, so a
 *     changed file has a new URL and is fetched fresh)
 *   - Google Fonts: served from cache, refreshed in the background
 *   - everything else (leaderboard, live rooms): straight to the network, never cached
 * tools/build.js rewrites the ASSETS line on every build.
 *
 * Versions never mix. A stamped file (?v=<hash>) is only stored when its content has that hash, and the
 * offline page only when it loads exactly these stamps, so a stale copy from a cache can't sit under a
 * new name. A new worker installs everything fresh (bypassing the HTTP cache), then waits: the page tells
 * it to take over when no game is running, and reloads once onto the new version (app.js, "updates"). */
"use strict";
const ASSETS = /*ASSETS*/["./","css/style.css?v=9614li","js/engine.js?v=d55y4z","js/data.js?v=1pd526z","js/landscape.js?v=10zcgj2","js/hero3d.js?v=16wh49w","js/sharecard.js?v=1godt4k","js/app.js?v=10uz623","js/explain.js?v=r09ucr","manifest.webmanifest","img/favicon.svg","img/icon-192.png","img/apple-touch-icon.png"]/*END*/;
const CACHE = "mlion-" + ASSETS.join("|").split("").reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36);

// The build's content hash (E.hashString in js/engine.js: 32-bit FNV-1a over the text, base 36).
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x1000193); }
  return (h >>> 0).toString(36);
}
const stampOf = (url) => { const m = String(url).match(/[?&]v=([a-z0-9]+)/); return m ? m[1] : null; };
const STAMPED = ASSETS.filter(stampOf);
/** The stamped files a page loads (its script and style links). */
const pageStamps = (html) => [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+\?v=[a-z0-9]+)"/g)].map((m) => m[1]);
/** Whether a response is the version its URL names: a stamped file has that hash; the page loads this worker's files. */
async function genuine(url, res) {
  if (!res || !res.ok || res.type !== "basic") return false;
  const path = new URL(url, location).pathname, root = new URL("./", location).pathname;
  if (path === root || path === root + "index.html") {
    const want = pageStamps(await res.clone().text());
    return want.length > 0 && want.every((u) => STAMPED.includes(u));
  }
  const v = stampOf(url);
  return !v || hashString(await res.clone().text()) === v;
}
/** One file for the precache, from the network (not the HTTP cache); a second try if a cache still held an old copy. */
async function fetchGenuine(url) {
  for (let i = 0; i < 2; i++) {
    const res = await fetch(new Request(i ? `${url}${url.includes("?") ? "&" : "?"}r=${Date.now()}` : url, { cache: "reload" }));
    if (await genuine(url, res)) return res;
  }
  throw new Error(`${url}: not the version this worker was built for`);
}

self.addEventListener("install", (e) => {
  // All or nothing: if any file isn't the right version (a deploy landed mid-install), install fails and the
  // old worker keeps serving; the browser tries again on a later visit. No skipWaiting here: see "message".
  e.waitUntil((async () => {
    const files = await Promise.all(ASSETS.map(async (u) => [u, await fetchGenuine(u)]));
    const cache = await caches.open(CACHE);
    await Promise.all(files.map(([u, res]) => cache.put(u, res)));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mlion-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page asks: "assets" (what this worker serves, to tell whether the page is already this version),
// "skip" (take over now: no game is running there).
self.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.t === "assets" && e.ports[0]) e.ports[0].postMessage({ assets: ASSETS });
  if (m.t === "skip") self.skipWaiting();
});

async function keep(req, res) {
  if (res && res.ok && await genuine(req.url, res)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && url.origin === location.origin) {
    const shell = url.pathname === new URL("./", location).pathname || url.pathname === new URL("./index.html", location).pathname; // only the game's own page is its offline copy
    // "no-cache": always ask the server (an unchanged page costs a 304), never the browser's 10-minute copy
    e.respondWith(fetch(req.url, { cache: "no-cache", redirect: "manual", credentials: "same-origin" })
      .then(async (res) => {
        if (shell && res.ok && await genuine("./", res)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./", copy)); }
        return res;
      })
      .catch(() => caches.match("./")));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || fresh;
    }));
  }
});
