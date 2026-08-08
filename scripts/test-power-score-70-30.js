/**
 * Score puissance 70/30 + recrutement + helpers.
 * node scripts/test-power-score-70-30.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const recrutementCode = fs.readFileSync(path.join(root, 'js/recrutement.js'), 'utf8');

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
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(recrutementCode, sandbox);
const M = sandbox.window.ROSModels;
const Rec = sandbox.window.RecrutementModule;

console.log('\n=== Valeurs représentatives ===');
assert(M.getHeroPowerRepresentativeValue({ heroPowerTierId: 'tier_35_40' }, [
  { id: 'tier_35_40', min: 35, max: 40, label: '35 à 40 M', order: 1 },
]) === 37.5, 'héros 35-40 → 37.5');
assert(M.getGlobalPowerRepresentativeValue({ globalPowerTierId: 'gp_45_50' }) === 47.45, 'globale 45-49.9');
assert(M.getGlobalPowerRepresentativeValue({ globalPowerTierId: 'gp_lt_45' }) === 42.5, 'globale <45');
assert(M.getGlobalPowerRepresentativeValue({ globalPowerTierId: 'gp_ge_200' }) === 202.5, 'globale 200+');
assert(M.hasCompletePowerData({ heroPowerTierId: null, globalPowerTierId: 'gp_lt_45' }, []) === false, 'incomplet héros');

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
const map = M.buildCompositePowerScoreMap(players.filter((p) => p.role === 'Membre'), state);
const hs = map.get(players[0].id).score;
const gs = map.get(players[1].id).score;
assert(hs > gs, 'fort héros / global moyen > fort global / héros faible');
assert(!map.has(players[2].id), 'incomplet hors map');

console.log('\n=== Recrutement groupes ===');
const pop = Rec.getPowerRankingPopulation(state);
assert(pop.length === 2, 'population 2 (hors incomplet/R4)');
const assigns = Rec.buildPowerGroupAssignments(state);
assert(assigns.has(players[0].id), 'HeroStrong classé');
assert(assigns.has(players[1].id), 'GlobalStrong classé');
assert(!assigns.has(players[2].id), 'Incomplete hors 30/40/30');

const incompleteRow = Rec.scorePlayer(players[2], state, assigns);
assert(incompleteRow.powerPoints === 0, 'incomplet powerPoints 0');
assert(incompleteRow.powerScore == null, 'incomplet sans score puissance');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
