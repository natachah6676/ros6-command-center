/**
 * Ledger permanent playerFollowUpNotes — historique append-only par joueur.
 * node scripts/test-followup-notes-ledger.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');

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
const M = sandbox.window.ROSModels;
const T = sandbox.window.ROSSync.__test;

console.log('\n=== Ledger : pas de plafond 200 ===');
const many = Array.from({ length: 250 }, (_, i) => ({
  id: `funote_${i}`,
  at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
  text: `Note ${i}`,
  authorLabel: 'Willow',
}));
const ledgerNorm = M.normalizePlayerFollowUpNotesLedger({
  p1: { notes: many },
});
assert(ledgerNorm.p1.notes.length === 250, 'ledger conserve 250 notes (pas de slice 200)');

const caseNorm = M.normalizeFollowUpCase({
  status: 'done',
  notes: many,
});
assert(caseNorm.notes.length === 200, 'ancienne fiche garde plafond 200 compat');

console.log('\n=== Migration copie non destructive ===');
const state = M.normalizeState({
  players: [{ id: 'ortease', pseudo: 'Ortese', role: 'Membre', status: 'Actif' }],
  playerFollowUps: {
    ortease: {
      status: 'done',
      notes: [
        {
          id: 'funote_willow',
          at: '2026-09-17T11:55:00.000Z',
          text: 'Premier échange',
          authorLabel: 'Willow',
        },
      ],
    },
  },
});
assert(
  state.playerFollowUpNotes.ortease.notes.some((n) => n.id === 'funote_willow'),
  'note legacy copiée dans le ledger'
);
assert(
  state.playerFollowUps.ortease.notes.some((n) => n.id === 'funote_willow'),
  'note legacy toujours présente sur la fiche (pas de déplacement)'
);

console.log('\n=== Append + union ===');
M.appendPlayerFollowUpNote(state, 'ortease', {
  id: 'funote_2',
  at: '2026-09-18T10:00:00.000Z',
  text: 'Second échange',
  authorLabel: 'Natacha',
});
assert(M.getPlayerFollowUpNotes(state, 'ortease').length === 2, 'append ajoute une note');
const mergedNotes = M.mergeFollowUpNotesArrays(
  [{ id: 'a', at: '2026-01-01T00:00:00.000Z', text: 'A', authorLabel: 'R4' }],
  [{ id: 'b', at: '2026-01-02T00:00:00.000Z', text: 'B', authorLabel: 'R5' }]
);
assert(mergedNotes.length === 2, 'union de deux listes');
assert(
  M.mergeFollowUpNotesArrays(mergedNotes, mergedNotes).length === 2,
  'même id ne duplique pas'
);

console.log('\n=== Sync : fusion ledger par joueur / id ===');
const remoteCc = {
  players: [{ id: 'ortease', pseudo: 'Ortese', role: 'Membre', status: 'Actif' }],
  playerFollowUpNotes: {
    ortease: {
      notes: [
        {
          id: 'funote_willow',
          at: '2026-09-17T11:55:00.000Z',
          text: 'Premier échange',
          authorLabel: 'Willow',
        },
      ],
    },
  },
  playerFollowUps: {},
};
const localCc = {
  players: [{ id: 'ortease', pseudo: 'Ortese', role: 'Membre', status: 'Actif' }],
  playerFollowUpNotes: {
    ortease: {
      notes: [
        {
          id: 'funote_local',
          at: '2026-09-18T08:00:00.000Z',
          text: 'Note locale seule',
          authorLabel: 'Natacha',
        },
      ],
    },
  },
  playerFollowUps: {
    ortease: { status: 'to_contact', manual: true, notes: [] },
  },
};
const mergedCc = T.mergeCommandCenterStore(remoteCc, localCc);
const notesAfter = mergedCc.playerFollowUpNotes.ortease.notes;
assert(
  notesAfter.some((n) => n.id === 'funote_willow') &&
    notesAfter.some((n) => n.id === 'funote_local'),
  'sync conserve notes remote + local'
);
assert(
  !notesAfter.some((n) => n.id === 'funote_willow' && notesAfter.filter((x) => x.id === n.id).length > 1),
  'pas de doublon id'
);

console.log('\n=== UI / nettoyage fiches ===');
assert(suiviCode.includes('getPlayerFollowUpNotes'), 'UI lit le ledger');
assert(suiviCode.includes('appendPlayerFollowUpNote'), 'UI écrit dans le ledger');
assert(suiviCode.includes('migrateFollowUpNotesFromCases'), 'copie avant clear fiches');
assert(
  suiviCode.includes('commentaires joueurs conservés') ||
    suiviCode.includes('commentaires d’échange'),
  'message clear précise conservation commentaires'
);
assert(!suiviCode.includes('slice(0, 200)'), 'suivi ne plafonne pas le ledger');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
