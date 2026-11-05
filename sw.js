/* MLion service worker: after the first visit the game opens instantly and plays offline.
 *   - the page: network first, so a new release shows at once; the cached copy when offline
 *   - our own files: cache first (tools/build.js stamps them with content hashes, so a
 *     changed file has a new URL and is fetched fresh)
 *   - Google Fonts: served from cache, refreshed in the background
 *   - everything else (leaderboard, live rooms): straight to the network, never cached
 * tools/build.js rewrites the ASSETS line on every build. */
"use strict";
const ASSETS = /*ASSETS*/["./","css/style.css?v=126mfr7","js/engine.js?v=1hbzkkk","js/data.js?v=15dal5d","js/landscape.js?v=1wh6xx","js/hero3d.js?v=1qqfzi9","js/app.js?v=ans3fz","manifest.webmanifest","img/favicon.svg","img/icon-192.png","img/apple-touch-icon.png"]/*END*/;
const CACHE = "mlion-" + ASSETS.join("|").split("").reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mlion-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function keep(req, res) {
  if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => keep("./", res)).catch(() => caches.match("./")));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => keep(req, res)).catch(() => hit);
      return hit || fresh;
    }));
  }
});
