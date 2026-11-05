#!/usr/bin/env node
/* Bundle the whole game (HTML, CSS, JS, data) into one self-contained file.
 *   node tools/build-single.js [out.html] [--fragment] [--url=https://…]
 * --url sets the public address that challenge links point at.
 * --fragment omits the <!doctype>/<html>/<head>/<body> wrapper, for hosts that
 * supply their own document skeleton. Run tools/build.js first. */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const fragment = args.includes("--fragment");
const urlArg = args.find((a) => a.startsWith("--url="));
const shareUrl = urlArg ? urlArg.slice(6) : "";
const out = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(ROOT, "dist", "mlion.html"));

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const html = read("index.html");
const safe = (js) => js.replace(/<\/script/gi, "<\\/script");

const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
// one file has no img/ folder beside it, so the favicon travels as a data URI
const icon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(read("img/favicon.svg").trim())}">`;
const desc = html.match(/<meta name="description"[^>]+>/)[0];
const site = html.match(/<meta property="og:url"[^>]+>/)[0]; // the public site (js/app.js WEB_URL reads it)
const body = html.slice(html.indexOf("<body>") + 6, html.search(/<script src="js\/engine\.js/)).trim();
const scripts = ["js/engine.js", "js/data.js", "js/landscape.js", "js/hero3d.js", "js/sharecard.js", "js/app.js"]
  .map((f) => `<script>/* ${f} */\n${safe(read(f))}\n</script>`).join("\n");

const head = [
  "<title>MLion</title>",
  fragment ? '<meta name="claude:viewport-fit-sides" content="cover">' : "",
  desc,
  site,
  shareUrl ? `<meta name="mlion:url" content="${shareUrl.replace(/"/g, "&quot;")}">` : "",
  '<meta name="theme-color" content="#090b10">',
  icon,
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  fonts,
  `<style>\n${read("css/style.css")}\n</style>`,
].filter(Boolean).join("\n");

const doc = fragment
  ? `${head}\n${body}\n${scripts}\n`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n${scripts}\n</body>\n</html>\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(doc.length / 1024).toFixed(0)} KB${fragment ? ", fragment" : ""})`);
