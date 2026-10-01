/* Trench core: answer matching, rarity tiers, daily selection, depth.
 * Pure logic. Runs on the server (Netlify Function) and in Node tests.
 */
(function (root) {
  'use strict';

  // ---------- Tiers ----------
  const TIERS = {
    plankton: { key: 'plankton', name: 'Plankton',         pts: 10 },
    clever:   { key: 'clever',   name: 'Too Clever',       pts: 15 },
    schooler: { key: 'schooler', name: 'Schooler',         pts: 30 },
    rare:     { key: 'rare',     name: 'Rare',             pts: 60 },
    deep:     { key: 'deep',     name: 'Deep Cut',         pts: 85 },
    one:      { key: 'one',      name: 'One in a Million', pts: 100 },
  };
  const TIER_ORDER = ['plankton', 'clever', 'schooler', 'rare', 'deep', 'one'];
  const MAX_PTS = 100;
  const MAX_DEPTH_M = 10935; // Challenger Deep: a perfect dive lands here.

  const ZONES = [
    { max: 0,      name: 'Surface' },
    { max: 0.0183, name: 'Sunlight zone' },  // ~200 m
    { max: 0.0915, name: 'Twilight zone' },  // ~1,000 m
    { max: 0.3658, name: 'Midnight zone' },  // ~4,000 m
    { max: 0.5487, name: 'Abyssal zone' },   // ~6,000 m
    { max: 1.01,   name: 'Hadal zone' },
  ];

  // ---------- Normalisation ----------
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\+/g, ' plus ')
      .replace(/#/g, ' sharp ')
      .replace(/['’‘`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/^(the|a|an) /, '')
      .trim();
  }

  const NUMBER_WORDS = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
    nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
    sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30',
    forty: '40', fifty: '50', hundred: '100', first: '1st', second: '2nd', third: '3rd',
  };
  const TOKEN_MAP = { saint: 'st', ste: 'st', mt: 'mount', ft: 'fort', jr: 'junior', sr: 'senior', vs: 'versus', usa: 'us', u: 'u' };
  // Level 1: words that never carry the answer ("Mount Everest" = "Everest", "Lake Tahoe" = "Tahoe").
  const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'mount', 'lake', 'loch', 'river', 'city', 'island', 'islands',
    'isle', 'national', 'park', 'desert', 'sea', 'fc', 'afc', 'cf', 'club', 'dr', 'mr', 'mrs', 'ms', 'doctor', 'de', 'la', 'le', 'el']);
  // Level 2: category words people tack on ("Corn snake", "Golden retriever dog", "Sicilian defense").
  const SOFT = new Set(['dog', 'dogs', 'cheese', 'pasta', 'bread', 'tree', 'flower', 'bird', 'snake', 'fish', 'shark',
    'whale', 'game', 'opening', 'defense', 'defence', 'attack', 'system', 'variation', 'cereal', 'soda', 'pop', 'brand',
    'car', 'cars', 'beer', 'wine', 'grape', 'cocktail', 'sauce', 'band', 'movie', 'film', 'show', 'tv', 'song', 'album',
    'team', 'breed', 'variety', 'language', 'dance', 'style', 'sport', 'resort', 'course', 'golf', 'beach', 'company',
    'inc', 'corp', 'corporation', 'co', 'airlines', 'airline', 'airways', 'bank', 'group', 'capital', 'partners',
    'tea', 'soup', 'drink', 'shot', 'sandwich', 'cake', 'pie', 'cookie', 'candy', 'chips', 'plant',
    'stone', 'gem', 'gemstone', 'nut', 'nuts', 'herb', 'spice', 'seed', 'seeds', 'leaf', 'leaves',
    'constellation', 'moon', 'planet', 'element', 'bone', 'cloud', 'clouds', 'family', 'emperor', 'king', 'queen', 'president', 'battle', 'war', 'of', 'state', 'county',
    'province', 'territory', 'country', 'republic', 'kingdom', 'empire', 'musical', 'play', 'book', 'novel', 'series',
    'character', 'god', 'goddess', 'neighborhood', 'district', 'borough', 'town', 'village', 'airport', 'stadium',
    'arena', 'field', 'ballpark', 'bridge', 'tower', 'building',
    'whiskey', 'whisky', 'vodka', 'gin', 'rum', 'tequila',
    'bourbon', 'liqueur', 'shoes', 'shoe', 'boots', 'boot', 'hat', 'jacket', 'coat', 'dress', 'shirt', 'pants']);
  const NO_SOLO_TOKEN = new Set(['great', 'north', 'south', 'east', 'west', 'new', 'san', 'santa', 'st', 'grand', 'big',
    'little', 'red', 'blue', 'black', 'white', 'green', 'golden', 'royal', 'united', 'king', 'queen', 'lady', 'sir',
    'old', 'young', 'upper', 'lower', 'central', 'saint', 'mount', 'lake', 'river', 'city', 'national', 'american',
    'english', 'french', 'german', 'italian', 'spanish', 'irish', 'scottish', 'british', 'japanese', 'chinese',
    'mexican', 'indian', 'african', 'south', 'northern', 'southern', 'eastern', 'western', 'common', 'giant', 'dwarf',
    'baby', 'captain', 'doctor', 'professor', 'super', 'mega', 'mister', 'miss', 'prince', 'princess', 'lord', 'jr',
    'junior', 'senior', 'club', 'pie', 'cake', 'sauce', 'soup', 'bread', 'cheese', 'roll', 'salad', 'fried', 'sweet',
    'hot', 'cold', 'iced', 'dark', 'light', 'double', 'triple', 'single', 'classic', 'original', 'special', 'deluxe']);

  const DIRECTIONAL = new Set(['north', 'south', 'east', 'west', 'new', 'upper', 'lower', 'northern', 'southern', 'eastern', 'western', 'central']);

  function stem(w) {
    if (w.length <= 3 || /^\d/.test(w)) return w;
    let s = w;
    if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
    else if (s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
    if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
    return s;
  }

  function tokens(s) {
    const n = norm(s);
    if (!n) return [];
    return n.split(' ').map(t => NUMBER_WORDS[t] || TOKEN_MAP[t] || t);
  }
  function strip(toks, set, extra) {
    const out = toks.filter(t => !set.has(t) && !(extra && extra.has(t)));
    return out.length ? out : toks;
  }
  function dropInitials(toks) {
    if (toks.length < 2) return toks;
    const out = toks.filter(t => t.length > 1 || /\d/.test(t));
    return out.length ? out : toks;
  }
  /** The three comparison keys for a string, from strict to loose. */
  const isModifier = t => NO_SOLO_TOKEN.has(t) || DIRECTIONAL.has(t);
  function keysFor(s, extra, soft) {
    const t0 = tokens(s);
    if (!t0.length) return null;
    let f1 = dropInitials(strip(t0, FILLER, extra));
    if (f1.length < t0.length && f1.every(isModifier)) f1 = t0;          // "South Park" stays "south park"
    let f2 = soft ? strip(f1, soft) : f1;
    if (f2.length < f1.length && f2.every(isModifier)) f2 = f1;
    const l1 = f1.map(stem), l2 = f2.map(stem);
    return {
      exact: norm(s),
      loose: l1.join(' '),
      looser: l2.join(' '),
      compact: l2.join(''),
      compact1: l1.join(''),
      toks: l2,
    };
  }

  // How many answers across the whole bank use a word: "Teton" is distinctive, "cherry" is not.
  let tokenFreq = null, tokenFreqN = -1;
  function globalTokenFreq() {
    const bank = root.TRENCH_BANK || [];
    if (tokenFreq && tokenFreqN === bank.length) return tokenFreq;
    tokenFreq = new Map(); tokenFreqN = bank.length;
    for (const q of bank) for (const e of entries(q)) {
      const seen = new Set();
      for (const f of e.forms) for (const t of tokens(f)) seen.add(stem(t));
      for (const t of seen) tokenFreq.set(t, (tokenFreq.get(t) || 0) + 1);
    }
    return tokenFreq;
  }

  function hash(str) { // short stable id from the prompt text
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** Bounded optimal-string-alignment distance (Levenshtein + adjacent swaps). */
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const n = a.length, m = b.length;
    let pp = null, prev = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      const cur = new Array(m + 1);
      cur[0] = i;
      let rowMin = i;
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      pp = prev; prev = cur;
    }
    return prev[m];
  }
  function typoBudget(len) {
    if (len < 5) return 0;
    if (len < 8) return 1;
    if (len < 14) return 2;
    return 3;
  }

  /** q(prompt, plankton, clever, schooler, rare, deep, one, opts)
   *  Each tier is a string: "Answer; Other answer/alias/alias; ..."
   *  opts.names: people prompt; surnames count ("Woods" -> "Tiger Woods").
   *  opts.strip: extra words to ignore for this prompt. */
  function q(prompt, ...rest) {
    // opts may come early when trailing tiers are omitted
    const oi = rest.findIndex(x => x && typeof x === 'object');
    let opts = null;
    if (oi >= 0) { opts = rest[oi]; rest = rest.slice(0, oi); }
    const [plankton = '', clever = '', schooler = '', rare = '', deep = '', one = ''] = rest;
    return {
      id: hash(prompt),
      prompt,
      cat: (opts && opts.cat) || null,
      sheet: { plankton, clever, schooler, rare, deep, one },
      opts: opts || {},
    };
  }

  function entries(question) {
    const out = [];
    for (const tier of TIER_ORDER) {
      const raw = question.sheet[tier];
      if (!raw) continue;
      for (const entry of raw.split(';')) {
        const forms = entry.split('/').map(s => s.trim()).filter(Boolean);
        if (forms.length) out.push({ tier, canon: forms[0], forms });
      }
    }
    return out;
  }

  const AMBIG = { ambiguous: true };
  function put(map, key, val) {
    if (!key) return;
    const cur = map.get(key);
    if (!cur) map.set(key, val);
    else if (cur !== AMBIG && cur.canon !== val.canon) map.set(key, AMBIG);
  }

  function buildIndex(question) {
    if (question._index) return question._index;
    const extra = question.opts.strip ? new Set(question.opts.strip.map(w => norm(w))) : null;
    const all = entries(question);
    // Category words only count as droppable when this prompt actually uses them
    // ("dog" for dog breeds, "airlines" for airlines), so "Hawaiian roll" never becomes "Hawaiian".
    const vocab = new Set(tokens(question.prompt));
    for (const e of all) for (const f of e.forms) for (const t of tokens(f)) vocab.add(t);
    const soft = new Set([...SOFT].filter(w => vocab.has(w)));
    const idx = { exact: new Map(), loose: new Map(), looser: new Map(), compact: new Map(), token: new Map(), fuzzy: [], extra, soft };
    // exact forms first; an exact form always beats a looser collision
    for (const e of all) for (const f of e.forms) { const k = norm(f); if (k && !idx.exact.has(k)) idx.exact.set(k, e); }
    const tokenOwners = new Map();
    for (const e of all) {
      for (const f of e.forms) {
        const k = keysFor(f, extra, soft);
        if (!k) continue;
        put(idx.loose, k.loose, e);
        put(idx.looser, k.looser, e);
        put(idx.compact, k.compact, e);
        if (k.compact1 !== k.compact) put(idx.compact, k.compact1, e);
        if (k.compact.length >= 4) idx.fuzzy.push({ key: k.compact, e });
        if (k.toks.length > 1 && k.toks.length <= 4) {
          for (const t of k.toks) {
            if (t.length < 4 || NO_SOLO_TOKEN.has(t) || /^\d+$/.test(t)) continue;
            // "West Virginia" must not answer for "Virginia": a bare direction/"new" prefix makes a different place
            if (k.toks.some(o => o !== t && DIRECTIONAL.has(o))) continue;
            if (!tokenOwners.has(t)) tokenOwners.set(t, new Set());
            tokenOwners.get(t).add(e.canon);
            put(idx.token, t, e);
          }
        }
      }
    }
    // a lone word only counts when exactly one answer contains it
    for (const [t, owners] of tokenOwners) if (owners.size > 1) idx.token.set(t, AMBIG);
    // people prompts: surnames always eligible (even short ones like "Ali")
    if (question.opts.names) {
      const last = new Map();
      for (const e of all) {
        const toks = dropInitials(tokens(e.canon)).filter(t => !['jr', 'junior', 'sr', 'senior', 'ii', 'iii', 'iv'].includes(t));
        if (toks.length > 1) {
          const l = toks[toks.length - 1];
          put(last, l, e);
        }
      }
      for (const [l, e] of last) {
        if (!idx.exact.has(l) && e !== AMBIG && l.length >= 3) {
          idx.exact.set(l, e);
          if (l.length >= 5) idx.fuzzy.push({ key: l, e });
        }
      }
    }
    question._index = idx;
    return idx;
  }

  function result(e, how, input) {
    return { tier: e.tier, pts: TIERS[e.tier].pts, canon: e.canon, how, fuzzy: how !== 'exact' };
  }

  /** Grade a typed answer. Returns null when it isn't on the sheet, otherwise
   *  { tier, pts, canon, how }. Accepts typos, swapped letters, plurals, spacing,
   *  filler words, category words, initials and (for people) surnames. */
  function grade(question, input) {
    const idx = buildIndex(question);
    const ex = norm(input);
    if (!ex) return null;
    let hit = idx.exact.get(ex);
    if (hit) return result(hit, 'exact');
    const k = keysFor(input, idx.extra, idx.soft);
    if (!k) return null;
    for (const [map, key, how] of [[idx.loose, k.loose, 'loose'], [idx.looser, k.looser, 'loose'], [idx.compact, k.compact, 'loose'], [idx.compact, k.compact1, 'loose']]) {
      hit = map.get(key);
      if (hit && hit !== AMBIG) return result(hit, how);
    }
    if (idx.exact.has(k.loose)) return result(idx.exact.get(k.loose), 'loose');
    // one distinctive word ("Teton" -> "Grand Teton")
    if (k.toks.length === 1 && k.compact.length >= 4 && (globalTokenFreq().get(k.toks[0]) || 0) <= 2) {
      hit = idx.token.get(k.toks[0]);
      if (hit && hit !== AMBIG) return result(hit, 'partial');
    }
    // typo tolerance on the loosest key, scaled with length; must be a unique best match
    const c = k.compact;
    const budget = typoBudget(c.length);
    if (budget > 0) {
      let best = null, bestD = budget + 1, tie = false;
      for (const { key, e } of idx.fuzzy) {
        const b = Math.min(budget, typoBudget(key.length));
        if (b === 0) continue;
        if (key[0] !== c[0] && !(key[0] === c[1] && key[1] === c[0])) continue;
        const d = dist(c, key, b);
        if (d > b) continue;
        if (d < bestD) { bestD = d; best = e; tie = false; }
        else if (d === bestD && best && e.canon !== best.canon) tie = true;
      }
      if (best && !tie) return result(best, 'typo');
    }
    return null;
  }

  // ---------- Daily selection ----------
  function todayStr(tz, t) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York' }).format(new Date(t == null ? Date.now() : t));
  }
  function dayIndex(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000);
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Same date -> same prompts for everyone. Categories are interleaved so a day
   *  gets a mix, and nothing repeats until the whole bank has been used. */
  function pickDaily(bank, dateStr, perDay) {
    const n = bank.length;
    if (n <= perDay) return bank.slice();
    const perCycle = Math.floor(n / perDay);
    const di = dayIndex(dateStr);
    const cycle = Math.floor(di / perCycle);
    const slot = ((di % perCycle) + perCycle) % perCycle;
    const rng = mulberry32(cycle * 7919 + 1337);
    const order = bank.map((_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // round-robin across categories
    const groups = new Map();
    for (const i of order) {
      const c = bank[i].cat || 'misc';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(i);
    }
    const lanes = [...groups.values()];
    const mixed = [];
    while (mixed.length < n) for (const lane of lanes) if (lane.length) mixed.push(lane.shift());
    return mixed.slice(slot * perDay, slot * perDay + perDay).map(i => bank[i]);
  }

  // ---------- Depth ----------
  function depthFor(score, maxScore) {
    if (!maxScore) return 0;
    return Math.round((score / maxScore) * MAX_DEPTH_M);
  }
  function zoneFor(depthM) {
    const f = depthM / MAX_DEPTH_M;
    for (const z of ZONES) if (f <= z.max) return z.name;
    return ZONES[ZONES.length - 1].name;
  }

  function add(cat, ...qs) { for (const x of qs) { x.cat = cat; root.TRENCH_BANK.push(x); } }

  const api = {
    TIERS, TIER_ORDER, MAX_PTS, MAX_DEPTH_M, ZONES,
    norm, keysFor, q, add, grade, buildIndex, entries, hash, dist,
    todayStr, dayIndex, addDays, pickDaily,
    depthFor, zoneFor,
  };
  root.Trench = api;
  root.TRENCH_BANK = root.TRENCH_BANK || [];
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
