/**
 * Coaching UI retirée — remplacée par Gestion des membres (seuils suivi).
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
    console.log('  OK', msg);
  } else {
    failed += 1;
    console.error('  KO', msg);
  }
}

const sandbox = { window: {}, console, Date, Math, JSON, String, Number, Boolean, Array, Object };
sandbox.window = sandbox;
vm.runInNewContext(modelsCode, sandbox);
const ROSModels = sandbox.ROSModels;

console.log('\n=== UI retirée ===');
assert(!html.includes('commandCoaching'), 'Bloc coaching Poste de commandement retiré');
assert(!html.includes('id="playersCoachingCounter"'), 'Compteur coaching liste retiré');
assert(!html.includes('id="coachingThresholdMin"'), 'Paramètre seuil min retiré');
assert(!html.includes('id="coachingThresholdMax"'), 'Paramètre seuil max retiré');
assert(!html.includes('Seuil coaching'), 'Libellé Seuil coaching retiré');
assert(!html.includes('Exception coaching'), 'Exception coaching fiche retirée');
assert(!html.includes('id="playerCoachingAlways"'), 'Option Toujours inclure retirée');
assert(!html.includes('id="playerCoachingNever"'), 'Option Ne jamais inclure retirée');
assert(html.includes('Seuils — Gestion des membres'), 'Seuils suivi présents');
assert(!playersCode.includes('data-action="coaching-contact"'), 'Case Contacté coaching retirée');
assert(!appCode.includes('saveCoachingThreshold'), 'Sauvegarde seuil coaching retirée');
assert(!commandCode.includes('renderCoaching'), 'renderCoaching retiré de command.js');

console.log('\n=== Seuil héros suivi ===');
const state = ROSModels.createBlankState();
state.followUpSettings = { vsMinUnderDays: 2, heroMaxM: 30 };
const tier25 = state.powerTiers.find((t) => t.min === 25 && t.max === 30);
const tier30 = state.powerTiers.find((t) => t.min === 30 && t.max === 35);
const pIn = ROSModels.createPlayer({
  pseudo: 'InRange',
  heroPowerTierId: tier25.id,
});
const pHigh = ROSModels.createPlayer({
  pseudo: 'Higher',
  heroPowerTierId: tier30.id,
});
const pParti = ROSModels.createPlayer({
  pseudo: 'Gone',
  status: 'Parti',
  heroPowerTierId: tier25.id,
});
state.players = [pIn, pHigh, pParti];

assert(ROSModels.isPlayerInCoachingList(pIn, state) === true, '≤ 30 M inclus (seuil suivi)');
assert(ROSModels.isPlayerInCoachingList(pHigh, state) === false, '> 30 M exclu');
assert(ROSModels.isPlayerInCoachingList(pParti, state) === false, 'Parti exclu');

state.followUpSettings = { vsMinUnderDays: 2, heroMaxM: 35 };
assert(ROSModels.isPlayerInCoachingList(pHigh, state) === true, 'seuil héros élargi à 35 M');

console.log('\n=== Compat données legacy ===');
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
assert(legacy.followUpSettings.heroMaxM === 30, 'seuil suivi héros défaut');
assert(legacy.players[0].coachingException === 'always', 'exception legacy conservée en data');
const contact = legacy.ui.coachingContacts.player_old;
assert(contact.contacted === true && contact.contactedBy === 'Willow', 'contacts legacy conservés');
assert(contact.priority === undefined, 'champ priority retiré à la normalisation');

const stamped = ROSModels.formatCoachingDateTime('2026-08-06T12:25:00.000Z');
assert(/06\/08\/2026/.test(stamped) && stamped.includes('-'), 'Format date/heure FR');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
