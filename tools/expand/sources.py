"""Builds tools/expand/out/sources.json: extra accepted answers per prompt, pulled from open
datasets, each with a popularity score (Zipf word frequency, the same "how often does this name
show up in real text" signal Krillion describes using for rarity).

Run from the repo root after `bash tools/expand/fetch.sh` and `node tools/expand/dump-hand.js`:
    python3 tools/expand/sources.py

Sources (all open licences): WordNet 3.0, dariusk/corpora (CC0), Chadwick Bureau register,
nflverse players, nba_api static player list, pycountry (ISO lists), GeoNames via all-the-cities,
OpenFlights airlines, FiveThirtyEight Marvel wikia data, GitHub Linguist, `pokemon` npm package.
"""
import csv, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
os.environ.setdefault('NLTK_DATA', os.path.join(CACHE, 'nltk_data'))
from nltk.corpus import wordnet as wn  # noqa: E402
from wordfreq import zipf_frequency  # noqa: E402
import pycountry  # noqa: E402

def J(path):
    with open(os.path.join(CACHE, path), encoding='utf-8') as f:
        return json.load(f)

def clean(s):
    s = re.sub(r'\s+', ' ', str(s).replace('_', ' ')).strip()
    return s

# ---------------------------------------------------------------- WordNet
def is_binomial(lemma):
    w = lemma.split(' ')
    if len(w) >= 2 and w[0][:1].isupper() and all(x[:1].islower() for x in w[1:]):
        if wn.synsets('genus_' + w[0].lower()) or wn.synsets(w[0], pos='n') and any('genus' in l.name() for s in wn.synsets(w[0], pos='n') for l in s.lemmas()):
            return True
        if all(zipf_frequency(x, 'en') < 1.8 for x in w[1:]):
            return True
    return bool(re.search(r'(idae|iformes|inae|aceae|ales|oidea|ata)$', w[-1])) and w[-1][:1].isupper()

def WN(*roots, min_depth=1, instances=None, exclude=(), keep=None):
    """All hyponyms (and named instances) under the root synsets, one entry per synset with its
    lemmas as aliases. instances=True keeps only named instances (people, places)."""
    out = []
    seen = set()
    for r in roots:
        root = wn.synset(r)
        stack = [(root, 0)]
        while stack:
            s, d = stack.pop()
            for c in s.hyponyms():
                stack.append((c, d + 1))
            for c in s.instance_hyponyms():
                stack.append((c, d + 1))
            if d < min_depth or s.name() in seen:
                continue
            seen.add(s.name())
            is_inst = bool(s.instance_hypernyms())
            if instances is True and not is_inst:
                continue
            if instances is False and is_inst:
                continue
            forms = []
            for l in s.lemma_names():
                l = clean(l)
                if is_binomial(l) or l.lower() in exclude or re.search(r'\d{3,}', l):
                    continue
                if keep and not keep(l):
                    continue
                forms.append(l)
            if forms:
                out.append(forms)
    return out

def best_first(forms):
    """Pick the display name: prefer a multi-word name (people), then the most common form."""
    return sorted(forms, key=lambda f: (-(len(f.split()) >= 2), -zipf_frequency(f, 'en'), len(f)))

def people(*roots, **kw):
    return [best_first(f) for f in WN(*roots, instances=True, **kw)]

# ---------------------------------------------------------------- corpora
def C(path, key=None, field=None):
    d = J(os.path.join('corpora/data', path + '.json'))
    if key is None:
        items = d if isinstance(d, list) else next(v for k, v in d.items() if isinstance(v, list))
    else:
        items = d[key]
    out = []
    for x in items:
        if isinstance(x, dict):
            if 'members' in x:
                out += [[clean(m)] for m in x['members']]
                continue
            x = x.get(field or 'name') or x.get('color') or x.get('neighborhood')
        if x:
            out.append([clean(x)])
    return out

def titlecase_list(lst):
    return [[f[0][:1].upper() + f[0][1:]] + f[1:] for f in lst]

# ---------------------------------------------------------------- places
_cities = None
def cities():
    global _cities
    if _cities is None:
        _cities = J('cities.json')
    return _cities

def city_list(countries=None, admin=None, min_pop=0, exclude_capitals=False):
    out = []
    for name, alt, cc, adm, pop, code in cities():
        if countries and cc not in countries:
            continue
        if admin and adm != admin:
            continue
        if pop < min_pop:
            continue
        if exclude_capitals and code == 'PPLC':
            continue
        forms = [name] + [a for a in (alt or '').split(',') if a and re.fullmatch(r"[A-Za-z .'\-]+", a)][:3]
        out.append((forms, pop))
    out.sort(key=lambda x: -x[1])
    return [f for f, _ in out]

