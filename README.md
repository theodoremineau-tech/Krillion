# The Trench

Daily rare-answer trivia for a friend group. Everyone gets the same 10 prompts each day with 25 seconds per prompt. Obvious answers score little; rare-but-right answers sink you deeper.

## How it works

- **Accounts and saved progress live on the server.** Netlify Functions + Netlify Blobs, in the same Netlify site. A dive is saved after every answer, so closing the tab, switching phones or losing signal never loses progress. The clock keeps running server-side, so leaving mid-prompt doesn't buy extra time.
- **Fixed answer sheets.** Each prompt has six tiers: Plankton 10, Too Clever 15, Schooler 30, Rare 60, Deep Cut 85, One in a Million 100. Scores never depend on what other players typed.
- **Grading is server-side.** The answer sheets aren't shipped to the browser, so nobody can peek in dev tools.
- **Forgiving matching, with a confirm step.** Typos and swapped letters (about one per four letters, the first letter included), sound-alike spellings ("Filadelfia"), any word order, plurals, British spellings, spacing ("spiderman"), punctuation, filler and prompt words ("Mount", "the", "Makeup" for "Makeup brush"), missing words ("united emirates"), initials, number words, and surnames for people prompts. Like Krillion, anything fuzzier than a plural is shown first (“arabese” → “Aranese”, *submit again to confirm, or edit*) so a wrong guess never scores silently. A real word is not read as a typo of a different real word unless it is a single slip from one (“boxes” → Boxer). `node tools/eval-matching.js` measures it (94% of messy answers accepted, up from 79% on the same test; 0.6% false accepts).
- **Browse the whole sheet afterwards.** Every prompt on the results screen opens its full answer list, rarest first, with tier filters, counts, search, and who in the group picked what.
- **Deep answer banks.** About 100,000 accepted answers across 152 prompts: hand-written tiered sheets, hand-written deep-cut lists, and answers generated from open datasets and tiered by how rare the word is in everyday English. See HANDOFF.md, "Answer bank depth".
- **Leaderboard.** Today, last 7 days and all time. After you finish, you can see what everyone else answered.

## Layout

```
public/              static site (index.html, app.js, fx.js, style.css)
netlify/functions/   api.mjs: the /api/* function
server/game.mjs      accounts, sessions, dives, grading, leaderboard
server/core.js       matching engine, tiers, daily rotation
server/questions/    answer sheets (server-only); zz_expanded.js is generated
tools/expand/        dataset pipeline that builds zz_expanded.js
tools/misses-report.mjs   what players typed that the sheets rejected
test/                node test/test.js && node test/matching.js
```

## Run locally

```
npm install
npm run dev          # http://localhost:8787, data in .data/store.json
npm test
```

## Settings

In `server/game.mjs` → `SETTINGS`:

- `INVITE_CODE`: needed to create an account (default `DEEPCUT`). Change it and redeploy to lock the door.
- `PER_DAY` (10), `SECONDS` (25), `TZ` (America/New_York).
- `CONFIRM_CORRECTIONS` (true): show fuzzy matches for confirmation before they score. `false` locks them in straight away.
- `MISS_PENALTY_MS` (0): clock time taken off for each rejected answer. Krillion docks a few seconds; set e.g. `3000` to copy that.

## Finding missing answers

`node tools/misses-report.mjs` lists everything players typed that was rejected, grouped by prompt, with how many people tried it and whether the current matcher would now take it. Use `--netlify` with `NETLIFY_SITE_ID` and `NETLIFY_TOKEN` to read the live site's data.

## Adding prompts

Add to any file in `server/questions/`:

```js
q('Name a thing',
  'obvious; answers/with/aliases',  // Plankton 10
  'too clever',                      // 15
  'schooler',                        // 30
  'rare',                            // 60
  'deep cut',                        // 85
  'one in a million',                // 100
  { names: true })                   // optional: surnames match for people prompts
```

Then run `npm test`. It flags any answer that sits in two tiers or doesn't grade to its own tier. 152 prompts at 10 a day is about two weeks before anything repeats; the bank then reshuffles. Every dive stores its own prompt list, so adding prompts mid-day is safe.

For the full picture (architecture, API, data model, known issues), see `HANDOFF.md`.
