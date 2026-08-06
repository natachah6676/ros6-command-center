/**
 * Tests Recrutement — fenetre 8 semaines + ponderation (compat)
 * node scripts/test-recrutement-train-ux.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const recrutementCode = fs.readFileSync(path.join(root, 'js/recrutement.js'), 'utf8');

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

console.log('\n=== UI ===');
assert(html.includes('data-tab="recrutement"'), 'Onglet Recrutement');
assert(html.includes('minimum 15 points'), 'Seuil 15 points UI');
assert(html.includes('playerGlobalPower'), 'Puissance globale UI');

const sandbox = {
  window: {},
  console,
  ROSStorage: {
    getState() {
      return sandbox.__state;
    },
  },
  ROSProfiles: {
    isActiveR5() {
      return true;
    },
    getAppRole() {
      return 'R5';
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
assert(Recrutement.MIN_SCORE === 15, 'MIN_SCORE 15');

const archived = [];
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
for (let i = 0; i < 9; i += 1) {
  const w = makeWeek(`w${i + 1}`, i + 1, dates[i], true);
  archived.push(w);
}
const wCurrent = makeWeek('wCurrent', 10, '2026-03-10', false);

const ani = ROSModels.createPlayer({
  pseudo: 'Ani Bulgaria',
  role: 'Membre',
  inactive: true,
  coachingException: 'never',
  heroPowerTierId: 'tier_50_55',
  globalPowerTierId: 'gp_lt_45',
});
const agent = ROSModels.createPlayer({
  pseudo: 'Agent0003',
  role: 'Membre',
  absent: true,
  globalPowerTierId: 'gp_ge_200',
});
const r5 = ROSModels.createPlayer({ pseudo: 'R5Boss', role: 'R5', inactive: true });
const low = ROSModels.createPlayer({
  pseudo: 'LowScore',
  role: 'Membre',
  globalPowerTierId: 'gp_ge_200',
});

setTotalPoints((archived[8].scores[ani.id] = ROSModels.createEmptyScore()), 25);
setTotalPoints((archived[6].scores[ani.id] = ROSModels.createEmptyScore()), 20);
setTotalPoints((archived[3].scores[ani.id] = ROSModels.createEmptyScore()), 15);
setTotalPoints((archived[0].scores[ani.id] = ROSModels.createEmptyScore()), 100);
setTotalPoints((wCurrent.scores[ani.id] = ROSModels.createEmptyScore()), 50);
setTotalPoints((archived[8].scores[low.id] = ROSModels.createEmptyScore()), 0);
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

console.log('\n=== Fenetre + score ===');
const windowWeeks = Recrutement.getScoringWeeks(sandbox.__state);
assert(windowWeeks.length === 8, '8 semaines');
const aniRow = Recrutement.scorePlayer(ani, sandbox.__state);
// 25+15+7.5 + inactif 40 + power weak (only 2 ranked: ani weak, low strong) 
assert(aniRow.inactivePoints === 40, 'Inactif +40');
assert(aniRow.realScore >= 15, 'Ani >= 15');
assert(Recrutement.isExcludedFromRecruitment(agent), 'Absent exclu');
assert(Recrutement.isExcludedFromRecruitment(r5), 'R5 exclu');

const rows = Recrutement.getReplacementCandidates(sandbox.__state);
assert(rows.every((r) => r.realScore >= 15), 'Seuil >= 15');
assert(rows.some((r) => r.player.pseudo === 'Ani Bulgaria'), 'Ani listee');
assert(!rows.some((r) => r.player.pseudo === 'Agent0003'), 'Agent absent non liste');

console.log('\n=== Resultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
