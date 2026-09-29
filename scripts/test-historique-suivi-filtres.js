/**
 * Filtres Historique suivi : motifs + demandes d’aide (ledger help_opened).
 * node scripts/test-historique-suivi-filtres.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');
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
  getCurrentProfile: () => ({ role: 'R5', playerId: 'r5_1' }),
  stampActor: () => ({ actorUserId: 'u1', actorLabel: 'Willow', actorPlayerId: 'r5_1' }),
};
suiviSandbox.AppUI = { toast: () => {}, confirm: async () => true, switchTab: () => {} };
vm.runInNewContext(suiviCode, suiviSandbox);
const Suivi = suiviSandbox.SuiviModule;

console.log('UI Historique suivi — filtres');
assert(html.includes('id="historiqueSuiviFilterReason"'), 'select filtre motif historique');
assert(html.includes('id="historiqueSuiviFilterHelp"'), 'select filtre demande d’aide historique');
assert(html.includes('option value="hero">Puissance héros</option>'), 'option Puissance héros');
assert(html.includes('option value="discret">Joueur discret</option>'), 'option Joueur discret');
assert(html.includes('option value="manual">Aide / manuel</option>'), 'option Aide / manuel');
assert(html.includes('option value="vs">Aide VS</option>'), 'option Aide VS');
assert(html.includes('option value="troops">Aide Troupes</option>'), 'option Aide Troupes');
assert(html.includes('option value="other">Aide Autre</option>'), 'option Aide Autre');
assert(suiviCode.includes('getEverOpenedFollowUpHelpTypes'), 'historique lit help_opened ledger');
assert(suiviCode.includes('formatFollowUpHelpHistoryLabel'), 'affichage demandes d’aide historique');
assert(
  !/panel-historique-suivi[\s\S]*helpNeeds/.test(suiviCode) ||
    suiviCode.includes('getEverOpenedFollowUpHelpTypes'),
  'filtre aide historique via ledger (pas helpNeeds seul)'
);

console.log('Helpers ledger ever-opened');
const blank = M.createBlankState();
blank.players = [];
blank.playerFollowUpNotes = {
  p1: {
    notes: [
      {
        id: 'n1',
        at: '2026-09-01T10:00:00.000Z',
        text: 'Aide VS — ouverte',
        eventType: 'help_opened',
        helpType: 'vs',
      },
      {
        id: 'n2',
        at: '2026-09-02T10:00:00.000Z',
        text: 'Aide VS — résolue',
        eventType: 'help_resolved',
        helpType: 'vs',
      },
      {
        id: 'n3',
        at: '2026-09-03T10:00:00.000Z',
        text: 'Aide Troupes — ouverte',
        eventType: 'help_opened',
        helpType: 'troops',
      },
      {
        id: 'n4',
        at: '2026-09-04T10:00:00.000Z',
        text: 'commentaire',
        eventType: 'comment',
      },
    ],
  },
};
assert(
  M.getEverOpenedFollowUpHelpTypes(blank, 'p1').join(',') === 'troops,vs' ||
    M.getEverOpenedFollowUpHelpTypes(blank, 'p1').sort().join(',') === 'troops,vs',
  'demande ouverte + résolue toujours trouvées'
);
assert(M.hasOpenFollowUpHelpNeeds(blank, 'p1') === true, 'troops encore active (sanity helpNeeds)');
assert(
  M.getEverOpenedFollowUpHelpTypes(blank, 'p1').includes('vs'),
  'demande résolue toujours trouvée (vs)'
);
assert(
  M.formatFollowUpHelpHistoryLabel(['vs']) === 'Demande d’aide : VS',
  'label une demande'
);
assert(
  M.formatFollowUpHelpHistoryLabel(['vs', 'troops']) === 'Demandes d’aide : VS · Troupes',
  'label plusieurs demandes'
);
assert(M.formatFollowUpHelpHistoryLabel([]) === '', 'label vide sans aide');

function makeDoneCase(reasons, extra = {}) {
  return M.createEmptyFollowUpCase({
    status: 'done',
    closedAt: '2026-09-10T12:00:00.000Z',
    closeReason: 'coaching_done',
    reasons,
    ...extra,
  });
}

const r5 = M.createPlayer({ pseudo: 'Willow', status: 'Actif', role: 'R5' });
r5.id = 'r5_1';
const heroP = M.createPlayer({ pseudo: 'HeroAlpha', status: 'Actif' });
heroP.id = 'p_hero';
const discretP = M.createPlayer({ pseudo: 'DiscretBeta', status: 'Actif', discret: true });
discretP.id = 'p_discret';
const manualP = M.createPlayer({ pseudo: 'ManualGamma', status: 'Actif' });
manualP.id = 'p_manual';
const helpOpenP = M.createPlayer({ pseudo: 'HelpOpenDelta', status: 'Actif' });
helpOpenP.id = 'p_help_open';
const helpResolvedP = M.createPlayer({ pseudo: 'HelpResolvedEpsilon', status: 'Actif' });
helpResolvedP.id = 'p_help_res';
const multiHelpP = M.createPlayer({ pseudo: 'MultiHelpZeta', status: 'Actif' });
multiHelpP.id = 'p_multi';
const oldNoHelpP = M.createPlayer({ pseudo: 'OldNoHelpEta', status: 'Actif' });
oldNoHelpP.id = 'p_old';
const legacyContactP = M.createPlayer({ pseudo: 'LegacyContactTheta', status: 'Actif', discret: true });
legacyContactP.id = 'p_legacy';
legacyContactP.discretContacts = M.normalizeDiscretContacts([
  { at: '2026-08-01T09:00:00.000Z', text: 'Ancien contact', authorLabel: 'Willow' },
]);

const state = M.createBlankState();
state.players = [
  r5,
  heroP,
  discretP,
  manualP,
  helpOpenP,
  helpResolvedP,
  multiHelpP,
  oldNoHelpP,
  legacyContactP,
];
state.playerFollowUps = {
  p_hero: makeDoneCase({ hero: true }),
  p_discret: makeDoneCase({ discret: true }),
  p_manual: makeDoneCase({ manual: true }, { manual: true }),
  p_help_open: makeDoneCase({ discret: true }),
  p_help_res: makeDoneCase({ hero: true }),
  p_multi: makeDoneCase({ manual: true }, { manual: true }),
  p_old: makeDoneCase({ hero: true }),
};
state.playerFollowUpNotes = {
  p_help_open: {
    notes: [
      {
        id: 'ho1',
        at: '2026-09-05T10:00:00.000Z',
        text: 'Aide VS — ouverte',
        eventType: 'help_opened',
        helpType: 'vs',
      },
    ],
  },
  p_help_res: {
    notes: [
      {
        id: 'hr1',
        at: '2026-09-05T10:00:00.000Z',
        text: 'Aide Troupes — ouverte',
        eventType: 'help_opened',
        helpType: 'troops',
      },
      {
        id: 'hr2',
        at: '2026-09-06T10:00:00.000Z',
        text: 'Aide Troupes — résolue',
        eventType: 'help_resolved',
        helpType: 'troops',
      },
    ],
  },
  p_multi: {
    notes: [
      {
        id: 'm1',
        at: '2026-09-05T10:00:00.000Z',
        text: 'Aide VS — ouverte',
        eventType: 'help_opened',
        helpType: 'vs',
      },
      {
        id: 'm2',
        at: '2026-09-05T11:00:00.000Z',
        text: 'Aide Autre — ouverte',
        eventType: 'help_opened',
        helpType: 'other',
      },
      {
        id: 'm3',
        at: '2026-09-06T10:00:00.000Z',
        text: 'Aide VS — résolue',
        eventType: 'help_resolved',
        helpType: 'vs',
      },
    ],
  },
};

function ids(rows) {
  return rows.map((r) => r.player.id).sort();
}

function rows(filters) {
  return Suivi.getHistoriqueRows(state, filters);
}

console.log('Filtres motif');
assert(
  ids(rows({ reasonFilter: 'hero' })).includes('p_hero') &&
    !ids(rows({ reasonFilter: 'hero' })).includes('p_discret') &&
    !ids(rows({ reasonFilter: 'hero' })).includes('p_manual'),
  'filtre Puissance héros'
);
assert(
  ids(rows({ reasonFilter: 'discret' })).includes('p_discret') &&
    ids(rows({ reasonFilter: 'discret' })).includes('p_legacy') &&
    !ids(rows({ reasonFilter: 'discret' })).includes('p_hero'),
  'filtre Joueur discret'
);
assert(
  ids(rows({ reasonFilter: 'manual' })).includes('p_manual') &&
    !ids(rows({ reasonFilter: 'manual' })).includes('p_hero') &&
    !ids(rows({ reasonFilter: 'manual' })).includes('p_legacy'),
  'filtre Aide / manuel'
);

console.log('Filtres demande d’aide (ledger)');
assert(
  ids(rows({ helpFilter: 'vs' })).includes('p_help_open') &&
    ids(rows({ helpFilter: 'vs' })).includes('p_multi') &&
    !ids(rows({ helpFilter: 'vs' })).includes('p_help_res'),
  'filtre Aide VS'
);
assert(
  ids(rows({ helpFilter: 'troops' })).includes('p_help_res') &&
    !ids(rows({ helpFilter: 'troops' })).includes('p_help_open'),
  'filtre Aide Troupes'
);
assert(
  ids(rows({ helpFilter: 'other' })).includes('p_multi') &&
    !ids(rows({ helpFilter: 'other' })).includes('p_help_open'),
  'filtre Aide Autre'
);
assert(
  ids(rows({ helpFilter: 'vs' })).includes('p_help_open'),
  'demande ouverte trouvée'
);
assert(
  ids(rows({ helpFilter: 'troops' })).includes('p_help_res') &&
    M.hasOpenFollowUpHelpNeeds(state, 'p_help_res') === false,
  'demande résolue toujours trouvée (helpNeeds inactif)'
);
assert(
  M.getEverOpenedFollowUpHelpTypes(state, 'p_multi').sort().join(',') === 'other,vs',
  'plusieurs demandes sur un même suivi'
);
assert(
  M.formatFollowUpHelpHistoryLabel(M.getEverOpenedFollowUpHelpTypes(state, 'p_multi')) ===
    'Demandes d’aide : VS · Autre',
  'affichage plusieurs demandes VS · Autre'
);

console.log('Combinaisons');
assert(
  ids(rows({ reasonFilter: 'discret', helpFilter: 'vs' })).join(',') === 'p_help_open',
  'combinaison Motif + Demande d’aide'
);
assert(
  ids(rows({ q: 'hero', reasonFilter: 'hero' })).includes('p_hero') &&
    !ids(rows({ q: 'zzz', reasonFilter: 'hero' })).includes('p_hero'),
  'combinaison avec recherche pseudo'
);
assert(
  ids(rows({ helpFilter: '' })).includes('p_old') &&
    M.getEverOpenedFollowUpHelpTypes(state, 'p_old').length === 0,
  'ancien suivi sans événement aide visible avec Toutes les demandes d’aide'
);
assert(
  !ids(rows({ helpFilter: 'vs' })).includes('p_old'),
  'ancien sans aide exclu si filtre Aide VS'
);

console.log('Régression discretContacts');
const allNeutral = rows({ q: '', reasonFilter: '', helpFilter: '' });
assert(
  allNeutral.some((r) => r.kind === 'discret_contact' && r.player.id === 'p_legacy'),
  'aucune régression des anciens discretContacts'
);
assert(
  !rows({ helpFilter: 'vs' }).some((r) => r.kind === 'discret_contact'),
  'contact Discret exclus si filtre demande d’aide actif'
);
assert(
  rows({ reasonFilter: 'discret' }).some(
    (r) => r.kind === 'discret_contact' && r.player.id === 'p_legacy'
  ),
  'contact Discret visible avec filtre motif Joueur discret'
);

console.log(`\n${passed} OK, ${failed} KO`);
if (failed) process.exit(1);
