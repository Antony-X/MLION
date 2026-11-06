# Player levels

Every player has a level. It grows with the XP they earn by playing, and it never goes down. This file explains
what earns XP and why, the curve, where levels show, how a new player first meets them, and what was left out
on purpose. The code is in `js/engine.js` (section "levels": the rules and the curve) and `js/app.js` (section
"levels": storage, screens and the level-up moment). The styles are in the "levels (XP)" block at the end of
`css/style.css`. Tests: `tests/levels.e2e.js`.

## What levels are for

MLion already says how well you played: the score, the score band, the tiers and the streak. A level says
something different: how much you have played, and that it is adding up. It is the "change in a piggy bank"
that Nintendo describes for the Fit Meter. It is not a verdict.

Three findings shaped the design.

- **Expected, contingent rewards can crowd out the fun. Informational feedback does not.** Deci, Koestner and
  Ryan's meta-analysis (1999) found that engagement-, completion- and performance-contingent rewards lowered
  free-choice motivation (d = -0.40, -0.36, -0.28). Positive feedback raised it (d = 0.33). In Mekler et al.
  (2017), points, levels and leaderboards raised *how much* people did, but not their intrinsic motivation or
  the quality of their work. Sailer et al. (2017) found that badges, leaderboards and performance graphs do
  raise felt competence. So a level here is feedback: you earned it, it grows, it shows where you stand. It
  is not a prize that unlocks things, and the game never dangles it ("play 3 more to level up!").
- **Never take anything away.** Pokémon GO's 2025 levelling update promised "No players will drop in level".
  chess.com's leagues say "There are no demotions". WoW's rested XP is the classic lesson. In beta, XP fell from
  100% to 50% for players who played too long, and testers hated it. The same rule, reframed as 200% falling to
  100%, was loved: "It's the exact same mechanic, but now it's a bonus instead of a punishment" (Rob Pardo, GDC
  2010; J. Allen Brack said the same). MLion's limit on practice XP is told the same way: a pool that refills
  each day.
- **Unlimited farming is how XP systems go wrong.** Duolingo players farm XP by "repeating easy exercises" (Kotaku).
  Brawl Stars capped the XP for its Experience Levels each day, and later capped Mastery Points the same way,
  "a good reminder to take a break". Clash Royale removed XP and King Level in May 2026, saying "the further you
  progress, the more the pace of King's Journey slows down". Nintendo built stopping points into Brain Age
  Express and tells Ring Fit beginners to keep to about 30 minutes a day.

## What earns XP

| What | XP | Why |
|---|---|---|
| An accepted answer (daily, Unlimited, challenge) | 2 (Baseline), 2 (Overfit), 3 (In-Distribution), 5 (Outlier), 7 (Long Tail), 10 (One in a MLion) | Rarer answers earn more, as they score more. A common answer still earns, so a beginner climbs too. |
| A right quiz answer (Quiz, Daily Quiz, quiz challenge, live Quiz) | 2 (easy), 3 (medium), 4 (hard) | Harder questions earn more. A question made from a prompt counts as medium. |
| A Sprint answer (solo or live) | 1, 1, 2, 3, 4, 5 by tier | About half, because a sprint names many answers a minute. |
| Finishing the daily or the Daily Quiz | +20 each | Each can be played once a day, so this can't be farmed. It is earned even on a bad day: showing up counts. |
| Finishing a live match | +5, plus the answers | Playing with friends is the game's favourite way to play. |
| A miss, a skip, a wrong quiz pick, a typo the game didn't accept | 0 | XP never goes down, so a miss costs nothing. Junk typed into the box earns nothing either. |

A typical word daily is worth about 45 XP and a Daily Quiz about 35. A typical first daily reaches Level 2
(30 XP), so the level-up moment arrives early. An archive daily (a past day) counts as practice, without the
+20, so old dailies can't be farmed.

**The daily practice pool.** Everything except the two dailies is practice. Each day, practice XP counts in
full up to 60, then each XP counts a little less, and one day of practice never adds more than 160
(`E.practiceXp`):

| Practice XP earned in a day | 30 | 60 | 90 | 120 | 180 | 240 | 360 | 600+ |
|---|---|---|---|---|---|---|---|---|
| Counts as | 30 | 60 | 86 | 105 | 130 | 143 | 155 | 160 |

