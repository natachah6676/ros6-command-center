/**
 * Tests A–G : protection Puissances globales + sync scoped + multi-clients.
 * node scripts/test-sync-global-power-harden.js
 *
 * Aucune donnée live n’est touchée (simulation pure en mémoire / vm).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const storageCode = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const rucheCode = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');
const trainCode = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');
const playersCode = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const backupsCode = fs.readFileSync(path.join(root, 'js/backups.js'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');

let passed = 0;
let failed = 0;
const results = [];

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    results.push({ ok: true, msg });
    console.log('  ✓', msg);
  } else {
    failed += 1;
    results.push({ ok: false, msg });
    console.error('  ✗', msg);
  }
}

const CONTROL = [
  { id: 'player_msbm3azj_fvtdgr', pseudo: 'Agent0003', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_wjof3n', pseudo: 'francky89', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_6pop2n', pseudo: 'Jean 76', globalPowerTierId: 'gp_55_60' },
  { id: 'player_msbm3azj_e9tbm5', pseudo: 'Loukas27', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_dgcx0x', pseudo: 'Pilgrim0216', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_codwa6', pseudo: 'Raiden 05', globalPowerTierId: 'gp_60_65' },
  { id: 'player_msbm3azj_4xc2sb', pseudo: 'Vortese', globalPowerTierId: 'gp_55_60' },
];

function loadSync() {
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
      removeItem(k) {
        delete this._d[k];
      },
    },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      addEventListener() {},
    },
    navigator: { onLine: true },
    ROSSupabase: {
      getClient: () => ({
        auth: {
          onAuthStateChange() {},
          getSession: async () => ({ data: {} }),
        },
      }),
    },
    AppUI: { toast() {}, confirm: async () => false },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(syncCode, sandbox);
  return sandbox.window.ROSSync;
}

function gpMap(players) {
  const m = {};
  (players || []).forEach((p) => {
    if (p?.id) m[p.id] = p.globalPowerTierId || null;
  });
  return m;
}

function allControlIntact(players, label) {
  return CONTROL.every((c) => {
    const p = (players || []).find((x) => x.id === c.id);
    return p && p.globalPowerTierId === c.globalPowerTierId;
  });
}

const Sync = loadSync();
const T = Sync.__test;

const remoteData = {
  stores: {
    ros6_command_center_v1: {
      version: 1,
      players: CONTROL.map((p) => ({
        ...p,
        role: 'Membre',
        status: 'Actif',
        heroPowerTierId: 'tier_40_45',
      })),
      weeks: [{ id: 'w-remote', label: 'S1' }],
      globalPowerAudit: [],
    },
    ros6_ruche_v1: { version: 1, grid: [['OLD']], proposal: null },
    ros6_train_v1: { week: 'old-train' },
    ros6_tempete_v1: { storms: [] },
    ros6_backups_v1: { backups: [] },
  },
};

const staleLocalCC = {
  version: 1,
  players: CONTROL.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    role: 'Membre',
    status: 'Actif',
    globalPowerTierId: null,
    heroPowerTierId: null,
  })),
  weeks: [{ id: 'w-local', label: 'S-local' }],
  globalPowerAudit: [],
};

console.log('\n=== Wiring (scoped + API) ===');
assert(rucheCode.includes("schedulePush('ros6_ruche_v1')"), 'Ruche → store ruche only');
assert(trainCode.includes("schedulePush('ros6_train_v1')"), 'Train → store train only');
assert(storageCode.includes("schedulePush('ros6_command_center_v1')"), 'Storage → command center');
assert(playersCode.includes('function clearGlobalPowerTier'), 'clearGlobalPowerTier présent');
assert(playersCode.includes('function setGlobalPowerTier'), 'setGlobalPowerTier présent');
assert(playersCode.includes('appendGlobalPowerAudit'), 'audit GP présent');
assert(modelsCode.includes('globalPowerAudit'), 'globalPowerAudit dans models');
assert(syncCode.includes('shouldBlockDestructiveGlobalPowerOverwrite'), 'blocage force GP');
assert(syncCode.includes('protectPlayersGlobalPowers'), 'protectPlayersGlobalPowers');
assert(appCode.includes('Attention Puissances globales'), 'import avertit sur PG');
assert(backupsCode.includes('protectPlayersGlobalPowers'), 'restore protège PG');

console.log('\n=== TEST A — modifier Ruche → PG intactes ===');
{
  const local = {
    ros6_command_center_v1: staleLocalCC,
    ros6_ruche_v1: { version: 2, grid: [['NEW']], proposal: { mode: 'soft' } },
    ros6_train_v1: remoteData.stores.ros6_train_v1,
  };
  const payload = T.buildPushPayload(remoteData, new Set(['ros6_ruche_v1']), local);
  assert(payload.stores.ros6_ruche_v1.grid[0][0] === 'NEW', 'A: ruche poussée');
  assert(
    allControlIntact(payload.stores.ros6_command_center_v1.players),
    'A: 7 PG inchangées après push Ruche (cache local sans PG)'
  );
}

console.log('\n=== TEST B — modifier Train → PG intactes ===');
{
  const local = {
    ros6_command_center_v1: staleLocalCC,
    ros6_ruche_v1: remoteData.stores.ros6_ruche_v1,
    ros6_train_v1: { week: 'new-train' },
  };
  const payload = T.buildPushPayload(remoteData, new Set(['ros6_train_v1']), local);
  assert(payload.stores.ros6_train_v1.week === 'new-train', 'B: train poussé');
  assert(
    allControlIntact(payload.stores.ros6_command_center_v1.players),
    'B: 7 PG inchangées après push Train'
  );
}

console.log('\n=== TEST C — autre store (Tempête) → PG intactes ===');
{
  const local = {
    ros6_command_center_v1: staleLocalCC,
    ros6_tempete_v1: { storms: [{ id: 's1' }] },
  };
  const payload = T.buildPushPayload(remoteData, new Set(['ros6_tempete_v1']), local);
  assert(payload.stores.ros6_tempete_v1.storms[0].id === 's1', 'C: tempête poussée');
  assert(
    allControlIntact(payload.stores.ros6_command_center_v1.players),
    'C: 7 PG inchangées après push Tempête'
  );
}

console.log('\n=== TEST D — modification volontaire PG ===');
{
  const localCC = {
    ...JSON.parse(JSON.stringify(remoteData.stores.ros6_command_center_v1)),
    players: remoteData.stores.ros6_command_center_v1.players.map((p) =>
      p.id === CONTROL[0].id ? { ...p, globalPowerTierId: 'gp_90_95' } : { ...p }
    ),
    globalPowerAudit: [
      {
        id: 'gpa_test_d',
        playerId: CONTROL[0].id,
        pseudo: CONTROL[0].pseudo,
        from: 'gp_60_65',
        to: 'gp_90_95',
        at: '2026-08-12T10:00:00.000Z',
        actorUserId: 'user-1',
        actorLabel: 'R5',
      },
    ],
  };
  const payload = T.buildPushPayload(
    remoteData,
    new Set(['ros6_command_center_v1']),
    { ros6_command_center_v1: localCC }
  );
  const p0 = payload.stores.ros6_command_center_v1.players.find((x) => x.id === CONTROL[0].id);
  assert(p0.globalPowerTierId === 'gp_90_95', 'D: nouvelle PG sauvegardée');
  assert(
    payload.stores.ros6_command_center_v1.globalPowerAudit.some((e) => e.id === 'gpa_test_d'),
    'D: entrée audit conservée'
  );
  assert(
    CONTROL.slice(1).every((c) => {
      const p = payload.stores.ros6_command_center_v1.players.find((x) => x.id === c.id);
      return p && p.globalPowerTierId === c.globalPowerTierId;
    }),
    'D: autres joueurs inchangés'
  );
}

console.log('\n=== TEST E — suppression volontaire uniquement ===');
{
  const cleared = T.mergePlayerRecord(
    { id: 'p1', globalPowerTierId: 'gp_60_65', pseudo: 'X' },
    { id: 'p1', globalPowerTierId: null, pseudo: 'X', syncClears: { globalPowerTierId: Date.now() } }
  );
  assert(cleared.globalPowerTierId == null, 'E: clear explicite (syncClears) autorisé');

  const accidental = T.mergePlayerRecord(
    { id: 'p1', globalPowerTierId: 'gp_60_65', pseudo: 'X' },
    { id: 'p1', globalPowerTierId: null, pseudo: 'X' }
  );
  assert(accidental.globalPowerTierId === 'gp_60_65', 'E: null sans syncClears → PG distante conservée');
}

console.log('\n=== TEST F — cache local sans PG + push Ruche ===');
{
  const payload = T.buildPushPayload(
    remoteData,
    new Set(['ros6_ruche_v1']),
    {
      ros6_command_center_v1: staleLocalCC,
      ros6_ruche_v1: { grid: [['R']] },
    }
  );
  assert(
    allControlIntact(payload.stores.ros6_command_center_v1.players),
    'F: push Ruche avec cache joueurs sans PG → serveur intact'
  );
  assert(
    T.countFilledGlobalPower(payload) === 7,
    'F: toujours 7 PG renseignées dans le document poussé'
  );
}

console.log('\n=== TEST G — deux clients (A Ruche, B joueurs) ===');
{
  // Serveur après édition membres client B
  const serverAfterB = {
    stores: {
      ...remoteData.stores,
      ros6_command_center_v1: {
        ...remoteData.stores.ros6_command_center_v1,
        players: remoteData.stores.ros6_command_center_v1.players.map((p) =>
          p.id === CONTROL[1].id ? { ...p, globalPowerTierId: 'gp_100_105' } : { ...p }
        ),
      },
    },
  };

  // Client A : cache ancien sans aucune PG, pousse seulement Ruche
  const clientALocal = {
    ros6_command_center_v1: staleLocalCC,
    ros6_ruche_v1: { version: 9, grid: [['A-RUCHE']], proposal: { mode: 'full' } },
    ros6_train_v1: { week: 'stale' },
  };
  const afterA = T.buildPushPayload(serverAfterB, new Set(['ros6_ruche_v1']), clientALocal);
  assert(afterA.stores.ros6_ruche_v1.grid[0][0] === 'A-RUCHE', 'G: Ruche client A appliquée');
  const francky = afterA.stores.ros6_command_center_v1.players.find((p) => p.id === CONTROL[1].id);
  assert(francky.globalPowerTierId === 'gp_100_105', 'G: PG client B non écrasée par Ruche A');
  assert(
    allControlIntact(
      afterA.stores.ros6_command_center_v1.players.map((p) =>
        p.id === CONTROL[1].id ? { ...p, globalPowerTierId: CONTROL[1].globalPowerTierId } : p
      )
    ) || francky.globalPowerTierId === 'gp_100_105',
    'G: document joueurs préservé hors dirty ruche'
  );
  assert(
    CONTROL.filter((c) => c.id !== CONTROL[1].id).every((c) => {
      const p = afterA.stores.ros6_command_center_v1.players.find((x) => x.id === c.id);
      return p && p.globalPowerTierId === c.globalPowerTierId;
    }),
    'G: autres PG du serveur conservées'
  );
}

console.log('\n=== Scénario reconnect + VS + modules ===');
{
  // 1) État serveur avec PG
  let server = JSON.parse(JSON.stringify(remoteData));

  // 2) « Déconnexion / reconnexion » : client hydrate depuis serveur (applique remote)
  let clientLocal = {
    ros6_command_center_v1: JSON.parse(JSON.stringify(server.stores.ros6_command_center_v1)),
    ros6_ruche_v1: JSON.parse(JSON.stringify(server.stores.ros6_ruche_v1)),
    ros6_train_v1: JSON.parse(JSON.stringify(server.stores.ros6_train_v1)),
  };
  assert(
    allControlIntact(clientLocal.ros6_command_center_v1.players),
    'Reconnect 1: PG présentes après hydrate serveur'
  );

  // 3) Modif Ruche
  clientLocal.ros6_ruche_v1 = { version: 3, grid: [['POST-RECONNECT']], proposal: null };
  let pushed = T.buildPushPayload(server, new Set(['ros6_ruche_v1']), clientLocal);
  server = { stores: pushed.stores };
  assert(allControlIntact(server.stores.ros6_command_center_v1.players), 'Après Ruche: PG OK');

  // 4) Modif Train
  clientLocal.ros6_train_v1 = { week: 'after-ruche' };
  clientLocal.ros6_command_center_v1 = JSON.parse(
    JSON.stringify(server.stores.ros6_command_center_v1)
  );
  pushed = T.buildPushPayload(server, new Set(['ros6_train_v1']), clientLocal);
  server = { stores: pushed.stores };
  assert(allControlIntact(server.stores.ros6_command_center_v1.players), 'Après Train: PG OK');

  // 5) Modif VS (command center dirty) avec cache qui aurait perdu les PG
  clientLocal.ros6_command_center_v1 = {
    ...JSON.parse(JSON.stringify(server.stores.ros6_command_center_v1)),
    players: server.stores.ros6_command_center_v1.players.map((p) => ({
      ...p,
      globalPowerTierId: null,
    })),
    weeks: [{ id: 'w-vs-new', label: 'Nouvelle semaine VS' }],
  };
  pushed = T.buildPushPayload(server, new Set(['ros6_command_center_v1']), clientLocal);
  server = { stores: pushed.stores };
  assert(
    allControlIntact(server.stores.ros6_command_center_v1.players),
    'Après VS (cache sans PG): merge restaure les 7 PG'
  );
  assert(
    server.stores.ros6_command_center_v1.weeks[0].id === 'w-vs-new',
    'Après VS: semaine locale conservée'
  );

  // 6) Nouvelle déconnexion/reconnexion = re-hydrate depuis serveur
  const reconnected = JSON.parse(JSON.stringify(server.stores.ros6_command_center_v1));
  assert(allControlIntact(reconnected.players), 'Reconnect 2: PG toujours présentes');
}

console.log('\n=== Bootstrap / force destructeur ===');
{
  assert(
    T.shouldBlockDestructiveGlobalPowerOverwrite(remoteData, {
      ros6_command_center_v1: staleLocalCC,
    }) === true,
    'Force bloqué si local a moins de PG que distant'
  );
  assert(
    T.shouldBlockDestructiveGlobalPowerOverwrite(remoteData, {
      ros6_command_center_v1: remoteData.stores.ros6_command_center_v1,
    }) === false,
    'Force autorisé si local a autant de PG'
  );
}

console.log('\n=== Union joueurs (cache roster incomplet) ===');
{
  const remoteOnly = {
    id: 'player_only_remote',
    pseudo: 'OnlyRemote',
    role: 'Membre',
    status: 'Actif',
    globalPowerTierId: 'gp_70_75',
  };
  const remoteCC = {
    players: [...remoteData.stores.ros6_command_center_v1.players, remoteOnly],
  };
  const localCC = {
    players: staleLocalCC.players.slice(0, 3), // roster tronqué
    weeks: [{ id: 'w1' }],
  };
  const merged = T.mergeCommandCenterStore(remoteCC, localCC);
  assert(
    merged.players.some((p) => p.id === 'player_only_remote' && p.globalPowerTierId === 'gp_70_75'),
    'Joueur uniquement distant conservé avec sa PG'
  );
  assert(
    CONTROL.every((c) => {
      const p = merged.players.find((x) => x.id === c.id);
      // Les 3 locaux null sont protégés ; les absents du local restent via union remote
      return p && p.globalPowerTierId === c.globalPowerTierId;
    }),
    'Tous les CONTROL conservent leur PG malgré roster local tronqué'
  );
}

console.log('\n=== protectPlayersGlobalPowers (import) ===');
{
  const source = CONTROL.map((p) => ({ ...p }));
  const target = CONTROL.map((p) => ({ ...p, globalPowerTierId: null }));
  T.protectPlayersGlobalPowers(source, target);
  assert(
    target.every((p, i) => p.globalPowerTierId === CONTROL[i].globalPowerTierId),
    'Import: PG source restaurées sur cibles vides'
  );
  const targetClear = [
    {
      id: CONTROL[0].id,
      globalPowerTierId: null,
      syncClears: { globalPowerTierId: 1 },
    },
  ];
  T.protectPlayersGlobalPowers(source, targetClear);
  assert(targetClear[0].globalPowerTierId == null, 'Import: clear volontaire respecté');
}

console.log('\n=== Résumé ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
