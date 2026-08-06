/**
 * Tests simplification coaching (seuil unique, exception, contacts)
 * node scripts/test-coaching-simplify.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const playersCode = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');
const commandCode = fs.readFileSync(path.join(root, 'js/command.js'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(modelsCode.replace('(window)', '(window)'), sandbox);
const ROSModels = sandbox.window.ROSModels;

console.log('\n=== UI / structure ===');
assert(!html.includes('commandCoaching'), 'Bloc coaching Poste de commandement retiré');
assert(!html.includes('Priorité 1'), 'Priorité 1 absente du HTML');
assert(!html.includes('Priorité 2'), 'Priorité 2 absente du HTML');
assert(html.includes('id="playersCoachingCounter"'), 'Compteur coaching Gestion des membres');
assert(html.includes('id="coachingThresholdMin"'), 'Paramètre seuil min');
assert(html.includes('id="coachingThresholdMax"'), 'Paramètre seuil max');
assert(html.includes('Seuil coaching'), 'Libellé Seuil coaching');
assert(html.includes('Exception coaching'), 'Exception coaching fiche joueur');
assert(html.includes('id="playerCoachingAlways"'), 'Option Toujours inclure');
assert(html.includes('id="playerCoachingNever"'), 'Option Ne jamais inclure');
assert(playersCode.includes('data-action="coaching-contact"'), 'Case Contacté dans la liste');
assert(playersCode.includes('Contacté par'), 'Libellé Contacté par');
assert(appCode.includes('saveCoachingThreshold'), 'Sauvegarde seuil dans app.js');
assert(!commandCode.includes('renderCoaching'), 'renderCoaching retiré de command.js');
assert(!commandCode.includes('Priorité 2'), 'Priorité 2 absente de command.js');
assert(!/priority\s*[:=]\s*2/.test(playersCode + commandCode + modelsCode), 'Aucune règle Priorité 2');

console.log('\n=== Seuil & label ===');
const th = ROSModels.normalizeCoachingThreshold({ min: 30, max: 25 });
assert(th.min === 25 && th.max === 30, 'Seuil min/max normalisé (inversion)');
assert(
  ROSModels.formatCoachingThresholdLabel({ min: 25, max: 30 }) === '25 M à 30 M',
  'Label 25 M à 30 M'
);
assert(ROSModels.normalizeCoachingException(undefined) === 'always', 'Exception défaut = always');
assert(ROSModels.normalizeCoachingException('never') === 'never', 'Exception never');

console.log('\n=== Liste coaching (seuil + exception) ===');
const state = ROSModels.createBlankState();
state.coachingThreshold = { min: 25, max: 30 };
const tier25 = state.powerTiers.find((t) => t.min === 25 && t.max === 30);
const tier30 = state.powerTiers.find((t) => t.min === 30 && t.max === 35);
const pIn = ROSModels.createPlayer({
  pseudo: 'InRange',
  heroPowerTierId: tier25.id,
  coachingException: 'always',
});
const pP2 = ROSModels.createPlayer({
  pseudo: 'OldPrio2',
  heroPowerTierId: tier30.id,
  coachingException: 'always',
});
const pNever = ROSModels.createPlayer({
  pseudo: 'Never',
  heroPowerTierId: tier25.id,
  coachingException: 'never',
});
const pParti = ROSModels.createPlayer({
  pseudo: 'Gone',
  status: 'Parti',
  heroPowerTierId: tier25.id,
});
state.players = [pIn, pP2, pNever, pParti];

assert(ROSModels.isPlayerInCoachingList(pIn, state) === true, '25–30 M inclus');
assert(ROSModels.isPlayerInCoachingList(pP2, state) === false, '30–35 M exclu (plus de Priorité 2)');
assert(ROSModels.isPlayerInCoachingList(pNever, state) === false, 'Ne jamais inclure exclu');
assert(ROSModels.isPlayerInCoachingList(pParti, state) === false, 'Parti exclu');

state.coachingThreshold = { min: 25, max: 35 };
assert(ROSModels.isPlayerInCoachingList(pP2, state) === true, 'Seuil élargi inclut 30–35 M');
assert(ROSModels.isPlayerInCoachingList(pNever, state) === false, 'Never reste exclu même hors règle seuil');

console.log('\n=== Migration données ===');
const legacy = ROSModels.normalizeState({
  version: 1,
  appRole: 'R5',
  players: [
    {
      id: 'player_old',
      pseudo: 'Legacy',
      role: 'Membre',
      status: 'Actif',
      heroPowerTierId: tier25.id,
    },
  ],
  weeks: [ROSModels.createWeek(1)],
  currentWeekId: null,
  ui: {
    coachingContacts: {
      player_old: {
        contacted: true,
        contactedBy: 'Willow',
        contactedAt: '2026-08-06T12:25:00.000Z',
        priority: 2,
        actorLabel: 'Willow',
      },
    },
  },
});
assert(legacy.coachingThreshold.min === 25 && legacy.coachingThreshold.max === 30, 'Seuil défaut migré');
assert(legacy.players[0].coachingException === 'always', 'Exception défaut migrée');
const contact = legacy.ui.coachingContacts.player_old;
assert(contact.contacted === true && contact.contactedBy === 'Willow', 'Contact legacy conservé');
assert(contact.priority === undefined, 'Champ priority retiré à la normalisation');

const stamped = ROSModels.formatCoachingDateTime('2026-08-06T12:25:00.000Z');
assert(/06\/08\/2026/.test(stamped) && stamped.includes('-'), 'Format date/heure FR');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
