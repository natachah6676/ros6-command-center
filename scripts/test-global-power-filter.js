/**
 * Vérifie le filtre unique « Puissance globale » (Gestion des membres).
 * node scripts/test-global-power-filter.js
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
    console.log('  OK', msg);
  } else {
    failed += 1;
    console.error('  KO', msg);
  }
}

console.log('\n=== UI filtre unique ===');
assert(!html.includes('filterGlobalPowerAdmin'), 'pas de menu séparé');
assert((html.match(/id="filterPowerAdmin"/g) || []).length === 1, 'un seul filterPowerAdmin');
assert(html.includes('aria-label="Puissance globale"'), 'aria-label Puissance globale');
assert(html.includes('>Non renseignée</option>'), 'option Non renseignée');
assert(!html.includes('Filtrer par puissance héros'), 'plus de label héros sur le filtre');
assert(playersJs.includes('fillGlobalPowerFilterOptions'), 'remplit les tranches');
assert(playersJs.includes("powerFilter === 'missing'"), 'filtre missing');
assert(!playersJs.includes('filterGlobalPowerAdmin'), 'JS sans menu séparé');

const sandbox = { window: {}, console };
sandbox.global = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
const M = sandbox.window.ROSModels;

const list = [
  { id: '1', pseudo: 'A', globalPowerTierId: null },
  { id: '2', pseudo: 'B', globalPowerTierId: 'gp_lt_45' },
  { id: '3', pseudo: 'C', globalPowerTierId: 'gp_ge_200' },
];

function filterBy(value) {
  return list
    .filter((p) => {
      if (value === 'missing') return !M.normalizeGlobalPowerTierId(p.globalPowerTierId);
      if (value) return M.normalizeGlobalPowerTierId(p.globalPowerTierId) === value;
      return true;
    })
    .map((p) => p.pseudo);
}

console.log('\n=== Logique filtre ===');
assert(filterBy('').join(',') === 'A,B,C', 'Toutes les puissances');
assert(filterBy('missing').join(',') === 'A', 'Non renseignée');
assert(filterBy('gp_lt_45').join(',') === 'B', 'tranche existante');
assert(M.getGlobalPowerTiers().length > 10, 'tranches conservées');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
