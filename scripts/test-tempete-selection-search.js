/**
 * Tempête — réinitialisation de la sélection et recherche par pseudo.
 * node scripts/test-tempete-selection-search.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'js/tempete.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const players = [
  { id: 'p1', pseudo: 'Élodie', status: 'Actif', preferredVolant: false },
  { id: 'p2', pseudo: 'HGS', status: 'Actif', preferredVolant: false },
  { id: 'p3', pseudo: 'Çağla', status: 'Actif', preferredVolant: false },
  { id: 'p4', pseudo: 'Fafane', status: 'Actif', preferredVolant: false },
];

const localStorage = {
  _data: {},
  getItem(k) {
    return this._data[k] ?? null;
  },
  setItem(k, v) {
    this._data[k] = String(v);
  },
};

function makeEl() {
  const classNames = new Set();
  return {
    value: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    title: '',
    className: '',
    style: {},
    dataset: {},
    classList: {
      add(name) {
        classNames.add(name);
      },
      remove(name) {
        classNames.delete(name);
      },
      toggle(name, force) {
        if (force === true) classNames.add(name);
        else if (force === false) classNames.delete(name);
        else if (classNames.has(name)) classNames.delete(name);
        else classNames.add(name);
      },
      contains(name) {
        return classNames.has(name);
      },
    },
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
}

const elements = {};
function getElementById(id) {
  if (!elements[id]) elements[id] = makeEl();
  return elements[id];
}

let confirmResult = true;
let lastConfirm = null;

const sandbox = {
  window: {},
  console,
  localStorage,
  document: {
    getElementById,
    querySelectorAll: () => [],
    createElement: () => ({ value: '', style: {}, select() {}, remove() {} }),
    body: { appendChild() {} },
  },
  AppUI: {
    toast() {},
    confirm: async (opts) => {
      lastConfirm = opts;
      return confirmResult;
    },
  },
  ROSStorage: {
    getState: () => ({ players, powerTiers: [] }),
    getPlayerById: (id) => players.find((p) => p.id === id),
    update: (fn) => {
      const alliance = {
        players: players.map((p) => ({ ...p, stormAbsencesUnexcused: 0, stormAbsencesExcused: 0 })),
      };
      fn(alliance);
      return alliance;
    },
  },
  ROSModels: {
    getPowerTiers: () => [],
    getPlayerPowerSortValue: () => 50,
    getPlayerPowerTier: () => ({ min: 50, max: 55 }),
    getPlayerPowerLabel: () => '50 à 55 M',
    getPlayerDisplayName: (_s, _id, fallback) => fallback,
  },
  ROSProfiles: {
    stampActor: () => ({ actorUserId: 'u1', actorPlayerId: null, actorLabel: 'Test' }),
    resolveActor: () => 'Test',
  },
  ROSPlayerIdentity: null,
  ROSSync: null,
};
sandbox.global = sandbox.window;
sandbox.window = Object.assign(sandbox.window, {
  localStorage,
  document: sandbox.document,
  AppUI: sandbox.AppUI,
  ROSStorage: sandbox.ROSStorage,
  ROSModels: sandbox.ROSModels,
  ROSProfiles: sandbox.ROSProfiles,
});

const saved = {
  version: 1,
  activeTeam: 'A',
  hours: { A: '13h', B: '22h' },
  teams: {
    A: {
      roster: {
        p1: { availability: 'disponible', selection: 'participant' },
        p2: { availability: 'peut_etre', selection: 'remplacant' },
        p4: { availability: 'indisponible', selection: 'non_retenu' },
      },
      strategy: { phase1: { hopital1: ['p1'] }, volantIds: [], assignmentsManual: false },
      mail: 'MAIL-A',
      attendance: { p1: 'present' },
    },
    B: {
      roster: {
        p3: { availability: 'disponible', selection: 'participant' },
      },
      strategy: { phase1: {}, volantIds: ['p3'], assignmentsManual: false },
      mail: 'MAIL-B',
      attendance: { p3: 'present' },
    },
  },
  archives: [
    {
      id: 'arch1',
      team: 'A',
      hour: '13h',
      participants: [{ id: 'old', pseudo: 'Ancien' }],
      remplacants: [{ id: 'old2', pseudo: 'AncienR' }],
    },
  ],
  recommendationStats: { p1: 1 },
  teamValidation: {
    A: { validated: false, fingerprint: '' },
    B: { validated: true, fingerprint: JSON.stringify({ p: ['p3'], r: [] }) },
  },
};
localStorage.setItem('ros6_tempete_v1', JSON.stringify(saved));

vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const T = sandbox.window.TempeteModule;

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

function readState() {
  return JSON.parse(localStorage.getItem(T.STORAGE_KEY));
}

console.log('\n=== Recherche insensible aux accents ===');
{
  assert(T.__test.foldPlayerSearch('Élodie') === T.__test.foldPlayerSearch('elodie'), 'Élodie = elodie');
  assert(T.__test.playerMatchesSearch('Élodie', 'ELO'), 'ELO trouve Élodie');
  assert(T.__test.playerMatchesSearch('Çağla', 'cagla'), 'cagla trouve Çağla');
  assert(!T.__test.playerMatchesSearch('HGS', 'elo'), 'elo ne trouve pas HGS');
  assert(T.__test.playerMatchesSearch('HGS', '   '), 'Recherche vide garde tout le monde');
}

console.log('\n=== Boutons dans la page ===');
{
  assert(html.includes('id="tempeteResetAvailability"'), 'Le bouton disponibilités est conservé');
  assert(html.includes('Réinitialiser les disponibilités'), 'Libellé disponibilités inchangé');
  assert(html.includes('id="tempeteResetSelection"'), 'Bouton réinitialiser la sélection');
  assert(html.includes('id="tempetePlayerSearch"'), 'Champ de recherche');
  assert(
    code.includes('Les sélections et la stratégie ne sont pas modifiées'),
    'La réinitialisation des disponibilités ne vide pas la sélection'
  );
}

console.log('\n=== Annulation puis réinitialisation ===');
T.init();
(async () => {
  const before = readState();
  confirmResult = false;
  lastConfirm = null;
  await getElementById('tempeteResetSelection').listeners.click();
  const afterCancel = readState();
  assert(lastConfirm && lastConfirm.title === 'Réinitialiser la sélection', 'Confirmation demandée');
  assert(JSON.stringify(afterCancel) === JSON.stringify(before), 'Annulation : aucune donnée modifiée');
  assert(afterCancel.teams.A.roster.p1.selection === 'participant', 'Annulation : participant conservé');
  assert(afterCancel.teams.A.roster.p2.selection === 'remplacant', 'Annulation : remplaçant conservé');
  assert(afterCancel.teams.A.strategy !== null, 'Annulation : stratégie conservée');

  getElementById('tempetePlayerSearch').value = 'hgs';
  getElementById('tempetePlayerSearch').listeners.input();
  const duringSearch = readState();
  assert(JSON.stringify(duringSearch.teams) === JSON.stringify(afterCancel.teams), 'La recherche ne modifie pas le roster');
  assert(getElementById('tempetePlayersBody').innerHTML.includes('HGS'), 'La recherche affiche HGS');
  assert(!getElementById('tempetePlayersBody').innerHTML.includes('Élodie'), 'La recherche masque Élodie');
  assert(getElementById('tempeteSelectionSummary').textContent.includes('Participants : 1'), 'Le décompte reste celui de toute la Tempête');

  confirmResult = true;
  await getElementById('tempeteResetSelection').listeners.click();
  const reset = readState();
  assert(reset.teams.A.roster.p1.selection === 'non_retenu', 'Participant retiré même s’il est masqué par la recherche');
  assert(reset.teams.A.roster.p1.availability === 'disponible', 'Disponibilité du participant conservée');
  assert(reset.teams.A.roster.p2.selection === 'non_retenu', 'Remplaçant retiré');
  assert(reset.teams.A.roster.p2.availability === 'peut_etre', 'Disponibilité du remplaçant conservée');
  assert(reset.teams.A.roster.p4.availability === 'indisponible', 'Non retenu inchangé');
  assert(reset.teams.A.attendance.p1 === 'present', 'Présences de clôture non effacées');
  assert(reset.teams.A.strategy === null, 'Stratégie de la Tempête en cours effacée');
  assert(reset.teams.A.mail === '', 'Mail de la Tempête en cours effacé');
  assert(reset.teams.B.roster.p3.selection === 'participant', 'L’autre Tempête garde ses participants');
  assert(reset.teams.B.mail === 'MAIL-B', 'Le mail de l’autre Tempête est intact');
  assert(JSON.stringify(reset.archives) === JSON.stringify(before.archives), 'Archives inchangées');
  assert(reset.teamValidation.B.validated === true, 'Validation de l’autre Tempête inchangée');
  assert(reset.teamValidation.A.validated === false, 'Validation de la Tempête en cours retirée');

  getElementById('tempetePlayerSearch').value = 'elo';
  getElementById('tempetePlayerSearch').listeners.input();
  assert(getElementById('tempetePlayersBody').innerHTML.includes('Élodie'), 'elo retrouve Élodie');
  assert(getElementById('tempetePlayersBody').innerHTML.includes('disponible'), 'La disponibilité reste visible après recherche');
  assert(getElementById('tempetePlayersBody').innerHTML.includes('Non retenu'), 'La sélection réinitialisée reste visible');

  getElementById('tempetePlayerSearch').value = '';
  getElementById('tempetePlayerSearch').listeners.input();
  const body = getElementById('tempetePlayersBody').innerHTML;
  assert(body.includes('Élodie') && body.includes('HGS') && body.includes('Fafane'), 'Effacer la recherche réaffiche la liste');
  const kept = readState();
  assert(kept.teams.A.roster.p1.selection === 'non_retenu', 'Effacer la recherche ne restaure pas la sélection');
  assert(kept.teams.A.roster.p1.availability === 'disponible', 'Effacer la recherche ne change pas les disponibilités');

  console.log('\n=== Résultat ===');
  console.log(`${passed} OK · ${failed} KO`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
