#!/usr/bin/env node
/* Check how candidate answers match one prompt, to find what's missing.
 *   node tools/probe.js <prompt-id> "name one" "name two" ...
 *   node tools/probe.js <prompt-id> --file candidates.txt     (one name per line)
 *   node tools/probe.js <prompt-id> --file candidates.txt --missing   (only non-exact rows)
 * Output columns: EXACT | CORRECT (one near miss) | SUGGEST | NONE, then what it hit. */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require("../js/engine.js");

const [id, ...rest] = process.argv.slice(2);
if (!id) { console.error("usage: node tools/probe.js <prompt-id> [names…] [--file list.txt] [--missing]"); process.exit(2); }
const file = path.join(__dirname, "..", "data", "prompts", `${id}.json`);
const prompt = JSON.parse(fs.readFileSync(file, "utf8"));
const onlyMissing = rest.includes("--missing");
let names = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--file") names.push(...fs.readFileSync(rest[++i], "utf8").split(/\r?\n/));
  else if (!rest[i].startsWith("--")) names.push(rest[i]);
}
names = [...new Set(names.map((s) => s.trim()).filter(Boolean))];
let exact = 0;
for (const n of names) {
  const m = E.matchAnswer(prompt, n);
  if (m.kind === "exact") exact++;
  if (onlyMissing && m.kind === "exact") continue;
  const tag = { exact: "EXACT  ", correction: "CORRECT", suggest: "SUGGEST", none: "NONE   " }[m.kind];
  const hit = m.answer ? `${m.answer.a} [${m.answer.t}]` : m.suggestions ? m.suggestions.map((a) => a.a).join(" · ") : "";
  console.log(`${tag}  ${n}${hit ? "  →  " + hit : ""}`);
}
console.error(`${names.length} probed · ${exact} exact · ${names.length - exact} not exact · prompt has ${prompt.answers.length} answers`);
