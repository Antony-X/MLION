#!/usr/bin/env node
/* Autocorrect benchmark for the answer matcher.
 *
 * Positives: realistic typos of real answers (keyboard slips, a dropped or doubled letter, swapped
 * letters, two slips in a long name). The matcher should land on the answer that was meant.
 * Negatives: answers to OTHER prompts, typed into this prompt. The matcher should turn them down.
 *
 *   node tools/matchbench.js            summary over the core prompts
 *   node tools/matchbench.js --fails 20 also print up to 20 failures of each kind
 *   node tools/matchbench.js --split test   only prompts in the held-out half (ids hashed)
 *
 * Probes whose typo happens to spell another listed answer exactly are skipped: no matcher could
 * know which was meant. Deterministic (seeded). */
"use strict";
const path = require("path");
const E = require(path.join(__dirname, "..", "js", "engine.js"));
global.window = {};
require(path.join(__dirname, "..", "js", "data.js"));
const DATA = global.window.MLION_DATA;
if (!args0().includes("--no-lexicon")) E.setLexicon(DATA.prompts.concat(DATA.extras || []));
function args0() { return process.argv.slice(2); }

const args = process.argv.slice(2);
const FAILS = args.includes("--fails") ? +args[args.indexOf("--fails") + 1] || 10 : 0;
const SPLIT = args.includes("--split") ? args[args.indexOf("--split") + 1] : "all";
const PER_PROMPT = 14;

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const NEAR = {};
for (let r = 0; r < 3; r++) for (let c = 0; c < ROWS[r].length; c++) {
  const ch = ROWS[r][c], n = [];
  for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]]) {
    const row = ROWS[r + dr];
    if (row && row[c + dc]) n.push(row[c + dc]);
  }
  NEAR[ch] = n;
}
const rng = E.mulberry32(20261105);
const pick = (a) => a[Math.floor(rng() * a.length)];
const letterSpots = (s) => [...s].map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter((i) => i > 0); // keep the first letter: people rarely miss it
function slip(s, kind) {
  const spots = letterSpots(s);
  if (!spots.length) return null;
  const i = pick(spots);
  const c = s[i].toLowerCase();
  if (kind === "sub") return NEAR[c] ? s.slice(0, i) + pick(NEAR[c]) + s.slice(i + 1) : null;
  if (kind === "del") return s.slice(0, i) + s.slice(i + 1);
  if (kind === "dup") return s.slice(0, i) + s[i] + s.slice(i);
  if (kind === "swap") return i + 1 < s.length && /[a-z]/i.test(s[i + 1]) && s[i] !== s[i + 1] ? s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2) : null;
  return null;
}
const KINDS = ["sub", "del", "dup", "swap"];

const inSplit = (id) => SPLIT === "all" || ((E.hashString(id) % 2 === 0) === (SPLIT === "train"));
const prompts = DATA.prompts.filter((p) => !p.extra && inSplit(p.id));
const others = DATA.prompts.filter((p) => !p.extra);

const tally = { pos: 0, right: 0, rightExact: 0, wrong: 0, suggested: 0, miss: 0, neg: 0, falseAccept: 0, negSuggest: 0 };
const fails = { wrong: [], miss: [], falseAccept: [] };
const t0 = Date.now();
for (const p of prompts) {
  const allKeys = new Set();
  p.answers.forEach((a) => [a.a].concat(a.aka || []).forEach((n) => allKeys.add(E.fullKey(n))));
  const sample = E.shuffled(p.answers, rng).slice(0, PER_PROMPT);
  for (const a of sample) {
    const name = a.a;
    if (E.fullKey(name).length < 5) continue; // short names get no typo budget by design
    const kinds = E.fullKey(name).length >= 10 ? KINDS.concat("two") : KINDS;
    for (const kind of kinds) {
      const typed = kind === "two" ? slip(slip(name, pick(KINDS)) || name, pick(KINDS)) : slip(name, kind);
      if (!typed || E.fullKey(typed) === E.fullKey(name) || allKeys.has(E.fullKey(typed))) continue;
      tally.pos++;
      const m = E.matchAnswer(p, typed);
      const got = m.kind === "exact" || m.kind === "correction" ? m.answer : null;
      if (got === a) { tally.right++; if (m.kind === "exact") tally.rightExact++; }
      else if (got) { tally.wrong++; fails.wrong.push(`${p.id}: "${typed}" (meant ${name}) -> ${got.a} (${m.kind}${m.via ? " via " + m.via : ""} ${m.confidence ? m.confidence.toFixed(2) : ""})`); }
      else if (m.kind === "suggest" && m.suggestions.includes(a)) tally.suggested++;
      else { tally.miss++; fails.miss.push(`${p.id}: "${typed}" (meant ${name}) -> ${m.kind}${m.kind === "suggest" ? " " + m.suggestions.map((s) => s.a).join("/") : ""}`); }
    }
  }
  // negatives: well-known answers of other prompts in other packs
  const foreign = E.shuffled(others.filter((q) => q.pack !== p.pack), rng).slice(0, 6)
    .flatMap((q) => E.shuffled(q.answers.filter((x) => x.t === "baseline" || x.t === "indist"), rng).slice(0, 3));
  for (const f of foreign) {
    if (allKeys.has(E.fullKey(f.a))) continue; // it really is an answer here too
    tally.neg++;
    const m = E.matchAnswer(p, f.a);
    if (m.kind === "exact" || m.kind === "correction") { tally.falseAccept++; fails.falseAccept.push(`${p.id}: "${f.a}" -> ${m.answer.a} (${m.kind}${m.via ? " via " + m.via : ""} ${m.confidence ? m.confidence.toFixed(2) : ""})`); }
    else if (m.kind === "suggest") tally.negSuggest++;
  }
}
const pct = (x, n) => `${((100 * x) / Math.max(1, n)).toFixed(1)}%`;
console.log(`prompts ${prompts.length} (${SPLIT}) · ${Date.now() - t0} ms`);
console.log(`typos ${tally.pos}: right ${pct(tally.right, tally.pos)} (exact layer ${pct(tally.rightExact, tally.pos)}) · offered ${pct(tally.suggested, tally.pos)} · WRONG answer ${pct(tally.wrong, tally.pos)} · missed ${pct(tally.miss, tally.pos)}`);
console.log(`other prompts' answers ${tally.neg}: FALSE accept ${pct(tally.falseAccept, tally.neg)} · offered ${pct(tally.negSuggest, tally.neg)}`);
if (FAILS) for (const k of Object.keys(fails)) { console.log(`\n-- ${k} (${fails[k].length})`); fails[k].slice(0, FAILS).forEach((l) => console.log("  " + l)); }
module.exports = { tally };
