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

function makeScore(underDays) {
  const dayKeys = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
  const score = { allianceDonMissed: false, days: {} };
  dayKeys.forEach((d, i) => {
    // points > 0 = jour sous objectif (barème VS)
    score.days[d] = i < underDays ? 5 : 0;
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

const rAbsent = M.detectFollowUpReasons(state.players[4], state);
assert(!rAbsent.vs && !rAbsent.hero, 'absent ignoré');

const caseNorm = M.normalizeFollowUpCase({
  status: 'contacted',
  manual: true,
  notes: [{ text: 'Premier contact', at: '2026-09-10T10:00:00.000Z', authorLabel: 'R4' }, { text: '' }],
});
assert(caseNorm.reasons.manual === true, 'manual → reason manual');
assert(caseNorm.notes.length === 1, 'notes vides filtrées');
assert(caseNorm.notes[0].text === 'Premier contact', 'texte note conservé');

assert(
  M.formatFollowUpReasonsLabel({ vs: true, hero: true, manual: false }) === 'VS · Puissance héros',
  'libellé motifs'
);

assert(html.includes('data-tab="suivi"'), 'onglet Gestion des membres');
assert(html.includes('id="panel-suivi"'), 'panneau suivi');
assert(html.includes('id="followUpVsMinDays"'), 'seuil VS paramètres');
assert(html.includes('id="followUpHeroMax"'), 'seuil héros paramètres');
assert(html.includes('js/suivi.js'), 'script suivi inclus');
assert(appCode.includes("tabName === 'suivi'"), 'app switchTab suivi');
assert(appCode.includes('SuiviModule.init()'), 'app init SuiviModule');
assert(suiviCode.includes('SuiviModule'), 'module Suivi exporté');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
