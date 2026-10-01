# The Trench

Daily rare-answer trivia for a friend group. Everyone gets the same 10 prompts each day with 25 seconds per prompt. Obvious answers score little; rare-but-right answers sink you deeper.

## How it works

- **Accounts and saved progress live on the server.** Netlify Functions + Netlify Blobs, in the same Netlify site. A dive is saved after every answer, so closing the tab, switching phones or losing signal never loses progress. The clock keeps running server-side, so leaving mid-prompt doesn't buy extra time.
- **Fixed answer sheets.** Each prompt has six tiers: Plankton 10, Too Clever 15, Schooler 30, Rare 60, Deep Cut 85, One in a Million 100. Scores never depend on what other players typed.
- **Grading is server-side.** The answer sheets aren't shipped to the browser, so nobody can peek in dev tools.
- **Forgiving matching.** Typos and swapped letters (scaled to word length), plurals, spacing ("spiderman"), punctuation, filler words ("Mount", "Lake", "the"), category words the prompt uses ("corn snake", "Sicilian defense"), initials, number words, and surnames for people prompts.
- **Leaderboard.** Today, last 7 days and all time. After you finish, you can see what everyone else answered.

## Layout

```
public/              static site (index.html, app.js, fx.js, style.css)
netlify/functions/   api.mjs: the /api/* function
server/game.mjs      accounts, sessions, dives, grading, leaderboard
server/core.js       matching engine, tiers, daily rotation
server/questions/    answer sheets (server-only)
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
