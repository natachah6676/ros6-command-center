/**
 * Tests Recrutement — somme des totaux Archives (computeTotal)
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

console.log('\n=== Absents / Train (inchangés) ===');
assert(html.includes('id="commandAbsentsTitle"'), 'Titre Absents dynamique');
assert(html.includes('Joueurs marqués absents'), 'Sous-titre Absents');
assert(command.includes('Absents (${absents.length})'), 'Compteur Absents');
assert(train.includes('getVipDrawExclusionStats'), 'Stats exclusions tirage');
assert(html.includes('data-tab="recrutement"'), 'Onglet Recrutement');
assert(html.includes('minimum 15 points'), 'Seuil 15 points UI');

const sandbox = {
  window: {},
  console: {
    log() {},
    error: console.error,
  },
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
  return week;
}

function setDayPoints(score, pointsPerDay) {
  ROSModels.DAYS.forEach((d) => {
    score.days[d.key] = pointsPerDay;
  });
}

const w1 = makeWeek('w1', 1, '2026-07-06', true);
const w2 = makeWeek('w2', 2, '2026-07-13', true);
const w3 = makeWeek('w3', 3, '2026-07-20', true);
const wCurrent = makeWeek('wCurrent', 4, '2026-07-27', false);

const pierre = ROSModels.createPlayer({
  pseudo: 'Pierre',
  role: 'Membre',
  inactive: true,
  heroPowerTierId: 'tier_25_30',
});
const okPlayer = ROSModels.createPlayer({ pseudo: 'OkPlayer', role: 'Membre' });
const r5 = ROSModels.createPlayer({ pseudo: 'R5Boss', role: 'R5', inactive: true });
const agent = ROSModels.createPlayer({
  pseudo: 'Agent0003',
  role: 'Membre',
  absent: true,
  heroPowerTierId: 'tier_50_55',
});
const parti = ROSModels.createPlayer({
  pseudo: 'PartiOne',
  role: 'Membre',
  status: 'Parti',
  inactive: true,
});
const ani = ROSModels.createPlayer({
  pseudo: 'Ani Bulgaria',
  role: 'Membre',
  heroPowerTierId: 'tier_35_40',
});

// Pierre : totaux Archives 60(+5 don)=65, 25, 0(+5)=5, courante 60(+5)=65
w1.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(w1.scores[pierre.id], 12);
w1.scores[pierre.id].allianceDonMissed = true;

w2.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(w2.scores[pierre.id], 5);

w3.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(w3.scores[pierre.id], 0);
w3.scores[pierre.id].allianceDonMissed = true;

wCurrent.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(wCurrent.scores[pierre.id], 12);
wCurrent.scores[pierre.id].allianceDonMissed = true;

// OkPlayer : 5 pts seulement → masqué
w2.scores[okPlayer.id] = ROSModels.createEmptyScore();
okPlayer.heroPowerTierId = 'tier_50_55';
setDayPoints(w2.scores[okPlayer.id], 1);
w2.scores[okPlayer.id].days.lundi = 5;
ROSModels.DAYS.forEach((d) => {
  if (d.key !== 'lundi') w2.scores[okPlayer.id].days[d.key] = 0;
});

// Ani : 15 + 20 (semaine courante) = 35
w1.scores[ani.id] = ROSModels.createEmptyScore();
w1.scores[ani.id].days.lundi = 5;
w1.scores[ani.id].days.mercredi = 10;
wCurrent.scores[ani.id] = ROSModels.createEmptyScore();
wCurrent.scores[ani.id].days.mardi = 10;
wCurrent.scores[ani.id].days.mercredi = 10;

// Agent0003 : 25 pts (absent mais doit apparaître)
w1.scores[agent.id] = ROSModels.createEmptyScore();
setDayPoints(w1.scores[agent.id], 5);

sandbox.__state = {
  ...ROSModels.createBlankState(),
  currentWeekId: wCurrent.id,
  weeks: [w1, w2, w3, wCurrent],
  coachingThreshold: { min: 25, max: 30 },
  vsSettings: {
    mode: 'eco',
    eco: { redFrom: 30, dailyGoal: 3600000, underPoints: 10, donationPenalty: 5 },
    afond: { redFrom: 36, dailyGoal: 7200000, donationPenalty: 5 },
  },
  players: [pierre, okPlayer, r5, agent, parti, ani],
};

console.log('\n=== Semaines (source Archives) ===');
const weeks = Recrutement.getArchivedWeeks(sandbox.__state);
assert(weeks.length === 4, `4 semaines comme Archives (got ${weeks.length})`);
assert(weeks.some((w) => w.id === 'wCurrent'), 'Semaine courante incluse (comme Archives)');

console.log('\n=== Cas Ani Bulgaria / Agent0003 ===');
const aniRow = Recrutement.scorePlayer(ani, sandbox.__state);
assert(aniRow.vsPoints === 35, `Ani VS 35 (got ${aniRow.vsPoints})`);
assert(aniRow.score === 35, `Ani total 35 (got ${aniRow.score})`);

const agentRow = Recrutement.scorePlayer(agent, sandbox.__state);
assert(agentRow.vsPoints === 25, `Agent VS 25 (got ${agentRow.vsPoints})`);
assert(!Recrutement.isExcludedFromRecruitment(agent), 'Agent absent non exclu');
assert(agentRow.score >= 15, 'Agent ≥ 15');

console.log('\n=== Score cumulatif Pierre ===');
const scored = Recrutement.scorePlayer(pierre, sandbox.__state);
// Jours: 60+25+0+60 = 145 ; dons pénalité: 5+0+5+5 = 15 ; inactif 40 ; coaching 10
assert(scored.vsPoints === 145, `VS jours 145 (got ${scored.vsPoints})`);
assert(scored.donationPoints === 15, `Dons pénalité 15 (got ${scored.donationPoints})`);
assert(scored.inactivePoints === 40, 'Inactif +40');
assert(scored.coachingPoints === 10, 'Coaching +10');
assert(scored.score === 210, `Total 210 (got ${scored.score})`);
assert(scored.weeksCounted === 4, '4 semaines avec données');

console.log('\n=== Exclusions & seuil ===');
assert(Recrutement.isExcludedFromRecruitment(r5), 'R5 exclu');
assert(Recrutement.isExcludedFromRecruitment(parti), 'Parti exclu');

const rows = Recrutement.getReplacementCandidates(sandbox.__state);
assert(rows.every((r) => r.score >= 15), 'Seuil ≥ 15');
assert(rows.some((r) => r.player.pseudo === 'Ani Bulgaria'), 'Ani dans la liste');
assert(rows.some((r) => r.player.pseudo === 'Agent0003'), 'Agent0003 dans la liste');
assert(!rows.some((r) => r.player.pseudo === 'OkPlayer'), 'OkPlayer < 15 masqué');
assert(!rows.some((r) => r.player.role === 'R5'), 'Pas de R5 listé');

const aniListed = rows.find((r) => r.player.pseudo === 'Ani Bulgaria');
assert(aniListed && aniListed.score === 35, 'Ani listée à 35');

console.log('\n=== API module ===');
assert(typeof Recrutement.aggregateHistoryScore === 'function', 'aggregateHistoryScore');
assert(Recrutement.MIN_SCORE === 15, 'MIN_SCORE 15');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
