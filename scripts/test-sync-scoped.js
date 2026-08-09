/**
 * Tests synchronisation ciblée par module + protection des champs membres.
 * node scripts/test-sync-scoped.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const storageCode = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const rucheCode = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');
const trainCode = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');
const tempeteCode = fs.readFileSync(path.join(root, 'js/tempete.js'), 'utf8');
const backupsCode = fs.readFileSync(path.join(root, 'js/backups.js'), 'utf8');

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

console.log('\n=== Appels schedulePush ciblés ===');
assert(storageCode.includes("schedulePush('ros6_command_center_v1')"), 'storage → command center');
assert(rucheCode.includes("schedulePush('ros6_ruche_v1')"), 'ruche → ruche only');
assert(trainCode.includes("schedulePush('ros6_train_v1')"), 'train → train only');
assert(tempeteCode.includes("schedulePush('ros6_tempete_v1')"), 'tempete → tempete only');
assert(backupsCode.includes("schedulePush('ros6_backups_v1')"), 'backups → backups only');
assert(!rucheCode.includes('schedulePush()'), 'ruche n’appelle plus schedulePush() sans clé');
assert(syncCode.includes("syncMode: 'scoped'"), 'payload syncMode scoped');
assert(syncCode.includes('mergeCommandCenterStore'), 'merge command center');
assert(syncCode.includes('markPlayerFieldCleared'), 'clear volontaire exposé');

const CONTROL_SEVEN = [
  { id: 'player_msbm3azj_fvtdgr', pseudo: 'Agent0003', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_wjof3n', pseudo: 'francky89', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_6pop2n', pseudo: 'Jean 76', globalPowerTierId: 'gp_55_60' },
  { id: 'player_msbm3azj_e9tbm5', pseudo: 'Loukas27', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_dgcx0x', pseudo: 'Pilgrim0216', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_codwa6', pseudo: 'Raiden 05', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_4xc2sb', pseudo: 'Vortese', globalPowerTierId: 'gp_55_60' },
];

const sandbox = {
  window: {},
  console,
  localStorage: {
    _d: {},
    getItem(k) {
      return this._d[k] ?? null;
    },
    setItem(k, v) {
      this._d[k] = String(v);
    },
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
  },
  navigator: { onLine: true },
  ROSSupabase: { getClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) } }) },
  AppUI: { toast() {}, confirm: async () => false },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(syncCode, sandbox);
const Sync = sandbox.window.ROSSync;
const T = Sync.__test;

console.log('\n=== Protection merge joueur ===');
const remoteP = {
  id: 'p1',
  pseudo: 'Alpha',
  role: 'Membre',
  status: 'Actif',
  globalPowerTierId: 'gp_60_65',
  heroPowerTierId: 'tier_40_45',
};
const localStale = {
  id: 'p1',
  pseudo: 'Alpha',
  role: 'Membre',
  status: 'Actif',
  globalPowerTierId: null,
  heroPowerTierId: 'tier_40_45',
};
const mergedKeep = T.mergePlayerRecord(remoteP, localStale);
assert(mergedKeep.globalPowerTierId === 'gp_60_65', 'null local n’écrase pas global distant');

const localClear = {
  ...localStale,
  globalPowerTierId: null,
  syncClears: { globalPowerTierId: Date.now() },
};
const mergedClear = T.mergePlayerRecord(remoteP, localClear);
assert(mergedClear.globalPowerTierId == null, 'clear volontaire autorisé');
assert(!mergedClear.syncClears, 'meta syncClears retirée du résultat');

const localEdit = { ...remoteP, role: 'R4', globalPowerTierId: 'gp_90_95' };
const mergedEdit = T.mergePlayerRecord(remoteP, localEdit);
assert(mergedEdit.role === 'R4' && mergedEdit.globalPowerTierId === 'gp_90_95', 'édition locale membres conserve');

console.log('\n=== Push Ruche ne touche pas les 7 puissances ===');
const remoteData = {
  stores: {
    ros6_command_center_v1: {
      version: 1,
      players: CONTROL_SEVEN.map((p) => ({ ...p, role: 'Membre', status: 'Actif' })),
    },
    ros6_ruche_v1: { version: 5, grid: [['FREE']], proposal: null },
    ros6_train_v1: { week: 'old' },
  },
};
const localIncompleteMembers = {
  ros6_command_center_v1: {
    version: 1,
    players: CONTROL_SEVEN.map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      role: 'Membre',
      status: 'Actif',
      globalPowerTierId: null,
      heroPowerTierId: null,
    })),
  },
  ros6_ruche_v1: { version: 5, grid: [['NEW']], proposal: { mode: 'soft' } },
  ros6_train_v1: { week: 'old' },
};

const afterRuche = T.buildPushPayload(remoteData, new Set(['ros6_ruche_v1']), localIncompleteMembers);
const playersAfterRuche = afterRuche.stores.ros6_command_center_v1.players;
assert(afterRuche.stores.ros6_ruche_v1.grid[0][0] === 'NEW', 'ruche locale poussée');
assert(afterRuche.stores.ros6_train_v1.week === 'old', 'train distant intact');
assert(
  CONTROL_SEVEN.every((c) => {
    const p = playersAfterRuche.find((x) => x.id === c.id);
    return p && p.globalPowerTierId === c.globalPowerTierId;
  }),
  'les 7 globalPower intactes après push ruche (même si local CC incomplet)'
);

console.log('\n=== Push Train / VS(command) ===');
const afterTrain = T.buildPushPayload(
  remoteData,
  new Set(['ros6_train_v1']),
  { ...localIncompleteMembers, ros6_train_v1: { week: 'new-train' } }
);
assert(afterTrain.stores.ros6_train_v1.week === 'new-train', 'train local poussé');
assert(
  CONTROL_SEVEN.every((c) => {
    const p = afterTrain.stores.ros6_command_center_v1.players.find((x) => x.id === c.id);
    return p && p.globalPowerTierId === c.globalPowerTierId;
  }),
  'les 7 intactes après push train'
);

const afterVs = T.buildPushPayload(
  remoteData,
  new Set(['ros6_command_center_v1']),
  {
    ros6_command_center_v1: {
      version: 1,
      players: CONTROL_SEVEN.map((p) => ({
        ...p,
        role: 'Membre',
        status: 'Actif',
        globalPowerTierId: null, // cache incomplet
      })),
      weeks: [{ id: 'w1' }],
    },
  }
);
assert(
  CONTROL_SEVEN.every((c) => {
    const p = afterVs.stores.ros6_command_center_v1.players.find((x) => x.id === c.id);
    return p && p.globalPowerTierId === c.globalPowerTierId;
  }),
  'merge CC : null local ne détruit pas les 7 même si CC dirty'
);
assert(afterVs.stores.ros6_command_center_v1.weeks[0].id === 'w1', 'édition VS/weeks locale conservée');

console.log('\n=== Rebase conflit ===');
const rebased = T.rebaseLocalAfterRemote(remoteData, new Set(['ros6_ruche_v1']));
// rebaseLocalAfterRemote uses getLocalStore — in sandbox localStorage empty for ruche
// So we only assert command center comes from remote when not dirty
assert(
  rebased.stores.ros6_command_center_v1.players[0].globalPowerTierId === 'gp_60_65',
  'rebase : CC non dirty = remote (puissances conservées)'
);

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