def capitals():
    return [[name] + [a for a in (alt or '').split(',') if a and re.fullmatch(r"[A-Za-z .'\-]+", a)][:3]
            for name, alt, cc, adm, pop, code in cities() if code == 'PPLC']

EUROPE = set('AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GI GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK'.split())

def country_aliases():
    out = []
    for c in pycountry.countries:
        forms = [c.name] + [x for x in (getattr(c, 'common_name', None), getattr(c, 'official_name', None)) if x]
        forms = [f.split(',')[0] if ', ' in f and 'of' in f else f for f in forms]
        out.append(forms)
    return out

# ---------------------------------------------------------------- people in sports
def nba_players():
    from nba_api.stats.static import players
    return [[p['full_name']] for p in players.get_players()]

def mlb_players():
    out = []
    import glob
    for path in sorted(glob.glob(os.path.join(CACHE, 'chadwick/people-*.csv'))):
        with open(path, encoding='utf-8') as f:
            for r in csv.DictReader(f):
                if r['mlb_played_first'] and r['name_first'] and r['name_last']:
                    forms = [f"{r['name_first']} {r['name_last']}"]
                    if r['name_nick']:
                        forms.append(f"{r['name_nick']} {r['name_last']}")
                    out.append(forms)
    return out

def nfl_qbs():
    with open(os.path.join(CACHE, 'nfl_players.csv'), encoding='utf-8') as f:
        return [[r['display_name']] for r in csv.DictReader(f) if r['position'] == 'QB' and r['last_season'] and (r['years_of_experience'] or '0') != '0']

