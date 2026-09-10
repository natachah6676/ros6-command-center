/**
 * VS : clôture / création séparées + snapshot d’absence.
 * node scripts/test-vs-close-create.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const storageCode = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
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

const store = { data: null };
const weekSelector = { value: '', addEventListener() {} };
const archiveNotice = {
  classList: {
    _hidden: true,
    toggle(_c, v) {
      this._hidden = v;
    },
    add() {
      this._hidden = true;
    },
    remove() {
      this._hidden = false;
    },
  },
  textContent: '',
};
const noActiveNotice = {
  classList: {
    _hidden: true,
    toggle(_c, v) {
      this._hidden = v;
    },
    add() {
      this._hidden = true;
    },
    remove() {
      this._hidden = false;
    },
  },
  textContent: '',
};
const donationsWrap = { classList: { toggle() {} } };
const donationsCheck = { checked: false, disabled: false, addEventListener() {} };
const tbody = { innerHTML: '', addEventListener() {} };
const table = { classList: { add() {}, remove() {}, toggle() {} } };
const empty = { classList: { add() {}, remove() {} }, textContent: '' };
const activeTitle = { textContent: '' };
const activeDates = { textContent: '' };
const btnClose = { disabled: false, addEventListener() {} };
const btnNew = { disabled: false, title: '', addEventListener() {} };

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
      if (id === 'vsArchiveNotice') return archiveNotice;
      if (id === 'vsNoActiveNotice') return noActiveNotice;
      if (id === 'vsDonationsVerifiedWrap') return donationsWrap;
      if (id === 'vsDonationsVerified') return donationsCheck;
      if (id === 'vsTableBody') return tbody;
      if (id === 'vsTable') return table;
      if (id === 'vsEmpty') return empty;
      if (id === 'vsActiveWeekTitle') return activeTitle;
      if (id === 'vsActiveWeekDates') return activeDates;
      if (id === 'btnCloseWeek') return btnClose;
      if (id === 'btnNewWeek') return btnNew;
      if (id === 'vsLegend') return { innerHTML: '' };
      if (id === 'vsModeLabel') return { innerHTML: '' };
      if (id === 'vsToggleMode') return { textContent: '', dataset: {}, addEventListener() {} };
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
    querySelectorAll: () => [],
  },
  AppUI: {
    toast() {},
    confirm: async () => true,
  },
  ROSSync: { schedulePush() {}, flushPush: async () => ({ ok: false, reason: 'local-runtime' }) },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(storageCode, sandbox);
sandbox.ROSStorage = sandbox.window.ROSStorage;
vm.runInContext(vsCode, sandbox);
const VS = sandbox.window.VSModule;
const M = sandbox.ROSModels;

console.log('\n=== Normalize : aucune active possible ===');
const blank = M.normalizeState({
  players: [],
  weeks: [
    {
      id: 'old_1',
      number: 1,
      label: 'Semaine 1',
      startDate: '2026-07-27',
      endDate: '2026-07-31',
      archived: true,
      scores: { p1: { days: {}, dayBrackets: {}, allianceDonMissed: false } },
    },
  ],
  currentWeekId: null,
});
assert(blank.currentWeekId === null, 'currentWeekId null conservé');
assert(blank.weeks[0].archived === true, 'semaine historique archivée');
assert(blank.weeks[0].scores.p1.absent === false, 'ancienne donnée sans absent → false');

console.log('\n=== Seed état actif ===');
const present = M.createPlayer({ pseudo: 'Present', status: 'Actif' });
present.id = 'p_ok';
const away = M.createPlayer({ pseudo: 'Away', status: 'Actif', absent: true });
away.id = 'p_abs';
const wActive = M.createWeek(new Date('2026-08-03'), { number: 2, archived: false });
wActive.id = 'week_active';
wActive.donationsVerified = true;
wActive.scores = {
  p_ok: M.createEmptyScore(),
};
wActive.scores.p_ok.days.lundi = 12;
wActive.scores.p_ok.dayBrackets.lundi = 'low';

const initial = M.createBlankState();
initial.players = [present, away];
initial.weeks = [wActive];
initial.currentWeekId = 'week_active';
store.data = JSON.stringify(initial);
sandbox.ROSStorage.hydrateFromStorage();
weekSelector.value = 'week_active';
VS.init();
VS.render();

let state = sandbox.ROSStorage.getState();
assert(state.currentWeekId === 'week_active', 'semaine active');
assert(M.isWeekEditable(VS.getActiveWeek(state), state.currentWeekId), 'éditable');

console.log('\n=== Clôture (snapshot absences) ===');
(async () => {
  await VS.closeActiveWeek();
  state = sandbox.ROSStorage.getState();
  const closed = state.weeks.find((w) => w.id === 'week_active');
  assert(state.currentWeekId === null, 'plus de semaine active');
  assert(closed.archived === true, 'semaine clôturée archivée');
  assert(closed.scores.p_ok.absent === false, 'présent → absent false');
  assert(closed.scores.p_ok.days.lundi === 12, 'score présent conservé');
  assert(closed.scores.p_abs.absent === true, 'absent → snapshot absent true');
  assert(M.computeTotal(closed.scores.p_abs, state) === 0, 'absent score 0');
  assert(M.isScoreAbsent(closed.scores.p_abs), 'isScoreAbsent');
  const summaryAbs = M.getWeekScoreSummary(closed, 'p_abs', state);
  assert(summaryAbs.absent === true && summaryAbs.total === 0, 'summary absent');
  assert(!M.getCurrentWeekFromState(state), 'getCurrentWeekFromState null');

  console.log('\n=== Création sans clôturer l’inexistant ===');
  await VS.createNewWeek();
  state = sandbox.ROSStorage.getState();
  assert(state.currentWeekId && state.currentWeekId !== 'week_active', 'nouvelle active');
  assert(state.vsSettings.mode === 'afond', 'mode à fond à la création');
  const prev = state.weeks.find((w) => w.id === 'week_active');
  assert(prev && prev.archived === true, 'ancienne semaine toujours là');
  assert(Object.keys(prev.scores).includes('p_abs'), 'historique absences intact');

  console.log('\n=== Impossible de créer si déjà active ===');
  const beforeCount = state.weeks.length;
  await VS.createNewWeek();
  state = sandbox.ROSStorage.getState();
  assert(state.weeks.length === beforeCount, 'pas de double création');

  console.log('\n=== Résultat ===');
  console.log(`${passed} OK · ${failed} KO`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
