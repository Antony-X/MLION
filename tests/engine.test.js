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
  assert.strictEqual(m("forest random").kind, "correction"); assert.strictEqual(m("forest random").answer.a, "Random forest"); ok("word order: a reversed name is a correction");
  assert.strictEqual(m("anything segment").answer.a, "Segment Anything"); ok("word order: any multi-word answer");
}
{ // close typos of two answers: the initials pick one (GA, SVM)
  const P = (id) => DATA.prompts.find((p) => p.id === id);
  const g = E.matchAnswer(P("feature-selection"), "Geetic algorithm"), s = E.matchAnswer(P("classifier"), "suport vector machine");
  assert.strictEqual(g.kind, "correction"); assert.strictEqual(g.answer.a, "Genetic algorithm"); ok("'Geetic algorithm' is Genetic algorithm, not Memetic");
  assert.strictEqual(s.kind, "correction"); assert.strictEqual(s.answer.a, "SVM"); ok("'suport vector machine' is SVM, not Import vector machine");
}

// --- a miss that answers another prompt says which
E.setLexicon(DATA.prompts.concat(DATA.extras || []));
assert.ok(E.whereElse("ReLU", "optimizer").includes("activation-function")); ok("whereElse: ReLU answers the activation prompt");
assert.deepStrictEqual(E.whereElse("definitely not an answer", "optimizer"), []); ok("whereElse: nonsense belongs nowhere");

