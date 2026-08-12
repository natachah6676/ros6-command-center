/**
 * Remplacement VIP manuel : éligibles + exclus forçables (sauf conducteur du jour).
 * node scripts/test-train-vip-force-manual.js
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

console.log('\n=== Code / UI ===');
assert(trainCode.includes('function classifyWeekVipCandidates'), 'classifyWeekVipCandidates');
assert(trainCode.includes('function getVipExclusionReasons'), 'getVipExclusionReasons');
assert(trainCode.includes('Exclus — sélection manuelle possible'), 'optgroup exclus');
assert(trainCode.includes('forceVip: true') || trainCode.includes('forceVip:true'), 'option forceVip');
assert(trainCode.includes('Ce joueur est normalement exclu'), 'confirmation forçage');
assert(trainCode.includes("vipMode === 'force'") || trainCode.includes('vipMode === "force"'), 'mode force');
assert(!/pickRandomEligibleVip[\s\S]{0,200}forceable/.test(trainCode), 'tirage non branché sur forceable');
assert(html.includes('20260812-vip-force1'), 'cache-bust');

const players = [
  { id: 'c1', pseudo: 'CondLundi', role: 'Membre', status: 'Actif' },
  { id: 'ok1', pseudo: 'Eligible1', role: 'Membre', status: 'Actif' },
  { id: 'abs1', pseudo: 'Absent1', role: 'Membre', status: 'Actif', absent: true },
  { id: 'vm1', pseudo: 'VipMois1', role: 'Membre', status: 'Actif' },
  { id: 'vw1', pseudo: 'VipSemaine1', role: 'Membre', status: 'Actif' },
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

function loadState(days, monthlyCounts = { '2026-08': { vm1: { conductor: 0, vip: 1 } } }) {
  store.data = JSON.stringify({
    version: 3,
    categories: [],
    seedAppliedMonths: ['2026-08'],
    monthlyCounts,
    history: [],
    officialWeeks: [],
    appliedPlans: {},
    weekArchives: [],
    weeklyPlan: {
      weekId: 'tw1',
      vsWeekId: 'vs1',
      days,
    },
  });
  Train.hydrateFromStorage();
}

const baseDays = {
  lundi: { conductorId: 'c1', vipId: 'vw1', vipMode: 'manuel' },
  mardi: { conductorId: null, vipId: null, vipMode: null },
  mercredi: { conductorId: null, vipId: null, vipMode: null },
  jeudi: { conductorId: null, vipId: null, vipMode: null },
  vendredi: { conductorId: null, vipId: null, vipMode: null },
  samedi: { conductorId: null, vipId: null, vipMode: null },
  dimanche: { conductorId: 'jeu_quiz', vipId: null, vipMode: null },
};

loadState(baseDays);

console.log('\n=== Classification ===');
const classified = Train.classifyWeekVipCandidates('mardi');
assert(
  classified.eligible.some((e) => e.player.id === 'ok1'),
  'éligible présent'
);
assert(
  classified.eligible.some((e) => e.player.id === 'c1'),
  'conducteur lundi éligible VIP mardi'
);

const abs = classified.forceable.find((e) => e.player.id === 'abs1');
assert(abs && abs.reasons.includes('Absent'), 'absent forçable');

const vipMoisEntry = classified.forceable.find((e) => e.player.id === 'vm1');
assert(vipMoisEntry && vipMoisEntry.reasons.includes('VIP déjà ce mois'), 'VIP mois forçable');

const vipSemEntry = classified.forceable.find((e) => e.player.id === 'vw1');
assert(vipSemEntry && vipSemEntry.reasons.includes('VIP déjà cette semaine'), 'VIP semaine forçable');

const blocked = Train.classifyWeekVipCandidates('lundi');
assert(
  blocked.blocked.some((e) => e.player.id === 'c1'),
  'conducteur du jour bloqué (lundi)'
);
assert(
  !blocked.forceable.some((e) => e.player.id === 'c1'),
  'conducteur du jour pas forçable'
);
assert(
  !blocked.eligible.some((e) => e.player.id === 'c1'),
  'conducteur du jour pas éligible'
);

console.log('\n=== Tirage strict (inchangé) ===');
assert(!Train.isEligibleForWeekVip(players.find((p) => p.id === 'abs1'), 'mardi'), 'tirage ignore absent');
assert(!Train.isEligibleForWeekVip(players.find((p) => p.id === 'vm1'), 'mardi'), 'tirage ignore VIP mois');
assert(!Train.isEligibleForWeekVip(players.find((p) => p.id === 'vw1'), 'mardi'), 'tirage ignore VIP semaine');
assert(!Train.isEligibleForWeekVip(players.find((p) => p.id === 'c1'), 'lundi'), 'tirage ignore conducteur jour');

console.log('\n=== Forçage ===');
Train.setWeekDayField('mardi', 'vipId', 'vm1', { forceVip: true });
assert(Train.getWeeklyPlan().days.mardi.vipId === 'vm1', 'VIP forcé appliqué');
assert(Train.getWeeklyPlan().days.mardi.vipMode === 'force', 'vipMode = force');

const errorsForce = Train.validateWeeklyPlanErrors();
assert(
  !errorsForce.some((e) => /VIP déjà VIP ce mois/i.test(e)),
  'forçage VIP mois ne bloque pas la validation'
);

// Forcer VIP déjà cette semaine → retire l’autre jour
Train.setWeekDayField('mercredi', 'vipId', 'vw1', { forceVip: true });
assert(Train.getWeeklyPlan().days.mercredi.vipId === 'vw1', 'VIP semaine déplacé sur mercredi');
assert(Train.getWeeklyPlan().days.lundi.vipId === null, 'VIP retiré de lundi');

// Refus conducteur du jour
Train.setWeekDayField('lundi', 'vipId', 'c1', { forceVip: true });
assert(Train.getWeeklyPlan().days.lundi.vipId !== 'c1', 'refus forcer conducteur du jour');

console.log('\n=== Compteurs / deltas incluent le VIP forcé ===');
loadState({
  ...baseDays,
  lundi: { conductorId: 'c1', vipId: null, vipMode: null },
  mardi: { conductorId: 'ok1', vipId: null, vipMode: null },
  mercredi: { conductorId: null, vipId: null, vipMode: null },
  jeudi: { conductorId: null, vipId: null, vipMode: null },
  vendredi: { conductorId: null, vipId: null, vipMode: null },
  samedi: { conductorId: null, vipId: null, vipMode: null },
  dimanche: { conductorId: 'jeu_quiz', vipId: null, vipMode: null },
});
Train.setWeekDayField('mardi', 'vipId', 'vm1', { forceVip: true });
const deltas = Train.buildWeeklyPlanDeltas(Train.getWeeklyPlan());
assert(
  deltas.some((d) => d.playerId === 'vm1' && d.vip === 1),
  'delta VIP forcé compté'
);

console.log('\n=== Permission R4/R5 ===');
assert(Train.canForceVipManual() === true, 'R5 peut forcer');
sandbox.ROSProfiles.isActiveR4OrR5 = () => false;
assert(Train.canForceVipManual() === false, 'non R4/R5 ne peut pas forcer');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
