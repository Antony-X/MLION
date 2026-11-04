#!/usr/bin/env node
/* Engine + data checks that don't need a browser.  node tests/engine.test.js */
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const E = require("../js/engine.js");

global.window = {};
require(path.join(__dirname, "..", "js", "data.js"));
const DATA = global.window.MLION_DATA;
let n = 0;
const ok = (msg) => { n++; if (process.env.VERBOSE) console.log("  ✓ " + msg); };

// --- normalization
assert.strictEqual(E.fullKey("Leaky-ReLU"), "leakyrelu"); ok("hyphens/case");
assert.strictEqual(E.fullKey("β-VAE"), "betavae"); ok("greek letters");
assert.strictEqual(E.fullKey("DPM++ 2M Karras"), "dpmplusplus2mkarras"); ok("plus signs");
assert.strictEqual(E.fullKey("Café"), "cafe"); ok("accents");
assert.strictEqual(E.fullKey("Bayes' theorem"), "bayestheorem"); ok("apostrophes");
assert.strictEqual(E.editDistance("relu", "rleu", 2), 1); ok("transposition = 1 edit");
assert.strictEqual(E.singular("gans"), "gan"); ok("plural");

// --- matcher layers
{
  const P = { id: "t", text: "Name a thing", strip: ["network"], answers: [
    { a: "Recurrent neural network", t: "baseline" },
    { a: "Long short-term memory", t: "indist" },
    { a: "YOLOv8", t: "outlier" },
    { a: "Mixture of experts", t: "outlier" },
    { a: "Zero-shot learning", t: "longtail" },
    { a: "Random forest", t: "baseline" },
    { a: "ReLU", t: "baseline" }, { a: "ReGLU", t: "longtail" },
    { a: "Segment Anything", t: "mlion" },
  ] };
  const m = (s) => E.matchAnswer(P, s);
  assert.strictEqual(m("RNN").answer.a, "Recurrent neural network"); ok("acronym -> long name");
  assert.strictEqual(m("lstm").answer.a, "Long short-term memory"); ok("hyphenated acronym");
  assert.strictEqual(m("moe").answer.a, "Mixture of experts"); ok("acronym keeps 'of'");
  assert.strictEqual(m("yolo 8").answer.a, "YOLOv8"); ok("v before version");
  assert.strictEqual(m("yolo version 8").answer.a, "YOLOv8"); ok("'version' dropped");
  assert.strictEqual(m("0-shot learning").answer.a, "Zero-shot learning"); ok("number words");
  assert.strictEqual(m("random forest algorithm").answer.a, "Random forest"); ok("soft filler words");
  assert.strictEqual(m("random forests").answer.a, "Random forest"); ok("plurals");
  assert.strictEqual(m("segment anything model").kind, "exact"); ok("filler 'model'");
  const top = (r) => r.answer || (r.suggestions && r.suggestions[0]);
  assert.strictEqual(top(m("reccurent nueral netwrk")).a, "Recurrent neural network"); ok("four typos still find it");
  assert.strictEqual(top(m("recurent neural network")).a, "Recurrent neural network"); ok("one typo corrects");
  assert.strictEqual(m("recurent neural network").kind, "correction"); ok("single typo is a correction");
  assert.strictEqual(m("rellu").answer.a, "ReLU"); ok("tie goes to the more common answer");
  assert.strictEqual(m("banana").kind, "none"); ok("nonsense stays a miss");
}

// --- every answer and alias matches itself, in every prompt
let names = 0;
for (const p of DATA.prompts) {
  for (const a of p.answers) {
    for (const name of [a.a].concat(a.aka || [])) {
      const m = E.matchAnswer(p, name);
      assert.ok(m.kind === "exact" && m.answer === a, `${p.id}: "${name}" should match "${a.a}" but got ${m.kind} ${m.answer && m.answer.a}`);
      names++;
    }
  }
}
ok(`${names} names self-match`);

// --- every prompt has exactly one gem and valid tiers
for (const p of DATA.prompts) {
  assert.strictEqual(p.answers.filter((a) => a.t === "mlion").length, 1, p.id + " gem count");
  assert.ok(p.answers.every((a) => E.TIERS[a.t]), p.id + " tiers");
}
ok("one gem per prompt");

// --- scheduling: a year of dailies, 7 distinct prompts each, balanced use
const uses = new Map(DATA.prompts.map((p) => [p.id, 0]));
for (let d = 1; d <= 365; d++) {
  const ids = E.dailyPromptIds(DATA, d);
  assert.strictEqual(ids.length, Math.min(7, DATA.prompts.length), `day ${d} length`);
  assert.strictEqual(new Set(ids).size, ids.length, `day ${d} has repeats`);
  ids.forEach((id) => uses.set(id, uses.get(id) + 1));
}
const counts = [...uses.values()];
if (DATA.prompts.length >= 14) assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, "dailies should spread prompts evenly");
ok("365 dailies valid & balanced");
assert.deepStrictEqual(E.dailyPromptIds(DATA, 42), E.dailyPromptIds(DATA, 42)); ok("deterministic");

// --- dates
assert.strictEqual(E.dayNumberFor(E.EPOCH), 1); ok("epoch is day 1");
assert.strictEqual(E.dateForDay(E.dayNumberFor("2027-03-14")), "2027-03-14"); ok("day <-> date roundtrip");

// --- scoring bands
assert.strictEqual(E.bandFor(0).name, "Underfit");
assert.strictEqual(E.bandFor(150).name, "Underfit");
assert.strictEqual(E.bandFor(151).name, "Converging");
assert.strictEqual(E.bandFor(449).name, "State of the Art");
assert.strictEqual(E.bandFor(450).name, "One in a MLion");
ok("score bands");

const src = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
console.log(`engine tests passed (${n} checks · ${DATA.prompts.length} prompts · ${(src.length / 1024).toFixed(0)} KB data)`);
