// The two big data files (js/data.js, js/explain.js) are served pre-compressed with brotli at its strongest
// setting: tools/deploy.sh writes a .br copy of each next to it. Cloudflare's own on-the-fly compression of the
// same files is about a quarter bigger. Only these two paths reach this script (run_worker_first in
// wrangler.jsonc); every other file is served straight from the static assets, as is any request for these
// two from a browser that doesn't take brotli.
//
// It also runs for /relay: live rooms' WebSockets, which go to the relay in worker/relay.js.
import { relayFetch } from "./relay.js";

export { Relay } from "./relay.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/relay") return relayFetch(request, env);
    const wantsBr = /\bbr\b/.test(request.headers.get("Accept-Encoding") || "");
    if (wantsBr && (request.method === "GET" || request.method === "HEAD")) {
      const br = await env.ASSETS.fetch(new Request(new URL(url.pathname + ".br", url.origin), { headers: { "Accept-Encoding": "identity" } }));
      if (br.ok) {
        const headers = new Headers(br.headers);
        headers.set("Content-Type", "text/javascript; charset=utf-8");
        headers.set("Content-Encoding", "br");
        headers.set("Vary", "Accept-Encoding");
        headers.delete("Content-Length");
        return new Response(request.method === "HEAD" ? null : br.body, { status: 200, headers, encodeBody: "manual" });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
