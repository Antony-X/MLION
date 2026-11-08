/* The live relay for tests: a local `wrangler dev` running worker/relay.js, and a hook that lets a test's own
 * static server pass /relay WebSockets to it, so pages reach the relay at their own origin as they do on
 * mlion.lol. Set MLION_RELAY_DEV=http://127.0.0.1:<port> to share one running relay across test files. */
"use strict";
const { spawn, execFileSync } = require("child_process");
const net = require("net");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** Start (or reuse) a local relay. Resolves to { http: "http://127.0.0.1:<port>", url: "ws://…/relay", stop() }. */
async function startRelay() {
  if (process.env.MLION_RELAY_DEV) {
    const http = process.env.MLION_RELAY_DEV.replace(/\/$/, "");
    return { http, url: http.replace(/^http/, "ws") + "/relay", stop: async () => {} };
  }
  const port = await freePort();
  const child = spawn("npx", ["-y", "wrangler@4", "dev", "--port", String(port), "--ip", "127.0.0.1", "--show-interactive-dev-session=false", "--inspector-port", String(await freePort())],
    { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  let log = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("wrangler dev didn't start in 90 s:\n" + log.slice(-2000))), 90000);
    const onData = (b) => { log += b; if (/Ready on/.test(log)) { clearTimeout(t); resolve(); } };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`wrangler dev exited (${code}):\n` + log.slice(-2000))); });
  });
  const http = `http://127.0.0.1:${port}`;
  let stopped = false;
  const stop = () => { // the relay this test started, and only it (its whole process tree)
    if (stopped) return;
    stopped = true;
    child.removeAllListeners("exit");
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill();
    } catch { /* already gone */ }
  };
  process.on("exit", stop); // a test that fails calls process.exit: don't leave the relay running
  return { http, url: `ws://127.0.0.1:${port}/relay`, stop: async () => stop() };
}

/** Pass WebSocket upgrades for /relay on a test's static server through to the relay. The page's Origin becomes
 *  the relay's own, which wrangler dev presents as https://mlion.lol: to the relay the page is the live site's. */
function attachRelay(server, relay) {
  const target = new URL(relay.http);
  const open = new Set(); let downUntil = 0;
  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/relay")) return socket.destroy();
    if (Date.now() < downUntil) return socket.destroy(); // cut(): the relay is "restarting"
    const up = net.connect(+target.port, target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        const lk = k.toLowerCase();
        lines.push(`${k}: ${lk === "host" ? target.host : lk === "origin" ? target.origin : req.rawHeaders[i + 1]}`);
      }
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const pair = { up, socket }; open.add(pair);
    const end = () => { open.delete(pair); up.destroy(); socket.destroy(); };
    up.on("error", end);
    socket.on("error", end);
    up.on("close", () => { open.delete(pair); socket.destroy(); });
    socket.on("close", () => { open.delete(pair); up.destroy(); });
  });
  /** What a deploy does to the live relay: every connection drops at once and new ones fail for downMs. */
  return { cut(downMs = 0) { downUntil = Date.now() + downMs; for (const p of [...open]) { p.up.destroy(); p.socket.destroy(); } open.clear(); }, count: () => open.size };
}

module.exports = { startRelay, attachRelay };
