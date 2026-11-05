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

  // The generated "which one fits a prompt?" questions are the fallback when the bank runs short:
  // test them on the data without its bank. Deterministic, and the seed matters.
  const GEN = Object.assign({}, DATA, { reasoning: [] });
  const a1 = E.quizFor(GEN, "seed-a", 7), a2 = E.quizFor(GEN, "seed-a", 7), b1 = E.quizFor(GEN, "seed-b", 7);
  assert.deepStrictEqual(a1, a2); ok("quiz (generated): same seed, same questions");
  assert.notDeepStrictEqual(a1, b1); ok("quiz (generated): another seed, other questions");
  assert.strictEqual(a1.length, 7); assert.strictEqual(new Set(a1.map((q) => q.promptId)).size, 7); ok("quiz (generated): seven questions from seven prompts");
  const promptQs = (qs) => qs.map((q) => q.promptId);
  assert.deepStrictEqual(promptQs(E.quizFor(GEN, "seed-a", 25)).slice(0, 7), promptQs(a1)); ok("quiz (generated): a longer run starts with the shorter one's prompts");
  assert.deepStrictEqual(E.quizQuestion(GEN, "seed-a", a1[3].promptId), a1[3]); ok("quiz (generated): one question is rebuilt on its own (live skips rely on it)");

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
  ok(`quiz (generated): ${built} questions over every prompt: one right option, three options the matcher turns down (${Date.now() - t0} ms)`);
  assert.ok(Math.min(...positions) > built * 0.18, "right option position is spread " + positions); ok("quiz (generated): the right option lands in every slot " + positions.join("/"));
  // distractors are drawn from the question's own pack, from three different prompts
  let samePack = 0, distinct = 0;
  let promptCount = 0;
  for (const q of a1.concat(E.quizFor(GEN, "seed-c", 25))) {
    promptCount++;
    const p = byId.get(q.promptId);
    const ds = q.from.filter((_, i) => i !== q.correct);
    samePack += ds.every((id) => byId.get(id).pack === p.pack) ? 1 : 0;
    distinct += new Set(ds).size === 3 ? 1 : 0;
  }
  assert.strictEqual(samePack, promptCount); assert.strictEqual(distinct, promptCount); ok("quiz (generated): distractors come from three other prompts of the same pack");
  // The bank: every quiz question is a hand-written one; retired ones are looked up but never dealt
  {
    const R = DATA.reasoning || [], BANK = E.quizBank(DATA), live = new Set(BANK.map((r) => r.id));
    assert.ok(BANK.length >= 140 && BANK.length < R.length, "the bundle carries the bank and the retired questions");
    for (const r of R) {
      const q = E.quizQuestion(DATA, "any", r.id);
      assert.ok(q.reasoning && q.options.join("|") === r.options.join("|") && q.correct === r.answer, `${r.id} keeps its options and answer`);
    }
    const slots = [0, 0, 0, 0]; BANK.forEach((r) => slots[r.answer]++);
    assert.ok(Math.min(...slots) >= BANK.length / 4 - 2, "the right option is spread over the slots " + slots);
    for (let s = 0; s < 30; s++) {
      const qs = E.quizFor(DATA, `mix-${s}`, 7);
      assert.strictEqual(qs.length, 7); assert.ok(qs.every((q) => q.reasoning && live.has(q.promptId)), "seven live bank questions");
      assert.strictEqual(new Set(qs.map((q) => q.promptId)).size, 7);
      const again = E.quizFor(DATA, `mix-${s}`, 7, { promptIds: qs.map((q) => q.promptId) });
      assert.deepStrictEqual(again, qs, "a live guest rebuilds the host's questions exactly");
    }
    // every run goes easy, easy, medium, medium, hard, hard, hard; no question comes back before its level is used up
    const lvlOf = new Map(BANK.map((r) => [r.id, r.lvl])), per = {};
    for (const l of E.QUIZ_PATTERN) per[l] = (per[l] || 0) + 1;
    const seen = new Set();
    const runs = Math.min(...Object.keys(per).map((l) => Math.floor(BANK.filter((r) => r.lvl === l).length / per[l])));
    assert.ok(runs >= 20, `the bank holds at least 20 runs before a level repeats (${runs})`);
    for (let n = 1; n <= runs; n++) {
      const run = E.quizRun(DATA, n);
      assert.deepStrictEqual(run.map((q) => lvlOf.get(q.promptId)), E.QUIZ_PATTERN, `solo run ${n} follows the level pattern`);
      for (const q of run) {
        assert.ok(q.reasoning && live.has(q.promptId), `solo run ${n} deals a live bank question`);
        assert.ok(!seen.has(q.promptId), `solo run ${n} repeats a question before its level is used up`);
        seen.add(q.promptId);
      }
    }
    assert.strictEqual(seen.size, runs * 7);
    const vq = E.mixedDeal(DATA, "vq-abcdefghij", 7);
    assert.deepStrictEqual(vq.map((id) => lvlOf.get(id)), E.QUIZ_PATTERN, "a challenge link's deal follows the pattern too");
    assert.ok(E.dailyQuiz(DATA, 3, "dquiz-x").every((q) => q.reasoning && live.has(q.promptId)), "the daily quiz deals the bank");
    assert.deepStrictEqual(E.dailyQuiz(DATA, 3, "dquiz-x").map((q) => lvlOf.get(q.promptId)), E.QUIZ_PATTERN, "and mixes its levels the same way");
    const days = (DATA.daily && DATA.daily.quiz) || [];
    assert.ok(days.length >= 21 && days.every((d) => JSON.stringify(d.map((id) => lvlOf.get(id))) === JSON.stringify(E.QUIZ_PATTERN)), "every hand-picked Daily Quiz day follows the pattern");
    ok(`quiz bank (${BANK.length}, ${R.length - BANK.length} retired): seven a run, rebuilt exactly, solo runs use the bank before repeating`);
  }

  // Daily Quiz speed points: 100 within 3 s, a straight line to 50 at the 35 s buzzer, the same as supabase/quiz_speed.sql
  {
    assert.strictEqual(E.quizPoints(0), 100); assert.strictEqual(E.quizPoints(30), 100); assert.strictEqual(E.quizPoints(190), 75);
    assert.strictEqual(E.quizPoints(350), 50); assert.ok(E.quizPoints(250) > 50, "25 s is not yet the buzzer"); assert.strictEqual(E.quizPoints(9999), 50); assert.strictEqual(E.quizPoints(-5), 100);
    const sql = (t) => { t = Math.min(350, Math.max(0, t)); const a = Math.max(0, 100 * t - 3000); return Math.max(50, 100 - Math.trunc((100 * a + 32000) / 64000)); };
    for (let t = 0, prev = 101; t <= 360; t++) {
      assert.strictEqual(E.quizPoints(t), sql(t), `quizPoints(${t}) matches the SQL`);
      assert.ok(E.quizPoints(t) <= prev, "never more points for a slower answer"); prev = E.quizPoints(t);
    }
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "supabase", "quiz_speed.sql"), "utf8");
    assert.ok(src.includes("greatest(50, 100 - (100 * a + 32000) / 64000)") && src.includes("least(350,") && src.includes("greatest(0, 100 * t - 3000)"), "quiz_speed.sql uses the same formula");
    assert.strictEqual(Math.round(25 * E.REASONING_CLOCK), 35, "the scale ends at the Daily Quiz clock");
    ok("daily quiz speed points: 100 within 3 s, 50 at the 35 s buzzer, the same as the database");
  }

  // off-topic prompts never appear: not as the question, not as a source
  const extraIds = new Set((DATA.extras || []).map((p) => p.id));
  assert.ok(extraIds.size > 0, "the bundle ships off-topic extras");
  for (let s = 0; s < 40; s++) for (const q of E.quizFor(GEN, `off-${s}`, 10)) {
    assert.ok(!extraIds.has(q.promptId) && q.from.every((id) => !extraIds.has(id)), "an off-topic prompt reached a quiz");
  }
  const copy = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === "_index" ? undefined : v))); // the matcher's cached index is a Map
  const flagged = { ...copy(byId.get("activation-function")), id: "off-topic-copy", offtopic: true };
  const withFlag = { ...GEN, prompts: DATA.prompts.concat([flagged]), version: "flagged" };
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

