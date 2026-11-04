#!/usr/bin/env node
/* Validate every prompt file in data/prompts and bundle them into js/data.js.
 *
 *   node tools/build.js            validate everything, write js/data.js
 *   node tools/build.js --check F  validate only the given prompt files (no write)
 *   node tools/build.js --stats    validate + print per-prompt tier counts
 *   node tools/build.js --lenient  bundle valid files even if others fail (dev only)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require("../js/engine.js");

const ROOT = path.join(__dirname, "..");
const PROMPT_DIR = path.join(ROOT, "data", "prompts");
const PACKS_FILE = path.join(ROOT, "data", "packs.json");
const OUT = path.join(ROOT, "js", "data.js");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const showStats = args.includes("--stats");
const lenient = args.includes("--lenient"); // dev only: bundle the valid files, skip broken ones
const fileArgs = args.filter((a) => !a.startsWith("--"));

const packs = JSON.parse(fs.readFileSync(PACKS_FILE, "utf8"));
const DISPLAY_FILE = path.join(ROOT, "data", "display.json");
const display = fs.existsSync(DISPLAY_FILE) ? JSON.parse(fs.readFileSync(DISPLAY_FILE, "utf8")) : {};
const packIds = new Set(packs.map((p) => p.id));

const RULES = {
  minAnswers: 25, // hard floor; small closed sets (e.g. Greek letters) must still list all members
  baseline: [1, 8],
  overfit: [0, 3],
  mlion: [1, 1],
  quipMax: 140,
  noteMax: 160,
};

function validatePrompt(p, file) {
  const errs = [], warns = [];
  const where = path.basename(file);
  if (!p || typeof p !== "object") return { errs: [`${where}: not an object`], warns };
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(p.id || "")) errs.push(`bad id "${p.id}"`);
  if (p.id && path.basename(file, ".json") !== p.id) errs.push(`file name must equal id (${p.id}.json)`);
  if (!packIds.has(p.pack)) errs.push(`unknown pack "${p.pack}" (use one of ${[...packIds].join(", ")})`);
  if (typeof p.text !== "string" || !/^Name /.test(p.text)) errs.push(`text must start with "Name ": ${p.text}`);
  if (p.note !== undefined && (typeof p.note !== "string" || p.note.length > RULES.noteMax)) errs.push(`note must be a string ≤ ${RULES.noteMax} chars`);
  if (p.strip !== undefined && (!Array.isArray(p.strip) || !p.strip.every((w) => typeof w === "string"))) errs.push("strip must be an array of strings");
  if (!Array.isArray(p.answers)) { errs.push("answers must be an array"); return { errs, warns }; }

  const counts = Object.fromEntries(E.TIER_IDS.map((t) => [t, 0]));
  const names = new Map();
  p.answers.forEach((a, i) => {
    const at = `answers[${i}] "${a && a.a}"`;
    if (!a || typeof a.a !== "string" || !a.a.trim()) { errs.push(`${at}: missing "a"`); return; }
    if (a.a !== a.a.trim()) errs.push(`${at}: leading/trailing whitespace`);
    if (!E.TIERS[a.t]) errs.push(`${at}: bad tier "${a.t}"`);
    else counts[a.t]++;
    if (a.aka !== undefined && (!Array.isArray(a.aka) || !a.aka.every((s) => typeof s === "string" && s.trim()))) errs.push(`${at}: aka must be an array of non-empty strings`);
    if (a.q !== undefined && (typeof a.q !== "string" || !a.q.trim() || a.q.length > RULES.quipMax)) errs.push(`${at}: quip must be a non-empty string ≤ ${RULES.quipMax} chars`);
    const extra = Object.keys(a).filter((k) => !["a", "t", "aka", "q"].includes(k));
    if (extra.length) errs.push(`${at}: unknown fields ${extra.join(",")}`);
    const k = E.fullKey(a.a);
    if (!k) errs.push(`${at}: answer normalizes to empty string`);
    if (names.has(k)) errs.push(`${at}: duplicate of "${names.get(k)}"`);
    names.set(k, a.a);
  });
  if (p.answers.length < RULES.minAnswers) errs.push(`only ${p.answers.length} answers (min ${RULES.minAnswers})`);
  else if (p.answers.length < 40) warns.push(`only ${p.answers.length} answers — fine only for a genuinely small closed set`);
  for (const t of ["baseline", "overfit", "mlion"]) {
    const [lo, hi] = RULES[t];
    if (counts[t] < lo || counts[t] > hi) errs.push(`${t} count ${counts[t]} outside [${lo}, ${hi}]`);
  }
  const n = p.answers.length || 1;
  if (counts.longtail + counts.outlier < n * 0.35) warns.push(`deep tiers thin: outlier+longtail = ${counts.outlier + counts.longtail}/${n}`);
  if (counts.indist < 2) warns.push(`indist only ${counts.indist}`);
  const { errors } = E.buildIndex(p);
  errs.push(...errors);
  // What players see: "(e.g. <example>)" plus an optional scope line. Notes stay internal.
  const d = display[p.id] || {};
  const firstBase = p.answers.find((a) => a.t === "baseline");
  const example = d.example || p.example || (firstBase && firstBase.a);
  const m = example ? E.matchAnswer(p, example) : null;
  if (!m || m.kind !== "exact") errs.push(`example "${example}" is not an accepted answer`);
  else if (m.answer.t !== "baseline") warns.push(`example "${example}" is ${m.answer.t}, not baseline`);
  delete p._index;
  p.example = m && m.answer ? m.answer.a : example;
  const scope = d.scope !== undefined ? d.scope : p.scope;
  if (scope) p.scope = scope; else delete p.scope;
  return { errs, warns, counts };
}

function sortAnswers(p) {
  const order = Object.fromEntries(E.TIERS_BY_SCORE.map((t, i) => [t.id, i]));
  p.answers.sort((x, y) => order[x.t] - order[y.t] || x.a.localeCompare(y.a, "en", { sensitivity: "base" }));
  return p;
}

const files = fileArgs.length
  ? fileArgs.map((f) => path.resolve(f))
  : fs.readdirSync(PROMPT_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(PROMPT_DIR, f));

let bad = 0, warnCount = 0;
const prompts = [];
const seenIds = new Map();
const seenText = new Map();
for (const file of files) {
  let p;
  try { p = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error(`✗ ${path.basename(file)}: invalid JSON — ${e.message}`); bad++; continue; }
  const { errs, warns, counts } = validatePrompt(p, file);
  if (p && p.id) {
    if (seenIds.has(p.id)) errs.push(`duplicate id also in ${seenIds.get(p.id)}`);
    seenIds.set(p.id, path.basename(file));
    const tk = E.fullKey(p.text || "");
    if (seenText.has(tk)) errs.push(`duplicate prompt text also in ${seenText.get(tk)}`);
    seenText.set(tk, path.basename(file));
  }
  const tag = path.basename(file);
  if (errs.length) {
    bad++;
    console.error(`✗ ${tag}`);
    errs.forEach((e) => console.error(`    error: ${e}`));
  }
  if (warns.length) { warnCount += warns.length; warns.forEach((w) => console.warn(`  ! ${tag}: ${w}`)); }
  if (showStats && counts) {
    const c = E.TIERS_BY_SCORE.map((t) => `${t.emoji}${counts[t.id]}`).join(" ");
    console.log(`  ${p.id.padEnd(28)} ${String(p.answers.length).padStart(4)}  ${c}`);
  }
  if (!errs.length) prompts.push(sortAnswers(p));
}

for (const id of Object.keys(display)) {
  if (!id.startsWith("_") && !seenIds.has(id) && !fileArgs.length) console.warn(`  ! display.json: no prompt "${id}" yet`);
}
const total = prompts.reduce((s, p) => s + p.answers.length, 0);
console.log(`${files.length} prompt files · ${prompts.length} valid · ${bad} invalid · ${warnCount} warnings · ${total} answers`);
if (bad && !lenient) process.exit(1);
if (checkOnly || fileArgs.length) process.exit(0);

const packOrder = Object.fromEntries(packs.map((p, i) => [p.id, i]));
prompts.sort((a, b) => packOrder[a.pack] - packOrder[b.pack] || a.id.localeCompare(b.id));
for (const pk of packs) {
  if (!prompts.some((p) => p.pack === pk.id)) console.warn(`  ! pack "${pk.id}" has no prompts`);
}
const version = E.hashString(JSON.stringify(prompts.map((p) => p.id))).toString(36);
const bundle = { version, packs: packs.filter((pk) => prompts.some((p) => p.pack === pk.id)), prompts };
const body = "/* Generated by tools/build.js from data/prompts/*.json. Do not edit by hand. */\n" +
  "window.MLION_DATA = " + JSON.stringify(bundle) + ";\n";
fs.writeFileSync(OUT, body);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(body.length / 1024).toFixed(0)} KB, version ${version})`);
