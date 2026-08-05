/**
 * Tests automatiques VS + Tempête (sans navigateur)
 * Exécution : node scripts/test-vs-tempete.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');

const sandbox = {
  window: {},
  console,
};
sandbox.global = sandbox.window;
sandbox.window.ROSStorage = {
  getState() {
    return sandbox.__state;
  },
};

vm.createContext(sandbox);
vm.runInContext(modelsCode.replace('(function (global)', '(function (global)').replace(
  ')(window);',
  ')(window);'
), sandbox);

const M = sandbox.window.ROSModels;
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

console.log('\n=== VS Settings & bareme ===');
{
  const settings = M.createDefaultVsSettings();
  assert(settings.mode === 'eco', 'Mode par défaut = eco');
  assert(settings.eco.dailyGoal === 3600000, 'ÉCO objectif 3 600 000');
  assert(settings.eco.underPoints === 10, 'ÉCO under 10 pts');
  assert(settings.eco.redFrom === 30, 'ÉCO rouge ≥ 30');
  assert(settings.afond.dailyGoal === 7200000, 'À FOND objectif 7 200 000');
  assert(settings.afond.midPoints === 5, 'À FOND mid 5 pts');
  assert(settings.afond.lowPoints === 12, 'À FOND low 12 pts');
  assert(settings.afond.redFrom === 36, 'À FOND rouge ≥ 36');
}

console.log('\n=== Migration anciennes données ===');
{
  const raw = {
    players: [{ id: 'p1', pseudo: 'Willow', role: 'Membre', status: 'Actif' }],
    weeks: [
      {
        id: 'w1',
        number: 1,
        startDate: '2026-08-03',
        endDate: '2026-08-07',
        scores: {
          p1: {
            days: { lundi: 0, mardi: 5, mercredi: 10, jeudi: 0, vendredi: 5 },
            allianceDonMissed: true,
          },
        },
      },
    ],
    currentWeekId: 'w1',
  };
  const state = M.normalizeState(raw);
  assert(state.vsSettings.mode === 'eco', 'vsSettings migré (défaut eco)');
  const score = state.weeks[0].scores.p1;
  assert(score.dayBrackets.lundi === 'ok', '0 → bracket ok');
  assert(score.dayBrackets.mardi === 'mid', '5 → bracket mid');
  assert(score.dayBrackets.mercredi === 'low', '10 → bracket low');
  assert(score.days.mercredi === 10, 'Points historiques conservés');
  assert(state.weeks[0].donationsVerified === false, 'donationsVerified défaut false');
}

console.log('\n=== Recalcul mode À FOND / ÉCO ===');
{
  const state = M.normalizeState({
    players: [{ id: 'p1', pseudo: 'A', role: 'Membre', status: 'Actif' }],
    weeks: [
      {
        id: 'w1',
        number: 1,
        startDate: '2026-08-03',
        endDate: '2026-08-07',
        scores: {
          p1: {
            days: { lundi: 0, mardi: 5, mercredi: 10, jeudi: 0, vendredi: 5 },
            dayBrackets: { lundi: 'ok', mardi: 'mid', mercredi: 'low', jeudi: 'ok', vendredi: 'mid' },
            allianceDonMissed: false,
          },
        },
      },
    ],
    currentWeekId: 'w1',
    vsSettings: { mode: 'afond' },
  });
  M.recalculateWeekWithBareme(state.weeks[0], state);
  const s = state.weeks[0].scores.p1;
  assert(s.days.lundi === 0 && s.days.mardi === 5 && s.days.mercredi === 12, 'À FOND remap 0/5/12');
  assert(M.computeTotal(s, state) === 0 + 5 + 12 + 0 + 5, 'Total À FOND = 22');
  assert(M.countDaysUnderObjective(s) === 3, 'Jours sous objectif À FOND = 3');
  assert(M.countObjectivesMet(s) === 2, 'Objectifs atteints À FOND = 2');

  state.vsSettings.mode = 'eco';
  M.recalculateWeekWithBareme(state.weeks[0], state);
  assert(s.days.lundi === 0 && s.days.mardi === 0 && s.days.mercredi === 10, 'ÉCO remap mid→0 low→10');
  assert(M.countDaysUnderObjective(s) === 1, 'Jours sous objectif ÉCO = 1');
  assert(M.countObjectivesMet(s) === 4, 'Objectifs atteints ÉCO = 4');
  assert(M.getColorClass(30, state) === 'color-red', 'ÉCO rouge à 30');
  state.vsSettings.mode = 'afond';
  assert(M.getColorClass(36, state) === 'color-red', 'À FOND rouge à 36');
  assert(M.getColorClass(35, state) === 'color-orange', 'À FOND 35 = orange');
}

console.log('\n=== Day options dynamiques ===');
{
  const eco = M.getDayOptions({ mode: 'eco', ...M.createDefaultVsSettings(), mode: 'eco' });
  assert(eco.length === 2, 'ÉCO : 2 options');
  const afond = M.getDayOptions({ ...M.createDefaultVsSettings(), mode: 'afond' });
  assert(afond.length === 3, 'À FOND : 3 options');
  assert(afond[2].value === 12, 'À FOND low value = 12');
}

console.log('\n=== Présence Tempête (logique) ===');
{
  function archivePlayerOutcomes(arch) {
    if (arch?.playerOutcomes && typeof arch.playerOutcomes === 'object') return arch.playerOutcomes;
    return {};
  }
  function getPlayerPresenceHistory(archives, playerId, limit = 20) {
    const entries = [];
    for (let i = 0; i < archives.length && entries.length < limit; i += 1) {
      const arch = archives[i];
      const outcome = archivePlayerOutcomes(arch)[playerId];
      if (!outcome) continue;
      if (outcome.role !== 'participant' && outcome.role !== 'remplacant') continue;
      const attendance = outcome.attendance;
      if (!attendance) continue;
      entries.push(attendance);
    }
    const present = entries.filter((a) => a === 'present').length;
    const total = entries.length;
    return {
      total,
      present,
      absentExcuse: entries.filter((a) => a === 'absent_excuse').length,
      absent: entries.filter((a) => a === 'absent').length,
      percent: total ? Math.round((present / total) * 100) : null,
    };
  }

  const archives = [];
  for (let i = 0; i < 18; i += 1) {
    archives.push({
      id: `a${i}`,
      playerOutcomes: { p1: { role: 'participant', attendance: 'present' } },
    });
  }
  archives.push({
    id: 'ax',
    playerOutcomes: { p1: { role: 'participant', attendance: 'absent_excuse' } },
  });
  archives.push({
    id: 'ay',
    playerOutcomes: { p1: { role: 'remplacant', attendance: 'absent' } },
  });
  // plus ancienne — hors fenêtre 20 si on en ajoute encore, ici exactement 20
  const hist = getPlayerPresenceHistory(archives, 'p1', 20);
  assert(hist.total === 20, '20 participations');
  assert(hist.present === 18, '18 présents');
  assert(hist.absentExcuse === 1 && hist.absent === 1, '1 excusé + 1 non excusé');
  assert(hist.percent === 90, 'Présence 90 %');

  const empty = getPlayerPresenceHistory([], 'p1', 20);
  assert(empty.percent === null, 'Sans historique → null (calcul à partir des prochaines)');

  function color(p) {
    if (p == null) return 'unknown';
    if (p >= 90) return 'green';
    if (p >= 75) return 'orange';
    return 'red';
  }
  assert(color(98) === 'green' && color(84) === 'orange' && color(71) === 'red', 'Couleurs présence');
}

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
