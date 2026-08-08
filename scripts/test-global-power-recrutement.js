/**
 * Tests puissance globale + groupes Recrutement + droits R5/R4 (édition).
 * node scripts/test-global-power-recrutement.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const recrutementCode = fs.readFileSync(path.join(root, 'js/recrutement.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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
assert(html.includes('playerGlobalPower'), 'select puissance globale');
assert(html.includes('recrutementSort'), 'tri recrutement');
assert(html.includes('minimum 15 points'), 'seuil 15 UI');

const sandbox = {
  window: {},
  console,
  ROSStorage: {
    getState() {
      return sandbox.__state;
    },
  },
  ROSProfiles: {
    role: 'R5',
    status: 'Actif',
    isAccessAllowed() {
      return sandbox.ROSProfiles.status === 'Actif';
    },
    isActiveR5() {
      return sandbox.ROSProfiles.isAccessAllowed() && sandbox.ROSProfiles.role === 'R5';
    },
    isActiveR4OrR5() {
      const role = sandbox.ROSProfiles.role;
      return (
        sandbox.ROSProfiles.isAccessAllowed() && (role === 'R5' || role === 'R4')
      );
    },
    getAppRole() {
      return sandbox.ROSProfiles.role;
    },
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(recrutementCode, sandbox);
const ROSModels = sandbox.window.ROSModels;
const Recrutement = sandbox.window.RecrutementModule;

console.log('\n=== Tranches puissance globale ===');
const tiers = ROSModels.getGlobalPowerTiers();
assert(tiers[0].id === 'gp_lt_45', 'premiere tranche <45');
assert(tiers[tiers.length - 1].id === 'gp_ge_200', 'derniere tranche 200+');
assert(tiers.some((t) => t.label === '45 à 49,9 M'), 'tranche 45-49,9');
assert(tiers.some((t) => t.label === '195 à 199,9 M'), 'tranche 195-199,9');
assert(ROSModels.normalizeGlobalPowerTierId('gp_50_55') === 'gp_50_55', 'normalize ok');
assert(ROSModels.normalizeGlobalPowerTierId('nope') === null, 'normalize invalide');

console.log('\n=== Droits R5 / R4 / autres ===');
sandbox.ROSProfiles.status = 'Actif';
sandbox.ROSProfiles.role = 'R5';
assert(ROSModels.canEditGlobalPower() === true, 'R5 peut modifier');
sandbox.ROSProfiles.role = 'R4';
assert(ROSModels.canEditGlobalPower() === true, 'R4 peut modifier');
sandbox.ROSProfiles.role = 'Membre';
assert(ROSModels.canEditGlobalPower() === false, 'Membre ne peut pas modifier');
sandbox.ROSProfiles.role = 'R4';
sandbox.ROSProfiles.status = 'Inactif';
assert(ROSModels.canEditGlobalPower() === false, 'R4 inactif ne peut pas modifier');
sandbox.ROSProfiles.status = 'Actif';
sandbox.ROSProfiles.role = 'R5';

function makeWeek(id, number, startDate, archived) {
  const week = ROSModels.createWeek(new Date(startDate), { number, archived });
  week.id = id;
  week.archived = archived;
  week.startDate = startDate;
  return week;
}

function setPoints(score, total) {
  ROSModels.DAYS.forEach((d) => {
    score.days[d.key] = 0;
  });
  score.days.lundi = total;
}

// 10 membres avec puissances pour tester 30/40/30 + egalite de tranche
const players = [];
const tierIds = [
  'gp_ge_200',
  'gp_ge_200', // meme tranche frontier
  'gp_100_105',
  'gp_90_95',
  'gp_80_85',
  'gp_70_75',
  'gp_60_65',
  'gp_50_55',
  'gp_45_50',
  'gp_lt_45',
];
tierIds.forEach((tierId, i) => {
  players.push(
    ROSModels.createPlayer({
      pseudo: `P${String(i + 1).padStart(2, '0')}`,
      role: 'Membre',
      globalPowerTierId: tierId,
      heroPowerTierId: null,
    })
  );
});
const unset = ROSModels.createPlayer({
  pseudo: 'SansPuissance',
  role: 'Membre',
  inactive: true,
});
const r4 = ROSModels.createPlayer({ pseudo: 'R4Lock', role: 'R4', globalPowerTierId: 'gp_ge_200' });
const absent = ROSModels.createPlayer({
  pseudo: 'Abs',
  role: 'Membre',
  absent: true,
  globalPowerTierId: 'gp_lt_45',
  inactive: true,
});

const w1 = makeWeek('w1', 1, '2026-07-01', true);
players.forEach((p) => {
  w1.scores[p.id] = ROSModels.createEmptyScore();
  setPoints(w1.scores[p.id], 10);
});
w1.scores[unset.id] = ROSModels.createEmptyScore();
setPoints(w1.scores[unset.id], 0);

const wCurrent = makeWeek('wCur', 2, '2026-07-08', false);

sandbox.__state = {
  ...ROSModels.createBlankState(),
  currentWeekId: wCurrent.id,
  weeks: [w1, wCurrent],
  coachingThreshold: { min: 25, max: 30 },
  vsSettings: {
    mode: 'eco',
    eco: { redFrom: 30, dailyGoal: 3600000, underPoints: 10, donationPenalty: 5 },
    afond: { redFrom: 36, dailyGoal: 7200000, donationPenalty: 5 },
  },
  players: [...players, unset, r4, absent],
};

console.log('\n=== Groupes 30/40/30 + egalites ===');
const pop = Recrutement.getPowerRankingPopulation(sandbox.__state);
assert(pop.length === 10, 'population 10 (hors R4/absent/unset)');
const map = Recrutement.buildPowerGroupAssignments(sandbox.__state);
const g1 = map.get(players[0].id);
const g2 = map.get(players[1].id);
assert(g1 && g2 && g1.group === g2.group, 'meme tranche reste ensemble');
assert(g1.group === 'strong', 'top tranche en strong');
assert(map.get(players[9].id).group === 'weak', 'plus faible en weak');
assert(map.get(players[9].id).points === 20, 'weak +20');
assert(!map.has(unset.id), 'unset hors classement');

console.log('\n=== Score cumulatif ===');
const weakRow = Recrutement.scorePlayer(players[9], sandbox.__state, map);
// historique 10*100% = 10 + power 20 = 30
assert(weakRow.historyPoints === 10, 'historique 10');
assert(weakRow.powerPoints === 20, 'power +20');
assert(weakRow.realScore === 30, 'total 30');
assert(weakRow.priority.level === 'medium', 'prio moyenne');

unset.inactive = true;
const unsetRow = Recrutement.scorePlayer(unset, sandbox.__state, map);
assert(unsetRow.powerPoints === 0, 'unset power 0');
assert(unsetRow.inactivePoints === 40, 'unset inactif 40');
assert(unsetRow.hasGlobalPower === false, 'flag sans puissance');
assert(unsetRow.realScore === 40, 'unset score 40 >= 15');

console.log('\n=== Exclusions & seuil ===');
assert(Recrutement.isExcludedFromRecruitment(r4), 'R4 exclu');
assert(Recrutement.isExcludedFromRecruitment(absent), 'Absent exclu');
assert(Recrutement.MIN_SCORE === 15, 'MIN_SCORE 15');
const candidates = Recrutement.getReplacementCandidates(sandbox.__state, 'score');
assert(candidates.every((r) => r.realScore >= 15), 'seuil 15');
assert(!candidates.some((r) => r.player.role === 'R4'), 'pas de R4');
assert(candidates.some((r) => r.player.pseudo === 'SansPuissance'), 'unset listable via autres criteres');

const byAlpha = Recrutement.getReplacementCandidates(sandbox.__state, 'alpha');
assert(
  byAlpha[0].player.pseudo.localeCompare(byAlpha[1].player.pseudo, 'fr') <= 0,
  'tri alpha'
);

console.log('\n=== Persist normalize ===');
const normalized = ROSModels.normalizeState({
  ...sandbox.__state,
  players: [
    {
      ...players[0],
      globalPowerTierId: 'gp_60_65',
    },
  ],
});
assert(normalized.players[0].globalPowerTierId === 'gp_60_65', 'normalize conserve globalPower');

console.log('\n=== Resultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
