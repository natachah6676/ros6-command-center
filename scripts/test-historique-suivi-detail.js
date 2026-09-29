/**
 * Fiche détail consultative Historique suivi.
 * node scripts/test-historique-suivi-detail.js
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

let storedState = M.createBlankState();
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
  getState: () => storedState,
  update: (fn) => {
    storedState = fn(storedState) || storedState;
    return storedState;
  },
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

console.log('UI détail historique');
assert(html.includes('id="historiqueSuiviDetailView"'), 'panneau détail historique');
assert(html.includes('id="btnHistoriqueSuiviDetailClose"'), 'bouton retour historique');
assert(html.includes('id="historiqueSuiviListView"'), 'vue liste historique');
assert(suiviCode.includes('data-historique-open'), 'pseudo cliquable data-historique-open');
assert(suiviCode.includes('data-historique-reactivate'), 'bouton Réactiver inchangé');
assert(suiviCode.includes('renderHistoriqueDetailHtml'), 'renderer détail consultatif');
assert(
  /openHistoriqueDetail[\s\S]*selectedHistoryKey[\s\S]*renderHistory/.test(suiviCode) ||
    suiviCode.includes('function openHistoriqueDetail'),
  'ouverture détail sans write métier'
);
assert(!/openHistoriqueDetail[\s\S]{0,200}ROSStorage\.update/.test(suiviCode), 'openDetail sans ROSStorage.update immédiat');

const r5 = M.createPlayer({ pseudo: 'Willow', status: 'Actif', role: 'R5' });
r5.id = 'r5_1';
const alpha = M.createPlayer({ pseudo: 'Alpha', status: 'Actif' });
alpha.id = 'p_alpha';
const beta = M.createPlayer({ pseudo: 'Beta', status: 'Actif', discret: true });
beta.id = 'p_beta';
beta.discretContacts = M.normalizeDiscretContacts([
  {
    id: 'dc1',
    at: '2026-08-01T09:00:00.000Z',
    text: 'Contact pris',
    authorLabel: 'Willow',
  },
  {
    id: 'dc2',
    at: '2026-08-15T09:00:00.000Z',
    text: 'Second contact',
    authorLabel: 'Mamat',
  },
]);

const longComment =
  'Commentaire très long '.repeat(20) + 'FIN_COMMENTAIRE_LONG';

storedState = M.createBlankState();
storedState.players = [r5, alpha, beta];
storedState.playerFollowUps = {
  p_alpha: M.createEmptyFollowUpCase({
    status: 'done',
    closedAt: '2026-09-20T12:00:00.000Z',
    createdAt: '2026-09-01T08:00:00.000Z',
    contactedAt: '2026-09-02T10:00:00.000Z',
    closeReason: 'coaching_done',
    assigneePlayerId: 'r5_1',
    assigneeLabel: 'Willow',
    reasons: { hero: true },
  }),
  p_beta: M.createEmptyFollowUpCase({
    status: 'done',
    closedAt: '2026-09-18T12:00:00.000Z',
    createdAt: '2026-09-05T08:00:00.000Z',
    closeReason: 'not_interested',
    assigneeLabel: 'Mamat',
    reasons: { discret: true },
  }),
};
storedState.playerFollowUpNotes = {
  p_alpha: {
    notes: [
      {
        id: 'c1',
        at: '2026-09-03T11:00:00.000Z',
        text: 'Premier échange',
        authorLabel: 'Willow',
        eventType: 'comment',
      },
      {
        id: 'h1',
        at: '2026-09-04T11:00:00.000Z',
        text: 'Demande d’aide VS — ouverte',
        authorLabel: 'Willow',
        eventType: 'help_opened',
        helpType: 'vs',
      },
      {
        id: 'c2',
        at: '2026-09-05T11:00:00.000Z',
        text: longComment,
        authorLabel: 'Mamat',
        eventType: 'comment',
      },
      {
        id: 'h2',
        at: '2026-09-06T11:00:00.000Z',
        text: 'Demande d’aide VS — résolue',
        authorLabel: 'Mamat',
        eventType: 'help_resolved',
        helpType: 'vs',
      },
    ],
  },
};

const rows = Suivi.getHistoriqueRows(storedState, {
  q: '',
  reasonFilter: '',
  helpFilter: '',
});
const alphaFollow = rows.find((r) => r.kind === 'follow' && r.player.id === 'p_alpha');
const betaFollow = rows.find((r) => r.kind === 'follow' && r.player.id === 'p_beta');
const betaContact1 = rows.find(
  (r) => r.kind === 'discret_contact' && r.contact?.id === 'dc1'
);
const betaContact2 = rows.find(
  (r) => r.kind === 'discret_contact' && r.contact?.id === 'dc2'
);

console.log('Clés de ligne / multi-entrées même joueur');
assert(Boolean(alphaFollow), 'suivi terminé Alpha présent');
assert(Boolean(betaFollow), 'suivi terminé Beta présent');
assert(Boolean(betaContact1) && Boolean(betaContact2), 'deux contacts Discret Beta');
const keyAlpha = Suivi.historyRowKey(alphaFollow);
const keyBetaFollow = Suivi.historyRowKey(betaFollow);
const keyDc1 = Suivi.historyRowKey(betaContact1);
const keyDc2 = Suivi.historyRowKey(betaContact2);
assert(keyAlpha.startsWith('follow:p_alpha:'), 'pseudo suivi terminé cliquable (clé follow)');
assert(keyAlpha !== keyBetaFollow, 'clés distinctes joueurs différents');
assert(keyDc1 !== keyDc2, 'plusieurs contacts Discret → clés distinctes');
assert(keyBetaFollow !== keyDc1, 'follow vs discret_contact → clés distinctes même joueur');

assert(
  Suivi.findHistoriqueRowByKey(storedState, keyAlpha)?.player.id === 'p_alpha' &&
    Suivi.findHistoriqueRowByKey(storedState, keyAlpha)?.kind === 'follow',
  'ouverture du bon dossier (Alpha follow)'
);
assert(
  Suivi.findHistoriqueRowByKey(storedState, keyDc2)?.contact?.id === 'dc2',
  'plusieurs suivis/lignes même joueur → bonne ligne ouverte (contact dc2)'
);

console.log('Contenu fiche détail');
const htmlAlpha = Suivi.renderHistoriqueDetailHtml(alphaFollow, storedState);
assert(htmlAlpha.includes('Alpha'), 'pseudo dans détail');
assert(htmlAlpha.includes('Puissance héros'), 'motif dans détail');
assert(htmlAlpha.includes('Willow'), 'R4 / auteur présent');
assert(htmlAlpha.includes('Suivi terminé') || htmlAlpha.includes('terminé'), 'statut final');
assert(htmlAlpha.includes('Coaching terminé') || htmlAlpha.includes('coaching'), 'raison de fin');
assert(htmlAlpha.includes('FIN_COMMENTAIRE_LONG'), 'commentaire long affiché intégralement');
assert(htmlAlpha.includes('Premier échange'), 'plusieurs commentaires affichés');
assert(htmlAlpha.includes('help-open') || htmlAlpha.includes('Ouverture aide'), 'help_opened visible');
assert(
  htmlAlpha.includes('help-resolved') || htmlAlpha.includes('Résolution aide'),
  'help_resolved visible'
);
assert(htmlAlpha.indexOf('Premier échange') < htmlAlpha.indexOf('FIN_COMMENTAIRE_LONG'), 'ordre chronoo commentaires');
assert(htmlAlpha.includes('VS'), 'demande aide VS dans résumé');

const before = JSON.stringify(storedState);
Suivi.openHistoriqueDetail(keyAlpha);
assert(Suivi.getSelectedHistoryKey() === keyAlpha, 'sélection clé sans write');
assert(JSON.stringify(storedState) === before, 'consultation sans modification d’état');
Suivi.closeHistoriqueDetail();
assert(Suivi.getSelectedHistoryKey() == null, 'fermeture détail');
assert(JSON.stringify(storedState) === before, 'fermeture sans modification d’état');

const htmlDc = Suivi.renderHistoriqueDetailHtml(betaContact1, storedState);
assert(htmlDc.includes('Discret · Contact'), 'détail minimal Discret · Contact');
assert(htmlDc.includes('Contact pris'), 'texte contact réel');
assert(htmlDc.includes('Willow'), 'auteur contact');
assert(!htmlDc.includes('Journal (commentaires'), 'pas de ledger inventé pour contact legacy');

console.log('Compat anciennes fiches / filtres');
const oldP = M.createPlayer({ pseudo: 'OldGamma', status: 'Actif' });
oldP.id = 'p_old';
storedState.players.push(oldP);
storedState.playerFollowUps.p_old = M.createEmptyFollowUpCase({
  status: 'done',
  closedAt: '2026-07-01T12:00:00.000Z',
  createdAt: '2026-06-01T08:00:00.000Z',
  reasons: { manual: true },
  manual: true,
  closeReason: 'no_answer',
});
const oldRow = Suivi.getHistoriqueRows(storedState, {}).find((r) => r.player.id === 'p_old');
const htmlOld = Suivi.renderHistoriqueDetailHtml(oldRow, storedState);
assert(htmlOld.includes('OldGamma'), 'compat anciennes fiches');
assert(htmlOld.includes('Aucune demande d’aide') || htmlOld.includes('Aucun commentaire'), 'ancienne fiche sans ledger ok');

assert(
  Suivi.getHistoriqueRows(storedState, { reasonFilter: 'hero' }).some(
    (r) => r.player.id === 'p_alpha'
  ),
  'filtres Historique toujours fonctionnels (hero)'
);
assert(
  Suivi.getHistoriqueRows(storedState, { helpFilter: 'vs' }).some((r) => r.player.id === 'p_alpha') &&
    !Suivi.getHistoriqueRows(storedState, { helpFilter: 'vs' }).some(
      (r) => r.player.id === 'p_old'
    ),
  'filtres Historique aide toujours fonctionnels'
);
assert(
  Suivi.getHistoriqueRows(storedState, { q: 'alp', reasonFilter: 'hero' }).some(
    (r) => r.player.id === 'p_alpha'
  ),
  'combinaison filtre + recherche toujours ok'
);

assert(
  /data-historique-reactivate=/.test(suiviCode) &&
    /data-historique-open=/.test(suiviCode) &&
    !/data-historique-open[\s\S]{0,80}reactivate/.test(
      suiviCode.slice(suiviCode.indexOf('function renderHistory'))
    ),
  'Réactiver reste une action distincte du clic pseudo'
);

console.log(`\n${passed} OK, ${failed} KO`);
if (failed) process.exit(1);
