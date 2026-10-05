# The Trench: handoff notes

Everything you need to pick this up and keep building. Read this first, then `README.md` for the short version.

## What it is

A private, Krillion-style daily trivia game for Teddy's friend group. Every day everyone gets the same **10 prompts** ("Name a country in Europe"), **25 seconds** each, one attempt. You type an answer; if it's on that prompt's answer sheet it locks in and scores by how obscure it is:

| Tier | Points |
|---|---|
| Plankton | 10 |
| Too Clever | 15 |
| Schooler | 30 |
| Rare | 60 |
| Deep Cut | 85 |
| One in a Million | 100 |

A perfect day is 1,000 points = 10,935 m (bottom of the Mariana Trench). Score converts to a depth and an ocean zone.

**The key design decision:** tiers are fixed, hand-written per answer. They do *not* depend on what other players typed (real Krillion ranks by global rarity; with five friends that would make everything "rare" or nothing). So a Deep Cut is always a Deep Cut.

## Where things are

- **Code:** GitHub `theodoremineau-tech/Krillion` (branch `main`). This folder is a copy of it.
- **Hosting:** Netlify, deployed by importing that repo (Netlify auto-redeploys on every push to `main`). Teddy owns the Netlify account. To work on it together: Teddy adds you as a collaborator on the GitHub repo, and optionally as a member of his Netlify team so you can see deploy logs.
- **Old demo:** `fluffy-brigadeiros-8ac58c.netlify.app` was serving an early single-browser demo (v1). It is not wired to this code unless Teddy re-linked it. Don't confuse the two.
- **Teddy's Daily Briefing app is a separate Netlify site. Do not touch it.**

## Stack (deliberately boring)

- No framework, no build step for the frontend. Plain HTML/CSS/JS in `public/`.
- Backend is one **Netlify Function** (`netlify/functions/api.mjs`) serving `/api/*`.
- Storage is **Netlify Blobs** (key-value, built into the site, no database to set up).
- Node 20+ for local dev and tests. Only runtime dependency: `@netlify/blobs`.

```
public/                     the site
  index.html                shell; loads fx.js then app.js
  app.js                    all screens: login, lobby, play, results, leaderboard
  fx.js                     effects: marine snow, bubbles, sparks, count-up, synthesized sound
  style.css                 the whole look
netlify/functions/api.mjs   wires Netlify Blobs into the game server
server/
  game.mjs                  accounts, sessions, dives, grading, leaderboard, HTTP router (SETTINGS at top)
  core.js                   matching engine, tiers, daily prompt rotation, depth math (pure, no I/O)
  questions/*.js            the answer sheets (server-only; never shipped to the browser)
  bank.mjs                  GENERATED import list of questions/*.js (npm run dev/test regenerate it)
  build-bank.mjs            generates bank.mjs
  crypto.mjs                scrypt password hashing + tokens (Node)
  crypto-browser.mjs        weak stand-ins used only by the practice build
  practice-entry.mjs        runs game.mjs inside a web page with an in-memory store
  dev-server.mjs            local server: static files + /api, data in .data/store.json
  sanitize.py               one-off cleanup tool used while drafting sheets (safe to ignore)
scripts/build-practice.mjs  builds dist/trench-practice.html (offline test copy)
test/test.js                bank integrity: no answer in two tiers, every answer grades to its tier, rotation
test/matching.js            answer-acceptance battery (typos, plurals, filler words, surnames, rejects)
netlify.toml                publish dir, functions dir, build command
```

## Run it

```bash
npm install
npm run dev        # http://localhost:8787  (fresh data: delete .data/)
npm test           # run after ANY change to questions or core.js
npm run practice   # dist/trench-practice.html: open in a browser, no server, nothing saved
```

Invite code for creating accounts: **DEEPCUT** (set in `server/game.mjs`).

## How a day works (server is the source of truth)

1. `POST /api/next` creates today's dive if needed. Today's 10 prompts come from `pickDaily(bank, date, 10)` in `core.js`: a seeded shuffle of the whole bank, round-robined across categories, sliced by day. Same date = same prompts for everyone. No repeats until the bank is exhausted (152 prompts / 10 = 15 days), then it reshuffles.
2. The dive stores its own list of prompt ids, so adding or removing prompts mid-day can't break anyone's in-progress dive.
3. Each prompt gets a server-side deadline (`startedAt + 25s`, plus 3 s network grace). The client timer is cosmetic.
4. `POST /api/answer` grades on the server. Not on the sheet → `{valid:false}`, player can keep trying until the deadline. On the sheet → locked in, saved.
5. Closing the tab doesn't pause anything: when the player comes back, any prompt past its deadline is settled as a miss, and they resume at the next one.
6. "Today" is midnight-to-midnight **America/New_York**.

