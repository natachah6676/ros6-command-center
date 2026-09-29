/**
 * Régression : compteur Gestion des membres > 0 ⇒ liste HTML rendue.
 * Bug PR #29 : renderList utilisait `state` non défini → throw après le compteur.
 * node scripts/test-suivi-list-render.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');

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

console.log('Régression rendu liste Gestion des membres');

const renderListSlice = suiviCode.slice(
  suiviCode.indexOf('function renderList'),
  suiviCode.indexOf('function renderDetail')
);
assert(renderListSlice.includes('function renderList'), 'slice renderList trouvé');
assert(
  !/getOpenFollowUpHelpTypes\(\s*state\s*,/.test(renderListSlice),
  'renderList n’utilise pas state non défini pour helpBits'
);
assert(
  /getOpenFollowUpHelpTypes\(\s*fresh\s*,/.test(renderListSlice),
  'renderList utilise fresh pour getOpenFollowUpHelpTypes'
);
assert(
  /els\.counter\.textContent[\s\S]*els\.list\.innerHTML/.test(renderListSlice),
  'compteur puis injection liste dans le même flux'
);

function makeEl(extra = {}) {
  return {
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    addEventListener() {},
    classList: {
      _hidden: false,
      add(name) {
        if (name === 'hidden') this._hidden = true;
      },
      remove(name) {
        if (name === 'hidden') this._hidden = false;
      },
      toggle(name, force) {
        if (name === 'hidden') {
          this._hidden = typeof force === 'boolean' ? force : !this._hidden;
        }
      },
      contains(name) {
        return name === 'hidden' ? this._hidden : false;
      },
    },
    ...extra,
  };
}

const dom = {
  suiviCounter: makeEl(),
  suiviList: makeEl(),
  suiviEmpty: makeEl(),
  suiviDetail: makeEl({ classList: makeEl().classList }),
  suiviDetailEmpty: makeEl(),
  suiviFilterStatus: makeEl({ value: '' }),
  suiviFilterReason: makeEl({ value: '' }),
  suiviFilterAssignee: makeEl({ value: '' }),
  suiviSearch: makeEl({ value: '' }),
  suiviShowDone: makeEl({ checked: false }),
  suiviAddPlayer: makeEl(),
  suiviAddAssignee: makeEl(),
  suiviAddWrap: makeEl(),
  suiviScopeHint: makeEl(),
  panelSuivi: makeEl(),
};

// Fix nested classList for detail/empty after spread
dom.suiviDetail.classList = makeEl().classList;
dom.suiviDetail.classList._hidden = true;
dom.suiviEmpty.classList = makeEl().classList;
dom.suiviDetailEmpty.classList = makeEl().classList;

const byId = {
  'panel-suivi': dom.panelSuivi,
  suiviCounter: dom.suiviCounter,
  suiviList: dom.suiviList,
  suiviEmpty: dom.suiviEmpty,
  suiviDetail: dom.suiviDetail,
  suiviDetailEmpty: dom.suiviDetailEmpty,
  suiviFilterStatus: dom.suiviFilterStatus,
  suiviFilterReason: dom.suiviFilterReason,
  suiviFilterAssignee: dom.suiviFilterAssignee,
  suiviSearch: dom.suiviSearch,
  suiviShowDone: dom.suiviShowDone,
  suiviAddPlayer: dom.suiviAddPlayer,
  suiviAddAssignee: dom.suiviAddAssignee,
  suiviAddWrap: dom.suiviAddWrap,
  suiviScopeHint: dom.suiviScopeHint,
  btnSuiviAdd: makeEl(),
};

const sandbox = {
  window: {},
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Boolean,
  Array,
  Object,
  document: {
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  },
};
sandbox.window = sandbox;
vm.runInNewContext(modelsCode, sandbox);
const M = sandbox.ROSModels;

const lowTier = (M.createDefaultPowerTiers() || []).find((t) => Number(t.max) <= 35);
const state = M.createBlankState();
state.powerTiers = M.createDefaultPowerTiers();
state.followUpSettings = M.normalizeFollowUpSettings({ heroMaxM: 35 });
state.players = [
  Object.assign(M.createPlayer({ pseudo: 'Alpha', status: 'Actif', heroPowerTierId: lowTier?.id }), {
    id: 'p1',
  }),
  Object.assign(M.createPlayer({ pseudo: 'Beta', status: 'Actif', discret: true }), {
    id: 'p2',
    heroPowerTierId: (state.powerTiers || []).find((t) => Number(t.min) > 35)?.id || null,
  }),
  Object.assign(M.createPlayer({ pseudo: 'Gamma', status: 'Actif' }), {
    id: 'p3',
    heroPowerTierId: (state.powerTiers || []).find((t) => Number(t.min) > 35)?.id || null,
  }),
];
state.playerFollowUps = {
  p1: M.createEmptyFollowUpCase({
    status: 'to_contact',
    reasons: { hero: true },
  }),
  p2: M.createEmptyFollowUpCase({
    status: 'contacted',
    reasons: { discret: true },
    manual: true,
  }),
  p3: M.createEmptyFollowUpCase({
    status: 'in_progress',
    reasons: { manual: true },
    manual: true,
  }),
};
state.playerFollowUpNotes = {};

let liveState = state;
sandbox.ROSStorage = {
  getState: () => liveState,
  update: (fn) => {
    liveState = fn(liveState) || liveState;
    return liveState;
  },
};
sandbox.ROSProfiles = {
  isActiveR5: () => true,
  isActiveR4OrR5: () => true,
  getCurrentProfile: () => ({ playerId: null, role: 'R5' }),
  listProfiles: () => [],
  stampActor: () => ({ actorLabel: 'Willow', actorUserId: 'u1' }),
};
sandbox.AppUI = { toast() {}, confirm: async () => true, switchTab() {} };
sandbox.ROSModels = M;
vm.runInNewContext(suiviCode, sandbox);
const Suivi = sandbox.SuiviModule;
Suivi.init();

let threw = null;
try {
  Suivi.render();
} catch (error) {
  threw = error;
}
assert(!threw, threw ? `render ne throw pas (${threw.message})` : 'render ne throw pas');

const counterText = String(dom.suiviCounter.textContent || '');
const listHtml = String(dom.suiviList.innerHTML || '');
const countMatch = counterText.match(/(\d+)\s*joueur/);
const counterN = countMatch ? Number(countMatch[1]) : 0;
const listRows = (listHtml.match(/data-suivi-open=/g) || []).length;

assert(counterN >= 3, `compteur > 0 (reçu ${counterN})`);
assert(listRows >= 3, `liste rendue > 0 (reçu ${listRows} lignes)`);
assert(counterN === listRows, `compteur (${counterN}) = lignes liste (${listRows})`);
assert(listHtml.includes('Alpha'), 'Alpha visible dans la liste');
assert(listHtml.includes('Beta'), 'Beta visible dans la liste');
assert(listHtml.includes('Gamma'), 'Gamma visible dans la liste');
assert(dom.suiviEmpty.classList._hidden === true, 'empty-state masqué quand liste non vide');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
