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
assert(
  !backupsCode.includes("schedulePush('ros6_backups_v1')"),
  'backups ne poussent plus vers Supabase'
);
{
  const m = syncCode.match(/const STORE_KEYS = \[([\s\S]*?)\];/);
  assert(m && !m[1].includes('ros6_backups_v1'), 'STORE_KEYS exclut ros6_backups_v1');
  assert(m && m[1].includes('ros6_command_center_v1'), 'STORE_KEYS inclut command center');
  assert(m && m[1].includes('ros6_train_v1'), 'STORE_KEYS inclut train');
  assert(m && m[1].includes('ros6_ruche_v1'), 'STORE_KEYS inclut ruche');
  assert(m && m[1].includes('ros6_tempete_v1'), 'STORE_KEYS inclut tempete');
}
assert(syncCode.includes('isQuotaExceededError'), 'détection quota localStorage');
assert(syncCode.includes('LOCAL_QUOTA_USER_MESSAGE'), 'message quota utilisateur');
assert(syncCode.includes('remoteSaved: true'), 'quota après push distant OK');
assert(backupsCode.includes('getLocalBackupsStats'), 'stats taille backups locaux');
assert(backupsCode.includes('hors synchronisation Supabase'), 'libellé hors sync UI');
assert(!rucheCode.includes('schedulePush()'), 'ruche n’appelle plus schedulePush() sans clé');
assert(syncCode.includes("syncMode: 'scoped'"), 'payload syncMode scoped');
assert(syncCode.includes('mergeCommandCenterStore'), 'merge command center');
assert(syncCode.includes('markPlayerFieldCleared'), 'clear volontaire exposé');
assert(!syncCode.includes('protectPlayersGlobalPowers'), 'protection PG retirée');
assert(!syncCode.includes('shouldBlockDestructiveGlobalPowerOverwrite'), 'blocage PG retiré');

const CONTROL_SEVEN = [
  { id: 'player_msbm3azj_fvtdgr', pseudo: 'Agent0003', heroPowerTierId: 'tier_40_45' },
  { id: 'player_msbm3azj_wjof3n', pseudo: 'francky89', heroPowerTierId: 'tier_35_40' },
  { id: 'player_msbm3azj_6pop2n', pseudo: 'Jean 76', heroPowerTierId: 'tier_30_35' },
  { id: 'player_msbm3azj_e9tbm5', pseudo: 'Loukas27', heroPowerTierId: 'tier_40_45' },
  { id: 'player_msbm3azj_dgcx0x', pseudo: 'Pilgrim0216', heroPowerTierId: 'tier_45_50' },
  { id: 'player_msbm3azj_codwa6', pseudo: 'Raiden 05', heroPowerTierId: 'tier_40_45' },
  { id: 'player_msbm3azj_4xc2sb', pseudo: 'Vortese', heroPowerTierId: 'tier_30_35' },
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
assert(!T.PROTECTED_NONEMPTY_PLAYER_FIELDS.includes('globalPowerTierId'), 'PG hors champs protégés');

console.log('\n=== Protection merge joueur ===');
const remoteP = {
  id: 'p1',
  pseudo: 'Alpha',
  role: 'Membre',
  status: 'Actif',
  heroPowerTierId: 'tier_40_45',
};
const localStale = {
  id: 'p1',
  pseudo: 'Alpha',
  role: 'Membre',
  status: 'Actif',
  heroPowerTierId: null,
};
const mergedKeep = T.mergePlayerRecord(remoteP, localStale);
assert(mergedKeep.heroPowerTierId === 'tier_40_45', 'null local n’écrase pas héros distant');

const localClear = {
  ...localStale,
  heroPowerTierId: null,
  syncClears: { heroPowerTierId: Date.now() },
};
const mergedClear = T.mergePlayerRecord(remoteP, localClear);
assert(mergedClear.heroPowerTierId == null, 'clear volontaire autorisé');
assert(!mergedClear.syncClears, 'meta syncClears retirée du résultat');

const localEdit = { ...remoteP, role: 'R4', heroPowerTierId: 'tier_50_55' };
const mergedEdit = T.mergePlayerRecord(remoteP, localEdit);
assert(mergedEdit.role === 'R4' && mergedEdit.heroPowerTierId === 'tier_50_55', 'édition locale membres conserve');

console.log('\n=== Push Ruche ne touche pas les puissances héros ===');
const remoteData = {
  stores: {
    ros6_command_center_v1: {
      version: 1,
      players: CONTROL_SEVEN.map((p) => ({ ...p, role: 'Membre', status: 'Actif' })),
    },
    ros6_ruche_v1: { version: 5, grid: [['FREE']], proposal: null },
    ros6_train_v1: { week: 'old' },
    ros6_backups_v1: { version: 1, backups: [{ id: 'remote_only', kind: 'auto', payload: '{}' }] },
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
    return p && p.heroPowerTierId === c.heroPowerTierId;
  }),
  'les 7 heroPower intactes après push ruche (même si local CC incomplet)'
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
    return p && p.heroPowerTierId === c.heroPowerTierId;
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
        heroPowerTierId: null, // cache incomplet
      })),
      weeks: [{ id: 'w1' }],
    },
  }
);
assert(
  CONTROL_SEVEN.every((c) => {
    const p = afterVs.stores.ros6_command_center_v1.players.find((x) => x.id === c.id);
    return p && p.heroPowerTierId === c.heroPowerTierId;
  }),
  'merge CC : null local ne détruit pas les 7 même si CC dirty'
);
assert(afterVs.stores.ros6_command_center_v1.weeks[0].id === 'w1', 'édition VS/weeks locale conservée');

