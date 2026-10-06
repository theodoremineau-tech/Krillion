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

Depth works like Krillion's: every point is 10 m, so a perfect day is 1,000 points = 10,000 m. Zones use real ocean depths (Sunlight to 200 m, Twilight to 1,000, Midnight to 4,000, Abyssal to 6,000, then Hadal).

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
4. `POST /api/answer` grades on the server. Not on the sheet → `{valid:false, deadline}` (the deadline moves earlier by `MISS_PENALTY_MS` if that is set), player can keep trying until the deadline. Exact or near-exact → locked in, saved. Fuzzy → `{preview:true, from, correction}`; the client fills the corrected text in and the next submit locks it in (see "Confirmation step" below).
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
| `POST /sheet` `{index}` | one prompt's whole answer sheet, rarest first, with per-tier counts (only after you finish) |
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

1. **Exact** after normalizing (case, accents, punctuation, `&`→and, leading "the/a/an", British/American spellings: colour/color, centre/center, organise/organize, grey/gray, aluminium…). Every `/`-alias on the sheet counts.
2. **Name** (people prompts, `{ names: true }`): a surname or a distinctive first name alone ("Scheffler", "Kobe"). A hand-written person beats a dataset one. Reported as `how: 'name'` so the player gets to confirm which person ("roosevelt" could be either).
3. **Loose:** drop filler words (`mount, lake, river, the, of, fc, dr…`), initials, number words → digits, light stemming (plurals).
4. **Looser:** also drop category words, but only ones this prompt's sheet actually uses ("corn snake" → corn on the snake prompt, never "Hawaiian roll" → "Hawaiian"), **and the prompt's own words** ("Makeup" counts for "Makeup brush" on "Name a type of brush"; "Smoke" for "Smoke detector" when the prompt mentions detectors).
5. **Compact:** spaces removed ("spiderman", "cornsnake").
6. **Word order:** sorted words match ("Bryant Kobe", "Potter Harry").
7. **Single distinctive word:** "Teton" → Grand Teton, "Saudi" → Saudi Arabia: the word belongs to exactly one answer on this sheet and is either uncommon across the bank or not an everyday English word (5+ letters when it is). Dataset answers keep the strict version.
8. **Scored fuzzy candidates**, cheapest wins. Ties go to the answer containing more of the words typed ("georgiaa State" → Georgia State, not Georgia), then to the lower-scoring answer:
   - **Typos** (edit distance with letter swaps, on the full spelling): about one slip per four letters of the *longer* spelling — 1 at 4–7 letters (4 only when the typed word isn't a real word: "keny", "indi"), 2 at 8–11, 3 at 12–15, 4 at 16–19, 5 at 20+. The first letter may be wrong when the typed thing isn't a real word ("pasketball", "eranese"; but "chad" never offers Hades). A whole extra head or tail of 3+ letters isn't a typo ("Kryptonite" ≠ Krypton, "Mini" ≠ Mini golf).
   - **Sounds-alike** (`phon()`: ph→f, c→k/s, silent starts, doubled letters, vowels collapsed): "Filadelfia", "Nitzsche", "Jaquin Fenix". Needs 5+ letters, same start, and still close in spelling.
   - **Word by word:** each word within its own small typo budget, any order ("leonrdo dicaprio").
   - **Extra words:** typing more than the answer is fine if the extras are filler or words from the prompt ("the Golden State Warriors basketball team").
   - **Missing words:** two or more typed words, all found in the answer in order, covering at least half of it ("united emirates" → United Arab Emirates, "bosnia herzegovina"). Long answers also get here through the typo budget alone, which is how Krillion does it.
   - **Bracketed disambiguators:** a sheet entry like `Baseball (drinking game)` means the bare word is *not* an answer. "baseball" is rejected; "baseball drinking" and the full form count. A partial must include one of the bracketed words.
   - **Real-word guard:** a common English word is not read as a typo of a *different* common word ("monkey" ≠ "money", "chair" ≠ "char", "baseball" ≠ "basketball") — except, as on Krillion, when it is a single slip from a hand-written answer of 5+ letters ("boxes" → Boxer, "bones" → Bonus), which the confirm pill then shows. Word list: `server/wordlist.js` (generated from wordfreq).

Answers that came from datasets (see below) get slightly stricter fuzzy rules (1 typo from 6 letters, 2 from 10; sound-alikes from 6 letters), because the big lists are where accidental collisions live.

**Confirmation step (Krillion's autocorrect).** Only `exact` and `loose` lock in straight away. Anything fuzzier (`typo`, `sound`, `words`, `extra words`, `missing`, `partial`, `name`) comes back from `POST /answer` as `{preview: true, from, correction}` instead of a score; the client puts the corrected text in the box under a pill (“arabese” → “Aranese”, *Submit again to confirm, or edit*) and the next submit, now an exact match, locks in. The server remembers the pending correction on the answer (`a.pending`), so a reload shows the pill again, the original typing is stored as `input`, and the match kind as `how`. `T.needsConfirm(how)` is the one place that decides. Switch off with `CONFIRM_CORRECTIONS: false` in `SETTINGS`. Krillion previews *everything* non-exact, plurals included; we skip the pill for plurals, spacing and filler since those can't be wrong.

**What we measured on Krillion (Oct 2026, 474 hand-run probes of its public submit endpoint on one day's prompts, behaviour only):** 1 typo at 4–7 letters and 2 at 8+ are always corrected (55/55 and 30/32), as are dropped letters (55/55), plurals (56/57) and missing spaces (27/27); a wrong first letter is fine (50/52: "pasketball", "kroquet", "loyalties" → Royalties); letter swaps are *inconsistent* (43 corrected, 11 rejected: "Jamiaca" yes but "Myamnar", "Fareose", "Snokoer" no — likely a similarity-score threshold, not edit rules); the prompt's words are optional ("Makeup" → Makeup brush, "Smoke" → Smoke detector, "Carbon detector" → Carbon monoxide detector) but "brush"/"detector" alone, "Mini", "pong", "United", "Islands" are rejected; "United Emirates", "Arab Emirates" and "baseball drinking" are corrected, "Baseball game"/"drinking game" rejected (both collapse to one bare word once "game" from the prompt is dropped); a lone word of a two-word answer is accepted only sometimes ("extinguisher", "camera", "diem", "Hazard" yes; "Security", "fence", "shaker", "cover" no — looks like hand-written aliases). Ties don't favour the common answer ("gairbrush" → Airbrush, not Hairbrush). Everything non-exact shows the confirm pill, aliases and plurals included ("billiards" → Pool, "Golfs" → Golf). A second probe (128 cases) showed swaps are position-dependent but not predictable (never at the first two letters; "Matlese" yes, "Mlatese" no), substitutions at the same spots always corrected; Krillion has **no real-word guard** ("bones" → Bonus, "fitter" → Filters, "samba" → Samoa) but gives *no* typo allowance to 4-letter inputs ("Golv", "Crup", "mail" rejected; "Golff", "Cropp" corrected), which is what kept most real words out; "my smoke detector" corrected but "smoke detector alarm" and "golf course" rejected; 3 slips in 24 letters corrected; "UAE", "burma", "usa", "united states" rejected (no aliases) while "america", "hourly", "wages", "tip", "hoops" are hand aliases. Net: after this patch the Trench is at least as forgiving on every category, and more forgiving on swaps, partial words and abbreviations.

**Measuring it:** `node tools/eval-matching.js` (`--quick`, `--show` for samples). It mangles real answers (typos, sound-alikes, missing spaces, word order, plurals, surname typos, and — since this patch — a wrong first letter, a dropped word, one word of a two-word answer) and feeds random words plus other prompts' answers in as junk. Oct 2026, `--quick`, same harness on both: **94.2%** of messy inputs accepted with this patch vs **79.3%** on the Oct 5 matcher (wrong first letter 25% → 98%, dropped word 29% → 76%, one word of two 43% → 52%, surname typo 79% → 87%, 1 typo 93% → 97%); **0.6%** false accepts (was 0.4%); 1.8% mapped to the wrong answer (was 1.9%). On the old harness without the three new kinds the full-run numbers are 97.3% / 0.8% / 0.6%. The extra false accepts are junk words landing on obscure entries, which the confirm pill now shows before anything scores. Watch both numbers when changing anything. `test/matching.js` is the regression suite (116 cases); add a line there for any accept/reject bug you fix.

**Finding what's still missing:** `node tools/misses-report.mjs` (local data) or `NETLIFY_SITE_ID=… NETLIFY_TOKEN=… node tools/misses-report.mjs --netlify` lists every rejected guess grouped by prompt, how many people tried it, and whether the current matcher would now take it. Anything two people typed is probably a real answer or a missing alias.

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

## Speed (Oct 2026)

- Play uses one persistent card and one input that stays focused for the whole dive, so the phone keyboard opens once. Results hold briefly (1.0–2.0 s by tier, with a fill bar on the Next button) and Enter or a tap skips ahead; there are no other fixed pauses.
- Sessions store the username and are cached per warm function instance, so most requests need one storage read for auth.
- The dive and the leaderboard row save in parallel; opening a prompt only writes the dive.
- Answer indexes for big prompts (MLB, soccer) take up to ~0.5 s to build on a cold instance, so `/state`, `/next` and `/answer` warm the current or next prompt in the background via `context.waitUntil` (`opts.defer` in `createGame`).

## Settings (`server/game.mjs` → `SETTINGS`)

`TZ`, `PER_DAY` (10), `SECONDS` (25), `GRACE_MS` (3000), `INVITE_CODE` ('DEEPCUT'), `LAUNCH_DAY` (dive numbering starts here), `CONFIRM_CORRECTIONS` (true: fuzzy matches are previewed before they score), `MISS_PENALTY_MS` (0: seconds docked per rejected answer, in ms; Krillion-like would be ~3000).

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
- ~~"Answers people tried that weren't on the sheet" report~~ → built: `tools/misses-report.mjs`. Next step would be an admin page that shows the same thing in the browser.
- One-line blurbs for the rarest answers on each sheet (Krillion shows "Shakes the mattress so a deaf sleeper wakes to the smoke alarm" under its 100-pointers). Needs a sheet-format addition, e.g. `Answer/alias {{blurb}}`.
- Streaks, weekly winner banner, archive of past days.
- Themed packs / unlimited practice mode using the practice engine.
- Group chat bot that posts the day's results.

## Working with an AI assistant on this

`CLAUDE.md` has the short rules for Claude / any coding assistant. Point it at this file for the full picture.