{ // live room rules: one pure function, so every page in a room scores an answer the same way
  const R = (o) => ({ hints: "off", miss: "free", speed: "off", final: false, clash: false, ...o });
  assert.strictEqual(E.liveScore(R({}), { base: 50, ms: 1000, total: 25000 }), 50, "no rules: the tier's points");
  assert.deepStrictEqual([0, 12500, 25000].map((ms) => E.speedMult(R({ speed: "2" }), ms, 25000)), [2, 1.5, 1], "speed: ×2 at once, ×1 at the buzzer");
  assert.strictEqual(E.speedMult(R({ speed: "1.5" }), 2500, 25000), 1.5, "speed steps of 0.1 (1.45 rounds up)");
  assert.strictEqual(E.liveScore(R({ speed: "1.5", hints: "half", final: true, miss: "5" }), { base: 50, ms: 0, total: 25000, misses: 2, hinted: true, last: true }), 65, "×1.5, half for the hint, ×2 final, -10");
  assert.strictEqual(E.liveScore(R({ hints: "free" }), { base: 50, hinted: true }), 50, "a free hint costs nothing");
  assert.strictEqual(E.liveScore(R({ miss: "10" }), { base: 10, misses: 3 }), 0, "penalties never go below zero");
  assert.strictEqual(E.liveScore(R({ speed: "2", final: true }), { base: 0, last: true }), 0, "a miss stays zero");
  ok("live room scoring");
}

