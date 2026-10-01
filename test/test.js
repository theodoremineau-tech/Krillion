// Run with: node test/test.js
const path = require('path');
const T = require('../server/core.js');
const fs = require('fs');
const QDIR = path.join(__dirname, '../server/questions');
for (const f of fs.readdirSync(QDIR).filter(f => f.endsWith('.js')).sort()) require(path.join(QDIR, f));
const BANK = globalThis.TRENCH_BANK;
let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('ok  :', m);

// 1. structure: unique ids, no empty prompts, six tiers, no leftover junk
const ids = new Set();
for (const x of BANK) {
  if (ids.has(x.id)) fail('duplicate prompt id ' + x.prompt);
  ids.add(x.id);
  for (const t of T.TIER_ORDER) {
    const raw = x.sheet[t] || '';
    if (/\(dup\)|\? no\b|\.replace\(|[()]/.test(raw)) fail(`junk in "${x.prompt}" tier ${t}`);
  }
}
ok(`${BANK.length} prompts, ${ids.size} unique ids`);

// 2. an answer must not sit in two tiers of the same prompt (ambiguous scoring)
for (const x of BANK) {
  const seen = new Map();
  for (const t of T.TIER_ORDER) {
    for (const entry of (x.sheet[t] || '').split(';')) {
      const forms = entry.split('/').map(s => s.trim()).filter(Boolean);
      for (const f of forms) {
        const k = T.norm(f);
        if (!k) continue;
        if (seen.has(k) && seen.get(k).tier !== t) fail(`"${f}" in both ${seen.get(k).tier} and ${t} for "${x.prompt}"`);
        else if (seen.has(k) && seen.get(k).canon !== forms[0]) fail(`"${f}" maps to two answers (${seen.get(k).canon} / ${forms[0]}) for "${x.prompt}"`);
        else seen.set(k, { tier: t, canon: forms[0] });
      }
    }
  }
}
ok('tier-collision scan done');

// 3. every listed answer must grade to its own tier
let graded = 0;
for (const x of BANK) {
  for (const t of T.TIER_ORDER) {
    for (const entry of (x.sheet[t] || '').split(';')) {
      const forms = entry.split('/').map(s => s.trim()).filter(Boolean);
      for (const f of forms) {
        const g = T.grade(x, f);
        graded++;
        if (!g || g.tier !== t) fail(`"${f}" (${t}) graded as ${g ? g.tier : 'null'} for "${x.prompt}"`);
      }
    }
  }
}
ok(`${graded} listed answers re-graded`);

// 4. spot checks of matching behaviour
const byPrompt = p => BANK.find(x => x.prompt.startsWith(p));
const eu = byPrompt('Name a country in Europe');
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m}: got ${JSON.stringify(a)}`));
eq(T.grade(eu, 'france').pts, 10, 'France = Plankton 10');
eq(T.grade(eu, ' San Marino ').pts, 100, 'San Marino = 100');
eq(T.grade(eu, 'Liechtenstien').tier, 'one', 'typo tolerated (Liechtenstien)');
eq(T.grade(eu, 'Czechia').tier, 'rare', 'alias Czechia');
eq(T.grade(eu, 'Narnia'), null, 'unknown answer rejected');
eq(T.grade(eu, ''), null, 'empty rejected');
eq(T.grade(eu, 'Sweeden').tier, 'schooler', 'typo Sweeden');
const golf = byPrompt('Name a professional golfer');
eq(T.grade(golf, 'Woods').tier, 'plankton', 'surname match: Woods');
eq(T.grade(golf, 'scheffler').tier, 'schooler', 'surname match: scheffler');
const pres = byPrompt('Name a US president');
eq(T.grade(pres, 'Roosevelt').tier, 'schooler', 'Roosevelt alias');
eq(T.grade(pres, 'Pierce').tier, 'one', 'Pierce = deep cut via surname');
const elem = byPrompt('Name a chemical element');
eq(T.grade(elem, 'Aluminium').tier, 'schooler', 'Aluminium alias');
eq(T.grade(elem, 'gold').pts, 10, 'plural/singular: gold');
const fruit = byPrompt('Name a fruit');
eq(T.grade(fruit, 'strawberries').tier, 'plankton', 'plural: strawberries');
const states = byPrompt('Name a US state that');
eq(T.grade(states, 'Utah').tier, 'plankton', 'Utah');
eq(T.grade(states, 'Florida'), null, 'Florida rejected (touches ocean)');

// 5. daily selection
const perDay = 10;
const d1 = T.pickDaily(BANK, '2026-10-01', perDay).map(x => x.id);
const d1b = T.pickDaily(BANK, '2026-10-01', perDay).map(x => x.id);
eq(d1, d1b, 'same date -> same prompts');
eq(new Set(d1).size, perDay, '20 distinct prompts on a day');
const perCycle = Math.floor(BANK.length / perDay);
const all = [];
for (let i = 0; i < perCycle; i++) all.push(...T.pickDaily(BANK, T.addDays('2026-10-01', i), perDay).map(x => x.id));
// the cycle containing a given day: consecutive days within one cycle never repeat
const di = T.dayIndex('2026-10-01');
const start = di - (di % perCycle);
const cycleIds = [];
for (let i = 0; i < perCycle; i++) cycleIds.push(...T.pickDaily(BANK, T.addDays('2026-01-01', start + i), perDay).map(x => x.id));
eq(new Set(cycleIds).size, perCycle * perDay, `no repeats within a ${perCycle}-day cycle`);
const d2 = T.pickDaily(BANK, '2026-10-02', perDay).map(x => x.id);
eq(d1.some(id => d2.includes(id)), false, 'consecutive days share no prompts');

// 6. depth/zone
eq(T.depthFor(2000, 2000), 10935, 'perfect = Challenger Deep');
eq(T.zoneFor(0), 'Surface', 'zone surface');
eq(T.zoneFor(10935), 'Hadal zone', 'zone hadal');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
