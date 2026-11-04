# MLion — handoff context

This file holds everything needed to continue the project in Claude Code locally: what exists,
how it works, what was tried and failed, measured numbers, decisions, constraints and open
work. Every fact here comes from the build session. Where something was never verified, it
says so.

---

## 1. What this is

**MLion** ("one in a MLion") is a daily machine-learning word-rarity game, modelled on the
*mechanics* of the game **Krillion** (krillion.io). It deliberately does not copy Krillion's
name, art, look, tier names, mascots or copy.

The player gets prompts like "Name an activation function (e.g. ReLU)" and has 25 seconds to
type any valid answer. Rarer accepted answers score more. The visual metaphor is gradient
descent: an optimizer ball rolls down a loss landscape, the loss starts at 7.00 and falls by
points ÷ 100.

- **Repo:** https://github.com/Antony-X/MLION
- **Branch:** `claude/mlion-game`. It's the only branch on the remote and the default branch.
- **Live site (GitHub Pages, deployed from that branch's root):** https://antony-x.github.io/MLION/
  - Public room list: https://antony-x.github.io/MLION/#rooms
  - Live match: https://antony-x.github.io/MLION/#live
- **claude.ai Artifact build** (single file, solo and challenge modes only):
  https://claude.ai/artifact/5FHhFPswLs3jRjPBmMziH7. Shared "anyone with the link"; last
  published as Version 14 or later.
- **Stack:** plain HTML, CSS and JS. No framework, no build step for the site, no runtime
  dependencies. Node 22 is used only for the tools and tests; Playwright for the browser tests.

---

## 2. Krillion research (what the clone is based on)

From krillion.io's live JS bundles, its FAQ and `/api/today` (read November 4, 2026):

| Mechanic | Krillion value |
|---|---|
| Rounds per day | 7, same for everyone |
| Reset | midnight America/New_York |
| Epoch | 2026-07-16 |
| Preview before clock | `PREVIEW_MS = 3000` |
| Answer time | `ANSWER_MS = 25000` |
| Max answer length | 256 |
| Wrong answer | `"<x>": no echo. try again` (retry until time runs out) |
| On timeout | the draft is submitted; server autocorrect applies |
| Autocorrect | server returns a `correction`; the client previews it (setting `previewCorrection`) |
| Tiers (id · name · score · emoji · depth) | plankton Plankton 10 🫧 .08 · tooclever Too Clever 15 🤡 .18 · schooler Schooler 30 🐟 .36 · rare Rare 60 🦑 .60 · deepcut Deep Cut 85 🏮 .82 · krillion One in a Krillion 100 🌟 .97 |
| Miss emoji | ⬛ |
| Score bands | 0–150, 151–250, 251–350, 351–449, 450+ |
| Max day score | 700 |
| Depth | `10 × score` metres (700 → 7,000 m) |
| Share text | `Krillion #<day> 🦐\n<score>\n\n<emoji grid>` (archive uses ⟲, unlimited uses ∞) |

FAQ points that matter:
- Answer sets are aggregated from datasets and manually cleaned.
- Rarity is fixed (a familiarity database, or LLM help plus a manual pass).
- The gem is chosen for fun, not pure rarity.
- "Too Clever" means the go-to "obscure" pick.

Krillion's own themed packs reuse one engine with a re-themed world. MLion copies that
*pattern*, not the content.

Not done: the `/api/reveal` endpoint (Krillion's answer lists) was blocked by the session's
safety classifier, and was deliberately not used. All MLion answers were written fresh.

---

## 3. MLion design decisions

### Tiers (`js/engine.js` → `TIERS`)

| id | name | score | share emoji | depth | blurb |
|---|---|---|---|---|---|
| baseline | Baseline | 10 | 🐑 | .08 | The answer everyone blurts out. |
| overfit | Overfit | 15 | 🦜 | .18 | The famous "obscure" pick. Everyone memorized it. |
| indist | In-Distribution | 30 | 📊 | .36 | Solid. Right in the fat middle of the bell curve. |
| outlier | Outlier | 60 | 🦄 | .60 | Genuinely uncommon. Nice pull. |
| longtail | Long Tail | 85 | ☄️ | .82 | True obscurity. Few sample this far out. |
| mlion | One in a MLion | 100 | 🦁 | .97 | The designated gem. Global minimum. |

- Miss emoji: ⬛.
- Emoji appear **only in the copied share text**. The UI draws tier marks as glyphs in code
  (`V.glyph`), following the taste-skill's no-emoji rule.

### Score bands (`BANDS`)

| range | name |
|---|---|
| 0–150 | Underfit |
| 151–250 | Converging |
| 251–350 | Generalizing |
| 351–449 | State of the Art |
| 450+ | One in a MLion |

### Other choices

- **Timing:** same as Krillion (3 s preview, 25 s answer).
- **Epoch and reset:** `EPOCH = "2026-11-04"` is day #1. The day resets at **local** midnight,
  Wordle-style, not New York time.
- **Share text:** `MLion #N 🦁\n<score>/<max> · loss <x.xx>\n\n<grid>`.

### Prompt display

- Players see the prompt text, then ` (e.g. <example>)`, plus an optional scope line.
- Prompt `note`s are **never shown**; they're internal context only. The user complained that
  the notes leaked answers.
- The example defaults to the first `baseline` answer. Overrides live in `data/display.json`.

---

## 4. File map

```
index.html            app shell; drawer nav; Google Fonts (Archivo); scripts with ?v=<hash> cache-bust
css/style.css         all styles (taste-skill redesign: dark room, gold accent, Archivo only)
js/engine.js          tiers, normalization, matching layers, scheduling, share text (UMD; used by Node tools too)
js/data.js            GENERATED bundle: window.MLION_DATA = {version, packs, prompts, extras}
js/landscape.js       topographic backdrop, 3D ridge-line landscape scene, Descent canvas, tier glyphs, lion mark (MARK: Leo's curve + the ball)
js/app.js             everything else: routing, round state machine, results, challenge, live match, settings
data/packs.json       7 packs (id, name, emoji, tagline)
data/prompts/*.json   134 prompt files, one per prompt (schema below)
data/display.json     per-prompt example / scope / offtopic overrides
data/AUTHORING.md     authoring spec (schema, alias rules, tier calibration)
tools/build.js        validate every prompt + write js/data.js + cache-bust index.html
tools/build-single.js bundle everything into one HTML file (Artifact build)
tools/icons.js        render img/ (favicon.svg, app icons, og.png share card) from MARK; needs Playwright + network for Archivo
tools/probe.js        check candidate answers against a prompt (EXACT/CORRECT/SUGGEST/NONE)
tests/engine.test.js  normalization, matcher layers, self-match of every alias, 365-day schedule
tests/e2e.js          Playwright: full daily, autocorrect, chips, reload-timer, share, challenge flow
tests/live.e2e.js     Playwright: 3 browsers, live match + chat over the real MQTT broker
tests/live.rejoin.e2e.js  Playwright: a guest drops ~10 s mid-match and must keep their seat (--quiz: in a Quiz match, real data)
tests/quiz.e2e.js     Playwright: solo quiz (taps, keys 1-4, verdict, timeout, resume, results, stats) + #vq- challenge between two browsers
tests/live.quiz.e2e.js  Playwright: live Quiz match, two browsers over MQTT (hidden picks, reveal, skip, chat, forged answers, time tie-break)
README.md, package.json, .nojekyll (needed for Pages)
```

### npm scripts

```
npm run build      # node tools/build.js
npm run stats      # node tools/build.js --stats
npm test           # build + engine tests
npm run e2e        # node tests/e2e.js           (add --fixture to use clone data, --fonts to load Google Fonts)
npm run e2e:live   # live.e2e.js, live.rejoin.e2e.js, live.quiz.e2e.js, live.rejoin.e2e.js --quiz (needs network: unpkg.com + public.cloud.shiftr.io)
npm run e2e:quiz   # quiz.e2e.js (solo + challenge; no network)
```

### Artifact build

```
node tools/build.js
node tools/build-single.js <out.html> --fragment --url=https://claude.ai/artifact/5FHhFPswLs3jRjPBmMziH7
```

- `--fragment` omits doctype, html, head and body, because the Artifact host supplies them.
- `--url` writes a `<meta name="mlion:url">` tag, so challenge links point at the Artifact.
  Its presence also makes `liveBlocked()` true.

---

## 5. Data

### Prompt file schema (`data/prompts/<id>.json`)

```json
{ "id": "activation-function", "pack": "blocks", "text": "Name an activation function",
  "note": "internal scope notes (never shown)", "strip": ["activation","function","unit","layer","nonlinearity"],
  "answers": [ { "a": "ReLU", "t": "baseline", "aka": ["rectified linear unit"], "q": "optional quip ≤140 chars" } ] }
```

### Validator rules (`tools/build.js`)

- `id` matches the file name; `pack` is valid; `text` starts with "Name ".
- At least 25 answers; it warns under 40.
- 1–8 baseline answers, 0–3 overfit, exactly 1 mlion.
- Quips are at most 140 characters, notes at most 160.
- No duplicate canonical names, and no key collisions (full or prompt-stripped) between
  different answers.
- **An alias that normalizes to an empty string is an error.** Seven symbol aliases (`//`, `%`,
  `|`, `^`, `~`, `<<`, `>>`) were removed for this reason.
- The example must exactly match an answer, and it warns if the example isn't baseline.
- `--lenient` bundles the valid files and skips broken ones; it was used during parallel
  writing.
- After building, `index.html` asset URLs are rewritten to `?v=<content hash>`.

### `data/display.json`

- `example` and `scope` are set for about 30 prompts.
- `offtopic: true` is set for **robot, self-driving, ai-movie, fictional-ai, ai-book,
  historic-ai**. The user called "Name a real robot" stupid; they know ML, not robots. These go
  into `bundle.extras` and are excluded from the daily, Unlimited, packs and challenges. They
  appear in the Library under "Off-topic extras" for practice only.

### Current numbers (measured at handoff)

- 134 prompt files: **128 core + 6 extras**, **17,708 answers** total.
- Core prompts by pack:

  | pack | prompts |
  |---|---|
  | blocks | 19 |
  | zoo | 25 |
  | classic | 23 |
  | llm | 16 |
  | stack | 20 |
  | theory | 20 |
  | lore | 5 |

- The lore pack's core prompts: ai-conference, ai-researcher, ml-competition, ml-course,
  ml-slang.
- The three newest zoo prompts (google-model, meta-model, openai-model) came from the
  stopped "new prompts" workflow. Its other 46 planned prompts were never written (see §9).
- The last change added the answer `AICC` (aka "AI Community Contest") to `ml-competition` as
  longtail. Before that, "AICC" autocorrected to "AIxCC".

### Tier calibration rule (AUTHORING.md)

Picture 1,000 ML people, each with 25 seconds. The tier is the share who would type the
answer, judged by visibility in courses, docs, papers and social media. The gem is chosen for
delight, not maximum obscurity.

---

## 6. Matching engine (`js/engine.js`)

### Normalization: `tokens()` → `fullKey()`

- Lowercase.
- Greek letters become names (β → beta).
- NFKD; strip diacritics.
- `&` → and, `+` → plus, `*` → star, `@` → at, `x#` → "x sharp" (so C# is not C).
- Drop apostrophes and the token "version".
- Number words zero–ten become digits.
- Join the tokens, then drop `v` before a digit (YOLOv8 = yolo 8).

### Layers, in order

1. **Exact:** full key or prompt-`strip` key. Collisions here are build errors.
2. **Singular / plural:** a loose map.
3. **Soft filler:** drop model, algorithm, method, technique, framework, library, approach,
   system, tool and their plurals.
4. **Acronyms of answers**, e.g. "rnn" ↔ "recurrent neural network". The rule is length ≥ 3,
   or length 2 when both words have ≥ 3 letters. Both a stopword-dropped and a full form are
   generated.
5. **Reverse acronym:** the player types the long form of an answer listed only as initials.
   This returns a `correction`.
6. **Fuzzy scoring:** each answer is scored by its best key using:
   - **Edit distance** (optimal string alignment). Budget: length ≤ 3 → 0, ≤ 5 → 1, ≤ 9 → 2,
     else 3. Score = `1 - 0.6·d/maxlen`.
   - **Character-trigram TF-IDF cosine.** This was called the "embedding" in conversation; the
     user asked for an embedding model.
   - **Containment:** the shorter side is ≥ 4 characters and the length ratio ≥ 0.5. Score =
     `0.45 + 0.5·ratio`.
   - **Word-by-word typos** for multi-word names: same word count, each word within its own
     budget. Score = `max(0.8, 0.96 - 0.03·edits)`.

### Decision

- **Typo group:** candidates within 0.04 of the best. If there's exactly one, or the tie
  resolves to a single most-common tier with best ≥ 0.85, the result is a **correction**.
  Otherwise up to 3 tied candidates come back as a **suggest**.
- **Otherwise:** a top score ≥ 0.8 with a margin ≥ 0.08 is a **correction**. All candidates
  ≥ **0.55** become a **suggest** (at most 3).
- The suggest threshold was raised from 0.45 to 0.55 because "random forest" in the
  decision-tree prompt (where it's excluded) offered a "RainForest" chip. Raising it broke the
  4-typo test, which word-by-word matching then fixed.

### Measured examples (from `tools/probe.js`)

| input | prompt | result |
|---|---|---|
| efficent net | cnn-architecture | EfficientNet |
| lama 3 | llm | Llama 3 |
| gemni | llm | Gemini |
| suport vectr machine | classifier | SVM |
| reccurent nueral netwrk | test prompt | RNN, as top suggestion or correction |
| xelu | activation-function | chips xIELU · CELU · GELU, later xIELU · CELU · MeLU after enrichment (the e2e test now types "gel") |
| random forest | decision-tree-algo | none |
| incepshun | cnn-architecture | none (only the Claude check could catch it) |

### Scheduling

- `makeStream()` shuffles each pack per cycle (mulberry32 seeded with FNV-1a of a label), then
  deals round-robin across packs.
- Daily: `runFor(data, "daily-v1", day)`. Unlimited: `"unlimited-v1"`. Packs:
  `pack-<id>-v1`. Challenges: `makeStream(DATA, "vs-<seed>")`.
- Removing the off-topic prompts changed the daily schedule mid-day. Finished records are
  kept.

---

## 7. App features (`js/app.js`)

### Routes

Hash names are plain words, digits and hyphens; this is required by the Artifact host. Never
use `#/…`, and never `#settings`, which claude.ai reserves.

| route(s) | screen |
|---|---|
| `#home` | home |
| `#daily` | today's daily |
| `#unlimited`, `#unlimited-N` | Unlimited hub, run N |
| `#packs`, `#pack-<id>`, `#pack-<id>-N` | packs, pack detail, pack run (hidden in launch mode) |
| `#archive`, `#archive-YYYY-MM-DD` | archive, a past day |
| `#library`, `#practice-<id>`, `#answers-<id>` | library, practice one prompt, its answer key (hidden in launch mode) |
| `#results-<key-with-dashes>` | a run's results |
| `#stats`, `#how`, `#faq`, `#prefs` | stats, how to play, FAQ, settings |
| `#challenge`, `#vs-…`, `#vq-…` | challenge setup (Format: Rarity or Quiz), a rarity challenge link, a quiz challenge link |
| `#quiz`, `#quiz-N` | Quiz hub (today's quiz first, then practice runs), solo quiz run N (hidden-ahead rule below) |
| `#daily-quiz`, `#results-dquiz-YYYY-MM-DD` | today's Daily Quiz, its results |
| `#board`, `#board-YYYY-MM-DD`, `#board-quiz`, `#board-quiz-YYYY-MM-DD` | leaderboard, Daily and Quiz tabs |
| `#live`, `#live-<code>` | live match setup, a room |
| `#rooms` | public room list |

**Launch mode** (`const BROWSE = false` near the top of app.js): Packs and the Library are
hidden (home tiles, drawer links), their routes redirect home, and `#unlimited-N` beyond the
next unplayed run redirects to it (`#quiz-N` follows the same rule). This stops people choosing
questions or reading a key and replaying. It is client-side only: `js/data.js` and the public repo still contain every
answer. Real protection would need a server. `BROWSE = true` restores everything.

### Round state machine

intro → preview (3 s, input locked) → answering (default 25 s) → feedback → next.

- Time per question: presets 10/15/25/40/60 s (`TIME_PRESETS`, `answerMs()`). Set in
  Settings (`settings.answerSecs`), in challenge setup (link suffix `tNN`), and by the live
  host (`LIVE.secs`, sent in lobby/start messages). The run spec's `secs` wins over settings.
- Solo: an empty box makes the Step button read "Skip" (not primary); Skip ends the round
  with no points (`res.skipped`). Live mode has a vote-to-skip instead.
- When the match came through an alias, feedback says “raw” counts as <answer>.
- Explanations (`explainOf`) show in solo results, answer keys, the live reveal and the
  podium recap. Coverage is about 25% of answers: all gems and Overfit picks, 74% Baseline,
  9% Long Tail.

- The run is saved to `localStorage` (`mlion:run:<key>`). The timer is absolute, so reloading
  doesn't reset it.
- A wrong answer shows "no gradient. try again".
- A correction rewrites the input, and Step confirms it.
- Suggestions show as tappable chips.
- On timeout the draft is submitted: a confident correction or single strong suggestion is
  accepted, otherwise it's a miss.
- Settings: preview autocorrect, clear rejected, sound (WebAudio), reduce motion, include share
  link, Claude answer check.

### Claude answer check

- Only in the Artifact. It uses the `sample` capability: `sample.json`, `modelTier: "quick"`.
- It runs only when nothing matched. Claude may only pick a listed answer, and the player
  confirms it.
- Consent is requested on Begin via `permissions.request(["sample"])`. It uses each viewer's
  own claude.ai usage, not the owner's.
- History: the user worried it was their API, so I disabled it (Version 5). They asked for it
  back (Version 6). It's currently declared, `capabilities: {sample: {}}`, and never runs in
  live matches.

### Challenge a friend (asynchronous, no server)

- The link is `#vs-<seed>-<n>[-<tiers>-<nameHex>][-<tiers>-<nameHex>]`. Tiers are digits 0–6,
  and names are UTF-8 hex.
- Sizes: presets 3, 5, 7, 10 or any count up to 25 (`Q_PRESETS`, `Q_MAX`). Optional `tNN`
  after the count sets seconds per question (`#vs-<seed>-8t40…`).
- "Send link now" lets both players start at once; otherwise one plays first and sends.
- The friend sees the challenger's result after each answer, then a head-to-head board and
  "Send result back".
- In the Artifact, links point at the claude.ai URL. **Not verified:** that claude.ai passes
  `#vs-…` hashes through to the page. The platform docs say plain `#name` hashes pass.

### Quiz (multiple choice), added 2026-11-05

Four options, one fits. Everything is generated from the existing prompt data; no written
content and no LLM. Same shape in solo, async challenges and live rooms.

**Generator (`js/engine.js`)**
- `quizQuestion(data, seedKey, promptId)` → `{promptId, options:[4 strings], correct, from:[promptId per option]}`
  or `null`. `quizFor(data, seedKey, n, {promptIds})` → `n` questions from different prompts (the
  given ids first, then the seed's own `makeStream`; a prompt that can't make a fair question is
  passed over). `quizRun(data, N)` = solo run N: seven questions, prompts dealt by
  `runFor(data, "quiz-v1", N)` so runs don't repeat a prompt until the deck is used up. All
  deterministic in (seed, prompt id); the RNG is `mulberry32(hashString("quiz:<seed>:<id>"))`.
- Question = the prompt's own text plus "Which one fits?". The `(e.g. …)` example is not shown (it is
  a baseline answer and would give the option away); the `display.json` scope line is.
- Right option: an answer of the prompt from baseline/overfit/indist/outlier (tier picked with
  weights .25/.15/.35/.25, then an answer inside it). Longtail and the gem are never the right option.
- Three wrong options: answers of other **on-topic** prompts (`data.extras` and anything flagged
  `offtopic` are never read). Search order: another prompt of the **same pack** (a different prompt for
  each wrong option, so the right one is never the odd one out), **same tier** as the right answer; it
  widens only when a stage runs dry (other pack, then any tier, then reusing a prompt).
- A candidate is dropped if the question's own `matchAnswer` returns anything but `none` for its name or
  any alias (so no exact hit, no autocorrect, no "did you mean"), or if any of its keys (`fullKey` of the
  name or aliases) collides with an option already picked. Options are shuffled with the seed.
- Measured on the shipped 128 prompts (20 seeds each, 2,560 questions): every prompt makes a question
  every time; all 7,680 wrong options came from the same pack and the same tier, from three different
  prompts per question; the right option's tier split was indist 862 / baseline 699 / outlier 643 /
  overfit 356, and its position 643/645/618/654. About 3 ms a question. How often the matcher veto
  fires: of random same-pack candidates 94.2% are `none`, 1.4% are accepted outright (`exact`, the
  lists overlap, e.g. one name in two prompts), 2.0% autocorrect, 2.5% only "suggest".
- Limits: the answer lists are incomplete, so a wrong option can be a real member of the category that the
  key doesn't list (the matcher is the only oracle). The fixture in `tests/e2e.js` is nine clones of one
  prompt, so every candidate is vetoed and `quizFor` returns `[]`; the app then says quiz questions
  can't be made instead of breaking. `tests/engine.test.js` covers smaller bundles (one prompt per
  pack, nine prompts in three packs, two, one).

**Solo (`#quiz`, `#quiz-N`)**
- Run spec `mode: "quiz"`, `fmt: "quiz"`, key `quiz:N`; seven questions; 100 per right answer, nothing for
  a wrong answer or a timeout; no Skip. Preview 3 s (options covered and locked), then
  `answerMs()` (Settings). Four big buttons; keys 1 to 4 pick. A tap locks in at once.
- Verdict card: Correct / Not quite / Out of time, the four options again with the right one lit, your wrong
  pick marked, `explainOf(promptId, rightAnswer)` under the right option, and "That's <kind of prompt>"
  under every wrong one (the prompt text minus "Name ").
- A right answer carries the neutral tier `indist` (`QUIZ_TIER`) only so the descent and profile chart
  colour it; it means nothing about rarity. The record keeps `quiz` (the questions), `picks`
  (one digit per question, 0 none, 1 to 4), `tenths` (total answer time) and per-result `picked`, `ms`.
- Share text: `MLion Quiz #N 🦁\n<score>/700 · loss x.xx[ · N s]\n\n🟩⬛…`.
- Results reuse `renderResults` (score, descent chart, answers, answer keys) with quiz branches. Quiz and
  `vq` records are excluded from `statsSummary`, so the daily stats and tier counts stay clean.

**Async challenge (`#vq-<seed>-<n>[tNN][-<picks>-<tenths>-<nameHex>]x2`)**
- Same count presets (3/5/7/10, custom up to 25) and time pickers as `#vs-…`; `#challenge` has a
  Format row (Rarity / Quiz) that decides which link is made. Questions: `quizFor(DATA, "vq-<seed>", n)`.
- `picks` is one digit per question (0 none, 1 to 4), so each side's score is recomputed from the seed;
  `tenths` is the total answer time in tenths of a second. Winner: more points, else the lower `tenths`;
  equal on both is a draw. Same send-back flow (`#send-vs`), head-to-head board (`quizDuelBoard`), and the
  challenger sees the opponent's pick after each answer.

### Daily Quiz (added overnight 2026-11-05)

- One shared seven-question quiz a day: five prompt questions and two reasoning MCQs, on the fixed
  25 s clock (reasoning questions get 2.4x). `E.dailyQuiz(data, dayNumber)` deals the prompts like
  the daily (`runFor(data, "dquiz-v1", n)`) and the reasoning questions from their own stream
  (`"dquiz-reason-v1"`), so days don't repeat. `dquizSpec(date)` in app.js uses `asOf(CORE, date)`;
  `asOf` now also filters `reasoning` by an optional `added` date, so adding questions never
  changes a past day.
- Numbered from its own first day: `DQUIZ_FROM = "2026-11-05"` is Daily Quiz #1.
- Leaderboard: table `daily_quiz_scores` (`supabase/daily_quiz.sql`, additive: new table, trigger,
  policies only). The client posts `marks` (7 digits, 1 = right) and `tenths` (total answer time);
  the database recomputes `score = 100 x right`. Equal scores rank by time. Until the SQL is applied
  the Quiz tab says "The quiz leaderboard opens soon" (the client detects PGRST205/42P01).
- Tests: the daily-quiz block in `tests/quiz.e2e.js`; the quiz-board block in `tests/board.e2e.js`
  (mock table off, then on; tie-break by time).

### Home: the 3D descent (added overnight 2026-11-05)

- `js/hero3d.js` (raw WebGL, no libraries): a loss surface with a heavy-ball momentum path from the
  far wall to the minimum; `MLionHero.mount(canvas, {progress, onStage})`, `MLionHero.stages`.
  Draws only when progress or size changes; frees its WebGL context on destroy.
- `mountHomeHero()` in app.js puts a fixed canvas behind home; scroll drives progress piecewise so
  each of the six depth rows reaches the reading line as the ball reaches that depth; rows light
  (`.on`/`.past`). The opaque `.home-rest` scrolls over it. `route()` unmounts it. Without WebGL
  the old 2D `landscape.js` scene runs instead. `dev/hero.html` is a standalone harness.

### Installable app (added overnight 2026-11-05)

- `manifest.webmanifest` (icons from `tools/icons.js`), `sw.js`: the page network-first, our own
  files cache-first (hashed URLs), Google Fonts stale-while-revalidate, everything else (Supabase,
  MQTT) untouched. `tools/build.js` stamps the precache list into `sw.js`. Registers only on https
  (or when `mlion:sw` is set, which `tests/pwa.e2e.js` does to play the daily offline).
- The menu shows "Install the app" when the browser fires `beforeinstallprompt`.

### Live match (real time)

**Transport: MQTT over a WebSocket on port 443.**
- Broker: `wss://public.cloud.shiftr.io`, username and password `public`.
- Library: `https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js`.
- Topic root: `mlion/v2`.
  - Room: `mlion/v2/r/<code>/{up,down,to/<id>}`.
  - Public room info (retained): `mlion/v2/pub/<code>`, plus a last-will that clears it.
- It's **disabled inside the Artifact**, because claude.ai blocks WebRTC and outside
  WebSockets. There, `#live` shows an "Open live mode" link to the Pages site.

**Rooms**
- Private rooms use a random 5-character code from `abcdefghjkmnpqrstuvwxyz23456789`.
- Public rooms use fixed codes `pub01`–`pub10` and hold **2 players** (duos). Private rooms hold
  up to 8.
- The `#rooms` list comes from retained info messages. Entries older than 45 s are hidden, and
  the list redraws every 5 s.

**Host authority**
- The host page admits players, paces rounds and relays answers and typing.
- Messages carry `ep` (epoch), `hid` (host id) and `now` (host clock).

**Flow**
- Lobby shows a join banner, sound and vibration when someone joins.
- **The match starts when everyone taps Ready**, after a 3-2-1 countdown. Rematch works the
  same way.
- The host picks 5, 7 or 10 questions, **no-repeat questions** (on by default, tracked in
  `mlion:liveUsed`), and **autocorrect help: Off / Typos only / Full** (default Typos only).
  - Typos only rejects suggestion chips and corrections with confidence < 0.88.
  - Off accepts only exact answers.
- Rounds use `{t:"round", i, at: host+1500ms}`. Clients start at `at - offset`, where the
  offset is smoothed from heartbeats.
- **The next question waits until everyone has answered.** A safety cap of
  1.5 + 3 + 25 + 12 s covers a vanished player.
- After each question: a reveal with everyone's answer, tier and points, plus standings.
  REVEAL_MS = 4500. The end is a podium.

**Quiz format (live)**
- The host picks **Rarity** or **Quiz** in the lobby (`.lv-fmt`, next to count and time; saved as
  `liveFmt`; Quiz hides the autocorrect setting). It travels in the `lobby` message (`fmt`) and the
  `start` message; guests read it in the settings note ("Quiz format, pick one of four." or "… Rarity
  format."). `LIVE.fmt` is the lobby's choice; `LIVE.mfmt` and `LIVE.quiz` are the running match's.
- The host fixes which prompts get a question (`quizFor` over the no-repeat list, honouring `liveUsed`) and
  sends `ids`; every page then calls `quizFor(DATA, seed, n, {promptIds: ids})`, so all four options and
  their order agree without being sent. `RUN.quiz` and `LIVE.quiz` are the same array.
- Answer message `{t:"ans", i, pid, pick, ms}`: `pick` is 0 to 3, or -1 for none. The host drops it unless
  `pick` is an integer -1..3 for a question it holds (and `pid` is still the question), clamps `ms` to
  `[0, clock]`, then broadcasts `{t:"ans", id, i, pick, ms}`. Every page recomputes right/wrong and the
  100 points from its own copy of the question. `ms` is measured by each client from the end of the 3 s
  preview (host-measured time would charge guests their network delay), so it is self-reported but
  clamped; the public broker means a forged client can still lie inside the clock.
- Reveal rules match the typed format: before you answer, a rival shows "Locked in ✓" only; once you have
  answered you see which option they picked. **The verdict (right/wrong, points, ball, dots, strip totals)
  waits for the reveal for everyone**, so nobody learns the right option from their own result and tells
  the room. The reveal (`renderQuizReveal`) lists the four options with the right one lit, who picked
  each, "That's <kind>" under wrong ones, the explanation under the right one, and the standings; the
  ball and score move then (`liveQuizSettle`).
- Points 100 per right answer. Ranking (`rankCmp`) is points, then the lower total answer time (a question
  nobody answered counts as the whole clock); a podium level on both is "It's a tie". The podium shows each
  player's right/wrong marks and total time, and the recap names the right answer of every question.
- Vote-to-skip: the host picks the replacement only from prompts that can make a question
  (`quizQuestion(DATA, seed, id)`), clients rebuild it from `{t:"skip", i, id}`. Chat, no-repeat, takeover
  and rejoin use the same code as the typed format. Chat's spoiler hold still blocks a message naming any
  answer of the open prompt (broader than needed for a quiz, but safe).
- A rematch uses the lobby's last format; the host can't change format or count from the podium (the same
  limit the typed format has).

**Rival panel**
- Before you answer: opponent typing shows as dots, with a count of wrong guesses. A locked
  answer shows only "Locked in ✓", and their round points are hidden from the strip.
- After you answer (user request, 2026-11-04): you see their draft and their bounced guesses
  (struck through) in the clear. Someone still thinking keeps seeing dots.

**Chat** (added 2026-11-04)
- A chat button (`#chat-btn`) in the top bar, visible only while `LIVE.active` (lobby, match,
  podium, waiting for the next match). The panel (`#chat`) and preview (`#chat-peek`) live
  outside `#app`, so screen redraws never eat a draft.
- Guests send `{t:"chat", text, k}` up; the host checks the sender, rate-limits (6 per 8 s per
  player) and broadcasts `{t:"chat", id, name, text, k}`. The sender shows its own message dimmed
  until the echo with the same `k` returns; after 10 s without it, "Not sent".
- Unread count and a 5 s preview when the panel is shut; a soft sound (Sound setting).
- The panel folds away when a question starts unless you're mid-message, and the answer box
  never takes focus from the chat input. Enter and Escape in the chat stay in the chat.
- Spoiler hold: while a question is open, a message whose 1–5-word windows exactly match an
  answer of the current prompt (keys of 3+ chars) is not sent ("Send it after the reveal").
- Text is cleaned (control and bidi characters, 200 chars) and always escaped. History is kept
  in memory per room code for 10 minutes after you step out.

**Resilience**
- Host heartbeat every 3 s.
- A guest is marked away after 9 s of silence, and their seat is freed after a further 15 s
  (`AWAY_GRACE_MS`).
- A guest takes over hosting after 11 s with no host. The new host keeps the old host's seat
  (away).
- An old host that sees a higher epoch demotes itself and rejoins with the **same id**, so it
  keeps its answers.
- A rejoining player gets a `resume` message and re-enters the match.
- Only an explicit **Leave** sends `{t:"closed"}`. Navigation doesn't.
- The join screen shows every step and retry, with 2 minutes of patience.

---

**Later additions (2026-11-04/05):** in-room chat (spoiler filter holds messages naming an
answer until the reveal; rate limits 5/8 s client, 6/8 s host); rivals' drafts and wrong
guesses shown in clear once you've answered; host-chosen question count (3–25) and time per
question; **vote to skip** (`hostSkipVote`/`hostSkip`): a majority of present players
(`floor(n/2)+1`) replaces the question with a fresh one (no-repeat honoured), points for
it are dropped, answers carry `pid` so late answers to the old prompt are ignored.

### Core and extra questions

- The audience is the IOAI community, so the owner split the set on 2026-11-05: **84 core**
  prompts (inside the IOAI syllabus) and **50 extra** ones: 44 marked `extra: true` in
  data/display.json (tools, products, datasets, frameworks, off-syllabus methods) plus the 6
  `offtopic` pop-culture prompts.
- The build keeps `extra` prompts in `DATA.prompts` with `p.extra = true`, so the streams that
  dealt past dailies don't change. The app builds two views: `CORE` (no extras) and `WIDE`
  (everything, off-topic included).
- The daily, archive days from `CORE_DAILY_FROM` (2026-11-06) on, challenges (`#vs`, `#vq`) and
  live rooms always deal from `CORE`, so everyone shares the same questions. Dailies before that
  date keep their old stream (`daily-v1` over the full list); new ones use `daily-v3` over core, dealt flat (see below).
- Settings → **Extra questions** (`settings.extraQuestions`, off by default) puts `WIDE` behind a
  player's own Unlimited and Quiz runs.
- review.html (unlisted) shows which prompts are extra and lets the owner mark moves either way.
- Test: `node tests/extras.e2e.js` (real data; clock set to before and after the switch-over).

### Daily leaderboard (Supabase)

- Supabase project **MLion** (ref `ozqnznvxxxnefeetidwq`, in the user's org). The URL and
  publishable key are in `BOARD_CONFIG` in js/app.js (public by design; RLS protects the data).
  Schema, rules and grants: `supabase/schema.sql` (already applied; safe to re-run).
- Opt-in: only players who log in appear. Login is OAuth with PKCE via supabase-js (UMD from
  jsdelivr, loaded only for people who have logged in or are coming back from login). Buttons
  show only for providers switched on in the dashboard (read from `/auth/v1/settings`). Discord
  is on. Google needs an OAuth client from Google Cloud Console (not done yet).
- Auth URL config: site URL https://antony-x.github.io/MLION/; the redirect allowlist also has
  localhost:8000 and 127.0.0.1:8000. A new host (custom domain, Cloudflare Pages) must be added.
- The database recomputes the score from the 7 tier digits, keeps one row per account per day,
  only for today ±1 UTC day, with no edits or deletes. Checked with role-switching SQL tests.
  Answers still ship in js/data.js, so someone reading the data can post a top score; the real
  fix is answer checking on a server.
- The daily always runs at 25 s (`dailySpec` sets `secs`) so scores compare.
- Routes `#board` and `#board-YYYY-MM-DD`. Today's daily results show a post/rank box.
- Test: `node tests/board.e2e.js` runs against a stand-in project (route-mocked), including the
  PKCE round trip. A real Discord login has to be done by a person.

## 8. Visual design (taste-skill redesign)

The user asked to ingest https://github.com/leonxlnx/taste-skill (`skills/taste-skill/SKILL.md`
plus its references) and redesign the site minimally, with almost no text and deep visuals.

**Chosen from the skill's library data:**
- Direction `dark-room`, app style `true-black-flat`.
- Palette `warm-black-gold`, adapted:
  - Ground `#0b0a08`, tone steps `#161411`, `#211e1a`, `#2c2823`.
  - Ink `#f2ede4`, muted `#a39b90`, gold `#f2b53c`, negative `#f0705c`.
  - Tier ramp from grey to gold.
- Type: Archivo only. The width axis sets the name at 125%. Type scale tokens: `--s1` 14,
  `--s2` 17, `--s3` 24, `--s4` `clamp(28px, 1.6vw+18px, 42px)`, `--s5` `clamp(84px, 13vw, 220px)`.

**The idea:** the optimizer's descent becomes the dark room's one lit exhibit. A gem turns the
stage gold and grows the lion's curve (the sign of Leo) out of the ball.

**House rules applied:** no monospace, no kickers or eyebrows, no 01/02 numbering, no hairline
boxes, no gradients, no glows or resting shadows, no blur, no emoji in the UI, buttons fully
rounded.

**History:**
- The redesign agent self-scored round 3: design 8, usability 8, creativity 8.5, content 7.5,
  overall 8.0.
- I later enlarged the desktop play stage (`clamp(320px, 56vh, 640px)` at ≥ 1000 px) and made
  `--s4` bigger.
- Remaining critique: the results chart looks like a hard dark slab on phones, and the
  home-screen ball sits close under the wordmark on desktop.
- **Failed:** the skill's own scripts (`draw.mjs`, `inspect.mjs`, `lint.mjs`) were refused by
  the session's safety classifier. Its rules were applied by hand, and Playwright screenshots
  stood in for its inspector.
- An earlier design agent used a different direction (Unbounded, IBM Plex Mono, tracked caps,
  glows). It was stopped, and its partial patch was discarded.

---

## 9. History, failed approaches and lessons

### Content creation

- **Round 1:** 10 Opus agents wrote 131 prompts from knowledge, plus the reference
  `activation-function.json`. Each agent used about 260–380K tokens.
- **Research workflows:** 49 new prompts and per-prompt enrichment of 111 + 20 prompts, all on
  Opus at extra-high effort. **Stopped at the user's request over cost.** About $130 had been
  spent by then (session `cost_usd` 129.66). The container has 4 CPUs, so only about 2 workflow
  agents ran at once.
  - Kept: 3 new prompts and partial enrichments (activation 71 → 158, causal-inference
    91 → 197).
- **Replacement:** 9 Sonnet agents, about 6 prompts each, used about 97–210K tokens each. They
  added the scikit-learn, PyTorch, Keras, Optax, NumPy and JAX names and 2025–26 models. Most
  worked from memory with few web fetches.
  - The 2026 LLM names (Claude 5, GPT-6, Gemini 3.5 and others) came from Wikipedia's list, as
    reported by that agent. **They haven't been independently verified.**
- The user's bug report "extratreeclassifier didn't work" is fixed: it's now an exact match in
  classifier and decision-tree-algo.

### Live multiplayer evolution

1. claude.ai `room` capability: not usable, because public-link and signed-out viewers aren't
   admitted.
2. PeerJS 1.5.4 with WebRTC and the PeerJS cloud handshake: worked in tests, then **failed for
   real users**.
   - When the host switched apps, the room dropped; fixed with `peer.reconnect`.
   - The friend on **4G stalled at "Connecting…"** forever (carrier NAT blocking WebRTC, with an
     unreliable PeerJS TURN relay).
   - Adding TURN over TCP didn't solve it.
3. **MQTT relay on port 443 (current)**, which works across networks.
   - From the container, the brokers on ports 8084, 8884 and 8081 were unreachable; shiftr.io
     on 443 was reachable.
   - A browser round-trip took **about 1,057 ms** (first measurement).

### Other problems and fixes

- **"Public rooms showed the home page":** the phone had a cached old `app.js` and a new
  `index.html`. Fixed by stamping assets with `?v=<content hash>`.
- **GitHub Pages deploy run #8 stuck "queued"** for more than 30 minutes. Pushing a new real
  commit (the README change) deployed immediately. Runs #8 and #9 may still show
  queued or waiting in Actions; they're harmless.
- **Kick-out bug: root cause found and fixed 2026-11-04.** `apply()` rebuilt every player
  object on each lobby broadcast, so the grace timer set in `hostDrop` held a stale copy whose
  `away` never cleared. A guest quiet for ~9 s who came back inside the 15 s grace was still
  removed when the timer fired, then re-admitted as `late` and sat out the match. Lobby updates
  now modify player objects in place. `tests/live.rejoin.e2e.js` reproduced it (guest ended
  "late") and passes after the fix. The earlier handover mitigations (`18e60a1`) remain.
  Still unverified on real phones. Side note: a guest who returns mid-question gets "You're
  back, the next question starts in a moment" and loses that question.
- **Push hiccups:** pushes sometimes failed with "fatal error in commit_refs_rules" or GitHub
  500 errors. Retrying with backoff worked.

### Tests at handoff (all passing in the container)

- `tests/engine.test.js`: 28 checks; every one of the names and aliases self-matches.
- `tests/e2e.js --fixture --fonts`: daily flow, autocorrect, chips, reload timer, share text,
  answer-key search, the challenge flow with two browser contexts, no console errors.
- `tests/live.e2e.js`:
  - the friend waits for an absent host;
  - host server drop and reconnect;
  - a third player joins;
  - Ready-up;
  - masked typing and "Locked in";
  - typing shown in the clear once you've answered, still dots for someone thinking;
  - chat: delivery to everyone, unread count and preview, escaping, own-message confirm,
    Escape, folding at question start, spoiler hold, no focus theft, hidden after leaving;
  - reveal and podium (Ana 500, Cy 150, Ben 50);
  - no errors.
- `tests/live.rejoin.e2e.js`: guest goes quiet until marked away, returns, keeps the seat.
- Since 2026-11-04 all suites also pass locally on Windows (the share-text check now accepts
  the CRLF the Windows clipboard returns).
- Ad hoc scripts (scratchpad, not in the repo): host closes the page mid-question → guest
  takes over → the next question starts; public room create, list, join; create, join and
  start on the production Pages site.
- **Not tested in a browser:** the autocorrect-help setting in live matches (the last commit).
  Only syntax, the build and engine tests ran.
- Overnight 2026-11-05 additions: `tests/pwa.e2e.js` (manifest, precache list, offline daily), the
  daily-quiz and quiz-board blocks above, `tests/live.topics.e2e.js` (live topic filter), and
  `tools/matchbench.js` (autocorrect benchmark, pinned in the engine test: right >= 97%, wrong
  <= 1%, false accept <= 1%).
- Quiz (2026-11-05): `tests/engine.test.js` has 13 quiz checks (determinism, one right option, no wrong option
  the matcher accepts, off-topic excluded, small bundles). `tests/quiz.e2e.js` plays a solo run and a
  `#vq-` challenge. `tests/live.quiz.e2e.js` and `live.rejoin.e2e.js --quiz` play a live Quiz match.
  Not verified on a real phone or on the claude.ai Artifact build (live is disabled there anyway).

---

## 10. Constraints to keep

- Don't recreate Krillion's identity: name, art, tier names, ocean or pixel look, VT323, krill.
- The Artifact build must:
  - load nothing external except Google Fonts (scripts only from the allowlisted CDNs);
  - use no `alert`, `confirm` or `prompt`;
  - use plain hash names;
  - keep the safe-area gutters (`max(16px, env(safe-area-inset-*))`), the sticky header at
    `env(safe-area-inset-top)`, and `[hidden]{display:none!important}`.
- Element ids used by tests and logic: `#answer #step #veil #timer-num #status #chips .chip
  #next #begin #card #dots #descent #hud-loss #hud-score .feedback.<tier> #share .score-big
  details.key .search .stat-grid .wordmark #how-go .modal #live-ready #live-name #live-go
  .lv-code .lv-players #live-rivals #rooms-list #vs-name #vs-go #send-vs .duel-head #chat-btn
  #chat-badge #chat #chat-log #chat-input #chat-note #chat-peek`, and others
  listed in the redesign brief.
- The user doesn't want the live site changed while they're playing. **Ask before pushing**
  when they're in a session.
- The user is cost-sensitive. Prefer cheaper or batched agents; don't fan out per-prompt Opus
  agents.
- Commits end with the session's Co-Authored-By and Claude-Session trailers. Don't put model
  names in repo files.

---

## 11. Open items and next steps

0. **Overnight 2026-11-05 (branch `overnight`, not pushed):** paste `supabase/daily_quiz.sql` into the
   Supabase SQL editor to open the quiz leaderboard; test locally; then merge `overnight` into
   `claude/mlion-game` and push. The new mark (Leo's curve and the ball) replaced the lion badge
   everywhere: favicon, icons, og.png.

1. **Verify on real phones:** the live autocorrect-help setting, masked typing, no-repeat
   questions, the kick-out fix, and chat with the phone keyboard open (the panel follows
   `visualViewport`; only desktop and emulated phone sizes were checked). Ask the user what the screen says if anything
   fails.
2. **Public broker risk:** shiftr.io's public instance is shared and unauthenticated, so anyone
   can publish to `mlion/v2/*`. Messages are validated (types, lengths, tiers, and scores
   recomputed from the tier), but a self-hosted or authenticated broker would be more robust.
3. The 46 never-written new prompts from the stopped workflow, listed with notes in this
   session's workflow args: microsoft-model, nvidia-model, chinese-lab-model,
   efficient-transformer, normalizing-flow, nerf-3d, depth-model, pose-model, ocr-model,
   tracking-algo, super-resolution, translation-model, kg-embedding, robot-learning-model,
   world-model, diffusion-addon, reasoning-model, image-descriptor, classic-cv-algo,
   search-algorithm, evolutionary-algo, clustering-metric, ranking-metric, robotics-algo,
   classic-dataset, inference-optimization, special-token, pretraining-dataset,
   instruction-dataset, jax-library, pytorch-ecosystem, numpy-function, pandas-method,
   gpu-compiler, cuda-concept, speech-dataset, linear-algebra, matrix-type, calculus-concept,
   generative-metric, nlp-metric, sciml-method, turing-award, ai-leader, ai-policy, ai-tv-show.
   - `display.json` already has entries for some of them (turing-award, ai-leader,
     special-token, numpy-function, eponym and others), which the build warns about.
4. Enrichment never reached most theory, stack, lore and llm prompts beyond the 9 Sonnet
   batches.
5. Design polish noted in §8.
6. Multiplayer formats: private rooms already allow up to 8 players free-for-all; public
   rooms are duos. 2v2 teams is a future request from the user.
7. Explanation coverage is about 25%; filling it is a content job (mind cost).
8. Launch mode hides question picking only on the client (see §7 Routes).
9. Optional: a proper `main` branch. Pages currently serves from `claude/mlion-game`, so moving
   it means changing the Pages source.
10. `.taste-skill/` was meant to be gitignored, but that edit never ran.
11. Quiz follow-ups: a wrong option can be a real member of the category the answer list lacks (lists are
    incomplete); the host can't switch format from the podium; live quiz answer times are self-reported
    (clamped by the host); no quiz leaderboard or per-mode stats (quiz records are kept out of Stats).

---

## 12. Running locally

```bash
git clone https://github.com/Antony-X/MLION && cd MLION   # user's copy: ~/Desktop/MLion
# Windows with core.autocrlf=true: use LF here, or every build rewrites all ?v= stamps
git config core.autocrlf false && git config core.eol lf && git rm -rq --cached . && git reset -q --hard
git checkout claude/mlion-game
python3 -m http.server 8000      # open http://localhost:8000  (live mode works locally too)
node tools/build.js              # after editing data/prompts/*.json or display.json
node tests/engine.test.js
npx playwright install chromium  # only if you don't already have a Playwright browser
node tests/e2e.js --fixture --fonts
node tests/live.e2e.js           # needs network to unpkg.com and public.cloud.shiftr.io
```

To deploy, push to `claude/mlion-game`. GitHub Pages ("Deploy from a branch", root) rebuilds
in about 30–60 s. Cache-busting means phones load the new code on their next full load.
