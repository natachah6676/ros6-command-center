/**
 * Signalements hebdomadaires informatifs : oubli bouclier / difficulté ruche.
 * node scripts/test-weekly-flags.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const identityCode = fs.readFileSync(path.join(root, 'js/player-identity.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const playersCode = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');
const vsCode = fs.readFileSync(path.join(root, 'js/vs.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');
const tempeteCode = fs.readFileSync(path.join(root, 'js/tempete.js'), 'utf8');

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

const sandbox = {
  window: {},
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Set,
  Map,
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
  ROSSupabase: {
    getClient: () => ({ auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) } }),
  },
  AppUI: { toast() {}, confirm: async () => false },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
vm.runInContext(identityCode, sandbox);
vm.runInContext(syncCode, sandbox);
const M = sandbox.ROSModels;
const Identity = sandbox.ROSPlayerIdentity;
const T = sandbox.ROSSync.__test;

const actorA = { actorLabel: 'R4 A', actorUserId: 'user-a' };
const actorB = { actorLabel: 'R4 B', actorUserId: 'user-b' };
const week1 = new Date(2026, 8, 23, 10, 0, 0);
const week2 = new Date(2026, 8, 30, 10, 0, 0);
const WEEK1 = '2026-09-21';
const WEEK2 = '2026-09-28';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutFlags(state) {
  const copy = clone(state);
  delete copy.playerWeeklyFlags;
  return copy;
}

function freshPlayer(pseudo, extra = {}) {
  const player = M.createPlayer({ pseudo, role: 'Membre', status: 'Actif' });
  Object.assign(player, extra);
  return player;
}

function blankWith(player) {
  const state = M.createBlankState();
  state.players = [player];
  state.weeks = [];
  state.currentWeekId = null;
  return state;
}

console.log('\n=== Semaine calendaire, sans VS ===');
assert(M.calendarWeekKey(week1) === WEEK1, 'mercredi 23/09/2026 → lundi 2026-09-21');
assert(M.calendarWeekKey(week2) === WEEK2, 'mercredi 30/09/2026 → lundi 2026-09-28');
assert(M.calendarWeekKey(new Date(2026, 8, 27, 18, 0, 0)) === WEEK1, 'dimanche reste dans la semaine du lundi précédent');
assert(M.createBlankState().playerWeeklyFlags && Object.keys(M.createBlankState().playerWeeklyFlags).length === 0, 'état vide : map présente');

const willow = freshPlayer('Willow');
const state = blankWith(willow);
assert(!state.currentWeekId && state.weeks.length === 0, 'aucune semaine VS');

console.log('\n=== Pose / retrait / indépendance ===');
const before = withoutFlags(state);
const reasonsBefore = M.detectFollowUpReasons(willow, state);
let result = M.setPlayerWeeklyFlag(state, willow.id, 'shield', true, actorA, week1);
assert(result.changed === true, 'pose Bouclier');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'shield') === 1, 'compteur bouclier = 1');
assert(M.isPlayerWeeklyFlagActive(state, willow.id, 'shield', WEEK1), 'bouclier actif semaine 1');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'hive') === 0, 'ruche encore à 0');

result = M.setPlayerWeeklyFlag(state, willow.id, 'shield', true, actorB, week1);
assert(result.changed === false, 'double pose même semaine ignorée');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'shield') === 1, 'double pose = 1');
assert(Object.keys(state.playerWeeklyFlags[willow.id].shield).length === 1, 'une seule clé de semaine');
assert(
  state.playerWeeklyFlags[willow.id].shield[WEEK1].byUserId === 'user-a',
  'la seconde pose ne réécrit pas la première'
);

result = M.setPlayerWeeklyFlag(state, willow.id, 'hive', true, actorB, week1);
assert(result.changed === true, 'pose Ruche');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'hive') === 1, 'compteur ruche = 1');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'shield') === 1, 'bouclier inchangé par la ruche');

result = M.setPlayerWeeklyFlag(state, willow.id, 'hive', false, actorB, week1);
assert(result.changed === true, 'retrait Ruche');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'hive') === 0, 'ruche retirée ne compte plus');
const hiveCleared = M.getPlayerWeeklyFlag(state, willow.id, 'hive', WEEK1);
assert(hiveCleared && hiveCleared.at && hiveCleared.clearedAt, 'retrait ruche conserve la pose et clearedAt');
assert(hiveCleared.clearedByLabel === 'R4 B', 'clearedByLabel ruche');
assert(hiveCleared.clearedByUserId === 'user-b', 'clearedByUserId ruche');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'shield') === 1, 'retrait ruche n’affecte pas le bouclier');

result = M.setPlayerWeeklyFlag(state, willow.id, 'shield', true, actorA, week2);
assert(result.changed === true, 'nouvel oubli semaine 2');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'shield') === 2, 'compteur bouclier = 2');

result = M.setPlayerWeeklyFlag(state, willow.id, 'shield', false, actorA, week2);
assert(result.changed === true, 'retrait Bouclier semaine courante');
assert(M.countPlayerWeeklyFlags(state, willow.id, 'shield') === 1, 'la semaine retirée ne compte plus');
assert(M.isPlayerWeeklyFlagActive(state, willow.id, 'shield', WEEK1), 'historique semaine 1 conservé');
assert(!M.isPlayerWeeklyFlagActive(state, willow.id, 'shield', WEEK2), 'semaine 2 inactive');
const shieldCleared = M.getPlayerWeeklyFlag(state, willow.id, 'shield', WEEK2);
assert(shieldCleared.clearedAt && shieldCleared.clearedByUserId === 'user-a', 'retrait bouclier tracé');
assert(shieldCleared.at, 'la pose d’origine du bouclier reste');

const normalized = M.normalizeState(state);
assert(M.countPlayerWeeklyFlags(normalized, willow.id, 'shield') === 1, 'normalize conserve le compteur');
assert(
  normalized.playerWeeklyFlags[willow.id].shield[WEEK2].clearedAt === shieldCleared.clearedAt,
  'normalize conserve le retrait'
);

assert(JSON.stringify(withoutFlags(state)) === JSON.stringify(before), 'aucun autre champ du centre de commande modifié');
assert(
  JSON.stringify(M.detectFollowUpReasons(willow, state)) === JSON.stringify(reasonsBefore),
  'motifs de suivi inchangés'
);
assert(willow.status === 'Actif' && willow.absent === false, 'statut et absence inchangés par les signalements');
assert(!vsCode.includes('playerWeeklyFlags'), 'VS ne lit pas les signalements');
assert(!suiviCode.includes('playerWeeklyFlags'), 'suivi ne lit pas les signalements');
assert(!tempeteCode.includes('playerWeeklyFlags'), 'Tempête ne lit pas les signalements');

const flagFn = playersCode.slice(
  playersCode.indexOf('function setWeeklyFlag'),
  playersCode.indexOf('function setHeroPowerTier')
);
assert(!/VSModule|SuiviModule|TempeteModule|playerFollowUps|recrutement/.test(flagFn), 'l’action liste ne touche pas VS, suivi, Tempête ni recrutement');
assert(
  /setPlayerWeeklyFlag\(state, playerId, kind, active, actor\)/.test(flagFn),
  'la liste ne peut poser que la semaine courante'
);

console.log('\n=== Absent, Parti, renommage, réactivation ===');
const absent = freshPlayer('AbsentMaisActif', { absent: true });
const absentState = blankWith(absent);
result = M.setPlayerWeeklyFlag(absentState, absent.id, 'shield', true, actorA, week1);
assert(result.changed === true && absent.absent === true, 'joueur Absent Actif signalable');
assert(M.countPlayerWeeklyFlags(absentState, absent.id, 'shield') === 1, 'compteur bouclier de l’absent');

const gone = freshPlayer('PartiPlusTard');
const goneState = blankWith(gone);
M.setPlayerWeeklyFlag(goneState, gone.id, 'shield', true, actorA, week1);
M.setPlayerWeeklyFlag(goneState, gone.id, 'hive', true, actorA, week1);
gone.status = 'Parti';
gone.leftAt = '2026-09-24T08:00:00.000Z';
const flagsBeforeLeave = clone(goneState.playerWeeklyFlags);
result = M.setPlayerWeeklyFlag(goneState, gone.id, 'shield', true, actorA, week2);
assert(result.changed === false, 'joueur Parti non signalable');
assert(JSON.stringify(goneState.playerWeeklyFlags) === JSON.stringify(flagsBeforeLeave), 'historique intact après refus Parti');
assert(M.countPlayerWeeklyFlags(goneState, gone.id, 'shield') === 1, 'compteur bouclier visible après Parti');
assert(M.countPlayerWeeklyFlags(goneState, gone.id, 'hive') === 1, 'compteur ruche visible après Parti');

gone.status = 'Actif';
gone.leftAt = null;
assert(M.countPlayerWeeklyFlags(goneState, gone.id, 'shield') === 1, 'réactivation conserve le bouclier');
assert(M.countPlayerWeeklyFlags(goneState, gone.id, 'hive') === 1, 'réactivation conserve la ruche');
result = M.setPlayerWeeklyFlag(goneState, gone.id, 'hive', true, actorA, week2);
assert(result.changed === true && M.countPlayerWeeklyFlags(goneState, gone.id, 'hive') === 2, 'nouveau signalement possible après réactivation');

const renamed = freshPlayer('AncienNom');
const renameState = blankWith(renamed);
M.setPlayerWeeklyFlag(renameState, renamed.id, 'shield', true, actorA, week1);
const keptId = renamed.id;
const flagsOnId = clone(renameState.playerWeeklyFlags[keptId]);
renamed.pseudo = 'NouveauNom';
Identity.migrateMainState(renameState, { explicitPseudo: 'AncienNom', explicitPlayerId: keptId });
assert(renameState.players.filter((p) => p.id === keptId).length === 1, 'ID stable au renommage');
assert(M.countPlayerWeeklyFlags(renameState, keptId, 'shield') === 1, 'renommage conserve le compteur');
assert(!renameState.playerWeeklyFlags.AncienNom && !renameState.playerWeeklyFlags.NouveauNom, 'le pseudo n’est pas une clé');

const legacyPlayer = freshPlayer('AncienNom');
const pseudoKeyed = M.normalizeState({
  players: [legacyPlayer],
  weeks: [],
  currentWeekId: null,
  playerWeeklyFlags: { AncienNom: flagsOnId },
});
assert(pseudoKeyed.playerWeeklyFlags[legacyPlayer.id], 'ancienne clé pseudo rattachée à l’ID');
assert(!pseudoKeyed.playerWeeklyFlags.AncienNom, 'clé pseudo retirée');
assert(M.countPlayerWeeklyFlags(pseudoKeyed, legacyPlayer.id, 'shield') === 1, 'compteur conservé après migration pseudo');

console.log('\n=== Fusion sync ===');
function record(at, label, userId, clearedAt = '', clearedByLabel = '', clearedByUserId = '') {
  return {
    at,
    byLabel: label,
    byUserId: userId,
    clearedAt,
    clearedByLabel,
    clearedByUserId,
  };
}

const sameWeek = M.mergePlayerWeeklyFlags(
  { willow: { shield: { [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a') }, hive: {} } },
  { willow: { shield: { [WEEK1]: record('2026-09-23T11:00:00.000Z', 'R4 B', 'user-b') }, hive: {} } }
);
assert(Object.keys(sameWeek.willow.shield).length === 1, 'deux poses même incident → une clé');
assert(M.isWeeklyFlagActive(sameWeek.willow.shield[WEEK1]), 'l’incident fusionné reste actif');
assert(sameWeek.willow.shield[WEEK1].byUserId === 'user-b', 'la pose la plus récente est conservée');

const twoPlayers = M.mergePlayerWeeklyFlags(
  { willow: { shield: { [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a') }, hive: {} } },
  { oak: { hive: { [WEEK1]: record('2026-09-23T10:05:00.000Z', 'R4 B', 'user-b') }, shield: {} } }
);
assert(twoPlayers.willow && twoPlayers.oak, 'deux joueurs signalés restent tous les deux');
assert(M.isWeeklyFlagActive(twoPlayers.willow.shield[WEEK1]), 'bouclier de Willow conservé');
assert(M.isWeeklyFlagActive(twoPlayers.oak.hive[WEEK1]), 'ruche de Oak conservée');

const twoKinds = M.mergePlayerWeeklyFlags(
  { willow: { shield: { [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a') }, hive: {} } },
  { willow: { hive: { [WEEK1]: record('2026-09-23T10:05:00.000Z', 'R4 B', 'user-b') }, shield: {} } }
);
assert(M.isWeeklyFlagActive(twoKinds.willow.shield[WEEK1]), 'motif bouclier conservé');
assert(M.isWeeklyFlagActive(twoKinds.willow.hive[WEEK1]), 'motif ruche conservé');

const clearWins = M.mergePlayerWeeklyFlags(
  { willow: { shield: { [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a') }, hive: {} } },
  {
    willow: {
      shield: {
        [WEEK1]: record('2026-09-23T09:00:00.000Z', 'R4 A', 'user-a', '2026-09-23T12:00:00.000Z', 'R4 B', 'user-b'),
      },
      hive: {},
    },
  }
);
assert(!M.isWeeklyFlagActive(clearWins.willow.shield[WEEK1]), 'retrait plus récent que la pose → inactif');
assert(clearWins.willow.shield[WEEK1].at === '2026-09-23T10:00:00.000Z', 'la pose la plus récente est gardée à côté du retrait');
assert(clearWins.willow.shield[WEEK1].clearedAt === '2026-09-23T12:00:00.000Z', 'le retrait le plus récent est gardé');

const stale = M.mergePlayerWeeklyFlags(
  {
    willow: {
      shield: {
        [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a', '2026-09-23T15:00:00.000Z', 'R4 A', 'user-a'),
      },
      hive: {},
    },
  },
  { willow: { shield: { [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a') }, hive: {} } }
);
assert(!M.isWeeklyFlagActive(stale.willow.shield[WEEK1]), 'ancien cache sans retrait ne ressuscite pas');
assert(stale.willow.shield[WEEK1].clearedAt === '2026-09-23T15:00:00.000Z', 'clearedAt du remote conservé');

const tie = {
  at: '2026-09-23T10:00:00.000Z',
  byLabel: 'R4 A',
  byUserId: 'user-a',
  clearedAt: '2026-09-23T10:00:00.000Z',
  clearedByLabel: 'R4 A',
  clearedByUserId: 'user-a',
};
assert(!M.isWeeklyFlagActive(tie), 'égalité pose/retrait : le retrait l’emporte');

function cc(flags, players) {
  return {
    version: 1,
    players,
    weeks: [],
    currentWeekId: null,
    playerWeeklyFlags: flags,
    playerFollowUps: { willow: { status: 'to_contact', manual: true, reasons: { manual: true } } },
  };
}

const players = [
  { id: 'willow', pseudo: 'Willow', role: 'Membre', status: 'Actif' },
  { id: 'oak', pseudo: 'Oak', role: 'Membre', status: 'Actif' },
];
const remoteCc = cc(
  {
    willow: {
      shield: {
        [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a', '2026-09-23T15:00:00.000Z', 'R4 A', 'user-a'),
      },
      hive: {},
    },
  },
  players
);
const localCc = cc(
  {
    willow: { shield: { [WEEK1]: record('2026-09-23T10:00:00.000Z', 'R4 A', 'user-a') }, hive: {} },
    oak: { hive: { [WEEK1]: record('2026-09-23T11:00:00.000Z', 'R4 B', 'user-b') }, shield: {} },
  },
  players
);
const remoteData = { stores: { ros6_command_center_v1: remoteCc, ros6_tempete_v1: { archives: [{ id: 'storm-1' }] } } };

const pushed = T.buildPushPayload(remoteData, new Set(['ros6_command_center_v1']), {
  ros6_command_center_v1: localCc,
});
const pushedFlags = pushed.stores.ros6_command_center_v1.playerWeeklyFlags;
assert(!M.isWeeklyFlagActive(pushedFlags.willow.shield[WEEK1]), 'push : ancien cache ne ressuscite pas le retrait');
assert(M.isWeeklyFlagActive(pushedFlags.oak.hive[WEEK1]), 'push : signalement de l’autre joueur conservé');
assert(
  pushed.stores.ros6_command_center_v1.playerFollowUps.willow.status === 'to_contact',
  'push : suivi inchangé'
);
assert(pushed.stores.ros6_tempete_v1.archives[0].id === 'storm-1', 'push : Tempête distante intacte');
assert(pushed.stores.ros6_command_center_v1.currentWeekId == null, 'push : pas de semaine VS inventée');

sandbox.localStorage.setItem('ros6_command_center_v1', JSON.stringify(localCc));
const rebased = T.rebaseLocalAfterRemote(remoteData, new Set(['ros6_command_center_v1']));
const rebasedFlags = rebased.stores.ros6_command_center_v1.playerWeeklyFlags;
assert(!M.isWeeklyFlagActive(rebasedFlags.willow.shield[WEEK1]), 'rebase : ancien cache ne ressuscite pas le retrait');
assert(rebasedFlags.willow.shield[WEEK1].clearedAt === '2026-09-23T15:00:00.000Z', 'rebase : clearedAt remote conservé');
assert(M.isWeeklyFlagActive(rebasedFlags.oak.hive[WEEK1]), 'rebase : signalement local d’un autre joueur conservé');
assert(
  rebased.stores.ros6_command_center_v1.playerFollowUps.willow.manual === true,
  'rebase : suivi inchangé'
);

console.log('\n=== UI Liste des membres ===');
assert(playersCode.includes('Oubli bouclier :'), 'compteur Oubli bouclier');
assert(playersCode.includes('Difficulté ruche :'), 'compteur Difficulté ruche');
assert(playersCode.includes('data-kind="shield"'), 'case bouclier');
assert(playersCode.includes('data-kind="hive"'), 'case ruche');
assert((playersCode.match(/\$\{weeklyToggles\}/g) || []).length === 1, 'cases insérées une seule fois');
const interp = playersCode.indexOf('${weeklyToggles}');
const leaveBtn = playersCode.indexOf('Passer en Parti', interp);
const reactivateBtn = playersCode.indexOf('Réactiver', interp);
assert(interp > 0 && interp < leaveBtn && leaveBtn < reactivateBtn, 'cases uniquement dans la branche Actif');
assert(playersCode.includes("closest('.weekly-flag-toggle')"), 'clic case : stopPropagation');
assert(playersCode.includes('data-action="weekly-flag"'), 'change case branché');
assert(!playersCode.slice(playersCode.indexOf('function markAsLeft'), playersCode.indexOf('function reactivate')).includes('playerWeeklyFlags'), 'passage Parti ne touche pas les signalements');
assert(!playersCode.slice(playersCode.indexOf('function reactivate'), playersCode.indexOf('function setAbsent')).includes('playerWeeklyFlags'), 'réactivation ne touche pas les signalements');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
