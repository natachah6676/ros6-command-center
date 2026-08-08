/**
 * Tests correction manuelle d’historique Train (archives).
 * node scripts/test-train-archive-correct.js
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
    console.log('  ✓', msg);
  } else {
    failed += 1;
    console.error('  ✗', msg);
  }
}

console.log('\n=== UI / code archive correction ===');
assert(html.includes('correction manuelle Conducteur / VIP'), 'Sous-titre historique');
assert(trainCode.includes('correctArchivedHistoryRole'), 'fonction correction');
assert(trainCode.includes('replace-history-role'), 'action Modifier archive');
assert(trainCode.includes('openHistoryReplaceModal'), 'modal archive');
assert(trainCode.includes('canCorrectTrainArchive'), 'permission R4/R5');
assert(trainCode.includes('train-history-archived-chip'), 'badge Archivée');

const monthKey = '2026-08';
const players = [
  { id: 'c1', pseudo: 'HGS123', role: 'Membre', status: 'Actif' },
  { id: 'v1', pseudo: 'FafaneLeBarbu', role: 'Membre', status: 'Actif' },
  { id: 'v2', pseudo: 'Diidine89', role: 'Membre', status: 'Actif' },
  { id: 'c2', pseudo: 'XalAtath', role: 'Membre', status: 'Actif' },
  { id: 'c3', pseudo: 'Mertz 1', role: 'Membre', status: 'Actif' },
  { id: 'v3', pseudo: 'orely', role: 'Membre', status: 'Actif' },
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

// Injecte un état Train déjà clôturé / archivé
const weekId = 'trainweek_s1';
const histMardi = 'hist_mardi';
const histMercredi = 'hist_mercredi';
const trainState = {
  version: 2,
  categories: [],
  seedAppliedMonths: [monthKey],
  monthlyCounts: {
    [monthKey]: {
      c1: { conductor: 1, vip: 0 },
      v1: { conductor: 0, vip: 1 },
      c2: { conductor: 1, vip: 0 },
      v2: { conductor: 0, vip: 1 },
    },
  },
  history: [
    {
      id: histMardi,
      weekLabel: 'S1 août',
      weekId,
      day: 'mardi',
      dayLabel: 'Mardi',
      conductorId: 'c1',
      conductorPseudo: 'HGS123',
      vipId: 'v1',
      vipPseudo: 'FafaneLeBarbu',
      categoryName: 'Mardi',
      mode: 'Tirage',
      monthKey,
      createdAt: '2026-08-05T10:00:00.000Z',
    },
    {
      id: histMercredi,
      weekLabel: 'S1 août',
      weekId,
      day: 'mercredi',
      dayLabel: 'Mercredi',
      conductorId: 'c2',
      conductorPseudo: 'XalAtath',
      vipId: 'v2',
      vipPseudo: 'Diidine89',
      categoryName: 'Mercredi',
      mode: 'Tirage',
      monthKey,
      createdAt: '2026-08-05T10:00:00.000Z',
    },
  ],
  appliedPlans: {
    [weekId]: {
      monthKey,
      planKey: 'archived',
      deltas: [
        { playerId: 'c1', conductor: 1, vip: 0 },
        { playerId: 'c2', conductor: 1, vip: 0 },
        { playerId: 'v1', conductor: 0, vip: 1 },
        { playerId: 'v2', conductor: 0, vip: 1 },
      ],
      historyIds: [histMardi, histMercredi],
      locked: true,
      closedAt: '2026-08-05T10:00:00.000Z',
    },
  },
  weekArchives: [
    {
      id: 'arch1',
      weekId,
      weekLabel: 'S1 août',
      monthKey,
      days: {
        mardi: {
          dayLabel: 'Mardi',
          conductorId: 'c1',
          conductorPseudo: 'HGS123',
          vipId: 'v1',
          vipPseudo: 'FafaneLeBarbu',
          vipMode: 'tirage',
        },
        mercredi: {
          dayLabel: 'Mercredi',
          conductorId: 'c2',
          conductorPseudo: 'XalAtath',
          vipId: 'v2',
          vipPseudo: 'Diidine89',
          vipMode: 'tirage',
        },
      },
      weekCounters: {},
      notification: '',
    },
  ],
  weeklyPlan: {
    weekId: 'trainweek_current',
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
};

store.data = JSON.stringify(trainState);
Train.hydrateFromStorage();

// Forcer le mois courant pour les tirages VIP
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

console.log('\n=== 1-3. Corriger VIP archivé ===');
assert(Train.getPlayerMonthCounts('v1', monthKey).vip === 1, 'Avant : Fafane VIP=1');
assert(Train.getPlayerMonthCounts('v3', monthKey).vip === 0, 'Avant : orely VIP=0');
assert(Train.getVipIdsThisMonth().has('v1'), 'Avant : Fafane bloqué VIP du mois');
assert(!Train.getVipIdsThisMonth().has('v3'), 'Avant : orely libre VIP');

const vipFix = Train.correctArchivedHistoryRole(histMardi, 'vipId', 'v3');
assert(vipFix.ok === true, 'Correction VIP OK');
assert(Train.getPlayerMonthCounts('v1', monthKey).vip === 0, 'Après : Fafane VIP=0');
assert(Train.getPlayerMonthCounts('v3', monthKey).vip === 1, 'Après : orely VIP=1');
assert(!Train.getVipIdsThisMonth().has('v1'), 'Après : Fafane plus VIP du mois');
assert(Train.getVipIdsThisMonth().has('v3'), 'Après : orely VIP du mois');

const afterVip = JSON.parse(store.data);
const mardiHist = afterVip.history.find((h) => h.id === histMardi);
const mercrediHist = afterVip.history.find((h) => h.id === histMercredi);
assert(mardiHist.vipId === 'v3', 'Mardi historique : nouveau VIP');
assert(mardiHist.vipPseudo === 'orely', 'Mardi historique : pseudo VIP');
assert(mercrediHist.vipId === 'v2', 'Mercredi inchangé (VIP)');
assert(mercrediHist.conductorId === 'c2', 'Mercredi inchangé (Conducteur)');
assert(afterVip.weekArchives[0].days.mardi.vipId === 'v3', 'Snapshot archive Mardi VIP');
assert(afterVip.weekArchives[0].days.mercredi.vipId === 'v2', 'Snapshot Mercredi inchangé');

console.log('\n=== 4-5. Corriger Conducteur archivé ===');
assert(Train.getPlayerMonthCounts('c1', monthKey).conductor === 1, 'Avant : HGS Conducteur=1');
assert(Train.getPlayerMonthCounts('c3', monthKey).conductor === 0, 'Avant : Mertz Conducteur=0');

const condFix = Train.correctArchivedHistoryRole(histMardi, 'conductorId', 'c3');
assert(condFix.ok === true, 'Correction Conducteur OK');
assert(Train.getPlayerMonthCounts('c1', monthKey).conductor === 0, 'Après : HGS Conducteur=0');
assert(Train.getPlayerMonthCounts('c3', monthKey).conductor === 1, 'Après : Mertz Conducteur=1');

const afterCond = JSON.parse(store.data);
const mardi2 = afterCond.history.find((h) => h.id === histMardi);
const mercredi2 = afterCond.history.find((h) => h.id === histMercredi);
assert(mardi2.conductorId === 'c3', 'Mardi historique : nouveau Conducteur');
assert(mercredi2.conductorId === 'c2', 'Mercredi Conducteur inchangé');
assert(mercredi2.vipId === 'v2', 'Mercredi VIP toujours inchangé');
assert(afterCond.weekArchives[0].days.mardi.conductorId === 'c3', 'Snapshot archive Mardi Conducteur');

console.log('\n=== 6. Futurs tirages utilisent les compteurs corrigés ===');
assert(
  !Train.isEligibleForWeekVip(
    players.find((p) => p.id === 'v3'),
    'jeudi'
  ),
  'orely (nouveau VIP mois) non éligible tirage'
);
assert(
  Train.isEligibleForWeekVip(
    players.find((p) => p.id === 'v1'),
    'jeudi'
  ),
  'Fafane (VIP retiré) redevient éligible tirage'
);

console.log('\n=== 7. Permissions ===');
sandbox.ROSProfiles.isActiveR4OrR5 = () => false;
sandbox.ROSProfiles.getAppRole = () => 'Membre';
const denied = Train.correctArchivedHistoryRole(histMercredi, 'vipId', 'v1');
assert(denied.ok === false, 'Sans R4/R5 : correction refusée');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
