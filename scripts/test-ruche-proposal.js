/**
 * Tests proposition de ruche — optimisation parcimonieuse
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
assert(html.includes('Gain estimé'), 'Libellé Gain estimé');
assert(html.includes('Déplacements'), 'Libellé Déplacements');
assert(!html.includes('Joueurs déplacés :'), 'Ancien libellé déplacés retiré');
assert(html.includes('id="rucheProposalOptimize"'), 'Bouton générer');
assert(html.includes('id="rucheProposalValidate"'), 'Bouton valider proposition');
assert(html.includes('id="rucheProposalMode"'), 'Sélecteur de mode');
assert(html.includes('Optimisation douce'), 'Mode douce');
assert(html.includes('Nouveau plan complet'), 'Mode complet');
assert(html.includes('Valider cette proposition comme nouvelle ruche'), 'Libellé validation');
assert(html.includes('ne change jamais automatiquement'), 'Mention non-auto actuelle');

console.log('\n=== Module expose ===');
assert(rucheCode.includes('buildOptimizedProposal'), 'buildOptimizedProposal');
assert(rucheCode.includes('computeProposalStats'), 'computeProposalStats');
assert(rucheCode.includes('isWellPlaced'), 'isWellPlaced');
assert(rucheCode.includes('MOVE_PENALTY'), 'Pénalité de déplacement');
assert(rucheCode.includes('TARGET_RATIO'), 'Seuil ~95 %');
assert(rucheCode.includes('estimatedGainPct'), 'Stat gain estimé');
assert(rucheCode.includes('validateProposal'), 'validateProposal');
assert(rucheCode.includes('Aucune archive ne sera créée'), 'Validation sans archivage');
assert(rucheCode.includes('swapProposalSlots'), 'swap / DnD proposition');
assert(rucheCode.includes('proposal: null'), 'Champ proposal en état');
assert(rucheCode.includes("mode === 'full'"), 'Mode full');

const store = { data: null };
const players = [
  { id: 'm1', pseudo: 'Marshal', role: 'R5', status: 'Actif', heroPowerTierId: 'tier_75_80', globalPowerTierId: 'gp_ge_200' },
  { id: 'r5', pseudo: 'Chef', role: 'R5', status: 'Actif', heroPowerTierId: 'tier_70_75', globalPowerTierId: 'gp_150_155' },
  { id: 'r4a', pseudo: 'Off1', role: 'R4', status: 'Actif', heroPowerTierId: 'tier_60_65', globalPowerTierId: 'gp_120_125' },
  { id: 'r4b', pseudo: 'Off2', role: 'R4', status: 'Actif', heroPowerTierId: 'tier_55_60', globalPowerTierId: 'gp_100_105' },
  { id: 'pStrong', pseudo: 'Strong', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_50_55', globalPowerTierId: 'gp_90_95' },
  { id: 'pMid', pseudo: 'Mid', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_35_40', globalPowerTierId: 'gp_60_65' },
  { id: 'pWeak', pseudo: 'Weak', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_25_30', globalPowerTierId: 'gp_lt_45' },
  { id: 'pOk1', pseudo: 'Willow', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_45_50', globalPowerTierId: 'gp_80_85' },
  { id: 'pOk2', pseudo: 'Mertz', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_40_45', globalPowerTierId: 'gp_70_75' },
  { id: 'pOk3', pseudo: 'XalAtath', role: 'Membre', status: 'Actif', heroPowerTierId: 'tier_40_45', globalPowerTierId: 'gp_70_75' },
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

const dist = (pos) => Math.max(Math.abs(pos.row - MR), Math.abs(pos.col - MC));

console.log('\n=== Correction ciblée (peu de déplacements) ===');
const grid = emptyGrid();
grid[MR][MC] = 'm1';
grid[0][0] = 'r5';
grid[0][1] = 'r4a';
grid[9][9] = 'r4b';
// Strong trop loin, Weak trop près — une inversion claire
grid[9][0] = 'pStrong';
grid[MR][MC + 1] = 'pWeak';
grid[MR + 1][MC] = 'pMid';

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
assert(dist(afterStrong) < dist(findPos(grid, FREE, 'pStrong')), 'Strong rapproché du centre');
assert(dist(afterStrong) <= dist(afterWeak), 'Strong plus près (ou égal) que Weak après opti');

const stats = Ruche.computeProposalStats(grid, FREE, proposal.grid, proposal.bottomId);
assert(stats.moved >= 1 && stats.moved <= 4, `Peu de déplacements (got ${stats.moved})`);
assert(stats.kept + stats.moved === stats.total, 'kept + moved = total');
assert(typeof stats.estimatedGainPct === 'number', 'estimatedGainPct numérique');
assert(stats.estimatedGainPct >= 90, `Gain/qualité élevée (got ${stats.estimatedGainPct})`);

console.log('\n=== Déjà cohérent → 0 déplacement ===');
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
assert(stats2.estimatedGainPct === 100, 'Gain 100 % si déjà optimal');

console.log('\n=== Joueurs bien placés non déplacés ===');
const grid3 = emptyGrid();
grid3[MR][MC] = 'm1';
grid3[0][0] = 'r5';
grid3[0][1] = 'r4a';
grid3[9][9] = 'r4b';
// Couronne interne déjà bonne
grid3[MR][MC + 1] = 'pOk1'; // Willow
grid3[MR + 1][MC] = 'pOk2'; // Mertz
grid3[MR][MC - 1] = 'pOk3'; // XalAtath
// Une seule inversion périphérique
grid3[9][0] = 'pStrong';
grid3[8][0] = 'pWeak';
grid3[7][0] = 'pMid';

const prop3 = Ruche.buildOptimizedProposal(grid3, FREE);
assert(prop3.grid[MR][MC + 1] === 'pOk1', 'Willow non déplacé');
assert(prop3.grid[MR + 1][MC] === 'pOk2', 'Mertz non déplacé');
assert(prop3.grid[MR][MC - 1] === 'pOk3', 'XalAtath non déplacé');
const stats3 = Ruche.computeProposalStats(grid3, FREE, prop3.grid, prop3.bottomId);
assert(stats3.moved <= 4, `Opti locale ≤ 4 déplacements (got ${stats3.moved})`);

console.log('\n=== Ruche quasi pleine : pas de reorg massive ===');
const grid4 = emptyGrid();
grid4[MR][MC] = 'm1';
grid4[0][0] = 'r5';
grid4[0][1] = 'r4a';
// Remplit par anneaux (centre → extérieur), puissances décroissantes → quasi optimal
const memberIds = [];
for (let i = 0; i < 40; i += 1) {
  const id = `fill_${i}`;
  memberIds.push(id);
  players.push({
    id,
    pseudo: `P${i}`,
    role: 'Membre',
    status: 'Actif',
    heroPowerTierId: i < 20 ? 'tier_45_50' : 'tier_30_35',
  });
}
const slotsByRing = [];
for (let r = 0; r < GRID; r += 1) {
  for (let c = 0; c < GRID; c += 1) {
    if (r === MR && c === MC) continue;
    if (grid4[r][c] !== FREE) continue;
    const d = Math.max(Math.abs(r - MR), Math.abs(c - MC));
    slotsByRing.push({ r, c, d });
  }
}
slotsByRing.sort((a, b) => a.d - b.d || a.r - b.r || a.c - b.c);
memberIds.forEach((id, index) => {
  const slot = slotsByRing[index];
  if (!slot) return;
  grid4[slot.r][slot.c] = id;
});
// Deux inversions nettes seulement
const far = slotsByRing[slotsByRing.length - 1];
const near = slotsByRing[3];
grid4[far.r][far.c] = 'pStrong';
grid4[near.r][near.c] = 'pWeak';

const prop4 = Ruche.buildOptimizedProposal(grid4, FREE);
const stats4 = Ruche.computeProposalStats(grid4, FREE, prop4.grid, prop4.bottomId);
assert(stats4.moved < 20, `Pas de reorg massive (got ${stats4.moved} moves)`);
assert(stats4.moved < stats4.total * 0.35, 'Moins de 35 % des joueurs déplacés');
assert(stats4.moved <= 10, `Quelques joueurs seulement (got ${stats4.moved})`);

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
