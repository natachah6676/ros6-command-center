/**
 * Édition / suppression commentaires ledger + sync tombstone.
 * node scripts/test-followup-notes-mutate.js
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

function baseState() {
  return {
    players: [
      { id: 'ortease', pseudo: 'Ortese', role: 'Membre', status: 'Actif' },
      { id: 'r4_a', pseudo: 'Willow', role: 'R4', status: 'Actif' },
      { id: 'r4_b', pseudo: 'AutreR4', role: 'R4', status: 'Actif' },
      { id: 'r5', pseudo: 'Chef', role: 'R5', status: 'Actif' },
    ],
    playerFollowUps: {
      ortease: {
        status: 'in_progress',
        assigneePlayerId: 'r4_a',
        assigneeLabel: 'Willow',
        manual: true,
        reasons: { manual: true },
        notes: [],
      },
    },
    playerFollowUpNotes: {
      ortease: {
        notes: [
          {
            id: 'funote_1',
            at: '2026-09-17T11:55:00.000Z',
            text: 'Premier échange',
            authorLabel: 'Willow',
            authorUserId: 'u_willow',
          },
        ],
      },
    },
  };
}

console.log('\n=== Droits ===');
{
  const s = baseState();
  assert(
    M.canMutatePlayerFollowUpNotes(s, 'ortease', { isR5: true, viewerPlayerId: 'r5' }),
    'R5 peut muter'
  );
  assert(
    M.canMutatePlayerFollowUpNotes(s, 'ortease', {
      isR5: false,
      isR4OrR5: true,
      viewerPlayerId: 'r4_a',
    }),
    'R4 assigné peut muter'
  );
  assert(
    !M.canMutatePlayerFollowUpNotes(s, 'ortease', {
      isR5: false,
      isR4OrR5: true,
      viewerPlayerId: 'r4_b',
    }),
    'autre R4 ne peut pas muter'
  );
}

console.log('\n=== Modification R5 ===');
{
  const s = baseState();
  const updated = M.updatePlayerFollowUpNote(s, 'ortease', 'funote_1', {
    text: 'Premier échange (corrigé)',
    actor: { actorUserId: 'u_r5', actorLabel: 'Chef' },
  });
  assert(updated && updated.id === 'funote_1', 'id conservé');
  assert(updated.at === '2026-09-17T11:55:00.000Z', 'at création conservé');
  assert(updated.authorLabel === 'Willow', 'auteur d’origine conservé');
  assert(updated.authorUserId === 'u_willow', 'authorUserId conservé');
  assert(updated.text === 'Premier échange (corrigé)', 'texte modifié');
  assert(Boolean(updated.updatedAt), 'updatedAt posé');
  assert(updated.updatedByLabel === 'Chef', 'updatedByLabel');
  assert(M.getPlayerFollowUpNotes(s, 'ortease')[0].text.includes('corrigé'), 'ledger à jour');
}

console.log('\n=== Suppression R5 + pas de réapparition sync ===');
{
  const s = baseState();
  const tomb = M.softDeletePlayerFollowUpNote(s, 'ortease', 'funote_1', {
    actor: { actorUserId: 'u_r5', actorLabel: 'Chef' },
  });
  assert(tomb && tomb.deletedAt, 'tombstone créé');
  assert(M.getPlayerFollowUpNotes(s, 'ortease').length === 0, 'UI : note absente');
  assert(
    M.getPlayerFollowUpNotes(s, 'ortease', { includeDeleted: true }).length === 1,
    'tombstone conservé en ledger'
  );

  const remoteAlive = {
    players: s.players,
    playerFollowUpNotes: {
      ortease: {
        notes: [
          {
            id: 'funote_1',
            at: '2026-09-17T11:55:00.000Z',
            text: 'Premier échange',
            authorLabel: 'Willow',
          },
        ],
      },
    },
    playerFollowUps: s.playerFollowUps,
  };
  const localTomb = {
    players: s.players,
    playerFollowUpNotes: s.playerFollowUpNotes,
    playerFollowUps: s.playerFollowUps,
  };
  const merged = T.mergeCommandCenterStore(remoteAlive, localTomb);
  const after = merged.playerFollowUpNotes.ortease.notes;
  assert(after.length === 1 && after[0].deletedAt, 'fusion : tombstone gagne sur copie vivante');
  assert(
    M.getPlayerFollowUpNotes(merged, 'ortease').length === 0,
    'après fusion : toujours invisible UI'
  );
}

console.log('\n=== Modification / suppression R4 assigné ===');
{
  const s = baseState();
  assert(
    M.canMutatePlayerFollowUpNotes(s, 'ortease', {
      isR5: false,
      viewerPlayerId: 'r4_a',
    }),
    'R4 assigné autorisé'
  );
  const updated = M.updatePlayerFollowUpNote(s, 'ortease', 'funote_1', {
    text: 'MAJ Willow',
    actor: { actorUserId: 'u_w', actorLabel: 'Willow' },
  });
  assert(updated && updated.text === 'MAJ Willow', 'R4 assigné modifie');
  const tomb = M.softDeletePlayerFollowUpNote(s, 'ortease', 'funote_1', {
    actor: { actorUserId: 'u_w', actorLabel: 'Willow' },
  });
  assert(tomb && tomb.deletedAt, 'R4 assigné supprime');
}

console.log('\n=== Refus autre R4 (logique métier) ===');
{
  const s = baseState();
  assert(
    !M.canMutatePlayerFollowUpNotes(s, 'ortease', {
      isR5: false,
      viewerPlayerId: 'r4_b',
    }),
    'refus autre R4'
  );
}

console.log('\n=== Modification synchronisée entre deux états ===');
{
  const remote = {
    players: baseState().players,
    playerFollowUps: baseState().playerFollowUps,
    playerFollowUpNotes: {
      ortease: {
        notes: [
          {
            id: 'funote_1',
            at: '2026-09-17T11:55:00.000Z',
            text: 'Version A',
            authorLabel: 'Willow',
            authorUserId: 'u_willow',
            updatedAt: '2026-09-18T08:00:00.000Z',
            updatedByLabel: 'Willow',
          },
        ],
      },
    },
  };
  const local = {
    players: baseState().players,
    playerFollowUps: baseState().playerFollowUps,
    playerFollowUpNotes: {
      ortease: {
        notes: [
          {
            id: 'funote_1',
            at: '2026-09-17T11:55:00.000Z',
            text: 'Version B plus récente',
            authorLabel: 'Willow',
            authorUserId: 'u_willow',
            updatedAt: '2026-09-18T09:00:00.000Z',
            updatedByLabel: 'Chef',
            updatedByUserId: 'u_r5',
          },
        ],
      },
    },
  };
  const merged = T.mergeCommandCenterStore(remote, local);
  const note = merged.playerFollowUpNotes.ortease.notes[0];
  assert(note.text === 'Version B plus récente', 'texte : updatedAt le plus récent gagne');
  assert(note.updatedByLabel === 'Chef', 'updatedBy de la version gagnante');
  assert(note.at === '2026-09-17T11:55:00.000Z', 'at création inchangé');
}

console.log('\n=== Migration legacy ne ressuscite pas un tombstone ===');
{
  const s = baseState();
  M.softDeletePlayerFollowUpNote(s, 'ortease', 'funote_1', {
    actor: { actorLabel: 'Chef' },
  });
  s.playerFollowUps.ortease.notes = [
    {
      id: 'funote_1',
      at: '2026-09-17T11:55:00.000Z',
      text: 'Premier échange',
      authorLabel: 'Willow',
    },
  ];
  M.migrateFollowUpNotesFromCases(s);
  assert(
    M.getPlayerFollowUpNotes(s, 'ortease').length === 0,
    'migration ne restaure pas une note tombstonée'
  );
  assert(
    M.getPlayerFollowUpNotes(s, 'ortease', { includeDeleted: true })[0].deletedAt,
    'tombstone toujours présent'
  );
}

console.log('\n=== UI ===');
assert(suiviCode.includes('data-suivi-note-edit'), 'bouton modifier');
assert(suiviCode.includes('data-suivi-note-delete'), 'bouton supprimer');
assert(suiviCode.includes('Supprimer définitivement ce commentaire'), 'confirmation suppression');
assert(suiviCode.includes('canMutatePlayerFollowUpNotes'), 'garde droits UI');
assert(suiviCode.includes('suivi-note-edited'), 'libellé modifié');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
