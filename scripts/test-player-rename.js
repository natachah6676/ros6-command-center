/**
 * Renommage joueur : identité stable et données rattachées à l'ID.
 * Format VS actuel : brackets + marqueurs 0/1, pas les anciens points 5/10.
 * node scripts/test-player-rename.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const identityCode = fs.readFileSync(path.join(root, 'js/player-identity.js'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

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

const sandbox = { window: {}, console, Date, Math, JSON, String, Number, Boolean, Array, Object };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(identityCode, sandbox);
const M = sandbox.ROSModels;
const Identity = sandbox.ROSPlayerIdentity;

const OLD_PSEUDO = 'AncienPseudoTest';
const NEW_PSEUDO = 'NouveauPseudoTest';

function scoreWithBrackets(brackets) {
  const score = M.createEmptyScore();
  Object.keys(brackets).forEach((day) => {
    score.dayBrackets[day] = brackets[day];
    score.days[day] = M.pointsForBracket(brackets[day]);
  });
  return score;
}

console.log('\nDémarrage');
assert(!appCode.includes('runRenameIntegrityTest'), 'app.js n’appelle plus le test de renommage');
assert(
  !appCode.includes('Alerte: le test automatique de renommage a échoué'),
  'toast de démarrage retiré'
);
assert(!identityCode.includes('runRenameIntegrityTest'), 'le contrôle n’est plus dans le module identité');
assert(typeof Identity.migrateMainState === 'function', 'migration de renommage toujours exposée');

console.log('\nMigration pseudo → ID, format VS actuel');
const player = M.createPlayer({ pseudo: OLD_PSEUDO, role: 'Membre' });
const other = M.createPlayer({ pseudo: 'AutreJoueur', role: 'Membre' });
const playerId = player.id;
const otherId = other.id;
const week = M.createWeek(new Date('2026-09-21'), { number: 4 });
const legacyScore = scoreWithBrackets({ lundi: 'low', mardi: 'mid' });
const otherScore = scoreWithBrackets({ jeudi: 'high' });
week.scores[OLD_PSEUDO] = legacyScore;
week.scores[otherId] = otherScore;

const raw = {
  version: 1,
  appRole: 'R5',
  players: [player, other],
  weeks: [week],
  currentWeekId: week.id,
  vsSettings: M.createDefaultVsSettings(),
  ui: { completedActionsByDate: {} },
  powerTiers: M.createDefaultPowerTiers(),
  playerWeekNotes: {
    [OLD_PSEUDO]: {
      [week.id]: { comment: 'note semaine', conducteur: '', vip: '', saison: '' },
    },
  },
  playerFollowUps: {
    [OLD_PSEUDO]: {
      status: 'in_progress',
      manual: true,
      reasons: { manual: true },
    },
  },
  playerFollowUpNotes: {
    [OLD_PSEUDO]: {
      notes: [
        {
          id: 'note_rename_1',
          at: '2026-09-22T10:00:00.000Z',
          text: 'commentaire joueur',
          authorLabel: 'R4',
          eventType: 'comment',
        },
      ],
    },
  },
  playerWeeklyFlags: {
    [OLD_PSEUDO]: {
      shield: {
        '2026-09-21': {
          at: '2026-09-23T10:00:00.000Z',
          byLabel: 'R4',
          byUserId: 'u1',
          clearedAt: '',
          clearedByLabel: '',
          clearedByUserId: '',
        },
      },
      hive: {
        '2026-09-21': {
          at: '2026-09-23T11:00:00.000Z',
          byLabel: 'R5',
          byUserId: 'u2',
          clearedAt: '2026-09-23T12:00:00.000Z',
          clearedByLabel: 'R5',
          clearedByUserId: 'u2',
        },
      },
    },
  },
};

let state = M.normalizeState(raw);
const weekAfter = state.weeks.find((w) => w.id === week.id);
const attached = weekAfter.scores[playerId];

assert(state.players.filter((p) => p.id === playerId).length === 1, 'un seul joueur pour cet ID');
assert(state.players.length === 2, 'aucun joueur supplémentaire à la migration');
assert(!weekAfter.scores[OLD_PSEUDO], 'clé VS au pseudo migrée');
assert(attached, 'score VS rattaché à l’ID');
assert(attached.dayBrackets.lundi === 'low', 'bracket lundi low conservé');
assert(attached.dayBrackets.mardi === 'mid', 'bracket mardi mid conservé');
assert(attached.days.lundi === M.pointsForBracket('low'), 'marqueur lundi = format actuel');
assert(attached.days.mardi === M.pointsForBracket('mid'), 'marqueur mardi = format actuel');
assert(
  Object.values(attached.days).every((value) => value === 0 || value === 1),
  'jours VS uniquement en marqueurs 0/1'
);
assert(weekAfter.scores[otherId].dayBrackets.jeudi === 'high', 'score d’un autre joueur intact');
assert(state.playerWeekNotes[playerId][week.id].comment === 'note semaine', 'note de semaine sur l’ID');
assert(!state.playerWeekNotes[OLD_PSEUDO], 'note de semaine plus indexée par le pseudo');
assert(state.playerFollowUps[playerId].status === 'in_progress', 'suivi rattaché à l’ID');
assert(state.playerFollowUps[playerId].reasons.manual === true, 'motif manuel du suivi conservé');
assert(!state.playerFollowUps[playerId].episodeId, 'pas d’episodeId inventé');
assert(!state.playerFollowUps[OLD_PSEUDO], 'suivi plus indexé par le pseudo');
assert(
  state.playerFollowUpNotes[playerId].notes.some((n) => n.text === 'commentaire joueur'),
  'commentaire de suivi rattaché à l’ID'
);
assert(!state.playerFollowUpNotes[OLD_PSEUDO], 'ledger plus indexé par le pseudo');
assert(
  state.playerWeeklyFlags[playerId].shield['2026-09-21'].at === '2026-09-23T10:00:00.000Z',
  'oubli bouclier rattaché à l’ID'
);
assert(!state.playerWeeklyFlags[OLD_PSEUDO], 'signalements plus indexés par le pseudo');
assert(M.countPlayerWeeklyFlags(state, playerId, 'shield') === 1, 'compteur bouclier après migration');
assert(M.countPlayerWeeklyFlags(state, playerId, 'hive') === 0, 'ruche retirée ne compte pas');
assert(
  state.playerWeeklyFlags[playerId].hive['2026-09-21'].clearedAt === '2026-09-23T12:00:00.000Z',
  'retrait ruche conservé après migration'
);

console.log('\nRenommage');
const beforeCount = state.players.length;
const renamed = state.players.find((p) => p.id === playerId);
renamed.pseudo = NEW_PSEUDO;
Identity.migrateMainState(state, {
  explicitPseudo: OLD_PSEUDO,
  explicitPlayerId: playerId,
});

assert(state.players.length === beforeCount, 'aucun doublon créé au renommage');
assert(state.players.filter((p) => p.id === playerId).length === 1, 'ID stable');
assert(!state.players.some((p) => p.id === NEW_PSEUDO || p.id === OLD_PSEUDO), 'le pseudo n’est pas devenu un ID');
assert(Identity.getDisplayName(state, playerId) === NEW_PSEUDO, 'affichage = nouveau pseudo');
assert(state.weeks.find((w) => w.id === week.id).scores[playerId].dayBrackets.lundi === 'low', 'VS toujours sur l’ID');
assert(state.playerWeekNotes[playerId][week.id].comment === 'note semaine', 'note toujours sur l’ID');
assert(state.playerFollowUps[playerId].status === 'in_progress', 'suivi toujours sur l’ID');
assert(
  state.playerFollowUpNotes[playerId].notes.some((n) => n.id === 'note_rename_1'),
  'commentaire toujours sur l’ID'
);
assert(
  state.playerWeeklyFlags[playerId].shield['2026-09-21'].byUserId === 'u1',
  'signalements toujours sur l’ID après renommage'
);
assert(M.countPlayerWeeklyFlags(state, playerId, 'shield') === 1, 'compteur bouclier inchangé au renommage');
assert(state.weeks.find((w) => w.id === week.id).scores[otherId], 'l’autre joueur n’est pas touché');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
