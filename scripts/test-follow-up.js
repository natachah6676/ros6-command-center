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
assert(rVs.vs === true && rVs.hero === false, 'détection VS seule');

const rOk = M.detectFollowUpReasons(state.players[1], state);
assert(rOk.vs === false && rOk.hero === false, 'joueur OK non détecté');

const rHero = M.detectFollowUpReasons(state.players[2], state);
assert(rHero.hero === true, 'détection héros');

const rBoth = M.detectFollowUpReasons(state.players[3], state);
assert(rBoth.vs && rBoth.hero, 'détection VS + héros');

const perfect = M.createPlayer({
  pseudo: 'Perfect',
  status: 'Actif',
  heroPowerTierId: highHeroTier.id,
});
perfect.id = 'p_praise';
state.players.push(perfect);
state.weeks[0].scores.p_praise = makeScore(0, 0);
const rNoHigh = M.detectFollowUpReasons(perfect, state);
assert(rNoHigh.praise === false, '5 j score fait sans gros score → pas féliciter');

state.weeks[0].scores.p_praise = makeScore(0, 1);
const rPraise = M.detectFollowUpReasons(perfect, state);
assert(rPraise.praise === true && rPraise.vs === false, '5 j score fait + 1 gros score → féliciter');

const absentP = state.players.find((p) => p.id === 'p_absent');
const rAbs = M.detectFollowUpReasons(absentP, state);
assert(
  !rAbs.vs && !rAbs.praise && !rAbs.hero && !rAbs.manual,
  'absent hors suivi (aucun motif)'
);

assert(M.normalizeFollowUpSettings({}).vsPraiseMinDaysMet === 5, 'défaut félicitations = 5 j score fait');
assert(M.normalizeFollowUpSettings({}).vsPraiseMinHighDays === 1, 'défaut félicitations = 1 j gros score');
assert(M.createDefaultVsSettings().afond.praiseGoal === 20000000, 'défaut seuil gros score = 20 M');
assert(M.normalizeFollowUpSettings({}).specialists.vs === null, 'spécialiste VS défaut null');
assert(
  !M.FOLLOW_UP_SPECIALIST_KEYS.some((k) => k.id === 'absent'),
  'pas de référent absent'
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
assert(html.includes('id="panel-suivi"'), 'panneau suivi');
assert(html.includes('id="followUpVsMinDays"'), 'seuil VS paramètres');
assert(html.includes('id="btnSuiviCopyList"'), 'bouton copier Discord');
assert(html.includes('id="suiviFilterAssignee"'), 'filtre R4 assigné');
assert(html.includes('id="trainExportHistoryExcel"'), 'export Excel Train');
assert(html.includes('id="followUpVsPraiseMinDaysMet"'), 'seuil félicitations jours faits');
assert(html.includes('id="vsAfondPraiseGoal"'), 'seuil gros score VS paramètres');
assert(html.includes('id="followUpHeroMax"'), 'seuil héros paramètres');
assert(!html.includes('id="followUpSpecialistAbsent"'), 'pas de référent Absents');
assert(!html.includes('option value="absent"'), 'pas de filtre motif Absent');
assert(html.includes('id="followUpSpecialistVs"'), 'référent VS paramètres');
assert(html.includes('id="suiviScopeHint"'), 'hint périmètre R4');
assert(suiviCode.includes('isFollowUpVisibleToViewer'), 'filtre visibilité R4');
assert(suiviCode.includes('pickFollowUpSpecialist'), 'auto référent motif');
assert(html.includes('js/suivi.js'), 'script suivi inclus');
assert(appCode.includes("tabName === 'suivi'"), 'app switchTab suivi');
assert(appCode.includes('SuiviModule.init()'), 'app init SuiviModule');
assert(suiviCode.includes('SuiviModule'), 'module Suivi exporté');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
