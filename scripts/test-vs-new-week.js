/**
 * Nouvelle semaine VS : une seule semaine active, pas d’historique.
 * node scripts/test-vs-new-week.js
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

console.log('\n=== Code guards ===');
assert(!vsCode.includes('formatDateFR(active.startDate)'), 'le bandeau n’écrit plus la plage de dates');
assert(!vsCode.includes('formatDateFR(entry.startDate)'), 'l’historique sous seuil n’affiche plus la date de début');
assert(vsCode.includes('els.weekSelector.value = ROSStorage.getState().currentWeekId'), 'sélection forcée nouvelle semaine');
assert(vsCode.includes('Clôturer et effacer') || vsCode.includes('seront effacés'), 'clôture sans historique');

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

const w2 = M.createWeek(new Date('2026-08-03'), { number: 2, archived: false });
w2.id = 'week_2';
w2.scores = { p1: M.createEmptyScore() };
const initial = M.createBlankState();
initial.players = [M.createPlayer({ pseudo: 'Alpha', role: 'Membre', status: 'Actif' })];
initial.players[0].id = 'p1';
initial.weeks = [w2];
initial.currentWeekId = 'week_2';
store.data = JSON.stringify(initial);
sandbox.ROSStorage.hydrateFromStorage();

weekSelector.value = 'week_2';
VS.init();
VS.render();

console.log('\n=== Avant clôture ===');
let state = sandbox.ROSStorage.getState();
assert(state.currentWeekId === 'week_2', 'Semaine 2 courante');
assert(state.weeks.length === 1, 'une seule semaine');
assert(M.isWeekEditable(VS.getSelectedWeek(), state.currentWeekId), 'Semaine 2 éditable');
assert(activeTitle.textContent === 'Semaine active — Semaine 2', 'le titre affiche le numéro, sans dates');
assert(activeDates.textContent === '' && activeDates.hidden === true, 'la plage de dates n’est pas affichée');
assert(state.weeks[0].number === 2, 'le numéro interne reste 2');
assert(state.weeks[0].startDate && state.weeks[0].endDate, 'les dates internes de la semaine restent enregistrées');
assert(state.weeks[0].scores.p1, 'le score n’est pas modifié par l’affichage');

(async () => {
  console.log('\n=== Clôture puis création ===');
  await VS.closeActiveWeek();
  state = sandbox.ROSStorage.getState();
  assert(state.currentWeekId === null, 'plus d’active');
  assert(activeTitle.textContent === 'Aucune', 'sans semaine active, aucun numéro ni date');
  assert(activeDates.textContent === '', 'les dates restent masquées après clôture');
  assert(state.weeks.length === 0, 'historique effacé');

  await VS.createNewWeek();
  state = sandbox.ROSStorage.getState();
  assert(state.currentWeekId && state.currentWeekId !== 'week_2', 'nouvelle active');
  assert(state.weeks.length === 1, 'toujours une seule semaine');
  assert(weekSelector.value === state.currentWeekId, 'sélecteur sur nouvelle');
  assert(M.isWeekEditable(VS.getSelectedWeek(), state.currentWeekId), 'nouvelle éditable');
  assert(
    activeTitle.textContent.startsWith('Semaine active — Semaine '),
    'la nouvelle semaine affiche son numéro'
  );
  assert(!activeTitle.textContent.includes('/'), 'la nouvelle semaine n’affiche pas de date');
  const shownNumber = state.weeks[0].number;
  const shownStart = state.weeks[0].startDate;
  const shownEnd = state.weeks[0].endDate;
  VS.render();
  state = sandbox.ROSStorage.getState();
  assert(state.weeks[0].number === shownNumber, 'un nouvel affichage ne renumérote pas la semaine');
  assert(
    state.weeks[0].startDate === shownStart && state.weeks[0].endDate === shownEnd,
    'un nouvel affichage ne modifie pas les dates internes'
  );
  assert(String(tbody.innerHTML).includes('data-vs-day'), 'menus déroulants présents');
  assert(archiveNotice.classList._hidden === true, 'bandeau archive masqué');

  console.log('\n=== Résultat ===');
  console.log(`${passed} OK · ${failed} KO`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
