/**
 * Tests Recrutement — fenêtre 8 semaines + pondération
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

console.log('\n=== UI / modules inchangés ===');
assert(html.includes('data-tab="recrutement"'), 'Onglet Recrutement');
assert(html.includes('minimum 30 points'), 'Seuil 30 points UI');
assert(command.includes('Absents (${absents.length})'), 'Compteur Absents');
assert(train.includes('getVipDrawExclusionStats'), 'Stats exclusions tirage');

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

function makeWeek(id, number, startDate, archived) {
  const week = ROSModels.createWeek(new Date(startDate), { number, archived });
  week.id = id;
  week.archived = archived;
  week.startDate = startDate;
  week.label = `Semaine ${number}`;
  return week;
}

function setTotalPoints(score, total) {
  ROSModels.DAYS.forEach((d) => {
    score.days[d.key] = 0;
  });
  score.days.lundi = total;
  score.allianceDonMissed = false;
}

assert(Recrutement.WINDOW_SIZE === 8, 'WINDOW_SIZE 8');
assert(Recrutement.MIN_SCORE === 30, 'MIN_SCORE 30');
assert(Recrutement.weightForRank(1) === 1, 'Rang 1 = 100%');
assert(Recrutement.weightForRank(3) === 0.75, 'Rang 3 = 75%');
assert(Recrutement.weightForRank(6) === 0.5, 'Rang 6 = 50%');

// 9 semaines archivées + 1 courante → seules les 8 plus récentes comptent
const archived = [];
for (let i = 1; i <= 9; i += 1) {
  archived.push(makeWeek(`w${i}`, i, `2026-0${Math.min(9, i)}-0${((i - 1) % 9) + 1}`, true));
}
// Dates croissantes correctes
const dates = [
  '2026-01-06',
  '2026-01-13',
  '2026-01-20',
  '2026-01-27',
  '2026-02-03',
  '2026-02-10',
  '2026-02-17',
  '2026-02-24',
  '2026-03-03',
];
archived.forEach((w, i) => {
  w.startDate = dates[i];
  w.number = i + 1;
  w.label = `Semaine ${i + 1}`;
});
const wCurrent = makeWeek('wCurrent', 10, '2026-03-10', false);

const ani = ROSModels.createPlayer({
  pseudo: 'Ani Bulgaria',
  role: 'Membre',
  inactive: true,
  coachingException: 'never',
  heroPowerTierId: 'tier_50_55',
});
const agent = ROSModels.createPlayer({
  pseudo: 'Agent0003',
  role: 'Membre',
  absent: true,
});
const r5 = ROSModels.createPlayer({ pseudo: 'R5Boss', role: 'R5', inactive: true });
const low = ROSModels.createPlayer({ pseudo: 'LowScore', role: 'Membre' });

// Fenêtre (plus récentes d’abord) = w9..w2 ; w1 sort
// Ani : rang1(w9)=25×1, rang3(w7)=20×0.75=15, rang6(w4)=15×0.5=7.5 → 47.5 + inactif 40 = 87.5
setTotalPoints((archived[8].scores[ani.id] = ROSModels.createEmptyScore()), 25); // w9 rank1
setTotalPoints((archived[6].scores[ani.id] = ROSModels.createEmptyScore()), 20); // w7 rank3
setTotalPoints((archived[3].scores[ani.id] = ROSModels.createEmptyScore()), 15); // w4 rank6
// Vieille semaine hors fenêtre (w1) — ne doit pas compter
setTotalPoints((archived[0].scores[ani.id] = ROSModels.createEmptyScore()), 100);
// Semaine courante — ne doit pas compter
setTotalPoints((wCurrent.scores[ani.id] = ROSModels.createEmptyScore()), 50);

// LowScore : 20 pts rang1 → 20 < 30
setTotalPoints((archived[8].scores[low.id] = ROSModels.createEmptyScore()), 20);

// Agent absent exclu
setTotalPoints((archived[8].scores[agent.id] = ROSModels.createEmptyScore()), 40);

sandbox.__state = {
  ...ROSModels.createBlankState(),
  currentWeekId: wCurrent.id,
  weeks: [...archived, wCurrent],
  coachingThreshold: { min: 25, max: 30 },
  vsSettings: {
    mode: 'eco',
    eco: { redFrom: 30, dailyGoal: 3600000, underPoints: 10, donationPenalty: 5 },
    afond: { redFrom: 36, dailyGoal: 7200000, donationPenalty: 5 },
  },
  players: [ani, agent, r5, low],
};

console.log('\n=== Fenêtre glissante ===');
const windowWeeks = Recrutement.getScoringWeeks(sandbox.__state);
assert(windowWeeks.length === 8, `8 semaines (got ${windowWeeks.length})`);
assert(windowWeeks[0].id === 'w9', 'Plus récente = w9');
assert(windowWeeks[7].id === 'w2', '8e = w2');
assert(!windowWeeks.some((w) => w.id === 'w1'), 'w1 hors fenêtre');
assert(!windowWeeks.some((w) => w.id === 'wCurrent'), 'Courante exclue');

console.log('\n=== Pondération Ani ===');
const aniRow = Recrutement.scorePlayer(ani, sandbox.__state);
assert(aniRow.realScore === 87.5, `Réel 87.5 (got ${aniRow.realScore})`);
assert(aniRow.displayedScore === 88, `Affiché 88 (got ${aniRow.displayedScore})`);
assert(aniRow.inactivePoints === 40, 'Inactif +40');
assert(aniRow.coachingPoints === 0, 'Pas de coaching');
assert(aniRow.weekDetails.length === 3, '3 semaines avec données');
assert(aniRow.weekDetails[0].weighted === 25, '25×100%');
assert(aniRow.weekDetails[1].weighted === 15, '20×75%');
assert(aniRow.weekDetails[2].weighted === 7.5, '15×50%');
assert(aniRow.priority.level === 'high', 'Priorité élevée');

console.log('\n=== Exclusions & seuil ===');
assert(Recrutement.isExcludedFromRecruitment(agent), 'Absent exclu');
assert(Recrutement.isExcludedFromRecruitment(r5), 'R5 exclu');
const rows = Recrutement.getReplacementCandidates(sandbox.__state);
assert(rows.every((r) => r.realScore >= 30), 'Seuil ≥ 30');
assert(rows.some((r) => r.player.pseudo === 'Ani Bulgaria'), 'Ani listée');
assert(!rows.some((r) => r.player.pseudo === 'Agent0003'), 'Agent absent non listé');
assert(!rows.some((r) => r.player.pseudo === 'LowScore'), 'LowScore < 30 masqué');
assert(!rows.some((r) => r.player.role === 'R5'), 'Pas de R5');

console.log('\n=== Mise à jour auto nouvelle archive ===');
// Archiver la semaine courante → devient la plus récente ; w2 sort
wCurrent.archived = true;
sandbox.__state.currentWeekId = 'wNew';
sandbox.__state.weeks.push(makeWeek('wNew', 11, '2026-03-17', false));
const after = Recrutement.getScoringWeeks(sandbox.__state);
assert(after[0].id === 'wCurrent', 'Nouvelle archive en tête');
assert(!after.some((w) => w.id === 'w2'), 'w2 sort automatiquement');
assert(after.length === 8, 'Toujours 8 semaines');
const aniAfter = Recrutement.scorePlayer(ani, sandbox.__state);
// wCurrent (rank1) 50×1 + w9(rank2) 25×1 + w7(rank4) 20×0.75=15 + w4(rank7) 15×0.5=7.5 + inactif 40
assert(aniAfter.realScore === 137.5, `Score mis à jour 137.5 (got ${aniAfter.realScore})`);

console.log('\n=== Exemple pondération cahier ===');
// 25×100 + 20×75 + 15×50 = 25+15+7.5 = 47.5
const demo = ROSModels.createPlayer({
  pseudo: 'Demo',
  role: 'Membre',
  coachingException: 'never',
  heroPowerTierId: 'tier_50_55',
});
const dWeeks = [];
for (let i = 0; i < 8; i += 1) {
  dWeeks.push(makeWeek(`d${i}`, i + 1, `2026-04-${String(i + 1).padStart(2, '0')}`, true));
}
// rank1=d7, rank3=d5, rank6=d2
setTotalPoints((dWeeks[7].scores[demo.id] = ROSModels.createEmptyScore()), 25);
setTotalPoints((dWeeks[5].scores[demo.id] = ROSModels.createEmptyScore()), 20);
setTotalPoints((dWeeks[2].scores[demo.id] = ROSModels.createEmptyScore()), 15);
const demoState = {
  ...sandbox.__state,
  currentWeekId: 'dCur',
  weeks: [...dWeeks, makeWeek('dCur', 9, '2026-04-20', false)],
  players: [demo],
};
const demoRow = Recrutement.scorePlayer(demo, demoState);
assert(demoRow.realScore === 47.5, `Exemple 47.5 (got ${demoRow.realScore})`);
assert(demoRow.displayedScore === 48, 'Exemple affiché 48');
assert(demoRow.priority.level === 'medium', 'Priorité moyenne 30–49');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
