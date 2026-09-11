/**
 * Score puissance 70/30 + helpers (sans module Recrutement).
 * node scripts/test-power-score-70-30.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
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

const sandbox = {
  window: {},
  console,
  ROSStorage: {
    getState() {
      return sandbox.__state;
    },
  },
};
sandbox.global = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
const M = sandbox.window.ROSModels;

console.log('\n=== Valeurs représentatives ===');
assert(
  M.getHeroPowerRepresentativeValue({ heroPowerTierId: 'tier_35_40' }, [
    { id: 'tier_35_40', min: 35, max: 40, label: '35 à 40 M', order: 1 },
  ]) === 37.5,
  'héros 35-40 → 37.5'
);
assert(M.getGlobalPowerRepresentativeValue({ globalPowerTierId: 'gp_45_50' }) === 47.45, 'globale 45-49.9');
assert(M.getGlobalPowerRepresentativeValue({ globalPowerTierId: 'gp_lt_45' }) === 42.5, 'globale <45');
assert(M.getGlobalPowerRepresentativeValue({ globalPowerTierId: 'gp_ge_200' }) === 202.5, 'globale 200+');
assert(
  M.hasCompletePowerData({ heroPowerTierId: null, globalPowerTierId: 'gp_lt_45' }, []) === false,
  'incomplet héros'
);

const state = M.createBlankState();
state.powerTiers = M.createDefaultPowerTiers();
const tierHeroHigh = state.powerTiers.find((t) => t.min === 75);
const tierHeroLow = state.powerTiers.find((t) => t.min === 25);
const players = [
  M.createPlayer({
    pseudo: 'HeroStrong',
    role: 'Membre',
    heroPowerTierId: tierHeroHigh.id,
    globalPowerTierId: 'gp_50_55',
  }),
  M.createPlayer({
    pseudo: 'GlobalStrong',
    role: 'Membre',
    heroPowerTierId: tierHeroLow.id,
    globalPowerTierId: 'gp_ge_200',
  }),
  M.createPlayer({
    pseudo: 'Incomplete',
    role: 'Membre',
    heroPowerTierId: tierHeroHigh.id,
    globalPowerTierId: null,
  }),
  M.createPlayer({
    pseudo: 'R4Skip',
    role: 'R4',
    heroPowerTierId: tierHeroHigh.id,
    globalPowerTierId: 'gp_ge_200',
  }),
];
state.players = players;

console.log('\n=== Score 70/30 ===');
const map = M.buildCompositePowerScoreMap(
  players.filter((p) => p.role === 'Membre'),
  state
);
const hs = map.get(players[0].id).score;
const gs = map.get(players[1].id).score;
assert(hs > gs, 'fort héros / global moyen > fort global / héros faible');
assert(!map.has(players[2].id), 'incomplet hors map');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