# ---------------------------------------------------------------- misc datasets
def marvel(min_app=15):
    out = []
    with open(os.path.join(CACHE, 'marvel.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            try:
                app = int(float(r['APPEARANCES'] or 0))
            except ValueError:
                app = 0
            if app < min_app:
                continue
            m = re.match(r'^(.*?)\s*\((.*)\)\s*$', r['name'])
            if m:
                a, b = m.group(1).strip(), m.group(2).replace('Earth-616', '').strip()
                out.append([a] + ([b] if b and b != a else []))
            else:
                out.append([r['name'].strip()])
    return out

def pokemon():
    return [[n] for n in J('npm/node_modules/pokemon/data/en.json')]

def airlines():
    out = []
    with open(os.path.join(CACHE, 'airlines.dat'), encoding='utf-8') as f:
        for row in csv.reader(f):
            if len(row) < 8 or row[0] in ('-1', '1'):
                continue
            name, iata = row[1], row[3]
            if iata and iata not in ('\\N', '-', '') and len(name) > 2 and not re.search(r'\d', name):
                out.append([name])
    return out

def programming_languages():
    import subprocess
    js = ("const L=require('./node_modules/linguist-languages');"
          "console.log(JSON.stringify(Object.values(L).filter(x=>x.type==='programming').map(x=>[x.name,...(x.aliases||[]).slice(0,2)])))")
    out = json.loads(subprocess.check_output(['node', '-e', js], cwd=os.path.join(CACHE, 'npm')))
    return out + C('technology/programming_languages')

def languages():
    out = [[l.name] for l in pycountry.languages
           if getattr(l, 'type', '') == 'L' and not re.search(r'[()]', l.name) and zipf_frequency(l.name, 'en') >= 1.0]
    out += WN('natural_language.n.01', min_depth=1, exclude={'aave'})
    return out

def currencies():
    out = []
    for c in pycountry.currencies:
        name = re.sub(r'^(US|UK) ', '', c.name)
        last = name.split(' ')[-1]
        out.append([name, last] if len(name.split()) > 1 else [name])
    out += WN('monetary_unit.n.01', min_depth=2, keep=lambda l: 'monetary unit' not in l.lower())
    return out

def q_words():
    from wordfreq import top_n_list
    return [[w] for w in top_n_list('en', 300000)
            if re.fullmatch(r'q[a-z]{2,}', w) and (wn.synsets(w) or wn.morphy(w)) and zipf_frequency(w, 'en') >= 1.0]

def soccer_players():
    """FIFA 22 ratings: the rating sets the tier (stars are already on the hand sheet)."""
    out = []
    with open(os.path.join(CACHE, 'dl_players_22.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            ovr = int(r['overall'] or 0)
            tier = 'rare' if ovr >= 80 else 'deep' if ovr >= 72 else 'one'
            forms = [r['long_name']]
            if r['short_name'] and '.' not in r['short_name']:
                forms.append(r['short_name'])
            out.append({'forms': forms, 'tier': tier})
    return out

def simpsons():
    common = set(json.load(open(os.path.join(HERE, '..', 'common-words.json'))))
    out = []
    with open(os.path.join(CACHE, 'dl_simpsons_characters.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            n = r['name'].strip()
            words = re.findall(r"[A-Za-z']+", n)
            if not words or re.search(r'[#\d]', n) or len(n) < 3:
                continue
            if all(w.lower() in common for w in words):   # "Children", "Mechanical Santa"
                continue
            out.append([n])
    return out

def harry_potter():
    with open(os.path.join(CACHE, 'dl_Characters.csv'), encoding='latin-1') as f:
        return [[r['Character Name'].strip()] for r in csv.DictReader(f) if r['Character Name'].strip()]

# ---------------------------------------------------------------- prompt map
# key: prompt text (must match exactly); value: list of entry lists. Entries already on the
# hand sheet just gain aliases; everything else is added and auto-tiered.
ALIAS_ONLY = {
    'Name a country in Europe', 'Name a country in Africa', 'Name a country in Asia',
    'Name a country in South or Central America', 'Name a Caribbean island or island nation',
}
SOURCES = {
    # ---------- geography
    'Name a country in Europe': lambda: country_aliases(),
    'Name a country in Africa': lambda: country_aliases(),
    'Name a country in Asia': lambda: country_aliases(),
    'Name a country in South or Central America': lambda: country_aliases(),
    'Name a Caribbean island or island nation': lambda: country_aliases(),
    'Name a world capital city': lambda: capitals() + WN('national_capital.n.01', instances=True),
    'Name a river anywhere in the world': lambda: WN('river.n.01', instances=True) + C('geography/rivers'),
    'Name a lake': lambda: WN('lake.n.01', instances=True),
    'Name a mountain or peak': lambda: WN('mountain.n.01', 'mountain_peak.n.01', 'volcano.n.02', instances=True),
    'Name an island': lambda: WN('island.n.01', instances=True),
    'Name a desert': lambda: WN('desert.n.01', instances=True),
    'Name a European city that is not a capital': lambda: city_list(EUROPE, min_pop=40000, exclude_capitals=True),
    'Name a city in California': lambda: city_list({'US'}, admin='CA', min_pop=1500),
    'Name a city in Texas': lambda: city_list({'US'}, admin='TX', min_pop=1500),
    'Name a city in Florida': lambda: city_list({'US'}, admin='FL', min_pop=1500),
    # ---------- food & drink
    'Name a cheese': lambda: WN('cheese.n.01') + titlecase_list(C('foods/curds')),
    'Name a fruit': lambda: WN('edible_fruit.n.01', min_depth=1) + titlecase_list(C('foods/fruits')),
    'Name a vegetable': lambda: WN('vegetable.n.01', min_depth=1) + titlecase_list(C('foods/vegetables')),
    'Name a cocktail': lambda: WN('cocktail.n.01', 'mixed_drink.n.01') + C('foods/iba_cocktails'),
    'Name a type of bread': lambda: WN('bread.n.01', 'quick_bread.n.01') + titlecase_list(C('foods/breads_and_pastries', 'breads')),
    'Name a herb or spice': lambda: WN('herb.n.02', 'spice.n.02') + C('foods/herbs_n_spices', 'herbs') + C('foods/herbs_n_spices', 'spices') + C('foods/herbs_n_spices', 'mixtures'),
    'Name a variety of apple': lambda: C('foods/apple_cultivars', 'cultivars') + WN('eating_apple.n.01', 'cooking_apple.n.01'),
    'Name a pizza topping': lambda: titlecase_list(C('foods/pizzaToppings')),
    'Name a sandwich': lambda: WN('sandwich.n.01') + C('foods/sandwiches', field='name'),
    'Name a dessert': lambda: WN('dessert.n.01', 'frozen_dessert.n.01', 'pudding.n.03', 'pie.n.01', 'cake.n.03'),
    'Name a soup': lambda: WN('soup.n.01', min_depth=1),
    'Name a condiment or sauce': lambda: WN('condiment.n.01', 'sauce.n.01') + C('foods/condiments'),
    'Name a type of tea': lambda: WN('tea.n.01', 'herb_tea.n.01') + [f for f in C('foods/tea', 'teas') if len(f[0].split()) <= 3],
    'Name a pasta shape': lambda: WN('pasta.n.02'),
    'Name a beer brand': lambda: C('foods/bad_beers'),
    'Name a liquor or spirits brand': lambda: C('foods/scotch_whiskey'),
    # ---------- nature & science
    'Name a mammal': lambda: WN('mammal.n.01', min_depth=2),
    'Name a type of bird': lambda: WN('bird.n.01', min_depth=1) + C('animals/birds_north_america'),
    'Name a type of snake': lambda: WN('snake.n.01'),
    'Name an insect or bug': lambda: WN('insect.n.01', 'arachnid.n.01', min_depth=1),
    'Name a type of tree': lambda: WN('tree.n.01', min_depth=1),
    'Name a flower': lambda: WN('flower.n.01', min_depth=1) + titlecase_list(C('plants/flowers')),
    'Name a dinosaur': lambda: WN('dinosaur.n.01') + C('animals/dinosaurs'),
    'Name a sea creature': lambda: WN('cetacean.n.01', 'crustacean.n.01', 'mollusk.n.01', 'shark.n.01', 'saltwater_fish.n.01', 'echinoderm.n.01', 'coelenterate.n.01', 'pinniped_mammal.n.01', 'sea_turtle.n.01') + titlecase_list(C('foods/shellfish')) + titlecase_list(C('foods/fish')),
    'Name a gemstone': lambda: WN('gem.n.02') + titlecase_list(C('materials/gemstones')),
    'Name a bone in the human body': lambda: WN('bone.n.01', min_depth=1),
    'Name a dog breed': lambda: WN('dog.n.01', min_depth=2) + C('animals/dogs'),
    'Name a cat breed': lambda: C('animals/cats'),
    'Name a part of the human body': lambda: WN('external_body_part.n.01', 'organ.n.01', 'bone.n.01') + titlecase_list(C('humans/bodyParts')),
    'Name a musical instrument': lambda: WN('musical_instrument.n.01', min_depth=1) + titlecase_list(C('music/instruments')),
    'Name a famous scientist': lambda: people('scientist.n.01') + C('humans/scientists'),
    'Name a famous painter': lambda: people('painter.n.01', 'old_master.n.01'),
    'Name a philosopher': lambda: people('philosopher.n.01'),
    'Name a famous economist': lambda: people('economist.n.01'),
    'Name a famous author': lambda: people('writer.n.01', 'novelist.n.01', 'poet.n.01', 'dramatist.n.01'),
    'Name a Roman emperor': lambda: people('roman_emperor.n.01'),
    'Name a famous battle': lambda: WN('battle.n.01', instances=True),
    'Name a Greek or Roman god or goddess': lambda: WN('greek_deity.n.01', 'roman_deity.n.01') + C('mythology/greek_gods') + C('mythology/roman_deities') + C('mythology/greek_titans'),
    'Name a creature from Greek mythology': lambda: C('mythology/greek_monsters') + C('mythology/greek_titans'),
    # ---------- grab bag
    'Name an article of clothing': lambda: WN('clothing.n.01', min_depth=1) + titlecase_list(C('objects/clothing')),
    'Name a kitchen utensil or tool': lambda: WN('kitchen_utensil.n.01', 'cooking_utensil.n.01'),
    'Name something you might find in a toolbox': lambda: WN('hand_tool.n.01', min_depth=1),
    'Name a color': lambda: titlecase_list(C('colors/xkcd')) + C('colors/crayola') + C('colors/wikipedia') + WN('chromatic_color.n.01', min_depth=1),
    'Name a language': lambda: languages(),
    'Name a currency': lambda: currencies(),
    'Name a programming language': lambda: programming_languages(),
    'Name a card game': lambda: WN('card_game.n.01', min_depth=1),
    'Name a board game': lambda: WN('board_game.n.01') + C('games/board_games'),
    'Name a word that starts with Q': lambda: q_words(),
    'Name an airline': lambda: airlines(),
    'Name a car brand': lambda: C('corporations/cars'),
    'Name a social media app or website': lambda: C('technology/social_networking_websites'),
    'Name a rock band': lambda: C('music/rock_hall_of_fame'),
    # ---------- sports & pop culture
    'Name an NBA player, any era': lambda: nba_players(),
    'Name an MLB player, any era': lambda: mlb_players(),
    'Name an NFL quarterback, any era': lambda: nfl_qbs(),
    'Name a professional golfer': lambda: people('golfer.n.01'),
    'Name a tennis grand slam singles champion, past or present': lambda: [],
    'Name a famous boxer': lambda: people('prizefighter.n.01', 'boxer.n.01'),
    'Name a Marvel character': lambda: marvel(),
    'Name a Pokemon': lambda: pokemon(),
    'Name a soccer player, any era': lambda: soccer_players(),
    'Name a Simpsons character': lambda: simpsons(),
    'Name a Harry Potter character': lambda: harry_potter(),
}

# ---------------------------------------------------------------- tiering
# Krillion scores rarity mostly from how often a name appears in real text. Same idea here,
# with one adjustment: everything the expansion adds was missing from a hand list that already
# covers the obvious answers, so added answers start at Rare (60) and go down from there.
TIERS = ['plankton', 'clever', 'schooler', 'rare', 'deep', 'one']
AUTO = ['rare', 'deep', 'one']

def popularity(forms, names=False):
    """Zipf frequency of the display name. Word-frequency data only knows single words, and a
    phrase made of common words ("Jim Wilson", "Sick green") would look common, so multi-word
    names are scored by their rarest word and docked a little more for people."""
    f = forms[0]
    words = re.findall(r"[A-Za-z\u00C0-\u024F']+", f)
    if len(words) <= 1:
        return zipf_frequency(f, 'en')
    z = min(zipf_frequency(f, 'en'), min(zipf_frequency(w, 'en') for w in words)) - 0.5
    return z - (1.0 if names else 0)

def calibrate(entries, names):
    by = defaultdict(list)
    for e in entries:
        by[e['tier']].append(popularity(e['forms'], names))
    med = {}
    for t in AUTO:
        v = sorted(by.get(t, []))
        if len(v) >= 3:
            med[t] = v[len(v) // 2]
    defaults = {'rare': 3.0, 'deep': 2.2, 'one': 1.2}
    for t in AUTO:
        med.setdefault(t, defaults[t])
    for a, b in zip(AUTO, AUTO[1:]):
        if med[b] >= med[a] - 0.3:
            med[b] = med[a] - 0.5
    return [(med[a] + med[b]) / 2 for a, b in zip(AUTO, AUTO[1:])]

def tier_for(z, cuts):
    for t, c in zip(AUTO, cuts):
        if z >= c:
            return t
    return 'one'

def tidy_forms(forms):
    out = []
    for f in forms:
        f = clean(f).replace('/', ' ').replace(';', ',')
        if not f or len(f) < 2 or len(f) > 60 or re.search(r'[()\[\]{}<>|=_@]', f):
            continue
        out.append(f)
    out = list(dict.fromkeys(out))
    if len(out) > 1:
        # drop aliases that are far more common than the name itself: WordNet lists "ice" for
        # frappe and "gown" for nightgown, which would make plain words count as answers
        base = zipf_frequency(out[0], 'en')
        out = [out[0]] + [a for a in out[1:] if len(a.split()) > 1 or zipf_frequency(a, 'en') <= base + 1.0]
    return out

def main():
    hand = J(os.path.join('..', 'out', 'hand.json'))
    by_prompt = {h['prompt']: h for h in hand}
    out = {}
    total = 0
    for prompt, fn in SOURCES.items():
        if prompt not in by_prompt:
            sys.exit(f'Unknown prompt in SOURCES: {prompt!r}')
        raw = fn()
        names = by_prompt[prompt]['names']
        cuts = calibrate(by_prompt[prompt]['entries'], names)
        items = []
        for item in raw:
            fixed = item.get('tier') if isinstance(item, dict) else None
            forms = tidy_forms(item['forms'] if isinstance(item, dict) else item)
            if not forms:
                continue
            z = popularity(forms, names)
            items.append({'forms': forms, 'zipf': round(z, 2), 'tier': fixed or tier_for(z, cuts)})
        out[prompt] = {'aliasOnly': prompt in ALIAS_ONLY, 'cuts': [round(c, 2) for c in cuts], 'items': items}
        total += len(items)
        print(f'{len(items):6d}  {prompt}', file=sys.stderr)
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    with open(os.path.join(HERE, 'out/sources.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'sources.json: {total} candidate answers across {len(out)} prompts', file=sys.stderr)

if __name__ == '__main__':
    main()
