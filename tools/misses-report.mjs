// What people typed that the sheet didn't take, grouped by prompt, with what the matcher would say
// about it today. The single best source of missing answers and aliases.
//
//   node tools/misses-report.mjs                       # local dev data (.data/store.json)
//   node tools/misses-report.mjs --days 14             # only the last 14 days
//   NETLIFY_SITE_ID=... NETLIFY_TOKEN=... node tools/misses-report.mjs --netlify
//
// For --netlify: site ID is in Netlify -> Site configuration -> General; the token is a personal
// access token from User settings -> Applications. Read-only use; nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../server/bank.mjs';

const T = globalThis.Trench;
const BY_ID = new Map(globalThis.TRENCH_BANK.map(q => [q.id, q]));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? true) : dflt; };
const days = Number(flag('--days', 0));
const since = days ? T.addDays(T.todayStr('America/New_York'), -days + 1) : '0000';

async function loadStore() {
  if (args.includes('--netlify')) {
    const { getStore } = await import('@netlify/blobs');
    const s = getStore({ name: 'trench', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN, consistency: 'strong' });
    return { get: k => s.get(k, { type: 'json' }), list: async p => (await s.list({ prefix: p })).blobs.map(b => b.key) };
  }
  const file = path.join(root, '.data', 'store.json');
  if (!fs.existsSync(file)) { console.error('no .data/store.json; run the dev server first, or use --netlify'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { get: async k => data[k] ?? null, list: async p => Object.keys(data).filter(k => k.startsWith(p)) };
}

const store = await loadStore();
const keys = (await store.list('dives/')).filter(k => k.slice(6, 16) >= since);
const dives = (await Promise.all(keys.map(k => store.get(k)))).filter(Boolean);
const byPrompt = new Map();   // qid -> { prompt, misses: Map(text -> {n, users}), fuzzy: [] }
for (const d of dives) {
  for (const a of d.answers || []) {
    if (!byPrompt.has(a.qid)) byPrompt.set(a.qid, { prompt: a.prompt, misses: new Map(), fuzzy: [] });
    const p = byPrompt.get(a.qid);
    for (const m of a.misses || []) {
      const k = m.trim().toLowerCase();
      if (!p.misses.has(k)) p.misses.set(k, { text: m.trim(), n: 0, users: new Set() });
      p.misses.get(k).n++; p.misses.get(k).users.add(d.user);
    }
    if (a.done && a.how && a.how !== 'exact') p.fuzzy.push({ user: d.user, input: a.input, canon: a.canon, how: a.how });
  }
}

let totalMisses = 0, nowOk = 0;
const sections = [...byPrompt.values()].filter(p => p.misses.size).sort((a, b) => b.misses.size - a.misses.size);
for (const p of sections) {
  const q = [...BY_ID.values()].find(x => x.prompt === p.prompt);
  const rows = [...p.misses.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text));
  console.log(`\n## ${p.prompt}  (${rows.length} distinct misses)`);
  for (const r of rows) {
    totalMisses++;
    const g = q ? T.grade(q, r.text) : null;
    if (g) nowOk++;
    const who = [...r.users].join(', ');
    console.log(`  ${String(r.n).padStart(3)}×  ${r.text.padEnd(32)} ${g ? `-> now accepted as "${g.canon}" (${g.how})` : ''}  [${who}]`);
  }
  if (p.fuzzy.length) {
    console.log('  corrections that locked in:');
    for (const f of p.fuzzy) console.log(`       ${f.user}: "${f.input}" -> "${f.canon}" (${f.how})`);
  }
}
console.log(`\n${dives.length} dives, ${totalMisses} distinct misses, ${nowOk} would be accepted by the current matcher.`);
console.log('Anything two people tried is probably a real answer or a missing alias: add it to the sheet, then npm test.');
