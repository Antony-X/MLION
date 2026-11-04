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
js/landscape.js       topographic backdrop, 3D ridge-line landscape scene, Descent canvas, tier glyphs, ∇-lion mark
js/app.js             everything else: routing, round state machine, results, challenge, live match, settings
data/packs.json       7 packs (id, name, emoji, tagline)
data/prompts/*.json   134 prompt files, one per prompt (schema below)
data/display.json     per-prompt example / scope / offtopic overrides
data/AUTHORING.md     authoring spec (schema, alias rules, tier calibration)
tools/build.js        validate every prompt + write js/data.js + cache-bust index.html
tools/build-single.js bundle everything into one HTML file (Artifact build)
tools/probe.js        check candidate answers against a prompt (EXACT/CORRECT/SUGGEST/NONE)
tests/engine.test.js  normalization, matcher layers, self-match of every alias, 365-day schedule
tests/e2e.js          Playwright: full daily, autocorrect, chips, reload-timer, share, challenge flow
tests/live.e2e.js     Playwright: 3 browsers, live match + chat over the real MQTT broker
tests/live.rejoin.e2e.js  Playwright: a guest drops ~10 s mid-match and must keep their seat
README.md, package.json, .nojekyll (needed for Pages)
```

### npm scripts

```
npm run build      # node tools/build.js
npm run stats      # node tools/build.js --stats
npm test           # build + engine tests
npm run e2e        # node tests/e2e.js           (add --fixture to use clone data, --fonts to load Google Fonts)
npm run e2e:live   # live.e2e.js then live.rejoin.e2e.js (needs network: unpkg.com + public.cloud.shiftr.io)
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
| `#packs`, `#pack-<id>`, `#pack-<id>-N` | packs, pack detail, pack run |
| `#archive`, `#archive-YYYY-MM-DD` | archive, a past day |
| `#library`, `#practice-<id>`, `#answers-<id>` | library, practice one prompt, its answer key |
| `#results-<key-with-dashes>` | a run's results |
| `#stats`, `#how`, `#faq`, `#prefs` | stats, how to play, FAQ, settings |
| `#challenge`, `#vs-…` | challenge setup, a challenge link |
| `#live`, `#live-<code>` | live match setup, a room |
| `#rooms` | public room list |

### Round state machine

intro → preview (3 s, input locked) → answering (25 s) → feedback → next.

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
- Sizes: 3, 5, 7 or 10.
- "Send link now" lets both players start at once; otherwise one plays first and sends.
- The friend sees the challenger's result after each answer, then a head-to-head board and
  "Send result back".
- In the Artifact, links point at the claude.ai URL. **Not verified:** that claude.ai passes
  `#vs-…` hashes through to the page. The platform docs say plain `#name` hashes pass.

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
ball into the ∇-lion and floods the stage gold.

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
6. Optional: a proper `main` branch. Pages currently serves from `claude/mlion-game`, so moving
   it means changing the Pages source.
7. `.taste-skill/` was meant to be gitignored, but that edit never ran.

---

## 12. Running locally

```bash
git clone https://github.com/Antony-X/MLION && cd MLION
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
