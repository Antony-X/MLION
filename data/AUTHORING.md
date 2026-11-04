# Writing MLion prompts

Every prompt lives in its own file, `data/prompts/<id>.json`. `node tools/build.js`
validates all of them and bundles them into `js/data.js`, which the game loads.
Look at `data/prompts/activation-function.json` for a finished example.

## File format

```json
{
  "id": "activation-function",          // kebab-case, must equal the file name
  "pack": "blocks",                     // blocks | zoo | classic | llm | stack | theory | lore
  "text": "Name an activation function",// always starts with "Name "
  "note": "Any nonlinearity used inside or at the output of a neural network",
  "strip": ["activation", "function"],  // optional filler words ignored when matching
  "answers": [
    { "a": "Snake", "t": "mlion", "aka": ["snake activation"], "q": "x + sin²(αx)/α ..." },
    { "a": "ReLU",  "t": "baseline", "aka": ["rectified linear unit"] }
  ]
}
```

- `a`: the canonical display name, spelled the way the field writes it (`ResNet`, `XGBoost`, `t-SNE`).
- `t`: the rarity tier (below).
- `aka`: other names that count as the same answer: abbreviations, the expanded name,
  former names, the PyTorch/Keras class name, and well-known nicknames. Optional.
- `q`: a quip shown when someone lands the answer, at most 140 characters. Make it witty
  and factually right. Optional.
- `note`: internal scope notes, at most 160 characters. Players never see it; it's context
  for reviewers and for the Claude answer check. Use it whenever the boundaries could be argued about.
  What players see is set in `data/display.json`: an `(e.g. …)` example, which defaults to the
  first baseline answer, and an optional one-line `scope` that must not name any answers.
- `strip`: words that get dropped from both the player's input and the answer keys before
  comparing. This lets "Huber loss" match `Huber` when `strip` contains `"loss"`.
  Only list generic words that never tell two answers apart.

## Matching

The engine already handles these, so **don't** add aliases for them:
- case, spacing, hyphens and punctuation (`leaky-relu` = `Leaky ReLU` = `leakyrelu`)
- accents, Greek letters (`β-VAE` = `beta vae`), `+` read as "plus", `&` as "and"
- a leading "the/a/an", and simple plurals (`GANs` → `GAN`)
- typos of one or two characters: autocorrect offers the nearest answer

The engine also handles these:
- initials of multi-word names (`recurrent neural network` ↔ `RNN`, `support vector machine` ↔ `SVM`)
- `v` before a version number (`YOLOv8` = `YOLO 8` = `yolo v8`) and number words (`zero-shot` = `0-shot`)
- the words "model", "algorithm", "method", "technique", "framework" and "library"
- near misses: a trigram-similarity index proposes "did you mean…?" suggestions

**Do** add every other way people actually write an answer. Be generous, because a player who
knows the thing but types it differently should never be rejected:
- abbreviation ↔ expansion when the initials aren't obvious (`k-NN` / `nearest neighbors`, `t-SNE`)
- former names, nicknames and marketing names (`Bard` → Gemini only if you merge them; `SD` / `SDXL`)
- vendor or org prefixes (`Meta Llama 3`, `Google Gemma`, `OpenAI o1`)
- the paper title or method name when the model is known by both (`Segment Anything` / `SAM`)
- alternate spellings (British/American, `Kullback–Leibler` / `KL`), and the framework class name
  (`nn.LayerNorm`, `sklearn RandomForestClassifier`)
- a variant you decided not to list separately (`GPT-4 Turbo` as an alias of GPT-4)

No two answers may share a name or alias once normalized; the validator rejects collisions.
When an abbreviation is ambiguous, give it to the most canonical answer only.

Size variants (ResNet-50, Llama 2 70B, BERT-large) are **aliases** of their family. A distinct
named successor or release (ResNeXt, Llama 3, GPT-4o, RoBERTa) is its **own answer**.

## Rarity tiers

Picture 1,000 ML people (grad students, ML engineers, Kaggle regulars, hobbyists who read
papers), each with 25 seconds to answer the prompt. The tier reflects the share who'd type it.

| tier | points | who types it | per prompt |
|---|---|---|---|
| `baseline` 🐑 | 10 | the obvious first answers, top of mind for most people | 2–6 (max 8) |
| `overfit` 🦜 | 15 | the famous "obscure" pick: what people type to look clever, so common it's a trap | 0–3, usually 1–2 |
| `indist` 📊 | 30 | standard material from courses, textbooks and framework docs | ~15–25% |
| `outlier` 🦄 | 60 | known to experienced practitioners, shows up in papers and docs | ~20–30% |
| `longtail` ☄️ | 85 | niche, historical, specialized or rarely used | the rest, often the biggest group |
| `mlion` 🦁 | 100 | **exactly one** designated gem per prompt | 1 |

Visibility sets the tier: how often a name shows up in intro courses, popular blog posts,
framework docs, paper citations and ML social media. More visible means a shallower tier.
Rank by familiarity, not by how good the thing is.

The `mlion` gem is chosen for delight, not pure obscurity. It should be real, satisfying to
land, and recognized by a few strong players, with a fun name or story. Never pick the single
most obscure item. Every gem gets a quip.

Every `overfit` answer also gets a quip, and roughly a quarter of the other answers should too.

## Coverage

The goal is that **any legitimate answer a knowledgeable player types gets accepted**. Be
exhaustive: broad categories should reach 80–250+ answers, and closed sets should list every
member. Include historical, niche and regional items, and newer ones up to the present.

Only real, verifiable items. Never invent a model, paper, person or technique. If you're
unsure something exists, or what it's called, leave it out.

## Checking your work

```
node tools/build.js --check data/prompts/<id>.json   # validate one or more files
node tools/build.js --stats                           # validate all + per-prompt tier counts
node tools/build.js                                   # validate all + rebuild js/data.js
```
