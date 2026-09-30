/**
 * Clôture VS : le mute de remise à zéro n’empêche pas l’historique.
 * node scripts/test-vs-muted-close.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const storageCode = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const vsCode = fs.readFileSync(path.join(root, 'js/vs.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');

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

function underScore(days, options = {}) {
  const score = M.createEmptyScore();
  score.absent = Boolean(options.absent);
  ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'].forEach((key, index) => {
    if (index < days) {
      score.dayBrackets[key] = 'low';
      score.days[key] = 1;
    }
  });
  return score;
}

const store = { data: null };
const weekSelector = { value: '', addEventListener() {} };
const sandbox = {
  window: {},
  console,
  localStorage: {
    getItem: () => store.data,
    setItem: (_k, v) => {
      store.data = v;
    },
  },
  document: {
    getElementById: (id) => {
      if (id === 'weekSelector') return weekSelector;
      return {
        addEventListener() {},
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {},
        querySelectorAll: () => [],
        textContent: '',
        innerHTML: '',
        dataset: {},
        checked: false,
        disabled: false,
        value: '',
      };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  AppUI: {
    toast() {},
    confirm: async () => true,
    switchTab() {},
  },
  ROSSync: { schedulePush() {}, flushPush: async () => ({ ok: false, reason: 'local-runtime' }) },
  ROSProfiles: { isActiveR5: () => true, listProfiles: () => [], stampActor: () => ({ actorLabel: 'Test' }) },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(storageCode, sandbox);
sandbox.ROSStorage = sandbox.window.ROSStorage;
vm.runInContext(vsCode, sandbox);
vm.runInContext(suiviCode, sandbox);
const VS = sandbox.window.VSModule;
const M = sandbox.ROSModels;
const Suivi = sandbox.window.SuiviModule;

const priorEntry = {
  weekId: 'week_old',
  weekLabel: 'Ancienne',
  startDate: '2026-09-01',
  underDays: 2,
  under: true,
  praise: false,
  at: '2026-09-05T00:00:00.000Z',
};
const priorArchive = {
  weekId: 'week_old',
  weekLabel: 'Ancienne',
  startDate: '2026-09-01',
  endDate: '2026-09-05',
  closedAt: '2026-09-05T00:00:00.000Z',
  underMinDays: 2,
  players: [{ playerId: 'p_under', pseudo: 'Sous', underDays: 2, contacted: false }],
};

console.log('\n=== Semaine normale ===');
{
  const player = { id: 'p_under', pseudo: 'Sous', status: 'Actif', absent: false };
  const normal = {
    players: [player],
    followUpSettings: { vsMinUnderDays: 2, vsFollowUpMutedWeekId: null },
    playerVsUnderStats: { p_under: { entries: [priorEntry] } },
    vsUnderWeekHistory: [priorArchive],
  };
  const week = {
    id: 'week_normal',
    label: 'Normale',
    startDate: '2026-09-08',
    scores: { p_under: underScore(3) },
  };
  M.recordVsUnderSnapshotsForWeek(normal, week);
  M.pushVsUnderWeekArchive(normal, week);
  const stats = M.getPlayerVsUnderStats(normal, 'p_under');
  assert(stats.entries.some((e) => e.weekId === 'week_normal' && e.under), 'snapshot créé');
  assert(
    normal.vsUnderWeekHistory.some((e) => e.weekId === 'week_normal' && e.players.length === 1),
    'archive créée'
  );
  assert(stats.entries.some((e) => e.weekId === 'week_old'), 'historique précédent du compteur conservé');
  assert(
    normal.vsUnderWeekHistory.some((e) => e.weekId === 'week_old'),
    'archive précédente conservée'
  );
  assert(
    M.formatVsUnderCounterLabel(stats) === 'VS Sous Seuil : 2',
    'compteur incrémenté'
  );
}

console.log('\n=== Semaine muette ===');
{
  const players = [
    { id: 'p_under', pseudo: 'Sous', status: 'Actif', absent: false },
    { id: 'p_abs', pseudo: 'Absent', status: 'Actif', absent: true },
    { id: 'p_score_abs', pseudo: 'ScoreAbsent', status: 'Actif', absent: false },
  ];
  const muted = {
    players,
    followUpSettings: { vsMinUnderDays: 2, vsFollowUpMutedWeekId: 'week_muted' },
    playerVsUnderStats: { p_under: { entries: [{ ...priorEntry }] } },
    vsUnderWeekHistory: [JSON.parse(JSON.stringify(priorArchive))],
  };
  const week = {
    id: 'week_muted',
    label: 'Muette',
    startDate: '2026-09-15',
    scores: {
      p_under: underScore(2),
      p_abs: M.createEmptyScore(),
      p_score_abs: underScore(3, { absent: true }),
    },
  };
  M.recordVsUnderSnapshotsForWeek(muted, week);
  M.pushVsUnderWeekArchive(muted, week);
  const stats = M.getPlayerVsUnderStats(muted, 'p_under');
  assert(
    stats.entries.some((e) => e.weekId === 'week_muted' && e.under),
    'semaine muette → snapshot quand même'
  );
  const archived = muted.vsUnderWeekHistory.find((e) => e.weekId === 'week_muted');
  assert(archived && archived.players.some((p) => p.playerId === 'p_under'), 'semaine muette → archive quand même');
  assert(!muted.playerVsUnderStats.p_abs, 'joueur absent avec score 0 ignoré');
  assert(!archived.players.some((p) => p.playerId === 'p_abs'), 'absent absent de l’archive');
  assert(!muted.playerVsUnderStats.p_score_abs, 'score explicitement absent ignoré');
  assert(!archived.players.some((p) => p.playerId === 'p_score_abs'), 'score absent hors archive');
  assert(stats.entries.some((e) => e.weekId === 'week_old'), 'mute : historique compteur précédent conservé');
  assert(
    M.formatVsUnderCounterLabel(stats) === 'VS Sous Seuil : 2',
    'mute : compteur incrémenté'
  );
}

console.log('\n=== Clôture : ordre, currentWeekId, scores ===');
{
  const present = M.createPlayer({ pseudo: 'Sous', status: 'Actif' });
  present.id = 'p_under';
  const away = M.createPlayer({ pseudo: 'Absent', status: 'Actif', absent: true });
  away.id = 'p_abs';
  const flagged = M.createPlayer({ pseudo: 'ScoreAbsent', status: 'Actif' });
  flagged.id = 'p_score_abs';
  const week = M.createWeek(new Date('2026-09-21'), { number: 4, archived: false });
  week.id = 'week_close';
  week.scores = {
    p_under: underScore(3),
    p_abs: M.createEmptyScore(),
    p_score_abs: underScore(3, { absent: true }),
  };
  const initial = M.createBlankState();
  initial.players = [present, away, flagged];
  initial.weeks = [week];
  initial.currentWeekId = 'week_close';
  initial.followUpSettings = M.normalizeFollowUpSettings({
    vsMinUnderDays: 2,
    vsFollowUpMutedWeekId: 'week_close',
  });
  initial.playerVsUnderStats = { p_under: { entries: [{ ...priorEntry }] } };
  initial.vsUnderWeekHistory = [JSON.parse(JSON.stringify(priorArchive))];
  store.data = JSON.stringify(initial);
  sandbox.ROSStorage.hydrateFromStorage();
  weekSelector.value = 'week_close';
  VS.init();

  const seen = [];
  const origRecord = M.recordVsUnderSnapshotsForWeek.bind(M);
  const origArchive = M.pushVsUnderWeekArchive.bind(M);
  M.recordVsUnderSnapshotsForWeek = function (s, closing) {
    seen.push({
      fn: 'record',
      weekPresent: (s.weeks || []).some((w) => w.id === closing.id),
      hasScores: Boolean(closing.scores && closing.scores.p_under),
      current: s.currentWeekId,
    });
    return origRecord(s, closing);
  };
  M.pushVsUnderWeekArchive = function (s, closing) {
    seen.push({
      fn: 'archive',
      weekPresent: (s.weeks || []).some((w) => w.id === closing.id),
      hasScores: Boolean(closing.scores && closing.scores.p_under),
      snapReady: Boolean(
        s.playerVsUnderStats?.p_under?.entries?.some((e) => e.weekId === 'week_close')
      ),
    });
    return origArchive(s, closing);
  };

  (async () => {
    await VS.closeActiveWeek();
    M.recordVsUnderSnapshotsForWeek = origRecord;
    M.pushVsUnderWeekArchive = origArchive;
    const state = sandbox.ROSStorage.getState();
    assert(seen[0] && seen[0].fn === 'record' && seen[0].weekPresent && seen[0].hasScores, 'snapshot pendant que les scores existent');
    assert(seen[0].current === 'week_close', 'snapshot avant currentWeekId null');
    assert(
      seen[1] && seen[1].fn === 'archive' && seen[1].weekPresent && seen[1].hasScores && seen[1].snapReady,
      'archive après le snapshot, scores encore présents'
    );
    assert(state.currentWeekId === null, 'clôture → currentWeekId null');
    assert(!state.weeks.find((w) => w.id === 'week_close'), 'scores / semaine supprimés après les enregistrements');
    const stats = M.getPlayerVsUnderStats(state, 'p_under');
    assert(stats.entries.some((e) => e.weekId === 'week_close' && e.under), 'clôture muette alimente le compteur');
    assert(
      state.vsUnderWeekHistory.some((e) => e.weekId === 'week_close'),
      'clôture muette alimente vsUnderWeekHistory'
    );
    assert(!state.playerVsUnderStats.p_abs, 'clôture : absent ignoré');
    assert(!state.playerVsUnderStats.p_score_abs, 'clôture : score absent ignoré');
    assert(stats.entries.some((e) => e.weekId === 'week_old'), 'clôture : historique précédent conservé');
    assert(
      state.followUpSettings.vsFollowUpMutedWeekId === 'week_close',
      'le mute reste jusqu’à la semaine suivante'
    );

    console.log('\n=== Semaine suivante ===');
    await VS.createNewWeek();
    let next = sandbox.ROSStorage.getState();
    assert(next.followUpSettings.vsFollowUpMutedWeekId === null, 'nouvelle semaine lève le mute');
    assert(next.currentWeekId, 'nouvelle semaine active');
    const nextId = next.currentWeekId;
    sandbox.ROSStorage.update((s) => {
      const active = s.weeks.find((w) => w.id === nextId);
      active.scores.p_under = underScore(2);
      return s;
    });
    weekSelector.value = nextId;
    await VS.closeActiveWeek();
    next = sandbox.ROSStorage.getState();
    assert(next.currentWeekId === null, 'clôture suivante → currentWeekId null');
    assert(
      M.getPlayerVsUnderStats(next, 'p_under').entries.some((e) => e.weekId === nextId && e.under),
      'semaine suivante enregistrée normalement'
    );
    assert(
      M.getPlayerVsUnderStats(next, 'p_under').entries.some((e) => e.weekId === 'week_close'),
      'résultat de la semaine muette toujours là'
    );

    console.log('\n=== Remise à zéro : pas de recréation auto ===');
    const tiers = M.getPowerTiers(M.createBlankState());
    const lowTier = tiers.find((t) => Number(t.max) <= 30);
    const resetState = {
      currentWeekId: 'week_live',
      weeks: [
        {
          id: 'week_live',
          label: 'Live',
          startDate: '2026-09-21',
          archived: false,
          scores: { p_vs: underScore(3), p_hero: underScore(3) },
        },
      ],
      powerTiers: tiers,
      followUpSettings: { vsMinUnderDays: 2, heroMaxM: 30, vsFollowUpMutedWeekId: null },
      playerVsUnderStats: {
        p_vs: { entries: [{ ...priorEntry, weekId: 'week_shown' }] },
      },
      playerFollowUps: {
        p_vs: M.createEmptyFollowUpCase({
          status: 'to_contact',
          reasons: { vs: true, praise: true, hero: false, discret: false, manual: false },
        }),
        p_hero: M.createEmptyFollowUpCase({
          status: 'in_progress',
          reasons: { vs: true, praise: false, hero: true, discret: false, manual: false },
        }),
      },
      playerFollowUpNotes: {},
      players: [
        { id: 'p_vs', pseudo: 'Vs', status: 'Actif', absent: false },
        { id: 'p_hero', pseudo: 'Hero', status: 'Actif', absent: false, heroPowerTierId: lowTier.id },
        { id: 'p_new', pseudo: 'New', status: 'Actif', absent: false },
      ],
    };
    Suivi.applyVsUnderCounterReset(resetState);
    assert(Object.keys(resetState.playerVsUnderStats).length === 0, 'reset efface les compteurs affichés');
    assert(resetState.followUpSettings.vsFollowUpMutedWeekId === 'week_live', 'reset pose le mute sur la semaine active');
    assert(resetState.playerFollowUps.p_vs.reasons.vs === false, 'reset retire VS');
    assert(resetState.playerFollowUps.p_vs.reasons.praise === false, 'reset retire félicitations');
    assert(resetState.playerFollowUps.p_vs.status === 'done', 'fiche seulement VS/félicitations terminée');
    assert(resetState.playerFollowUps.p_hero.reasons.vs === false, 'reset retire VS d’une fiche héros');
    assert(resetState.playerFollowUps.p_hero.reasons.hero === true, 'héros conservé');
    assert(resetState.playerFollowUps.p_hero.status !== 'done', 'fiche héros reste ouverte');
    Suivi.syncAutoReasons(resetState);
    assert(!resetState.playerFollowUps.p_new, 'pas de fiche VS créée pour un joueur sans suivi');
    assert(resetState.playerFollowUps.p_vs.status === 'done', 'sync ne rouvre pas le suivi VS');
    assert(resetState.playerFollowUps.p_vs.reasons.vs === false, 'sync ne remet pas VS');
    assert(resetState.playerFollowUps.p_vs.reasons.praise === false, 'sync ne remet pas félicitations');
    assert(resetState.playerFollowUps.p_hero.reasons.vs === false, 'sync ne remet pas VS sur la fiche héros');
    M.recordVsUnderSnapshotsForWeek(resetState, resetState.weeks[0]);
    Suivi.syncAutoReasons(resetState);
    assert(
      resetState.playerVsUnderStats.p_vs.entries.some((e) => e.weekId === 'week_live'),
      'après reset, la clôture réécrit quand même le compteur'
    );
    assert(resetState.playerFollowUps.p_vs.reasons.vs === false, 'le compteur réécrit ne recrée pas le suivi VS');
    assert(!resetState.playerFollowUps.p_new, 'toujours pas de nouveau suivi automatique');

    console.log(`\n${passed} OK, ${failed} KO`);
    process.exit(failed ? 1 : 0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