About ten minutes of Unlimited fills the full-rate part of the pool. Three hours of sprints, or one memorised
sprint replayed sixty times, still adds 160 at most. More play always adds a little, so the pool is never a
wall. The dailies always count in full. When a run adds much less than its answers were worth, the result says
"You've earned most of today's practice XP. It refills tomorrow." The day is the player's local date when the
run finished.

## The curve

Level 2 begins at 30 XP. Each early level costs 20 more than the one before (30, 50, 70, ..., 390). From Level 20
on, every level costs a steady 400 XP (`E.levelCost`, `E.levelFor`).

| Level | 2 | 3 | 4 | 5 | 10 | 20 | 30 | 50 | 100 |
|---|---|---|---|---|---|---|---|---|---|
| Starts at (XP) | 30 | 80 | 150 | 240 | 990 | 3,990 | 7,990 | 15,990 | 35,990 |

Levels after 1 day, a week, a month, three months and a year of play:

| Player | 1 d | 7 d | 30 d | 90 d | 365 d |
|---|---|---|---|---|---|
| The word daily only | 2 | 5 | 11 | 20 | 51 |
| Both dailies | 3 | 7 | 15 | 28 | 83 |
| Both dailies and 10 minutes of practice | 3 | 9 | 20 | 41 | 137 |
| Both dailies and 30 minutes of practice | 4 | 12 | 25 | 57 | 201 |
| Both dailies and 3 hours of practice | 5 | 13 | 28 | 64 | 229 |
| 10 minutes of practice, no dailies | 2 | 6 | 13 | 23 | 64 |

The early levels come every day or two, so a new player feels movement. After that, a level takes about five
days of both dailies, so it stays an event. The curve is linear from Level 20 rather than steeper. Steam
(100 XP a level, rising every 10 levels) and Pokémon GO (each level costs about three times more every ten
levels) get steep because they have no cap on earning. MLion caps earning per day instead, so a steeper curve
would only make the level freeze for loyal players. Over a year, three hours of practice a day earns about 3x
the XP of both dailies alone, and about 1.7x the XP of both dailies plus ten minutes of practice.

## What a level shows and unlocks

Nothing is locked behind a level: every mode stays open to everyone. A level shows:

- **The badge:** a ring that fills toward the next level, with the level number inside. Its colour moves along
  the tier ramp the game already uses: grey to Level 4, then the Overfit, In-Distribution (10), Outlier (25)
  and Long Tail (50) colours, and gold from Level 100 (about a year of both dailies). Gold is the gem's colour,
  so it waits.
- **The way to the next level:** "82 XP to Level 6".
- **The XP so far**, in Stats.

## Where it appears

- **Results** (daily, Daily Quiz, Unlimited, Quiz, challenges), under the score's tally line: the ring, "Level N",
  "+N XP", a bar and what's left. On the sprint end screen it sits under the tier counts. On a live match's
  podium it sits under the heading. A finished run keeps the XP it earned (`rec.xp`), so a revisit shows the
  same "+N XP" without the moment. A game that earned nothing shows no row.
- **Home**, for a returning player: a small chip under the buttons ("Level 5 · 82 XP to Level 6"), linking to
  Stats. On a phone it sits over the wave, so it has the page colour behind it.
- **Stats:** the level in full (a bigger ring, the bar, "268 XP in all · 82 XP to Level 6") above the stat grid,
  and a short "Levels" section at the end that explains how XP is earned.
- **FAQ:** "What are levels?"
- **Live rooms:** each player's level in the lobby list ("Level 5 · Ready ✓").

The screens were not redesigned. Each place gets one row or one line.

## The level-up moment

On results, the row starts where the player was. After 450 ms, so the eye lands on the score first, the gain
counts up as the bar fills. When the bar reaches the end of a level, the full bar holds for 140 ms. That is the
same hit-stop the play stage uses for a rare landing (70 to 220 ms in `js/landscape.js`). Then the number ticks
over, the ring pops with a thin gold ring rising off it, a gold "Level up" tag springs in, the bar and arc turn
gold, and `Sound.levelUp` plays. The sound is four bells climbing a major arpeggio, then a soft held chord under
a shimmer: brighter than a streak, gentler than the gem's fanfare. Phones get a short double buzz. Then the bar
fills on into the new level. If one game crosses more than two levels (possible only at the very start), the
moment plays for the first and the last. Screen readers hear "Level up. You're Level N."

