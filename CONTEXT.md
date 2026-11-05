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
- **Launch and numbering:** `LAUNCH_DATE` in js/engine.js is `null` until the user says the game has
  launched (they asked for this on 2026-11-05: "do day 1 until I officially tell you I launched").
  Until then every day is MLion #1 and Daily Quiz #1, dealt from the pre-launch set (below). On
  launch day it becomes `"YYYY-MM-DD"` (steps: "Launch-day steps" below): that day becomes #1 and the
  hand-picked launch week starts. The day resets at **local** midnight, Wordle-style, not New York time.
  - The launch day the game uses (`E.LAUNCH`) is, in order: a test's `window.MLION_LAUNCH`; else the
    admin panel's `app_config.launch` **if it is a real YYYY-MM-DD date**; else `LAUNCH_DATE`. So the
    database can move the date, but a null or junk value from it never clears the date in the code
    (`E.setLaunch`, engine test "launch day").
  - Why it's in the code (pre-launch audit B1): the config row arrives after the first screen, so a first
    visit used to play the pre-launch set as "MLion #1" and could post it to the launch board.
  - Belt and braces in app.js: a browser with no cached config waits up to 2 s for it before dealing
    `#daily` / `#daily-quiz` (`withConfig`). If a config that moves the launch day arrives mid-run, the run
    from the old set is dropped and today's real one opens with a toast; a daily or quiz already finished
    today from the old set moves to `records["stale:<key>"]` (mode `stale`: out of stats, streak and board)
    so the real one can be played (`shelveStale`, also run at boot). `postDaily` refuses any run whose
    questions aren't what its day deals now (`dealtNow`), so the old set can never reach the board.

### Launch-day steps

