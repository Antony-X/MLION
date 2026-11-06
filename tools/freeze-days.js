#!/usr/bin/env node
/* Freeze the dailies' days: node tools/freeze-days.js [--days 120]
 *
 * Every date's daily and Daily Quiz is fixed in data/daily.json, so an update never changes a day
 * (user, 2026-11-06: "make sure they are set default for each day"; adding prompts used to reshuffle them).
 *   - `launch` and `quiz` are the hand-picked days that open the schedule (days 1-7 and 1-21);
 *   - `later` and `quizLater` carry on from them, dealt here once and then left alone.
 * This script only ever APPENDS days until each schedule is --days long. It never rewrites a day that is
 * already there, so a day people have played stays what it was. Edit a future day by hand if you like.
 *
 * How a new day is dealt: every pool prompt (or bank question of a level) comes up once before any comes up
 * again, and nothing repeats within RECENT days. A Daily Quiz day has two easy, two medium and three hard
 * questions, in that order (E.QUIZ_PATTERN). The deal is seeded by the day number, so a rerun appends the same days. */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "js/engine.js"));
global.window = {}; require(path.join(ROOT, "js/data.js"));
const D = window.MLION_DATA;

const FILE = path.join(ROOT, "data", "daily.json");
const RECENT = 5; // days before the same prompt or question may come back
const argDays = process.argv.indexOf("--days");
const TARGET = argDays > 0 ? Math.max(1, parseInt(process.argv[argDays + 1], 10) || 0) : 120;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffled(a, rng) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** One deck: hands out every id once per cycle, never one used in the last RECENT days or already today. */
function Deck(ids) {
  let left = new Set(ids);
  const recent = []; // the ids of the last few days, newest last
  const blocked = (id, today) => today.has(id) || recent.some((d) => d.has(id));
  return {
    /** Record a day that is already in the file (replayed so new days carry on its cycle). */
    seen(dayIds) {
      for (const id of dayIds) { left.delete(id); if (!left.size) left = new Set(ids); }
      recent.push(new Set(dayIds)); if (recent.length > RECENT) recent.shift();
    },
    take(n, today, rng) {
      const out = [];
      for (let pass = 0; pass < 3 && out.length < n; pass++) {
        for (const id of shuffled([...left], rng)) {
          if (out.length >= n) break;
          if (!blocked(id, today) || pass === 2) { out.push(id); today.add(id); left.delete(id); }
        }
        if (out.length < n) left = new Set([...ids].filter((id) => !today.has(id))); // a new cycle
      }
      return out;
    },
    close(dayIds) { recent.push(new Set(dayIds)); if (recent.length > RECENT) recent.shift(); },
  };
}

const daily = JSON.parse(fs.readFileSync(FILE, "utf8"));
const core = new Set(D.prompts.filter((p) => !p.extra).map((p) => p.id));
const pool = daily.pool.filter((id) => core.has(id));
const bank = E.quizBank(D);
const levelOf = new Map(bank.map((r) => [r.id, r.lvl || "medium"]));

// ---- the daily: launch week, then `later`
daily.later = daily.later || [];
{
  const deck = Deck(pool);
  for (const day of daily.launch.concat(daily.later)) deck.seen(day);
  let n = daily.launch.length + daily.later.length;
  while (n < TARGET) {
    n++;
    const today = new Set(), ids = deck.take(E.ROUNDS, today, mulberry32(hashString(`daily-day:${n}`)));
    deck.close(ids);
    daily.later.push(ids);
  }
}

// ---- the Daily Quiz: hand-picked days, then `quizLater`, one deck per level
daily.quizLater = daily.quizLater || [];
{
  const decks = {};
  for (const lvl of new Set(levelOf.values())) decks[lvl] = Deck(bank.filter((r) => (r.lvl || "medium") === lvl).map((r) => r.id));
  for (const day of daily.quiz.concat(daily.quizLater)) for (const lvl of Object.keys(decks)) decks[lvl].seen(day.filter((id) => levelOf.get(id) === lvl));
  let n = daily.quiz.length + daily.quizLater.length;
  while (n < TARGET) {
    n++;
    const rng = mulberry32(hashString(`dquiz-day:${n}`)), today = new Set(), got = {};
    const slots = E.QUIZ_PATTERN.slice(0, E.QUIZ_ROUNDS).map((l) => (decks[l] ? l : "medium"));
    for (const lvl of new Set(slots)) got[lvl] = decks[lvl].take(slots.filter((l) => l === lvl).length, today, rng);
    for (const lvl of Object.keys(decks)) decks[lvl].close(got[lvl] || []);
    daily.quizLater.push(slots.map((l) => got[l].shift()));
  }
}

// one day per line, so a day is easy to find and edit by hand
const line = (ids) => "[" + ids.map((id) => JSON.stringify(id)).join(", ") + "]";
const block = (days) => "[\n    " + days.map(line).join(",\n    ") + "\n  ]";
const out = ["{"];
const keys = Object.keys(daily);
keys.forEach((k, i) => {
  const v = daily[k], end = i === keys.length - 1 ? "" : ",";
  if (k === "pool") { // wrapped at about 110 characters, like the rest of the file
    const rows = [[]];
    for (const id of v.map((x) => JSON.stringify(x))) {
      const r = rows[rows.length - 1];
      if (r.length && (r.join(", ") + ", " + id).length > 106) rows.push([id]); else r.push(id);
    }
    out.push(`  "pool": [\n    ${rows.map((r) => r.join(", ")).join(",\n    ")}\n  ]${end}`);
  }
  else if (Array.isArray(v) && v.every(Array.isArray)) out.push(`  ${JSON.stringify(k)}: ${block(v)}${end}`);
  else out.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${end}`);
});
out.push("}");
fs.writeFileSync(FILE, out.join("\n") + "\n");
console.log(`daily: ${daily.launch.length + daily.later.length} days frozen (${daily.later.length} after the launch week); ` +
  `Daily Quiz: ${daily.quiz.length + daily.quizLater.length} days (${daily.quizLater.length} after the hand-picked ones)`);
