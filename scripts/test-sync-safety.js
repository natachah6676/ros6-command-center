/**
 * Protections locales : statut Actif/Parti daté, chargement Ruche sans écriture,
 * vidage de la ruche de contrôle uniquement sur action explicite.
 * node scripts/test-sync-safety.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

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

function functionSlice(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return '';
  let open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

function memoryStorage(initial) {
  const data = { ...(initial || {}) };
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

function controlOf(count) {
  const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
  grid[4][4] = 'MARSHAL';
  let placed = 0;
  for (let r = 0; r < 10 && placed < count; r += 1) {
    for (let c = 0; c < 10 && placed < count; c += 1) {
      if (r === 4 && c === 4) continue;
      grid[r][c] = `p${placed}`;
      placed += 1;
    }
  }
  return { grid, bottomId: null, statusByPlayerId: {} };
}

function rucheDoc(control, extra) {
  return {
    version: 6,
    grid: controlOf(0).grid,
    bottomId: null,
    colors: { marshal: '#112233', r4: '#5B9BD5', free: '#000000' },
    archives: [],
    proposal: {
      grid: controlOf(0).grid,
      bottomId: null,
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    control,
    ...(extra || {}),
  };
}

const PLAYER_ID = 'player_ros6_keep';

function member(overrides) {
  return {
    id: PLAYER_ID,
    pseudo: 'Nim',
    role: 'Membre',
    status: 'Actif',
    leftAt: null,
    heroPowerTierId: 'tier_40_45',
    ...overrides,
  };
}

function runVm(code, sandbox) {
  vm.runInContext(code, sandbox);
}

async function main() {
console.log('\n=== Câblage ===');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const rucheCode = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');
const playersCode = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const loadBody = functionSlice(rucheCode, 'function loadState');
assert(loadBody && !loadBody.includes('persist('), 'loadState n’appelle plus persist');
assert(rucheCode.includes('if (force) persist()'), 'proposition affichée sans persist');
assert(functionSlice(rucheCode, 'function resetControlHive').includes('markControlReset'), 'reset pose une action explicite');
assert(playersCode.includes('statusChangedAt'), 'les actions de statut écrivent statusChangedAt');
assert(syncCode.includes('resolvePlayerStatus'), 'le merge tranche le statut par date');
assert(syncCode.includes('mergeRucheStore'), 'le merge ruche protège le contrôle');
assert(!syncCode.includes('e41978c') && !playersCode.includes('tnex'), 'pas de code TNEx dans ces correctifs');

const syncSandbox = {
  window: {},
  console,
  localStorage: memoryStorage(),
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  navigator: { onLine: true },
  location: { hostname: 'localhost' },
  ROSSupabase: { getClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) } }) },
  AppUI: { toast() {}, confirm: async () => false },
};
syncSandbox.window = syncSandbox;
syncSandbox.global = syncSandbox;
vm.createContext(syncSandbox);
runVm(syncCode, syncSandbox);
const T = syncSandbox.window.ROSSync.__test;

console.log('\n=== Statut joueur : le plus récent gagne ===');
const partiRecent = member({
  status: 'Parti',
  leftAt: '2026-10-05T14:00:00.000Z',
  statusChangedAt: '2026-10-05T14:00:00.000Z',
});
const actifAncien = member({
  status: 'Actif',
  leftAt: null,
  statusChangedAt: '2026-10-01T08:00:00.000Z',
});
const keptParti = T.mergePlayerRecord(partiRecent, actifAncien);
assert(keptParti.id === PLAYER_ID, 'l’ID joueur ne change pas');
assert(keptParti.status === 'Parti', 'distant Parti récent / local ancien Actif → reste Parti');
assert(keptParti.leftAt === '2026-10-05T14:00:00.000Z', 'leftAt reste celui du Parti retenu');
assert(keptParti.statusChangedAt === '2026-10-05T14:00:00.000Z', 'l’horodatage du Parti est conservé');
assert(keptParti.heroPowerTierId === 'tier_40_45', 'les autres champs restent fusionnés');

const actifSansDate = member({ status: 'Actif', leftAt: null });
delete actifSansDate.statusChangedAt;
const keptDatedParti = T.mergePlayerRecord(partiRecent, actifSansDate);
assert(keptDatedParti.status === 'Parti', 'un Actif sans date n’écrase pas un Parti distant daté');
assert(keptDatedParti.leftAt === '2026-10-05T14:00:00.000Z', 'leftAt du Parti daté conservé');

const actifReactive = member({
  status: 'Actif',
  leftAt: null,
  statusChangedAt: '2026-10-05T15:30:00.000Z',
});
const partiAncien = member({
  status: 'Parti',
  leftAt: '2026-10-05T14:00:00.000Z',
  statusChangedAt: '2026-10-05T14:00:00.000Z',
});
const keptActif = T.mergePlayerRecord(actifReactive, partiAncien);
assert(keptActif.status === 'Actif', 'réactivation distante plus récente → reste Actif');
assert(keptActif.leftAt == null, 'leftAt est vidé quand Actif gagne');
assert(keptActif.statusChangedAt === '2026-10-05T15:30:00.000Z', 'l’horodatage de réactivation est conservé');
assert(keptActif.id === PLAYER_ID, 'la réactivation ne change pas l’ID');

console.log('\n=== Anciennes fiches sans timestamp ===');
const undatedActif = member({ status: 'Actif', pseudo: 'Local' });
const undatedParti = member({
  status: 'Parti',
  pseudo: 'Distant',
  leftAt: '2026-09-01T00:00:00.000Z',
});
delete undatedActif.statusChangedAt;
delete undatedParti.statusChangedAt;
const legacy = T.mergePlayerRecord(undatedParti, undatedActif);
assert(legacy.status === 'Parti', 'deux fiches sans date : le Parti n’est pas ressuscité');
assert(legacy.leftAt === '2026-09-01T00:00:00.000Z', 'leftAt historique conservé sans inventer une date de statut');
assert(legacy.statusChangedAt == null, 'aucune date de statut inventée au merge');
assert(legacy.pseudo === 'Local', 'le reste de la fiche locale reste fusionné');

const bothActif = T.mergePlayerRecord(
  member({ status: 'Actif', pseudo: 'Distant' }),
  member({ status: 'Actif', pseudo: 'Local', heroPowerTierId: null })
);
assert(bothActif.status === 'Actif', 'deux Actifs sans date restent Actifs');
assert(bothActif.statusChangedAt == null, 'un Actif ancien n’obtient pas de date au merge');
assert(bothActif.heroPowerTierId === 'tier_40_45', 'un champ vide local ne vide pas le distant');
assert(bothActif.leftAt == null, 'un Actif fusionné n’a pas de leftAt');

const partiSansLeft = member({
  status: 'Parti',
  leftAt: null,
  statusChangedAt: '2026-10-05T14:00:00.000Z',
});
const otherPartiLeft = member({
  status: 'Parti',
  leftAt: '2026-10-04T00:00:00.000Z',
  statusChangedAt: '2026-10-04T00:00:00.000Z',
});
const coherent = T.mergePlayerRecord(otherPartiLeft, partiSansLeft);
assert(coherent.status === 'Parti', 'le Parti le plus récent gagne même sans leftAt propre');
assert(coherent.leftAt === '2026-10-04T00:00:00.000Z', 'leftAt manquant : on garde celui déjà connu');
assert(coherent.statusChangedAt === '2026-10-05T14:00:00.000Z', 'la date de statut la plus récente est gardée');

console.log('\n=== Plusieurs appareils ===');
function dirtyPlayerSync(remotePlayer, localPlayer) {
  const payload = T.buildPushPayload(
    { stores: { ros6_command_center_v1: { players: [remotePlayer], weeks: [] } } },
    new Set(['ros6_command_center_v1']),
    { ros6_command_center_v1: { players: [localPlayer], weeks: [] } }
  );
  return payload.stores.ros6_command_center_v1.players[0];
}

const fromA = member({
  status: 'Parti',
  leftAt: '2026-10-05T14:10:00.000Z',
  statusChangedAt: '2026-10-05T14:10:00.000Z',
});
const deviceB = member({ status: 'Actif', leftAt: null, statusChangedAt: '2026-10-01T08:00:00.000Z' });
const deviceC = member({ status: 'Actif', leftAt: null });
delete deviceC.statusChangedAt;
const afterB = dirtyPlayerSync(fromA, deviceB);
const afterC = dirtyPlayerSync(fromA, deviceC);
assert(afterB.status === 'Parti' && afterB.id === PLAYER_ID, 'appareil B sale : le Parti de A gagne');
assert(afterC.status === 'Parti', 'appareil C sans date : le Parti de A gagne');
assert(afterB.leftAt === '2026-10-05T14:10:00.000Z', 'leftAt cohérent après synchro de B');

syncSandbox.localStorage.setItem(
  'ros6_command_center_v1',
  JSON.stringify({ players: [deviceB], weeks: [] })
);
const adopted = T.rebaseLocalAfterRemote(
  { stores: { ros6_command_center_v1: { players: [fromA], weeks: [] } } },
  new Set()
);
assert(
  adopted.stores.ros6_command_center_v1.players[0].status === 'Parti',
  'B non dirty adopte le Parti distant'
);

const reactivated = member({
  status: 'Actif',
  leftAt: null,
  statusChangedAt: '2026-10-05T16:40:00.000Z',
});
const cachePartiB = member({
  status: 'Parti',
  leftAt: '2026-10-05T14:10:00.000Z',
  statusChangedAt: '2026-10-05T14:10:00.000Z',
});
const backActif = dirtyPlayerSync(reactivated, cachePartiB);
assert(backActif.status === 'Actif', 'réactivation de A plus récente que le cache Parti de B');
assert(backActif.leftAt == null, 'leftAt nul après réactivation gagnante');
assert(backActif.statusChangedAt === '2026-10-05T16:40:00.000Z', 'le timestamp de réactivation tranche');
const deviceCOldParti = dirtyPlayerSync(reactivated, fromA);
assert(deviceCOldParti.status === 'Actif', 'appareil C encore au Parti ancien : la réactivation gagne');

console.log('\n=== Ruche : pas de vidage silencieux ===');
const full = rucheDoc(controlOf(84), { controlUpdatedAt: '2026-10-05T12:00:00.000Z' });
const emptyCache = rucheDoc(controlOf(0), { controlUpdatedAt: '2026-10-03T08:00:00.000Z' });
assert(T.countControlPlacements(full.control) === 84, 'fixture : 84 placements');
assert(T.countControlPlacements(emptyCache.control) === 0, 'fixture : cache vide');

const blocked = T.mergeRucheStore(full, emptyCache);
assert(T.countControlPlacements(blocked.control) === 84, 'cache vide sans reset : les 84 restent');
assert(!blocked.controlIntent, 'pas d’intention de reset inventée');

const pushed = T.buildPushPayload(
  { stores: { ros6_ruche_v1: full } },
  new Set(['ros6_ruche_v1']),
  { ros6_ruche_v1: emptyCache }
);
assert(
  T.countControlPlacements(pushed.stores.ros6_ruche_v1.control) === 84,
  'push d’un cache vide : aucun vidage du distant'
);

syncSandbox.localStorage.setItem('ros6_ruche_v1', JSON.stringify(full));
const rebased = T.rebaseLocalAfterRemote(
  { stores: { ros6_ruche_v1: emptyCache } },
  new Set()
);
assert(
  T.countControlPlacements(rebased.stores.ros6_ruche_v1.control) === 84,
  'adoption d’un distant vide : le contrôle local peuplé reste'
);
T.applyStoresToLocal({ stores: { ros6_ruche_v1: emptyCache } });
const applied = JSON.parse(syncSandbox.localStorage.getItem('ros6_ruche_v1'));
assert(T.countControlPlacements(applied.control) === 84, 'écriture locale : le vide accidentel n’écrase pas');

const resetAt = '2026-10-05T16:20:00.000Z';
const voluntary = rucheDoc(controlOf(0), {
  controlIntent: { action: 'reset', at: resetAt },
  controlUpdatedAt: resetAt,
});
const allowed = T.mergeRucheStore(full, voluntary);
assert(T.countControlPlacements(allowed.control) === 0, 'reset explicite : passage à 0 autorisé');
assert(allowed.controlIntent.action === 'reset', 'l’action reset reste lisible pour une future RPC');
assert(allowed.controlIntent.at === resetAt, 'l’horodatage du reset est conservé');

const refilled = rucheDoc(controlOf(84), { controlUpdatedAt: '2026-10-05T18:00:00.000Z' });
const staleReset = rucheDoc(controlOf(0), {
  controlIntent: { action: 'reset', at: '2026-10-05T11:00:00.000Z' },
  controlUpdatedAt: '2026-10-05T11:00:00.000Z',
});
const staleBlocked = T.mergeRucheStore(refilled, staleReset);
assert(
  T.countControlPlacements(staleBlocked.control) === 84,
  'un vieux reset n’efface pas un contrôle modifié après'
);

const plan = T.planBootstrapAction({
  remoteVersion: 3784,
  localVersion: 3773,
  remoteRevisions: { ros6_ruche_v1: 4, ros6_train_v1: 9 },
  localRevisions: { ros6_ruche_v1: 4, ros6_train_v1: 8 },
  differingKeys: ['ros6_ruche_v1', 'ros6_train_v1'],
});
assert(
  plan.pushKeys.includes('ros6_ruche_v1') && !plan.adoptRemoteKeys.includes('ros6_ruche_v1'),
  'version globale plus haute et révision Ruche identique : la Ruche locale reste à pousser'
);
assert(
  plan.adoptRemoteKeys.includes('ros6_train_v1') && !plan.pushKeys.includes('ros6_train_v1'),
  'seule la révision Train plus haute fait adopter le Train'
);

console.log('\n=== Ruche : ouvrir ne marque pas dirty ===');
const rucheStorage = memoryStorage();
const populated = rucheDoc(controlOf(84));
const populatedText = JSON.stringify(populated);
rucheStorage.setItem('ros6_ruche_v1', populatedText);
const rucheSandbox = {
  window: {},
  console,
  localStorage: rucheStorage,
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  navigator: { onLine: true },
  location: { hostname: 'localhost' },
  ROSStorage: { getState: () => ({ players: [], powerTiers: [] }) },
  AppUI: { toast() {}, confirm: async () => false },
  ROSSupabase: { getClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) } }) },
};
rucheSandbox.window = rucheSandbox;
rucheSandbox.global = rucheSandbox;
vm.createContext(rucheSandbox);
runVm(syncCode, rucheSandbox);
runVm(rucheCode, rucheSandbox);
const Ruche = rucheSandbox.window.RucheModule;
const dirty = rucheSandbox.window.ROSSync.__test.pendingDirty;
Ruche.init();
Ruche.render();
Ruche.getState();
Ruche.hydrateFromStorage();
assert(rucheStorage.getItem('ros6_ruche_v1') === populatedText, 'ouvrir / rendre / hydrater n’écrit pas la Ruche');
assert(!dirty.has('ros6_ruche_v1'), 'ouvrir la Ruche ne la marque pas dirty');

const bareStorage = memoryStorage();
const bareSandbox = {
  window: {},
  console,
  localStorage: bareStorage,
  document: rucheSandbox.document,
  navigator: { onLine: true },
  location: { hostname: 'localhost' },
  ROSStorage: { getState: () => ({ players: [], powerTiers: [] }) },
  AppUI: { toast() {}, confirm: async () => false },
  ROSSupabase: rucheSandbox.ROSSupabase,
};
bareSandbox.window = bareSandbox;
bareSandbox.global = bareSandbox;
vm.createContext(bareSandbox);
runVm(syncCode, bareSandbox);
runVm(rucheCode, bareSandbox);
bareSandbox.window.RucheModule.init();
assert(bareStorage.getItem('ros6_ruche_v1') == null, 'premier affichage sans donnée : aucun persist');
assert(!bareSandbox.window.ROSSync.__test.pendingDirty.has('ros6_ruche_v1'), 'premier affichage : aucun dirty');

console.log('\n=== Ruche : réinitialisation volontaire ===');
rucheSandbox.AppUI.confirm = async () => false;
assert(await Ruche.requestResetControl() === false, 'reset refusé : pas d’action');
assert(rucheStorage.getItem('ros6_ruche_v1') === populatedText, 'reset refusé : stockage inchangé');
assert(!dirty.has('ros6_ruche_v1'), 'reset refusé : pas dirty');
rucheSandbox.AppUI.confirm = async () => true;
assert(await Ruche.requestResetControl() === true, 'reset confirmé');
const afterReset = JSON.parse(rucheStorage.getItem('ros6_ruche_v1'));
assert(T.countControlPlacements(afterReset.control) === 0, 'reset confirmé : contrôle vide');
assert(afterReset.controlIntent && afterReset.controlIntent.action === 'reset', 'reset confirmé : controlIntent.reset');
assert(afterReset.controlIntent.at === afterReset.controlUpdatedAt, 'reset : intention et horodatage alignés');
assert(dirty.has('ros6_ruche_v1'), 'seul le reset volontaire marque la Ruche dirty');
const pushesBeforeHydrate = dirty.size;
Ruche.hydrateFromStorage();
assert(dirty.size === pushesBeforeHydrate, 'recharger après reset ne pousse pas à nouveau');
assert(Ruche.getState().controlIntent.action === 'reset', 'l’intention survit au rechargement');

console.log('\n=== Actions joueur : horodatage sans réécriture du roster ===');
const modelsSandbox = {
  window: {},
  console,
  Date,
  Math,
  JSON,
  localStorage: memoryStorage(),
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  AppUI: { toast() {}, confirm: async () => true },
  location: { hostname: 'localhost' },
};
modelsSandbox.window = modelsSandbox;
modelsSandbox.global = modelsSandbox;
vm.createContext(modelsSandbox);
runVm(modelsCode, modelsSandbox);
const Models = modelsSandbox.window.ROSModels;
const untouched = Models.normalizeState({
  players: [
    {
      id: PLAYER_ID,
      pseudo: 'Nim',
      role: 'Membre',
      status: 'Parti',
      leftAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
    },
  ],
  weeks: [],
  powerTiers: Models.createDefaultPowerTiers(),
});
assert(untouched.players[0].statusChangedAt == null, 'normalize n’ajoute pas de date aux joueurs existants');
assert(untouched.players[0].id === PLAYER_ID, 'normalize conserve l’ID');
const roundTrip = Models.normalizeState({
  players: [
    {
      id: PLAYER_ID,
      pseudo: 'Nim',
      role: 'Membre',
      status: 'Parti',
      leftAt: '2026-10-05T14:00:00.000Z',
      statusChangedAt: '2026-10-05T14:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
    },
  ],
  weeks: [],
  powerTiers: Models.createDefaultPowerTiers(),
});
assert(
  roundTrip.players[0].statusChangedAt === '2026-10-05T14:00:00.000Z',
  'normalize conserve statusChangedAt s’il existe déjà'
);

const base = Models.createBlankState();
base.players = [
  {
    id: PLAYER_ID,
    pseudo: 'Nim',
    role: 'Membre',
    status: 'Actif',
    leftAt: null,
    createdAt: '2020-01-01T00:00:00.000Z',
  },
  {
    id: 'player_other',
    pseudo: 'Autre',
    role: 'Membre',
    status: 'Actif',
    leftAt: null,
    createdAt: '2020-01-01T00:00:00.000Z',
  },
];
modelsSandbox.localStorage.setItem('ros6_command_center_v1', JSON.stringify(base));
runVm(fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8'), modelsSandbox);
runVm(playersCode, modelsSandbox);
const Players = modelsSandbox.window.PlayersModule;
await Players.markAsLeft(PLAYER_ID);
const storedAfterLeave = JSON.parse(modelsSandbox.localStorage.getItem('ros6_command_center_v1'));
const leftPlayer = storedAfterLeave.players.find((p) => p.id === PLAYER_ID);
const otherPlayer = storedAfterLeave.players.find((p) => p.id === 'player_other');
assert(leftPlayer.status === 'Parti', 'Passer en Parti est une action explicite');
assert(leftPlayer.leftAt === leftPlayer.statusChangedAt, 'leftAt aligné sur statusChangedAt');
assert(leftPlayer.statusChangedAt, 'le départ porte un horodatage');
assert(otherPlayer.status === 'Actif' && otherPlayer.statusChangedAt == null, 'les autres joueurs ne sont pas réécrits');
const leftAt = leftPlayer.statusChangedAt;
await Players.reactivate(PLAYER_ID);
const storedAfterBack = JSON.parse(modelsSandbox.localStorage.getItem('ros6_command_center_v1'));
const back = storedAfterBack.players.find((p) => p.id === PLAYER_ID);
assert(back.status === 'Actif', 'Réactiver est une action explicite');
assert(back.leftAt == null, 'Réactiver vide leftAt');
assert(back.id === PLAYER_ID, 'Réactiver garde l’ID');
assert(Date.parse(back.statusChangedAt) >= Date.parse(leftAt), 'Réactiver pose un horodatage nouveau');
const otherAfter = storedAfterBack.players.find((p) => p.id === 'player_other');
assert(otherAfter.statusChangedAt == null && otherAfter.status === 'Actif', 'Réactiver ne touche pas les autres fiches');

console.log('\n=== status_conflict sans date : le serveur tranche, une seule fois ===');
function withoutStatusDate(overrides) {
  const player = member(overrides);
  delete player.statusChangedAt;
  return player;
}
function commandCenter(players) {
  return { players, weeks: [{ id: 'week-1', label: 'Semaine' }] };
}
function isoMs(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}
function serverWouldRejectStatus(serverPlayer, sent) {
  if (!sent || sent.status === serverPlayer.status) {
    const storedMs = isoMs(serverPlayer.statusChangedAt);
    const incomingMs = isoMs(sent && sent.statusChangedAt);
    if (storedMs > 0 && incomingMs < storedMs) return true;
    if (
      serverPlayer.status === 'Parti' &&
      serverPlayer.leftAt &&
      !(sent && sent.leftAt) &&
      incomingMs <= storedMs
    ) {
      return true;
    }
    return false;
  }
  const incomingMs = isoMs(sent.statusChangedAt);
  const storedMs = isoMs(serverPlayer.statusChangedAt);
  return !(incomingMs > storedMs && incomingMs > 0);
}
async function pushStatus(serverPlayer, localPlayer, { alwaysReject = false, remotePlayers, localPlayers } = {}) {
  T.pendingDirty.clear();
  const serverList = remotePlayers || [serverPlayer];
  const localList = localPlayers || [localPlayer];
  const serverStore = commandCenter(serverList);
  syncSandbox.localStorage.setItem('ros6_command_center_v1', JSON.stringify(commandCenter(localList)));
  T.markDirty('ros6_command_center_v1');
  const row = {
    id: 'main',
    version: 12,
    store_revisions: {
      ros6_command_center_v1: 4,
      ros6_train_v1: 1,
      ros6_ruche_v1: 2,
      ros6_tempete_v1: 3,
    },
    data: { stores: { ros6_command_center_v1: serverStore } },
  };
  const sentStatuses = [];
  let calls = 0;
  T.bindPushClient({
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: row, error: null }) };
            },
          };
        },
      };
    },
    async rpc(_name, request) {
      calls += 1;
      const sent = request.p_stores.ros6_command_center_v1.players.find((p) => p.id === serverPlayer.id);
      sentStatuses.push(sent && sent.status);
      const reject = alwaysReject || serverWouldRejectStatus(serverPlayer, sent);
      if (reject) {
        return {
          data: {
            ok: false,
            code: 'status_conflict',
            store: 'ros6_command_center_v1',
            detail: { code: 'status_conflict', playerId: serverPlayer.id },
            version: row.version,
            revisions: row.store_revisions,
            data: row.data,
          },
          error: null,
        };
      }
      return {
        data: {
          ok: true,
          code: 'applied',
          version: row.version,
          revisions: { ...row.store_revisions, ros6_command_center_v1: 5 },
          data: { stores: request.p_stores },
        },
        error: null,
      };
    },
  });
  const result = await T.runPushAttempt({ force: false, allStores: false });
  const stored = JSON.parse(syncSandbox.localStorage.getItem('ros6_command_center_v1'));
  return { result, calls, sentStatuses, stored };
}

const other = member({ id: 'player_other', pseudo: 'Autre', status: 'Actif', leftAt: null });
delete other.statusChangedAt;
const serverActif = withoutStatusDate({ id: 'player_msbm3azj_ziewgt', pseudo: 'Remi boomboom', status: 'Actif', leftAt: null });
const cacheParti = withoutStatusDate({ id: 'player_msbm3azj_ziewgt', pseudo: 'Remi boomboom', status: 'Parti', leftAt: null });
const generalStillParti = T.mergePlayerRecord(serverActif, cacheParti);
assert(generalStillParti.status === 'Parti', 'sans refus, la fusion générale préfère encore Parti si les deux dates manquent');

const loopActif = await pushStatus(serverActif, cacheParti, {
  remotePlayers: [serverActif, other],
  localPlayers: [cacheParti],
});
const remiAfter = loopActif.stored.players.find((p) => p.id === serverActif.id);
const otherAfterConflict = loopActif.stored.players.find((p) => p.id === other.id);
assert(loopActif.sentStatuses[0] === 'Parti', 'le premier envoi part encore en Parti');
assert(loopActif.result.ok === true && loopActif.result.reason !== 'conflict', 'le refus sans date ne s’arrête pas en conflit');
assert(loopActif.calls <= 2, 'pas de boucle de status_conflict');
assert(loopActif.calls === 1 || loopActif.sentStatuses[1] === 'Actif', 'le nouvel essai reprend Actif serveur');
assert(remiAfter.status === 'Actif' && remiAfter.leftAt == null, 'serveur Actif/null + cache Parti/null → Actif serveur');
assert(otherAfterConflict && otherAfterConflict.status === 'Actif', 'aucun joueur serveur ne disparaît');

const serverParti = withoutStatusDate({ status: 'Parti', leftAt: null, pseudo: 'Ancien' });
const cacheActif = withoutStatusDate({ status: 'Actif', leftAt: null, pseudo: 'Ancien' });
const adoptedParti = T.mergeCommandCenterStore(
  commandCenter([serverParti, other]),
  commandCenter([cacheActif]),
  { preferServerUndatedStatus: true }
);
const partiRow = adoptedParti.players.find((p) => p.id === PLAYER_ID);
assert(partiRow.status === 'Parti' && partiRow.statusChangedAt == null, 'serveur Parti/null + cache Actif/null → Parti serveur');
assert(adoptedParti.players.some((p) => p.id === other.id), 'la reprise du statut serveur garde les autres joueurs');
const loopParti = await pushStatus(serverParti, cacheActif, {
  remotePlayers: [serverParti, other],
  localPlayers: [cacheActif],
});
assert(loopParti.sentStatuses[0] === 'Parti', 'un cache Actif sans date ne part pas en écriture contre un Parti serveur sans date');
assert(loopParti.result.ok === true && loopParti.result.reason !== 'conflict', 'ce Parti serveur ne boucle pas');
assert(loopParti.calls === 1, 'un seul appel quand la fusion générale a déjà le statut serveur');

const datedParti = member({
  status: 'Parti',
  leftAt: '2026-10-05T14:00:00.000Z',
  statusChangedAt: '2026-10-05T14:00:00.000Z',
});
const undatedActifCache = withoutStatusDate({ status: 'Actif', leftAt: null });
const keptDated = T.applyServerUndatedStatus(
  T.mergePlayerRecord(datedParti, undatedActifCache),
  datedParti,
  undatedActifCache
);
assert(keptDated.status === 'Parti' && keptDated.statusChangedAt === '2026-10-05T14:00:00.000Z', 'serveur Parti/daté + cache Actif/null → Parti');
const datedActif = member({ status: 'Actif', leftAt: null, statusChangedAt: '2026-10-05T15:00:00.000Z' });
const undatedPartiCache = withoutStatusDate({ status: 'Parti', leftAt: '2026-09-01T00:00:00.000Z' });
const keptDatedActif = T.applyServerUndatedStatus(
  T.mergePlayerRecord(datedActif, undatedPartiCache),
  datedActif,
  undatedPartiCache
);
assert(keptDatedActif.status === 'Actif' && keptDatedActif.leftAt == null, 'serveur Actif/daté + cache Parti/null → Actif');

const voluntaryLeave = member({
  status: 'Parti',
  leftAt: '2026-10-07T09:00:00.000Z',
  statusChangedAt: '2026-10-07T09:00:00.000Z',
});
const serverWasActif = withoutStatusDate({ status: 'Actif', leftAt: null });
const leavePush = await pushStatus(serverWasActif, voluntaryLeave);
assert(leavePush.calls === 1 && leavePush.result.ok === true && leavePush.result.version === 12, 'Actif → Parti volontaire : date nouvelle, écriture acceptée');
assert(leavePush.sentStatuses[0] === 'Parti', 'le départ volontaire est bien envoyé');

const voluntaryBack = member({
  status: 'Actif',
  leftAt: null,
  statusChangedAt: '2026-10-07T10:00:00.000Z',
});
const serverWasParti = member({
  status: 'Parti',
  leftAt: '2026-10-05T14:00:00.000Z',
  statusChangedAt: '2026-10-05T14:00:00.000Z',
});
const backPush = await pushStatus(serverWasParti, voluntaryBack);
assert(backPush.calls === 1 && backPush.result.ok === true, 'Parti → Actif volontaire : date nouvelle, écriture acceptée');
assert(backPush.sentStatuses[0] === 'Actif' && backPush.stored.players[0].status === 'Actif', 'la réactivation acceptée est Actif');

const staleActif = withoutStatusDate({ status: 'Actif', leftAt: null });
const resurrection = await pushStatus(datedParti, staleActif);
assert(resurrection.sentStatuses[0] === 'Parti', 'un ancien cache sans date ne ressuscite pas un Parti daté');
assert(resurrection.result.ok === true && resurrection.stored.players[0].status === 'Parti', 'le Parti serveur daté reste en place');

const equalParti = member({
  status: 'Parti',
  leftAt: '2026-10-05T12:00:00.000Z',
  statusChangedAt: '2026-10-05T12:00:00.000Z',
});
const equalActif = member({
  status: 'Actif',
  leftAt: null,
  statusChangedAt: '2026-10-05T12:00:00.000Z',
});
const unresolved = await pushStatus(equalActif, equalParti, { alwaysReject: true });
assert(unresolved.calls === 2, 'deux refus identiques, puis arrêt');
assert(unresolved.result.ok === false && unresolved.result.reason === 'conflict', 'un vrai conflit non résolu s’arrête encore');

syncSandbox.localStorage.setItem('ros6_ruche_v1', JSON.stringify(rucheDoc(controlOf(0))));
syncSandbox.localStorage.setItem('ros6_train_v1', JSON.stringify({ marker: 'local-train' }));
syncSandbox.localStorage.setItem('ros6_tempete_v1', JSON.stringify({ marker: 'local-tempete' }));
const moduleRebase = T.rebaseLocalAfterRemote(
  {
    stores: {
      ros6_ruche_v1: rucheDoc(controlOf(4), { controlUpdatedAt: '2026-10-03T00:00:00.000Z' }),
      ros6_train_v1: { marker: 'remote-train' },
      ros6_tempete_v1: { marker: 'remote-tempete' },
      ros6_command_center_v1: commandCenter([datedParti]),
    },
  },
  new Set(['ros6_ruche_v1', 'ros6_train_v1', 'ros6_tempete_v1']),
  { preferServerUndatedStatus: true }
);
assert(T.countControlPlacements(moduleRebase.stores.ros6_ruche_v1.control) === 4, 'le correctif de statut ne vide pas la ruche de contrôle');
assert(moduleRebase.stores.ros6_train_v1.marker === 'local-train', 'Train dirty n’est pas remplacé');
assert(moduleRebase.stores.ros6_tempete_v1.marker === 'local-tempete', 'Tempête dirty n’est pas remplacée');
const vsRebase = T.rebaseLocalAfterRemote(
  { stores: { ros6_command_center_v1: commandCenter([datedParti]) } },
  new Set(['ros6_command_center_v1']),
  { preferServerUndatedStatus: true }
);
assert(vsRebase.stores.ros6_command_center_v1.weeks[0].id === 'week-1', 'la semaine VS reste dans la fusion');

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
