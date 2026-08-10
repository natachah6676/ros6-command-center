/**
 * Nouvelle semaine VS : active éditable, archive précédente en lecture seule.
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
assert(vsCode.includes('els.weekSelector.value = ROSStorage.getState().currentWeekId'), 'sélection forcée nouvelle semaine');
assert(/weekSelector\.value = ROSStorage\.getState\(\)\.currentWeekId;\s*\n\s*render\(\);/.test(vsCode), 'render après création');
assert(vsCode.includes('Toujours relire la semaine réellement sélectionnée'), 'renderWeekBar relit la sélection');

const store = { data: null };
const weekSelector = { value: '', addEventListener() {} };
const archiveNotice = { classList: { _hidden: true, toggle(_c, v) { this._hidden = v; } }, textContent: '' };
const donationsWrap = { classList: { toggle() {} } };
const donationsCheck = { checked: false, disabled: false, addEventListener() {} };
const tbody = { innerHTML: '', addEventListener() {} };
const table = { classList: { add() {}, remove() {}, toggle() {} } };
const empty = { classList: { add() {}, remove() {} }, textContent: '' };
const activeTitle = { textContent: '' };
const activeDates = { textContent: '' };

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
      if (id === 'vsDonationsVerifiedWrap') return donationsWrap;
      if (id === 'vsDonationsVerified') return donationsCheck;
      if (id === 'vsTableBody') return tbody;
      if (id === 'vsTable') return table;
      if (id === 'vsEmpty') return empty;
      if (id === 'vsActiveWeekTitle') return activeTitle;
      if (id === 'vsActiveWeekDates') return activeDates;
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
  ROSSync: { schedulePush() {} },
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

// Seed state: Semaine 2 active
const w1 = M.createWeek(new Date('2026-07-27'), { number: 1, archived: true });
w1.id = 'week_1';
w1.closedBy = '';
const w2 = M.createWeek(new Date('2026-08-03'), { number: 2, archived: false });
w2.id = 'week_2';
w2.donationsVerified = true;
w2.scores = {
  p1: M.createEmptyScore(),
};
const initial = M.createBlankState();
initial.players = [
  M.createPlayer({ pseudo: 'Alpha', role: 'Membre', status: 'Actif' }),
];
initial.players[0].id = 'p1';
initial.weeks = [w2, w1];
initial.currentWeekId = 'week_2';
store.data = JSON.stringify(initial);
sandbox.ROSStorage.hydrateFromStorage();

weekSelector.value = 'week_2';
VS.init();
VS.render();

console.log('\n=== Avant nouvelle semaine ===');
let state = sandbox.ROSStorage.getState();
assert(state.currentWeekId === 'week_2', 'Semaine 2 courante');
assert(M.isWeekEditable(VS.getSelectedWeek(), state.currentWeekId), 'Semaine 2 éditable');
assert(archiveNotice.classList._hidden === true, 'bandeau archive masqué');

console.log('\n=== Création nouvelle semaine (simule bouton) ===');
// Reproduit le bug éventuel : selector encore sur week_2 pendant le 1er render subscribe
let renderCount = 0;
const origRender = VS.render;
sandbox.ROSStorage.subscribe(() => {
  renderCount += 1;
});

// Appelle createNewWeek via le flux corrigé : update + set selector + render
(async () => {
  sandbox.ROSStorage.update((s) => {
    const currentWeek = s.weeks.find((w) => w.id === s.currentWeekId);
    currentWeek.archived = true;
    currentWeek.closedAt = new Date().toISOString();
    currentWeek.closedBy = 'Willow';
    const week = M.createWeek(new Date('2026-08-10'), { number: 3, archived: false });
    week.id = 'week_3';
    s.players
      .filter((p) => p.status === 'Actif')
      .forEach((p) => {
        week.scores[p.id] = M.createEmptyScore();
      });
    s.weeks.unshift(week);
    s.currentWeekId = week.id;
    return s;
  });

  // Fix : forcer selector + render (sinon UI reste sur l’archive)
  weekSelector.value = sandbox.ROSStorage.getState().currentWeekId;
  VS.render();

  state = sandbox.ROSStorage.getState();
  const week3 = state.weeks.find((w) => w.id === 'week_3');
  const week2 = state.weeks.find((w) => w.id === 'week_2');

  console.log('\n=== Après création ===');
  assert(state.currentWeekId === 'week_3', 'currentWeekId = Semaine 3');
  assert(week3 && week3.archived === false, 'Semaine 3 archived=false');
  assert(!week3.closedAt && !week3.closedBy, 'Semaine 3 sans closedAt/closedBy');
  assert(week2.archived === true && week2.closedBy === 'Willow', 'Semaine 2 archivée Willow');
  assert(weekSelector.value === 'week_3', 'sélecteur sur Semaine 3');
  assert(M.isWeekEditable(VS.getSelectedWeek(), state.currentWeekId), 'Semaine 3 éditable');
  assert(archiveNotice.classList._hidden === true, 'bandeau archive masqué sur active');
  assert(String(tbody.innerHTML).includes('data-vs-day'), 'menus déroulants Lundi–Vendredi présents');

  // Consulter Semaine 2
  weekSelector.value = 'week_2';
  VS.render();
  assert(!M.isWeekEditable(VS.getSelectedWeek(), state.currentWeekId), 'Semaine 2 lecture seule');
  assert(archiveNotice.classList._hidden === false, 'bandeau archive visible sur S2');
  assert(String(archiveNotice.textContent).includes('Willow'), 'bandeau cite Willow');
  assert(!String(tbody.innerHTML).includes('data-vs-day'), 'pas de selects sur archive');

  // Revenir Semaine 3
  weekSelector.value = 'week_3';
  VS.render();
  assert(M.isWeekEditable(VS.getSelectedWeek(), state.currentWeekId), 'retour S3 éditable');
  assert(archiveNotice.classList._hidden === true, 'bandeau masqué au retour S3');
  assert(String(tbody.innerHTML).includes('data-vs-day'), 'selects de nouveau présents');

  // Données S3 non perdues
  const again = sandbox.ROSStorage.getState().weeks.find((w) => w.id === 'week_3');
  assert(again && again.scores.p1, 'scores S3 conservés');

  console.log('\n=== Résultat ===');
  console.log(`${passed} OK · ${failed} KO`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
