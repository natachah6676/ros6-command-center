/**
 * Tests puissance globale + droits R5/R4 (édition).
 * (Module Recrutement retiré — groupes/score recrutement non testés ici.)
 * node scripts/test-global-power-recrutement.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

console.log('\n=== UI ===');
assert(html.includes('playerGlobalPower'), 'select puissance globale');
assert(!html.includes('data-tab="recrutement"'), 'onglet Recrutement retiré');
assert(!html.includes('id="panel-recrutement"'), 'panneau Recrutement retiré');
assert(!html.includes('recrutementSort'), 'tri recrutement retiré');

const sandbox = {
  window: {},
  console,
  ROSStorage: {
    getState() {
      return sandbox.__state;
    },
  },
  ROSProfiles: {
    role: 'R5',
    status: 'Actif',
    isAccessAllowed() {
      return sandbox.ROSProfiles.status === 'Actif';
    },
    isActiveR5() {
      return sandbox.ROSProfiles.isAccessAllowed() && sandbox.ROSProfiles.role === 'R5';
    },
    isActiveR4OrR5() {
      const role = sandbox.ROSProfiles.role;
      return (
        sandbox.ROSProfiles.isAccessAllowed() && (role === 'R5' || role === 'R4')
      );
    },
    getAppRole() {
      return sandbox.ROSProfiles.role;
    },
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
const ROSModels = sandbox.window.ROSModels;

console.log('\n=== Tranches puissance globale ===');
const tiers = ROSModels.getGlobalPowerTiers();
assert(tiers[0].id === 'gp_lt_45', 'premiere tranche <45');
assert(tiers[tiers.length - 1].id === 'gp_ge_200', 'derniere tranche 200+');
assert(tiers.some((t) => t.label === '45 à 49,9 M'), 'tranche 45-49,9');
assert(tiers.some((t) => t.label === '195 à 199,9 M'), 'tranche 195-199,9');
assert(ROSModels.normalizeGlobalPowerTierId('gp_50_55') === 'gp_50_55', 'normalize ok');
assert(ROSModels.normalizeGlobalPowerTierId('nope') === null, 'normalize invalide');

console.log('\n=== Droits R5 / R4 / autres ===');
sandbox.ROSProfiles.status = 'Actif';
sandbox.ROSProfiles.role = 'R5';
assert(ROSModels.canEditGlobalPower() === true, 'R5 peut modifier');
sandbox.ROSProfiles.role = 'R4';
assert(ROSModels.canEditGlobalPower() === true, 'R4 peut modifier');
sandbox.ROSProfiles.role = 'Membre';
assert(ROSModels.canEditGlobalPower() === false, 'Membre ne peut pas modifier');
sandbox.ROSProfiles.role = 'R4';
sandbox.ROSProfiles.status = 'Inactif';
assert(ROSModels.canEditGlobalPower() === false, 'R4 inactif ne peut pas modifier');
sandbox.ROSProfiles.status = 'Actif';
sandbox.ROSProfiles.role = 'R5';

const powerTiers = ROSModels.createDefaultPowerTiers();
const player = ROSModels.createPlayer({
  pseudo: 'P01',
  role: 'Membre',
  globalPowerTierId: 'gp_60_65',
  heroPowerTierId: 'tier_50_55',
});

sandbox.__state = {
  ...ROSModels.createBlankState(),
  powerTiers,
  players: [player],
};

console.log('\n=== Persist normalize ===');
const normalized = ROSModels.normalizeState({
  ...sandbox.__state,
  players: [
    {
      ...player,
      globalPowerTierId: 'gp_60_65',
    },
  ],
});
assert(normalized.players[0].globalPowerTierId === 'gp_60_65', 'normalize conserve globalPower');

console.log('\n=== Resultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
