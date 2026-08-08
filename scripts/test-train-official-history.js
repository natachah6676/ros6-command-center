/**
 * Tests historique officiel Train + tirage équitable.
 * node scripts/test-train-official-history.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const trainCode = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260808_train_history_official.sql'),
  'utf8'
);

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

console.log('\n=== Structure / UI ===');
assert(migration.includes('train_history_weeks'), 'table weeks SQL');
assert(migration.includes('train_history_days'), 'table days SQL');
assert(migration.includes('ros6_is_active_r4_or_r5'), 'RLS R4/R5');
assert(html.includes('id="settingsTrainHistoryBlock"'), 'bloc historique Paramètres → Train');
assert(html.includes('id="trainHistorySourceWeek"'), 'sélecteur de semaine');
assert(
  html.includes('Enregistrer cette semaine dans l’historique') ||
    html.includes("Enregistrer cette semaine dans l'historique"),
  'bouton enregistrer historique'
);
assert(!html.includes('id="trainInitHistory"'), 'init retiré du Train opérationnel');
assert(!html.includes('id="trainInitHistoryModal"'), 'modal init retiré');
assert(html.includes('id="trainEquityBody"'), 'tableau équité');
assert(trainCode.includes('officialWeeks'), 'champ officialWeeks');
assert(trainCode.includes('pickFairByHistorical'), 'tirage équitable');
assert(trainCode.includes('Mérite — choix manuel'), 'mérite manuel affiché');
assert(trainCode.includes('getHistoricalCounts'), 'compteurs calculés');
assert(trainCode.includes('canManageTrainHistorySettings'), 'garde R5 historique paramètres');
assert(trainCode.includes('submitSettingsHistoryWeek'), 'enregistrement depuis Paramètres');
assert(trainCode.includes('isActiveR5'), 'contrôle permission R5 actif');

const trainPanel = html.slice(html.indexOf('id="panel-train"'), html.indexOf('id="panel-recrutement"'));
const settingsPanel = html.slice(html.indexOf('id="panel-settings"'), html.indexOf('id="playerModal"'));
assert(!trainPanel.includes('settingsTrainHistoryBlock'), 'historique admin absent du Train');
assert(!trainPanel.includes('trainHistorySourceWeek'), 'sélecteur semaine absent du Train');
assert(settingsPanel.includes('settingsTrainHistoryBlock'), 'historique admin dans Paramètres');
assert(settingsPanel.includes('Gérer l’historique') || settingsPanel.includes('Initialiser l’historique'), 'titres gestion');

const players = [
  { id: 'a', pseudo: 'A', role: 'Membre', status: 'Actif' },
  { id: 'b', pseudo: 'B', role: 'Membre', status: 'Actif' },
  { id: 'c', pseudo: 'C', role: 'Membre', status: 'Actif' },
  { id: 'd', pseudo: 'D', role: 'Membre', status: 'Actif' },
];

const store = { data: null };
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
      weeks: [{ id: 'vs1', label: 'S1', startDate: '2026-08-03', endDate: '2026-08-09', archived: false, scores: {} }],
      currentWeekId: 'vs1',
    }),
  },
  ROSProfiles: {
    getAppRole: () => 'R5',
    isActiveR4OrR5: () => true,
    stampActor: () => ({}),
  },
  ROSSupabase: { getClient: () => null },
  ROSSync: { getSession: () => null, schedulePush() {} },
  AppUI: { toast() {}, confirm: async () => true },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(trainCode, sandbox);
const Train = sandbox.window.TrainModule;

store.data = JSON.stringify({
  version: 3,
  categories: [],
  history: [],
  officialWeeks: [],
  monthlyCounts: { '2026-08': {} },
  appliedPlans: {},
  weekArchives: [],
  seedAppliedMonths: ['2026-08'],
  weeklyPlan: {
    weekId: 'w1',
    vsWeekId: 'vs1',
    days: Object.fromEntries(
      ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].map((k) => [
        k,
        { conductorId: null, vipId: null, vipMode: null },
      ])
    ),
  },
});
Train.hydrateFromStorage();

console.log('\n=== Init + compteurs ===');
const week1 = Train.buildOfficialWeekPayload({
  weekKey: 'init_2026-07-28',
  weekLabel: 'Semaine précédente',
  weekStartDate: '2026-07-28',
  weekEndDate: '2026-08-03',
  source: 'init',
  days: {
    lundi: { conductorId: 'a', vipId: 'b' },
    mardi: { conductorId: 'c', vipId: 'd' },
    mercredi: { conductorId: null, vipId: null },
    jeudi: { conductorId: null, vipId: null },
    vendredi: { conductorId: null, vipId: null },
    samedi: { conductorId: null, vipId: null },
    dimanche: { conductorId: null, vipId: null },
  },
});
Train.saveOfficialWeekLocal(week1);
assert(Train.getOfficialWeeks().length === 1, '1 semaine officielle');
assert(Train.getHistoricalCounts('a').conductor === 1, 'A conductor=1');
assert(Train.getHistoricalCounts('b').vip === 1, 'B vip=1');
assert(Train.getHistoricalCounts('c').conductor === 1, 'C conductor=1');
assert(Train.getHistoricalCounts('d').vip === 1, 'D vip=1');
assert(Train.getHistoricalCounts('a').vip === 0, 'A vip=0');

console.log('\n=== Pas de doublon (upsert) ===');
const week1b = Train.buildOfficialWeekPayload({
  weekKey: 'init_2026-07-28',
  weekLabel: 'Semaine précédente (maj)',
  weekStartDate: '2026-07-28',
  weekEndDate: '2026-08-03',
  source: 'init',
  days: {
    lundi: { conductorId: 'a', vipId: 'c' },
    mardi: { conductorId: 'b', vipId: 'd' },
    mercredi: { conductorId: null, vipId: null },
    jeudi: { conductorId: null, vipId: null },
    vendredi: { conductorId: null, vipId: null },
    samedi: { conductorId: null, vipId: null },
    dimanche: { conductorId: null, vipId: null },
  },
});
Train.saveOfficialWeekLocal(week1b);
assert(Train.getOfficialWeeks().length === 1, 'toujours 1 semaine après upsert');
assert(Train.getHistoricalCounts('b').vip === 0, 'B plus VIP après correction upsert');
assert(Train.getHistoricalCounts('c').vip === 1, 'C devient VIP');

console.log('\n=== Correction jour ===');
const id = Train.getOfficialWeeks()[0].id;
const corr = Train.correctOfficialDay(id, 'mardi', 'vipId', 'a');
assert(corr.ok === true, 'correction OK');
assert(Train.getHistoricalCounts('d').vip === 0, 'D vip→0');
assert(Train.getHistoricalCounts('a').vip === 1, 'A vip→1');
assert(Train.getOfficialWeeks()[0].days.lundi.vipId === 'c', 'autre jour inchangé');

console.log('\n=== Tirage équitable VIP ===');
// Reset officiel pour pool clair
store.data = JSON.stringify({
  ...JSON.parse(store.data),
  officialWeeks: [
    {
      id: 'wfair',
      weekKey: 'fair1',
      weekLabel: 'Fair',
      weekStartDate: '2026-07-01',
      weekEndDate: '2026-07-07',
      source: 'init',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      days: {
        lundi: { conductorId: null, conductorPseudo: null, vipId: 'c', vipPseudo: 'C' },
        mardi: { conductorId: null, conductorPseudo: null, vipId: 'd', vipPseudo: 'D' },
        mercredi: { conductorId: null, conductorPseudo: null, vipId: 'd', vipPseudo: 'D' },
        jeudi: { conductorId: null, conductorPseudo: null, vipId: null, vipPseudo: null },
        vendredi: { conductorId: null, conductorPseudo: null, vipId: null, vipPseudo: null },
        samedi: { conductorId: null, conductorPseudo: null, vipId: null, vipPseudo: null },
        dimanche: { conductorId: null, conductorPseudo: null, vipId: null, vipPseudo: null },
      },
    },
  ],
});
Train.hydrateFromStorage();
assert(Train.getHistoricalCounts('a').vip === 0, 'A hist VIP 0');
assert(Train.getHistoricalCounts('b').vip === 0, 'B hist VIP 0');
assert(Train.getHistoricalCounts('c').vip === 1, 'C hist VIP 1');
assert(Train.getHistoricalCounts('d').vip === 2, 'D hist VIP 2');

const picks = new Set();
for (let i = 0; i < 40; i += 1) {
  const p = Train.pickFairByHistorical(players, 'vip');
  picks.add(p.id);
}
assert(picks.has('a') && picks.has('b'), 'tirage parmi A/B (min=0)');
assert(!picks.has('c') && !picks.has('d'), 'C et D exclus du pool min');

console.log('\n=== Mensuel séparé ===');
const state = JSON.parse(store.data);
state.monthlyCounts = { '2026-08': { a: { conductor: 0, vip: 1 } } };
store.data = JSON.stringify(state);
Train.hydrateFromStorage();
assert(Train.getVipIdsThisMonth().has('a'), 'déjà VIP ce mois (mensuel)');
assert(Train.getHistoricalCounts('a').vip === 0, 'historique VIP A toujours 0');

console.log('\n=== Permissions R5 Paramètres ===');
sandbox.ROSProfiles.isActiveR5 = () => true;
sandbox.ROSProfiles.getAppRole = () => 'R5';
assert(Train.canManageTrainHistorySettings() === true, 'R5 peut gérer historique Paramètres');
sandbox.ROSProfiles.isActiveR5 = () => false;
sandbox.ROSProfiles.getAppRole = () => 'R4';
assert(Train.canManageTrainHistorySettings() === false, 'R4 ne peut pas gérer historique Paramètres');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
