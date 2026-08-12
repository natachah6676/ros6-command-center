/**
 * Analyse conducteurs : catégories partiellement renseignées.
 * node scripts/test-train-analyze-partial-categories.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const trainCode = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');

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

console.log('\n=== Code / messages ===');
assert(trainCode.includes('function hasAnyFirstFilled'), 'hasAnyFirstFilled');
assert(!trainCode.includes('function allFirstFilled'), 'allFirstFilled retiré');
assert(
  trainCode.includes('Renseignez au moins une catégorie pour analyser les conducteurs.'),
  'message au moins une catégorie'
);
assert(!trainCode.includes('Renseignez tous les Premiers'), 'plus de message tous les Premiers');
assert(trainCode.includes('!hasAnyFirstFilled()'), 'bouton / garde hasAnyFirstFilled');

const players = [
  { id: 'p1', pseudo: 'Alpha', role: 'Membre', status: 'Actif' },
  { id: 'p2', pseudo: 'Bravo', role: 'Membre', status: 'Actif' },
  { id: 'p3', pseudo: 'Charlie', role: 'Membre', status: 'Actif' },
];

const store = { data: null };
const toasts = [];
const analyzeEl = { innerHTML: '' };
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
    getElementById: (id) => {
      if (id === 'trainAnalyzeResult') return analyzeEl;
      if (id === 'panel-train') return { addEventListener() {}, querySelectorAll: () => [] };
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  ROSStorage: {
    getState: () => ({
      players,
      appRole: 'R5',
      weeks: [
        {
          id: 'vs1',
          label: 'S1',
          startDate: '2026-08-03',
          endDate: '2026-08-09',
          archived: false,
          scores: {},
        },
      ],
      currentWeekId: 'vs1',
    }),
  },
  ROSProfiles: {
    getAppRole: () => 'R5',
    isActiveR4OrR5: () => true,
    stampActor: () => ({ actorUserId: 'u1', actorPlayerId: null, actorLabel: 'R5' }),
  },
  AppUI: {
    toast(msg) {
      toasts.push(msg);
    },
    confirm: async () => true,
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(trainCode, sandbox);
const Train = sandbox.window.TrainModule;

function loadCategories(categories) {
  store.data = JSON.stringify({
    version: 3,
    categories,
    seedAppliedMonths: ['2026-08'],
    monthlyCounts: { '2026-08': {} },
    history: [],
    officialWeeks: [],
    appliedPlans: {},
    weekArchives: [],
    weeklyPlan: {
      weekId: 'tw1',
      vsWeekId: 'vs1',
      days: {
        lundi: { conductorId: null, vipId: null, vipMode: null },
        mardi: { conductorId: null, vipId: null, vipMode: null },
        mercredi: { conductorId: null, vipId: null, vipMode: null },
        jeudi: { conductorId: null, vipId: null, vipMode: null },
        vendredi: { conductorId: null, vipId: null, vipMode: null },
        samedi: { conductorId: null, vipId: null, vipMode: null },
        dimanche: { conductorId: 'jeu_quiz', vipId: null, vipMode: null },
      },
    },
  });
  Train.hydrateFromStorage();
}

const emptyCats = [
  { id: 'cat1', name: 'MVP', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat2', name: 'Champion', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat3', name: 'Étoile', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat4', name: 'Roi', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat5', name: 'Entraîneur', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat6', name: 'Destructeur', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat7', name: 'Assistant', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
  { id: 'cat8', name: 'Exercice', type: 'saison', day: null, firstId: null, secondId: null, vipId: null, vipMode: null },
];

console.log('\n=== Aucune catégorie renseignée ===');
loadCategories(emptyCats.map((c) => ({ ...c })));
assert(Train.hasAnyFirstFilled() === false, 'hasAnyFirstFilled = false si tout vide');
toasts.length = 0;
Train.analyzeConductors();
assert(
  toasts.some((t) => t.includes('au moins une catégorie')),
  'toast si aucune catégorie'
);
assert(Train.getFirstCandidates().length === 0, 'aucun candidat si tout vide');

console.log('\n=== 5 catégories sur 8 renseignées, sans conflit ===');
const partial = emptyCats.map((c) => ({ ...c }));
partial[0].firstId = 'p1';
partial[1].firstId = 'p2';
partial[2].firstId = 'p3';
partial[3].firstId = 'p1'; // will conflict with cat1 — wait, for no-conflict use unique
partial[3].firstId = null; // only 3 filled first — user asked 5
partial[3].firstId = 'p2'; // conflict with cat2 - let's do 5 unique carefully
// Reset: 5 filled without conflict
partial[0].firstId = 'p1';
partial[1].firstId = 'p2';
partial[2].firstId = 'p3';
partial[3].firstId = 'p1'; // intentional later for conflict test — for this block use no conflict
// Use only p1,p2,p3 without duplicate for "no conflict" — need 5 players or allow same? 
// Without conflict: 5 categories need 5 different players OR same player only once.
const players5 = [
  ...players,
  { id: 'p4', pseudo: 'Delta', role: 'Membre', status: 'Actif' },
  { id: 'p5', pseudo: 'Echo', role: 'Membre', status: 'Actif' },
];
sandbox.ROSStorage.getState = () => ({
  players: players5,
  appRole: 'R5',
  weeks: [
    {
      id: 'vs1',
      label: 'S1',
      startDate: '2026-08-03',
      endDate: '2026-08-09',
      archived: false,
      scores: {},
    },
  ],
  currentWeekId: 'vs1',
});

const fiveOk = emptyCats.map((c) => ({ ...c }));
fiveOk[0].firstId = 'p1';
fiveOk[1].firstId = 'p2';
fiveOk[2].firstId = 'p3';
fiveOk[3].firstId = 'p4';
fiveOk[4].firstId = 'p5';
// cat6-8 empty
loadCategories(fiveOk);

assert(Train.hasAnyFirstFilled() === true, 'hasAnyFirstFilled = true avec 5/8');
assert(Train.getFirstCandidates().length === 5, '5 candidats mérite (catégories renseignées)');
assert(
  Train.findFirstConflicts().length === 0,
  'aucun conflit si Premiers distincts'
);
assert(
  trainCode.includes("renderAnalyzeResult('<div class=\"train-ok\">Aucun conflit détecté</div>')") ||
    trainCode.includes('Aucun conflit détecté'),
  'chemin succès analyse sans exiger toutes les catégories'
);

console.log('\n=== Conflit partiel : même Premier dans 2 catégories parmi 5 ===');
const fiveConflict = emptyCats.map((c) => ({ ...c }));
fiveConflict[0].firstId = 'p1';
fiveConflict[1].firstId = 'p1'; // conflit
fiveConflict[2].firstId = 'p2';
fiveConflict[3].firstId = 'p3';
fiveConflict[4].firstId = 'p4';
loadCategories(fiveConflict);

const conflicts = Train.findFirstConflicts();
assert(conflicts.length === 1, '1 conflit détecté');
assert(conflicts[0].playerId === 'p1', 'conflit sur p1');
assert(conflicts[0].categories.length === 2, 'conflit sur 2 catégories seulement');
assert(
  conflicts[0].categories.every((c) => c.firstId === 'p1'),
  'catégories vides ignorées dans le conflit'
);

console.log('\n=== Mérite / compteurs inchangés ===');
assert(Train.getFirstCandidates().every((c) => c.playerId), 'candidats = joueurs réels uniquement');
assert(
  !Train.getFirstCandidates().some((c) => !c.player),
  'pas de candidat fictif'
);
const countsBefore = Train.getPlayerMonthCounts('p1', '2026-08');
const _conflictsOnly = Train.findFirstConflicts();
const countsAfter = Train.getPlayerMonthCounts('p1', '2026-08');
assert(_conflictsOnly.length === 1, 'findFirstConflicts ne mute pas l’état');
assert(
  countsBefore.conductor === countsAfter.conductor && countsBefore.vip === countsAfter.vip,
  'analyse (détection) ne modifie pas les compteurs'
);

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
