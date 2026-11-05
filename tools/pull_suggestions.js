#!/usr/bin/env node
/* Pull the answer suggestions an admin approved (#admin → Suggestions; supabase/suggestions.sql) into
 * data/prompts/*.json, for the owner to review and commit. The browser can't edit the static JSON, so this is
 * the only step that changes the game's answers.
 *
 *   node tools/pull_suggestions.js                          list approved suggestions not pulled yet, and the change each makes
 *   node tools/pull_suggestions.js --apply                  write them into data/prompts/*.json
 *   node tools/pull_suggestions.js --apply --mark-pulled    ...and mark them pulled in the database, so the next run skips them
 *
 * Then: node tools/build.js && node tests/engine.test.js, and read `git diff data/prompts` before committing.
 *
 * What a suggestion becomes: if the prompt's matcher already corrects the spelling to an answer, an alias ("aka")
 * of that answer; otherwise a new answer with the tier from --tier (default outlier; judge each one by the tier
 * rule in data/AUTHORING.md and fix it in the diff). Spellings the key already accepts are skipped.
 *
 * Options:
 *   --all              include suggestions already pulled
 *   --tier=<id>        tier for new answers: baseline, overfit, indist, outlier, longtail
 *   --from=<file>      read a saved download instead of the database (no key needed)
 *   --save=<file>      save the download as JSON
 *   --data=<dir>       prompt folder (default data/prompts)
 *
 * The key: the project's secret key (Supabase → Project Settings → API keys: a secret key, or the legacy
 * service_role key). It reads RLS-protected rows, so keep it out of the repo. Give it at run time, either as an
 * environment variable MLION_SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY), or in a file: --key-file=<path>,
 * MLION_SUPABASE_KEY_FILE, or by default ~/.mlion_supabase_key. This script never prints it.
 * The project URL: MLION_SUPABASE_URL, else BOARD_CONFIG.url in js/app.js. */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const E = require("../js/engine.js");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const TIERS = ["baseline", "overfit", "indist", "outlier", "longtail"];
const TIER = opt("tier", "outlier");
if (!TIERS.includes(TIER)) die(`--tier must be one of ${TIERS.join(", ")} (the gem is chosen by hand)`);
const DATA = path.resolve(ROOT, opt("data", path.join("data", "prompts")));

function die(msg) { console.error(msg); process.exit(2); }

function projectUrl() {
  if (process.env.MLION_SUPABASE_URL) return process.env.MLION_SUPABASE_URL.replace(/\/+$/, "");
  const m = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8").match(/BOARD_CONFIG\s*=\s*\{\s*url:\s*"([^"]+)"/);
  if (!m) die("No project URL: set MLION_SUPABASE_URL.");
  return m[1];
}
function secretKey() {
  const env = process.env.MLION_SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (env && env.trim()) return env.trim();
  const file = opt("key-file", process.env.MLION_SUPABASE_KEY_FILE || path.join(os.homedir(), ".mlion_supabase_key"));
  try { const k = fs.readFileSync(file, "utf8").trim(); if (k) return k; } catch { /* fall through */ }
  die("No secret key. Set MLION_SUPABASE_SECRET_KEY, or put the key in ~/.mlion_supabase_key (or pass --key-file=<path>).");
}

async function rest(base, key, pathAndQuery, init = {}) {
  const headers = { apikey: key, "content-type": "application/json", ...(init.headers || {}) };
  if (/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key)) headers.authorization = `Bearer ${key}`; // a legacy service_role JWT; new sb_secret_ keys go in apikey only
  const r = await fetch(`${base}/rest/v1/${pathAndQuery}`, { ...init, headers });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = `${j.code || r.status}: ${j.message || j.msg || text}`; } catch { /* plain text */ }
    throw new Error(`${init.method || "GET"} ${pathAndQuery.split("?")[0]} failed (${r.status}) ${msg}`.slice(0, 400));
  }
  return text ? JSON.parse(text) : null;
}
const eq = (v) => `eq.${encodeURIComponent(v)}`;

/** Approved suggestions with their players and spellings. */
async function download(base, key) {
  const reviews = await rest(base, key, `suggestion_reviews?select=prompt_id,answer_key,status,answer,reviewed_at,pulled_at&status=eq.approved${flag("all") ? "" : "&pulled_at=is.null"}&order=reviewed_at.asc`);
  const out = [];
  for (const r of reviews) {
    const rows = await rest(base, key, `answer_suggestions?select=user_id,raw,source,created_at&prompt_id=${eq(r.prompt_id)}&answer_key=${eq(r.answer_key)}`);
    const counts = new Map();
    rows.forEach((s) => counts.set(s.raw, (counts.get(s.raw) || 0) + 1));
    out.push({ ...r, players: new Set(rows.map((s) => s.user_id)).size,
      spellings: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s).slice(0, 5) });
  }
  return out;
}

