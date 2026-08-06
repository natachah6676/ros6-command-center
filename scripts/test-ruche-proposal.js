/**
 * Tests proposition de ruche optimisée
 * node scripts/test-ruche-proposal.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const rucheCode = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');
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

console.log('\n=== UI double ruche ===');
assert(html.includes('Ruche actuelle'), 'Titre ruche actuelle');
assert(html.includes('Proposition optimisée'), 'Titre proposition');
assert(html.includes('id="rucheProposalGrid"'), 'Grille proposition');
assert(html.includes('id="rucheProposalStats"'), 'Stats proposition');
assert(html.includes('id="rucheProposalOptimize"'), 'Bouton relancer');
assert(html.includes('id="rucheProposalValidate"'), 'Bouton valider proposition');
assert(html.includes('ne change jamais automatiquement'), 'Mention non-auto actuelle');

console.log('\n=== Module expose ===');
assert(rucheCode.includes('buildOptimizedProposal'), 'buildOptimizedProposal');
assert(rucheCode.includes('computeProposalStats'), 'computeProposalStats');
assert(rucheCode.includes('validateProposal'), 'validateProposal');
assert(rucheCode.includes('swapProposalSlots'), 'swap / DnD proposition');
assert(rucheCode.includes('proposal: null'), 'Champ proposal en état');

const store = { data: null };
const players = [
  { id: 'm1', pseudo: 'Marshal', role: 'R5', status: 'Actif', heroPowerTierId: 'tier_75_80' },
  { id: 'r5', pseudo: 'Chef', role: 'R5', status: 'Actif', heroPowerTierId: 'tier_70_75' },
  { id: 'r4a', pseudo: 'Off1', role: 'R4', status: 'Actif', heroPowerTierId: 'tier_60_65' },
  { id: 'r4b', pseudo: 'Off2', role: 'R4', status: 'Actif', heroPowerTierId: 'tier_55_60' },
  { id: 'pStrong', pseudo: 'Strong', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_50_55' },
  { id: 'pMid', pseudo: 'Mid', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_35_40' },
  { id: 'pWeak', pseudo: 'Weak', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_25_30' },
];

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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  ROSStorage: {
    getState: () => ({
      players,
      powerTiers: sandbox.window.ROSModels.createDefaultPowerTiers(),
    }),
  },
  AppUI: { toast() {}, confirm: async () => true },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
sandbox.ROSModels = sandbox.window.ROSModels;
vm.runInContext(rucheCode, sandbox);
const Ruche = sandbox.window.RucheModule;

const GRID = Ruche.GRID_SIZE;
const MR = Ruche.MARSHAL_ROW;
const MC = Ruche.MARSHAL_COL;
const FREE = Ruche.FREE;

function emptyGrid() {
  return Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => FREE));
}

function findPos(grid, bottomId, playerId) {
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      if (grid[r][c] === playerId) return { type: 'grid', row: r, col: c };
    }
  }
  if (bottomId === playerId) return { type: 'bottom' };
  return null;
}

console.log('\n=== Optimisation ===');
const grid = emptyGrid();
grid[MR][MC] = 'm1';
grid[0][0] = 'r5';
grid[0][1] = 'r4a';
grid[9][9] = 'r4b';
// Strong placed far, weak near center — should swap toward center
grid[9][0] = 'pStrong';
grid[MR][MC + 1] = 'pWeak';
grid[MR + 1][MC] = 'pMid';

const beforeStrong = findPos(grid, null, 'pStrong');
const beforeWeak = findPos(grid, null, 'pWeak');
const proposal = Ruche.buildOptimizedProposal(grid, FREE);

assert(proposal.grid[MR][MC] === 'm1', 'Maréchal conservé au centre');
assert(proposal.grid[0][0] === 'r5', 'R5 conservé');
assert(proposal.grid[0][1] === 'r4a', 'R4a conservé');
assert(proposal.grid[9][9] === 'r4b', 'R4b conservé');

const afterStrong = findPos(proposal.grid, proposal.bottomId, 'pStrong');
const afterWeak = findPos(proposal.grid, proposal.bottomId, 'pWeak');
const afterMid = findPos(proposal.grid, proposal.bottomId, 'pMid');

assert(afterStrong && afterStrong.type === 'grid', 'Strong placé');
assert(afterWeak && afterWeak.type === 'grid', 'Weak placé');

const dist = (pos) =>
  Math.max(Math.abs(pos.row - MR), Math.abs(pos.col - MC));
assert(dist(afterStrong) <= dist(afterMid), 'Strong plus près (ou égal) que Mid');
assert(dist(afterMid) <= dist(afterWeak), 'Mid plus près (ou égal) que Weak');

const stats = Ruche.computeProposalStats(grid, FREE, proposal.grid, proposal.bottomId);
assert(stats.kept >= 4, 'Officiers + cohérents comptés conservés (≥4)');
assert(stats.moved >= 1, 'Au moins un membre déplacé');
assert(stats.kept + stats.moved === stats.total, 'kept + moved = total');

// Relancer avec déjà optimal : Strong near, Weak far
const grid2 = emptyGrid();
grid2[MR][MC] = 'm1';
grid2[0][0] = 'r5';
grid2[0][1] = 'r4a';
grid2[9][9] = 'r4b';
grid2[MR][MC + 1] = 'pStrong';
grid2[MR + 1][MC] = 'pMid';
grid2[9][0] = 'pWeak';
const prop2 = Ruche.buildOptimizedProposal(grid2, FREE);
const stats2 = Ruche.computeProposalStats(grid2, FREE, prop2.grid, prop2.bottomId);
assert(prop2.grid[0][0] === 'r5' && prop2.grid[0][1] === 'r4a', 'Relance conserve R4/R5');
assert(stats2.moved === 0, 'Déjà cohérent → 0 déplacement');
assert(stats2.kept === stats2.total, 'Tous conservés si cohérent');

assert(beforeStrong.row === 9 && beforeWeak.row === MR, 'Setup initial non optimal (contrôle)');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
