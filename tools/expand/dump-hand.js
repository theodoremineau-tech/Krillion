// Writes the hand-written answer sheets (everything except the generated expansion) to
// tools/expand/out/hand.json so sources.py can calibrate tiers against them.
const fs = require('fs');
const path = require('path');
const T = require('../../server/core.js');
const QDIR = path.join(__dirname, '../../server/questions');
for (const f of fs.readdirSync(QDIR).filter(f => f.endsWith('.js') && !f.startsWith('zz_')).sort()) require(path.join(QDIR, f));
const out = globalThis.TRENCH_BANK.map(q => ({
  id: q.id, prompt: q.prompt, names: !!q.opts.names,
  entries: T.entries(q).map(e => ({ tier: e.tier, canon: e.canon, forms: e.forms })),
}));
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out/hand.json'), JSON.stringify(out));
console.log(`hand.json: ${out.length} prompts`);
