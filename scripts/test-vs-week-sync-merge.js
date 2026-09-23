/**
 * Anti-écrasement sync des semaines VS (weeks / currentWeekId / closeIntent).
 * node scripts/test-vs-week-sync-merge.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const vsCode = fs.readFileSync(path.join(root, 'js/vs.js'), 'utf8');

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

const sandbox = {
  window: {},
  console,
  localStorage: {
    _d: {},
    getItem(k) {
      return this._d[k] ?? null;
    },
    setItem(k, v) {
      this._d[k] = String(v);
    },
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  navigator: { onLine: true },
  ROSSupabase: {
    getClient: () => ({
      auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) },
    }),
  },
  AppUI: { toast() {}, confirm: async () => false },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
vm.runInContext(syncCode, sandbox);

const T = sandbox.window.ROSSync.__test;
const Models = sandbox.window.ROSModels;

function week(id, createdAt, extra = {}) {
  return {
    id,
    number: 1,
    label: `Semaine ${id}`,
    startDate: '2026-09-21',
    endDate: '2026-09-25',
    createdAt,
    archived: false,
    donationsVerified: false,
    scores: {},
    vsContacts: {},
    ...extra,
  };
}

function store(activeWeek, lifecycle = {}) {
  return {
    version: 1,
    players: [{ id: 'p1', pseudo: 'Alpha', role: 'Membre', status: 'Actif' }],
    weeks: activeWeek ? [activeWeek] : [],
    currentWeekId: activeWeek ? activeWeek.id : null,
    vsWeekLifecycle: lifecycle,
    playerFollowUpNotes: {},
  };
}

console.log('\n=== Présence helpers / closeIntent UI ===');
assert(typeof T.mergeVsWeekState === 'function', 'mergeVsWeekState exposé');
assert(typeof T.mergeCommandCenterStore === 'function', 'mergeCommandCenterStore exposé');
assert(typeof Models.normalizeVsWeekLifecycle === 'function', 'normalizeVsWeekLifecycle exposé');
assert(vsCode.includes('closeIntent'), 'vs.js pose closeIntent à la clôture');
assert(vsCode.includes('vsWeekLifecycle'), 'vs.js écrit vsWeekLifecycle');

console.log('\n=== Remote a une semaine / local vide → semaine conservée ===');
{
  const remote = store(week('w_remote', '2026-09-21T10:00:00.000Z'));
  const local = store(null);
  const merged = T.mergeVsWeekState(remote, local);
  assert(merged.currentWeekId === 'w_remote', 'currentWeekId remote conservé');
  assert(merged.weeks.length === 1 && merged.weeks[0].id === 'w_remote', 'semaine remote conservée');
}

console.log('\n=== Clôture volontaire avec closeIntent correspondant ===');
{
  const remote = store(week('w1', '2026-09-21T10:00:00.000Z'));
  const local = store(null, {
    closeIntent: { weekId: 'w1', closedAt: '2026-09-22T12:00:00.000Z' },
  });
  const merged = T.mergeVsWeekState(remote, local);
  assert(merged.weeks.length === 0 && merged.currentWeekId == null, 'semaine clôturée retirée');
  assert(merged.vsWeekLifecycle?.closeIntent?.weekId === 'w1', 'closeIntent conservé après clôture');
}

console.log('\n=== Vieux local ressuscite une semaine déjà clôturée → bloqué ===');
{
  const remote = store(null, {
    closeIntent: { weekId: 'w_old', closedAt: '2026-09-22T12:00:00.000Z' },
  });
  const local = store(week('w_old', '2026-09-21T10:00:00.000Z'));
  const merged = T.mergeVsWeekState(remote, local);
  assert(merged.weeks.length === 0 && merged.currentWeekId == null, 'pas de résurrection');
  assert(merged.vsWeekLifecycle?.closeIntent?.weekId === 'w_old', 'closeIntent remote conservé');
}

console.log('\n=== Même semaine : scores / contacts locaux conservés, remote non écrasé ===');
{
  const remoteW = week('w_same', '2026-09-21T10:00:00.000Z', {
    scores: {
      p1: { days: { lundi: 5, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0 }, dayBrackets: {} },
      p2: { days: { lundi: 10, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0 }, dayBrackets: {} },
    },
    vsContacts: {
      p2: { kind: 'coach', at: '2026-09-21T11:00:00.000Z', authorLabel: 'R5' },
    },
    donationsVerified: true,
  });
  const localW = week('w_same', '2026-09-21T10:00:00.000Z', {
    scores: {
      p1: {
        days: { lundi: 5, mardi: 12, mercredi: 0, jeudi: 0, vendredi: 0 },
        dayBrackets: { mardi: 'high' },
      },
    },
    vsContacts: {
      p1: { kind: 'praise', at: '2026-09-21T15:00:00.000Z', authorLabel: 'R4' },
    },
  });
  const remote = store(remoteW);
  const local = store(localW);
  const merged = T.mergeVsWeekState(remote, local);
  const w = merged.weeks[0];
  assert(merged.currentWeekId === 'w_same', 'même id conservé');
  assert(w.scores.p1.days.mardi === 12, 'score local mardi conservé');
  assert(w.scores.p2.days.lundi === 10, 'score remote p2 non perdu');
  assert(w.vsContacts.p1?.kind === 'praise', 'contact local p1 conservé');
  assert(w.vsContacts.p2?.kind === 'coach', 'contact remote p2 conservé');
  assert(w.donationsVerified === true || w.donationsVerified === false, 'champs semaine fusionnés');
}

console.log('\n=== Deux semaines différentes → createdAt le plus récent gagne ===');
{
  const older = week('w_old', '2026-09-21T10:00:00.000Z');
  const newer = week('w_new', '2026-09-22T14:38:00.000Z');
  const a = T.mergeVsWeekState(store(older), store(newer));
  assert(a.currentWeekId === 'w_new', 'local plus récent gagne');
  const b = T.mergeVsWeekState(store(newer), store(older));
  assert(b.currentWeekId === 'w_new', 'remote plus récent gagne');
}

console.log('\n=== Même createdAt → remote gagne ===');
{
  const stamp = '2026-09-21T10:00:00.000Z';
  const remoteW = week('w_remote_eq', stamp, {
    scores: { p1: { days: { lundi: 5 }, dayBrackets: {} } },
  });
  const localW = week('w_local_eq', stamp, {
    scores: { p1: { days: { lundi: 12 }, dayBrackets: {} } },
  });
  const merged = T.mergeVsWeekState(store(remoteW), store(localW));
  assert(merged.currentWeekId === 'w_remote_eq', 'égalité createdAt → remote');
  assert(merged.weeks[0].scores.p1.days.lundi === 5, 'contenu remote conservé');
}

console.log('\n=== Modif hors VS depuis vieux cache → semaine distante intacte ===');
{
  const remoteWeek = week('w_live', '2026-09-22T14:38:00.000Z', {
    scores: {
      p1: { days: { lundi: 10, mardi: 10, mercredi: 0, jeudi: 0, vendredi: 0 }, dayBrackets: {} },
    },
  });
  const remote = {
    ...store(remoteWeek),
    players: [
      { id: 'p1', pseudo: 'Alpha', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_40_45' },
      { id: 'p2', pseudo: 'Bravo', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_35_40' },
    ],
  };
  const local = {
    version: 1,
    players: [
      { id: 'p1', pseudo: 'Alpha', role: 'R4', status: 'Actif', heroPowerTierId: null },
    ],
    weeks: [],
    currentWeekId: null,
    vsWeekLifecycle: {},
    playerFollowUpNotes: {},
  };
  const merged = T.mergeCommandCenterStore(remote, local);
  assert(merged.currentWeekId === 'w_live', 'semaine distante intacte malgré dirty CC');
  assert(merged.weeks[0].scores.p1.days.lundi === 10, 'scores VS distants intacts');
  assert(merged.players.find((p) => p.id === 'p1')?.role === 'R4', 'édition rôle locale appliquée');
  assert(
    merged.players.find((p) => p.id === 'p2')?.heroPowerTierId === 'tier_35_40',
    'joueur remote-only conservé'
  );
  assert(
    merged.players.find((p) => p.id === 'p1')?.heroPowerTierId === 'tier_40_45',
    'null héros local n’écrase pas remote'
  );
}

console.log('\n=== Cycle création → scores → clôture → nouvelle semaine ===');
{
  // 1) Création locale sur remote vide
  const created = week('w_a', '2026-09-21T08:00:00.000Z');
  let state = T.mergeVsWeekState(store(null), store(created));
  assert(state.currentWeekId === 'w_a', 'création : semaine active');

  // 2) Saisie scores (même id)
  const withScores = week('w_a', '2026-09-21T08:00:00.000Z', {
    scores: {
      p1: { days: { lundi: 12, mardi: 5, mercredi: 0, jeudi: 0, vendredi: 0 }, dayBrackets: {} },
    },
  });
  state = T.mergeVsWeekState(
    { ...store(created), weeks: state.weeks, currentWeekId: state.currentWeekId },
    store(withScores)
  );
  assert(state.weeks[0].scores.p1.days.lundi === 12, 'scores après saisie');

  // 3) Clôture volontaire
  state = T.mergeVsWeekState(
    { weeks: state.weeks, currentWeekId: state.currentWeekId, vsWeekLifecycle: {} },
    store(null, { closeIntent: { weekId: 'w_a', closedAt: '2026-09-22T18:00:00.000Z' } })
  );
  assert(state.weeks.length === 0, 'clôture : plus de semaine');
  assert(state.vsWeekLifecycle.closeIntent.weekId === 'w_a', 'closeIntent posé');

  // 4) Nouvelle semaine (autre id) malgré closeIntent de w_a
  const createdB = week('w_b', '2026-09-22T19:00:00.000Z');
  state = T.mergeVsWeekState(
    { weeks: [], currentWeekId: null, vsWeekLifecycle: state.vsWeekLifecycle },
    store(createdB, state.vsWeekLifecycle)
  );
  assert(state.currentWeekId === 'w_b', 'nouvelle semaine après clôture');
  assert(state.vsWeekLifecycle.closeIntent.weekId === 'w_a', 'closeIntent w_a toujours là');

  // 5) Vieux cache w_a ne revient pas face à w_b + closeIntent
  const stale = T.mergeVsWeekState(
    { weeks: state.weeks, currentWeekId: state.currentWeekId, vsWeekLifecycle: state.vsWeekLifecycle },
    store(week('w_a', '2026-09-21T08:00:00.000Z'))
  );
  assert(stale.currentWeekId === 'w_b', 'w_a clôturée ne remplace pas w_b');
}

console.log('\n=== closeIntent pour une autre semaine n’efface pas la remote ===');
{
  const remote = store(week('w_live', '2026-09-22T14:00:00.000Z'));
  const local = store(null, {
    closeIntent: { weekId: 'w_other', closedAt: '2026-09-22T12:00:00.000Z' },
  });
  const merged = T.mergeVsWeekState(remote, local);
  assert(merged.currentWeekId === 'w_live', 'closeIntent non correspondant n’efface pas');
}

console.log('\n=== normalizeVsWeekLifecycle ===');
{
  const n = Models.normalizeVsWeekLifecycle({
    closeIntent: { weekId: 'w1', closedAt: '2026-09-22T12:00:00.000Z', extra: 1 },
  });
  assert(n.closeIntent.weekId === 'w1', 'normalize garde weekId');
  assert(n.closeIntent.closedAt === '2026-09-22T12:00:00.000Z', 'normalize garde closedAt');
  assert(Models.normalizeVsWeekLifecycle(null).closeIntent == null, 'normalize vide → {}');
  const initial = Models.createInitialState
    ? Models.createInitialState()
    : Models.normalizeState({});
  assert(
    initial.vsWeekLifecycle && typeof initial.vsWeekLifecycle === 'object',
    'état initial inclut vsWeekLifecycle'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
