/**
 * Quota localStorage : purge ciblée de ros6_backups_v1, budget, sync sans réinjection.
 * node scripts/test-backup-quota.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const backupsCode = fs.readFileSync(path.join(root, 'js/backups.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const storageCode = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

function quotaError() {
  const err = new Error('Quota has been exceeded');
  err.name = 'QuotaExceededError';
  return err;
}

function createMemoryStorage() {
  const data = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    _data: data,
  };
}

const BUSINESS = {
  ros6_command_center_v1: '{"players":[{"id":"p1","pseudo":"Ada"}],"weeks":[]}',
  ros6_train_v1: '{"history":[1],"officialWeeks":[]}',
  ros6_ruche_v1: '{"grid":[["FREE"]],"archives":[]}',
  ros6_tempete_v1: '{"archives":[{"id":"storm-1","mail":"bonjour"}]}',
  ros6_sync_meta_v1: '{"version":42,"savedAt":"2026-10-02T07:00:00.000Z"}',
};

function snapshotBusiness(storage) {
  const out = {};
  Object.keys(BUSINESS).forEach((key) => {
    out[key] = storage.getItem(key);
  });
  return out;
}

function seedBusiness(storage) {
  Object.keys(BUSINESS).forEach((key) => storage.setItem(key, BUSINESS[key]));
}

function loadBackups(storage, extras = {}) {
  const sandbox = {
    console,
    localStorage: storage,
    document: { getElementById: () => null },
    AppUI: extras.AppUI || { toast() {}, confirm: async () => false },
    ...extras,
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(backupsCode, sandbox);
  return sandbox;
}

console.log('\n=== Ordre de démarrage ===');
assert(
  indexHtml.indexOf('js/backups.js') < indexHtml.indexOf('js/app.js'),
  'backups.js est évalué avant app.js'
);
assert(
  backupsCode.indexOf('purgeLegacyLocalBackupsOnce();') < backupsCode.lastIndexOf('global.BackupsModule'),
  'purge à l’évaluation du script, avant l’export'
);
{
  const initFn = syncCode.slice(syncCode.indexOf('function init('), syncCode.indexOf('client.auth.getSession'));
  assert(
    initFn.includes('purgeLegacyBackupsBeforeWrites'),
    'ROSSync.init purge avant l’attente de session'
  );
  const boot = syncCode.slice(
    syncCode.indexOf('async function bootstrapAfterAuth'),
    syncCode.indexOf('function updateUserLabel')
  );
  assert(
    boot.indexOf('purgeLegacyBackupsBeforeWrites') < boot.indexOf('ensureRemoteRow'),
    'purge avant le pull distant'
  );
  const prepAt = boot.indexOf('prepareBootstrapStores');
  assert(
    prepAt > 0 && boot.indexOf('pushToSupabase', prepAt) > prepAt,
    'Train/Ruche/Tempête ambigus sont écartés du push avant l’envoi'
  );
  assert(
    !backupsCode.includes("removeItem('ros6_command_center_v1')") &&
      !backupsCode.includes('removeItem("ros6_command_center_v1")') &&
      !backupsCode.includes("removeItem('ros6_train_v1')") &&
      !backupsCode.includes("removeItem('ros6_sync_meta_v1')"),
    'le code de purge ne retire pas les clés métier ni la meta'
  );
}

console.log('\n=== Ancien ros6_backups_v1 de plusieurs Mo ===');
{
  const storage = createMemoryStorage();
  seedBusiness(storage);
  const huge = `{"version":1,"backups":[{"payload":"${'X'.repeat(1024 * 1024 + 32)}"}]}`;
  storage.setItem('ros6_backups_v1', huge);
  const before = snapshotBusiness(storage);
  const removed = [];
  const origRemove = storage.removeItem.bind(storage);
  storage.removeItem = (key) => {
    removed.push(key);
    origRemove(key);
  };
  const sandbox = loadBackups(storage);
  const B = sandbox.BackupsModule;
  assert(storage.getItem('ros6_backups_v1') == null, 'clé backups supprimée au chargement');
  assert(removed.length === 1 && removed[0] === 'ros6_backups_v1', 'removeItem ne vise que ros6_backups_v1');
  assert(
    JSON.stringify(snapshotBusiness(storage)) === JSON.stringify(before),
    'les 4 stores et la meta sont inchangés'
  );
  assert(storage.getItem(B.LEGACY_PURGE_FLAG) === '1', 'drapeau de migration posé');
  B.UNTOUCHABLE_LOCAL_KEYS.forEach((key) => {
    assert(storage.getItem(key) === BUSINESS[key], `clé protégée intacte : ${key}`);
  });
}

console.log('\n=== Démarrage presque plein : après purge, une écriture métier passe ===');
{
  const storage = createMemoryStorage();
  seedBusiness(storage);
  const limit = 12000;
  storage.setItem('ros6_backups_v1', 'Q'.repeat(1024 * 1024 + 8));
  const before = snapshotBusiness(storage);
  const origSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    const next = { ...storage._data, [key]: String(value) };
    let size = 0;
    Object.keys(next).forEach((k) => {
      size += next[k].length;
    });
    if (size > limit) throw quotaError();
    origSet(key, value);
  };
  let grew = false;
  try {
    storage.setItem('ros6_command_center_v1', `${BUSINESS.ros6_command_center_v1} `);
    grew = true;
  } catch (error) {
    grew = false;
  }
  assert(grew === false, 'avant purge, agrandir le centre de commandement dépasse le quota');
  assert(storage.getItem('ros6_command_center_v1') === BUSINESS.ros6_command_center_v1, 'échec de quota sans écrasement métier');
  loadBackups(storage);
  assert(storage.getItem('ros6_backups_v1') == null, 'purge a retiré le blob');
  assert(JSON.stringify(snapshotBusiness(storage)) === JSON.stringify(before), 'purge sans toucher au métier');
  storage.setItem(
    'ros6_command_center_v1',
    JSON.stringify({ players: [{ id: 'p1', pseudo: 'Ada', note: 'locale non poussée' }], weeks: [] })
  );
  assert(
    storage.getItem('ros6_command_center_v1').includes('locale non poussée'),
    'après purge, l’écriture métier réussit'
  );
}

console.log('\n=== Backup dans le budget conservé ; nouveau backup après nettoyage ===');
{
  const storage = createMemoryStorage();
  seedBusiness(storage);
  const small = JSON.stringify({
    version: 1,
    backups: [{ id: 'keep-me', kind: 'auto', createdAt: '2026-10-01T10:00:00.000Z', size: 2, payload: '{}' }],
  });
  storage.setItem('ros6_backups_v1', small);
  const sandbox = loadBackups(storage);
  const B = sandbox.BackupsModule;
  assert(storage.getItem('ros6_backups_v1') === small, 'une sauvegarde sous le budget n’est pas purgée');
  const created = B.createBackup('manual');
  assert(created.created === true, 'nouveau backup après chargement');
  const raw = storage.getItem('ros6_backups_v1');
  assert(raw && raw.length <= B.MAX_BACKUP_CHARS, 'le nouvel index tient dans 1 Mo');
  assert(raw.includes('keep-me') || B.listBackups().length <= B.MAX_BACKUPS, 'plafond de nombre respecté');
  assert(B.listBackups().length <= B.MAX_BACKUPS, `au plus ${B.MAX_BACKUPS} sauvegardes`);
  assert(B.MAX_BACKUPS === 2, 'plafond à 2 sauvegardes');
  B.UNTOUCHABLE_LOCAL_KEYS.forEach((key) => {
    assert(storage.getItem(key) === BUSINESS[key], `métier non modifié par le backup : ${key}`);
  });
}

console.log('\n=== Pruning par taille et par nombre ===');
{
  const storage = createMemoryStorage();
  const sandbox = loadBackups(storage);
  const B = sandbox.BackupsModule;
  const small = [
    { id: 'old', createdAt: '2026-08-01T00:00:00.000Z', payload: 'a' },
    { id: 'mid', createdAt: '2026-09-01T00:00:00.000Z', payload: 'b' },
    { id: 'new', createdAt: '2026-10-01T00:00:00.000Z', payload: 'c' },
  ];
  const counted = B.selectBackupsWithinBudget(small).map((b) => b.id);
  assert(counted.length === 2 && counted[0] === 'new' && counted[1] === 'mid', 'les 2 plus récentes sont gardées');
  const fat = 'F'.repeat(600 * 1024);
  const sized = B.selectBackupsWithinBudget([
    { id: 'older', createdAt: '2026-09-01T00:00:00.000Z', payload: fat },
    { id: 'newer', createdAt: '2026-10-01T00:00:00.000Z', payload: fat },
  ]).map((b) => b.id);
  assert(sized.length === 1 && sized[0] === 'newer', 'deux snapshots de 600 Ko : seul le plus récent tient dans 1 Mo');
  const giant = B.selectBackupsWithinBudget([
    { id: 'giant', createdAt: '2026-10-02T00:00:00.000Z', payload: 'G'.repeat(B.MAX_BACKUP_CHARS + 10) },
  ]);
  assert(giant.length === 0, 'un snapshot seul au-dessus du budget est abandonné');
}

console.log('\n=== QuotaExceededError : backup abandonné, métier continu ===');
{
  const storage = createMemoryStorage();
  seedBusiness(storage);
  const before = snapshotBusiness(storage);
  const toasts = [];
  const sandbox = loadBackups(storage, {
    AppUI: {
      toast(message) {
        toasts.push(message);
      },
    },
  });
  let backupWrites = 0;
  const origSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === 'ros6_backups_v1') {
      backupWrites += 1;
      throw quotaError();
    }
    origSet(key, value);
  };
  let thrown = false;
  let result = null;
  try {
    result = sandbox.BackupsModule.createBackup('manual');
  } catch (error) {
    thrown = true;
  }
  assert(thrown === false, 'createBackup ne propage pas QuotaExceededError');
  assert(result && result.created === false && result.reason === 'quota', 'sauvegarde abandonnée');
  assert(backupWrites >= 1, 'l’écriture backup a bien été tentée');
  assert(JSON.stringify(snapshotBusiness(storage)) === JSON.stringify(before), 'échec backup : stores métier intactes');
  assert(
    toasts.some((message) => message.includes('données métier ne sont pas touchées')),
    'le toast dit que le métier n’est pas touché'
  );

  const pushed = [];
  sandbox.ROSModels = {
    normalizeState: (state) => state,
    createInitialState: () => ({ players: [] }),
  };
  sandbox.ROSSync = {
    schedulePush(key) {
      pushed.push(key);
    },
  };
  vm.runInContext(storageCode, sandbox);
  sandbox.ROSStorage.update((state) => {
    state.edited = true;
    return state;
  });
  assert(pushed[0] === 'ros6_command_center_v1', 'la modification métier planifie toujours le push');
  assert(
    storage.getItem('ros6_command_center_v1').includes('"edited":true'),
    'la modification métier est écrite malgré l’échec du backup'
  );
  assert(storage.getItem('ros6_train_v1') === BUSINESS.ros6_train_v1, 'Train non touché');
  assert(storage.getItem('ros6_ruche_v1') === BUSINESS.ros6_ruche_v1, 'Ruche non touchée');
  assert(storage.getItem('ros6_tempete_v1') === BUSINESS.ros6_tempete_v1, 'Tempête non touchée');
  assert(storage.getItem('ros6_sync_meta_v1') === BUSINESS.ros6_sync_meta_v1, 'meta de sync non touchée');
}

console.log('\n=== Retry backup après suppression de l’ancienne clé ===');
{
  const storage = createMemoryStorage();
  seedBusiness(storage);
  storage.setItem('ros6_backups_v1', JSON.stringify({ version: 1, backups: [{ id: 'old', payload: 'x' }] }));
  const sandbox = loadBackups(storage);
  let attempts = 0;
  const origSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === 'ros6_backups_v1') {
      attempts += 1;
      if (attempts === 1) throw quotaError();
    }
    origSet(key, value);
  };
  const result = sandbox.BackupsModule.createBackup('manual');
  assert(result.created === true, 'le second essai, après removeItem de la clé backup, réussit');
  assert(attempts === 2, 'une seule nouvelle tentative');
  assert(storage.getItem('ros6_command_center_v1') === BUSINESS.ros6_command_center_v1, 'retry sans modifier le métier');
}

console.log('\n=== Snapshot trop gros abandonné sans réécriture ===');
{
  const storage = createMemoryStorage();
  seedBusiness(storage);
  storage.setItem('ros6_command_center_v1', 'C'.repeat(1024 * 1024 + 100));
  const cc = storage.getItem('ros6_command_center_v1');
  const sandbox = loadBackups(storage);
  const result = sandbox.BackupsModule.createBackup('manual');
  assert(result.created === false && result.reason === 'too-large', 'snapshot au-dessus de 1 Mo abandonné');
  assert(storage.getItem('ros6_backups_v1') == null, 'aucune clé backup écrite');
  assert(storage.getItem('ros6_command_center_v1') === cc, 'le store métier trop gros pour un backup reste en place');
}

console.log('\n=== Push, rebase, apply : pas de réinjection ===');
{
  const storage = createMemoryStorage();
  storage.setItem('ros6_command_center_v1', JSON.stringify({ version: 1, players: [{ id: 'p1', pseudo: 'Local' }] }));
  storage.setItem('ros6_train_v1', JSON.stringify({ week: 'local-train' }));
  storage.setItem('ros6_ruche_v1', JSON.stringify({ grid: [['LOCAL']] }));
  storage.setItem('ros6_tempete_v1', JSON.stringify({ archives: ['local-storm'] }));
  storage.setItem('ros6_backups_v1', 'LOCAL_BACKUP');
  const marker = `REMOTE_BACKUP_${'Z'.repeat(200000)}`;
  const remoteData = {
    stores: {
      ros6_command_center_v1: { version: 1, players: [{ id: 'p1', pseudo: 'Remote' }] },
      ros6_train_v1: { week: 'remote-train' },
      ros6_ruche_v1: { grid: [['REMOTE']] },
      ros6_tempete_v1: { archives: ['remote-storm'] },
      ros6_backups_v1: { version: 1, backups: [{ id: 'remote_only', payload: marker }] },
      ros6_other_legacy_v1: { keep: true },
    },
  };
  const sandbox = {
    console,
    localStorage: storage,
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    navigator: { onLine: true },
    ROSSupabase: { getClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) } }) },
    AppUI: { toast() {}, confirm: async () => false },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(syncCode, sandbox);
  const T = sandbox.ROSSync.__test;
  const before = snapshotBusiness(storage);
  const differing = T.listDifferingStoreKeys(remoteData);
  assert(
    JSON.stringify(snapshotBusiness(storage)) === JSON.stringify(before),
    'la comparaison local/distant n’écrit rien'
  );
  assert(differing.includes('ros6_command_center_v1'), 'écart métier détecté');
  assert(!differing.includes('ros6_backups_v1'), 'les backups ne comptent pas comme store à préserver');

  storage.setItem('ros6_command_center_v1', JSON.stringify({ z: 1, a: 2 }));
  const reordered = T.listDifferingStoreKeys({
    stores: { ros6_command_center_v1: { a: 2, z: 1 } },
  });
  assert(!reordered.includes('ros6_command_center_v1'), 'un simple ordre de clés n’est pas un écart');

  const plan = T.planBootstrapAction({
    remoteVersion: 42,
    localVersion: 42,
    differingKeys: ['ros6_command_center_v1', 'ros6_backups_v1'],
  });
  assert(plan.mode === 'preserve-local-and-push', 'version égale et métier différent : push local, pas d’écrasement');
  assert(
    plan.differing.length === 1 && plan.differing[0] === 'ros6_command_center_v1',
    'seule la clé métier divergente est à pousser'
  );
  assert(
    T.planBootstrapAction({ remoteVersion: 10, localVersion: 0, differingKeys: ['ros6_train_v1'] }).mode ===
      'apply-remote',
    'version locale 0 : le distant reste la source (pas de push d’un cache non versionné)'
  );
  assert(
    T.planBootstrapAction({ remoteVersion: 7, localVersion: 9, differingKeys: [] }).mode === 'remote-older',
    'distant plus ancien : confirmation existante'
  );
  assert(
    T.planBootstrapAction({ remoteVersion: 50, localVersion: 50, differingKeys: [] }).mode === 'apply-remote',
    'contenu identique : appliquer le distant est sans perte'
  );
  const newerTempete = T.planBootstrapAction({
    remoteVersion: 51,
    localVersion: 50,
    differingKeys: ['ros6_tempete_v1'],
  });
  assert(newerTempete.mode === 'apply-remote', 'distant plus récent : on n’envoie pas l’ancienne Tempête');
  assert(!newerTempete.pushKeys.includes('ros6_tempete_v1'), 'Tempête absente des clés à pousser');
  assert(
    newerTempete.adoptRemoteKeys.includes('ros6_tempete_v1'),
    'l’ancienne Tempête est remplacée par le distant, pas poussée'
  );

  const localCc = { version: 1, players: [{ id: 'p1', pseudo: 'LocalEdit' }] };
  const pushed = T.buildPushPayload(remoteData, new Set(['ros6_command_center_v1']), {
    ros6_command_center_v1: localCc,
    ros6_train_v1: { week: 'local-train' },
  });
  const pushedText = JSON.stringify(pushed);
  assert(!Object.prototype.hasOwnProperty.call(pushed.stores, 'ros6_backups_v1'), 'payload sans ros6_backups_v1');
  assert(!pushedText.includes(marker), 'les 200 Ko de backup distant ne sont pas transportés');
  assert(pushed.stores.ros6_command_center_v1.players[0].pseudo === 'LocalEdit', 'édition locale présente dans le push');
  assert(pushed.stores.ros6_train_v1.week === 'remote-train', 'train non dirty reste le distant');
  assert(pushed.stores.ros6_other_legacy_v1.keep === true, 'une autre clé héritée non backup est conservée');

  storage.setItem('ros6_ruche_v1', JSON.stringify({ grid: [['LOCAL']] }));
  const rebased = T.rebaseLocalAfterRemote(remoteData, new Set(['ros6_ruche_v1']));
  assert(!Object.prototype.hasOwnProperty.call(rebased.stores, 'ros6_backups_v1'), 'rebase sans backups');
  assert(!JSON.stringify(rebased).includes(marker), 'rebase ne réinjecte pas le blob');
  assert(rebased.stores.ros6_ruche_v1.grid[0][0] === 'LOCAL', 'store dirty local conservé au rebase');
  assert(rebased.stores.ros6_train_v1.week === 'remote-train', 'store non dirty pris du distant');

  const ccBeforeApply = storage.getItem('ros6_command_center_v1');
  T.applyStoresToLocal(remoteData, { reload: false });
  assert(storage.getItem('ros6_backups_v1') === 'LOCAL_BACKUP', 'apply ne réimporte pas les backups distants');
  assert(storage.getItem('ros6_command_center_v1') !== ccBeforeApply, 'apply écrit bien le store métier distant');
  assert(
    JSON.parse(storage.getItem('ros6_command_center_v1')).players[0].pseudo === 'Remote',
    'le centre de commandement distant est appliqué'
  );
  assert(
    JSON.parse(storage.getItem('ros6_tempete_v1')).archives[0] === 'remote-storm',
    'Tempête distante appliquée sans passer par les backups'
  );
}

function loadSync(storage) {
  const sandbox = {
    console,
    localStorage: storage,
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    navigator: { onLine: true },
    ROSSupabase: {
      getClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) } }),
    },
    AppUI: { toast() {}, confirm: async () => false },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(syncCode, sandbox);
  return sandbox.ROSSync.__test;
}

function moduleRemote(overrides) {
  return {
    stores: {
      ros6_command_center_v1: { players: [{ id: 'p1' }] },
      ros6_train_v1: { week: 'remote-train' },
      ros6_ruche_v1: { grid: 'remote-ruche' },
      ros6_tempete_v1: { archives: ['remote-storm'] },
      ...overrides,
    },
  };
}

console.log('\n=== Modules : distant plus récent ne se fait pas écraser ===');
['ros6_train_v1', 'ros6_ruche_v1', 'ros6_tempete_v1'].forEach((key) => {
  const storage = createMemoryStorage();
  storage.setItem('ros6_command_center_v1', JSON.stringify({ players: [{ id: 'p1' }] }));
  storage.setItem('ros6_train_v1', JSON.stringify({ week: 'remote-train' }));
  storage.setItem('ros6_ruche_v1', JSON.stringify({ grid: 'remote-ruche' }));
  storage.setItem('ros6_tempete_v1', JSON.stringify({ archives: ['remote-storm'] }));
  const stale = JSON.stringify({ stale: key, at: 'old-cache' });
  storage.setItem(key, stale);
  const remote = moduleRemote();
  const T = loadSync(storage);
  const plan = T.planBootstrapAction({
    remoteVersion: 200,
    localVersion: 180,
    differingKeys: T.listDifferingStoreKeys(remote),
  });
  assert(!plan.pushKeys.includes(key), `${key} : pas poussé par-dessus un document plus récent`);
  const prepared = T.prepareBootstrapStores(remote, plan, { remoteVersion: 200, localVersion: 180 });
  assert(!prepared.pushKeys.includes(key), `${key} : le prepare ne le marque pas à envoyer`);
  const payload = T.buildPushPayload(remote, new Set(prepared.pushKeys));
  assert(!JSON.stringify(payload).includes('old-cache'), `${key} : l’ancien cache est absent du payload`);
  assert(!JSON.stringify(payload).includes(stale.slice(0, 20)) || !payload.stores[key] || !JSON.stringify(payload.stores[key]).includes('old-cache'), `${key} : payload module = distant`);
  assert(!JSON.stringify(payload.stores[key]).includes('old-cache'), `${key} : le store du payload est le distant`);
  const hold = JSON.parse(storage.getItem(T.MODULE_HOLD_KEY));
  assert(hold.stores[key] === stale, `${key} : l’ancien cache est conservé hors sync`);
  assert(!JSON.stringify(payload).includes(T.MODULE_HOLD_KEY) || !payload.stores[T.MODULE_HOLD_KEY], `${key} : la mise de côté n’est pas envoyée`);
  assert(!Object.prototype.hasOwnProperty.call(payload.stores, T.MODULE_HOLD_KEY), `${key} : hold absent du payload`);
});

console.log('\n=== Vraie édition locale identifiable ===');
{
  const storage = createMemoryStorage();
  const localTrain = JSON.stringify({ week: 'edit-non-poussee' });
  storage.setItem('ros6_command_center_v1', JSON.stringify({ players: [{ id: 'p1' }] }));
  storage.setItem('ros6_train_v1', localTrain);
  storage.setItem('ros6_ruche_v1', JSON.stringify({ grid: 'remote-ruche' }));
  storage.setItem('ros6_tempete_v1', JSON.stringify({ archives: ['remote-storm'] }));
  const remote = moduleRemote();
  const T = loadSync(storage);
  const plan = T.planBootstrapAction({
    remoteVersion: 180,
    localVersion: 180,
    differingKeys: T.listDifferingStoreKeys(remote),
  });
  assert(plan.pushKeys.includes('ros6_train_v1'), 'versions égales : le Train local est une édition à pousser');
  assert(plan.adoptRemoteKeys.length === 0, 'on ne remplace pas cette édition par le distant');
  const prepared = T.prepareBootstrapStores(remote, plan, { remoteVersion: 180, localVersion: 180 });
  assert(storage.getItem('ros6_train_v1') === localTrain, 'prepare ne détruit pas l’édition non poussée');
  const payload = T.buildPushPayload(remote, new Set(prepared.pushKeys));
  assert(payload.stores.ros6_train_v1.week === 'edit-non-poussee', 'le push emporte l’édition Train');
  assert(payload.stores.ros6_ruche_v1.grid === 'remote-ruche', 'la Ruche identique reste le distant');
}

console.log('\n=== Redémarrage après adoption : plus d’écrasement ===');
{
  const storage = createMemoryStorage();
  storage.setItem('ros6_command_center_v1', JSON.stringify({ players: [{ id: 'p1' }] }));
  storage.setItem('ros6_train_v1', JSON.stringify({ week: 'old-cache' }));
  storage.setItem('ros6_ruche_v1', JSON.stringify({ grid: 'remote-ruche' }));
  storage.setItem('ros6_tempete_v1', JSON.stringify({ archives: ['remote-storm'] }));
  const remote = moduleRemote();
  const T = loadSync(storage);
  const first = T.planBootstrapAction({
    remoteVersion: 200,
    localVersion: 180,
    differingKeys: T.listDifferingStoreKeys(remote),
  });
  T.prepareBootstrapStores(remote, first, { remoteVersion: 200, localVersion: 180 });
  const second = T.planBootstrapAction({
    remoteVersion: 200,
    localVersion: 200,
    differingKeys: T.listDifferingStoreKeys(remote),
  });
  assert(second.pushKeys.length === 0, 'au redémarrage le Train adopté n’est pas renvoyé');
  assert(!JSON.stringify(storage.getItem('ros6_train_v1')).includes('old-cache'), 'le cache actif est le distant');
  const hold = JSON.parse(storage.getItem(T.MODULE_HOLD_KEY));
  assert(hold.stores.ros6_train_v1.includes('old-cache'), 'l’ancien Train reste dans la mise de côté');
}

console.log('\n=== Échec après purge : on garde ce qui doit rester local ===');
{
  const storage = createMemoryStorage();
  const localTrain = JSON.stringify({ week: 'edit-non-poussee' });
  storage.setItem('ros6_command_center_v1', JSON.stringify({ players: [{ id: 'p1' }] }));
  storage.setItem('ros6_train_v1', localTrain);
  storage.setItem('ros6_ruche_v1', JSON.stringify({ grid: 'remote-ruche' }));
  storage.setItem('ros6_tempete_v1', JSON.stringify({ archives: ['remote-storm'] }));
  const remote = moduleRemote();
  const T = loadSync(storage);
  const plan = T.planBootstrapAction({
    remoteVersion: 180,
    localVersion: 180,
    differingKeys: T.listDifferingStoreKeys(remote),
  });
  T.prepareBootstrapStores(remote, plan, { remoteVersion: 180, localVersion: 180 });
  assert(storage.getItem('ros6_train_v1') === localTrain, 'push non abouti : l’édition Train est toujours locale');

  const stale = JSON.stringify({ week: 'old-cache' });
  storage.setItem('ros6_train_v1', stale);
  const origSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === 'ros6_module_hold_v1') throw quotaError();
    origSet(key, value);
  };
  const blocked = T.planBootstrapAction({
    remoteVersion: 200,
    localVersion: 180,
    differingKeys: ['ros6_train_v1'],
  });
  const prepared = T.prepareBootstrapStores(remote, blocked, { remoteVersion: 200, localVersion: 180 });
  assert(prepared.holdOk === false, 'mise de côté impossible signalée');
  assert(!prepared.pushKeys.includes('ros6_train_v1'), 'sans mise de côté, le vieux Train n’est pas poussé');
  assert(storage.getItem('ros6_train_v1') === stale, 'sans mise de côté, le cache local n’est pas détruit');
}

console.log('\n=== Purge backups seule, pendant ces scénarios ===');
{
  const storage = createMemoryStorage();
  seedBusiness(storage);
  storage.setItem('ros6_backups_v1', 'B'.repeat(1024 * 1024 + 20));
  const before = snapshotBusiness(storage);
  const removed = [];
  const origRemove = storage.removeItem.bind(storage);
  storage.removeItem = (key) => {
    removed.push(key);
    origRemove(key);
  };
  loadBackups(storage);
  assert(removed.every((key) => key === 'ros6_backups_v1'), 'seule la clé backups est retirée');
  assert(JSON.stringify(snapshotBusiness(storage)) === JSON.stringify(before), 'les stores métier survivent à la purge');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