// --- a whole-name typo must be a typo word by word too ("Adam alpha" is 2 edits from "LDA alpha")
{
  const P = { id: "tw", text: "Name a thing", answers: [{ a: "Dirichlet prior", t: "longtail", aka: ["LDA alpha"] }, { a: "Reward scale", t: "outlier" }] };
  const m = E.matchAnswer(P, "adam alpha");
  assert.ok(!(m.kind === "correction" && m.answer.a === "Dirichlet prior"), "Adam alpha is not a typo of LDA alpha");
  assert.strictEqual(E.matchAnswer(P, "LDA alpah").answer.a, "Dirichlet prior"); ok("a real typo still corrects");
  assert.strictEqual(E.matchAnswer(P, "Rwwrd scale").answer.a, "Reward scale"); ok("two slips in one longer word still correct");
  const Q = { id: "xw", text: "Name a thing", answers: [{ a: "Sparse autoencoder", t: "baseline", aka: ["SAE"] }, { a: "End-to-end SAE", t: "longtail", aka: ["e2e sparse autoencoder"] }, { a: "EfficientNet", t: "baseline" }] };
  assert.notStrictEqual(E.matchAnswer(Q, "semi sparse autoencoder").kind, "correction"); ok("an extra real word is only offered, never taken");
  assert.strictEqual(E.matchAnswer(Q, "efficientnet large").answer.a, "EfficientNet"); ok("a size word still means the answer");
  E.setLexicon(DATA.prompts.concat(DATA.extras || []));
  const seg = DATA.prompts.find((p) => p.id === "segmentation-model");
  assert.strictEqual(E.matchAnswer(seg, "DETR").kind, "none"); ok("a real term from another prompt (DETR) is not bent into DEXTR");
  assert.strictEqual(E.matchAnswer(seg, "Mask R-CNN").kind, "exact");
  E.setLexicon([]);
}

