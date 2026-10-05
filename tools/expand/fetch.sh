#!/usr/bin/env bash
# Downloads the open datasets the answer-bank expansion is built from (about 90 MB).
# Run from the repo root: bash tools/expand/fetch.sh
set -e
C=tools/expand/.cache
mkdir -p $C/chadwick $C/npm $C/nltk_data/corpora
[ -d $C/corpora ] || git clone -q --depth 1 https://github.com/dariusk/corpora.git $C/corpora           # CC0 lists
for c in 0 1 2 3 4 5 6 7 8 9 a b c d e f; do                                                            # every MLB player (ODC-By)
  curl -sfL -o $C/chadwick/people-$c.csv https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-$c.csv
done
curl -sfL -o $C/nfl_players.csv https://github.com/nflverse/nflverse-data/releases/download/players/players.csv
curl -sfL -o $C/marvel.csv https://raw.githubusercontent.com/fivethirtyeight/data/master/comic-characters/marvel-wikia-data.csv
curl -sfL -o $C/airlines.dat https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat
curl -sfL -o $C/dl_players_22.csv https://raw.githubusercontent.com/abineshta/FIFA-22-complete-player-dataset-EDA/main/players_22.csv
curl -sfL -o $C/dl_simpsons_characters.csv https://raw.githubusercontent.com/datascienceprogram/ids_course_data/master/simpsons_characters.csv
curl -sfL -o $C/dl_Characters.csv https://raw.githubusercontent.com/SumanM1234/Harry_Potter_DA/main/Characters.csv
curl -sfL -o $C/nltk_data/corpora/wordnet.zip https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip
(cd $C/nltk_data/corpora && unzip -qo wordnet.zip)
(cd $C/npm && [ -f package.json ] || npm init -y >/dev/null; npm i --no-audit --no-fund pokemon all-the-cities linguist-languages >/dev/null)
(cd $C/npm && node -e "const c=require('all-the-cities');require('fs').writeFileSync('../cities.json',JSON.stringify(c.map(x=>[x.name,x.altName,x.country,x.adminCode,x.population,x.featureCode])))")
pip install --break-system-packages -q wordfreq pycountry nba_api nltk
echo "datasets ready in $C"
