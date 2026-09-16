/**
 * Filtre puissance héros (Liste des membres).
 * node scripts/test-hero-power-filter.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const playersJs = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  ✓', msg);
  } else {
    failed += 1;
    console.error('  ✗', msg);
  }
}

console.log('\n=== UI filtre ===');
assert((html.match(/id="filterPowerAdmin"/g) || []).length === 1, 'un seul filterPowerAdmin');
assert(html.includes('aria-label="Puissance héros"'), 'aria-label Puissance héros');
assert(!html.includes('id="playerGlobalPower"'), 'champ Puissance globale retiré du modal');
assert(playersJs.includes('fillHeroPowerFilterOptions'), 'remplit les tranches héros');
assert(playersJs.includes('formatVsUnderCounterLabel'), 'compteur VS via formatVsUnderCounterLabel');
assert(playersJs.includes('Inscrit Tempete'), 'compteur Inscrit Tempete sur ligne');
assert(!playersJs.includes('Puissance globale'), 'plus de libellé Puissance globale');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
const M = sandbox.window.ROSModels;

const players = [
  { id: '1', pseudo: 'A', heroPowerTierId: null },
  { id: '2', pseudo: 'B', heroPowerTierId: 'tier_35_40' },
  { id: '3', pseudo: 'C', heroPowerTierId: 'tier_50_55' },
];

function filterBy(value) {
  return players.filter((p) => {
    if (value === 'missing') return !p.heroPowerTierId;
    if (value) return p.heroPowerTierId === value;
    return true;
  });
}

assert(filterBy('').length === 3, 'toutes');
assert(filterBy('missing').map((p) => p.id).join() === '1', 'non renseignée');
assert(filterBy('tier_35_40').map((p) => p.id).join() === '2', 'tranche précise');
assert(M.formatVsUnderCounterLabel({ entries: [{ under: true }, { under: false }] }) === 'VS Sous Seuil : 1', 'libellé compteur VS');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
