/**
 * Tests Recrutement — score cumulatif historique archivé
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
  return week;
}

function setDayPoints(score, pointsPerDay) {
  ROSModels.DAYS.forEach((d) => {
    score.days[d.key] = pointsPerDay;
  });
}

// Semaine 1 archivée : VS rouge (5*12=60), dons manqués
const w1 = makeWeek('w1', 1, '2026-07-06', true);
// Semaine 2 archivée : VS orange (~30–35), dons OK
const w2 = makeWeek('w2', 2, '2026-07-13', true);
// Semaine 3 archivée : VS vert, dons manqués
const w3 = makeWeek('w3', 3, '2026-07-20', true);
// Semaine courante (non comptée)
const wCurrent = makeWeek('wCurrent', 4, '2026-07-27', false);

const pierre = ROSModels.createPlayer({
  pseudo: 'Pierre',
  role: 'Membre',
  inactive: true,
  heroPowerTierId: 'tier_25_30',
});
const okPlayer = ROSModels.createPlayer({ pseudo: 'OkPlayer', role: 'Membre' });
const r5 = ROSModels.createPlayer({ pseudo: 'R5Boss', role: 'R5', inactive: true });
const absent = ROSModels.createPlayer({
  pseudo: 'Ghost',
  role: 'Membre',
  absent: true,
  inactive: true,
});
const parti = ROSModels.createPlayer({
  pseudo: 'PartiOne',
  role: 'Membre',
  status: 'Parti',
  inactive: true,
});

// Pierre S1 : rouge VS + don rouge
w1.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(w1.scores[pierre.id], 12);
w1.scores[pierre.id].allianceDonMissed = true;

// Pierre S2 : orange VS (5*5=25 → orange en mode ÉCO redFrom 30 / orangeFrom 20)
w2.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(w2.scores[pierre.id], 5);
w2.scores[pierre.id].allianceDonMissed = false;

// Pierre S3 : vert VS + don rouge
w3.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(w3.scores[pierre.id], 0);
w3.scores[pierre.id].allianceDonMissed = true;

// Semaine courante rouge (ne doit PAS compter)
wCurrent.scores[pierre.id] = ROSModels.createEmptyScore();
setDayPoints(wCurrent.scores[pierre.id], 12);
wCurrent.scores[pierre.id].allianceDonMissed = true;

// OkPlayer : une seule semaine orange → 5 pts < 15 → masqué
w2.scores[okPlayer.id] = ROSModels.createEmptyScore();
setDayPoints(w2.scores[okPlayer.id], 5);

sandbox.__state = {
  ...ROSModels.createBlankState(),
  currentWeekId: wCurrent.id,
  weeks: [w1, w2, w3, wCurrent],
  coachingThreshold: { min: 25, max: 30 },
  players: [pierre, okPlayer, r5, absent, parti],
};

console.log('\n=== Historique archivé ===');
const archived = Recrutement.getArchivedWeeks(sandbox.__state);
assert(archived.length === 3, `3 semaines archivées (got ${archived.length})`);
assert(!archived.some((w) => w.id === 'wCurrent'), 'Semaine courante exclue');

console.log('\n=== Score cumulatif Pierre ===');
const scored = Recrutement.scorePlayer(pierre, sandbox.__state);
// VS: S1 rouge +10, S2 orange +5, S3 vert +0 = 15
// Dons: S1 rouge +10, S2 vert +0, S3 rouge +10 = 20
// Inactif +40, Coaching +10 (tier 25-30 dans seuil)
assert(scored.vsPoints === 15, `VS points 15 (got ${scored.vsPoints})`);
assert(scored.donationPoints === 20, `Dons points 20 (got ${scored.donationPoints})`);
assert(scored.inactivePoints === 40, 'Inactif +40');
assert(scored.coachingPoints === 10, 'Coaching +10');
assert(scored.score === 85, `Total 85 (got ${scored.score})`);
assert(scored.vsRedWeeks === 1, '1 semaine VS rouge');
assert(scored.vsOrangeWeeks === 1, '1 semaine VS orange');
assert(scored.donationRedWeeks === 2, '2 semaines dons rouge');
assert(scored.weeksCounted === 3, '3 semaines avec données');

console.log('\n=== Exclusions & seuil ===');
assert(Recrutement.isExcludedFromRecruitment(r5), 'R5 exclu');
assert(Recrutement.isExcludedFromRecruitment(absent), 'Absent exclu');
assert(Recrutement.isExcludedFromRecruitment(parti), 'Parti exclu');

const rows = Recrutement.getReplacementCandidates(sandbox.__state);
assert(rows.every((r) => r.score >= 15), 'Seuil ≥ 15');
assert(rows[0].player.pseudo === 'Pierre', 'Pierre en tête');
assert(!rows.some((r) => r.player.pseudo === 'OkPlayer'), 'OkPlayer < 15 masqué');
assert(!rows.some((r) => r.player.role === 'R5'), 'Pas de R5 listé');

console.log('\n=== Exemple cahier des charges (80 pts) ===');
// Recalcule l’exemple utilisateur : S1 VS rouge+10 dons orange — pas d’orange dons en data,
// on simule S1 VS rouge+10 dons rouge+10, S2 VS orange+5 dons rouge+10, inactif+40, coaching+10 = 85
// Variante sans coaching pour coller à 80 :
const example = ROSModels.createPlayer({
  pseudo: 'Exemple',
  role: 'Membre',
  inactive: true,
  coachingException: 'never',
  heroPowerTierId: 'tier_50_55',
});
const e1 = makeWeek('e1', 1, '2026-06-01', true);
const e2 = makeWeek('e2', 2, '2026-06-08', true);
e1.scores[example.id] = ROSModels.createEmptyScore();
setDayPoints(e1.scores[example.id], 12);
e1.scores[example.id].allianceDonMissed = true; // +10 dons (rouge ; orange non stocké)
e2.scores[example.id] = ROSModels.createEmptyScore();
setDayPoints(e2.scores[example.id], 5);
e2.scores[example.id].allianceDonMissed = true;
const exampleState = {
  ...sandbox.__state,
  currentWeekId: 'eCurrent',
  weeks: [e1, e2, makeWeek('eCurrent', 3, '2026-06-15', false)],
  players: [example],
};
const ex = Recrutement.scorePlayer(example, exampleState);
// VS 10+5=15, Dons 10+10=20, Inactif 40, Coaching 0 → 75
assert(ex.vsPoints === 15, `Exemple VS 15 (got ${ex.vsPoints})`);
assert(ex.donationPoints === 20, `Exemple dons 20 (got ${ex.donationPoints})`);
assert(ex.inactivePoints === 40, 'Exemple inactif 40');
assert(ex.coachingPoints === 0, 'Exemple coaching 0');
assert(ex.score === 75, `Exemple total 75 sans orange dons (got ${ex.score})`);

console.log('\n=== API module ===');
assert(typeof Recrutement.aggregateHistoryScore === 'function', 'aggregateHistoryScore');
assert(Recrutement.MIN_SCORE === 15, 'MIN_SCORE 15');
assert(Recrutement.POINTS.vs.red === 10, 'VS rouge +10');
assert(Recrutement.POINTS.vs.orange === 5, 'VS orange +5');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