- **Reduce motion:** the row shows the end state at once (the new level, the tag, the gold) with no tween and
  no pop. The bells still ring, because sound is its own setting.
- **Sound off:** silent. **Haptics off:** no buzz (`buzz` already checks the setting).
- It plays once. Leaving and coming back shows the row still.

## How a new player first meets it

Quietly. The first-visit home has no level on it. It must match the hero that `index.html` draws before the
app loads (`tests/preboot.e2e.js`), and a new player has enough to read. Stats shows nothing about levels until
there is XP. Their first finished game shows the XP row with one plain line under it, once per browser: "Every
answer you get right earns XP, rarer ones the most. Levels never go down." A typical first daily takes them to
Level 2, so the first thing they learn about levels is the level-up moment itself. After that, home shows the
chip.

In a live room, a new player's own row says "Level 1". That is the one place they see a level before playing
alone.

## Players from before levels

XP is worked out from what the browser already holds each time it is shown. Nothing is migrated except one small
thing:

- Every finished run in `mlion:records` counts, with its date: daily, Daily Quiz, archive, Unlimited, Quiz, pack
  and challenge runs. So a returning player opens the game already at the level their history earns. The
  practice pool applies to each past day too.
- Sprints and live matches leave no record, so from now on each one adds an entry to a small log,
  `mlion:xplog` ({ id: { d: day, r: raw XP } }). Sprints from before levels left only a best per prompt
  (`mlion:sprints`). The first time the new code runs, they become one log entry ("sprints-before-levels"):
  2 XP per answer in the best run and 6 for every other play, dated on the latest play. Live matches from before
  levels left nothing to count.
- Each log id is written once (a sprint's id has its time in it; a live match's is its seed), so two tabs or a
  podium redraw can't count a game twice. Past 400 entries, the oldest days fold into one entry a day, which adds
  up the same.
- Export carries the log; Import adds entries this browser lacks (ids checked, values capped). Reset progress
  clears it with everything else, and with it the level.

## Hard to farm, not stingy

- The dailies can't be farmed: one each a day.
- Everything else goes through the daily practice pool (160 at most a day).
- Misses, skips and junk earn 0, so tapping through a quiz or spamming the box earns nothing.
- Stored values are capped when read (a daily counts 200 at most, a day of practice 5,000 raw before the pool),
  so a hand-edited record can't make a level absurd. It is still the player's own browser: anyone can edit
  their own level, which is why levels are never used to rank people.
- Not stingy: a common answer still earns; a bad daily still earns 20; the first level comes on day one; ten
  minutes of practice a day is worth more than the Daily Quiz; and the note when the pool runs low says it
  refills, not that you're tired.

## Left out on purpose

- **Unlocks, gates and rewards for levels.** The research above says contingent prizes hurt intrinsic
  motivation. Every mode stays open.
- **Level titles** ("Gradient Descender" and so on). Names need writing and judging, and the tier names already
  carry that flavour. The colour ramp gives the deeper badge without words. Open question below.
- **Streak multipliers or streak XP.** The streak already exists. Duolingo found that tying streaks to XP
  "confused users". A multiplier would also make a missed day cost XP, which is a penalty in disguise.
- **Daily goals, quests, reminders and "2 more to level up" nudges.** They are expected, contingent rewards,
  and they push play past a natural stopping point.
- **XP for discovering new answers or prompts.** It would be a second, overlapping currency; rarity already
  rewards new answers.
- **Seasons and resets.** Levels never go down.
- **Levels on the leaderboard.** It is optional and was skipped (below).

## Leaderboard levels: what it would take

Skipped, for three reasons:

1. **It would touch a file this branch can't commit.** The board's first fetch is inlined in `index.html`
   (`MLION_BOARD_EARLY`), and its URL must match `boardFetch` in app.js exactly, or the early fetch is wasted.
   Adding a column to the query changes that URL, and `index.html` is build output.
2. **It needs a schema change.** The board reads `profiles` (`supabase/leaderboard.sql`). A level would need a
   new nullable `profiles.level smallint` column, written by the existing post function (for example a
   `post_daily_score(..., p_level int default null)` overload that sets it if it is between 1 and 9999) and
   returned by the board's select.
3. **A level is self-reported.** It is computed in the browser from local storage, so the server can't check it.
   On a board ranked by the day's score that is acceptable as decoration, but it should never sort anything.

