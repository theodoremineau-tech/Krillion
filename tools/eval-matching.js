// Measures how forgiving the matcher is (recall on messy input) and how often it
// accepts things it shouldn't (false accepts). Run: node tools/eval-matching.js [--quick]
// Numbers to watch: "messy input accepted" should be high, "false accepts" low.
const path = require('path');
const fs = require('fs');
const T = require('../server/core.js');
require('../server/wordlist.js');
const QDIR = path.join(__dirname, '../server/questions');
for (const f of fs.readdirSync(QDIR).filter(f => f.endsWith('.js')).sort()) require(path.join(QDIR, f));
const BANK = globalThis.TRENCH_BANK;
const QUICK = process.argv.includes('--quick');
const WORDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'common-words.json'), 'utf8'));

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const LET = 'abcdefghijklmnopqrstuvwxyz';

function edit(w) {
  const i = 1 + Math.floor(rnd() * (w.length - 1)); // keep first letter, like most real typos
  switch (Math.floor(rnd() * 4)) {
    case 0: return w.slice(0, i) + pick(LET) + w.slice(i + 1);           // substitute
    case 1: return w.slice(0, i) + w.slice(i + 1);                        // drop
    case 2: return w.slice(0, i) + pick(LET) + w.slice(i);                // insert
    default: return i < w.length - 1 ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2) : w.slice(0, -1); // swap
  }
}
const PHON = [[/ph/g, 'f'], [/f/g, 'ph'], [/c(?=[aou])/g, 'k'], [/k/g, 'c'], [/ie/g, 'ei'], [/ei/g, 'ie'], [/([a-z])\1/g, '$1'],
  [/y/g, 'i'], [/i/g, 'y'], [/s(?=[aeiou])/g, 'z'], [/ou/g, 'u'], [/ae/g, 'e'], [/tch/g, 'ch'], [/sch/g, 'sh'], [/ck/g, 'k'], [/x/g, 'ks']];
function phonetic(w) {
  const opts = PHON.filter(([re]) => re.test(w));
  if (!opts.length) return null;
  const [re, to] = pick(opts);
  re.lastIndex = 0;
  return w.replace(re, to);
}
function variants(canon, q) {
  const s = canon;
  const out = [];
  const words = s.split(' ');
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '');
  const at = words.indexOf(longest);
  const swapWord = nw => words.map((x, i) => (i === at ? nw : x)).join(' ');
  if (longest.length >= 5) out.push(['1 typo', swapWord(edit(longest.toLowerCase()))]);
  if (longest.length >= 9) out.push(['2 typos', swapWord(edit(edit(longest.toLowerCase())))]);
  const ph = longest.length >= 5 && phonetic(longest.toLowerCase());
  if (ph && ph !== longest.toLowerCase()) out.push(['sounds-alike', swapWord(ph)]);
  if (words.length >= 2) out.push(['no spaces', s.replace(/\s+/g, '')]);
  if (words.length === 2) out.push(['word order', words[1] + ' ' + words[0]]);
  out.push(['plural/singular', /s$/i.test(s) ? s.slice(0, -1) : s + 's']);
  out.push(['lowercase + punctuation', s.toLowerCase().replace(/[^a-z0-9 ]/g, '') + '!']);
  if (q.opts.names && words.length >= 2) out.push(['surname typo', longest.length >= 6 ? edit(words[words.length - 1].toLowerCase()) : words[words.length - 1]]);
  return out;
}

const per = QUICK ? 6 : 20;
const byKind = {};
const bySrc = {};
let ok = 0, tot = 0, wrong = 0;
const misses = [];
for (const q of BANK) {
  const es = T.entries(q);
  for (let n = 0; n < per && es.length; n++) {
    const e = pick(es);
    if (e.canon.length < 4) continue;
    for (const [kind, inp] of variants(e.canon, q)) {
      if (T.norm(inp) === T.norm(e.canon)) continue;
      const g = T.grade(q, inp);
      byKind[kind] = byKind[kind] || [0, 0];
      byKind[kind][1]++; tot++;
      const src = e.auto ? 'from datasets' : 'hand-written';
      bySrc[src] = bySrc[src] || [0, 0]; bySrc[src][1]++;
      if (g && g.canon === e.canon) { byKind[kind][0]++; ok++; bySrc[src][0]++; }
      else { if (g) wrong++; if (misses.length < 4000 && !e.auto) misses.push(`[${q.prompt.slice(0, 30)}] ${kind}: "${inp}" (want ${e.canon})${g ? ' got ' + g.canon : ''}`); }
    }
  }
}

// false accepts: answers from other prompts + common English words
let fa = 0, ft = 0;
const faSamples = [];
const allCanon = BANK.flatMap(q => T.entries(q).map(e => e.canon));
for (const q of BANK) {
  const own = new Set(T.entries(q).flatMap(e => e.forms.map(T.norm)));
  for (let n = 0; n < (QUICK ? 40 : 150); n++) {
    const inp = n % 2 ? pick(allCanon) : pick(WORDS);
    if (own.has(T.norm(inp))) continue;
    ft++;
    const g = T.grade(q, inp);
    if (g) { fa++; if (faSamples.length < 400) faSamples.push(`[${q.prompt.slice(0, 30)}] "${inp}" -> ${g.canon} (${g.how})`); }
  }
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log(`messy input accepted: ${pct(ok, tot)} (${ok}/${tot}); mapped to the wrong answer: ${pct(wrong, tot)}`);
for (const [k, [a, b]] of Object.entries(bySrc)) console.log(`  answers ${k.padEnd(16)} ${pct(a, b)}  (${b})`);
for (const [k, [a, b]] of Object.entries(byKind)) console.log(`  ${k.padEnd(24)} ${pct(a, b)}  (${b})`);
console.log(`false accepts: ${pct(fa, ft)} (${fa}/${ft})`);
if (process.argv.includes('--show')) {
  console.log('\nSAMPLE MISSES'); for (let i = 0; i < 60; i++) console.log(' ', misses[Math.floor(i * misses.length / 60)]);
  console.log('\nSAMPLE FALSE ACCEPTS'); for (let i = 0; i < Math.min(60, faSamples.length); i++) console.log(' ', faSamples[Math.floor(i * faSamples.length / Math.min(60, faSamples.length))]);
}
