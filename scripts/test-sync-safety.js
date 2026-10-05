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
  differingKeys: ['ros6_ruche_v1'],
});
assert(
  plan.adoptRemoteKeys.includes('ros6_ruche_v1') && plan.pushKeys.length === 0,
  'la version globale n’est pas le verrou : le module est toujours adopté, le contrôle est filtré à part'
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

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
