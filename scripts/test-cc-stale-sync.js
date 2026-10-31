/**
 * Centre de commandement : un cache ancien ne réécrit pas le serveur,
 * une saisie hors ligne est conservée, les scores VS ne sont pas effacés à l'affichage.
 * node scripts/test-cc-stale-sync.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const vsCode = fs.readFileSync(path.join(root, 'js/vs.js'), 'utf8');
const playersCode = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');

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

const storage = memoryStorage();
const toasts = [];
let acceptServerCopy = true;
const confirms = [];
const sandbox = {
  window: {},
  console,
  localStorage: storage,
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  navigator: { onLine: true },
  location: { hostname: 'warops.vercel.app' },
  ROSSupabase: {
    getClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) } }),
  },
  AppUI: {
    toast(message) {
      toasts.push(String(message));
    },
    confirm: async (options) => {
      confirms.push(options || {});
      return acceptServerCopy;
    },
  },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(syncCode, sandbox);
const T = sandbox.window.ROSSync.__test;

function player(id, extra) {
  return {
    id,
    pseudo: id,
    role: 'Membre',
    status: 'Actif',
    absent: false,
    leftAt: null,
    ...extra,
  };
}

function score(days, times) {
  const dayUpdatedAt = {};
  Object.keys(times || {}).forEach((day) => {
    dayUpdatedAt[day] = times[day];
  });
  return {
    days: { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, ...days },
    dayBrackets: { lundi: 'ok', mardi: 'ok', mercredi: 'ok', jeudi: 'ok', vendredi: 'ok' },
    ...(Object.keys(dayUpdatedAt).length ? { dayUpdatedAt } : {}),
  };
}

function cc(players, scores, extra) {
  return {
    players,
    weeks: [
      {
        id: 'w1',
        createdAt: '2026-10-01T00:00:00.000Z',
        scores: scores || {},
        vsContacts: {},
      },
    ],
    currentWeekId: 'w1',
    vsWeekLifecycle: {},
    ...(extra || {}),
  };
}

function setBasis(base) {
  storage.setItem(
    T.CC_BASIS_KEY,
    JSON.stringify({ unsynced: true, captureFailed: false, revision: 4, base })
  );
}

function clearBasis() {
  storage.removeItem(T.CC_BASIS_KEY);
}

console.log('\n=== Affichage VS et absence ===');
const ensureStart = vsCode.indexOf('function ensureActiveScores');
const ensureBody = vsCode.slice(ensureStart, vsCode.indexOf('function fillSettingsForm'));
assert(!ensureBody.includes('delete target.scores') && !ensureBody.includes('delete '), 'ensureActiveScores n’efface plus de score');
assert(!ensureBody.includes('ROSStorage.update'), 'ensureActiveScores n’écrit plus le store');
const setAbsentStart = playersCode.indexOf('function setAbsent');
const setAbsentBody = playersCode.slice(setAbsentStart, playersCode.indexOf('function setDiscret'));
assert(setAbsentBody.includes('absentChangedAt'), 'l’absence est horodatée');
assert(!setAbsentBody.includes('delete week.scores') && !setAbsentBody.includes('delete '), 'marquer absent ne retire pas le score VS');

console.log('\n=== Révision distante plus haute, sans saisie locale ===');
clearBasis();
const stalePlan = T.planBootstrapAction({
  remoteVersion: 20,
  localVersion: 18,
  remoteRevisions: { ros6_command_center_v1: 8, ros6_train_v1: 3 },
  localRevisions: { ros6_command_center_v1: 5, ros6_train_v1: 3 },
  differingKeys: ['ros6_command_center_v1'],
});
assert(
  stalePlan.adoptRemoteKeys.includes('ros6_command_center_v1') &&
    !stalePlan.pushKeys.includes('ros6_command_center_v1'),
  'navigateur en retard : le centre de commandement distant est adopté, pas renvoyé'
);

console.log('\n=== Saisie non acquittée : on fusionne, on n’abandonne pas ===');
setBasis(cc([player('p1')]));
const offlinePlan = T.planBootstrapAction({
  remoteVersion: 20,
  localVersion: 18,
  remoteRevisions: { ros6_command_center_v1: 8 },
  localRevisions: { ros6_command_center_v1: 5 },
  differingKeys: ['ros6_command_center_v1'],
});
assert(
  offlinePlan.pushKeys.includes('ros6_command_center_v1') &&
    !offlinePlan.adoptRemoteKeys.includes('ros6_command_center_v1'),
  'saisie hors ligne : le centre de commandement reste à pousser'
);

console.log('\n=== Deux R4 : scores de jours différents ===');
const baseScores = { p1: score({ lundi: 1, mardi: 1 }) };
const base = cc(
  [player('p1', { pseudo: 'Alpha' }), player('p2', { pseudo: 'Bravo' })],
  baseScores
);
const remoteA = cc(
  [player('p1', { pseudo: 'Alpha' }), player('p2', { pseudo: 'Bravo' })],
  { p1: score({ lundi: 9, mardi: 1 }, { lundi: '2026-10-31T09:00:00.000Z' }) }
);
const localB = cc(
  [player('p1', { pseudo: 'Alpha' }), player('p2', { pseudo: 'Bravo' })],
  { p1: score({ lundi: 1, mardi: 7 }, { mardi: '2026-10-31T10:00:00.000Z' }) }
);
const bothDays = T.mergeCommandCenterStore(remoteA, localB, { basis: base });
const days = bothDays.weeks[0].scores.p1.days;
assert(days.lundi === 9, 'le lundi saisi par l’autre R4 reste');
assert(days.mardi === 7, 'le mardi saisi hors ligne sur cet appareil reste');
assert(bothDays.players.find((p) => p.id === 'p2')?.pseudo === 'Bravo', 'l’autre joueur n’est pas retiré');

console.log('\n=== Cache ancien : le score distant n’est pas écrasé ===');
const staleLocal = cc(
  [player('p1', { pseudo: 'Alpha' }), player('p2', { pseudo: 'Bravo' })],
  { p1: score({ lundi: 1, mardi: 1 }) }
);
const keptRemoteDay = T.mergeCommandCenterStore(remoteA, staleLocal, { basis: base });
assert(keptRemoteDay.weeks[0].scores.p1.days.lundi === 9, 'un lundi local inchangé ne remplace pas le lundi distant');
assert(keptRemoteDay.weeks[0].scores.p1, 'la ligne de score existe encore');

console.log('\n=== Absence : le plus récent gagne, le score reste ===');
const remoteAbsent = cc(
  [
    player('p1', {
      pseudo: 'Alpha',
      absent: true,
      absentChangedAt: '2026-10-31T11:00:00.000Z',
    }),
  ],
  { p1: score({ lundi: 4 }) }
);
const localPresent = cc([player('p1', { pseudo: 'Alpha', absent: false })], { p1: score({ lundi: 4 }) });
const absentWins = T.mergeCommandCenterStore(remoteAbsent, localPresent, { basis: base });
const absentRow = absentWins.players.find((p) => p.id === 'p1');
assert(absentRow.absent === true, 'l’absence distante horodatée n’est pas annulée par un cache présent');
assert(absentWins.weeks[0].scores.p1.days.lundi === 4, 'le score du joueur absent est conservé');

const localAbsent = cc(
  [
    player('p1', {
      pseudo: 'Alpha',
      absent: true,
      absentChangedAt: '2026-10-31T12:00:00.000Z',
    }),
  ],
  { p1: score({ lundi: 4, mardi: 3 }) }
);
const presentBase = cc([player('p1', { pseudo: 'Alpha', absent: false })], { p1: score({ lundi: 4, mardi: 1 }) });
const remotePresent = cc([player('p1', { pseudo: 'Alpha', absent: false })], {
  p1: score({ lundi: 4, mardi: 1 }),
});
const offlineAbsent = T.mergeCommandCenterStore(remotePresent, localAbsent, { basis: presentBase });
assert(offlineAbsent.players[0].absent === true, 'l’absence saisie hors ligne est conservée');
assert(offlineAbsent.weeks[0].scores.p1.days.mardi === 3, 'le score saisi avec l’absence n’est pas effacé');

console.log('\n=== Parti ===');
const remoteParti = cc(
  [
    player('p1', {
      pseudo: 'Alpha',
      status: 'Parti',
      leftAt: '2026-10-31T08:00:00.000Z',
      statusChangedAt: '2026-10-31T08:00:00.000Z',
    }),
    player('p2', { pseudo: 'Bravo' }),
  ],
  { p1: score({ lundi: 2 }) }
);
const localStillActif = cc(
  [player('p1', { pseudo: 'Alpha', status: 'Actif' }), player('p2', { pseudo: 'Bravo' })],
  { p1: score({ lundi: 2 }) }
);
const partiKept = T.mergeCommandCenterStore(remoteParti, localStillActif, { basis: base });
assert(partiKept.players.find((p) => p.id === 'p1').status === 'Parti', 'un cache Actif inchangé ne réactive pas un Parti distant');
assert(partiKept.weeks[0].scores.p1.days.lundi === 2, 'le score du joueur parti reste enregistré');

const localParti = cc(
  [
    player('p1', {
      pseudo: 'Alpha',
      status: 'Parti',
      leftAt: '2026-10-31T13:00:00.000Z',
      statusChangedAt: '2026-10-31T13:00:00.000Z',
    }),
  ],
  { p1: score({ lundi: 2 }) }
);
const offlineParti = T.mergeCommandCenterStore(
  cc([player('p1', { pseudo: 'Alpha', status: 'Actif' })], { p1: score({ lundi: 2 }) }),
  localParti,
  { basis: cc([player('p1', { pseudo: 'Alpha', status: 'Actif' })], { p1: score({ lundi: 2 }) }) }
);
assert(offlineParti.players[0].status === 'Parti', 'un départ saisi hors ligne est envoyé');

console.log('\n=== Joueur supprimé ===');
const remoteDeleted = cc([player('p2', { pseudo: 'Bravo' })], { p2: score({ lundi: 5 }) }, {
  deletedPlayers: { p1: { at: '2026-10-31T07:00:00.000Z', pseudo: 'Alpha' } },
});
const localStillHasDeleted = cc(
  [player('p1', { pseudo: 'Alpha' }), player('p2', { pseudo: 'Bravo' })],
  { p1: score({ lundi: 2 }), p2: score({ lundi: 5 }) }
);
const withoutDeleted = T.mergeCommandCenterStore(remoteDeleted, localStillHasDeleted, { basis: base });
assert(!withoutDeleted.players.some((p) => p.id === 'p1'), 'le tombeau empêche le retour du joueur supprimé');
assert(withoutDeleted.players.some((p) => p.id === 'p2'), 'les autres joueurs restent');
assert(withoutDeleted.deletedPlayers && withoutDeleted.deletedPlayers.p1, 'le tombeau deletedPlayers est conservé');

console.log('\n=== Même case, horodatage : le plus récent gagne, l’autre est signalé ===');
toasts.length = 0;
const conflictRemote = cc([player('p1', { pseudo: 'Alpha' })], {
  p1: score({ lundi: 8 }, { lundi: '2026-10-31T15:00:00.000Z' }),
});
const conflictLocal = cc([player('p1', { pseudo: 'Alpha' })], {
  p1: score({ lundi: 3 }, { lundi: '2026-10-31T12:00:00.000Z' }),
});
const conflictBase = cc([player('p1', { pseudo: 'Alpha' })], { p1: score({ lundi: 1 }) });
setBasis(conflictBase);
const conflictMerged = T.mergeCommandCenterForSync(conflictRemote, conflictLocal);
assert(conflictMerged.weeks[0].scores.p1.days.lundi === 8, 'le score distant plus récent reste');
assert(
  toasts.some(
    (message) =>
      message.includes('Deux saisies se sont croisées') &&
      message.includes('non retenue') &&
      message.includes('le score du lundi de Alpha')
  ),
  'le conflit nomme le jour et le joueur'
);

async function main() {
console.log('\n=== Envoi : cache ancien ignoré, saisie hors ligne poussée ===');
clearBasis();
storage.setItem('ros6_sync_meta_v1', JSON.stringify({ version: 18, savedAt: '', storeRevisions: { ros6_command_center_v1: 5 } }));
T.writeMeta && T.writeMeta(18, { ros6_command_center_v1: 5 });
const stalePayload = cc([player('p1', { pseudo: 'Ancien' })]);
storage.setItem('ros6_command_center_v1', JSON.stringify(stalePayload));
T.pendingDirty.clear();
T.markDirty('ros6_command_center_v1');
let staleCalls = 0;
T.bindPushClient({
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data: {
                  id: 'main',
                  version: 20,
                  store_revisions: { ros6_command_center_v1: 8 },
                  data: { stores: { ros6_command_center_v1: cc([player('p1', { pseudo: 'Serveur' })]) } },
                },
                error: null,
              }),
            };
          },
        };
      },
    };
  },
  async rpc() {
    staleCalls += 1;
    return { data: { ok: true, version: 20, revisions: {}, data: { stores: {} } }, error: null };
  },
});
const stalePush = await T.runPushAttempt({ force: false, allStores: false });
assert(staleCalls === 0, 'aucune écriture RPC tant que le cache n’a pas de saisie à lui');
assert(stalePush.ok === true, 'le rappel serveur est un succès');
assert(confirms.length === 1, 'un avertissement est montré avant le remplacement');
assert(
  confirms[0].message.includes('ne sera pas envoyée'),
  'l’avertissement dit que la copie locale n’est pas envoyée'
);
const held = JSON.parse(storage.getItem(T.CC_LEGACY_HOLD_KEY));
assert(held && held.sendToServer === false && held.store.players[0].pseudo === 'Ancien', 'la copie ancienne est conservée hors envoi');
assert(
  JSON.parse(storage.getItem('ros6_command_center_v1')).players[0].pseudo === 'Serveur',
  'après accord, l’écran prend le pseudo du serveur'
);
const replay = T.buildPushPayload(
  { stores: { ros6_command_center_v1: cc([player('p1', { pseudo: 'Serveur' })]), [T.CC_LEGACY_HOLD_KEY]: held } },
  new Set(['ros6_command_center_v1'])
);
assert(!Object.prototype.hasOwnProperty.call(replay.stores, T.CC_LEGACY_HOLD_KEY), 'la copie de récupération n’entre pas dans l’envoi');
assert(!JSON.stringify(replay).includes('Ancien'), 'le pseudo ancien n’est pas renvoyé');

const offlineBase = cc([player('p1', { pseudo: 'Serveur' })], { p1: score({ lundi: 1, mardi: 1 }) });
const offlineLocal = cc([player('p1', { pseudo: 'Serveur' })], {
  p1: score({ lundi: 1, mardi: 6 }, { mardi: '2026-10-31T16:00:00.000Z' }),
});
setBasis(offlineBase);
storage.setItem('ros6_command_center_v1', JSON.stringify(offlineLocal));
T.pendingDirty.clear();
T.markDirty('ros6_command_center_v1');
let sentDays = null;
T.bindPushClient({
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data: {
                  id: 'main',
                  version: 21,
                  store_revisions: { ros6_command_center_v1: 8 },
                  data: {
                    stores: {
                      ros6_command_center_v1: cc([player('p1', { pseudo: 'Serveur' })], {
                        p1: score({ lundi: 9, mardi: 1 }, { lundi: '2026-10-31T14:00:00.000Z' }),
                      }),
                    },
                  },
                },
                error: null,
              }),
            };
          },
        };
      },
    };
  },
  async rpc(_name, request) {
    sentDays = request.p_stores.ros6_command_center_v1.weeks[0].scores.p1.days;
    return {
      data: {
        ok: false,
        code: 'revision_conflict',
        store: 'ros6_command_center_v1',
        version: 21,
        revisions: { ros6_command_center_v1: 9 },
        data: {
          stores: {
            ros6_command_center_v1: cc([player('p1', { pseudo: 'Serveur' })], {
              p1: score({ lundi: 9, mardi: 1 }, { lundi: '2026-10-31T14:00:00.000Z' }),
            }),
          },
        },
      },
      error: null,
    };
  },
});
const conflictPush = await T.runPushAttempt({ force: false, allStores: false });
assert(sentDays && sentDays.lundi === 9 && sentDays.mardi === 6, 'le conflit réunit le lundi distant et le mardi hors ligne');
assert(conflictPush.reason === 'conflict' || conflictPush.ok === true, 'le conflit de révision ne part pas en boucle infinie');

console.log('\n=== R4 de retour après plusieurs jours, ancienne version sans photo ===');
clearBasis();
storage.removeItem(T.CC_LEGACY_HOLD_KEY);
const daysLaterLocal = cc([player('p1', { pseudo: 'Alpha' })], {
  p1: score({ lundi: 1, mardi: 6 }, { mardi: '2026-10-20T18:00:00.000Z' }),
});
storage.setItem('ros6_command_center_v1', JSON.stringify(daysLaterLocal));
storage.setItem(
  'ros6_sync_meta_v1',
  JSON.stringify({
    version: 12,
    savedAt: '2026-10-20T18:00:00.000Z',
    storeRevisions: { ros6_command_center_v1: 4 },
  })
);
acceptServerCopy = false;
confirms.length = 0;
let daysLaterCalls = 0;
let daysLaterSent = null;
T.pendingDirty.clear();
T.markDirty('ros6_command_center_v1');
T.bindPushClient({
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data: {
                  id: 'main',
                  version: 40,
                  store_revisions: { ros6_command_center_v1: 30 },
                  updated_at: '2026-10-31T09:00:00.000Z',
                  data: {
                    stores: {
                      ros6_command_center_v1: cc([player('p1', { pseudo: 'Alpha' })], {
                        p1: score({ lundi: 9, mardi: 1 }, { lundi: '2026-10-31T09:00:00.000Z' }),
                      }),
                    },
                  },
                },
                error: null,
              }),
            };
          },
        };
      },
    };
  },
  async rpc(_name, request) {
    daysLaterCalls += 1;
    daysLaterSent = request;
    return { data: { ok: true, version: 40, revisions: {}, data: { stores: {} } }, error: null };
  },
});
const refused = await T.runPushAttempt({ force: false, allStores: false });
const refusedHold = JSON.parse(storage.getItem(T.CC_LEGACY_HOLD_KEY));
assert(confirms.length === 1 && /Copie ancienne/.test(confirms[0].title), 'l’avertissement est affiché avant tout remplacement');
assert(refusedHold.store.weeks[0].scores.p1.days.mardi === 6, 'le mardi non synchronisé est dans la copie récupérable');
assert(refusedHold.sendToServer === false, 'la copie est marquée comme non envoyable');
assert(daysLaterCalls === 0 && daysLaterSent == null, 'le refus n’envoie rien au serveur');
assert(
  JSON.parse(storage.getItem('ros6_command_center_v1')).weeks[0].scores.p1.days.mardi === 6,
  'sans accord, la copie de travail n’est pas écrasée'
);
assert(refused.ok === true, 'le refus reste un arrêt propre');
T.pendingDirty.clear();
T.markDirty('ros6_command_center_v1');
const refusedAgain = await T.runPushAttempt({ force: false, allStores: false });
assert(daysLaterCalls === 0 && refusedAgain.ok === true, 'un second passage ne renvoie toujours pas la copie ancienne');

acceptServerCopy = true;
confirms.length = 0;
T.pendingDirty.clear();
T.markDirty('ros6_command_center_v1');
await T.runPushAttempt({ force: false, allStores: false });
assert(daysLaterCalls === 0, 'même après accord, la copie ancienne n’est pas poussée');
assert(
  JSON.parse(storage.getItem('ros6_command_center_v1')).weeks[0].scores.p1.days.lundi === 9,
  'après accord, l’écran montre le serveur'
);
assert(
  JSON.parse(storage.getItem(T.CC_LEGACY_HOLD_KEY)).store.weeks[0].scores.p1.days.mardi === 6,
  'la copie récupérable du mardi est encore là'
);

console.log('\n=== Premier chargement de la nouvelle version ===');
clearBasis();
storage.removeItem(T.CC_LEGACY_HOLD_KEY);
const firstLoadLocal = cc([player('p1', { pseudo: 'Alpha' })], {
  p1: score({ lundi: 1, mardi: 6 }, { mardi: '2026-10-20T18:00:00.000Z' }),
});
const firstLoadRemote = cc([player('p1', { pseudo: 'Alpha' })], {
  p1: score({ lundi: 9, mardi: 1 }, { lundi: '2026-10-31T09:00:00.000Z' }),
});
storage.setItem('ros6_command_center_v1', JSON.stringify(firstLoadLocal));
const firstPlan = T.planBootstrapAction({
  remoteVersion: 40,
  localVersion: 12,
  remoteRevisions: { ros6_command_center_v1: 30 },
  localRevisions: { ros6_command_center_v1: 4 },
  differingKeys: ['ros6_command_center_v1'],
});
assert(
  firstPlan.adoptRemoteKeys.includes('ros6_command_center_v1') &&
    !firstPlan.pushKeys.includes('ros6_command_center_v1'),
  'sans photo, le premier chargement ne renvoie pas le cache ancien'
);
acceptServerCopy = false;
confirms.length = 0;
const firstRefuse = await T.parkLegacyCommandCenterBeforeReplace(firstLoadRemote);
const refusedPrepare = T.prepareBootstrapStores(
  { stores: { ros6_command_center_v1: firstLoadRemote } },
  firstPlan,
  { remoteVersion: 40, localVersion: 12 },
  { skipKeys: ['ros6_command_center_v1'] }
);
assert(firstRefuse.blocked === true && firstRefuse.held === true, 'le refus bloque le remplacement après avoir gardé la copie');
assert(
  confirms[0] &&
    confirms[0].message.includes('le mardi de Alpha sur cet appareil : 6') &&
    confirms[0].message.includes('ne sera pas envoyée'),
  'l’avertissement du premier chargement nomme le mardi non synchronisé'
);
assert(!refusedPrepare.pushKeys.includes('ros6_command_center_v1'), 'le refus ne prépare aucun envoi du centre de commandement');
assert(
  JSON.parse(storage.getItem('ros6_command_center_v1')).weeks[0].scores.p1.days.mardi === 6,
  'au premier chargement, le refus laisse le mardi sur l’écran'
);

storage.removeItem(T.CC_LEGACY_HOLD_KEY);
const originalSetItem = storage.setItem.bind(storage);
storage.setItem = (key, value) => {
  if (key === T.CC_LEGACY_HOLD_KEY) {
    const error = new Error('quota has been exceeded');
    error.name = 'QuotaExceededError';
    throw error;
  }
  return originalSetItem(key, value);
};
toasts.length = 0;
confirms.length = 0;
let quotaPark;
try {
  quotaPark = await T.parkLegacyCommandCenterBeforeReplace(firstLoadRemote);
} finally {
  storage.setItem = originalSetItem;
}
assert(quotaPark.blocked === true && quotaPark.held === false, 'si la copie ne peut pas être gardée, rien n’est remplacé');
assert(confirms.length === 0, 'sans copie récupérable, on ne propose pas d’afficher le serveur');
assert(
  toasts.some((message) => message.includes('n’a pas pu être mise de côté') && message.includes('ne sera pas envoyée')),
  'l’échec de copie est dit explicitement'
);
assert(
  JSON.parse(storage.getItem('ros6_command_center_v1')).weeks[0].scores.p1.days.mardi === 6,
  'l’échec de copie laisse la saisie locale en place'
);

acceptServerCopy = true;
confirms.length = 0;
const firstAccept = await T.parkLegacyCommandCenterBeforeReplace(firstLoadRemote);
const acceptedPrepare = T.prepareBootstrapStores(
  { stores: { ros6_command_center_v1: firstLoadRemote } },
  firstPlan,
  { remoteVersion: 40, localVersion: 12 }
);
assert(firstAccept.blocked === false && firstAccept.held === true, 'l’accord n’arrive qu’après la copie locale');
assert(acceptedPrepare.adopted.includes('ros6_command_center_v1'), 'après accord, le premier chargement prend le serveur');
assert(
  JSON.parse(storage.getItem('ros6_command_center_v1')).weeks[0].scores.p1.days.lundi === 9,
  'après accord, l’écran du premier chargement montre le lundi du serveur'
);
const kept = T.readLegacyCommandCenterHold();
assert(kept && kept.sendToServer === false && kept.store.weeks[0].scores.p1.days.mardi === 6, 'le mardi du premier chargement reste récupérable');
assert(T.markDirty(T.CC_LEGACY_HOLD_KEY) === false, 'la copie récupérable ne peut pas être marquée à envoyer');
const firstPayload = T.buildStorePushRequest(
  {
    store_revisions: { ros6_command_center_v1: 30 },
    data: { stores: { ros6_command_center_v1: firstLoadRemote, [T.CC_LEGACY_HOLD_KEY]: kept } },
  },
  new Set(['ros6_command_center_v1', T.CC_LEGACY_HOLD_KEY])
);
assert(!Object.prototype.hasOwnProperty.call(firstPayload.p_stores, T.CC_LEGACY_HOLD_KEY), 'le premier envoi ignore la copie de récupération');
assert(!JSON.stringify(firstPayload).includes('"mardi":6'), 'le mardi non synchronisé ne repart pas tout seul');

console.log('\n=== Consultation ultérieure de la copie ancienne ===');
const reviewCopy = cc(
  [player('p1', { pseudo: 'Alpha', status: 'Actif' }), player('p3', { pseudo: 'Charlie' })],
  { p1: score({ mardi: 6 }) }
);
reviewCopy.weeks[0].vsContacts = { p1: { kind: 'coach' } };
const reviewCurrent = cc(
  [player('p1', { pseudo: 'Alpha', status: 'Parti' }), player('p2', { pseudo: 'Bravo' })],
  { p1: score({ mardi: 1, lundi: 9 }) }
);
reviewCurrent.weeks[0].vsContacts = { p1: { kind: 'praise' } };
const reviewHold = {
  heldAt: '2026-10-20T18:00:00.000Z',
  reason: 'ancienne-version-sans-photo',
  recoverable: true,
  sendToServer: false,
  store: reviewCopy,
};
storage.setItem(T.CC_LEGACY_HOLD_KEY, JSON.stringify(reviewHold));
storage.setItem('ros6_command_center_v1', JSON.stringify(reviewCurrent));
const holdBeforeReview = storage.getItem(T.CC_LEGACY_HOLD_KEY);
const currentBeforeReview = storage.getItem('ros6_command_center_v1');
let reviewWrites = 0;
const reviewSetItem = storage.setItem.bind(storage);
storage.setItem = (key, value) => {
  reviewWrites += 1;
  return reviewSetItem(key, value);
};
const review = T.describeLegacyCommandCenterHold();
storage.setItem = reviewSetItem;
assert(review && review.readOnly === true && review.sendToServer === false, 'la consultation est en lecture seule et non envoyable');
assert(
  review.lines.some((line) => line.includes('Le mardi de Alpha') && line.includes('6') && line.includes('1')),
  'la consultation montre le mardi de la copie et celui des données actuelles'
);
assert(
  review.lines.some((line) => line.includes('Le statut de Alpha') && line.includes('Actif') && line.includes('Parti')),
  'la consultation montre le statut différent'
);
assert(
  review.lines.some((line) => line.includes('Charlie') && line.includes('copie ancienne')),
  'un joueur présent seulement dans la copie est signalé'
);
assert(
  review.lines.some((line) => line.includes('Bravo') && line.includes('données actuelles')),
  'un joueur présent seulement dans les données actuelles est signalé'
);
assert(
  review.lines.some((line) => line.includes('Le contact VS de Alpha') && line.includes('coaching') && line.includes('félicitations')),
  'un contact VS différent est signalé'
);
assert(reviewWrites === 0, 'consulter la copie n’écrit rien');
assert(storage.getItem(T.CC_LEGACY_HOLD_KEY) === holdBeforeReview, 'la copie ancienne n’est ni modifiée ni supprimée');
assert(storage.getItem('ros6_command_center_v1') === currentBeforeReview, 'les données actuelles restent intactes');
assert(T.markDirty(T.CC_LEGACY_HOLD_KEY) === false, 'la consultation ne marque pas la copie à envoyer');
const reviewPayload = T.buildStorePushRequest(
  { store_revisions: { ros6_command_center_v1: 30 }, data: { stores: { ros6_command_center_v1: reviewCurrent } } },
  new Set(['ros6_command_center_v1', T.CC_LEGACY_HOLD_KEY])
);
assert(!Object.prototype.hasOwnProperty.call(reviewPayload.p_stores, T.CC_LEGACY_HOLD_KEY), 'la consultation ne prépare aucun envoi de la copie');

const notices = [];
const openButtons = [];
function reviewNode(id) {
  const listeners = {};
  return {
    id,
    hidden: true,
    dataset: {},
    textContent: '',
    innerHTML: '',
    open: false,
    classList: {
      toggle(name, on) {
        this[name] = Boolean(on);
      },
      add(name) {
        this[name] = true;
      },
      remove(name) {
        this[name] = false;
      },
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    click() {
      (listeners.click || []).forEach((fn) => fn());
    },
    querySelectorAll(selector) {
      if (id === 'legacyHoldModal' && selector === '[data-close-modal]') return closeButtons;
      return [];
    },
  };
}
const vsNotice = reviewNode('vsLegacyHoldNotice');
const playersNotice = reviewNode('playersLegacyHoldNotice');
notices.push(vsNotice, playersNotice);
const vsButton = reviewNode('vsOpen');
const playersButton = reviewNode('playersOpen');
openButtons.push(vsButton, playersButton);
const closeButtons = [reviewNode('close')];
const dialog = reviewNode('legacyHoldModal');
const diffList = reviewNode('legacyHoldDiffList');
const diffEmpty = reviewNode('legacyHoldEmpty');
const diffMeta = reviewNode('legacyHoldMeta');
const nodesById = {
  legacyHoldModal: dialog,
  legacyHoldDiffList: diffList,
  legacyHoldEmpty: diffEmpty,
  legacyHoldMeta: diffMeta,
};
const previousGetElementById = sandbox.document.getElementById;
const previousQuerySelectorAll = sandbox.document.querySelectorAll;
sandbox.document.getElementById = (id) => nodesById[id] || null;
sandbox.document.querySelectorAll = (selector) => {
  if (selector === '[data-legacy-hold-notice]') return notices;
  if (selector === '[data-open-legacy-hold]') return openButtons;
  return [];
};
T.bindLegacyHoldReview();
assert(vsNotice.hidden === false && playersNotice.hidden === false, 'l’accès à la copie apparaît seulement quand elle existe');
vsButton.click();
assert(dialog.open === true, 'le bouton ouvre la consultation');
assert(diffList.innerHTML.includes('Le mardi de Alpha') && diffList.innerHTML.includes('6'), 'la fenêtre affiche la différence de score');
assert(!/restaur|synchron/i.test(diffList.innerHTML + diffMeta.textContent), 'la fenêtre ne propose ni restauration ni synchronisation');
assert(storage.getItem(T.CC_LEGACY_HOLD_KEY) === holdBeforeReview, 'ouvrir la fenêtre ne modifie pas la copie');
closeButtons[0].click();
assert(dialog.open === false, 'fermer la fenêtre la referme');
assert(storage.getItem(T.CC_LEGACY_HOLD_KEY) === holdBeforeReview, 'fermer la fenêtre conserve la copie');
storage.removeItem(T.CC_LEGACY_HOLD_KEY);
T.refreshLegacyHoldNotice();
assert(vsNotice.hidden === true && playersNotice.hidden === true, 'sans copie, l’accès reste caché et le VS habituel n’est pas encombré');
sandbox.document.getElementById = previousGetElementById;
sandbox.document.querySelectorAll = previousQuerySelectorAll;

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dialogHtml = indexHtml.slice(indexHtml.indexOf('id="legacyHoldModal"'), indexHtml.indexOf('id="confirmModal"'));
assert(dialogHtml.includes('Fermer') && !/restaur|synchron/i.test(dialogHtml), 'la fenêtre réelle n’a ni restauration ni synchronisation');
assert(indexHtml.includes('data-legacy-hold-notice'), 'l’écran prévoit un accès à la copie ancienne');

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