Decide the date D (local dates, `YYYY-MM-DD`). Everything below can be done the evening before:
a future `LAUNCH_DATE` changes nothing until D (days before it are still pre-launch #1).

1. Back up the database (`supabase db dump`; the free plan has no backups), then in the admin panel run
   Game → Reset all players to clear beta scores. Run `supabase/quiz_speed.sql` if it hasn't been run.
2. In `js/engine.js`, change the one line `const LAUNCH_DATE = null;` to `const LAUNCH_DATE = "D";`.
3. `node tools/build.js` (re-stamps `?v=` hashes and the service worker list), then
   `node tests/engine.test.js` and the e2e suites (at least e2e, board, launch, pwa).
4. Commit, `git tag launch-1`, push to `claude/mlion-game` (Pages deploys in about a minute).
5. Admin panel → Game: set the same launch day (the Tomorrow button the evening before), or leave it
   empty: an empty value no longer undoes the code. A *different* valid date there wins over the code.
6. After midnight on D, open the site in a private window: the header says MLion #1 and the first prompt
   is "Name an optimizer used to train neural networks" (launch day 1).
7. To undo before anyone plays: set `LAUNCH_DATE` back to `null`, build, push, and clear the admin
   panel's launch day.
- **The dailies' questions** come from `data/daily.json` (bundled as `DATA.daily`; the build
  validates it). `pool`: 71 hand-picked core prompts a typical IOAI contestant can answer at once
  (the user, 2026-11-05: "like name an optimizer"; RAG, PEFT, quantization formats, special tokens,
  pandas and sklearn utilities are out). The daily and the Daily Quiz deal only from it (`DAILY`
  view in app.js); Unlimited, Quiz and live rooms keep the whole core set. A new prompt joins the
  daily only when added to `pool`. `dailyIds(date)`:
  - before launch: `runFor(DAILY, "prelaunch-v2", days since 2026-11-05 + 1)`, the whole pool;
  - launch days 1 to 7: `launch` in daily.json (49 pool prompts, easiest first);
  - after that: `runFor(asOf(DAILY, date), "daily-v4", n - 7, …, LAUNCH_IDS)`, a flat shuffle whose
    first pass deals the 16 pool prompts the week didn't use, so week 2 doesn't repeat week 1.
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
js/landscape.js       topographic backdrop, 3D ridge-line landscape scene, Descent canvas (play stage), streak flame, tier glyphs, lion mark (MARK: Leo's curve + the ball)
js/music.js           generative background music (Web Audio, no files); app.js drives it through a few hooks (see "Background music" at the end)
js/sharecard.js       the share card: draws a finished run as a PNG (1200x630 wide, 1080x1920 story) and runs the share sheet (window.MLION_CARD)
js/app.js             everything else: routing, round state machine, results, challenge, live match, settings
js/vendor/            third-party scripts served with the game (supabase-2.118.0.js), so launch doesn't depend on a CDN
supabase/*.sql        additive SQL the owner runs by hand in the SQL editor (names_v2.sql after names.sql)
js/vendor/mqtt-4.3.7.min.js  MQTT.js 4.3.7 browser bundle, vendored unchanged (MIT header added); loaded only for live play
data/packs.json       7 packs (id, name, emoji, tagline)
data/prompts/*.json   134 prompt files, one per prompt (schema below)
data/display.json     per-prompt example / scope / offtopic overrides
data/AUTHORING.md     authoring spec (schema, alias rules, tier calibration)
tools/build.js        validate every prompt + write js/data.js + cache-bust index.html
tools/build-single.js bundle everything into one HTML file (Artifact build)
tools/icons.js        render img/ (favicon.svg, app icons, og.png link preview) from MARK; `og` = only og.png, `og mock` = plus mock Discord embeds in tests/out/og; needs Playwright + network for Archivo
tools/probe.js        check candidate answers against a prompt (EXACT/CORRECT/SUGGEST/NONE)
tools/pull_suggestions.js  pull approved answer suggestions into data/prompts/*.json (secret key at run time; see "Suggest this answer")
supabase/*.sql        schema, daily_quiz, admin, names, quiz_speed, suggestions, rate_limits (each additive; run in the SQL editor)
tools/music-render.js render the music (with the real Sound effects) offline to WAVs + loudness/spectrum report; needs Playwright
tools/cards.js        render sample share cards (14 runs x 2 shapes) for design review; `thumbs` adds chat-size screenshots
tests/engine.test.js  normalization, matcher layers, self-match of every alias, 365-day schedule
tests/e2e.js          Playwright: full daily, autocorrect, chips, reload-timer, share, challenge flow
tests/live.e2e.js     Playwright: 3 browsers, live match + chat over the real MQTT broker
tests/live.rejoin.e2e.js  Playwright: a guest drops ~10 s mid-match and must keep their seat (--quiz: in a Quiz match, real data)
tests/sharecard.e2e.js  Playwright: the share sheet with navigator.share / clipboard.write mocked (desktop + phone, daily, challenge, Daily Quiz) and the link-preview tags
tests/quiz.e2e.js     Playwright: solo quiz (taps, keys 1-4, verdict, timeout, resume, results, stats) + #vq- challenge between two browsers
tests/live.quiz.e2e.js  Playwright: live Quiz match, two browsers over MQTT (hidden picks, reveal, skip, chat, forged answers, time tie-break)
tests/live.security.e2e.js  Playwright, fake relay (no network): outsider reads/forges/replays, a guest claiming a fake tier, open-room knock and full, room-list XSS, ten players
tests/live.sprint.e2e.js  Playwright: live Sprint match, two browsers over MQTT (live tallies, clock end, shared answers, a player who leaves, totals); live.rejoin.e2e.js --sprint: a guest comes back mid-sprint
tests/music.e2e.js    Playwright: the music in the real page (gesture start, depth, clock, gem, Settings rows, Sound off, hidden tab, results cadence); no network
README.md, package.json, .nojekyll (needed for Pages)
```

### npm scripts

```
npm run build      # node tools/build.js
npm run stats      # node tools/build.js --stats
npm test           # build + engine tests
npm run e2e        # node tests/e2e.js           (add --fixture to use clone data, --fonts to load Google Fonts)
npm run e2e:live   # live.e2e.js, live.rejoin.e2e.js, live.quiz.e2e.js, live.rejoin.e2e.js --quiz, live.topics.e2e.js, live.sprint.e2e.js, live.rejoin.e2e.js --sprint, live.takeover.e2e.js, live.security.e2e.js (the first seven need network: public.cloud.shiftr.io)
npm run e2e:quiz   # quiz.e2e.js (solo + challenge; no network)
npm run e2e:launch # launch.e2e.js: launch-day race, broken links, two tabs, Supabase down, no CDN (no network)
npm run e2e:card   # sharecard.e2e.js (the share card and sheet; no network, add --fonts to load Archivo)
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

### Current numbers (measured 2026-11-05, after the six prompts added that evening)

- 160 prompt files: **154 core + 6 off-topic extras**, **25,349 answers** total, plus **222 live quiz
  questions** in `data/reasoning.json` (80 more retired). 45 of the core prompts are flagged `extra` (outside the IOAI
  syllabus, off by default).
- Core prompts by pack:

  | pack | prompts |
  |---|---|
  | blocks | 22 |
  | zoo | 27 |
  | classic | 32 |
  | llm | 17 |
  | stack | 24 |
  | theory | 23 |
  | lore | 9 |

- The lore pack's core prompts: ai-conference, ai-leader, ai-researcher, animal-model, ml-competition,
  ml-course, ml-paper, ml-slang, turing-award.
- Added 2026-11-05 evening at the user's request (all in the daily pool): overfit-cause, data-type,
  animal-model, net-name, tree-hyperparameter (parameter names extracted from the installed sklearn,
  xgboost, lightgbm and catboost; one answer per concept, every library's name as an alias),
  matrix-property.
- Prompts added after launch should carry `added` in display.json, so dailies dealt before then
  don't change. The pre-launch dates were cleared on 2026-11-05 (nothing was launched).
- Autocorrect bench (`node tools/matchbench.js`): typos right 98.0%, wrong 0.1%, missed 0.3%;
  other prompts' answers falsely accepted 0.5%, offered as a hint 0.0% (was 3.7%).
- Autocorrect guards (2026-11-05, after "adam alpha" -> Dirichlet prior, "semi sparse autoencoder"
  -> End-to-end SAE, DETR -> DEXTR): (1) a multi-word typo over distance 1 needs each typed word
  to be a near-spelling of the answer's word in the same place; (2) containment with an extra real
  word (not a size/version word, VERSION_WORDS) can only be offered, never taken; (3) a term that
  is itself an answer to any prompt (LEXICON) is never corrected or offered.

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
| `#unlimited`, `#unlimited-play`, `#unlimited-N` | Unlimited hub (sessions), the endless session (resume or start), an old run link (its results if played, else the session) |
| `#packs`, `#pack-<id>`, `#pack-<id>-N` | packs, pack detail, pack run (hidden in launch mode) |
| `#archive`, `#archive-YYYY-MM-DD` | archive, a past day |
| `#library`, `#practice-<id>`, `#answers-<id>` | library, practice one prompt, its answer key (hidden in launch mode) |
| `#results-<key-with-dashes>` | a run's results |
| `#stats`, `#how`, `#faq`, `#prefs` | stats, how to play, FAQ, settings |
| `#challenge`, `#vs-…`, `#vq-…` | challenge setup (Format: Rarity or Quiz), a rarity challenge link, a quiz challenge link |
| `#quiz`, `#quiz-N` | Quiz hub (today's quiz first, then practice runs), solo quiz run N (hidden-ahead rule below) |
| `#daily-quiz`, `#results-dquiz-YYYY-MM-DD` | today's Daily Quiz, its results |
| `#sprint`, `#sprint-<promptId>` | Sprint: `#sprint` picks a random prompt and replaces itself with its link |
| `#board`, `#board-YYYY-MM-DD`, `#board-quiz`, `#board-quiz-YYYY-MM-DD` | leaderboard, Daily and Quiz tabs |
| `#live`, `#live-<code>` | live match setup, a room |
| `#rooms` | public room list |

**Launch mode** (`const BROWSE = false` near the top of app.js): Packs and the Library are
hidden (home tiles, drawer links), their routes redirect home, and `#quiz-N` beyond the next
unplayed run redirects to it. This stops people choosing
questions or reading a key and replaying. It is client-side only: `js/data.js` and the public repo still contain every
answer. Real protection would need a server. `BROWSE = true` restores everything.

### Round state machine

intro → preview (3 s, input locked) → answering (default 25 s) → feedback → next.

- **Since 2026-11-05 solo runs skip the intro** (user: "we don't need this in between page"):
  `resumePhase()` calls `startRound()` at once for the daily, Daily Quiz, Quiz, Unlimited, archive and
  practice; only `vs`/`vq` challenges (name field, send-now link) and live matches show `renderIntro()`.
  The 3 s preview of the first question is the read time. The AI-check consent is asked lazily now.

### Home "More" list and endless Unlimited (2026-11-05)

- Order (user's request): **Daily** (class `hl`, gold), Unlimited, Quiz, Sprint, Leaderboard (when the
  board is configured), **Settings** (`#prefs`, replaced Stats on home; `#stats` still exists in the menu).
- **With a friend** (user: playing with friends is the most important mode and people didn't know it was
  there): Daily, Quiz and Sprint rows carry a gold `a.friend` button to `#live`; its click saves `liveFmt`
  (`rarity`, `quiz`, `sprint`), so the room opens in that format, and the create-room page says which
  (`#live-fmt-line`). Rows are title over line at every width, so rows with and without the button align.
- **Launch reset** (user, 2026-11-05: "clear beta players", everything including logins): app.js, right
  after `LS`, removes every `mlion:*` key except `mlion:settings` once per browser and writes
  `mlion:reset = RESET_ID` ("launch-2026-11"). Browsers driven by tests (`navigator.webdriver`) are skipped
  unless `window.MLION_RESET_TEST` is set (tests/flow.e2e.js does). Settings → reset local data keeps
  `mlion:reset`, so it doesn't rerun. The Supabase side (scores, profiles, auth users) is wiped by hand in
  the SQL editor; nothing in the repo deletes server data. To reset again, change `RESET_ID`.
- Unlimited is one endless session (`RUN.endless`, key `unlimited:N`, N = next unplayed). Each Next deals
  one more prompt from one long shuffled deck per question set: `E.streamIds(CORE|WIDE,
  "unlimited-v3:core|wide", k)`, position in LS `unlPos:<pool>`, so nothing repeats until the whole deck
  (103 core prompts) has been dealt, across sessions. Stop (`#stop-run` on the stage, `#stop-here` beside
  Next) ends the session: the unanswered prompt is dropped and the answered ones become the record (no
  record if none). The stage shows "Answered" instead of Loss, the last six dots, and "Prompt N". Old
  seven-prompt runs in progress finish the old way (`unlimitedSpec`, "unlimited-v2").

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
- **Several tabs (pre-launch audit S14).** Saves of `records`, `seen`, `practice`, `sprints` and
  `boardPosted` re-read storage and change only their own entry, and a `storage` listener keeps each
  tab's copy current, so a second tab can't overwrite what another saved. If another tab finishes the run
  this tab is playing (same key), this tab stops and shows that result ("You finished this in another
  tab"); finishing second never overwrites (first finish counts); an endless Unlimited session that
  collides takes the next free number. A save that fails (storage full or blocked) now says so.
- **A broken `#link`** (bad `%` escape, or any screen that throws while drawing) shows home with "That
  link didn't work…"; the error is still rethrown afterwards so tests see it (`route()` wraps `routeTo()`).
- A wrong answer shows "no gradient. try again".
- A correction rewrites the input, and Step confirms it.
- Suggestions show as tappable chips.
- On timeout the draft is submitted: a confident correction or single strong suggestion is
  accepted, otherwise it's a miss.
- Settings: preview autocorrect, clear rejected, sound (WebAudio), music (on/off + volume, under
  Sound; dimmed while Sound is off), reduce motion, include share link, Claude answer check.

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

**Since 2026-11-05 (afternoon) every quiz slot is a hand-written bank question** (`data/reasoning.json`,
ids rq-101..rq-247, 147 of them; `E.quizBank(data)`). The user found the first version weak: the
generated "which one fits?" questions often had obscure right answers and random wrong options, and the
80 reasoning MCQs (rq-01..rq-80) were paragraph-long and mostly arithmetic or niche (KV-cache bytes,
STFT frames, CTC). Bank rules: one short question an IOAI contestant can answer from ML knowledge, no
arithmetic, wrong options are believable misconceptions of similar length (the right option is the
longest in only ~24% of questions, about chance; answer slots balanced), `lvl` easy/medium shown with
`cat` above the question, `pack` = the topic a live topic match deals it under, and a one-line `why`.
rq-01..80 are kept with `retired: true` (never dealt; old results still open). Clock: 1.4x
(`REASONING_CLOCK`), so 35 s on the daily's 25 s. Solo runs deal one stream (`"bank-v1"`); vq challenges
and live rooms (all topics or chosen topics) deal from the bank too, and guests rebuild the host's ids
exactly. The generator below is now only a fallback when the bank runs short (e.g. a stack-only topic
match asks for more than its 4 questions).

**Hard questions and the level mix (user, 2026-11-05: "too simple, it has to be challenging, a mix, some
hard some easy").** rq-248..rq-322 are 75 `lvl: "hard"` questions (bank now 71 easy, 76 medium, 75 hard;
right option longest in 23% of them, answer slots balanced). Every deal of seven
follows `E.QUIZ_PATTERN` = easy, easy, medium, medium, hard, hard, hard (longer deals repeat it):
- Solo runs: `reasoningRun` keeps one seeded stream per level (`levelStreams`, `takeMixed`), label
  `"bank-v2"`; a question comes back only after its level is used up (hard lasts 25 runs).
- vq challenges: links made since then have 10-character seeds and deal `E.mixedDeal(CORE, "vq-<seed>", n)`;
  older 6-7 character seeds rebuild from `CORE_BANK1` (the bank up to rq-247), so their picks still line up.
- Live quiz rooms: the host lays its candidates (fresh ids, or the shuffled pool) out with `mixByLevel`.
- Daily Quiz days in data/daily.json `quiz`: each day kept its first 2 easy and 2 medium and got 3 hard,
  in pattern order (engine test checks every day).
- build.js accepts `lvl` easy, medium or hard; the eyebrow above a question shows the level.

**Really hard questions, a climbing pattern, speed points (user, 2026-11-05 evening: "questions in quiz
rn very very easy"; "faster u answer, more points").**
- rq-323..rq-402: 80 new `hard` questions (mechanism-level: posterior collapse, μP, attention sinks,
  QK-norm, grokking, induction heads, FixRes, ...), each checked by hand. The old rq-248..322 "hard"
  ones were really medium and are relabelled `medium`. Bank: 71 easy, 151 medium, 80 hard.
- `E.QUIZ_PATTERN` is now easy, easy, medium, medium, hard, hard, hard (was a zig-zag), so the card's
  "They start easy and get harder as you go" is true. Solo runs last 26 before hard repeats.
- Daily Quiz days: each kept its 2 easy, its first medium and its old slot-4 question (now a harder
  medium), and got 3 new hard ones with categories not already in the day (seed 20261105; 17 new hard
  are left for solo runs only). Script: scratchpad hard_merge.py (not in the repo).
- Daily Quiz speed: a right answer is worth `E.quizPoints(tenths)` = 100 within 3 s, then a straight line
  to 50 at the 35 s buzzer (the Daily Quiz clock: 25 s x REASONING_CLOCK; a fixed scale, never the
  player's clock). The page posts `times` (per-answer tenths, 0..350, comma-separated); the database trigger
  in `supabase/quiz_speed.sql` scores them with the same integer maths (engine test pins it). Until
  that file is run, the insert hits PGRST204 and retries without `times`, scoring 100 a right answer.
  Solo Quiz, challenges and live rooms keep 100 a right answer (live rooms have their own speed rules).

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
  Format row (Rarity / Quiz) that decides which link is made. Questions: `quizChallengeQuiz(seed, n)`
  (10-character seeds deal the level mix; see "Hard questions and the level mix").
- `picks` is one digit per question (0 none, 1 to 4), so each side's score is recomputed from the seed;
  `tenths` is the total answer time in tenths of a second. Winner: more points, else the lower `tenths`;
  equal on both is a draw. Same send-back flow (`#send-vs`), head-to-head board (`quizDuelBoard`), and the
  challenger sees the opponent's pick after each answer.

### Daily Quiz (added overnight 2026-11-05)

- (Updated 2026-11-05: all seven are bank questions. Before launch `E.dailyQuiz(DAILY, preDay,
  "dquiz-pre2")` deals the bank; from launch, days 1..21 play the hand-picked days in data/daily.json
  `quiz` (easy first), then `E.dailyQuiz(DAILY, n - 21, "dquiz-v3")`. The rest of this section is the
  first version.)
- One shared seven-question quiz a day: five prompt questions and two reasoning MCQs, on the fixed
  25 s clock (reasoning questions get 2.4x). `E.dailyQuiz(data, dayNumber)` deals the prompts like
  the daily (`runFor(data, "dquiz-v1", n)`) and the reasoning questions from their own stream
  (`"dquiz-reason-v1"`), so days don't repeat. `dquizSpec(date)` in app.js uses `asOf(CORE, date)`;
  `asOf` now also filters `reasoning` by an optional `added` date, so adding questions never
  changes a past day.
- Numbered like the daily (`dquizNumber = dayNo`): #1 until launch. Before launch it deals
  `E.dailyQuiz(DAILY, preDay, "dquiz-pre")`; from launch, `E.dailyQuiz(asOf(DAILY, date), n, "dquiz-v2")`.
  The quiz has no hand-picked week.
- Leaderboard: table `daily_quiz_scores` (`supabase/daily_quiz.sql`, additive: new table, trigger,
  policies only). The client posts `marks` (7 digits, 1 = right) and `tenths` (total answer time);
  the database recomputes `score = 100 x right`. Equal scores rank by time. Until the SQL is applied
  the Quiz tab says "The quiz leaderboard opens soon" (the client detects PGRST205/42P01).
- Tests: the daily-quiz block in `tests/quiz.e2e.js`; the quiz-board block in `tests/board.e2e.js`
  (mock table off, then on; tie-break by time).

### First visit (changed overnight 2026-11-05)

- No dialog on arrival: the home hero and its "Six depths" rows explain the game. (The intro's "How
  scoring works" link went with the intro page on 2026-11-05; How to play is in the menu.) `mlion:seenHow` is no longer read (tests still set it).

### Smaller overnight changes (2026-11-05)

- Autocorrect: a word-order layer (`bag` in `buildIndex`: "Knuth Donald", "Hastings Metropolis" are
  corrections, 2 to 4 words, only when unambiguous). `E.whereElse(raw, promptId)` names the prompts a
  miss does answer; the reject and Sprint miss messages use it ("ReLU answers Name an activation
  function, not this one").
- Vibration (`settings.haptics`, inside `Sound`): shown under Feel only on touch screens with
  `navigator.vibrate`.
- How to play lists the other ways to play; Stats has Daily quiz and Sprint blocks.
- Desktop fit: the stage is `100vh - 400px` (a quiz `100vh - 560px`), so Next stays on a 768 px
  laptop; a quiz answer keeps its question's two columns; if Next is still below the fold the page
  scrolls to it once the ball lands (`revealNext`), and each new round starts at the top.
- Settings: "Your name" (the `mlion:name` rooms and challenges use). Reset all keeps settings and name.

### Sprint (added overnight 2026-11-05)

- One prompt, 60 seconds, as many answers as you can; each scores its tier's points. **Every accepted
  answer adds time** (user request, 2026-11-05): `SPRINT_BONUS` = Baseline 1 s, Overfit 2, In-Distribution
  3, Outlier 4, Long Tail 5, MLion 8, at most 60 s in all (`SPRINT_BONUS_CAP`), added by `sprintAddTime`
  (solo: `S.bonus` stretches the clock; live: `S.endsAt` moves). "+N s" flashes above the clock
  (`#sp-plus`); the bar never overfills. The end screen shows Seconds and the share text says the real
  length ("in 66 s"). Duel links are unchanged (points and answers). Answers count
  once (aliases included); a confident typo counts and says "Counted as X"; a near miss says
  "Close to X" and keeps the text; a miss clears. Everything is in app.js under `// sprint`.
- Pool: `soloPool()` prompts with at least 40 answers (so extras follow the setting). Unranked:
  bests in `mlion:sprints` (prompt id -> {best points, n answers, plays, at}), carried by
  Export/Import, shown on Stats. The end screen lists the common answers you missed and the lion.
- Duels without a server: Share puts my result in the link, `#sprint-<prompt>~<points>~<answers>[~<nameHex>]`
  (name as in `#vs-` links). Opening it shows "Ana named 6 for 210 points. Beat that.", keeps the
  target beside the tally, and ends with who won and by how much. My own link (same best and name)
  opens as a plain sprint.
- An Enter pressed as time runs out can't press a button: the box is disabled and blurred, and
  nothing takes focus. Test: `tests/sprint.e2e.js` (fake clock).

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
- **Atomic updates (pre-launch audit S15; GitHub Pages sends `max-age=600`, and ignores `?v=`).**
  - The worker installs all of `ASSETS` with `cache: "reload"` (never the browser's HTTP cache) and checks
    each stamped file's content against its `?v=` hash (the build's FNV-1a, copied into sw.js), and that
    the page it stores loads exactly those stamps. Any mismatch fails the install, so the old worker keeps
    serving; the browser retries later. At run time a stamped file is only cached when its content has
    that hash, so a stale page asking for an old `?v=` can never store new content under the old name.
  - Navigations fetch with `cache: "no-cache"` (a 304 when unchanged); the offline copy is replaced only
    by a page that loads this worker's files.
  - No `skipWaiting` on install. The new worker waits; the page (app.js, "Updates") hands over when no game,
    room or join is running: on the next screen change (`route()` → `swApply`) or when the tab is hidden.
    It asks the waiting worker for its `ASSETS`; if this page already runs those files it just hands over,
    otherwise it reloads once onto the new version. If another tab let the new worker in while this tab
    is mid-game, this tab reloads when its game ends. The first install takes over without a reload.
  - `tests/pwa.e2e.js` covers it: a wrong-content `?v=` is never cached; a new deploy waits during a daily,
    then home → one reload → new app.js, one cache left, offline daily on the new release; a release whose
    files don't match their stamps never installs.
- The menu shows "Install the app" when the browser fires `beforeinstallprompt`.

### Share card (`js/sharecard.js`, added 2026-11-05)

Share on the results screen opens a sheet with an image of the run, drawn on a canvas at its real
size: the descent (the run's landings on the play stage's slope, each segment in its tier
colour, the lit ball at the final loss, the gold minimum), the score and band, the marks row, and the
hook: the rarest answer with its tier glyph and the prompt it answered. The text grid stays one tap
away. `app.js` only calls `MLION_CARD.open({rec, text, url, packName, ui})` from the `#share` handler;
if `js/sharecard.js` is missing the old text share runs.

- Shapes: Wide 1200x630 (the usual 1.91:1 link-preview shape; a chat shows a wide image whole; at
  550 px wide the score, answer and lockup stay legible, at 330 px the score and answer: `tools/cards.js thumbs`) and Story
  1080x1920 (Instagram and WhatsApp stories; following the common safe-zone guideline, the top ~280 px
  and bottom ~220 px hold nothing important). The choice is remembered in
  `mlion:cardFormat`. PNGs measure 137-177 KB wide and 208-257 KB story in Chrome (opaque canvas, so
  RGB, no alpha; the basin glow is flat bands, not a gradient, to keep the PNG small).
- Variants (`specFor(rec)`): the daily ("#12" and the long date), an archive replay, Unlimited
  (sessions longer than 12 prompts show a tally of marks instead of a row), packs, quiz and Daily Quiz
  (check/cross marks, speed points, the hook is the hardest question answered right and how fast),
  and challenges (vs, vq: who won and by how much, the friend's score and a hollow ball with their
  name, trimmed to 14 characters). All misses: "Stuck on the plateau." A perfect run gets contour rings
  at the minimum. Live rooms have no card yet.
- Personal data: none on daily, quiz or unlimited cards. A challenge card shows the opponent's name
  as typed into the challenge link (it is already in the link the player was sent). The hook spoils
  one answer of the day and its prompt; that is the point of the hook.
- Sharing: phones (UA test, plus iPadOS) with `navigator.canShare({files})` get "Share image" (Web
  Share with a PNG File, called straight from the tap with the image already drawn, so the user
  gesture holds); a refused share saves the file instead, a cancelled one does nothing. Elsewhere
  "Copy image" (`ClipboardItem` with image/png) and "Save image" (download `mlion-12.png`,
  `mlion-12-story.png`). "Copy text" / "Share text" sends the old text grid. Challenge results get a
  "Share image" button beside "Send result back" and no text grid (the link is the text).
- Drawing: Archivo is loaded through `document.fonts.load` for the exact weights and text (2.5 s
  timeout, then the system sans). Only vector paths (`MARK`, `GLYPHS`) and text are drawn, never
  images, so the canvas is never tainted. The terrain is `V.terrain` after `V.setRounds(n)`, smoothed.
  The hook text measures the slope and shrinks (down to 0.6x) rather than run into it.
- Ids: `#share`, `#card-preview`, `#card-img` (data-w, data-h, data-bytes once drawn), `[data-fmt]`,
  `#card-share`, `#card-copy`, `#card-text`, `#card-save`, `#card-textbox`.
- `node tools/cards.js [outDir] [only=a,b] [thumbs]` renders 14 sample runs in both shapes
  (default `tests/out/cards/`).
- Not verified: a real phone's share sheet (only mocked), Safari and Firefox rendering (if a browser
  lacks `ctx.fontStretch` or `ctx.letterSpacing` the text draws at normal width and tracking; their PNG
  encoders give other sizes), how Instagram and Discord actually crop or recompress the images.

### Link preview (Open Graph), added 2026-11-05

What Discord, Slack, X and iMessage show when someone pastes the site address.

- `img/og.png`, 1200x630, about 180 KB, drawn by `node tools/icons.js og` with the share card's own
  pieces (`MLION_CARD.kit`): the descent with three right answers to "Name an activation function"
  where they land (ReLU +10 near the rim, GELU +30, Snake "One in a MLion +100" in the basin with the
  ball), the line "Name the rarest right answer you can." and the lockup. `node tools/icons.js og mock`
  also writes mock Discord embeds (400 px and 516 px images, a 300 px phone) to `tests/out/og/`.
  After a new image, run `node tools/build.js`: it stamps og.png's hash into the image URL
  (`og.png?v=<hash>`), so Discord's cache fetches the new one.
- Tags in `index.html`: og:type, og:site_name, og:url, og:title "MLion, a daily word game for ML
  people", og:description "Seven prompts a day. Common answers barely count.", og:image with type,
  width, height and alt, twitter:card summary_large_image, twitter:image and its alt.
- theme-color is gold `#f2b53c` in the HTML, which Discord uses for the embed's side bar. An inline
  script right after it sets it back to `#0b0a08`, so the browser's toolbar stays the dark room
  (crawlers run no script). The installed app uses the manifest's `theme_color`.
- Every link gets the same preview: a `#fragment` is never sent to the server, so `#vs-...`,
  `#live-...` and `#results-...` links all fetch `/` (`tests/sharecard.e2e.js` checks this). A
  challenge preview can't name the challenger without a server; that is fine for now.
- **The site address is written in one place:** `SITE_URL` at the top of `tools/build.js`. The build
  writes it into og:url, og:image and twitter:image. The app reads og:url back: `WEB_URL` in
  js/app.js (live links from the Artifact build), and the address printed on share cards (when the
  page runs on localhost or has no http address). `tools/build-single.js` copies og:url into the
  Artifact build. To move to a custom domain:
  1. set `SITE_URL` (https, ending in `/`) and run `node tools/build.js`;
  2. add the domain in GitHub Pages settings (it writes a `CNAME` file on the branch);
  3. add the new URL to the Supabase auth site URL and redirect allowlist (Daily leaderboard below);
  4. paste the new address in Discord once to check the embed (Discord caches each URL for a while).
  The address in sections 1 and 7 of this file is prose, not config.
- Not verified: a real Discord, Slack or X unfurl (only the mock); Discord's exact image width; how
  apps that crop to a square (WhatsApp's small preview) show it: the centre square holds part of the
  line and GELU, not the ball.

### Live match (real time)

**Transport: MQTT over a WebSocket on port 443.**
- Broker: `wss://public.cloud.shiftr.io`, username and password `public` (the constants `BROKER` and
  `BROKER_LOGIN` in app.js; change the relay there only).
- Library: vendored at `js/vendor/mqtt-4.3.7.min.js` (MQTT.js 4.3.7, MIT; the header gives the source URL
  and the sha256 of the untouched original). Nothing in live play loads from a CDN any more.
- Topic root: `mlion/v3` (v2 pages sent plain JSON and can't talk to v3 rooms).
  - Room: `mlion/v3/r/<code>/{up,down,to/<id>}`; open rooms also use `…/knock` and `…/knock/<nonce>`.
  - Public room info (retained, plain): `mlion/v3/pub/<code>`, plus a last-will that clears it.
- It's **disabled inside the Artifact**, because claude.ai blocks WebRTC and outside
  WebSockets. There, `#live` shows an "Open live mode" link to the Pages site.
- The create and join page says: "Chat and answers pass through a public relay, encrypted with the room's
  link." (`#live-relay`).

**Room secret and sealed messages** (added 2026-11-05, pre-launch hardening)
- Every room has a random secret (16 bytes from `crypto.getRandomValues`, base64url, 22 chars). The invite
  link is `#live-<code>-<secret>`; the secret lives only in the URL fragment (never sent to a server) and is in
  no topic name. A link without a secret shows "This invite link is missing its key" (old v2 links included),
  except for `pub01`–`pub10`, which knock (below).
- Key: HKDF-SHA-256(secret, salt `mlion/v3/room/<code>`, info `mlion live`) → AES-256-GCM (WebCrypto; needs a
  secure page, so https or localhost; otherwise live says so).
- Every room message (lobby, chat, answers, heartbeats, hello, closed, typing, sprint lists) is sealed:
  plaintext `{s: sender id, c: counter, m: message}`, a fresh 12-byte IV, the topic as AES-GCM associated data,
  sent as base64url. `sendSealed` queues seals so order is kept; `listenSealed` opens in arrival order and
  drops anything that doesn't open (wrong key, other room, moved to another topic, tampered, plain JSON) and
  any counter not higher than the last one from that sender (`rxCount`), so replays do nothing. The counter
  starts at `Date.now() * 1000` and only goes up for the page's lifetime.
- The sealed sender `s` is the only identity the host trusts: `m.from` is gone, and a message whose `from`
  differs from `s` is dropped.

**Open rooms (listed in the lobby)**
- The listing stays plain so anyone can read it: code, host name, head count, max, phase. Never the secret.
- A stranger who taps Join on `#live-pubNN` knocks (`liveKnock`): they send an ephemeral ECDH P-256 public key
  and a nonce to `…/knock`. While the seat is free the host (`hostKnock`) draws a **fresh** room secret,
  makes its own ephemeral key, and answers on `…/knock/<nonce>` with its public key and the secret sealed
  under HKDF(ECDH shared bits). A listener sees both public keys but can't compute the shared key. The
  knocker then joins as with an invite link (and the address bar gets the full link).
- One knock is answered per free seat; the seat is held for 20 s (`KNOCK_HOLD_MS`; the same knocker asking
  again gets the same answer, anyone else hears `{full}`). The host draws a new secret before each answer and
  again when the stranger's seat is freed (`rotateSecret`), so someone who knocked and didn't sit down, or who
  left, holds a dead key. The host's address bar follows (`history.replaceState`).
- Trade-off (documented choice): anyone may take the free seat (that's what an open room is), and the
  listing and the knock answers are unauthenticated, so an outsider can fake a listing, clear one, answer a
  knock with `{full}` or a fake key (the stranger then sits in a dead room). None of that lets an outsider
  read or forge a real room's messages. A host's invite link to an open room dies when the key rotates.

**Rooms**
- Private rooms use a random 5-character code from `abcdefghjkmnpqrstuvwxyz23456789`.
- Public rooms use fixed codes `pub01`–`pub10` and hold **2 players** (duos). Private rooms hold
  up to **12** (`ROOM_MAX`; 10 friends with room to spare). A full room says "That room is full: it holds 12
  players."; a full open room says "That open room is full. Open rooms are for two players."
- The `#rooms` list comes from retained info messages. Entries older than 45 s are hidden, and
  the list redraws every 5 s. Only topics `pub01`–`pub10` are listed, and the code, name and link are
  escaped (the audit's S8 XSS sink).

**Host authority**
- The host page admits players, paces rounds and relays answers and typing.
- Messages carry `ep` (epoch), `hid` (host id) and `now` (host clock); the sealed `s` is what counts.
- Guests apply room state only from their current host (`LIVE.hostId`, the sealed sender of the lobby that
  seated them). Another page's claim is followed only if it is a seated player, its claim is newer (higher
  `ep`, or the same `ep` and a smaller id: the audit's N2 tie-break), **and** the current host has been silent
  for `HOST_QUIET_MS` (8 s). A host demotes itself only for a seated player's newer claim.
- **The host re-judges answers.** Classic: the answer message carries the raw typed text; `hostAnswer` runs
  `liveJudge` (the same rules as `submit()`: `E.matchAnswer`, then the room's autocorrect help; a chip only
  counts if the text really offered it) and broadcasts the tier and answer it found. The tier a page claims
  is ignored, so "not an answer" claimed as One in a MLion scores 0. Quiz: the pick must be -1..3 and not one
  of the two options the 50:50 removed (`cutOptions`); every page recomputes right or wrong from its own
  question. Sprint: `spans` carries `raws` next to the indexes, and `hostSprintFinal` keeps only the indexes
  `sprintJudge` reaches from that text. A second answer for the same question is ignored. Hints count only
  when the room has hints on. Still self-reported (clamped): answer time, wrong-guess count, hint use.

**Flow**
- Lobby shows a join banner, sound and vibration when someone joins.
- **The match starts when everyone taps Ready**, after a 3-2-1 countdown. Rematch works the
  same way.
- The host picks 5, 7 or 10 questions, **no-repeat questions** (on by default, tracked in
  `mlion:liveUsed`), and **autocorrect help: Off / Typos / Full / Generous** (default Typos).
  - Typos rejects suggestion chips and corrections with confidence < 0.88.
  - Off accepts only exact answers.
  - Generous (added 2026-11-05) takes any correction, or the top suggestion with confidence >= 0.6, at once
    (no "did you mean", no chips); at time-up a suggestion >= 0.5 counts.
- **More options** (user, 2026-11-05: hints and first letters, wrong-answer penalties, a speed multiplier,
  more fun options, "but not crowded, like settings"). A closed `<details id="lv-more">` under the time
  picker, host only, Classic and Quiz rooms (Sprint has none); the summary counts what's on ("3 on"), the open
  state survives lobby redraws (`LIVE.moreOpen`). Rules live in `LIVE.rules` (lobby, saved as
  `mlion:liveRules`, sent in `lobby` and `start` as `rules`) and `LIVE.mrules` / `RUN.rules` (the match's).
  `cleanRules` whitelists every value. Guests see them in the settings note ("Options: …", `activeRules`).
  - Speed bonus Off / up to ×1.5 / up to ×2: `E.speedMult` = 1 + (top - 1) × share of the clock left, in
    steps of 0.1; the timer label reads "Time left · ×1.8".
  - Hints Off / Half points / Free. Classic: a Hint button shows the first letter and letter pattern of one
    rarer answer (indist, outlier or longtail, seeded by `hint:<seed>:<round>:<prompt>` so everyone gets
    the same one, preferring answers with an explanation) and its explanation with the name masked as "…".
    Quiz: 50:50 removes two wrong options (seeded `cut:<seed>:<round>`, class `cut`, disabled, ignored by
    keys 1-4).
  - Wrong answers (Classic) Free / -5 / -10 each / One strike (a wrong answer ends your round as a miss).
  - Final question counts double (a banner on the last question).
  - Clash (Classic): once a round is revealed, an answer someone else in the match also gave scores half
    (`clashed`, applied inside `roundPts`, so standings and the podium use it).
  - Scoring: `E.liveScore(rules, {base, ms, total, misses, hinted, last})` = base × speed, halved for a
    paid hint, ×2 on the final question, minus penalties, floor 0. The answer message carries `ms`, `miss`
    and `hint`; the host clamps and relays them (no `ms` means the full clock, so no speed bonus) and every
    page scores with the same function. Your feedback adds a line ("50 points, ×1.8 for speed, …") and
    the reveal tags each answer. Test: `tests/live.rules.e2e.js`.
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

**Sprint format (live)**
- The host picks **Sprint** in the lobby (`fmt: "sprint"`, saved as `liveFmt`). Its count picker reads Sprints (default 3,
  kept as `liveSprintN`; the other formats get their old count back), and the time and autocorrect pickers are gone:
  every sprint is 60 s with the solo rules (`sprintJudge`/`sprintSubmit`). Topics and no-repeat work as in Classic, over
  prompts with at least 40 answers (`sprintOk`, the solo bar). Guests read "3 sprints of 60 s · Sprint format…".
- It runs beside the shared RUN engine (`LIVE.mfmt === "sprint"`, state in `SPR`; code under `// live sprint`). The host
  sends `spround {i, at}` (Classic's 1.5 s lead and 3 s read, so clocks start together). Every accepted answer sends
  `spp {i, n, pts, b}` (`b`: ms of time the answers added); the host checks it (`spTallyOk`: `n` up to 200, `pts` up to
  100 n, `b` up to min(60 s, 8 s × n)) and passes it on, so the strip above the prompt
  shows everyone's count and points ticking up while their answers stay hidden. When a player's clock ends they send
  `spans {i, list}` (answer indexes into the prompt); the host keeps the first valid list, every page recomputes points
  from the tiers. Each player's clock is 60 s plus their own added time, so lists arrive at different moments. The host
  reveals when every list is in, or 6 s after the longest reported clock ends for a straggler (`hostSprintCap` re-arms
  itself from `LIVE.spEnd` plus the largest `b` among players still owing a list)
  (`reveal {i, part, nextAt}`; `part` holds the last progress of players who sent no list). The reveal lists each player's
  answers with ×2 (and up) on any answer more than one named, plus standings and a countdown (9 s, plus 0.3 s per answer in
  the longest list, at most 18). The end is the usual podium, with each sprint's answers in the recap and Ready for rematch.
- Someone who drops out mid-match keeps the points they had sent: a player removed from the room moves to `LIVE.gone` and
  stays in reveals and on the podium ("left"). A guest who comes back (`resume`) is done with the sprint they were
  away for (their list so far is sent then) and plays the next; late joiners wait for the next match; a new host
  (`hostSprintTakeover`) carries on from the round its page last saw. In a sprint match `resume` also carries
  `fmt`, `ids`, `i` and `revealed`, so a page that lost the match rebuilds it (`liveSprintRestore`); a host that was
  taken over keeps its answers so far in `spCarry`/`LIVE.spRec` across the rejoin. There is no skip vote in a sprint,
  and chat's spoiler hold covers the open prompt.
- A seat's grace timer (`hostDrop`) acts only while the page is host and the seat is the same object; `liveReset`
  clears them. Before this, a stale timer on a taken-over host deleted the new host's seat and broadcast a lobby.
- Tests: `tests/live.sprint.e2e.js` and `live.rejoin.e2e.js --sprint` shorten the minute through
  `window.MLION_SPRINT_TEST = {secs, reveal}` (read only when `window.MLION_TEST` is set).
  `tests/live.takeover.e2e.js` runs two pages on an in-page fake relay (BroadcastChannel, no network): the host goes
  silent mid-sprint, the guest takes over, the old host rejoins and both podiums must match. Nothing here has been
  tried on a real phone.

**Rival panel**
- Before you answer: opponent typing shows as dots, with a count of wrong guesses. A locked
  answer shows only "Locked in ✓", and their round points are hidden from the strip.
- After you answer (user request, 2026-11-04): you see their draft and their bounced guesses
  (struck through) in the clear. Someone still thinking keeps seeing dots.
- Typing traffic (cut 2026-11-05): a page sends its draft at most once every 2 s (`TYPING_EVERY_MS`), only
  when the draft or bounced guesses changed, and never after it has answered; the host relays at most one
  per player per second. Before, a draft went out every 220 ms and the host relayed each one to everyone,
  which was 62–72% of all traffic and grew with the square of the room. Measured on the in-page fake relay
  (the audit's `live_load.js`, 3-question Classic match, everyone typing): 8 players went from 568 published /
  2,062 delivered messages to 273 / 819; 10 players: 323 / 1,139. Drafts on rivals' screens now update
  every 2 s instead of live.

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
  (away). Other guests follow it once their old host has been silent 8 s (see Host authority).
- An old host that sees a seated player's newer claim demotes itself and rejoins with the **same id**
  and the room secret, so it keeps its answers.
- A rejoining player gets a `resume` message and re-enters the match.
- Only an explicit **Leave** sends `{t:"closed"}`. Navigation doesn't. Guests act on it only from their
  current host.
- A guest's explicit **Leave** sends `{t:"leave"}`, and the host frees the seat at once (`hostRemove`, the same
  path as a seat whose grace ran out). The ready check (`hostReadyCheck`) runs on every Ready tap and every
  roster change: a seat marked away, freed or left. Before 2026-11-05 it ran only on a Ready tap, so if the
  last player who wasn't ready walked off, the others sat in the lobby until someone tapped Ready again
  (`tests/live.security.e2e.js` section F: Leave starts the match about 3 s later, closing the page about 13 s later).
- The join screen shows every step and retry, with 2 minutes of patience.

**What the hardening blocks, and what it doesn't** (tests: `tests/live.security.e2e.js`, no network)
- Blocked for anyone without the room's link: reading names, chat or answers (they see ciphertext, topic
  names and timing only); forging chat as the host or as a guest; pressing Ready for someone; answering for
  someone; moving hosting with a forged heartbeat; closing the room for guests; replaying a real sealed
  message on the same or another topic; injecting markup through the room list.
- Blocked for a dishonest member: claiming a tier or score the text doesn't earn (host re-judges), picking a
  removed 50:50 option, padding a sprint list.
- **Not blocked: members who hold the link.** The room key is shared, so a member's page can seal a message
  with another member's id, or speak as the host, and other pages can't tell. A member can also claim a
  newer epoch and make the host hand over. Fixing that needs per-player signatures (ECDSA keys in hello and
  the lobby list, host broadcasts signed), not done.
- Still self-reported and only clamped: answer times (speed bonus), the wrong-guess count, hint use, and a
  sprint's running tally before its list arrives.
- The relay: still the shared public shiftr.io test instance (undocumented quotas, shared by everyone as
  user `public`, no SLA). An outsider can still flood topics, fake or clear open-room listings, answer a
  knock with "full", and see which room codes and player ids are active. Moving to an own broker or to
  Supabase Realtime is out of scope for now; the sealed protocol works on any of them.
- A replay to a page that has never heard from that sender (a fresh joiner, or a host just taken over) is
  accepted once; only the same room's traffic can be replayed, and a joiner applies nothing but the lobby
  that seats it before it knows its host.

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
- The daily, the Daily Quiz, challenges (`#vs`, `#vq`) and live rooms always deal from `CORE`, so
  everyone shares the same questions. (Until 2026-11-05 the daily kept an old stream over the full
  list for past days, which let extras into the pre-launch daily; that was removed.)
- Settings → **Extra questions** (`settings.extraQuestions`, off by default) puts `WIDE` behind a
  player's own Unlimited and Quiz runs.
- review.html (unlisted) shows which prompts are extra and lets the owner mark moves either way.
- Test: `node tests/extras.e2e.js` (real data; clock set to before and after the switch-over).

### Daily leaderboard (Supabase)

- Supabase project **MLion** (ref `ozqnznvxxxnefeetidwq`, in the user's org). The URL and
  publishable key are in `BOARD_CONFIG` in js/app.js (public by design; RLS protects the data).
  Schema, rules and grants: `supabase/schema.sql` (already applied; safe to re-run).
- Opt-in: only players who log in appear. Login is OAuth with PKCE via supabase-js (the UMD build,
  vendored as `js/vendor/supabase-2.118.0.js`: @supabase/supabase-js 2.118.0 `dist/umd/supabase.js`,
  byte-identical on jsDelivr and unpkg, sha256 checked by tests/launch.e2e.js; loaded only for people who
  have logged in or are coming back from login). To upgrade, download the new UMD file under a new
  versioned name, point `SB_SRC` at it and update the hash in the test. The MQTT library for live rooms
  still comes from unpkg (another change handles it).
- **Midnight:** a daily posts to the day it was dealt for (`rec.date`), on that day or the next
  (`postableDay`: a run that crossed midnight), as long as the database's UTC ±1 window still takes it.
  The results of such a run show the board box under "Yesterday's leaderboard". A login also posts
  yesterday's finished daily. No SQL change was needed. Test: the midnight block in tests/board.e2e.js.
- **When Supabase is down or paused:** every call has a 10 s timeout (`timedFetch`, also given to
  supabase-js as its `fetch`); the mini board says "The leaderboard can't be reached right now…",
  Publish says the same, the board page says it couldn't load, and the game plays on. A failed call
  only counts as "account deleted" when the project answers `/auth/v1/settings` (`boardUp`), so a paused
  project's "not found" no longer logs everyone out. Test: tests/launch.e2e.js (project answering 404 and
  a config request that never answers). Buttons
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

### Admin panel (`#admin`, added 2026-11-05)

The user asked for "an admin panel I can use to do everything, easily and visually".
- **Database: `supabase/admin.sql`** (additive, applied in the SQL editor). `public.admins(discord_id)`
  lists admins by Discord user id (`auth.identities.identity_data->>'sub'`), so an admin stays one even if
  their account is deleted and made again. `admin_of(uuid)` and `is_admin()` check it. Every `admin_*`
  function is `security definer`, calls `admin_guard()` (raises 42501 for non-admins), and is executable
  by `authenticated` only. The page guards nothing itself.
- **Functions:** `admin_overview()` (players, joined today/week, plays today, 14 days of daily/quiz posts,
  today's top 5 each), `admin_players(q, limit)` (with the Discord name, play counts, best, last login, and
  whether each is an admin), `admin_scores(day, kind)`, `admin_remove_score(kind, user, day)`,
  `admin_rename(user, name)`, `admin_delete_player(user)` (deletes the auth user; profile and scores
  cascade; refuses admins), `admin_set_launch(date|null)`, `admin_set_banner(text)`, `admin_reset_all('RESET')`
  (every score, every non-admin account, and `app_config.reset_at = now()`).
- **`public.app_config`**: one public row (`launch`, `banner`, `reset_at`). The game caches it as
  `mlion:cfg` and applies it at start (`E.setLaunch`; engine `LAUNCH` is now a live getter, and a test's
  `window.MLION_LAUNCH` still wins). `cfgFetch()` refreshes it after start (plain REST with the
  publishable key; skipped in test browsers unless `MLION_BOARD` points at a fake). On the idle home page
  a change re-renders (day number, banner); a new `reset_at` clears the device and reloads.
  The Game tab shows the launch day the game actually uses (`E.LAUNCH`, so `LAUNCH_DATE` from the code
  when the row is empty); clearing the row with a date in the code says the code's date stands.
- **Device reset:** `mlion:since` marks when this browser's progress began (1970 if it already had
  progress when this shipped). When `reset_at > since`, every `mlion:*` key except settings, reset,
  cfg and since goes, then `since = now`. Test browsers skip it unless `MLION_RESET_TEST`. The admin's
  own device clears at once but keeps its login.
- **Page:** tabs Overview (figures, a 14-day stacked bar chart, today's top 5), Players (search by
  leaderboard or Discord name, rename, delete with a confirm), Scores (any day, Daily or Daily quiz,
  remove a score), Game (launch day with Today/Tomorrow and a "today would be #N" preview, home banner,
  Reset all players behind typing RESET). Admins get an "Admin panel" button in the menu's account box.
- **Home banner:** `#announce` above the hero; closing it stores `mlion:bannerSeen` (the text), so a new
  note shows again.
- Test: `tests/admin.e2e.js` (fake project; an admin and a non-admin browser).

### Publish my score, top five, name filter (added 2026-11-05)

The user asked: after the daily, see other people's scores, and a "Publish" button that asks for a name,
with no swear words on the board.
- **Under today's daily / daily-quiz results:** the top five (`boardTop`, a plain REST read with the
  publishable key, so no login library loads) with your row marked and "See all". Not logged in →
  "Publish my score" (`publishModal`) plus the login buttons; logged in → posts by itself as before.
- **Publish without login** = Supabase anonymous sign-in (`signInAnonymously`; needs "Allow anonymous
  sign-ins" switched on in the dashboard, else the dialog says it's off). It makes a real auth user with
  `is_anonymous`, so the existing tables and RLS work unchanged. `AUTH.anon`: such an account never posts
  by itself (the button asks each day, name filled in); the menu shows "On the leaderboard as …" with
  Change name and the login buttons, and no Log out. `onSession` keeps one `AUTH.loading` promise per
  account so the publish flow and the auth listener don't race. Reset everyone deletes these accounts too.
- **Names:** `E.nameOk` (engine) refuses swear words and slurs (English, some Spanish/French, Russian in
  Latin and Cyrillic, Georgian in Latin and Georgian): leetspeak digits, "ph"→f, stretched letters
  ("fuuuck"); `NAME_PARTS` match anywhere, `NAME_WORDS` only as a whole word (Hancock, Dickens, class,
  therapist pass). Used for publish, Change name, the default name from Discord, and Settings' name.
  `supabase/names.sql` (the first version, already run) adds `public.name_ok()` and a `profiles` trigger
  raising 23514, so the API refuses a bad name too.
- **Name filter v2 (pre-launch audit S10).** `supabase/names_v2.sql` (new, additive; **run it in the SQL
  editor after names.sql**) replaces `name_ok()`; it is generated by `node tools/names-sql.js` and the
  engine test fails if it is stale. Both sides: NFKD (fullwidth, maths, circled letters), lower case,
  accents dropped, leetspeak `0134578 9 @ $ ! |`, small capitals, then a second pass with Cyrillic and
  Greek look-alikes read as Latin (`сunt`); patterns take u/v and g/q (`fvck`, `niqqa`); new entries
  `fggot`, `kill yourself`, `kys`, `fgt`; reserved names (`NAME_RESERVED`: admin, administrator,
  moderator, official, support) may not start or end a word, and `mlion` may not appear at all; control,
  bidi, zero-width characters and 3+ stacked combining marks are refused. The maps are SQL `translate()`
  strings shared by both sides (Cyrillic capitals are mapped explicitly in case the database's `lower()`
  is ASCII-only). Checked against Postgres 18 (PGlite) on 77k names (every answer and word in the data,
  fuzzed look-alikes): no difference from the page. The publish and rename forms also check the name as
  typed, before cleaning drops `@`/`$`/`!`. No Georgian lists.
- Test: `tests/board.e2e.js` (second browser: top five, anon sign-in off/on, swear name, publish, the
  database check, no auto-post).

### Suggest this answer (added 2026-11-05, branch of the suggestions agent)

The owner asked for a way for players to report answers the key is missing, and to see when many people typed
the same one.
- **Player side** (js/app.js, section "suggest an answer"; hooks: one line each in `reject()` and in
  `sprintSubmit()`'s miss branch, so daily, Unlimited, archive/practice, solo Sprint, live Classic and live Sprint
  all get it). After a rejection message, `suggestOffer(raw, pid)` wraps the message in `.sg-msg` and appends a
  `.sg` line inside `#status` (the next `setStatus` wipes it). It first asks `rpc/suggestion_count` (plain REST,
  publishable key, no login library, 6 s timeout); only when that answers does the line show:
  "N other players tried this too" (when more than 3 others) and a quiet **Suggest it** button (`.sg-btn`,
  `tabindex=-1`, mousedown prevented so the answer box keeps focus; focus is handed back after the tap, never out
  of chat). A tap calls `suggestSend`: `loadSupabase()`, anonymous sign-in only if there is no session (never on a
  reject alone), then inserts `{user_id, prompt_id, answer_key: E.fullKey(raw), raw (≤120), source: "tap"}`;
  23505 counts as sent. The line then reads "Sent for review. Thanks." (or "Couldn't send it right now.", or the
  rate-limit sentence). `mlion:suggested` ("<prompt>|<key>" → day, last 400) makes a repeat say it's already sent
  and subtracts the player from the count; `mlion:suggestDay` caps a browser at 50 a day like the database.
- **Nothing shows** when the board isn't configured (`BOARD_ON` false: the Artifact build, file://), in test
  browsers without `MLION_BOARD`, when the count call fails (offline), or after a 404 from it (suggestions.sql not
  run: `suggestBroken` for the session).
- **Counting choice: explicit taps plus an opt-in, nothing automatic by default.** Logging every rejected answer
  would give better counts, but it means sending text people typed without asking, and either an account per
  player made on a reject (the brief said not to) or an anonymous insert endpoint nobody can attribute (no honest
  distinct-player count, trivially spammed). So: a count is distinct players who tapped Suggest it, plus players
  who turned on Settings → **"Send answers the game rejects"** (`settings.shareMisses`, off by default, shown only
  when suggestions can work; rows carry `source: "auto"`). The FAQ says so ("What happens to answers the game
  rejects?"), and "My answer is real but wasn't accepted" now points at Suggest it. The server hides counts under 4
  (`suggestion_count` returns 0), so small numbers never leak.
- **Side effect to know:** a suggest-only player gets the same anonymous account as "Publish my score", and
  `onSession` gives it a profile (named after their Settings name, else "Player"; an empty Settings name becomes
  "Player"). The menu then reads "On the leaderboard as Player", and the admin Players list includes them. Left
  as is to avoid touching the shared login code.
- **Admin** (`#admin` → Suggestions, `adminSuggestions()`): To review / Approved / Rejected; each row has the
  most-used spelling, the prompt, players (taps, sent by setting), first and last seen, an "In the key now" tag
  when the current data already accepts a spelling, the spellings as chips (pick the one to add), Approve, Reject,
  and Undo on reviewed ones. Approving changes no game data.
- **Pulling approved ones** (`tools/pull_suggestions.js`): dry run by default; `--apply` writes into
  data/prompts/*.json line by line (layout kept): a spelling the matcher already corrects to an answer becomes an
  `aka` of it, anything else a new answer with `--tier` (default outlier; the gem is never set by the script);
  spellings already accepted are skipped; every edit is re-parsed and checked before writing. `--mark-pulled`
  stamps `pulled_at` so later runs skip them; `--all`, `--from=<json>`, `--save=<json>`, `--data=<dir>`.
  Key: the project's secret (or legacy service_role) key from `MLION_SUPABASE_SECRET_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` or a file (`--key-file`, `MLION_SUPABASE_KEY_FILE`, default `~/.mlion_supabase_key`);
  never printed; a JWT-style key is also sent as Bearer, an `sb_secret_` key only as `apikey`. Then
  `node tools/build.js && node tests/engine.test.js` and read the diff. Checked against a local stand-in server
  (download, apply, mark pulled, wrong key, key never in output); never run against production.
- **Database: `supabase/suggestions.sql`** (new, additive, NOT applied yet). `answer_suggestions` (PK user,
  prompt, key; checks: prompt id `^[a-z0-9][a-z0-9-]{0,63}$`, key ≤ 80, raw ≤ 120, source tap/auto; no foreign key
  to auth.users, so deleting players or "Reset all players" keeps the queue), a security-definer BEFORE INSERT
  trigger (stamps `user_id = auth.uid()` and `created_at`, refuses a 51st row in 24 h with 54000), RLS: insert own
  rows (`authenticated`, which includes anonymous sign-ins), select for admins only; `suggestion_reviews` (prompt,
  key, status approved/rejected, chosen `answer`, `pulled_at`; admin-only policies); `suggestion_count(prompt,
  key)` (security definer, anon + authenticated: distinct players excluding the caller, 0 below 4, 0 when
  rejected); `admin_suggestions(status, limit)` and `admin_review_suggestion(prompt, key, status, answer)` with
  `admin_guard()`; grants narrowed like the other files, plus `service_role` for the pull script.
- **Tests:** `tests/board.e2e.js` (block "Suggest it": daily count above the threshold, focus and clock kept, no
  sign-in on a reject; Unlimited below the threshold, the tap's row, repeat, rejected-by-admin hides the count,
  offline hides the button, an offline tap fails quietly; Sprint; the opt-in; no table). `tests/admin.e2e.js`
  (Suggestions tab: order, details, approve with a chosen spelling, reject, undo). The SQL itself was run (twice)
  with schema.sql, daily_quiz.sql, admin.sql, names.sql and quiz_speed.sql on PGlite (Postgres 17 in WASM) with a
  stub `auth` schema and roles, and its rules checked one by one (RLS, caps, trigger, count, admin functions,
  service role); that harness was ad hoc (tests/out, not committed), and real Supabase was not touched.

### Per-network rate limits (added 2026-11-05)

The owner wanted our own per-IP limits on every write, adjustable in #admin. (Supabase Auth's limit on anonymous
sign-ins, 30 an hour per IP, is project config the orchestrator manages; not touched here.)
- **Database: `supabase/rate_limits.sql`** (new, additive, NOT applied yet; run it LAST, after suggestions.sql,
  because it adds triggers to the existing tables and skips any table that doesn't exist yet, with a notice).
  `rate_limits(action, per_hour, per_day, note)` (public read; null = no limit, 0 = none allowed), defaults
  profile 60/h 300/day, rename 60/300, daily_score 200/1000, quiz_score 200/1000, suggestion 400/3000 (generous on
  purpose: an olympiad venue or school can put hundreds of players behind one address). A trigger
  `a_rate_limit*` (runs first, by name) on profiles insert (`profile`), profiles update when the name changes
  (`rename`), daily_scores, daily_quiz_scores and answer_suggestions calls `rate_limit_check(action)`: admins are
  skipped; it deletes up to 200 log rows older than 2 days, counts that network's rows for the action in the last
  hour and 24 h in `ip_events(ip_hash, action, at)` under an advisory lock, and past a limit raises SQLSTATE
  **PT429** ("Too many tries from this network. Try again later."), which PostgREST sends as HTTP 429. Only
  `left(sha256(salt || '|' || ip), 24)` is stored; the salt is in `rate_limit_secret` (no API access). No usable
  header → `unknown`: logged, never limited. A refused write rolls back with its log row, so refusals themselves
  aren't counted; the admin view shows who is *at* a limit.
- **Which IP:** `request_ip_info()` reads `request.headers`: `cf-connecting-ip` first, else the **last**
  `x-forwarded-for` value, never the first. Sources: Supabase's own guide uses the first x-forwarded-for value
  (https://supabase.com/docs/guides/api/securing-your-api); a Supabase user showed a forged x-forwarded-for
  arriving as "spoofed,<real ip>" with `cf-connecting-ip` holding the real one
  (https://github.com/orgs/supabase/discussions/34647, unanswered); Cloudflare sets CF-Connecting-IP to the
  connecting client and recommends it over X-Forwarded-For
  (https://developers.cloudflare.com/fundamentals/reference/http-headers/). Supabase doesn't document any header
  as spoof-proof, so this is the best available, not a guarantee. #admin → Limits shows which header the
  admin's own request was read from; to verify on production, send a request with fake `X-Forwarded-For` and
  `CF-Connecting-IP` headers and check the hash doesn't change.
- **Admin** (`#admin` → Limits, `adminLimits()`; `admin_rate_limits()`, `admin_set_rate_limit(action, per_hour,
  per_day)`): per action the limits (editable, Save), writes in the last hour and 24 h; the ten busiest network
  hashes of the last day with an "At the limit" tag; unknown-network writes; how this request was read.
- **Client:** `limitedErr(error)` (PT429, HTTP 429, or Auth's `over_request_rate_limit`) and `TOO_MANY`, in the
  "per-network limits" section; the publish dialog, renames, the post under the results and Suggest it show
  "Too many tries from this network. Try again later." (one-line hooks in loadProfile, postDaily, saveBoardName,
  publishScore, fillBoardBox).
- **Tests:** board.e2e.js (a limited suggestion and a limited publish show the sentence; publish works after);
  admin.e2e.js (Limits tab, edit and save, a player's direct `admin_set_rate_limit` refused). The SQL was checked on
  PGlite: limits per network across accounts, cf-connecting-ip beating a forged x-forwarded-for, last-value
  fallback, unknown not limited but logged, only hashes stored, renames counted only on change, 0 and null,
  admins exempt, admin view, cleanup, and that players can't read the log or salt or change limits.

**Run order on production** (SQL editor, each additive and safe to re-run): `supabase/suggestions.sql`, then
`supabase/rate_limits.sql` (after admin.sql, daily_quiz.sql, names.sql, quiz_speed.sql, which are already applied
or pending as noted above).

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

### The play stage: descent and streak (2026-11-05)

The play stage is the one place that breaks the "no gradients, no glows" rule, on purpose: it
is the lit exhibit.

- **Depth drives everything.** `depthAt(x)` maps the ball's position to depth 0–1. It is
  front-loaded (`1-(1-d)^2`), so a typical run already warms by Q4. Endless runs use
  `1-exp(-x/6000)`.
  - Three acts, blended: a cold, misty plateau; terraced ravines (a step schedule in
    `terrain()`); a basin lit gold from below.
  - Palette keyframes (`PAL`, `lightAt`) move from cold grey to warm gold and set the haze
    and glow strength.
- **Layers.** Four parallax ridge ranges sit in fog. Each has a rim line and two contour
  lines. In front are the ground and its strata lines, then the basin glow.
  - A cached world canvas is redrawn only when the camera or size changes. The ball,
    trail, ripples, sparks and texts are drawn live on top each frame.
- **Camera.** `opts.avoid()` returns the DOM boxes over the stage (`stageBoxes()` in app.js:
  the HUD, dots, meta and streak). The camera solves for the ball's screen height so the path
  stays clear of the top boxes and the ball stays above the bottom ones. If both can't hold, it
  flattens the slope.
  - The camera is eased, with a look-ahead from velocity and a zoom kick on landing.
  - Ridges dip under the boxes, and tick labels fade near them.
  - Call `descent.layout()` after a box changes size.
- **Landing.** The size of the moment scales with the tier through the tables `RIPPLE`,
  `POWER`, `SPARKS` and `KICK`: squash, ripples, sparks, flash and camera kick. A miss dims the
  stage and makes the ball shiver.
  - The ball has a pool of light, an aura, a specular highlight, rim light and a tapered
    trail. At a streak of 3 or more it has fire tongues in the flame colour.
- **Streak.** `streakOf(results)` counts trailing results that have a tier. That means
  accepted answers in Classic and right answers in the quiz formats.
  - `showStreak(n, "set" | "up" | "out")` draws `V.flame(n)` (`FLAME` colours) over the
    stage:
    - 2: orange
    - 3: hotter
    - 4: purple
    - 5: blue
    - 6: white-hot
    - 7 and up: gold with the lion mark and "MLion"
  - `celebrate()` runs when the ball lands. It plays `Sound.streak(n)` (a chord that climbs
    each step, with a buzz), `Sound.quick()` with a "Quick" pill for answers under
    `QUICK_MS` (5 s), and `Sound.fizzle()` with smoke when a streak of 2 or more breaks.
- **Settings.** Sound and vibration are respected through `Sound`/`buzz`.
  - With Reduce motion, animations land at once, there are no effects or idle loop, and the
    flame is static.
- **Idle loop.** It paints at about 30 fps, stops when the tab is hidden, and pauses when the
  stage is off screen.
- **Groove.** The ball sinks `sink()` px (0.38 R, at most 7) into the path. The lit line ends
  behind it, and a soft contact shadow sits under it.
- **Low time** applies to the last 5 s of any answer clock. Classic and quiz call `tense(left,
  el)` from `tickLoop`/`quizTick`; both Sprint clocks call it too, with no stage there.
  - The stage's colour drains (a `saturation` fill), and dark fog closes in on the ball.
  - The stage edges beat red with `Sound.heart`: a lub-dub of two `thump`s and a low `voice`,
    with a buzz. The beat speeds up from about 60 to about 125 bpm.
  - The ball trembles, and the clock number pulses (`.tbeat`).
  - `tenseEnd(exhale)` runs from `finishRound`/`finishQuiz`, `stopRun`, the live round and skip
    handlers, and the Sprint ends. On a beaten clock it adds `Sound.exhale` and a breath of gold
    at the ball.
  - Descent API: `tension(k)`, `beat()`, `release(exhale)`.
  - Reduce motion gives one still tint, with no beat and no tremble.
- **Jackpots** are only for Outlier, Long Tail and MLion. They fire in `celebrate()` when the
  ball lands, through `jackpot(tier)`:
  - a full-stage flash in the tier colour, and coins from the ball (`JACKPOT` in landscape.js);
  - the rarity word: "Rare", "Ultra rare" or "Legendary". `placeJackpot` puts it in the open
    air above the ball, or below it when the stage is short or the lion fills it. It uses
    `descent.spot()`.
  - the HUD score flares;
  - `Sound.jackpot` plays a coin shower, and the streak chord steps aside for it.
  - `Sound.tier` also ticks the score up through a pentatonic run while the ball rolls.

  The common tiers keep only their old ripple and sparks.

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
- Overnight 2026-11-05 additions: `tests/pwa.e2e.js` (manifest, precache list, offline daily),
  `tests/preboot.e2e.js` (first-visit hero before the data arrives; runs in `npm run e2e:pwa`), the
  daily-quiz and quiz-board blocks above, `tests/live.topics.e2e.js` (live topic filter), and
  `tools/matchbench.js` (autocorrect benchmark, pinned in the engine test: right >= 97%, wrong
  <= 1%, false accept <= 1%).
- Quiz (2026-11-05): `tests/engine.test.js` has 13 quiz checks (determinism, one right option, no wrong option
  the matcher accepts, off-topic excluded, small bundles). `tests/quiz.e2e.js` plays a solo run and a
  `#vq-` challenge. `tests/live.quiz.e2e.js` and `live.rejoin.e2e.js --quiz` play a live Quiz match.
  Not verified on a real phone or on the claude.ai Artifact build (live is disabled there anyway).
- Music (2026-11-05): `tests/music.e2e.js` (integration in the real page) and `tools/music-render.js`
  (offline renders and loudness measurements). Never listened to; see "Background music" at the end.
- Share card (2026-11-05): `tests/sharecard.e2e.js` opens the sheet on a daily, a challenge and a Daily
  Quiz result (desktop and an iPhone-sized phone, share and clipboard mocked): real 1200x630 and
  1080x1920 PNGs under 300 KB, Copy image writes one image/png item, Share image passes one PNG File,
  refused share saves, cancelled share does nothing, the text grid still copies, no page errors.
  `e2e.js` and `quiz.e2e.js` now reach the text grid through the sheet's `#card-text`.

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
  #chat-badge #chat #chat-log #chat-input #chat-note #chat-peek #card-img #card-text #card-copy
  #card-share #card-save`, and others
  listed in the redesign brief.
- The user doesn't want the live site changed while they're playing. **Ask before pushing**
  when they're in a session.
- The user is cost-sensitive. Prefer cheaper or batched agents; don't fan out per-prompt Opus
  agents.
- Commits end with the session's Co-Authored-By and Claude-Session trailers. Don't put model
  names in repo files.

---

## 11. Open items and next steps

- **Pre-launch fixes (2026-11-05, audit items B1, S7, S10, N7, S15, S14, S16/S5 behaviour, S12):** done in
  code; the owner still has to run `supabase/names_v2.sql` in the SQL editor (after `names.sql`), and
  follow "Launch-day steps" in §3. Not changed on purpose: the daily prompt pool (audit S6: with 71
  pool prompts the first repeat comes on day 11, and 210 of 400 days reuse a prompt from the previous six;
  the Daily Quiz does on 41 of 400). The owner decides.

0. **Overnight 2026-11-05 (branch `overnight`, not pushed):** paste `supabase/daily_quiz.sql` into the
   Supabase SQL editor to open the quiz leaderboard; test locally; then merge `overnight` into
   `claude/mlion-game` and push. The new mark (Leo's curve and the ball) replaced the lion badge
   everywhere: favicon, icons, og.png. Worth a real-phone check: Sprint (solo and live), the 3D
   home, vibration, install.

1. **Verify on real phones:** the live autocorrect-help setting, masked typing, no-repeat
   questions, the kick-out fix, and chat with the phone keyboard open (the panel follows
   `visualViewport`; only desktop and emulated phone sizes were checked). Ask the user what the screen says if anything
   fails.
2. **Public broker risk:** shiftr.io's public instance is shared and unauthenticated. Since the 2026-11-05
   hardening, room traffic is sealed with the link's secret and the host re-judges answers (see "What the
   hardening blocks" in §7), so outsiders can't read or forge rooms; they can still flood, fake open-room
   listings, and the instance has no published quota or SLA. Members holding a link can still impersonate
   each other (needs per-player signatures). An own broker (shiftr Plus) or Supabase Realtime would be more
   robust; the sealed protocol works unchanged on either.
3. The never-written new prompts from the stopped workflow (special-token, numpy-function,
   turing-award, ai-leader, calculus-concept, and classic-cv / tabular-dataset in place of
   classic-cv-algo / classic-dataset were written overnight 2026-11-05). The original list of 46:
   microsoft-model, nvidia-model, chinese-lab-model,
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
6. Multiplayer formats: private rooms allow up to 12 players free-for-all; public
   rooms are duos. 2v2 teams is a future request from the user.
7. Explanation coverage is 30% of all answers (7,077 of 23,500): every core Baseline, Overfit and One in a
   MLion answer has one, In-Distribution 84%, Outlier 36%, Long Tail 12% (extras included). The rest is a content job (mind cost);
   generic answers ("Bad hyperparameters") were skipped on purpose.
8. Launch mode hides question picking only on the client (see §7 Routes).
9. Optional: a proper `main` branch. Pages currently serves from `claude/mlion-game`, so moving
   it means changing the Pages source.
10. `.taste-skill/` was meant to be gitignored, but that edit never ran.
11. Quiz follow-ups: a wrong option can be a real member of the category the answer list lacks (lists are
    incomplete); the host can't switch format from the podium; live quiz answer times are self-reported
    (clamped by the host). The Daily Quiz board needs `supabase/daily_quiz.sql` applied.
13. **Suggestions and rate limits (2026-11-05):** run `supabase/suggestions.sql`, then `supabase/rate_limits.sql`,
    on production; check on the live site that a request with forged `X-Forwarded-For`/`CF-Connecting-IP` headers
    keeps the same hash (#admin → Limits shows the source); pull approved suggestions with
    `tools/pull_suggestions.js`. Open: suggest-only players get a "Player" profile (see "Suggest this answer");
    refusals aren't logged; nothing tried on a real phone.
12. First load: `js/data.js` is 2.4 MB (about 730 KB gzipped). A first visit to home no longer waits
    for it: an inline script in `index.html` draws the home hero at once, and `renderHome()` builds the
    full home around that same node (measured, slow 4G with a 4x slower CPU: hero at 1.1 s instead of
    5.3 s; the full home still arrives at 5.3 s). Returning players and deep links keep the spinner,
    but the service worker serves them from cache. Keep the two hero markups in step;
    `tests/preboot.e2e.js` fails if their words or positions differ. Splitting data.js itself (the
    daily first, the rest later) is still open, for deep links on slow phones.

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
node tests/live.e2e.js           # needs network to public.cloud.shiftr.io (MQTT.js is vendored)
node tests/live.security.e2e.js  # no network: outsider attacks, a dishonest guest, open rooms, ten players
```

To deploy, push to `claude/mlion-game`. GitHub Pages ("Deploy from a branch", root) rebuilds
in about 30–60 s. Cache-busting means phones load the new code on their next full load.

### Ball seating and synthesised sounds (2026-11-05, late)
- The ball's centre is `ballAt(x, R)` in js/landscape.js: one radius along the slope's normal, so it
  touches the path at its contact point (it used to sit straight above it and float beside the landing
  dot on slopes; user screenshot). The landing mark under the ball is hidden while the ball stands on
  it, and the wake follows the same centre. Squash happens against the ground's tangent.
- `Sound` in js/app.js is all Web Audio, no files: a compressor bus plus a generated 1.1 s room
  (convolver on decaying noise), FM bells (ratio 3.5) for right answers and streak chords, filtered-noise
  whooshes/hisses/shimmer, a pitch-dropping sine thump for landings. Rarer tiers get longer, higher bell
  runs; mlion adds a held saw chord and a high sparkle. Same method names as before (tick, reject,
  submit, miss, chat, tier, streak, quick, fizzle), so call sites are unchanged. Not listened to by the
  session that wrote it (headless); tune by ear.

### Background music (`js/music.js`, 2026-11-05)
A generative ambient score in Web Audio, with no files and no libraries. It gets warmer and fuller as
the ball goes deeper (as Krillion's does, but nothing is taken from it). It is faint on purpose: at the
default volume it sits about 15 dB under the answer sounds.

**The brief, from research.**
- *Vertical layering* keyed to one game parameter, the ball's depth. Layers fade in and out; nothing
  re-sequences (Wwise/FMOD practice; Mini Metro's generative score).
- *Generative, not looped.* Markov chords, random-walk arpeggios behind probability gates, and Eno-style
  loops of incommensurable lengths. It never repeats audibly, which matters in a game played every day.
- *Duck under every effect.* Words come first, the music is room tone.
- *A low-time cue by subtraction, not addition.* The music thins, so the clock's ticks stand out. An
  urgency layer would compete with them.
- *Avoid the cheap-synth sound.* That sound comes from raw saw or square waves, exact tuning, grid-exact
  timing, flat velocities, dry output and close-voiced low thirds. So the score uses soft wavetables,
  two detuned drifting oscillators per pad voice, humanised timing (up to 20 ms late) and velocity,
  S-curve swells, wide voicings and a long dark hall.
- *Web Audio hygiene.*
  - A lookahead scheduler ("A tale of two clocks": a 50 ms timer schedules 0.35 s ahead on the audio clock).
  - Capped voices, k-rate automation where a-rate is not needed, nothing connected while stopped.
  - The context is touched only inside a user gesture (autoplay policy; on iOS, resume only in a gesture).

**Harmonic plan.** Only white keys are used (A minor and C major share them), so nothing rubs against the
effect bells on C, E and G (mlion root 523.25 Hz). A depth of 0 is the misty plateau and 1 is the gold
basin.

| Depth | Chords | Voicing | Register |
|---|---|---|---|
| Plateau (~0) | Am, Em: open fifths and ninths, no thirds | cold | high (pads around E4 and up) |
| Ravines (~0.3–0.6) | Dm, G, with a bass that prefers to *fall* 1–4 semitones (the descent heard as a bassline) | mid (seventh chords) | lower |
| Basin (~0.9) | F and C: maj7, then add9; F sometimes maj7#11 (the "glow") | warm (ninth chords) | low and full (pads from B2) |

- Each chord has a `home` depth. `choose()` weights the `NEXT` Markov graph by a gaussian fit to the
  current depth (σ 0.2) and halves the chord it just came from (no A-B-A rocking).
- A chord lasts 2–4 bars (4–5 in menus) of 3.75 s (64 bpm in eighths). Pads strum in over 1.6–4.8 s and overlap the
  next chord, so there is no gap.
- The results screen plays a cadence: F (or straight on from F or G), then C held for 5 bars. Its warmth
  follows the run's final depth.
- A gem (mlion tier) queues C at the next bar line and glows (pads brighter and louder for a few seconds).

**Layers** (weights follow the landscape's own acts: `acts(d)`, breakpoints 0.16–0.40 and 0.62–0.88):

| Layer | What it is | Where |
|---|---|---|
| pad | 2 detuned soft-wavetable oscillators per voice, slow LP; brightness rises with depth (4 wavetables) | always (0.85 to 1) |
| air | looped pink noise through a wandering band-pass: wind | plateau and menus |
| far | glassy distant notes from three loops of 7.7, 12.3 and 18.1 s (1, 2 or 3-note fragments), mostly hall | everywhere, most on the plateau |
| bass | the chord root, A1 to G#2, high-passed at 38 Hz | ravines and basin |
| pulse | soft plucked root/fifth in three bar shapes (3-3-2, quarters, sparse) | ravines only |
| arp | high glass random walk over chord tones (C5–G6) with a 23 s breath, ping-pong delay | basin; denser with the streak |

All of it runs into a dark 2.6 s hall plus a small send to Sound's room, then a high-pass ("thin"), a
low-pass ("tone"), the duck gain, the output gain and the gate. Spectral targets were checked on renders:
- nothing above 5 kHz;
- 2–5 kHz under 1%;
- a −3.5 dB dip at 300 Hz on the pads, against mud;
- spectral centroid of 750 Hz on the plateau, 450 Hz in the ravines and 360 Hz in the basin.

**Reactions.**
- *Duck.* Every `Sound` method call ducks the music. This is per effect, so Sound's API is unchanged.
  - The tier duck grows with rarity: baseline −5 dB, mlion −10 dB with a long release.
  - Streak −6, miss −5, ticks −1.5.
  - Rare tiers (outlier, longtail, mlion) get an answering distant note on the bell's pitch class about
    1.7 s later.
- *Streak.* The output swells +0.2 dB per level (up to 7), the pads get brighter and the arpeggio gets
  denser. A miss or fizzle resets the streak and darkens the tone toward 1 kHz for a few seconds.
- *Low time.* From 6 s left to 0.5 s left, tension rises from 0 to 1:
  - the pulse and arp stop (tension above 0.35) and the far notes stop (above 0.5);
  - the low-pass closes from 11 kHz to 1.3 kHz and the high-pass rises to 330 Hz;
  - pads −30%, so the music drops 1–3 dB.

  The ticks (1.7–2.6 kHz clicks) stay clear: in their own band they measure 15–25 dB above the music.
- *Results.* The cadence to C, 1.5 dB under play level; after 24 s it settles to menu level.
- *Menus.* A calm variant: plateau harmony at depth 0.06, −3 dB, fewer far notes. It is not silence, so
  the home screen breathes. Set `SCENE_DB.menu` very low or stop in `view()` to silence menus instead.
- *Hidden tab, pagehide, Sound off, Music off, volume 0.* A quick fade, then every voice is stopped and
  the bus is disconnected 1.5 s later (idle cost is about 0). It comes back on visibility or settings.

**Hooks** (all in `js/app.js`, all no-ops if music.js is missing; each call is wrapped so it can never
throw into the game):

| Hook | Where it is called | What it does |
|---|---|---|
| `Music.view(name)` | inside `scene(view)`, so every screen | `"play"`, `"results"`; anything else is a menu |
| `Music.depth(d)` | in the play shell's `onFrame`: `Music.depth(V.depthAt(x))` | the ball's live depth, 0..1 |
| `Music.resolve(d)` | `renderResults`: `Music.resolve(V.depthAt(rec.score * 10))` | the cadence's warmth (clamped to 0.3..1) |
| `Music.clock(ms)` | `tickLoop` and `quizTick`, right after `left` is computed | **the one low-time hook**: ms left on the answer clock, called every frame the clock shows. If it is not called for 0.4 s, the tension releases by itself, so no "clock stopped" call is needed. Other low-time visuals can call it too; it is idempotent. |
| `Music.duck(kind, arg)` | automatic: app.js wraps every `Sound` method except `unlock` and `graph` | duck, streak, miss and gem handling |
| `Music.sync()` | `saveSettings()` and the volume slider | start or stop for settings |
| `Sound.graph()` | new, the only addition to `Sound` | `{ ctx, room }` once Sound has a context, else null. Music never creates the context itself, so nothing plays before a gesture. |

**Settings.**
- `music` (default true) and `musicVol` (0..1, default 0.5, a 0–100 slider, live while dragging).
  They sit in the "Feel" group under Sound.
- The rows dim while Sound is off. The music never plays without Sound.
- Volume maps to gain as `(v/0.5)^1.2`, so 50 is the calibrated level and 100 is +7 dB.

**Cost.** At most 40 oscillators (pads may use all of them; optional layers stop at 32). Renders peak at
20–22 oscillators on the plateau and in menus and 32–37 elsewhere. Offline rendering of 60 s takes 1.4 s of CPU in the basin (about 2.3% of one desktop core).
- A stopped engine costs ~0.
- Not measured on a phone. If a phone struggles, cut the hall IR length (`hallIR(ctx, 2.6, …)`) or
  `MAX_OSC` first.

**Verification tools.**
- `node tools/music-render.js <outdir> [name ...] [--solo]` renders scripted sessions offline.
  - It runs headless Chromium with an OfflineAudioContext, the real `Sound` extracted from app.js, and a
    seeded RNG, so stems line up.
  - Scripts: `fx_reference`, `state_menu|plateau|ravine|basin|basin_streak7|lowtime|results`,
    `transition_sweep` (0→1 over 76 s) and `demo` (a 90 s descent with answers, a timeout and a gem).
  - Output: a mix, a music stem and an effects stem per script, plus BS.1770 loudness (integrated,
    momentary, short-term, true peak), band shares and a per-second trace in `report.json`. It also
    prints effects-vs-music gaps.
  - `--solo` renders each layer alone.
- `node tests/music.e2e.js` checks the integration in a real page.

**Measured (2026-11-05, default volume).**
- Music integrated loudness:

  | State | LUFS |
  |---|---|
  | menu | −46.3 |
  | plateau | −44.0 |
  | ravine | −41.2 |
  | basin | −40.3 |
  | basin, streak 7 | −39.1 |
  | low time | −42.1 |
  | results | −42.1 |

- Answer sounds peak at −29.3 (overfit) to −22 (mlion) LUFS momentary.
- Tier-to-music gaps are 13.6–21 dB, mostly 15–17. Streak chords sit 9.5–16 dB above.
- Music alone peaks around −28 dBFS. The 90 s demo mix measures −36.3 LUFS with a −12 dBFS peak and 0
  clipped samples.

**Unverified.**
- Never listened to: everything above is measurements of headless renders.
- Not run on a phone or in iOS Safari. iOS can suspend the context after interruptions; the
  `statechange` listener and gesture handlers resume it, but untested there.
- Menus and the home page are silent (owner, 2026-11-05: "before u click stuff audio should be very very quiet... or remove it"): `wanted()` needs a play or results view. MASTER was also halved (about −6 dB) after the first listen. Tune by ear with `LEVEL`, `MASTER`,
  `SCENE_DB`, `DUCK` and `TIER_DUCK` at the top of music.js. Then re-render and check that the gaps
  stay 12–18 dB.
