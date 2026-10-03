/**
 * Ruche de contrôle — saisie manuelle, sans lien avec l'optimiseur.
 * node scripts/test-ruche-control.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const i18nCode = fs.readFileSync(path.join(root, 'js/ruche-i18n.js'), 'utf8');
const rucheCode = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');
const identityCode = fs.readFileSync(path.join(root, 'js/player-identity.js'), 'utf8');
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

function functionSlice(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return '';
  let open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

console.log('\n=== Câblage ===');
assert(html.includes('id="rucheControlBlock"'), 'bloc Ruche de contrôle');
assert(html.includes('id="rucheControlGrid"'), 'grille de contrôle');
assert(html.includes('id="rucheControlSearch"'), 'champ de recherche');
assert(html.includes('id="rucheControlMoveList"'), 'liste À déplacer');
assert(html.includes('id="rucheControlReset"'), 'bouton réinitialiser');
assert(!html.includes('draggable') || !html.includes('rucheControlGrid" draggable'), 'pas de drag sur la grille de contrôle');
const controlStart = rucheCode.indexOf('function createEmptyControl');
const controlEnd = rucheCode.indexOf('function cacheDom');
const controlSrc = rucheCode.slice(controlStart, controlEnd);
assert(controlStart > 0 && controlEnd > controlStart, 'bloc contrôle localisé');
assert(!controlSrc.includes('isWellPlaced'), 'le contrôle n’appelle pas isWellPlaced');
assert(!controlSrc.includes('buildOptimizedProposal'), 'le contrôle ne lance pas l’optimiseur');
assert(!controlSrc.includes('computeRosterDiff'), 'le contrôle ne compare pas les effectifs');
assert(!controlSrc.includes('getUsedPlayerIdsExcept'), 'le contrôle n’utilise pas les ids de la ruche actuelle');
assert(!controlSrc.includes('colorForGridCell'), 'le contrôle ne reprend pas les couleurs d’anneau');
assert(!controlSrc.includes('draggable'), 'pas de glisser-déposer dans le contrôle');
['commitClearCurrentHive', 'commitValidateCurrentHive', 'commitValidateProposal'].forEach((name) => {
  const body = functionSlice(rucheCode, `function ${name}`);
  assert(body && !body.includes('.control'), `${name} ne modifie pas control`);
});

const store = { data: null };
const players = [
  { id: 'w1', pseudo: 'Willow', role: 'Membre', status: 'Actif' },
  { id: 'm1', pseudo: 'Mertz', role: 'Membre', status: 'Actif' },
  { id: 'x1', pseudo: 'Xal', role: 'Membre', status: 'Actif' },
  { id: 'gone', pseudo: 'Ghost', role: 'Membre', status: 'Parti' },
  { id: 'off', pseudo: 'Sleepy', role: 'Membre', status: 'Actif', inactive: true },
];

const sandbox = {
  window: {},
  console,
  localStorage: {
    getItem: () => store.data,
    setItem: (_key, value) => {
      store.data = value;
    },
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  ROSStorage: {
    getState: () => ({
      players,
      powerTiers: [],
    }),
  },
  AppUI: {
    toast() {},
    confirm: async () => true,
  },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
sandbox.ROSStorage.getState = () => ({
  players,
  powerTiers: sandbox.ROSModels.createDefaultPowerTiers(),
});
vm.runInContext(i18nCode, sandbox);
vm.runInContext(identityCode, sandbox);
vm.runInContext(rucheCode, sandbox);
const Ruche = sandbox.window.RucheModule;
const Identity = sandbox.window.ROSPlayerIdentity;

function emptyControl(control) {
  if (!control || control.bottomId) return false;
  if (Object.keys(control.statusByPlayerId || {}).length) return false;
  if (!Array.isArray(control.grid) || control.grid.length !== 10) return false;
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 10; c += 1) {
      const value = control.grid[r][c];
      if (r === 4 && c === 4) {
        if (value !== 'MARSHAL') return false;
      } else if (value) return false;
    }
  }
  return true;
}

function slot(row, col) {
  return { type: 'grid', row, col };
}

console.log('\n=== Vide par défaut et ancien document ===');
const fresh = Ruche.getControl();
assert(emptyControl(fresh), 'contrôle vide par défaut');
assert(Ruche.getState().proposal == null, 'proposition non calculée au simple chargement');
assert(Ruche.getControlSummary().placed === 0, 'aucun placé');
assert(Ruche.getControlSummary().moveNames.length === 0, 'liste À déplacer vide');

const planningGrid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
planningGrid[4][4] = 'MARSHAL';
planningGrid[0][0] = 'w1';
const messy = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
messy[4][4] = 'w1';
messy[0][0] = 'FREE';
messy[0][1] = 'w1';
messy[0][2] = 'w1';
messy[1][1] = 'm1';
store.data = JSON.stringify({
  version: 6,
  grid: planningGrid,
  bottomId: 'x1',
  colors: { marshal: '#112233', r4: '#5B9BD5', free: '#000000' },
  archives: [{ id: 'arch1', label: 'Plan conservé', grid: planningGrid, bottomId: null }],
  proposal: null,
});
Ruche.hydrateFromStorage();
assert(Ruche.getState().grid[0][0] === 'w1', 'ruche actuelle conservée sans champ control');
assert(Ruche.getState().bottomId === 'x1', 'case du bas actuelle conservée');
assert(Ruche.getState().colors.marshal === '#112233', 'couleur Maréchal conservée');
assert(Ruche.getState().archives.length === 1, 'archives conservées');
assert(emptyControl(Ruche.getControl()), 'ancien document : contrôle vide');
assert(Ruche.getState().proposal == null, 'pas de proposition créée par l’hydratation');

store.data = JSON.stringify({
  version: 6,
  grid: planningGrid,
  bottomId: 'x1',
  colors: { marshal: '#112233' },
  archives: [{ id: 'arch1', label: 'Plan conservé' }],
  proposal: null,
  control: {
    grid: messy,
    bottomId: 'FREE',
    statusByPlayerId: { w1: 'move', m1: 'alt_ok', absent: 'good' },
  },
});
Ruche.hydrateFromStorage();
assert(Ruche.getControl().grid[4][4] === 'MARSHAL', 'Maréchal forcé, joueur du centre non replacé');
assert(Ruche.getControl().grid[0][0] == null, 'FREE retiré du contrôle');
assert(Ruche.getControl().grid[0][1] === 'w1', 'premier doublon conservé');
assert(Ruche.getControl().grid[0][2] == null, 'doublon suivant retiré');
assert(Ruche.getControl().grid[1][1] === 'm1', 'second joueur conservé');
assert(Ruche.getControl().bottomId == null, 'FREE interdit en case du bas');
assert(Ruche.getControl().statusByPlayerId.w1 === 'move', 'statut du joueur conservé');
assert(Ruche.getControl().statusByPlayerId.m1 === 'alt_ok', 'statut alternatif conservé');
assert(!Ruche.getControl().statusByPlayerId.absent, 'statut sans case ignoré');
assert(!Ruche.getControl().statusByPlayerId[Ruche.getControl().grid[4][4]], 'pas de statut Maréchal');

console.log('\n=== Recherche, placement, statuts ===');
store.data = null;
Ruche.hydrateFromStorage();
assert(Ruche.searchControlPlayers('').length === 0, 'pas de liste complète tant que la recherche est vide');
assert(Ruche.searchControlPlayers('wil').some((p) => p.id === 'w1'), 'fragment wil trouve Willow');
assert(!Ruche.searchControlPlayers('wil').some((p) => p.id === 'm1'), 'fragment wil ignore Mertz');
assert(!Ruche.searchControlPlayers('gho').some((p) => p.id === 'gone'), 'joueur Parti exclu');
assert(!Ruche.searchControlPlayers('sle').some((p) => p.id === 'off'), 'joueur inactif exclu');
assert(Ruche.tapControlCell({ type: 'grid', row: 4, col: 4 }) === false, 'case Maréchal non modifiable');
assert(Ruche.getControlInteraction().mode === 'idle', 'Maréchal ne ouvre pas la saisie');

assert(Ruche.tapControlCell(slot(0, 0)) === true, 'case vide ouvre la saisie');
assert(Ruche.getControlInteraction().mode === 'search', 'mode recherche');
Ruche.setControlSearchQuery('wil');
assert(Ruche.pickControlPlayer('w1') === true, 'sélection place Willow');
assert(Ruche.getControl().grid[0][0] === 'w1', 'Willow en 1,1');
assert(Ruche.getControl().statusByPlayerId.w1 === 'good', 'statut initial good');
assert(Ruche.getControlInteraction().mode === 'idle', 'la saisie se referme après placement');
assert(Ruche.getState().proposal == null, 'placer un joueur ne calcule pas la proposition');

assert(Ruche.tapControlCell(slot(0, 1)) === true, 'seconde case');
Ruche.setControlSearchQuery('wil');
assert(Ruche.searchControlPlayers('wil').length === 0, 'joueur déjà placé exclu de la recherche');
assert(Ruche.pickControlPlayer('w1') === false, 'sélection impossible si déjà placé');
assert(Ruche.placeControlPlayer(slot(0, 1), 'w1') === false, 'doublon refusé');
assert(Ruche.getControl().grid[0][1] == null, 'la seconde case reste vide');
Ruche.cancelControlInteraction();

Ruche.tapControlCell(slot(0, 1));
Ruche.setControlSearchQuery('mer');
assert(Ruche.pickControlPlayer('m1') === true, 'Mertz placé');
Ruche.tapControlCell({ type: 'bottom' });
Ruche.setControlSearchQuery('xa');
assert(Ruche.pickControlPlayer('x1') === true, 'Xal en case du bas');
assert(Ruche.getControl().bottomId === 'x1', 'bottomId du contrôle');

Ruche.tapControlCell(slot(0, 0));
assert(Ruche.getControlInteraction().mode === 'actions', 'case occupée ouvre les actions');
assert(Ruche.chooseControlStatus('alt_ok') === true, 'passe à Autre place — OK');
assert(Ruche.getControl().statusByPlayerId.w1 === 'alt_ok', 'statut alt_ok enregistré');
assert(Ruche.chooseControlStatus('move') === true, 'passe à À déplacer');
assert(Ruche.chooseControlStatus('good') === true, 'revient à Bien placé');
assert(Ruche.chooseControlStatus('move') === true, 'Willow à déplacer');
Ruche.tapControlCell(slot(0, 1));
Ruche.chooseControlStatus('alt_ok');
const summary = Ruche.getControlSummary();
assert(summary.placed === 3, '3 placés');
assert(summary.good === 1, '1 bien placé');
assert(summary.alt === 1, '1 autre place validée');
assert(summary.move === 1, '1 à déplacer');
assert(summary.moveNames.join(', ') === 'Willow', 'liste À déplacer : Willow');

console.log('\n=== Déplacement, changement, retrait ===');
Ruche.tapControlCell(slot(0, 0));
assert(Ruche.startControlMove() === true, 'déplacement armé');
assert(Ruche.getControlInteraction().mode === 'move', 'mode déplacement');
assert(Ruche.tapControlCell(slot(0, 1)) === false, 'case occupée refusée');
assert(Ruche.getControl().grid[0][0] === 'w1', 'Willow pas déplacé vers une case occupée');
assert(Ruche.tapControlCell(slot(2, 2)) === true, 'second tap sur une case vide');
assert(Ruche.getControl().grid[0][0] == null, 'case d’origine vidée');
assert(Ruche.getControl().grid[2][2] === 'w1', 'Willow arrivé en 3,3');
assert(Ruche.getControl().statusByPlayerId.w1 === 'move', 'le déplacement conserve À déplacer');
assert(Ruche.getControlInteraction().mode === 'idle', 'fin du déplacement');
assert(Ruche.getControlSummary().moveNames.join(', ') === 'Willow', 'liste À déplacer inchangée après déplacement');

Ruche.tapControlCell(slot(2, 2));
assert(Ruche.startControlChangePlayer() === true, 'changement de joueur');
Ruche.setControlSearchQuery('xa');
assert(Ruche.searchControlPlayers('xa').length === 0, 'Xal déjà placé n’est pas proposé');
Ruche.setControlSearchQuery('mer');
assert(Ruche.searchControlPlayers('mer').length === 0, 'Mertz déjà placé n’est pas proposé');
Ruche.cancelControlInteraction();
Ruche.tapControlCell(slot(0, 1));
assert(Ruche.removeSelectedControlPlayer() === true, 'retrait de Mertz');
assert(Ruche.getControl().grid[0][1] == null, 'case de Mertz vidée');
assert(!Ruche.getControl().statusByPlayerId.m1, 'statut de Mertz retiré');
assert(Ruche.getControl().grid[2][2] === 'w1', 'Willow reste en place pendant le retrait');
Ruche.tapControlCell(slot(2, 2));
assert(Ruche.startControlChangePlayer() === true, 'changement de joueur');
Ruche.setControlSearchQuery('mer');
assert(Ruche.pickControlPlayer('m1') === true, 'Mertz remplace Willow');
assert(Ruche.getControl().grid[2][2] === 'm1', 'case tenue par Mertz');
assert(Ruche.getControl().statusByPlayerId.m1 === 'good', 'le remplaçant démarre Bien placé');
assert(!Ruche.getControl().statusByPlayerId.w1, 'Willow n’a plus de statut');
assert(Ruche.searchControlPlayers('wil').some((p) => p.id === 'w1'), 'Willow redevient cherchable');

console.log('\n=== Indépendance des autres ruches ===');
assert(Ruche.isPlayerUsedOnCurrentHive('m1') === false, 'un joueur seulement au contrôle reste disponible pour la ruche actuelle');
Ruche.setCell(1, 1, 'w1');
assert(Ruche.isPlayerUsedOnCurrentHive('w1') === true, 'la ruche actuelle connaît son propre joueur');
assert(Ruche.getControl().bottomId === 'x1', 'poser sur la ruche actuelle ne retire pas le contrôle');
assert(Ruche.searchControlPlayers('wil').some((p) => p.id === 'w1'), 'la ruche actuelle ne bloque pas la recherche du contrôle');
const beforeProposal = Ruche.buildOptimizedProposal(Ruche.getState().grid, Ruche.getState().bottomId);
Ruche.tapControlCell(slot(3, 3));
Ruche.setControlSearchQuery('wil');
Ruche.pickControlPlayer('w1');
Ruche.tapControlCell(slot(3, 3));
Ruche.chooseControlStatus('move');
const afterProposal = Ruche.buildOptimizedProposal(Ruche.getState().grid, Ruche.getState().bottomId);
assert(
  JSON.stringify(beforeProposal.grid) === JSON.stringify(afterProposal.grid) &&
    beforeProposal.bottomId === afterProposal.bottomId,
  'l’optimiseur ignore le contrôle'
);
assert(Ruche.getControl().statusByPlayerId.w1 === 'move', 'le statut reste manuel');
const storedProposal = Ruche.ensureProposal(true);
assert(Ruche.ensureProposal(false) === storedProposal, 'proposition stable avant une action de contrôle');
Ruche.tapControlCell(slot(3, 3));
assert(Ruche.chooseControlStatus('good') === true, 'changement de statut après génération');
assert(Ruche.ensureProposal(false) === storedProposal, 'un statut de contrôle ne régénère pas la proposition');
Ruche.chooseControlStatus('move');

const colorsBefore = JSON.stringify(Ruche.getState().colors);
const archivesBefore = Ruche.getState().archives.length;
Ruche.commitClearCurrentHive();
assert(Ruche.getCell(1, 1) == null, 'vidage de la ruche actuelle');
assert(Ruche.getControl().grid[3][3] === 'w1', 'Willow toujours au contrôle après vidage');
assert(Ruche.getControl().bottomId === 'x1', 'case du bas du contrôle intacte après vidage');
assert(Ruche.getState().archives.length === archivesBefore, 'vidage sans archive nouvelle');

Ruche.commitValidateCurrentHive();
assert(Ruche.getState().archives.length === archivesBefore + 1, 'validation archive la ruche actuelle');
assert(Ruche.getControl().grid[3][3] === 'w1', 'validation sans effet sur le contrôle');

const controlBeforeProposalValidate = JSON.stringify(Ruche.getControl());
assert(Ruche.commitValidateProposal() === true, 'validation de la proposition');
assert(JSON.stringify(Ruche.getControl()) === controlBeforeProposalValidate, 'valider la proposition ne touche pas le contrôle');
assert(JSON.stringify(Ruche.getState().colors) === colorsBefore, 'couleurs inchangées');
assert(Ruche.getControl().bottomId === 'x1', 'la case du bas du contrôle n’est pas celle de la préparation');

console.log('\n=== Réinitialiser ===');
async function finish() {
const hiveCell = Ruche.getCell(0, 0);
const proposalRef = Ruche.ensureProposal(false);
const archiveCount = Ruche.getState().archives.length;
const colorsNow = JSON.stringify(Ruche.getState().colors);
sandbox.AppUI.confirm = async () => false;
assert(await Ruche.requestResetControl() === false, 'confirmation refusée');
assert(Ruche.getControl().grid[3][3] === 'w1', 'refus : contrôle conservé');
sandbox.AppUI.confirm = async () => true;
assert(await Ruche.requestResetControl() === true, 'confirmation acceptée');
assert(emptyControl(Ruche.getControl()), 'contrôle remis à vide');
assert(Ruche.getCell(0, 0) === hiveCell, 'ruche actuelle non réinitialisée');
assert(Ruche.ensureProposal(false) === proposalRef, 'proposition non recalculée');
assert(Ruche.getState().archives.length === archiveCount, 'archives non touchées');
assert(JSON.stringify(Ruche.getState().colors) === colorsNow, 'couleurs non touchées');

console.log('\n=== Identité joueur ===');
const renamed = {
  version: 6,
  grid: planningGrid,
  bottomId: null,
  archives: [],
  proposal: null,
  control: {
    grid: (() => {
      const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
      grid[4][4] = 'MARSHAL';
      grid[0][3] = 'AncienPseudo';
      return grid;
    })(),
    bottomId: 'Mertz',
    statusByPlayerId: { AncienPseudo: 'move', Mertz: 'alt_ok' },
  },
};
store.data = JSON.stringify(renamed);
Ruche.hydrateFromStorage();
assert(
  Ruche.migratePlayerIdentity(players, { explicitPseudo: 'AncienPseudo', explicitPlayerId: 'w1' }) === true,
  'migration d’identité appliquée'
);
assert(Ruche.getControl().grid[0][3] === 'w1', 'pseudo de case migré vers l’id');
assert(Ruche.getControl().bottomId === 'm1', 'pseudo du bas migré vers l’id');
assert(Ruche.getControl().statusByPlayerId.w1 === 'move', 'statut suivi après renommage');
assert(Ruche.getControl().statusByPlayerId.m1 === 'alt_ok', 'statut du bas suivi');
assert(!Ruche.getControl().statusByPlayerId.AncienPseudo, 'ancienne clé de statut retirée');
assert(Ruche.getState().grid[0][0] === 'w1', 'la ruche actuelle n’est pas réécrite par le contrôle');

const plain = { bottomId: 'AncienPseudo', grid: [['FREE']] };
const plainResult = Identity.migrateRucheState(plain, players, {
  explicitPseudo: 'AncienPseudo',
  explicitPlayerId: 'w1',
});
assert(plainResult.changed === true, 'migration historique du bas');
assert(plain.bottomId === 'w1', 'id du bas migré');
assert(plain.control == null, 'un document sans contrôle n’en reçoit pas lors du renommage');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
}

finish();
