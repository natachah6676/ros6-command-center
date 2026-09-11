/**
 * VS : clôture efface la semaine (pas d’historique) + création séparée.
 * node scripts/test-vs-close-create.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const storageCode = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const vsCode = fs.readFileSync(path.join(root, 'js/vs.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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
      if (id === 'vsTableBody') return tbody;
      if (id === 'vsTable') return table;
      if (id === 'vsEmpty') return empty;
      if (id === 'vsActiveWeekTitle') return activeTitle;
      if (id === 'vsActiveWeekDates') return activeDates;
      if (id === 'btnCloseWeek') return btnClose;
      if (id === 'btnNewWeek') return btnNew;
      if (id === 'vsLegend') return { innerHTML: '' };
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

console.log('\n=== UI : Archives VS retirées ===');
assert(!html.includes('data-tab="archives"'), 'onglet Archives retiré');
assert(!html.includes('id="panel-archives"'), 'panneau Archives retiré');
assert(!html.includes('js/archives.js'), 'script archives retiré');

console.log('\n=== Normalize : historiques archivés purgés ===');
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
      scores: { p1: { days: {}, dayBrackets: {}, allianceDonMissed: true } },
    },
    {
      id: 'active_keep',
      number: 2,
      label: 'Semaine 2',
      startDate: '2026-08-03',
      endDate: '2026-08-07',
      archived: false,
      scores: { p1: { days: {}, dayBrackets: {}, allianceDonMissed: false } },
    },
  ],
  currentWeekId: 'active_keep',
  playerWeekNotes: {
    p1: {
      old_1: { comment: 'ancien' },
      active_keep: { comment: 'courant' },
    },
  },
});
assert(blank.weeks.length === 1, 'une seule semaine conservée');
assert(blank.weeks[0].id === 'active_keep', 'semaine active conservée');
assert(blank.weeks[0].archived === false, 'semaine active non archivée');
assert(!blank.playerWeekNotes.p1.old_1, 'notes semaine archivée purgées');
assert(blank.playerWeekNotes.p1.active_keep.comment === 'courant', 'notes semaine active gardées');

const allArchived = M.normalizeState({
  players: [],
  weeks: [
    {
      id: 'old_only',
      number: 1,
      label: 'Semaine 1',
      startDate: '2026-07-27',
      endDate: '2026-07-31',
      archived: true,
      scores: {},
    },
  ],
  currentWeekId: null,
});
assert(allArchived.weeks.length === 0, 'toutes archivées → weeks vide');
assert(allArchived.currentWeekId === null, 'currentWeekId null');

console.log('\n=== Seed état actif ===');
const present = M.createPlayer({ pseudo: 'Present', status: 'Actif' });
present.id = 'p_ok';
const away = M.createPlayer({ pseudo: 'Away', status: 'Actif', absent: true });
away.id = 'p_abs';
const wActive = M.createWeek(new Date('2026-08-03'), { number: 2, archived: false });
wActive.id = 'week_active';
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

console.log('\n=== Clôture (effacement, pas d’archive) ===');
(async () => {
  await VS.closeActiveWeek();
  state = sandbox.ROSStorage.getState();
  assert(state.currentWeekId === null, 'plus de semaine active');
  assert(!state.weeks.find((w) => w.id === 'week_active'), 'semaine effacée');
  assert(state.weeks.length === 0, 'aucun historique VS');
  assert(!M.getCurrentWeekFromState(state), 'getCurrentWeekFromState null');

  const statsOk = M.getPlayerVsUnderStats(state, 'p_ok');
  assert(statsOk.entries.length === 1, 'compteur : 1 entrée pour présent');
  assert(statsOk.entries[0].underDays === 1, 'compteur : 1 j sous objectif (12 pts)');
  assert(statsOk.entries[0].under === false, 'compteur : pas sous seuil (seuil 2)');
  assert(M.formatVsUnderCounterLabel(statsOk) === 'VS sous seuil : 0 / 1', 'libellé 0/1');

  const statsAbs = M.getPlayerVsUnderStats(state, 'p_abs');
  assert(statsAbs.entries.length === 0, 'absent non compté au snapshot');

  console.log('\n=== Création après clôture ===');
  await VS.createNewWeek();
  state = sandbox.ROSStorage.getState();
  assert(state.currentWeekId && state.currentWeekId !== 'week_active', 'nouvelle active');
  assert(state.weeks.length === 1, 'une seule semaine');
  assert(state.vsSettings.mode === 'afond', 'mode à fond à la création');
  assert(
    M.getPlayerVsUnderStats(state, 'p_ok').entries.length === 1,
    'compteur conservé après nouvelle semaine'
  );

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
