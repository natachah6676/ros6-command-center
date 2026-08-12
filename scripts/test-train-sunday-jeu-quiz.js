/**
 * Dimanche « Jeu / Quiz » — valeur valide non-joueur.
 * node scripts/test-train-sunday-jeu-quiz.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const trainCode = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');
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

console.log('\n=== Présence code / UI ===');
assert(trainCode.includes("SUNDAY_JEU_QUIZ_ID = 'jeu_quiz'"), 'constante jeu_quiz');
assert(trainCode.includes("SUNDAY_JEU_QUIZ_LABEL = 'Jeu / Quiz'"), 'libellé Jeu / Quiz');
assert(trainCode.includes('function isJeuQuizConductor'), 'helper isJeuQuizConductor');
assert(trainCode.includes('isRealPlayerId'), 'helper isRealPlayerId');
assert(html.includes('dimanche « Jeu / Quiz »'), 'texte validation index');
assert(html.includes('20260812-vip-force1'), 'cache-bust train.js');

const monthKey = '2026-08';
const players = [
  { id: 'c1', pseudo: 'HGS123', role: 'Membre', status: 'Actif' },
  { id: 'c2', pseudo: 'XalAtath', role: 'Membre', status: 'Actif' },
  { id: 'c3', pseudo: 'Mertz 1', role: 'Membre', status: 'Actif' },
  { id: 'v1', pseudo: 'FafaneLeBarbu', role: 'Membre', status: 'Actif' },
  { id: 'v2', pseudo: 'Diidine89', role: 'Membre', status: 'Actif' },
  { id: 'v3', pseudo: 'orely', role: 'Membre', status: 'Actif' },
];

function emptyDays(sundayConductor) {
  return {
    lundi: { conductorId: 'c1', vipId: 'v1', vipMode: 'manuel' },
    mardi: { conductorId: 'c2', vipId: 'v2', vipMode: 'manuel' },
    mercredi: { conductorId: 'c3', vipId: 'v3', vipMode: 'manuel' },
    jeudi: { conductorId: null, vipId: null, vipMode: null },
    vendredi: { conductorId: null, vipId: null, vipMode: null },
    samedi: { conductorId: null, vipId: null, vipMode: null },
    dimanche: { conductorId: sundayConductor, vipId: null, vipMode: null },
  };
}

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
      weeks: [
        {
          id: 'vs1',
          label: 'S1 août',
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
  AppUI: { toast() {}, confirm: async () => true },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(trainCode, sandbox);
const Train = sandbox.window.TrainModule;

const realDate = Date;
class FakeDate extends realDate {
  constructor(...args) {
    if (args.length === 0) super('2026-08-08T12:00:00.000Z');
    else super(...args);
  }
  static now() {
    return new FakeDate().getTime();
  }
}
sandbox.Date = FakeDate;

function loadPlan(sundayConductor, extras = {}) {
  const trainState = {
    version: 3,
    categories: [],
    seedAppliedMonths: [monthKey],
    monthlyCounts: { [monthKey]: {} },
    history: [],
    officialWeeks: [],
    appliedPlans: {},
    weekArchives: [],
    weeklyPlan: {
      weekId: 'trainweek_current',
      vsWeekId: 'vs1',
      days: emptyDays(sundayConductor),
    },
    ...extras,
  };
  // Compléter Lun–Sam pour tests de clôture
  if (extras.fullWeek) {
    trainState.weeklyPlan.days = {
      lundi: { conductorId: 'c1', vipId: 'v1', vipMode: 'manuel' },
      mardi: { conductorId: 'c2', vipId: 'v2', vipMode: 'manuel' },
      mercredi: { conductorId: 'c3', vipId: 'v3', vipMode: 'manuel' },
      jeudi: { conductorId: 'c1', vipId: 'v1', vipMode: 'manuel' }, // doublon volontaire? non — use unique
      vendredi: { conductorId: null, vipId: null, vipMode: null },
      samedi: { conductorId: null, vipId: null, vipMode: null },
      dimanche: { conductorId: sundayConductor, vipId: extras.sundayVip || null, vipMode: null },
    };
    // Fix: need 6 unique conductors for full week - use only 3 days filled for partial tests
  }
  store.data = JSON.stringify(trainState);
  Train.hydrateFromStorage();
}

console.log('\n=== Init nouvelle semaine / normalisation ===');
store.data = null;
Train.hydrateFromStorage();
const blank = Train.getWeeklyPlan();
assert(
  blank.days.dimanche.conductorId === Train.SUNDAY_JEU_QUIZ_ID,
  'nouvelle semaine : dimanche = jeu_quiz'
);
assert(Train.isJeuQuizConductor(blank.days.dimanche.conductorId), 'isJeuQuizConductor');
assert(Train.isSundayFilled(blank), 'Jeu / Quiz ⇒ dimanche renseigné');

loadPlan(null);
const migrated = Train.getWeeklyPlan();
assert(
  migrated.days.dimanche.conductorId === Train.SUNDAY_JEU_QUIZ_ID,
  'dimanche null migré vers jeu_quiz'
);

console.log('\n=== Validation / clôture avec Jeu / Quiz ===');
// Semaine complète Lun–Sam + dimanche Jeu/Quiz sans VIP
const fullPlayers = [
  ...players,
  { id: 'c4', pseudo: 'P4', role: 'Membre', status: 'Actif' },
  { id: 'c5', pseudo: 'P5', role: 'Membre', status: 'Actif' },
  { id: 'c6', pseudo: 'P6', role: 'Membre', status: 'Actif' },
  { id: 'v4', pseudo: 'V4', role: 'Membre', status: 'Actif' },
  { id: 'v5', pseudo: 'V5', role: 'Membre', status: 'Actif' },
  { id: 'v6', pseudo: 'V6', role: 'Membre', status: 'Actif' },
];
sandbox.ROSStorage.getState = () => ({
  players: fullPlayers,
  appRole: 'R5',
  weeks: [
    {
      id: 'vs1',
      label: 'S1 août',
      startDate: '2026-08-03',
      endDate: '2026-08-09',
      archived: false,
      scores: {},
    },
  ],
  currentWeekId: 'vs1',
});

store.data = JSON.stringify({
  version: 3,
  categories: [],
  seedAppliedMonths: [monthKey],
  monthlyCounts: { [monthKey]: {} },
  history: [],
  officialWeeks: [],
  appliedPlans: {},
  weekArchives: [],
  weeklyPlan: {
    weekId: 'trainweek_current',
    vsWeekId: 'vs1',
    days: {
      lundi: { conductorId: 'c1', vipId: 'v1', vipMode: 'manuel' },
      mardi: { conductorId: 'c2', vipId: 'v2', vipMode: 'manuel' },
      mercredi: { conductorId: 'c3', vipId: 'v3', vipMode: 'manuel' },
      jeudi: { conductorId: 'c4', vipId: 'v4', vipMode: 'manuel' },
      vendredi: { conductorId: 'c5', vipId: 'v5', vipMode: 'manuel' },
      samedi: { conductorId: 'c6', vipId: 'v6', vipMode: 'manuel' },
      dimanche: { conductorId: 'jeu_quiz', vipId: null, vipMode: null },
    },
  },
});
Train.hydrateFromStorage();

assert(Train.isSundayFilled(), 'isSundayFilled avec Jeu/Quiz sans VIP');
const closureQuiz = Train.validateClosure();
assert(
  !closureQuiz.some((e) => /Dimanche/i.test(e)),
  'clôture : aucune erreur Dimanche avec Jeu/Quiz'
);
assert(closureQuiz.length === 0, 'clôture OK (Lun–Sam complets + Jeu/Quiz)');

const deltasQuiz = Train.buildWeeklyPlanDeltas(Train.getWeeklyPlan());
assert(
  !deltasQuiz.some((d) => d.playerId === 'jeu_quiz'),
  'deltas : pas de joueur fictif jeu_quiz'
);
assert(
  deltasQuiz.filter((d) => d.conductor > 0).length === 6,
  'deltas : 6 conducteurs réels seulement (pas dimanche)'
);

const notifQuiz = Train.buildNotificationText(Train.getWeeklyPlan(), 'final');
assert(notifQuiz.includes('Dimanche : Jeu / Quiz'), 'notif finale affiche Jeu / Quiz');
assert(!/Dimanche \| Conducteur : Jeu/.test(notifQuiz), 'format court Dimanche : Jeu / Quiz');

console.log('\n=== Remplacement par joueur réel ⇒ VIP obligatoire ===');
fullPlayers.push(
  { id: 'c7', pseudo: 'P7', role: 'Membre', status: 'Actif' },
  { id: 'v7', pseudo: 'V7', role: 'Membre', status: 'Actif' }
);
Train.setWeekDayField('dimanche', 'conductorId', 'c7');
assert(Train.getWeeklyPlan().days.dimanche.conductorId === 'c7', 'dimanche conducteur réel');
assert(!Train.isSundayFilled(), 'joueur réel sans VIP ⇒ dimanche non renseigné');
const closureReal = Train.validateClosure();
assert(
  closureReal.some((e) => e === 'VIP manquant : Dimanche'),
  'VIP dimanche obligatoire si conducteur réel'
);

Train.setWeekDayField('dimanche', 'vipId', 'v7');
assert(Train.isSundayFilled(), 'conducteur réel + VIP ⇒ dimanche renseigné');
const closureWithVip = Train.validateClosure();
assert(
  !closureWithVip.some((e) => /Dimanche/i.test(e) && /manquant/i.test(e)),
  'plus d’erreur manquante Dimanche'
);
assert(closureWithVip.length === 0, 'clôture OK avec conducteur+VIP dimanche');

const deltasReal = Train.buildWeeklyPlanDeltas(Train.getWeeklyPlan());
assert(
  deltasReal.some((d) => d.playerId === 'c7' && d.conductor === 1),
  'deltas : conducteur dimanche réel compté'
);

console.log('\n=== Remettre Jeu / Quiz ===');
Train.setWeekDayField('dimanche', 'conductorId', Train.SUNDAY_JEU_QUIZ_ID);
Train.setWeekDayField('dimanche', 'vipId', null);
assert(Train.getWeeklyPlan().days.dimanche.conductorId === 'jeu_quiz', 'retour Jeu / Quiz');
assert(Train.isSundayFilled(), 'Jeu / Quiz sans VIP à nouveau valide');
assert(
  !Train.getWeekConductorIds().has('jeu_quiz'),
  'jeu_quiz exclu des conducteurs semaine (exclusions VIP)'
);
assert(
  Train.buildNotificationText(Train.getWeeklyPlan(), 'provisional').includes('Dimanche : Jeu / Quiz'),
  'notif provisoire inclut Jeu / Quiz'
);

console.log('\n=== Compteurs / historique : pas de joueur fictif ===');
assert(Train.getHistoricalCounts('jeu_quiz').conductor === 0, 'équité : jeu_quiz = 0');
assert(!Train.isRealPlayerId('jeu_quiz'), 'jeu_quiz n’est pas un joueur réel');
assert(Train.isRealPlayerId('c1'), 'c1 est un joueur réel');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
