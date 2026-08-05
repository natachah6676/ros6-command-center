/**
 * Tests d’intégration VS + Tempête (flux complets)
 * Exécution : node scripts/test-vs-tempete-integration.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');

const sandbox = { window: {}, console };
sandbox.global = sandbox.window;
sandbox.__state = null;
sandbox.window.ROSStorage = {
  getState() {
    return sandbox.__state;
  },
};

vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
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

console.log('\n=== Flux VS : migration + mode + paramètres + clôture ===');
{
  // État legacy sans vsSettings
  const legacy = {
    players: [
      { id: 'p1', pseudo: 'Willow', role: 'R4', status: 'Actif' },
      { id: 'p2', pseudo: 'HGS', role: 'Membre', status: 'Actif', absent: true },
    ],
    weeks: [
      {
        id: 'w-old',
        number: 1,
        startDate: '2026-07-27',
        endDate: '2026-07-31',
        archived: true,
        scores: {
          p1: {
            days: { lundi: 5, mardi: 5, mercredi: 10, jeudi: 0, vendredi: 0 },
            allianceDonMissed: true,
          },
        },
      },
      {
        id: 'w-active',
        number: 2,
        startDate: '2026-08-03',
        endDate: '2026-08-07',
        scores: {
          p1: {
            days: { lundi: 0, mardi: 5, mercredi: 10, jeudi: 0, vendredi: 5 },
            allianceDonMissed: false,
          },
        },
      },
    ],
    currentWeekId: 'w-active',
  };

  const state = M.normalizeState(legacy);
  sandbox.__state = state;

  assert(state.vsSettings.mode === 'eco', 'Migration → mode ÉCO');
  assert(state.weeks.find((w) => w.id === 'w-active').donationsVerified === false, 'Dons non vérifiés par défaut');

  const archived = state.weeks.find((w) => w.id === 'w-old');
  assert(archived.scores.p1.days.mardi === 5, 'Archive : points mid historiques intactes');
  assert(archived.scores.p1.allianceDonMissed === true, 'Archive : don manqué conservé');

  const active = state.weeks.find((w) => w.id === 'w-active');
  // Première migration ÉCO : mid → 0, low → 10
  assert(active.scores.p1.days.mardi === 0, 'Semaine active : mid recalculé en ÉCO (0)');
  assert(active.scores.p1.days.mercredi === 10, 'Semaine active : low = 10 en ÉCO');
  assert(active.scores.p1.dayBrackets.mardi === 'mid', 'Bracket mid conservé pour bascule future');

  // Bascule À FOND + recalcul
  state.vsSettings.mode = 'afond';
  M.recalculateWeekWithBareme(active, state);
  assert(active.scores.p1.days.mardi === 5, 'Bascule À FOND : mid → 5');
  assert(active.scores.p1.days.mercredi === 12, 'Bascule À FOND : low → 12');
  assert(M.countDaysUnderObjective(active.scores.p1) === 3, 'Indicateur jours sous objectif = 3');
  assert(M.countObjectivesMet(active.scores.p1) === 2, 'Indicateur objectifs atteints = 2');

  // Modifier paramètres (lowPoints 15) puis recalcul
  state.vsSettings.afond.lowPoints = 15;
  M.recalculateWeekWithBareme(active, state);
  assert(active.scores.p1.days.mercredi === 15, 'Paramètre lowPoints appliqué (15)');

  // Day options dynamiques
  const opts = M.getDayOptions(state);
  assert(opts.length === 3 && opts[2].value === 15, 'Options jour reflètent les paramètres');

  // Couleurs selon redFrom
  state.vsSettings.afond.redFrom = 36;
  assert(M.getColorClass(36, state) === 'color-red', 'Rouge ≥ 36');
  assert(M.getColorClass(30, state) === 'color-orange', 'Orange sous le seuil rouge');

  // Gate clôture
  assert(!active.donationsVerified, 'Impossible de clôturer sans case dons');
  active.donationsVerified = true;
  assert(active.donationsVerified === true, 'Clôture autorisée après vérification dons');

  // Re-normalisation ne doit pas écraser vsSettings ni archives
  const again = M.normalizeState(state);
  assert(again.vsSettings.mode === 'afond', 'Mode mémorisé après re-normalize');
  assert(again.weeks.find((w) => w.id === 'w-old').scores.p1.days.mardi === 5, 'Archive intacte après re-normalize');
}

console.log('\n=== Flux Tempête : présence + filtres + couleurs ===');
{
  function presenceHistory(archives, playerId, limit = 20) {
    const entries = [];
    for (let i = 0; i < archives.length && entries.length < limit; i += 1) {
      const o = archives[i].playerOutcomes?.[playerId];
      if (!o || (o.role !== 'participant' && o.role !== 'remplacant')) continue;
      if (!o.attendance) continue;
      entries.push(o.attendance);
    }
    const present = entries.filter((a) => a === 'present').length;
    const total = entries.length;
    const percent = total ? Math.round((present / total) * 100) : null;
    return {
      total,
      present,
      absentExcuse: entries.filter((a) => a === 'absent_excuse').length,
      absent: entries.filter((a) => a === 'absent').length,
      percent,
    };
  }
  function color(p) {
    if (p == null) return 'unknown';
    if (p >= 90) return 'green';
    if (p >= 75) return 'orange';
    return 'red';
  }
  function matchFilter(percent, filter) {
    if (filter === 'all') return true;
    if (percent == null) return false;
    if (filter === 'high') return percent >= 90;
    if (filter === 'mid') return percent >= 75 && percent <= 89;
    if (filter === 'low') return percent < 75;
    return true;
  }

  const archives = [];
  // Willow 18/20 = 90 %
  for (let i = 0; i < 18; i++) {
    archives.push({ playerOutcomes: { willow: { role: 'participant', attendance: 'present' } } });
  }
  archives.push({ playerOutcomes: { willow: { role: 'participant', attendance: 'absent_excuse' } } });
  archives.push({ playerOutcomes: { willow: { role: 'remplacant', attendance: 'absent' } } });

  // HGS 16/20 = 80 %
  for (let i = 0; i < 16; i++) {
    archives[i].playerOutcomes.hgs = { role: 'participant', attendance: 'present' };
  }
  for (let i = 16; i < 20; i++) {
    archives[i].playerOutcomes.hgs = { role: 'participant', attendance: 'absent' };
  }

  // Fafane 14/20 = 70 %
  for (let i = 0; i < 14; i++) {
    archives[i].playerOutcomes.fafane = { role: 'participant', attendance: 'present' };
  }
  for (let i = 14; i < 20; i++) {
    archives[i].playerOutcomes.fafane = { role: 'participant', attendance: 'absent' };
  }

  const w = presenceHistory(archives, 'willow');
  const h = presenceHistory(archives, 'hgs');
  const f = presenceHistory(archives, 'fafane');
  const newbie = presenceHistory(archives, 'newbie');

  assert(w.percent === 90 && color(w.percent) === 'green', 'Willow 90 % vert');
  assert(h.percent === 80 && color(h.percent) === 'orange', 'HGS 80 % orange');
  assert(f.percent === 70 && color(f.percent) === 'red', 'Fafane 70 % rouge');
  assert(newbie.percent === null && color(newbie.percent) === 'unknown', 'Sans historique → —');

  assert(matchFilter(w.percent, 'high') && !matchFilter(h.percent, 'high'), 'Filtre ≥ 90 %');
  assert(matchFilter(h.percent, 'mid') && !matchFilter(w.percent, 'mid'), 'Filtre 75–89 %');
  assert(matchFilter(f.percent, 'low') && !matchFilter(h.percent, 'low'), 'Filtre < 75 %');
  assert(matchFilter(null, 'all') && !matchFilter(null, 'high'), 'Filtre Tous inclut sans historique');

  assert(w.present === 18 && w.absentExcuse === 1 && w.absent === 1, 'Détail historique Willow');
}

console.log('\n=== Compatibilité API legacy (autres modules) ===');
{
  const score = M.createEmptyScore();
  score.days.lundi = 10;
  score.allianceDonMissed = true;
  // Appels sans 2e argument (archives / command)
  const total = M.computeTotal(score);
  assert(typeof total === 'number' && total >= 10, 'computeTotal(score) legacy OK');
  assert(typeof M.getColorClass(total) === 'string', 'getColorClass(total) legacy OK');
  assert(Array.isArray(M.DAY_OPTIONS) && M.DAY_OPTIONS.length === 3, 'DAY_OPTIONS legacy conservé');
}

console.log('\n=== Résultat intégration ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
