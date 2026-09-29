/**
 * Discret = motif suivi + demandes d’aide (helpNeeds + ledger).
 * node scripts/test-suivi-discret-aide.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');
const playersCode = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

const sandbox = { window: {}, console, Date, Math, JSON, String, Number, Boolean, Array, Object };
sandbox.window = sandbox;
vm.runInNewContext(modelsCode, sandbox);
const M = sandbox.ROSModels;

const suiviSandbox = {
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
    getElementById: () => null,
    querySelector: () => null,
  },
};
suiviSandbox.window = suiviSandbox;
suiviSandbox.ROSModels = M;
suiviSandbox.ROSStorage = {
  getState: () => ({}),
  update: (fn) => fn({}),
};
suiviSandbox.ROSProfiles = {
  isActiveR5: () => true,
  isActiveR4OrR5: () => true,
  listProfiles: () => [],
  getCurrentProfile: () => null,
  stampActor: () => ({ actorUserId: 'u1', actorLabel: 'Mamat', actorPlayerId: 'r4_mamat' }),
};
suiviSandbox.AppUI = { toast: () => {}, confirm: async () => true, switchTab: () => {} };
vm.runInNewContext(suiviCode, suiviSandbox);
const Suivi = suiviSandbox.SuiviModule;

console.log('Discret → fiche suivi');

const mamat = M.createPlayer({ pseudo: 'Mamat', status: 'Actif', role: 'R4' });
mamat.id = 'r4_mamat';
const pipo = M.createPlayer({
  pseudo: 'Pipo1516',
  status: 'Actif',
  discret: true,
  heroPowerTierId: 'tier_high',
});
pipo.id = 'p_pipo';
pipo.heroPowerTierId = (M.createDefaultPowerTiers() || []).find((t) => Number(t.max) > 30)?.id || null;

const state = M.createBlankState();
state.players = [mamat, pipo];
state.followUpSettings = M.normalizeFollowUpSettings({
  specialists: { discret: 'r4_mamat' },
  heroMaxM: 30,
});
state.powerTiers = M.createDefaultPowerTiers();
state.weeks = [
  {
    id: 'w1',
    label: 'VS',
    startDate: '2026-09-01',
    archived: false,
    scores: {},
  },
];
state.currentWeekId = 'w1';

assert(M.detectFollowUpReasons(pipo, state).discret === true, 'detect discret');
assert(
  M.formatFollowUpReasonsLabel({ discret: true }) === 'Joueur discret',
  'label Joueur discret'
);

const changed = Suivi.syncAutoReasons(state);
assert(changed === true, 'sync crée/maintient fiche Discret');
assert(state.playerFollowUps.p_pipo, 'fiche créée');
assert(state.playerFollowUps.p_pipo.reasons.discret === true, 'reasons.discret = true');
assert(state.playerFollowUps.p_pipo.status !== 'done', 'fiche ouverte');
assert(
  state.playerFollowUps.p_pipo.assigneePlayerId === 'r4_mamat',
  'assignation via specialists.discret'
);

state.playerFollowUps.p_pipo.assigneePlayerId = 'r4_other';
state.playerFollowUps.p_pipo.assigneeLabel = 'AutreR4';
Suivi.syncAutoReasons(state);
assert(
  state.playerFollowUps.p_pipo.assigneePlayerId === 'r4_other',
  'assignee existant non remplacé'
);

assert(html.includes('option value="discret">Joueur discret</option>'), 'filtre Joueur discret');
assert(!playersCode.includes('markDiscretContact'), 'Contact pris UI absente');
assert(!playersCode.includes('Dernier contact'), 'meta Dernier contact absente');

const legacyContacts = M.normalizeDiscretContacts([
  { id: 'd1', at: '2026-08-01T10:00:00.000Z', text: 'Contact pris', authorLabel: 'Old' },
]);
pipo.discretContacts = legacyContacts;
assert(pipo.discretContacts.length === 1, 'anciens discretContacts conservés');

console.log('\nDemandes d’aide');

const caseRow = state.playerFollowUps.p_pipo;
assert(M.hasOpenFollowUpHelpNeeds(state, 'p_pipo') === false, 'pas d’aide au départ');

function openHelp(helpType, authorLabel, at) {
  const note = M.appendPlayerFollowUpNote(state, 'p_pipo', {
    eventType: 'help_opened',
    helpType,
    authorLabel,
    authorUserId: 'u1',
    at: at || new Date().toISOString(),
  });
  caseRow.notes = M.mergeFollowUpNotesArrays(caseRow.notes || [], [note]);
  caseRow.helpNeeds = M.getPlayerFollowUpHelpNeeds(state, 'p_pipo');
  return note;
}

function resolveHelp(helpType, authorLabel, at) {
  const note = M.appendPlayerFollowUpNote(state, 'p_pipo', {
    eventType: 'help_resolved',
    helpType,
    authorLabel,
    authorUserId: 'u2',
    at: at || new Date().toISOString(),
  });
  caseRow.notes = M.mergeFollowUpNotesArrays(caseRow.notes || [], [note]);
  caseRow.helpNeeds = M.getPlayerFollowUpHelpNeeds(state, 'p_pipo');
  return note;
}

const openVs = openHelp('vs', 'Mamat', '2026-09-29T10:00:00.000Z');
assert(M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').vs === true, 'ouverture aide VS');
assert(openVs.eventType === 'help_opened' && openVs.helpType === 'vs', 'ledger help_opened VS');
assert(openVs.text.includes('VS') && openVs.text.includes('ouverte'), 'texte ouverture VS');

openHelp('troops', 'Mamat', '2026-09-29T10:01:00.000Z');
assert(M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').troops === true, 'ouverture aide Troupes');
openHelp('other', 'Mamat', '2026-09-29T10:02:00.000Z');
assert(M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').other === true, 'ouverture aide Autre');
assert(
  M.getOpenFollowUpHelpTypes(state, 'p_pipo').sort().join(',') === 'other,troops,vs',
  'cumul de plusieurs demandes'
);

const comment = M.appendPlayerFollowUpNote(state, 'p_pipo', {
  text: 'Le joueur ne comprend pas comment optimiser ses points du lundi.',
  authorLabel: 'Mamat',
  authorUserId: 'u1',
  at: '2026-09-29T10:03:00.000Z',
});
assert(comment.eventType === 'comment', 'commentaire libre = comment');
assert(
  M.getPlayerFollowUpNotes(state, 'p_pipo').some((n) => n.id === comment.id),
  'commentaire dans ledger'
);

const openId = openVs.id;
const resolved = resolveHelp('vs', 'Pipo1516', '2026-09-29T11:00:00.000Z');
assert(M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').vs === false, 'VS résolue (ledger)');
assert(
  M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').troops &&
    M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').other,
  'autres demandes restent actives'
);
assert(
  M.getPlayerFollowUpNotes(state, 'p_pipo').some((n) => n.id === openId && !n.deletedAt),
  'événement d’ouverture conservé'
);
assert(resolved.eventType === 'help_resolved' && resolved.helpType === 'vs', 'ledger résolution VS');

assert(
  Suivi.hasDossierReasons({ discret: true }, caseRow, state, 'p_pipo'),
  'dossier maintenu avec aides restantes'
);

console.log('\nClôture bloquée / autorisée');

function canClose(st, playerId) {
  return !M.hasOpenFollowUpHelpNeeds(st, playerId);
}

assert(!canClose(state, 'p_pipo'), 'clôture impossible avec aide active');
resolveHelp('troops', 'Pipo1516', '2026-09-29T11:01:00.000Z');
resolveHelp('other', 'Pipo1516', '2026-09-29T11:02:00.000Z');
assert(canClose(state, 'p_pipo'), 'clôture possible après résolution totale');
assert(suiviCode.includes('Une demande d’aide est encore active'), 'message clôture bloquée');

caseRow.status = 'done';
caseRow.closedAt = '2026-10-02T12:00:00.000Z';
caseRow.closeReason = 'coaching_done';
const notes = M.getPlayerFollowUpNotes(state, 'p_pipo');
assert(notes.some((n) => n.eventType === 'help_opened'), 'historique ouverture après clôture');
assert(notes.some((n) => n.eventType === 'help_resolved'), 'historique résolution après clôture');
assert(notes.some((n) => n.eventType === 'comment'), 'commentaire conservé après clôture');
assert(
  M.formatFollowUpReasonsLabel({
    discret: true,
    hero: false,
    manual: false,
  }).includes('Joueur discret'),
  'motif Discret visible en historique'
);

console.log('\nRobustesse vieux cache / LWW helpNeeds');

const wipeState = M.createBlankState();
wipeState.players = [pipo];
wipeState.playerFollowUps = {
  p_pipo: M.createEmptyFollowUpCase({
    status: 'in_progress',
    reasons: { discret: true },
    helpNeeds: { vs: false, troops: false, other: false },
  }),
};
wipeState.playerFollowUpNotes = {
  p_pipo: {
    notes: [
      {
        id: 'funote_open_vs',
        at: '2026-09-29T12:00:00.000Z',
        text: 'Demande d’aide VS — ouverte',
        eventType: 'help_opened',
        helpType: 'vs',
        authorLabel: 'AppareilA',
      },
    ],
  },
};
assert(
  wipeState.playerFollowUps.p_pipo.helpNeeds.vs === false,
  'simul : cache fiche sans aide'
);
assert(
  M.hasOpenFollowUpHelpNeeds(wipeState, 'p_pipo') === true,
  'remote/ledger aide ouverte + local helpNeeds false → toujours active'
);
assert(
  M.getPlayerFollowUpHelpNeeds(wipeState, 'p_pipo').vs === true,
  'dérivation ignore helpNeeds:false sans résolution'
);

const noFieldState = {
  playerFollowUps: {
    p_pipo: M.createEmptyFollowUpCase({ status: 'in_progress', reasons: { discret: true } }),
  },
  playerFollowUpNotes: wipeState.playerFollowUpNotes,
};
delete noFieldState.playerFollowUps.p_pipo.helpNeeds;
assert(
  M.hasOpenFollowUpHelpNeeds(noFieldState, 'p_pipo') === true,
  'vieux cache sans champ helpNeeds → ne ferme pas l’aide'
);
M.reconcileFollowUpHelpNeedsFromLedger(noFieldState, 'p_pipo');
assert(
  noFieldState.playerFollowUps.p_pipo.helpNeeds.vs === true,
  'reconcile aligne le cache fiche sur le ledger'
);

assert(
  !canClose(wipeState, 'p_pipo'),
  'clôture impossible après écrasement simulé si ledger encore ouvert'
);

openHelp('vs', 'AppareilA', '2026-09-30T09:00:00.000Z');
assert(M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').vs === true, 'réouverture VS après résolution');
resolveHelp('vs', 'AppareilB', '2026-09-30T10:00:00.000Z');
assert(M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').vs === false, '2ᵉ résolution VS');
openHelp('vs', 'AppareilA', '2026-09-30T11:00:00.000Z');
assert(
  M.getPlayerFollowUpHelpNeeds(state, 'p_pipo').vs === true,
  'open → resolved → open fonctionne'
);

const dual = M.createBlankState();
dual.playerFollowUpNotes = {
  p1: {
    notes: [
      {
        id: 'o_vs',
        at: '2026-09-29T08:00:00.000Z',
        eventType: 'help_opened',
        helpType: 'vs',
        text: 'x',
        authorLabel: 'A',
      },
      {
        id: 'o_tr',
        at: '2026-09-29T08:01:00.000Z',
        eventType: 'help_opened',
        helpType: 'troops',
        text: 'x',
        authorLabel: 'A',
      },
      {
        id: 'r_vs',
        at: '2026-09-29T09:00:00.000Z',
        eventType: 'help_resolved',
        helpType: 'vs',
        text: 'x',
        authorLabel: 'B',
      },
    ],
  },
};
const dualNeeds = M.getPlayerFollowUpHelpNeeds(dual, 'p1');
assert(dualNeeds.vs === false && dualNeeds.troops === true, 'VS+Troupes : résolution d’une seule');

const mergedOpenLedger = M.mergePlayerFollowUpNotesLedgers(
  {
    p_cache: {
      notes: [
        {
          id: 'open_only',
          at: '2026-09-29T07:00:00.000Z',
          eventType: 'help_opened',
          helpType: 'other',
          text: 'Demande d’aide Autre — ouverte',
          authorLabel: 'A',
        },
      ],
    },
  },
  { p_cache: { notes: [] } }
);
const afterMergeState = {
  playerFollowUpNotes: mergedOpenLedger,
  playerFollowUps: {
    p_cache: M.createEmptyFollowUpCase({ helpNeeds: { vs: false, troops: false, other: false } }),
  },
};
assert(
  M.hasOpenFollowUpHelpNeeds(afterMergeState, 'p_cache') === true,
  'ouverture appareil A + vieux cache B (notes vides) → merge ledger conserve l’ouverture'
);

console.log('\nRéactivation Discret + régression héros/manuel');

caseRow.status = 'done';
pipo.discret = true;
const reactState = state;
const row = reactState.playerFollowUps.p_pipo;
row.status = 'to_contact';
row.closedAt = null;
row.closeReason = null;
row.reasons = M.emptyFollowUpReasons({
  hero: Boolean(row.reasons?.hero),
  discret: Boolean(pipo.discret || row.reasons?.discret),
  manual: Boolean(row.manual || row.reasons?.manual),
});
assert(row.reasons.discret === true, 'réactivation conserve Discret');

const heroPlayer = M.createPlayer({
  pseudo: 'HeroLow',
  status: 'Actif',
  heroPowerTierId: (state.powerTiers || []).find((t) => Number(t.max) <= 30)?.id,
});
heroPlayer.id = 'p_hero';
state.players.push(heroPlayer);
Suivi.syncAutoReasons(state);
assert(state.playerFollowUps.p_hero?.reasons?.hero === true, 'régression héros OK');

const manualRow = M.createEmptyFollowUpCase({
  manual: true,
  reasons: { manual: true },
});
assert(Suivi.hasDossierReasons(manualRow.reasons, manualRow), 'régression manuel OK');

console.log('\nMerge ledger');

const remoteLedger = {
  p_pipo: {
    notes: [
      {
        id: 'funote_remote',
        at: '2026-09-29T08:00:00.000Z',
        text: 'Demande d’aide VS — ouverte',
        eventType: 'help_opened',
        helpType: 'vs',
        authorLabel: 'Remote',
      },
    ],
  },
};
const localLedger = {
  p_pipo: {
    notes: M.getPlayerFollowUpNotes(state, 'p_pipo'),
  },
};
const merged = M.mergePlayerFollowUpNotesLedgers(remoteLedger, localLedger);
const mergedNotes = merged.p_pipo.notes;
assert(
  mergedNotes.some((n) => n.id === 'funote_remote' && n.eventType === 'help_opened'),
  'merge conserve help_opened distant'
);
assert(
  mergedNotes.some((n) => n.id === comment.id),
  'merge conserve commentaire local'
);
const legacyNote = M.normalizeFollowUpNote({
  id: 'legacy1',
  at: '2026-01-01T00:00:00.000Z',
  text: 'Ancien commentaire',
  authorLabel: 'Old',
});
assert(legacyNote.eventType === 'comment', 'note legacy sans type → comment');

assert(
  M.normalizeFollowUpCase({}).helpNeeds.vs === false &&
    M.normalizeFollowUpCase({}).helpNeeds.troops === false,
  'helpNeeds défaut false'
);

assert(html.includes('option value="help_troops">'), 'filtre aide Troupes');
assert(html.includes('option value="help_other">'), 'filtre aide Autre');
assert(suiviCode.includes('data-suivi-help-open'), 'boutons ouverture aide');
assert(suiviCode.includes('data-suivi-help-resolve'), 'boutons résolution aide');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
