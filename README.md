# MLion · the daily descent

**One in a MLion.** A daily machine-learning word-rarity game. You get seven prompts a day,
the same for everyone: *Name an activation function. Name a loss function. Name a vision
transformer. Name a Greek letter used in ML notation.* Any valid answer is accepted, and
rarer answers score more. Type `ReLU` and you barely move. Type `Snake` and you hit the
global minimum.

## How to play

- Each prompt shows for **3 seconds**, then a **25-second** clock starts.
- If an answer isn't in the key you see *"no gradient"*. Keep trying until time runs out.
  If time runs out with something typed, it's submitted automatically.
- Close misspellings trigger **autocorrect**, which proposes the nearest accepted answer for
  you to confirm.
- Accepted answers roll your optimizer down a loss landscape. Your loss starts at 7.00 and
  drops by points ÷ 100.

| tier | points | meaning |
|---|---|---|
| 🐑 Baseline | 10 | the answer everyone blurts out |
| 🦜 Overfit | 15 | the famous "obscure" pick everyone memorized |
| 📊 In-Distribution | 30 | solid, standard material |
| 🦄 Outlier | 60 | genuinely uncommon |
| ☄️ Long Tail | 85 | true obscurity |
| 🦁 One in a MLion | 100 | the one designated gem per prompt |

The max is 700 a day. Score bands: Underfit 0–150 · Converging 151–250 · Generalizing
251–350 · State of the Art 351–449 · One in a MLion 450+.

### Modes

- **Live match** (GitHub Pages build): rooms over a public MQTT relay. Both players tap Ready, questions start together, you watch each other type, and the next question waits for everyone. Public duo rooms are listed at `#rooms`.

- **Daily descent**: resets at local midnight, with streaks and a shareable emoji grid.
- **∞ Unlimited**: endless 7-prompt runs dealt from the whole pool.
- **Quiz**: the same prompts as multiple choice. Four answers, one fits; 100 a right answer, seven a run. Challenge a friend with a quiz link, or pick **Quiz** as the format of a live room (equal points: the faster total time wins).
- **Themed packs**: Building Blocks, The Model Zoo, Classical ML, The LLM Era, The Stack,
  Math & Theory, Lore & Legends.
- **Archive**: replay any past daily.
- **Library**: practice any single prompt. Its full answer key unlocks once you've played it.

Progress, streaks and settings stay in your browser's local storage. There are no accounts,
no servers and no tracking.

## Run it

It's a static site with no build step and no dependencies. Open `index.html`, or serve the
folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

To publish on **GitHub Pages**, go to Settings → Pages and deploy from the branch root.

## Answer sets

Each prompt is a JSON file in [`data/prompts/`](data/prompts). Every answer has a tier,
optional aliases (`aka`) and an optional quip. [`data/AUTHORING.md`](data/AUTHORING.md)
covers the format, the matching rules and how rarity is calibrated.

```sh
node tools/build.js           # validate every prompt + rebuild js/data.js (the game loads this)
node tools/build.js --stats   # per-prompt tier counts
node tests/engine.test.js     # matching, scheduling and scoring checks
node tests/e2e.js             # plays a full daily in headless Chromium (needs Playwright)
```

The validator rejects alias collisions, duplicate answers, a missing or extra 🦁 gem, and
bad tiers. Matching ignores case, punctuation, accents and plurals, reads Greek letters
(`β-VAE` = `beta vae`), and drops per-prompt filler words (`"Huber loss"` → `Huber`).
Autocorrect then allows one or two typos depending on length.

Found a real answer that isn't accepted? Open an issue or a PR that edits that prompt's JSON file.

## Layout

```
index.html          app shell
css/style.css       styles
js/engine.js        tiers, matching, autocorrect, schedules, share text (shared with Node tools)
js/landscape.js     topographic backdrop + gradient-descent canvas
js/app.js           screens, round state machine, storage
js/data.js          generated bundle of all prompts
data/prompts/*.json one file per prompt
tools/build.js      validator + bundler
tests/              engine tests and the Playwright end-to-end test
```

MLion borrows the format of daily rarity games, where obscure answers beat obvious ones, and
gives it a machine-learning world of its own.