// --- every answer and alias matches itself, in every prompt
let names = 0;
for (const p of DATA.prompts.concat(DATA.extras || [])) {
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
{ // flat dealing: every prompt equally often, and runs are not forced to one prompt per pack
  const flatUses = new Map(DATA.prompts.map((p) => [p.id, 0]));
  let doublePack = 0;
  const runs = Math.ceil((DATA.prompts.length * 4) / 7);
  for (let r = 1; r <= runs; r++) {
    const ids = E.runFor(DATA, "flat-test", r, null, true);
    assert.strictEqual(new Set(ids).size, ids.length, `flat run ${r} has repeats`);
    ids.forEach((id) => flatUses.set(id, flatUses.get(id) + 1));
    const packsIn = ids.map((id) => DATA.prompts.find((p) => p.id === id).pack);
    if (new Set(packsIn).size < packsIn.length) doublePack++;
  }
  const fc = [...flatUses.values()];
  if (DATA.prompts.length >= 14) {
    assert.ok(Math.max(...fc) - Math.min(...fc) <= 2, "flat dealing spreads prompts evenly");
    assert.ok(doublePack > 0, "flat runs can hold two prompts from one pack");
  }
  assert.deepStrictEqual(E.runFor(DATA, "flat-test", 3, null, true), E.runFor(DATA, "flat-test", 3, null, true));
  ok("flat dealing: even use, no one-per-pack rule, deterministic");
}
assert.deepStrictEqual(E.dailyPromptIds(DATA, 42), E.dailyPromptIds(DATA, 42)); ok("deterministic");

// --- quiz: multiple choice built from the same data
{
  const byId = new Map(DATA.prompts.map((p) => [p.id, p]));
  const accepted = (prompt, name) => ["exact", "correction"].includes(E.matchAnswer(prompt, name).kind);
  /** The invariants every question must keep, whatever the data. */
  function checkQuestion(q, data, label) {
    const prompts = new Map(data.prompts.map((p) => [p.id, p]));
    const p = prompts.get(q.promptId);
    assert.ok(p && !p.offtopic, `${label}: question prompt is on topic`);
    assert.strictEqual(q.options.length, 4, `${label}: four options`);
    assert.strictEqual(q.from.length, 4, `${label}: a source prompt per option`);
    assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4, `${label}: correct index`);
    assert.strictEqual(new Set(q.options.map(E.fullKey)).size, 4, `${label}: no two options share a key`);
    // the right option is a familiar answer of the question's own prompt
    const right = p.answers.find((a) => a.a === q.options[q.correct]);
    assert.ok(right && E.QUIZ_TIERS.includes(right.t), `${label}: right option is a baseline/overfit/indist/outlier answer`);
    assert.strictEqual(q.from[q.correct], q.promptId, `${label}: right option comes from the question's prompt`);
    // exactly one option is accepted by the question's matcher: the right one
    q.options.forEach((o, i) => {
      if (i === q.correct) return assert.ok(accepted(p, o), `${label}: right option is accepted`);
      const src = prompts.get(q.from[i]);
      assert.ok(src && !src.offtopic && src.id !== p.id, `${label}: distractor ${i} comes from another on-topic prompt`);
      const a = src.answers.find((x) => x.a === o);
      assert.ok(a, `${label}: distractor "${o}" is an answer of ${src.id}`);
      for (const name of [a.a].concat(a.aka || [])) {
        assert.strictEqual(E.matchAnswer(p, name).kind, "none", `${label}: distractor name "${name}" must not match ${p.id}`);
      }
    });
  }

  // deterministic, and the seed matters
  const a1 = E.quizFor(DATA, "seed-a", 7), a2 = E.quizFor(DATA, "seed-a", 7), b1 = E.quizFor(DATA, "seed-b", 7);
  assert.deepStrictEqual(a1, a2); ok("quiz: same seed, same questions");
  assert.notDeepStrictEqual(a1, b1); ok("quiz: another seed, other questions");
  assert.strictEqual(a1.length, 7); assert.strictEqual(new Set(a1.map((q) => q.promptId)).size, 7); ok("quiz: seven questions from seven prompts");
  const promptQs = (qs) => qs.filter((q) => !q.reasoning).map((q) => q.promptId);
  assert.deepStrictEqual(promptQs(E.quizFor(DATA, "seed-a", 25)).slice(0, promptQs(a1).length), promptQs(a1)); ok("quiz: a longer run starts with the shorter one's prompts");
  assert.deepStrictEqual(E.quizQuestion(DATA, "seed-a", a1[3].promptId), a1[3]); ok("quiz: one question is rebuilt on its own (live skips rely on it)");

  // every on-topic prompt can make a question, across many seeds; each keeps every invariant
  let built = 0, positions = [0, 0, 0, 0];
  const t0 = Date.now();
  for (const p of DATA.prompts) {
    for (let s = 0; s < 6; s++) {
      const q = E.quizQuestion(DATA, `all-${s}`, p.id);
      assert.ok(q, `${p.id} seed ${s} should make a question`);
      checkQuestion(q, DATA, `${p.id}/${s}`);
      positions[q.correct]++; built++;
    }
  }
  ok(`quiz: ${built} questions over every prompt: one right option, three options the matcher turns down (${Date.now() - t0} ms)`);
  assert.ok(Math.min(...positions) > built * 0.18, "right option position is spread " + positions); ok("quiz: the right option lands in every slot " + positions.join("/"));
  // distractors are drawn from the question's own pack, from three different prompts
  let samePack = 0, distinct = 0;
  let promptCount = 0;
  for (const q of a1.concat(E.quizFor(DATA, "seed-c", 25)).filter((x) => !x.reasoning)) {
    promptCount++;
    const p = byId.get(q.promptId);
    const ds = q.from.filter((_, i) => i !== q.correct);
    samePack += ds.every((id) => byId.get(id).pack === p.pack) ? 1 : 0;
    distinct += new Set(ds).size === 3 ? 1 : 0;
  }
  assert.strictEqual(samePack, promptCount); assert.strictEqual(distinct, promptCount); ok("quiz: distractors come from three other prompts of the same pack");
  // reasoning questions: two of every seven, never side by side, rebuilt exactly from the dealt ids
  {
    const R = DATA.reasoning || [];
    assert.ok(R.length >= 40, "the bundle carries the reasoning questions");
    for (const r of R) {
      const q = E.quizQuestion(DATA, "any", r.id);
      assert.ok(q.reasoning && q.options.join("|") === r.options.join("|") && q.correct === r.answer, `${r.id} keeps its options and answer`);
    }
    for (let s = 0; s < 30; s++) {
      const qs = E.quizFor(DATA, `mix-${s}`, 7);
      const at = qs.map((q, i) => (q.reasoning ? i : -1)).filter((i) => i >= 0);
      assert.strictEqual(qs.length, 7); assert.strictEqual(at.length, 2, "two reasoning questions in seven");
      assert.ok(at[1] - at[0] > 1, "reasoning questions side by side");
      const again = E.quizFor(DATA, `mix-${s}`, 7, { promptIds: qs.map((q) => q.promptId) });
      assert.deepStrictEqual(again, qs, "a live guest rebuilds the host's questions exactly");
    }
    assert.strictEqual(E.quizFor(DATA, "five", 5).filter((q) => q.reasoning).length, 1);
    assert.strictEqual(E.quizFor(DATA, "one", 1).filter((q) => q.reasoning).length, 0);
    const seen = new Set();
    const runs = Math.floor(R.length / 2);
    for (let n = 1; n <= runs; n++) for (const q of E.quizRun(DATA, n).filter((x) => x.reasoning)) {
      assert.ok(!seen.has(q.promptId), `solo run ${n} repeats a reasoning question before the bank is used up`);
      seen.add(q.promptId);
    }
    assert.strictEqual(seen.size, runs * 2);
    ok(`quiz: reasoning questions (${R.length}): 2 of 7, apart, rebuilt exactly, solo runs use the bank before repeating`);
  }

  // off-topic prompts never appear: not as the question, not as a source
  const extraIds = new Set((DATA.extras || []).map((p) => p.id));
  assert.ok(extraIds.size > 0, "the bundle ships off-topic extras");
  for (let s = 0; s < 40; s++) for (const q of E.quizFor(DATA, `off-${s}`, 10)) {
    assert.ok(!extraIds.has(q.promptId) && q.from.every((id) => !extraIds.has(id)), "an off-topic prompt reached a quiz");
  }
  const copy = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === "_index" ? undefined : v))); // the matcher's cached index is a Map
  const flagged = { ...copy(byId.get("activation-function")), id: "off-topic-copy", offtopic: true };
  const withFlag = { ...DATA, prompts: DATA.prompts.concat([flagged]), version: "flagged" };
  assert.strictEqual(E.quizQuestion(withFlag, "x", "off-topic-copy"), null);
  for (let s = 0; s < 40; s++) for (const q of E.quizFor(withFlag, `flag-${s}`, 10, { promptIds: ["off-topic-copy"] })) {
    assert.ok(q.promptId !== "off-topic-copy" && !q.from.includes("off-topic-copy"), "a prompt flagged offtopic reached a quiz");
  }
  ok("quiz: off-topic prompts are excluded (extras and flagged prompts)");

  // a solo run: seven questions; later runs don't repeat earlier ones until the deck is used up
  const r1 = E.quizRun(DATA, 1), r2 = E.quizRun(DATA, 2);
  assert.strictEqual(r1.length, 7); assert.deepStrictEqual(E.quizRun(DATA, 1), r1);
  assert.ok(r1.every((q) => !r2.some((x) => x.promptId === q.promptId)), "runs 1 and 2 share a prompt");
  ok("quiz: solo runs are seven questions each and don't repeat a prompt run to run");

  // small bundles: the same pack lacks candidates, so the search widens to other packs
  const pick = (ids, packOf) => ids.map((id) => ({ ...byId.get(id), pack: packOf(id) }));
  const packsOf = (ids) => [...new Set(ids)].map((id) => ({ id, name: id }));
  const small = ["activation-function", "loss-function", "optimizer", "classifier", "clustering", "llm", "dim-reduction", "cnn-architecture", "tokenizer"].filter((id) => byId.has(id));
  assert.ok(small.length >= 6, "fixture prompts exist: " + small);
  const solo = { packs: packsOf(small), prompts: pick(small, (id) => id), version: "solo-packs" }; // one prompt per pack
  const qs = E.quizFor(solo, "tiny", 7);
  assert.strictEqual(qs.length, 7); qs.forEach((q, i) => checkQuestion(q, solo, `solo-pack/${i}`));
  const trace = {}; E.quizQuestion(solo, "tiny", small[0], trace);
  assert.ok(trace.slots.every((s) => s.stage === 1), "with one prompt per pack every distractor comes from another pack");
  const nine = { packs: [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "c", name: "c" }], prompts: pick(small.slice(0, 9), (id) => "abc"[small.indexOf(id) % 3]), version: "nine" };
  const q9 = E.quizFor(nine, "nine", 7); assert.strictEqual(q9.length, Math.min(7, nine.prompts.length)); q9.forEach((q, i) => checkQuestion(q, nine, `nine/${i}`));
  assert.ok(E.quizFor({ packs: nine.packs, prompts: nine.prompts.slice(0, 2), version: "two" }, "two", 7).length <= 2);
  assert.deepStrictEqual(E.quizFor({ packs: nine.packs, prompts: nine.prompts.slice(0, 1), version: "one" }, "one", 7), []);
  ok(`quiz: bundles of ${small.length} prompts (one per pack), 9 prompts in 3 packs, 2 and 1 prompts all cope`);

  // a bundle whose prompts all share one answer list has no fair wrong option: no question, no hang
  const base = byId.get("activation-function");
  const clones = { packs: [{ id: "blocks", name: "b" }], prompts: [0, 1, 2].map((j) => ({ ...copy(base), id: `clone-${j}`, pack: "blocks" })), version: "clones" };
  assert.deepStrictEqual(E.quizFor(clones, "c", 7), []); ok("quiz: identical prompts can't make a question (matcher turns every candidate in) and nothing hangs");

  // the share text keeps the usual shape with a quiz grid
  const sh = E.shareText({ mode: "quiz", number: 3, score: 500, tiers: ["indist", "miss", "indist", "indist", "indist", "indist", "miss"] });
  assert.strictEqual(sh, "MLion Quiz #3 🦁\n500/700 · loss 2.00\n\n🟩⬛🟩🟩🟩🟩⬛"); ok("quiz: share text");
}

