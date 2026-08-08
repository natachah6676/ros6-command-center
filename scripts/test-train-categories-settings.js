/**
 * Vérifie le déplacement UI des catégories Train → Paramètres.
 * node scripts/test-train-categories-settings.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const train = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const profiles = fs.readFileSync(path.join(root, 'js/profiles.js'), 'utf8');
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

console.log('\n=== Emplacement UI ===');
const trainPanel = html.slice(html.indexOf('id="panel-train"'), html.indexOf('id="panel-recrutement"'));
const settingsPanel = html.slice(html.indexOf('id="panel-settings"'), html.indexOf('id="playerModal"'));

assert(!trainPanel.includes('id="trainCategoriesList"'), 'Catégories absentes du module Train');
assert(!trainPanel.includes('id="trainAddCategory"'), 'Bouton ajouter absent du Train');
assert(trainPanel.includes('Conducteurs'), 'Conducteurs restent dans Train');
assert(settingsPanel.includes('data-settings-tab="train"'), 'Sous-onglet Paramètres → Train');
assert(settingsPanel.includes('id="settingsPaneTrain"'), 'Panneau Train paramètres');
assert(settingsPanel.includes('id="trainCategoriesList"'), 'Liste catégories dans Paramètres');
assert(settingsPanel.includes('id="trainAddCategory"'), 'Bouton ajouter dans Paramètres');
assert(settingsPanel.includes('>Catégories<'), 'Titre Catégories dans Paramètres');

console.log('\n=== Wiring code ===');
assert(app.includes("role === 'R5' || role === 'R4'"), 'Paramètres accessibles R4/R5');
assert(profiles.includes('settingsPaneTrain'), 'switchSettingsTab gère Train');
assert(train.includes('onCategoriesClick'), 'Clics catégories hors panel-train');
assert(train.includes('canCorrectTrainArchive()'), 'Garde R4/R5 catégories');

console.log('\n=== Données catégories conservées / utilisées ===');
const store = { data: null };
const players = [
  { id: 'p1', pseudo: 'Alpha', role: 'Membre', status: 'Actif' },
  { id: 'p2', pseudo: 'Beta', role: 'Membre', status: 'Actif' },
];
const existingCats = [
  { id: 'cat_mvp', name: 'MVP', type: 'saison', firstId: 'p1', secondId: null, vipId: null, vipMode: null },
  { id: 'cat_champ', name: "Champion de l'Alliance", type: 'saison', firstId: 'p2', secondId: null, vipId: null, vipMode: null },
  { id: 'cat_ex', name: "MVP Exercice d'Alliance", type: 'saison', firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat_etoile', name: 'Étoile Brillante', type: 'saison', firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat_roi', name: 'Roi du Train-train', type: 'saison', firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat_diable', name: 'Entraîneur du Diable', type: 'saison', firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat_grand', name: 'Grand Destructeur', type: 'saison', firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat_bon', name: 'Bon Assistant', type: 'saison', firstId: null, secondId: null, vipId: null, vipMode: null },
];

store.data = JSON.stringify({
  version: 2,
  categories: existingCats,
  history: [{ id: 'h1', weekLabel: 'S1', conductorId: 'p1', vipId: 'p2', monthKey: '2026-08' }],
  monthlyCounts: { '2026-08': { p1: { conductor: 2, vip: 0 }, p2: { conductor: 0, vip: 1 } } },
  appliedPlans: {},
  weekArchives: [{ id: 'a1', weekLabel: 'S1', days: {} }],
  seedAppliedMonths: ['2026-08'],
  weeklyPlan: {
    weekId: 'w1',
    vsWeekId: 'vs1',
    days: {
      lundi: { conductorId: null, vipId: null, vipMode: null },
      mardi: { conductorId: null, vipId: null, vipMode: null },
      mercredi: { conductorId: null, vipId: null, vipMode: null },
      jeudi: { conductorId: null, vipId: null, vipMode: null },
      vendredi: { conductorId: null, vipId: null, vipMode: null },
      samedi: { conductorId: null, vipId: null, vipMode: null },
      dimanche: { conductorId: null, vipId: null, vipMode: null },
    },
  },
});

const sandbox = {
  window: {},
  console,
  localStorage: {
    getItem: () => store.data,
    setItem: (_k, v) => {
      store.data = v;
    },
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  ROSStorage: {
    getState: () => ({
      players,
      appRole: 'R5',
      weeks: [{ id: 'vs1', label: 'S1', archived: false, scores: {} }],
      currentWeekId: 'vs1',
    }),
  },
  ROSProfiles: {
    getAppRole: () => 'R5',
    isActiveR4OrR5: () => true,
    stampActor: () => ({}),
  },
  AppUI: { toast() {}, confirm: async () => true },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(train, sandbox);
const Train = sandbox.window.TrainModule;
Train.hydrateFromStorage();

const loaded = JSON.parse(store.data);
assert(loaded.categories.length === 8, '8 catégories conservées au chargement');
assert(loaded.categories[0].id === 'cat_mvp' && loaded.categories[0].firstId === 'p1', 'Gagnant MVP conservé');
assert(loaded.categories[1].firstId === 'p2', 'Gagnant Champion conservé');
assert(loaded.history.length === 1, 'Historique intact');
assert(loaded.monthlyCounts['2026-08'].p1.conductor === 2, 'Compteurs intacts');
assert(loaded.weekArchives.length === 1, 'Archives intactes');

// Rename via same storage path used by editCategory
loaded.categories[0].name = 'MVP (test)';
store.data = JSON.stringify(loaded);
Train.hydrateFromStorage();
const after = JSON.parse(store.data);
assert(after.categories[0].name === 'MVP (test)', 'Modif Paramètres persistée dans le store Train');
assert(after.categories[0].firstId === 'p1', 'Premier toujours lié après renommage');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