If wanted later: add the column and the parameter in an additive SQL file; send `myLevel()` with the post;
show "Lv 12" beside the name on the board; and change the inline fetch in `index.html` in the same commit.
No SQL was written for this branch.

## Live rooms

Each player's level travels in the messages that already exist: `hello`, `ready`, and the host's lobby list,
as an optional `lvl` field. The lobby shows it before "Ready". Old clients ignore the field: `apply()` copies
named fields only, and the lobby renders only fields it knows. A value that isn't a whole number from 1 to 9999
is dropped (`cleanLvl`). It is shown, never used for anything else. Live matches earn XP once, on the podium
(+5 for finishing, plus each right answer). It goes through the practice pool, and players who joined late
don't earn it.

## Open questions

1. **Titles for levels?** For example, a name every 10 levels, drawn from ML ("Underfit", "Converging", ...). Left
   out for now; the colour ramp does the job quietly.
2. **The constants.** First level at 30 XP, +20 a level, a steady 400 from Level 20, a practice pool of 60
   in full and 160 at most, +20 for each daily. These are easy to tune in `E.XP`. Changing them moves
   everyone's level, up or down. Since a level must never go down, any later change should only make levels
   cheaper.
3. **Levels on the leaderboard** (see above).
4. **Should a live room show "Level 1" for a brand-new player,** or show nothing until they have XP?

## Sources

Read for this design (quotes above are from these pages):

- Deci, Koestner and Ryan (1999), A meta-analytic review of experiments examining the effects of extrinsic
  rewards on intrinsic motivation. https://doi.org/10.1037/0033-2909.125.6.627
- Lepper, Greene and Nisbett (1973), Undermining children's intrinsic interest with extrinsic reward.
  https://doi.org/10.1037/h0035519
- Mekler, Brühlmann, Tuch and Opwis (2017), Towards understanding the effects of individual gamification
  elements on intrinsic motivation and performance. https://doi.org/10.1016/j.chb.2015.08.048
- Sailer, Hense, Mayr and Mandl (2017), How gamification motivates. https://doi.org/10.1016/j.chb.2016.12.033
- Ryan, Rigby and Przybylski (2006), The motivational pull of video games. https://doi.org/10.1007/s11031-006-9051-8
- Hanus and Fox (2015), Assessing the effects of gamification in the classroom (not randomised; gamified students
  lost motivation over a term). https://doi.org/10.1016/j.compedu.2014.08.019
- WoW rested XP: Rob Pardo at GDC 2010, https://www.gamedeveloper.com/game-platforms/gdc-blizzard-s-core-game-design-concepts ;
  J. Allen Brack, http://www.gamebanshee.com/kw93q
- Pokémon GO levelling update (2025): https://pokemongo.com/post/pgo-leveling-update-details-2025
- Steam levels: https://steamcommunity.com/tradingcards/faq
- Clash Royale removes XP (May 2026): https://supercell.com/en/games/clashroyale/blog/news/new-collection-levels-and-mastery-changes/
- Brawl Stars daily cap: https://supercell.com/en/games/brawlstars/blog/release-notes/mysteryatthehub-patch-notes/
- Duolingo: leagues, https://blog.duolingo.com/duolingo-leagues-leaderboards/ ; XP farming,
  https://kotaku.com/duolingo-app-cheats-hacks-leagues-xp-why-duohacker-1850506482 ; streaks and XP,
  https://lennysnewsletter.com/p/behind-the-product-duolingo-streaks
- chess.com leagues (no demotions): https://support.chess.com/en/articles/8557800-what-is-the-players-league-how-do-i-join ;
  streaks with a grace period: https://support.chess.com/en/articles/9714718-what-are-streaks
- Nintendo: Iwata Asks, Fit Meter (piggy bank), https://iwataasks.nintendo.com/interviews/wiiu/fit-meter/0/3 ;
  Wii Fit (gentle feedback), https://iwataasks.nintendo.com/interviews/wii/wii_fit/0/0 ; DSi vol. 5 (Brain Age
  stopping points), https://iwataasks.nintendo.com/interviews/ds/dsi/5/1/ ; Ring Fit EXP and 30 minutes a day,
  https://www.nintendo.com/jp/ichikara/al3pa/02_en.html
- NYT Games, for contrast (no XP; Wordle keeps stats, Spelling Bee ranks a day against that day's maximum):
  https://thenewyorktimeshelpcenter.helpjuice.com/360011158491-New-York-Times-Games/24611727334932-Wordle