// --- leaderboard names: no swear words or slurs, without catching ordinary names
{
  const bad = ["fuck", "FuuuCK", "f u c k", "Fck", "sh1t", "a55", "Ass", "Big Dick", "n1gga", "phuck", "Bitch99", "blyat", "Сука", "хуй", "puta"];
  const good = ["antoni", "Hancock", "Dickens", "class", "Assassin", "therapist", "Niger", "Scott", "Ада", "ნინო", "Fukuda", "Huynh", "Cocktail", "Analysis", "Peacock", "Sussex", "Putin", "Titan", "Player"];
  for (const name of bad) assert.ok(!E.nameOk(name), `"${name}" should be refused`);
  for (const name of good) assert.ok(E.nameOk(name), `"${name}" should be allowed`);
  ok("leaderboard name filter");
  // ways past the first filter (pre-launch audit): look-alike letters, vowel swaps, kys, staff-like names, garbling characters
  const sneaky = ["сunt", "ｆｕｃｋ", "𝐟𝐮𝐜𝐤", "ꜰᴜᴄᴋ", "fυck", "ⓕⓤⓒⓚ", "fvck", "cvnt", "niqqa", "f@ggot", "fggot", "$hit", "sh!t", "n1gg3r", "fúck",
    "kys", "KYS", "kill yourself", "admin", "Admin", "The Admin", "adm1n", "Moderator", "MLion", "МLion", "M Lion", "MLion HQ", "Official", "support",
    "ХУЙ", "СУКА", "a‮b", "x​y", "bad\nname", "ź̂̃x"];
  for (const name of sneaky) assert.ok(!E.nameOk(name), `"${name}" should be refused`);
  const fine = ["Badminton", "Никита", "Наташа", "Серёжа", "Михаил", "Νίκος", "Łukasz", "Søren", "Jürgen", "José", "Zoë", "Kavya", "Vivek", "Ivan", "Iqbal", "Raghav", "Hugo", "Dave", "Gustav", "Nguyen", "Lukas", "Mustafa", "é"];
  for (const name of fine) assert.ok(E.nameOk(name), `"${name}" should be allowed`);
  ok("name filter: look-alikes, vowel swaps, kys, reserved names and garbling characters");
  // the database runs the same check: supabase/names_v2.sql must be what tools/names-sql.js writes now
  // (names.sql is the first version, already run on the project; v2 replaces its function)
  const gen = require(path.join(__dirname, "..", "tools", "names-sql.js"));
  assert.strictEqual(fs.readFileSync(gen.OUT, "utf8"), gen.sql, "supabase/names_v2.sql is out of date: run node tools/names-sql.js");
  for (const src of [E.NAME_PARTS_SRC, E.NAME_WORDS_SRC, E.NAME_RESERVED_SRC, E.NAME_BASE_FROM, E.NAME_FOLD_FROM, E.NAME_BAD_CHARS_SRC]) assert.ok(gen.sql.includes(src.replace(/'/g, "''")));
  assert.strictEqual([...E.NAME_BASE_FROM].length, [...E.NAME_BASE_TO].length, "base map: one letter for each");
  assert.strictEqual([...E.NAME_FOLD_FROM].length, [...E.NAME_FOLD_TO].length, "look-alike map: one letter for each");
  assert.ok([...E.NAME_BASE_FROM + E.NAME_FOLD_FROM].every((c) => c.length === 1), "maps hold single UTF-16 units, like SQL translate()");
  ok("the database name check matches the page's");
}

// --- launch day: a date in the code; the database may move it, never clear it
{
  assert.strictEqual(E.LAUNCH_DATE === null || E.isDay(E.LAUNCH_DATE), true, "LAUNCH_DATE is null or a real YYYY-MM-DD date");
  assert.strictEqual(E.LAUNCH, E.LAUNCH_DATE, "the engine starts from LAUNCH_DATE");
  E.setLaunch("2026-11-20"); assert.strictEqual(E.LAUNCH, "2026-11-20", "a valid date from the database wins");
  for (const junk of [null, undefined, "", "soon", "2026-13-01", "2026-02-30", 20261120, "2026-11-20T00:00:00Z"]) {
    E.setLaunch("2026-11-20"); E.setLaunch(junk);
    assert.strictEqual(E.LAUNCH, E.LAUNCH_DATE, `${JSON.stringify(junk)} from the database falls back to LAUNCH_DATE`);
  }
  // with a date in the code, a null from the database must not clear it (fresh engine, LAUNCH_DATE patched in)
  const src0 = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8");
  assert.ok(/\n  const LAUNCH_DATE = (null|"\d{4}-\d{2}-\d{2}");\n/.test(src0), "LAUNCH_DATE is a one-line constant");
  const src1 = src0.replace(/\n  const LAUNCH_DATE = (null|"\d{4}-\d{2}-\d{2}");\n/, '\n  const LAUNCH_DATE = "2026-11-12";\n');
  const m = { exports: {} };
  new Function("module", "exports", src1)(m, m.exports);
  const E2 = m.exports;
  assert.strictEqual(E2.LAUNCH, "2026-11-12");
  E2.setLaunch(null); assert.strictEqual(E2.LAUNCH, "2026-11-12", "a null launch day from the database keeps the coded date");
  E2.setLaunch("2026-11-13"); assert.strictEqual(E2.LAUNCH, "2026-11-13", "a valid date from the database still moves it");
  E2.setLaunch("not a date"); assert.strictEqual(E2.LAUNCH, "2026-11-12", "and junk goes back to the coded date");
  assert.strictEqual(E2.dayNumberFor("2026-11-12"), 1);
  E.setLaunch(null);
  ok("launch day: coded date, database override only with a valid date, never cleared");
}

const src = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
console.log(`engine tests passed (${n} checks · ${DATA.prompts.length} prompts · ${(src.length / 1024).toFixed(0)} KB data)`);