console.log('\n=== Rebase conflit ===');
const rebased = T.rebaseLocalAfterRemote(remoteData, new Set(['ros6_ruche_v1']));
assert(
  rebased.stores.ros6_command_center_v1.players[0].heroPowerTierId === 'tier_40_45',
  'rebase : CC non dirty = remote (puissances héros conservées)'
);

console.log('\n=== Backups hors sync ===');
assert(!Sync.STORE_KEYS.includes('ros6_backups_v1'), 'STORE_KEYS runtime sans backups');
assert(Sync.BACKUPS_KEY === 'ros6_backups_v1', 'BACKUPS_KEY exposé');
assert(T.markDirty('ros6_backups_v1') === false, 'markDirty backups → false');
assert(!T.pendingDirty.has('ros6_backups_v1'), 'pendingDirty sans backups');

const afterRucheKeepsRemoteBackups = T.buildPushPayload(
  remoteData,
  new Set(['ros6_ruche_v1']),
  localIncompleteMembers
);
assert(
  afterRucheKeepsRemoteBackups.stores.ros6_backups_v1?.backups?.[0]?.id === 'remote_only',
  'push métier ne touche pas ros6_backups_v1 distant'
);

console.log('\n=== Quota localStorage ===');
assert(typeof T.isQuotaExceededError === 'function', 'isQuotaExceededError exposé');
assert(T.isQuotaExceededError({ name: 'QuotaExceededError' }), 'détecte QuotaExceededError');
assert(
  T.isQuotaExceededError({ message: 'Quota has been exceeded' }),
  'détecte message quota exceeded'
);
assert(!T.isQuotaExceededError({ message: 'network' }), 'ignore erreurs réseau');
assert(
  typeof T.LOCAL_QUOTA_USER_MESSAGE === 'string' && T.LOCAL_QUOTA_USER_MESSAGE.includes('local'),
  'message quota clair'
);

sandbox.localStorage.setItem = () => {
  const err = new Error('Quota has been exceeded');
  err.name = 'QuotaExceededError';
  throw err;
};
const quotaResult = T.safeLocalStorageSetItem('k', 'v');
assert(quotaResult && quotaResult.ok === false && quotaResult.quota === true, 'safeLocalStorageSetItem → quota');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
