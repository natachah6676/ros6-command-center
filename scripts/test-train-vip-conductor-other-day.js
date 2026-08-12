/**
 * VIP : conducteur un jour peut être VIP un autre jour (pas le même jour).
 * node scripts/test-train-vip-conductor-other-day.js
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

console.log('\n=== Code ===');
assert(
  !trainCode.includes('Conducteurs déjà choisis cette semaine (y compris le jour cible) — jamais VIP'),
  'ancienne exclusion semaine retirée'
);
assert(
  !trainCode.includes('VIP aussi conducteur cette semaine'),
  'erreur validation cross-day retirée'
);
assert(trainCode.includes('Conducteur du jour cible uniquement'), 'commentaire même jour');
assert(trainCode.includes('Éligibles au tirage :'), 'panneau éligibles');
assert(trainCode.includes('VIP déjà cette semaine'), 'panneau VIP semaine');
assert(trainCode.includes('Conducteur du jour :'), 'panneau conducteur du jour');

const players = [
  { id: 'c1', pseudo: 'CondLundi', role: 'Membre', status: 'Actif' },
  { id: 'c2', pseudo: 'CondMardi', role: 'Membre', status: 'Actif' },
  { id: 'v1', pseudo: 'VipLibre', role: 'Membre', status: 'Actif' },
  { id: 'v2', pseudo: 'VipMois', role: 'Membre', status: 'Actif' },
  { id: 'a1', pseudo: 'Absent1', role: 'Membre', status: 'Actif', absent: true },
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
      weeks: [
        {
          id: 'vs1',
          label: 'S1',
          startDate: '2026-08-03',
          endDate: '2026-08-09',
          archived: false,
          scores: {
            // tous verts (0 pts)
          },
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

store.data = JSON.stringify({
  version: 3,
  categories: [],
  seedAppliedMonths: ['2026-08'],
  monthlyCounts: {
    '2026-08': {
      v2: { conductor: 0, vip: 1 },
    },
  },
  history: [],
  officialWeeks: [],
  appliedPlans: {},
  weekArchives: [],
  weeklyPlan: {
    weekId: 'tw1',
    vsWeekId: 'vs1',
    days: {
      lundi: { conductorId: 'c1', vipId: null, vipMode: null },
      mardi: { conductorId: 'c2', vipId: null, vipMode: null },
      mercredi: { conductorId: null, vipId: null, vipMode: null },
      jeudi: { conductorId: null, vipId: null, vipMode: null },
      vendredi: { conductorId: null, vipId: null, vipMode: null },
      samedi: { conductorId: null, vipId: null, vipMode: null },
      dimanche: { conductorId: 'jeu_quiz', vipId: null, vipMode: null },
    },
  },
});
Train.hydrateFromStorage();

const pC1 = players.find((p) => p.id === 'c1');
const pC2 = players.find((p) => p.id === 'c2');
const pV1 = players.find((p) => p.id === 'v1');
const pV2 = players.find((p) => p.id === 'v2');
const pA1 = players.find((p) => p.id === 'a1');

console.log('\n=== Conducteur autre jour ⇒ VIP OK ===');
assert(Train.isEligibleForWeekVip(pC1, 'mardi') === true, 'conducteur lundi éligible VIP mardi');
assert(Train.isEligibleForWeekVip(pC1, 'mercredi') === true, 'conducteur lundi éligible VIP mercredi');
assert(Train.isEligibleForWeekVip(pC2, 'lundi') === true, 'conducteur mardi éligible VIP lundi');

console.log('\n=== Même jour ⇒ VIP KO ===');
assert(Train.isEligibleForWeekVip(pC1, 'lundi') === false, 'conducteur lundi NON éligible VIP lundi');
assert(Train.isEligibleForWeekVip(pC2, 'mardi') === false, 'conducteur mardi NON éligible VIP mardi');

console.log('\n=== Autres règles inchangées ===');
assert(Train.isEligibleForWeekVip(pV2, 'mercredi') === false, 'VIP du mois toujours exclu');
assert(Train.isEligibleForWeekVip(pA1, 'mercredi') === false, 'absent toujours exclu');
assert(Train.isEligibleForWeekVip(pV1, 'mercredi') === true, 'joueur libre éligible');

Train.setWeekDayField('mercredi', 'vipId', 'v1');
assert(Train.isEligibleForWeekVip(pV1, 'jeudi') === false, 'VIP déjà cette semaine exclu ailleurs');
assert(Train.isEligibleForWeekVip(pV1, 'mercredi') === true, 'VIP actuel du jour reste listable (sauf modal)');

console.log('\n=== Validation planning : cross-day OK ===');
Train.setWeekDayField('mardi', 'vipId', 'c1'); // conducteur lundi + VIP mardi
const errors = Train.validateWeeklyPlanErrors();
assert(
  !errors.some((e) => /VIP aussi conducteur cette semaine/i.test(e)),
  'pas d’erreur conducteur↔VIP jours différents'
);
assert(
  !errors.some((e) => /Conducteur aussi choisi comme VIP/i.test(e)),
  'pas d’erreur même-jour (jours différents)'
);

// Injecte un état invalide (même jour) — setWeekDayField refuse à juste titre
const raw = JSON.parse(store.data);
raw.weeklyPlan.days.lundi.vipId = 'c1';
raw.weeklyPlan.days.lundi.vipMode = 'manuel';
store.data = JSON.stringify(raw);
Train.hydrateFromStorage();
const sameDayErrors = Train.validateWeeklyPlanErrors();
assert(
  sameDayErrors.some((e) => /Conducteur aussi choisi comme VIP/i.test(e)),
  'erreur si conducteur = VIP le même jour'
);

console.log('\n=== Panneau exclusions ===');
// Recharger un état propre pour les stats
store.data = JSON.stringify({
  version: 3,
  categories: [],
  seedAppliedMonths: ['2026-08'],
  monthlyCounts: {
    '2026-08': {
      v2: { conductor: 0, vip: 1 },
    },
  },
  history: [],
  officialWeeks: [],
  appliedPlans: {},
  weekArchives: [],
  weeklyPlan: {
    weekId: 'tw1',
    vsWeekId: 'vs1',
    days: {
      lundi: { conductorId: 'c1', vipId: null, vipMode: null },
      mardi: { conductorId: 'c2', vipId: null, vipMode: null },
      mercredi: { conductorId: null, vipId: null, vipMode: null },
      jeudi: { conductorId: null, vipId: null, vipMode: null },
      vendredi: { conductorId: null, vipId: null, vipMode: null },
      samedi: { conductorId: null, vipId: null, vipMode: null },
      dimanche: { conductorId: 'jeu_quiz', vipId: null, vipMode: null },
    },
  },
});
Train.hydrateFromStorage();

const statsMardi = Train.getVipDrawExclusionStats('mardi');
assert(statsMardi.dayConductor === 1, 'stats mardi : 1 conducteur du jour (c2)');
assert(statsMardi.vipMonth === 1, 'stats : 1 VIP du mois (v2)');
assert(statsMardi.absents === 1, 'stats : 1 absent');
assert(statsMardi.actifs === 5, 'stats : 5 actifs');
assert(typeof statsMardi.eligible === 'number', 'stats.eligible présent');
assert(
  statsMardi.eligible === statsMardi.actifs - statsMardi.totalExcluded,
  'éligibles = actifs − exclus'
);
assert(Train.isEligibleForWeekVip(pC1, 'mardi'), 'c1 compte parmi les éligibles mardi');
assert(
  Train.getEligibleWeekVipPlayers('mardi').some((p) => p.id === 'c1'),
  'liste VIP mardi contient le conducteur lundi'
);
assert(
  !Train.getEligibleWeekVipPlayers('mardi').some((p) => p.id === 'c2'),
  'liste VIP mardi exclut le conducteur mardi'
);

const statsLundi = Train.getVipDrawExclusionStats('lundi');
assert(statsLundi.dayConductor === 1, 'stats lundi : conducteur du jour = c1');
assert(
  !Train.getEligibleWeekVipPlayers('lundi').some((p) => p.id === 'c1'),
  'liste VIP lundi exclut conducteur lundi'
);

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
