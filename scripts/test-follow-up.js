/**
 * Suivi membres : seuils, détection VS/héros, normalisation des cases.
 * node scripts/test-follow-up.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');
const playersCode = fs.readFileSync(path.join(root, 'js/players.js'), 'utf8');

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

const tiers = M.createDefaultPowerTiers
  ? M.createDefaultPowerTiers()
  : M.getPowerTiers({ powerTiers: undefined });

const lowHeroTier =
  (tiers || []).find((t) => Number(t.max) <= 30) ||
  { id: 'tier_low', label: '≤30', min: 0, max: 30, order: 1 };
const highHeroTier =
  (tiers || []).find((t) => Number(t.max) > 30) ||
  { id: 'tier_high', label: '>30', min: 31, max: 40, order: 2 };

function makeScore(underDays, highDays = 0) {
  const dayKeys = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
  const score = { allianceDonMissed: false, days: {}, dayBrackets: {} };
  dayKeys.forEach((d, i) => {
    // points > 0 = jour sous objectif (barème VS)
    const under = i < underDays;
    score.days[d] = under ? 5 : 0;
    if (under) score.dayBrackets[d] = 'mid';
    else if (i < underDays + highDays) score.dayBrackets[d] = 'high';
    else score.dayBrackets[d] = 'ok';
  });
  return score;
}

const week = {
  id: 'w1',
  label: 'VS test',
  startDate: '2026-09-01',
  archived: false,
  scores: {
    p_vs: makeScore(2),
    p_ok: makeScore(1),
    p_hero: makeScore(0),
    p_both: makeScore(3),
  },
};

const state = {
  currentWeekId: 'w1',
  weeks: [week],
  followUpSettings: { vsMinUnderDays: 2, heroMaxM: 30 },
  playerFollowUps: {},
  powerTiers: tiers && tiers.length ? tiers : [lowHeroTier, highHeroTier],
  players: [
    { id: 'p_vs', pseudo: 'VsOnly', status: 'Actif', absent: false, heroPowerTierId: highHeroTier.id },
    { id: 'p_ok', pseudo: 'Ok', status: 'Actif', absent: false, heroPowerTierId: highHeroTier.id },
    { id: 'p_hero', pseudo: 'HeroLow', status: 'Actif', absent: false, heroPowerTierId: lowHeroTier.id },
    { id: 'p_both', pseudo: 'Both', status: 'Actif', absent: false, heroPowerTierId: lowHeroTier.id },
    { id: 'p_absent', pseudo: 'Absent', status: 'Actif', absent: true, heroPowerTierId: lowHeroTier.id },
  ],
};

console.log('Suivi / follow-up');

assert(M.normalizeFollowUpSettings({}).vsMinUnderDays === 2, 'défaut VS = 2 jours');
assert(M.normalizeFollowUpSettings({}).heroMaxM === 30, 'défaut héros = 30 M');
assert(M.normalizeFollowUpSettings({ vsMinUnderDays: 0 }).vsMinUnderDays === 2, 'vsMin invalide → défaut');
assert(M.getFollowUpStatusLabel('in_progress') === 'En suivi', 'label statut En suivi');

const rVs = M.detectFollowUpReasons(state.players[0], state);
assert(rVs.vs === false && rVs.hero === false, 'VS seul → hors Gestion des membres');

const rOk = M.detectFollowUpReasons(state.players[1], state);
assert(rOk.vs === false && rOk.hero === false, 'joueur OK non détecté');

const rHero = M.detectFollowUpReasons(state.players[2], state);
assert(rHero.hero === true, 'détection héros');

const rBoth = M.detectFollowUpReasons(state.players[3], state);
assert(!rBoth.vs && rBoth.hero, 'VS+héros → seul héros en Gestion des membres');

const perfect = M.createPlayer({
  pseudo: 'Perfect',
  status: 'Actif',
  heroPowerTierId: highHeroTier.id,
});
perfect.id = 'p_praise';
state.players.push(perfect);
state.weeks[0].scores.p_praise = makeScore(0, 1);
const rPraise = M.detectFollowUpReasons(perfect, state);
assert(rPraise.praise === false && rPraise.vs === false, 'félicitations → hors Gestion des membres');
assert(M.isPraiseWeekScore(state.weeks[0].scores.p_praise, state) === true, 'isPraiseWeekScore toujours actif');

const absentP = state.players.find((p) => p.id === 'p_absent');
const rAbs = M.detectFollowUpReasons(absentP, state);
assert(
  !rAbs.vs && !rAbs.praise && !rAbs.hero && !rAbs.manual && !rAbs.discret,
  'absent hors suivi (aucun motif)'
);

const discretP = M.createPlayer({
  pseudo: 'DiscretStrong',
  status: 'Actif',
  discret: true,
  heroPowerTierId: highHeroTier.id,
});
discretP.id = 'p_discret';
state.players.push(discretP);
state.weeks[0].scores.p_discret = makeScore(0);
const rDiscret = M.detectFollowUpReasons(discretP, state);
assert(rDiscret.discret === false && !rDiscret.vs, 'flag discret → hors Gestion des membres');
assert(
  M.formatFollowUpReasonsLabel({ discret: true }).includes('Discret'),
  'libellé Discret (historique)'
);
assert(
  M.FOLLOW_UP_SPECIALIST_KEYS.some((k) => k.id === 'discret'),
  'référent Discret présent (paramètres)'
);
assert(
  M.normalizeFollowUpSettings({}).specialists.discret === null,
  'spécialiste Discret défaut null'
);

assert(M.normalizeFollowUpSettings({}).vsFollowUpMutedWeekId === null, 'mute VS défaut null');
assert(
  M.normalizeFollowUpSettings({ vsFollowUpMutedWeekId: 'w1' }).vsFollowUpMutedWeekId === 'w1',
  'mute VS conserve weekId'
);

assert(
  M.FOLLOW_UP_CLOSE_REASONS.some((r) => r.id === 'not_interested'),
  'raison fin : pas intéressé'
);
assert(
  M.getFollowUpCloseReasonLabel('coaching_done') === 'Coaching terminé',
  'libellé Coaching terminé'
);
assert(M.normalizeFollowUpCloseReason('no_reply') === 'no_reply', 'normalize closeReason');
assert(M.normalizeFollowUpCase({ status: 'done', closeReason: 'no_reply' }).closeReason === 'no_reply', 'closeReason conservé');

assert(M.normalizeFollowUpSettings({}).vsPraiseMinDaysMet === 5, 'défaut félicitations = 5 j score fait');
assert(M.normalizeFollowUpSettings({}).vsPraiseMinHighDays === 1, 'défaut félicitations = 1 j gros score');
assert(M.createDefaultVsSettings().afond.praiseGoal === 20000000, 'défaut seuil gros score = 20 M');
assert(M.normalizeFollowUpSettings({}).specialists.vs === null, 'spécialiste VS défaut null');
assert(
  !M.FOLLOW_UP_SPECIALIST_KEYS.some((k) => k.id === 'absent'),
  'pas de référent absent'
);

let snapState = {
  players: state.players,
  followUpSettings: { vsMinUnderDays: 2 },
  playerVsUnderStats: {},
};
M.recordVsUnderSnapshotsForWeek(snapState, {
  id: 'w_ok',
  label: 'OK',
  startDate: '2026-09-01',
  scores: { p_ok: makeScore(0) },
});
assert(
  !snapState.playerVsUnderStats.p_ok,
  'clôture neutre : pas d’entrée historique'
);
snapState = {
  players: state.players,
  followUpSettings: { vsMinUnderDays: 2, vsFollowUpMutedWeekId: 'w_mute' },
  playerVsUnderStats: {},
};
M.recordVsUnderSnapshotsForWeek(snapState, {
  id: 'w_mute',
  label: 'Mute',
  startDate: '2026-09-01',
  scores: { p_vs: makeScore(3) },
});
assert(
  !snapState.playerVsUnderStats.p_vs,
  'clôture semaine muette : pas d’historique'
);

const specsState = {
  players: [
    { id: 'r4_vs', pseudo: 'R4VS', role: 'R4', status: 'Actif' },
    { id: 'r4_praise', pseudo: 'R4Praise', role: 'R4', status: 'Actif' },
  ],
  followUpSettings: {
    specialists: { vs: 'r4_vs', praise: 'r4_praise' },
  },
};
const pick = M.pickFollowUpSpecialist({ vs: true, praise: true }, specsState);
assert(pick.assigneePlayerId === 'r4_vs', 'priorité spécialiste VS');
assert(
  M.getFollowUpSpecialistKeysForPlayer(M.getFollowUpSettings(specsState), 'r4_praise').includes(
    'praise'
  ),
  'clés spécialiste praise'
);
assert(
  M.isFollowUpVisibleToViewer(
    { follow: { assigneePlayerId: null }, reasons: { praise: true, vs: false } },
    specsState,
    'r4_praise',
    false
  ),
  'R4 praise voit félicitations'
);
assert(
  !M.isFollowUpVisibleToViewer(
    { follow: { assigneePlayerId: null }, reasons: { vs: true, praise: false } },
    specsState,
    'r4_praise',
    false
  ),
  'R4 praise ne voit pas VS seul'
);
assert(
  M.isFollowUpVisibleToViewer(
    { follow: { assigneePlayerId: null }, reasons: { vs: true } },
    specsState,
    'r4_praise',
    true
  ),
  'R5 voit tout'
);
assert(
  M.isFollowUpVisibleToViewer(
    {
      follow: { assigneePlayerId: 'r4_praise' },
      reasons: { manual: true, vs: false, praise: false, hero: false, discret: false },
    },
    specsState,
    'r4_praise',
    false
  ),
  'R4 voit une fiche manuelle qui lui est assignée'
);

const opts = M.getDayOptions(M.createDefaultVsSettings());
assert(opts[0].bracket === 'high' && opts[1].bracket === 'ok', 'options VS : gros score puis Score fait');
assert(opts[1].label.includes('Score fait'), 'libellé Score fait');

const rAbsent = M.detectFollowUpReasons(state.players[4], state);
assert(!rAbsent.vs && !rAbsent.hero && !rAbsent.praise, 'absent → aucun motif suivi');

const caseNorm = M.normalizeFollowUpCase({
  status: 'contacted',
  manual: true,
  notes: [{ text: 'Premier contact', at: '2026-09-10T10:00:00.000Z', authorLabel: 'R4' }, { text: '' }],
});
assert(caseNorm.reasons.manual === true, 'manual → reason manual');
assert(caseNorm.notes.length === 1, 'notes vides filtrées');
assert(caseNorm.notes[0].text === 'Premier contact', 'texte note conservé');
assert(caseNorm.assigneePlayerId === null, 'assignee défaut null');

const withAssignee = M.normalizeFollowUpCase({
  status: 'in_progress',
  assigneePlayerId: 'r4_1',
  assigneeLabel: 'Natacha',
  assignedAt: '2026-09-11T12:00:00.000Z',
});
assert(withAssignee.assigneePlayerId === 'r4_1', 'assignee conservé');
assert(withAssignee.assigneeLabel === 'Natacha', 'label assignee conservé');

assert(
  M.formatFollowUpReasonsLabel({ vs: true, hero: true, manual: false }) ===
    'VS sous seuil · Puissance héros',
  'libellé motifs'
);

assert(html.includes('data-tab="suivi"'), 'onglet Gestion des membres');
assert(html.includes('data-tab="historique-suivi"'), 'onglet Historique suivi');
assert(html.includes('id="panel-historique-suivi"'), 'panneau historique suivi');
assert(html.includes('id="btnClearSuiviHistory"'), 'bouton effacer historique suivi');
assert(suiviCode.includes('clearDoneFollowUpHistory'), 'fonction clearDoneFollowUpHistory');
assert(html.includes('id="historiqueSuiviBody"'), 'table historique suivi');
assert(suiviCode.includes('renderHistory'), 'SuiviModule.renderHistory');
assert(suiviCode.includes('reactivateFollowUp'), 'réactivation historique');
assert(html.includes('id="btnSuiviAdd"'), 'bouton ajouter suivi');
assert(html.includes('id="suiviAddPlayer"'), 'select joueur à ajouter');
assert(html.includes('id="suiviAddAssignee"'), 'select assigné à l’ajout');
assert(suiviCode.includes('fillAddAssigneeSelect'), 'remplissage select assigné');
assert(suiviCode.includes('Choisissez qui s’occupe du suivi'), 'validation assigné requis');
assert(suiviCode.includes('data-suivi-progress'), 'bouton En suivi');
assert(suiviCode.includes('Suivi terminé'), 'bouton Suivi terminé');
assert(!suiviCode.includes('Statut du suivi'), 'pas de sélecteur Statut du suivi');
assert(suiviCode.includes('data-suivi-contact'), 'bouton Contacté');
assert(suiviCode.includes('Contacté'), 'libellé Contacté');
assert(html.includes('id="suiviCloseModal"'), 'modal raison de fin');
assert(html.includes('data-close-reason="not_interested"'), 'choix pas intéressé');
assert(html.includes('data-close-reason="no_reply"'), 'choix ne répond pas');
assert(html.includes('data-close-reason="coaching_done"'), 'choix coaching terminé');
assert(html.includes('<th>Fin</th>'), 'colonne Fin historique');
assert(suiviCode.includes('requestCloseFollowUp'), 'clôture avec raison');
assert(html.includes('id="panel-suivi"'), 'panneau suivi');
assert(html.includes('id="followUpVsMinDays"'), 'seuil VS paramètres (futur onglet VS)');
assert(html.includes('id="suiviFilterAssignee"'), 'filtre R4 assigné');
assert(html.includes('id="filterDiscretAdmin"'), 'filtre Discret liste membres');
assert(html.includes('Pas contacté depuis 30 jours'), 'filtre 30 jours Discret');
assert(playersCode.includes('markDiscretContact'), 'bouton Contact pris');
assert(!html.includes('option value="vs">VS'), 'pas de filtre VS suivi');
assert(!html.includes('option value="praise"'), 'pas de filtre félicitations suivi');
assert(html.includes('id="trainExportHistoryExcel"'), 'export Excel Train');
assert(html.includes('id="followUpVsPraiseMinDaysMet"'), 'seuil félicitations jours faits');
assert(html.includes('id="vsAfondPraiseGoal"'), 'seuil gros score VS paramètres');
assert(html.includes('id="followUpHeroMax"'), 'seuil héros paramètres');
assert(!html.includes('id="followUpSpecialistAbsent"'), 'pas de référent Absents');
assert(!html.includes('option value="absent"'), 'pas de filtre motif Absent');
assert(html.includes('id="followUpSpecialistVs"'), 'référent VS paramètres');
assert(html.includes('id="followUpSpecialistDiscret"'), 'référent Discret paramètres');
assert(html.includes('id="filterDiscretAdmin"'), 'filtre Discret liste');
assert(!html.includes('<option value="discret">Discret</option>'), 'pas de filtre motif Discret dans suivi');
assert(html.includes('id="playerDiscret"'), 'case Discret fiche joueur');
assert(suiviCode.includes('isFollowUpVisibleToViewer'), 'filtre visibilité R4');
assert(suiviCode.includes('pickFollowUpSpecialist'), 'auto référent motif');
assert(
  suiviCode.includes('réactivation manuelle') ||
    suiviCode.includes('Ne rouvre jamais une fiche terminée'),
  'réouverture auto désactivée'
);
assert(html.includes('js/suivi.js'), 'script suivi inclus');
assert(appCode.includes("tabName === 'suivi'"), 'app switchTab suivi');
assert(appCode.includes('SuiviModule.init()'), 'app init SuiviModule');
assert(suiviCode.includes('SuiviModule'), 'module Suivi exporté');

console.log('\nPas de réouverture auto des fiches terminées');
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
  listProfiles: () => [],
};
suiviSandbox.AppUI = {
  toast: () => {},
  confirm: async () => true,
  switchTab: () => {},
};
vm.runInNewContext(suiviCode, suiviSandbox);
const Suivi = suiviSandbox.SuiviModule;
assert(typeof Suivi.syncAutoReasons === 'function', 'syncAutoReasons exposé');

const reopenState = {
  currentWeekId: 'w1',
  weeks: [week],
  followUpSettings: { vsMinUnderDays: 2, heroMaxM: 30 },
  powerTiers: tiers,
  players: [
    {
      id: 'p_hero_done',
      pseudo: 'HeroDone',
      status: 'Actif',
      absent: false,
      heroPowerTierId: lowHeroTier.id,
    },
  ],
  playerFollowUps: {
    p_hero_done: M.createEmptyFollowUpCase({
      playerId: 'p_hero_done',
      status: 'done',
      closedAt: '2026-09-01T10:00:00.000Z',
      closeReason: 'not_interested',
      reasons: { vs: false, hero: true, praise: false, discret: false, manual: false },
    }),
  },
};
reopenState.weeks[0].scores.p_hero_done = makeScore(0);

const reopened = Suivi.syncAutoReasons(reopenState);
assert(reopened === false, 'sync ne rouvre pas une fiche terminée');
assert(
  reopenState.playerFollowUps.p_hero_done.status === 'done',
  'héros encore vrai → reste en historique'
);
assert(
  reopenState.playerFollowUps.p_hero_done.closeReason === 'not_interested',
  'raison de fin conservée'
);

console.log('\nBoutons / motifs Gestion des membres');
assert(!Suivi.isLightOnlyReasons({ praise: true }), 'plus de motif léger');
assert(Suivi.hasDossierReasons({ hero: true }), 'héros = dossier');
assert(Suivi.hasDossierReasons({ manual: true }), 'manuel = dossier');
assert(!Suivi.hasDossierReasons({ vs: true }), 'VS seul ≠ dossier gestion');

console.log('\nContacts Discret (liste membres)');
const overduePlayer = M.createPlayer({ pseudo: 'Due', discret: true });
assert(M.isDiscretContactOverdue(overduePlayer), 'sans contact → à faire');
const contact = M.pushDiscretContact(overduePlayer, {
  at: new Date().toISOString(),
  text: 'Contact pris',
  authorLabel: 'Mamat',
});
assert(contact && contact.text === 'Contact pris', 'pushDiscretContact ajoute une entrée');
assert(!M.isDiscretContactOverdue(overduePlayer), 'contact récent → pas dû');
const oldIso = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
overduePlayer.discretContacts = M.normalizeDiscretContacts([{ at: oldIso, text: 'Ancien' }]);
assert(M.isDiscretContactOverdue(overduePlayer), 'contact > 30 j → à faire');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