// --- dates
assert.strictEqual(E.dayNumberFor(E.epoch()), 1); ok("epoch is day 1");
assert.strictEqual(E.LAUNCH, null); ok("not launched: every day is #1 until LAUNCH is set");
assert.strictEqual(E.dayNumberFor(E.localDateString()), 1); ok("today is #1 before launch");
assert.strictEqual(E.dateForDay(E.dayNumberFor("2027-03-14")), "2027-03-14"); ok("day <-> date roundtrip");

// --- scoring bands
assert.strictEqual(E.bandFor(0).name, "Underfit");
assert.strictEqual(E.bandFor(150).name, "Underfit");
assert.strictEqual(E.bandFor(151).name, "Converging");
assert.strictEqual(E.bandFor(449).name, "State of the Art");
assert.strictEqual(E.bandFor(450).name, "One in a MLion");
ok("score bands");

{ // autocorrect benchmark (tools/matchbench.js): typos land on the meant answer; other prompts' answers don't sneak in
  const out = require("child_process").execFileSync(process.execPath, [path.join(__dirname, "..", "tools", "matchbench.js")], { encoding: "utf8" });
  const num = (re) => parseFloat((out.match(re) || [])[1]);
  const right = num(/right ([\d.]+)%/), wrong = num(/WRONG answer ([\d.]+)%/), falseAcc = num(/FALSE accept ([\d.]+)%/);
  assert.ok(right >= 97 && wrong <= 1 && falseAcc <= 1, `autocorrect regressed: ${out}`);
  ok(`autocorrect: ${right}% of typos right, ${wrong}% wrong, ${falseAcc}% of other prompts' answers accepted`);
}

const src = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
console.log(`engine tests passed (${n} checks · ${DATA.prompts.length} prompts · ${(src.length / 1024).toFixed(0)} KB data)`);
