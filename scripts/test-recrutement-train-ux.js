/**
 * Tests Absents / Train exclusions / Recrutement
 * node scripts/test-recrutement-train-ux.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const command = fs.readFileSync(path.join(root, 'js/command.js'), 'utf8');
const train = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const recrutementCode = fs.readFileSync(path.join(root, 'js/recrutement.js'), 'utf8');

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

console.log('\n=== Absents UI ===');
assert(html.includes('id="commandAbsentsTitle"'), 'Titre Absents dynamique');
assert(html.includes('Joueurs marqués absents'), 'Sous-titre Absents simplifié');
assert(!html.includes('Ignorés du VS · exclus des futurs tirages Train'), 'Ancien sous-titre retiré');
assert(command.includes('Absents (${absents.length})'), 'Compteur dans le titre');

console.log('\n=== Train exclusions / manuel ===');
assert(train.includes('getVipDrawExclusionStats'), 'Stats exclusions tirage');
assert(train.includes('isEligibleForWeekConductor'), 'Éligibilité conducteur');
assert(html.includes('id="trainVipExclusionStats"'), 'Encart exclusions HTML');
assert(train.includes('Joueurs exclus du tirage'), 'Libellé exclusions');
assert(train.includes('conductorDayOptions'), 'Select conducteur éligible');
assert(train.includes("vipMode = value ? 'manuel'"), 'VIP manuel');

console.log('\n=== Recrutement UI ===');
assert(html.includes('data-tab="recrutement"'), 'Onglet Recrutement');
assert(html.includes('id="panel-recrutement"'), 'Panneau Recrutement');
assert(html.includes('js/recrutement.js'), 'Script recrutement');
assert(recrutementCode.includes('RECRUITMENT_CRITERIA'), 'Critères évolutifs');

const sandbox = {
  window: {},
  console,
  ROSStorage: {
    getState() {
      return sandbox.__state;
    },
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(recrutementCode, sandbox);
const Recrutement = sandbox.window.RecrutementModule;
const ROSModels = sandbox.window.ROSModels;

const week1 = ROSModels.createWeek(new Date('2026-08-03'), { number: 1 });
const week2 = ROSModels.createWeek(new Date('2026-07-27'), { number: 2 });
week2.id = 'w2';
week1.id = 'w1';

function makeScore(totalHint, donationMissed = false) {
  // Rouge si total élevé — midPoints default etc. Use day points to hit red
  const score = ROSModels.createEmptyScore();
  score.days.lundi = 12;
  score.days.mardi = 12;
  score.days.mercredi = 12;
  score.days.jeudi = 12;
  score.days.vendredi = 12;
  score.allianceDonMissed = donationMissed;
  return score;
}

sandbox.__state = {
  ...ROSModels.createBlankState(),
  currentWeekId: week1.id,
  weeks: [week1, week2],
  coachingThreshold: { min: 25, max: 30 },
  players: [
    ROSModels.createPlayer({
      pseudo: 'Pierre',
      role: 'Membre',
      inactive: true,
      heroPowerTierId: 'tier_25_30',
    }),
    ROSModels.createPlayer({ pseudo: 'R5Boss', role: 'R5' }),
    ROSModels.createPlayer({ pseudo: 'Ghost', role: 'Membre', absent: true, inactive: true }),
    ROSModels.createPlayer({ pseudo: 'OkPlayer', role: 'Membre' }),
    ROSModels.createPlayer({ pseudo: 'PartiOne', role: 'Membre', status: 'Parti', inactive: true }),
  ],
};

const pierre = sandbox.__state.players.find((p) => p.pseudo === 'Pierre');
week1.scores[pierre.id] = makeScore(60, true);
week2.scores[pierre.id] = makeScore(60, true);

console.log('\n=== Recrutement scoring ===');
assert(Recrutement.isExcludedFromRecruitment(sandbox.__state.players[1]), 'R5 exclu');
assert(Recrutement.isExcludedFromRecruitment(sandbox.__state.players[2]), 'Absent exclu');
assert(Recrutement.isExcludedFromRecruitment(sandbox.__state.players[4]), 'Parti exclu');

const rows = Recrutement.getReplacementCandidates(sandbox.__state);
assert(rows.length >= 1, 'Au moins un candidat');
assert(rows[0].player.pseudo === 'Pierre', 'Pierre en tête');
assert(rows[0].score >= 70, `Score Pierre ≥ 70 (got ${rows[0].score})`);
assert(
  rows[0].reasons.some((r) => r.id === 'inactive'),
  'Raison Inactif'
);
assert(
  rows[0].reasons.some((r) => r.id === 'vs_red_2'),
  'Raison VS rouge'
);
assert(
  rows.every((r) => r.score > 0),
  'Aucun score 0 affiché'
);
assert(
  !rows.some((r) => r.player.pseudo === 'OkPlayer'),
  'Score 0 non listé'
);

const criteriaIds = Recrutement.RECRUITMENT_CRITERIA.map((c) => c.id);
assert(criteriaIds.includes('inactive'), 'Critère inactive');
assert(criteriaIds.includes('vs_red_2'), 'Critère VS');
assert(criteriaIds.includes('donations_red_2'), 'Critère dons');
assert(criteriaIds.includes('coaching_p1'), 'Critère coaching');

console.log('\n=== Modèle inactive ===');
const p = ROSModels.createPlayer({ pseudo: 'Test', inactive: true });
assert(p.inactive === true, 'createPlayer inactive');
const norm = ROSModels.normalizeState({
  players: [{ id: 'x', pseudo: 'X', inactive: true }],
  weeks: [ROSModels.createWeek(1)],
});
assert(norm.players[0].inactive === true, 'normalize inactive');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