// ---- editing a prompt file in place, one line at a time, so the rest of the file keeps its layout
const ANSWER_LINE = /^(\s*)(\{\s*"a":.*\})(,?)\s*$/;
function fmtAnswer(o) {
  return "{ " + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v)}`).join(", ") + " }";
}
/** Add `alias` to answer `name`'s aka; returns the new text or null when that answer isn't on one line. */
function addAlias(text, name, alias) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ANSWER_LINE);
    if (!m) continue;
    let o;
    try { o = JSON.parse(m[2]); } catch { continue; }
    if (o.a !== name) continue;
    const next = {};
    for (const [k, v] of Object.entries(o)) { next[k] = v; if (k === "t" && !("aka" in o)) next.aka = []; }
    if (!("aka" in next)) next.aka = [];
    next.aka = next.aka.concat(alias);
    lines[i] = m[1] + fmtAnswer(next) + m[3];
    return lines.join("\n");
  }
  return null;
}
/** Append a new answer as the last entry of "answers"; null when the file doesn't end the usual way. */
function addAnswer(text, entry) {
  const lines = text.split("\n");
  let close = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^\s*\]\s*$/.test(lines[i])) { close = i; break; }
  if (close < 1) return null;
  let last = close - 1;
  while (last > 0 && !lines[last].trim()) last--;
  if (!/\}\s*$/.test(lines[last])) return null;
  const indent = ((lines[last].match(ANSWER_LINE) || [])[1]) || "    ";
  lines[last] = lines[last].replace(/\s*$/, "") + ",";
  lines.splice(last + 1, 0, indent + fmtAnswer(entry));
  return lines.join("\n");
}

/** What one approved suggestion would change: {kind: "skip"|"alias"|"new"|"error", ...}. */
function plan(prompt, item) {
  const spelling = String(item.answer || (item.spellings || [])[0] || "").trim();
  if (!spelling) return { kind: "error", why: "no spelling" };
  const m = E.matchAnswer(prompt, spelling);
  if (m.kind === "exact") return { kind: "skip", spelling, why: `already accepted as "${m.answer.a}"` };
  if (m.kind === "correction") return { kind: "alias", spelling, of: m.answer.a };
  return { kind: "new", spelling, tier: TIER, near: m.kind === "suggest" ? m.suggestions.map((a) => a.a) : [] };
}

(async () => {
  const from = opt("from", "");
  let items;
  let base = null, key = null;
  if (from) items = JSON.parse(fs.readFileSync(path.resolve(from), "utf8"));
  else {
    base = projectUrl(); key = secretKey();
    try { items = await download(base, key); } catch (e) { die(e.message); }
  }
  const save = opt("save", "");
  if (save) { fs.writeFileSync(path.resolve(save), JSON.stringify(items, null, 2) + "\n"); console.error(`saved ${items.length} to ${save}`); }
  if (!items.length) { console.log("No approved suggestions to pull."); return; }

  const apply = flag("apply"), done = [];
  const texts = new Map(); // file -> edited text, written once at the end
  for (const it of items) {
    const head = `${it.prompt_id} · "${it.answer || (it.spellings || [])[0]}" · ${it.players || "?"} player${it.players === 1 ? "" : "s"}`;
    // a prompt id from the database names a file: only the game's own id shape, never a path ("../../x")
    if (typeof it.prompt_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(it.prompt_id)) { console.log(`?  ${head}\n     not a prompt id; skipped`); continue; }
    const file = path.join(DATA, `${it.prompt_id}.json`);
    if (!fs.existsSync(file)) { console.log(`?  ${head}\n     no such prompt file`); continue; }
    const text = texts.get(file) || fs.readFileSync(file, "utf8");
    const prompt = JSON.parse(text);
    const p = plan(prompt, it);
    if (p.kind === "error") { console.log(`?  ${head}\n     ${p.why}`); continue; }
    if (p.kind === "skip") { console.log(`=  ${head}\n     ${p.why}; nothing to do`); done.push(it); continue; }
    const next = p.kind === "alias" ? addAlias(text, p.of, p.spelling) : addAnswer(text, { a: p.spelling, t: p.tier });
    const what = p.kind === "alias" ? `alias of "${p.of}"` : `new answer, tier ${p.tier}${p.near.length ? ` (close to: ${p.near.join(", ")}; maybe an alias instead?)` : ""}`;
    let ok = !!next;
    if (ok) { // the edit must parse and change exactly what it says
      try {
        const after = JSON.parse(next);
        ok = p.kind === "alias"
          ? after.answers.length === prompt.answers.length && (after.answers.find((a) => a.a === p.of).aka || []).includes(p.spelling)
          : after.answers.length === prompt.answers.length + 1 && after.answers[after.answers.length - 1].a === p.spelling;
      } catch { ok = false; }
    }
    if (!ok) { console.log(`!  ${head}\n     ${what}: couldn't place it automatically; add it by hand`); continue; }
    console.log(`${p.kind === "alias" ? "+a" : "+ "} ${head}\n     ${what}`);
    texts.set(file, next);
    done.push(it);
  }
  if (!apply) { console.log(`\nDry run. --apply writes ${texts.size} file${texts.size === 1 ? "" : "s"}.`); return; }
  for (const [file, text] of texts) fs.writeFileSync(file, text);
  console.log(`\nWrote ${texts.size} file${texts.size === 1 ? "" : "s"}. Next: node tools/build.js && node tests/engine.test.js, then review git diff data/prompts.`);
  if (flag("mark-pulled")) {
    if (!base) { console.log("--mark-pulled needs the database (not --from)."); return; }
    const now = new Date().toISOString();
    for (const it of done) {
      await rest(base, key, `suggestion_reviews?prompt_id=${eq(it.prompt_id)}&answer_key=${eq(it.answer_key)}`,
        { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ pulled_at: now }) });
    }
    console.log(`Marked ${done.length} pulled.`);
  }
})().catch((e) => die(e.message));