### API (all JSON, `Authorization: Bearer <token>` except signup/login/health)

| Route | Does |
|---|---|
| `POST /signup` `{username,password,invite}` | create account → `{token,user}` |
| `POST /login` `{username,password}` | → `{token,user}` |
| `POST /logout` | delete session |
| `GET /state` | today, settings, your dive summary, open question if any |
| `POST /next` | open the next prompt (or return finished dive) |
| `POST /answer` `{index,text}` | grade; `{valid:false}` or tier/pts/canon/score |
| `POST /timeout` `{index}` | settle a prompt whose time ran out |
| `GET /group` | everyone's answers for today (only after you finish) |
| `GET /leaderboard` | all players' per-day scores (client computes Today / 7-day / All-time) |
| `GET /health` | prompt count, today |

### Data in Netlify Blobs (store name `trench`)

| Key | Value |
|---|---|
| `users/<lowercase name>` | `{username, salt, hash, created}` |
| `sessions/<token>` | `{user, created}` (no expiry) |
| `dives/<YYYY-MM-DD>/<user>` | full dive: prompt ids, every answer, misses, deadlines, score |
| `scores/<user>` | `{username, days: {date: {score, finished, n}}}` (what the leaderboard reads) |

## Answer matching (`server/core.js` → `grade`)

Goal: be as forgiving as Krillion without accepting nonsense. Tried in order, first hit wins:

1. **Exact** after normalizing (case, accents, punctuation, `&`→and, leading "the/a/an"). Every `/`-alias on the sheet counts.
2. **Loose:** drop filler words (`mount, lake, river, the, of, fc, dr…`), initials, number words → digits, light stemming (plurals).
3. **Looser:** also drop category words, but only ones this prompt's sheet actually uses (so "corn snake" → corn on the snake prompt, but "Hawaiian roll" never becomes "Hawaiian").
4. **Compact:** spaces removed ("spiderman", "cornsnake").
5. **Word order:** sorted words match ("Bryant Kobe", "Potter Harry").
6. **Single distinctive word:** "Teton" → Grand Teton, only if that word is rare across the whole bank and belongs to exactly one answer on this sheet.
7. **Scored fuzzy candidates**, cheapest wins (ties go to the lower-scoring answer):
   - **Typos** (edit distance with letter swaps, measured on the unstemmed spelling): 1 at 5–7 letters, 2 at 8–11, 3 at 12–15, 4 at 16+; first letter must match or be swapped.
   - **Sounds-alike** (`phon()`: ph→f, c→k/s, silent starts, doubled letters, vowels collapsed): "Filadelfia", "Nitzsche", "Jaquin Fenix". Needs 5+ letters, same start, and still close in spelling.
   - **Word by word:** each word within its own small typo budget, any order ("leonrdo dicaprio").
   - **Extra words:** typing more than the answer is fine if the extras are filler or words from the prompt ("the Golden State Warriors basketball team").
   - **Real-word guard:** a common English word is never read as a typo of a *different* common word ("monkey" ≠ "money", "chair" ≠ "char"). Word list: `server/wordlist.js` (generated from wordfreq).
8. **People prompts** (`{ names: true }`): surnames, or a distinctive first name, alone count when unambiguous ("Scheffler", "Shohei"). A hand-written person beats a dataset one ("Kobe" → Kobe Bryant, not Kobe Bufkin).

Answers that came from datasets (see below) get slightly stricter fuzzy rules (1 typo from 6 letters, 2 from 10; sound-alikes from 6 letters), because the big lists are where accidental collisions live.

**Measuring it:** `node tools/eval-matching.js` (`--quick`, `--show` for samples). It mangles real answers (typos, sound-alikes, missing spaces, word order, plurals, surname typos) and feeds random words plus other prompts' answers in as junk. Oct 2026: **95.5%** of messy inputs accepted (was 81.6%), **0.6%** false accepts, 0.8% mapped to the wrong answer. Watch both numbers when changing anything. `test/matching.js` is the regression suite; add a line there for any accept/reject bug you fix.

## Answer bank depth (≈100k answers, was ≈21k)

Three layers, loaded in file-name order:

1. **Hand sheets** (`server/questions/*.js`, `Trench.add`) — the tiered core, as before.
2. **Hand deep cuts** (`yy_more_*.js`, `Trench.more('Prompt', {rare: '...', deep: '...'})`) — long lists for prompts with no good dataset (dishes, brands, shows, characters). Anything already on the sheet is skipped automatically.
3. **Generated** (`zz_expanded.js`, `Trench.extend`) — built from open datasets: WordNet (animals, plants, foods, clothing…), GeoNames/all-the-cities, pycountry, NBA/MLB (Chadwick)/NFL rosters, FIFA 22, Pokémon, Marvel (FiveThirtyEight), OpenFlights, GitHub Linguist, Simpsons, Harry Potter. Country prompts only take *aliases* from datasets, never new answers.

Tiering for added answers works like Krillion's: the rarer the text is in everyday English (wordfreq Zipf score), the higher the tier, calibrated per prompt against the hand sheet's Rare/Deep/One medians. Added answers only ever land in Rare, Deep Cut or One in a Million. Tiers are fixed per answer and never depend on what players typed.

**Regenerate** (needs Python 3 + network):
```
bash tools/expand/fetch.sh                 # datasets into tools/expand/.cache (gitignored)
node tools/expand/dump-hand.js
NLTK_DATA=tools/expand/.cache/nltk_data python3 tools/expand/sources.py
node tools/expand/merge.js                 # writes zz_expanded.js + a per-prompt report
node server/build-bank.mjs && npm test && node tools/eval-matching.js
```
Wrong dataset items for a prompt go in `BLOCK` in `tools/expand/merge.js`. Prompt → source mapping is `SOURCES` in `sources.py`.

Data licences: WordNet (WordNet licence), wordfreq (MIT / CC-BY-SA data), GeoNames (CC-BY 4.0), Chadwick register (ODC-BY), nflverse (CC-BY 4.0), FiveThirtyEight (CC-BY 4.0), OpenFlights (ODbL), Linguist (MIT), pycountry (LGPL), nba_api (MIT). The FIFA, Simpsons and HP CSVs are community scrapes on GitHub; fine for a private friend game, check before anything public. **No Krillion code or answer data is used** — only its published behaviour (forgiving matching, frequency-based rarity).

## Adding or editing prompts

Add to any file in `server/questions/` (they're grouped loosely by category via `Trench.add('Category', ...)`):

```js
q('Name a thing',
  'obvious; Answer/alias/alias',   // Plankton 10
  'too clever',                     // 15 (usually empty; for "technically right" answers)
  'schooler',                       // 30
  'rare',                           // 60
  'deep cut',                       // 85
  'one in a million',               // 100
  { names: true })                  // optional: people prompt, surnames match
```

- Entries separated by `;`, aliases by `/`. First form is what gets displayed.
- Trailing empty tiers can be omitted.
- Then `npm test`. It fails if an answer is in two tiers or doesn't grade to its own tier.
- Prompt id = hash of the prompt text, so **rewording a prompt makes it a new prompt** (fine, just know it).

**Caveat:** the sheets were written from memory, quickly. Expect some valid answers missing and some tiers you'd rank differently. Fixing them is the single highest-value ongoing task.

## Settings (`server/game.mjs` → `SETTINGS`)

`TZ`, `PER_DAY` (10), `SECONDS` (25), `GRACE_MS` (3000), `INVITE_CODE` ('DEEPCUT'), `LAUNCH_DAY` (dive numbering starts here).

## Known issues and gaps

- **The GitHub repo is public.** Anyone who finds it can read every answer sheet and the invite code. Strongly suggest Teddy makes it private (Netlify works fine with private repos).
- No password reset. Workaround: delete `users/<name>` in Netlify → Blobs and have them re-sign up (their `scores/` stay under the same lowercase name).
- Sessions never expire; logging out deletes only that device's session.
- No rate limiting on `/answer` (someone could script guesses within 25 s). Misses are capped at 25 stored per prompt.
- Leaderboard reads every `scores/*` blob each load: fine for a friend group, not for hundreds.
- Never tested against real Netlify before the first deploy; local dev server and Node tests use the same `game.mjs`, but if Blobs misbehave, check the function logs in Netlify.
- Design: Unbounded (display) + Instrument Sans (body) from Google Fonts; sea color darkens with score; bathysphere marker sinks a depth ruler during play.

## Ideas not built yet

- Admin page: view/edit sheets, reset a password, see misses (the `misses` array on each answer is a great source of answers to add).
- "Accepted answers people tried that weren't on the sheet" report → feed into sheet edits.
- Streaks, weekly winner banner, archive of past days.
- Themed packs / unlimited practice mode using the practice engine.
- Group chat bot that posts the day's results.

## Working with an AI assistant on this

`CLAUDE.md` has the short rules for Claude / any coding assistant. Point it at this file for the full picture.
