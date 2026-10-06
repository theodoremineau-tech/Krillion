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
  // Depth works like Krillion's: every point is 10 m of descent (a perfect 10-prompt day = 10,000 m).
  const M_PER_PT = 10;
  const MAX_DEPTH_M = 10000;
  const ZONES = [                        // real ocean zones, by metres
    { max: 0,        name: 'Surface' },
    { max: 200,      name: 'Sunlight zone' },
    { max: 1000,     name: 'Twilight zone' },
    { max: 4000,     name: 'Midnight zone' },
    { max: 6000,     name: 'Abyssal zone' },
    { max: Infinity, name: 'Hadal zone' },
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

  // British and American spellings compare equal (both sides go through this, so the mapped form
  // only has to be consistent, not correct): colour/color, centre/center, organise/organize, grey/gray.
  const SPELLING = { grey: 'gray', tyre: 'tire', tyres: 'tires', kerb: 'curb', mould: 'mold', plough: 'plow', cheque: 'check', draught: 'draft',
    pyjamas: 'pajamas', sulphur: 'sulfur', programme: 'program', omelette: 'omelet', yoghurt: 'yogurt', doughnut: 'donut', doughnuts: 'donuts',
    jewellery: 'jewelry', aluminium: 'aluminum', whisky: 'whiskey', liquorice: 'licorice', mum: 'mom', pyjama: 'pajama', aeroplane: 'airplane',
    axe: 'ax', catalogue: 'catalog', dialogue: 'dialog', manoeuvre: 'maneuver', storey: 'story', cosy: 'cozy', sceptic: 'skeptic', defence: 'defense',
    offence: 'offense', licence: 'license', practise: 'practice', ageing: 'aging', enquiry: 'inquiry', pedlar: 'peddler', tsar: 'czar', tzar: 'czar' };
  function spelling(t) {
    if (SPELLING[t]) return SPELLING[t];
    if (t.length < 6 || /\d/.test(t)) return t;
    return t
      .replace(/([bcdfghjklmnpqrstvwxz])our(s?)$/, '$1or$2')   // colour, flavour, harbour (not four, hour, tour)
      .replace(/([bt])re(s?)$/, '$1er$2')                      // centre, theatre, litre, fibre, sabre
      .replace(/is(e|ed|es|ing|ation|ations)$/, 'iz$1')        // organise, recognised, realisation
      .replace(/ys(e|ed|es|ing)$/, 'yz$1')                     // analyse, paralysed
      .replace(/ogue(s?)$/, 'og$1')                            // catalogue, analogue
      .replace(/ll(ed|ing|er)$/, 'l$1');                       // travelled, modelling, traveller
  }
  function tokens(s) {
    const n = norm(s);
    if (!n) return [];
    return n.split(' ').map(t => NUMBER_WORDS[t] || TOKEN_MAP[t] || spelling(t));
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
      raw: f2.join(''),          // unstemmed: typo budgets and sound keys use the full spelling
      raw1: f1.join(''),         // same, with category words kept ("friedliverattack")
      toks: l2,
      toks1: l1,
      all: t0,                   // every word as typed: used to break ties ("Georgia State" over "Georgia")
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
    if (question._entries) return question._entries;
    const out = [];
    const byCanon = new Map();
    const push = (tier, entry, auto) => {
      const forms = entry.split('/').map(s => s.trim()).filter(Boolean);
      if (!forms.length) return;
      const e = { tier, canon: forms[0], forms, auto: !!auto };
      out.push(e);
      byCanon.set(forms[0], e);
    };
    for (const tier of TIER_ORDER) {
      const raw = question.sheet[tier];
      if (raw) for (const entry of raw.split(';')) push(tier, entry, false);
    }
    // hand-written deep cuts added later (Trench.more); skipped when already on the sheet
    if (question.more) {
      const have = new Set(out.flatMap(e => e.forms.map(norm)));
      for (const [tier, raw] of question.more) {
        for (const entry of raw.split(';')) {
          const forms = entry.split('/').map(s => s.trim()).filter(Boolean);
          if (!forms.length || forms.some(f => have.has(norm(f)))) continue;
          forms.forEach(f => have.add(norm(f)));
          push(tier, forms.join('/'), false);
        }
      }
    }
    // generated expansion (server/questions/zz_expanded.js): extra answers + extra aliases
    const x = question.expanded;
    if (x) {
      for (const tier of TIER_ORDER) for (const entry of (x.add && x.add[tier]) || []) push(tier, entry, true);
      for (const [canon, aliases] of Object.entries(x.alias || {})) {
        const e = byCanon.get(canon);
        if (e) for (const a of aliases) if (!e.forms.includes(a)) e.forms.push(a);
      }
    }
    question._entries = out;
    return out;
  }

  /** More hand-written answers for an existing prompt: more('Prompt', { schooler: '...', rare: '...', deep: '...', one: '...' }) */
  function more(prompt, tiers) {
    const qs = (root.TRENCH_BANK || []).find(q => q.prompt === prompt);
    if (!qs) throw new Error('more: unknown prompt ' + prompt);
    qs.more = qs.more || [];
    for (const t of TIER_ORDER) if (tiers[t]) qs.more.push([t, tiers[t]]);
    qs._entries = null; qs._index = null;
  }

  /** Attach generated answers to prompts: { 'Prompt text': { add: {tier: [...]}, alias: {canon: [...]} } } */
  function extend(map) {
    for (const [prompt, x] of Object.entries(map)) {
      const qs = (root.TRENCH_BANK || []).find(q => q.prompt === prompt);
      if (!qs) throw new Error('extend: unknown prompt ' + prompt);
      qs.expanded = x;
      qs._entries = null; qs._index = null;
    }
  }

  /** Stemmed words inside brackets: "Baseball (drinking game)" -> {drinking, game}. Null when none. */
  function requiredTokens(form) {
    const m = String(form).match(/\(([^)]+)\)/g);
    if (!m) return null;
    const req = new Set();
    for (const part of m) for (const t of tokens(part.slice(1, -1))) req.add(stem(t));
    return req.size ? req : null;
  }

  const AMBIG = { ambiguous: true };
  function put(map, key, val) {
    if (!key) return;
    const cur = map.get(key);
    if (!cur) map.set(key, val);
    else if (cur !== AMBIG && cur.canon !== val.canon) map.set(key, AMBIG);
  }

  // ---------- sound-alike key ----------
  // A rough English phonetic code: "Kathmandu"/"Cathmandu", "Tennessee"/"Tenese", "Scaphoid"/"Scafoid"
  // and "Somalia"/"Zomalia" all collapse to the same key. Vowels are kept (as one symbol) so short
  // words don't all collide.
  function phon(compact) {
    let s = compact.replace(/[^a-z0-9]/g, '');
    if (!s) return '';
    s = s.replace(/^(kn|gn|pn)/, 'n').replace(/^wr/, 'r').replace(/^ps/, 's').replace(/^x/, 's').replace(/^wh/, 'w');
    s = s.replace(/([a-z])\1+/g, '$1');
    s = s.replace(/ph/g, 'f').replace(/gh(?![aeiouy])/g, '').replace(/sch/g, 'sk').replace(/tch/g, 'ch')
      .replace(/dg(?=[eiy])/g, 'j').replace(/c(?=[eiy])/g, 's').replace(/ck/g, 'k').replace(/(ch|sh)/g, 'x')
      .replace(/c/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/th/g, '0')
      .replace(/y/g, 'i').replace(/w(?![aeiou])/g, '');
    s = s.replace(/([^aeiou])e$/, '$1').replace(/[aeiou]+/g, 'a').replace(/([a-z0-9])\1+/g, '$1');
    return s;
  }
  // letters people swap at the start of a word: Cimono/Kimono, Zochi/Sochi, Fennel/Phennel
  const FIRST_CLASS = { c: 'k', k: 'k', q: 'k', s: 's', z: 's', f: 'f', p: 'f', i: 'i', y: 'i', e: 'i', j: 'j', g: 'j', v: 'v', w: 'v', a: 'a', o: 'a', u: 'a' };
  const sameStart = (a, b) => a[0] === b[0] || (FIRST_CLASS[a[0]] && FIRST_CLASS[a[0]] === FIRST_CLASS[b[0]]) ||
    (a[0] === b[1] && a[1] === b[0]);

  function buildIndex(question) {
    if (question._index) return question._index;
    const extra = question.opts.strip ? new Set(question.opts.strip.map(w => norm(w))) : null;
    const all = entries(question);
    // Category words only count as droppable when this prompt actually uses them
    // ("dog" for dog breeds, "airlines" for airlines), so "Hawaiian roll" never becomes "Hawaiian".
    const promptWords = tokens(question.prompt);
    const vocab = new Set(promptWords);
    for (const e of all) for (const f of e.forms) for (const t of tokens(f)) vocab.add(t);
    const soft = new Set([...SOFT].filter(w => vocab.has(w)));
    // the prompt's own words are optional too (Krillion: "Makeup" counts for "Makeup brush" on "Name a type of brush")
    for (const w of promptWords) if (w.length >= 4 && w !== 'name' && !NO_SOLO_TOKEN.has(w) && vocab.has(w)) soft.add(w);
    const idx = { exact: new Map(), names: new Map(), loose: new Map(), looser: new Map(), compact: new Map(), sorted: new Map(), phon: new Map(),
      token: new Map(), keys: [], extra, soft };
    // exact forms first; an exact form always beats a looser collision
    for (const e of all) for (const f of e.forms) { const k = norm(f); if (k && !idx.exact.has(k)) idx.exact.set(k, e); }
    const tokenOwners = new Map();
    const seenKey = new Set();
    for (const e of all) {
      for (const f of e.forms) {
        const k = keysFor(f, extra, soft);
        if (!k) continue;
        // "Baseball (drinking game)": the bracketed part tells the answer apart from a plain
        // "baseball" that isn't on this sheet, so a partial answer must include one of those words
        const req = requiredTokens(f);
        put(idx.loose, k.loose, e);
        put(idx.looser, k.looser, e);
        put(idx.compact, k.compact, e);
        if (k.compact1 !== k.compact) put(idx.compact, k.compact1, e);
        const raw = norm(f).replace(/ /g, '');
        if (raw !== k.compact) put(idx.compact, raw, e);
        if (k.toks.length > 1) put(idx.sorted, k.toks.slice().sort().join(' '), e);
        if (k.raw.length >= (e.auto ? 6 : 5)) {
          const pk = phon(k.raw);
          const list = idx.phon.get(pk) || [];
          if (!list.some(x => x.e === e)) list.push({ e, raw: k.raw, key: { all: k.all } });
          idx.phon.set(pk, list);
        }
        const sig = e.canon + '|' + k.compact;
        if (k.compact.length >= 3 && !seenKey.has(sig)) { seenKey.add(sig); idx.keys.push({ c: k.compact, r: k.raw, toks: k.toks, all: k.all, e, auto: e.auto, req }); }
        // the form with its category word kept, so "Fried Liver attak" can reach "Fried Liver Attack"
        const sig1 = e.canon + '|' + k.compact1;
        if (k.compact1 !== k.compact && !seenKey.has(sig1)) { seenKey.add(sig1); idx.keys.push({ c: k.compact1, r: k.raw1, toks: k.toks1, all: k.all, e, auto: e.auto, req, full: true }); }
        if (k.toks.length > 1 && k.toks.length <= 4) {
          for (const t of k.toks) {
            if (t.length < 4 || NO_SOLO_TOKEN.has(t) || /^\d+$/.test(t)) continue;
            if (req && !req.has(t)) continue;
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
    // people prompts: a surname alone counts, and so does a distinctive first name ("Kobe", "Shaq")
    if (question.opts.names) {
      // a surname or distinctive first name alone counts ("Ruth", "Kobe"); when it is shared,
      // a hand-written (well-known) person beats the deep-list ones
      const maps = { last: [new Map(), new Map()], first: [new Map(), new Map()] };
      for (const e of all) {
        for (const f of e.forms) {
          const toks = dropInitials(tokens(f)).filter(t => !['jr', 'junior', 'sr', 'senior', 'ii', 'iii', 'iv'].includes(t));
          if (toks.length > 1) {
            for (const m of e.auto ? [1] : [0, 1]) {
              put(maps.last[m], toks[toks.length - 1], e);
              put(maps.first[m], toks[0], e);
            }
          }
        }
      }
      const pickName = (hand, any, key) => {
        const h = hand.get(key);
        if (h && h !== AMBIG) return h;
        if (h === AMBIG) return null;
        const a = any.get(key);
        return a && a !== AMBIG ? a : null;
      };
      const keysOf = m => new Set([...m[0].keys(), ...m[1].keys()]);
      // these land in idx.names (not idx.exact) so the match reports how: 'name' and the
      // player can be shown "roosevelt -> Franklin D. Roosevelt" before it locks in
      for (const l of keysOf(maps.last)) {
        const e = pickName(maps.last[0], maps.last[1], l);
        if (e && !idx.exact.has(l) && l.length >= 3) {
          idx.names.set(l, e);
          if (l.length >= 4) idx.keys.push({ c: l, r: l, toks: [l], e, surname: true, auto: e.auto });
        }
      }
      for (const f of keysOf(maps.first)) {
        const e = pickName(maps.first[0], maps.first[1], f);
        if (e && !e.auto && !idx.exact.has(f) && !idx.names.has(f) && f.length >= 4) idx.names.set(f, e);
      }
    }
    question._index = idx;
    return idx;
  }

  function result(e, how) {
    return { tier: e.tier, pts: TIERS[e.tier].pts, canon: e.canon, how, fuzzy: how !== 'exact' };
  }
  // Match kinds the player should confirm before they lock in (Krillion's "x -> y, submit again").
  // 'loose' is left out: plurals, spacing, "Mount"/"the" and aliases are the same answer, not a guess.
  const CONFIRM_HOW = new Set(['typo', 'sound', 'words', 'extra words', 'partial', 'missing', 'name']);
  const needsConfirm = how => CONFIRM_HOW.has(how);

  // typo allowance: roughly one slip per four letters. `lenient` lets a 4-letter non-word
  // ("keny", "indi") be one slip from a 5-letter answer.
  function typoBudget(len, lenient) {
    if (len < 4) return 0;
    if (len < 5) return lenient ? 1 : 0;
    if (len < 8) return 1;
    if (len < 12) return 2;
    if (len < 16) return 3;
    if (len < 20) return 4;
    return 5;
  }
  function tokenBudget(len) { return len < 4 ? 0 : len < 8 ? 1 : 2; }

  /** True when every word of `part` appears in `whole`, in the same order (gaps allowed). */
  function isSubsequence(part, whole) {
    let j = 0;
    for (const t of whole) if (j < part.length && part[j] === t) j++;
    return j === part.length;
  }

  /** Every input token pairs with a different answer token, each within its own typo budget.
   *  Returns the summed distance, or -1. Order doesn't matter. */
  function tokensMatch(inp, ans) {
    const used = new Array(ans.length).fill(false);
    let total = 0;
    for (const t of inp) {
      let best = -1, bestD = 99;
      for (let j = 0; j < ans.length; j++) {
        if (used[j]) continue;
        const a = ans[j];
        if (a === t) { best = j; bestD = 0; break; }
        const b = Math.min(tokenBudget(t.length), tokenBudget(a.length));
        if (!b || !sameStart(t, a)) continue;
        const d = dist(t, a, b);
        if (d <= b && d < bestD && !(root.TRENCH_WORDS && root.TRENCH_WORDS.has(t) && root.TRENCH_WORDS.has(a))) { best = j; bestD = d; }
      }
      if (best < 0) return -1;
      used[best] = true; total += bestD;
    }
    return total;
  }

  /** Grade a typed answer. Returns null when it isn't on the sheet, otherwise
   *  { tier, pts, canon, how }. Forgives typos (about one per four letters), sound-alike
   *  spellings, swapped letters, word order, missing or extra spaces, plurals, filler and
   *  category words, extra words around the answer, initials, and surnames/first names for
   *  people prompts. When two answers are equally close, the lower-scoring one wins. */
  function grade(question, input) {
    const idx = buildIndex(question);
    const ex = norm(input);
    if (!ex) return null;
    let hit = idx.exact.get(ex);
    if (hit) return result(hit, 'exact');
    hit = idx.names.get(ex);
    if (hit) return result(hit, 'name');
    const k = keysFor(input, idx.extra, idx.soft);
    if (!k) return null;
    const rawIn = ex.replace(/ /g, '').replace(/^the(?=.{4})/, '');
    for (const [map, key] of [[idx.loose, k.loose], [idx.looser, k.looser], [idx.compact, k.compact], [idx.compact, k.compact1],
      [idx.compact, rawIn], [idx.compact, ex.replace(/ /g, '')]]) {
      hit = map.get(key);
      if (hit && hit !== AMBIG) return result(hit, 'loose');
    }
    if (idx.exact.has(k.loose)) return result(idx.exact.get(k.loose), 'loose');
    if (idx.names.has(k.loose)) return result(idx.names.get(k.loose), 'name');
    if (k.toks.length > 1) {
      hit = idx.sorted.get(k.toks.slice().sort().join(' '));
      if (hit && hit !== AMBIG) return result(hit, 'loose');
    }
    const W = root.TRENCH_WORDS;
    const realWord = t => W && W.has(t);
    // one distinctive word ("Teton" -> "Grand Teton", "Saudi" -> "Saudi Arabia"): it must belong to
    // exactly one answer on this sheet, and be either uncommon across the bank or not an everyday word
    if (k.toks.length === 1 && k.compact.length >= 4) {
      const t = k.toks[0];
      const freq = globalTokenFreq().get(t) || 0;
      hit = idx.token.get(t);
      if (hit && hit !== AMBIG) {
        // dataset answers keep the strict rule (the big lists are where "kafka" -> Ashley Kafka lives)
        const ok = hit.auto ? freq <= 2 : (!realWord(t) || (freq <= 6 && t.length >= 5));
        if (ok) return result(hit, 'partial');
      }
    }

    // ---- scored candidates ----
    const c = k.compact, r = k.raw;
    const cands = [];
    let curKey = null;
    const add = (e, cost, how) => cands.push({ e, cost, how, key: curKey });
    const p = r.length >= 5 ? phon(r) : '';
    for (const { e, raw: target, key: pk } of (p.length >= 4 && idx.phon.get(p)) || []) {
      // sounds the same and is still recognisably the same spelling
      const lim = Math.max(2, Math.ceil(target.length / 3));
      if (!sameStart(r, target)) continue;
      const d = dist(r, target, lim);
      curKey = pk || null;
      if (d <= lim) add(e, 0.6 + d / 10, 'sound');
    }
    // a real word isn't a typo of a different real word ("monkey" vs "money")
    const realSwap = (a, b) => a !== b && realWord(a) && realWord(b);
    const lenient = k.toks.length === 1 && r.length >= 4 && !realWord(r);
    const allowedExtra = idx.extraOk || (idx.extraOk = new Set([...FILLER, ...SOFT, ...tokens(question.prompt), 'famous', 'my', 'answer', 'player', 'team', 'group', 'brand', 'type', 'kind']));
    for (const key of idx.keys) {
      const kc = key.c;
      curKey = key;
      // Whole-answer edit distance, Krillion-style: about one slip per four letters of the longer
      // spelling, the first letter included ("pasketball" -> Basketball), so a dropped word inside a
      // long answer also fits ("united emirates" -> United Arab Emirates).
      const kr = key.r || kc;
      const longer = Math.max(r.length, kr.length);
      // generated deep-list answers get a tighter allowance so stray words don't land on an
      // obscure entry: one slip from 6 letters, two from 10
      const b = key.auto ? (longer >= 10 ? 2 : longer >= 6 ? 1 : 0) : typoBudget(longer, lenient);
      // a whole extra tail or head of three or more letters isn't a typo ("Kryptonite" is not "Krypton", "Mini" is not "Mini golf")
      const ext = (r.startsWith(kr) || kr.startsWith(r)) ? Math.abs(r.length - kr.length) : 0;
      // a wrong first letter is fine in a non-word ("pasketball"); a real word must at least start
      // right, or "chad" would offer Hades and "vandal" Sandals
      if (b && ext < 3 && (sameStart(r, kr) || !realWord(r))) {
        // measured on the full spelling: plurals are already handled by the stemmed lookups above,
        // and comparing stems here let "slo" reach Shoes via "sho"
        const d = dist(r, kr, b);
        // Krillion offers "bones" -> Bonus and "fitter" -> Filter, so a real word may be ONE slip from
        // a hand-written answer once it has 5+ letters; the guard stays for two slips ("baseball" is
        // not Basketball), 4-letter words, and the big dataset lists ("monkey" is not some obscure Money)
        const guard = k.toks.length === 1 && key.toks.length === 1 && (key.auto || r.length < 5 || d > 1) && realSwap(r, kr);
        if (d <= b && !guard) add(key.e, d + (r[0] === kr[0] ? 0 : 0.5), 'typo');
      }
      if (key.surname || key.full) continue;
      // word-by-word: any order, small typos inside each word
      if (k.toks.length > 1 && key.toks.length === k.toks.length) {
        const d = tokensMatch(k.toks, key.toks);
        if (d >= 0 && (!key.auto || d <= 1)) add(key.e, d + 0.3, 'words');
      }
      // the answer plus a couple of extra words ("Tiger Woods the golfer"); the answer's own
      // words must be spelled right (one slip allowed in long answers)
      if (k.toks.length > key.toks.length && k.toks.length - key.toks.length <= 2 && kc.length >= 5 &&
          k.toks.every(t => key.toks.includes(t) || allowedExtra.has(t))) {
        const d = tokensMatch(key.toks, k.toks);
        if (d === 0 || (d === 1 && kc.length >= 8 && !key.auto)) add(key.e, d + 1.5, 'extra words');
      }
      // most of the answer, in order ("united emirates" -> United Arab Emirates, "baseball drinking"
      // -> Baseball (drinking game)): at least two words, at least half of the answer's words, every
      // typed word somewhere in the answer, and one of the bracketed words when the answer has them
      if (k.toks.length >= 2 && key.toks.length > k.toks.length && k.toks.length * 2 >= key.toks.length &&
          isSubsequence(k.toks, key.toks) && k.toks.some(t => t.length >= 4 && !NO_SOLO_TOKEN.has(t)) &&
          (!key.req || k.toks.some(t => key.req.has(t)))) {
        add(key.e, 1.2 + (key.toks.length - k.toks.length) / key.toks.length, 'missing');
      }
    }
    if (!cands.length) return null;
    // cheapest wins; at a tie, the answer that contains more of the typed words ("georgiaa state"
    // -> Georgia State, not Georgia), then the lower-scoring answer
    const overlap = cand => { const words = new Set(cand.all || []); return k.all.filter(t => words.has(t)).length; };
    for (const cnd of cands) cnd.ov = overlap(cnd.key || {});
    cands.sort((x, y) => x.cost - y.cost || y.ov - x.ov || TIERS[x.e.tier].pts - TIERS[y.e.tier].pts);
    return result(cands[0].e, cands[0].how);
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
  function depthFor(score) { return Math.max(0, Math.round((score || 0) * M_PER_PT)); }
  function zoneFor(depthM) {
    for (const z of ZONES) if (depthM <= z.max) return z.name;
    return ZONES[ZONES.length - 1].name;
  }
  /** Build a prompt's answer index ahead of time so the first answer on it isn't slow. */
  function warm(question) { buildIndex(question); globalTokenFreq(); }

  function add(cat, ...qs) { for (const x of qs) { x.cat = cat; root.TRENCH_BANK.push(x); } }

  const api = {
    TIERS, TIER_ORDER, MAX_PTS, MAX_DEPTH_M, M_PER_PT, ZONES,
    norm, keysFor, phon, q, add, more, extend, grade, needsConfirm, buildIndex, warm, entries, hash, dist,
    todayStr, dayIndex, addDays, pickDaily,
    depthFor, zoneFor,
  };
  root.Trench = api;
  root.TRENCH_BANK = root.TRENCH_BANK || [];
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
