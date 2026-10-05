// Answer-acceptance battery. Run: node test/matching.js
const path = require('path');
const fs = require('fs');
const T = require('../server/core.js');
require('../server/wordlist.js');
const QDIR = path.join(__dirname, '../server/questions');
for (const f of fs.readdirSync(QDIR).filter(f => f.endsWith('.js')).sort()) require(path.join(QDIR, f));
const BANK = globalThis.TRENCH_BANK;
const P = p => {
  const x = BANK.find(b => b.prompt.toLowerCase().startsWith(p.toLowerCase()));
  if (!x) throw new Error('no prompt ' + p);
  return x;
};
let fails = 0, n = 0;
function accept(prompt, input, canon) {
  n++;
  const g = T.grade(P(prompt), input);
  if (!g || (canon && g.canon !== canon)) { fails++; console.log(`FAIL accept  [${prompt}] "${input}" -> ${g ? g.canon : 'null'} (want ${canon || 'any'})`); }
}
function reject(prompt, input) {
  n++;
  const g = T.grade(P(prompt), input);
  if (g) { fails++; console.log(`FAIL reject  [${prompt}] "${input}" -> ${g.canon}`); }
}

// typos and swaps
accept('Name a country in Europe', 'Liechtenstien', 'Liechtenstein');
accept('Name a country in Europe', 'Swtizerland', 'Switzerland');
accept('Name a country in Europe', 'luxemburg', 'Luxembourg');
accept('Name a country in Europe', 'Montenegroo', 'Montenegro');
accept('Name a country in Europe', 'the netherlands', 'Netherlands');
accept('Name a country in Europe', 'czech', 'Czech Republic');
accept('Name a country in Europe', 'bosnia herzegovina', 'Bosnia and Herzegovina');
reject('Name a country in Europe', 'Narnia');
reject('Name a country in Europe', 'Brazil');
// filler / category words
accept('Name a mountain', 'Mount Kilimanjaro', 'Kilimanjaro');
accept('Name a mountain', 'Mt. Everest', 'Everest');
accept('Name a mountain', 'mt st helens', 'St. Helens');
accept('Name a lake', 'Lake Baikal', 'Baikal');
accept('Name a lake', 'baikal', 'Baikal');
accept('Name a river', 'the Nile River', 'Nile');
accept('Name a river', 'river thames', 'Thames');
accept('Name a US national park', 'Glacier National Park', 'Glacier');
accept('Name a US national park', 'Teton', 'Grand Teton');
accept('Name a type of snake', 'corn snake', 'Corn snake');
accept('Name a type of snake', 'cornsnake', 'Corn snake');
accept('Name a chess opening', 'sicilian', 'Sicilian Defense');
accept('Name a chess opening', 'the najdorf', 'Najdorf');
accept('Name a pasta shape', 'bow ties', 'Farfalle');
accept('Name a pasta shape', 'angelhair', 'Angel hair');
// plurals
accept('Name a fruit', 'strawberries', 'Strawberry');
accept('Name a fruit', 'cherries', 'Cherry');
accept('Name a fruit', 'mangoes', 'Mango');
accept('Name a fruit', 'peaches', 'Peach');
accept('Name a pizza topping', 'mushroom', 'Mushrooms');
accept('Name a pizza topping', 'anchovy', 'Anchovies');
// spacing and punctuation
accept('Name a Marvel character', 'spiderman', 'Spider-Man');
accept('Name a Marvel character', 'spider man', 'Spider-Man');
accept('Name a Marvel character', 'Dr Strange', 'Doctor Strange');
accept('Name a programming language', 'c++', 'C++');
accept('Name a programming language', 'c#', 'C#');
accept('Name a programming language', 'golang', 'Go');
accept('Name a Beatles song', 'sgt peppers', 'Sgt. Pepper\'s Lonely Hearts Club Band');
accept('Name a Beatles song', 'strawberry fields', 'Strawberry Fields Forever');
accept('Name a Beatles song', 'ob la di ob la da');
// numbers
accept('Name a candy bar', 'three musketeers', '3 Musketeers');
accept('Name a Pixar movie', 'toy story three', 'Toy Story 3');
// people
accept('Name a US president', 'Lincoln', 'Abraham Lincoln');
accept('Name a US president', 'JFK', 'John F. Kennedy');
accept('Name a US president', 'john kennedy', 'John F. Kennedy');
accept('Name a US president', 'eisenhauer', 'Dwight Eisenhower');
accept('Name a US president', 'Millard Filmore', 'Millard Fillmore');
accept('Name a professional golfer', 'scottie sheffler', 'Scottie Scheffler');
accept('Name a professional golfer', 'mcilroy', 'Rory McIlroy');
accept('Name a famous scientist', 'Tesla', 'Nikola Tesla');
accept('Name a famous scientist', 'Schroedinger', 'Erwin Schrodinger');
accept('Name a tennis', 'djokovich', 'Novak Djokovic');
// teams
accept('Name an NFL team', 'new england patriots', 'Patriots/New England Patriots'.split('/')[0]);
accept('Name an NFL team', 'pats');
accept('Name an NBA team', 'the knicks', 'Knicks/New York Knicks'.split('/')[0]);
reject('Name an MLB team', 'sox');
// should NOT match
reject('Name a US state that', 'Florida');
reject('Name a US state that', 'Virginia');
reject('Name a fruit', 'chair');
reject('Name a chemical element', 'Kryptonite');

// --- Krillion-style leniency (v3 matcher) ---
accept('Name a US vice president', 'Harris Kamala', 'Kamala Harris');        // word order
accept('Name a country in Africa', 'zomalia', 'Somalia');                    // sound-alike first letter
accept('Name a world capital city', 'cathmandu', 'Kathmandu');
accept('Name a US state', 'tenese', 'Tennessee');
accept('Name a bone in the human body', 'scafoid', 'Scaphoid');
accept('Name a herb or spice', 'chyves', 'Chives');
accept('Name a rock band', 'piksies', 'Pixies');
accept('Name a Pixar movie', 'TheGoodDinosaur', 'The Good Dinosaur');       // no spaces, with "The"
accept('Name a lake', 'LakeNaivasha', 'Lake Naivasha');
accept('Name a professional golfer', 'tiger woods golfer', 'Tiger Woods'); // extra word from the prompt
accept('Name an NBA player, any era', 'Kobe', 'Kobe Bryant');                 // distinctive first name
accept('Name a country in Asia', 'Bangladsh', 'Bangladesh');
// --- deeper banks (generated from open datasets) ---
accept('Name a mammal', 'pangolin');
accept('Name a mammal', 'Tasmanian devil');
accept('Name a type of bird', 'Purple Martin');
accept('Name a cheese', 'Cashel Blue');
accept('Name a European city that is not a capital', 'Braunschweig');
accept('Name a city in Texas', 'Pflugerville');
accept('Name an MLB player, any era', 'Joaquin Benoit');
accept('Name an NBA player, any era', 'Bol Bol');
accept('Name a Pokemon', 'Wooper');
accept('Name a language', 'Muskogee');
accept('Name a famous author', 'Daniel Defoe');
accept('Name a word that starts with Q', 'quixotic');
// --- still rejected ---
reject('Name an MLB player, any era', 'monkey');                              // real word, not a typo of "Money"
reject('Name a country in Asia', 'Eddie Jordan');                             // extra words that aren't about the prompt
reject('Name a language', 'Thigh');
reject('Name a type of tea', 'Shua');
reject('Name a mammal', 'chair');

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
