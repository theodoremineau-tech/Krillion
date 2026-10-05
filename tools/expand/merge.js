// Merges tools/expand/out/sources.json into the hand-written sheets and writes
// server/questions/zz_expanded.js (generated, do not edit by hand).
//   - a dataset entry that matches an existing answer only adds its other spellings as aliases
//   - anything new is added at the tier sources.py computed (Rare, Deep Cut or One in a Million)
//   - nothing is ever added twice or under two different answers
// Run: node tools/expand/merge.js
const fs = require('fs');
const path = require('path');
const T = require('../../server/core.js');
const QDIR = path.join(__dirname, '../../server/questions');
for (const f of fs.readdirSync(QDIR).filter(f => f.endsWith('.js') && !f.startsWith('zz_')).sort()) require(path.join(QDIR, f));
const BANK = globalThis.TRENCH_BANK;
const src = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/sources.json'), 'utf8'));

// Hand-curated "never accept" list per prompt: dataset items that are wrong for the prompt.
const BLOCK = {
  'Name a mammal': ['female mammal', 'tusker', 'placental', 'eutherian', 'prototherian', 'metatherian', 'marsupial', 'carnivore', 'herbivore', 'insectivore', 'rodent', 'primate', 'ungulate', 'even-toed ungulate', 'odd-toed ungulate', 'pachyderm', 'aquatic mammal', 'fissiped', 'pinniped', 'Affirmed', 'Secretariat', 'Seabiscuit', 'Man o\' War'],
  'Name a type of bird': ['nestling', 'fledgling', 'cock', 'hen', 'dickeybird', 'night bird', 'ratite', 'carinate', 'gamebird', 'game bird', 'passerine', 'nonpasserine bird', 'bird of prey', 'raptor', 'seabird', 'waterfowl', 'twitterer'],
  'Name a type of tree': ['bonsai', 'shade tree', 'gymnospermous tree', 'angiospermous tree', 'fruit tree', 'nut tree', 'timber tree', 'treelet', 'sapling', 'pollard', 'Christmas tree'],
  'Name a flower': ['wildflower', 'wild flower', 'bloomer', 'flower', 'apetalous flower'],
  'Name an insect or bug': ['larva', 'pupa', 'nymph', 'imago', 'worker', 'queen', 'drone', 'pest', 'social insect', 'collembolan', 'defoliator', 'pollinator', 'gallfly'],
  'Name a sea creature': ['food fish', 'saltwater fish', 'young fish', 'fingerling'],
  'Name an article of clothing': ['clothing', 'apparel', 'garment', 'wear', 'attire', 'dress', 'clothes', 'array', 'covering', 'protective garment', 'nightwear', 'sleepwear', 'outerwear', 'overclothes', 'underwear', 'underclothes', 'wearable', 'vesture', 'habiliment', 'civilian clothing', 'mufti', 'slops', 'chador', 'habit', 'sable'],
  'Name a part of the human body': ['organ', 'external body part', 'claw', 'chela', 'swimmeret', 'pleopod', 'furcula', 'snout', 'neb', 'malposed tooth', 'pseudopod', 'flipper', 'hoof', 'paw', 'wing', 'tail', 'fin', 'beak', 'horn', 'tentacle', 'antenna', 'gill', 'feather', 'scale'],
  'Name a dessert': ['tortilla', 'pancake', 'battercake', 'buttermilk pancake', 'ice', 'frappe'],
  'Name a color': ['Black', 'White', 'Gray', 'Grey'],
  'Name a soup': ['soup', 'potage'],
  'Name a famous scientist': ['Karl Marx', 'Henry David Thoreau', 'Adam Smith'],
  'Name a currency': ['ADB Unit of Account', 'Account', 'para', 'Unit of Account', 'Bond Markets Unit European Composite Unit', 'Bond Markets Unit European Monetary Unit', 'Gold', 'Silver', 'Platinum', 'Palladium', 'SDR', 'Codes specifically reserved for testing purposes', 'The codes assigned for transactions where no currency is involved', 'WIR Euro', 'WIR Franc', 'Sucre'],
  'Name a Marvel character': ['Ghost', 'Stick'],
  'Name a mountain or peak': ['Black Hills'],
  'Name a city in Texas': ['Memphis'],
};

const out = {};
let added = 0, aliases = 0;
const report = [];
for (const [prompt, data] of Object.entries(src)) {
  const q = BANK.find(x => x.prompt === prompt);
  if (!q) throw new Error('unknown prompt ' + prompt);
  const block = new Set((BLOCK[prompt] || []).map(T.norm));
  const taken = new Map();   // norm and loose keys -> canon
  const looseTaken = new Map();
  const ents = T.entries(q);
  for (const e of ents) for (const f of e.forms) {
    taken.set(T.norm(f), e.canon);
    const k = T.keysFor(f);
    if (k) looseTaken.set(k.compact, e.canon);
  }
  const add = {}, alias = {};
  let nAdd = 0, nAlias = 0;
  for (const item of data.items) {
    const forms = item.forms.filter(f => !block.has(T.norm(f)));
    if (!forms.length || block.has(T.norm(item.forms[0]))) continue;
    // does any spelling already belong to an answer?
    let owner = null;
    for (const f of forms) {
      owner = taken.get(T.norm(f)) || (T.keysFor(f) && looseTaken.get(T.keysFor(f).compact));
      if (owner) break;
    }
    const fresh = forms.filter(f => !taken.has(T.norm(f)));
    if (owner) {
      for (const f of fresh) {
        (alias[owner] = alias[owner] || []).push(f);
        taken.set(T.norm(f), owner);
        nAlias++;
      }
      continue;
    }
    if (data.aliasOnly || !fresh.length) continue;
    const canon = fresh[0];
    (add[item.tier] = add[item.tier] || []).push(fresh.join('/'));
    for (const f of fresh) {
      taken.set(T.norm(f), canon);
      const k = T.keysFor(f);
      if (k) looseTaken.set(k.compact, canon);
    }
    nAdd++;
  }
  if (nAdd || nAlias) out[prompt] = { add, alias };
  added += nAdd; aliases += nAlias;
  report.push(`${String(ents.length).padStart(5)} -> ${String(ents.length + nAdd).padStart(6)}  (+${nAlias} aliases)  ${prompt}`);
}

const header = `// GENERATED by tools/expand/merge.js from open datasets (see tools/expand/sources.py).
// Do not edit by hand: change the hand sheets or the expansion config and re-run
//   node tools/expand/dump-hand.js && python3 tools/expand/sources.py && node tools/expand/merge.js
`;
fs.writeFileSync(path.join(QDIR, 'zz_expanded.js'), header + 'Trench.extend(' + JSON.stringify(out) + ');\n');
console.log(report.join('\n'));
console.log(`\nadded ${added} answers and ${aliases} aliases -> server/questions/zz_expanded.js (${Math.round(fs.statSync(path.join(QDIR, 'zz_expanded.js')).size / 1024)} KB)`);
