const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const vs = fs.readFileSync('js/vs.js', 'utf8');
const tempete = fs.readFileSync('js/tempete.js', 'utf8');
const profiles = fs.readFileSync('js/profiles.js', 'utf8');

const ids = [
  'btnCloseWeek',
  'btnNewWeek',
  'vsMainView',
  'vsLegend',
  'vsSettingsForm',
  'vsAfondDailyGoal',
  'settingsPaneVs',
  'settingsVsBlock',
  'panel-settings',
  'tempeteOpenSelection',
  'tempeteSelectionModal',
  'tempeteSelectionBody',
  'tempeteSelectionEmpty',
  'tempetePresenceModal',
  'tempetePresenceTitle',
  'tempetePresenceBody',
];

let ko = 0;
ids.forEach((id) => {
  const ok = html.includes(`id="${id}"`);
  console.log(ok ? '  OK' : '  KO', `html#${id}`);
  if (!ok) ko += 1;
});

const settingsPanel = html.slice(html.indexOf('id="panel-settings"'), html.indexOf('id="playerModal"'));
[
  ['data-settings-tab="vs"', 'sous-onglet Paramètres → VS'],
  ['id="settingsPaneVs"', 'panneau Paramètres VS'],
  ['id="vsSettingsForm"', 'formulaire VS dans Paramètres'],
].forEach(([needle, label]) => {
  const ok = settingsPanel.includes(needle);
  console.log(ok ? '  OK' : '  KO', label);
  if (!ok) ko += 1;
});

const vsPanel = html.slice(html.indexOf('id="panel-vs"'), html.indexOf('id="panel-train"'));
[
  ['btnVsSettings', 'bouton Paramètres VS retiré de l’onglet VS'],
  ['vsSettingsView', 'vue paramètres retirée de l’onglet VS'],
  ['btnVsBackFromSettings', 'retour paramètres retiré de l’onglet VS'],
].forEach(([needle, label]) => {
  const gone = !vsPanel.includes(needle);
  console.log(gone ? '  OK' : '  KO', label);
  if (!gone) ko += 1;
});

['getDayOptions', 'recalculateWeekWithBareme', 'vsSettings', 'closeActiveWeek', 'canEditVsSettings', 'isActiveR5'].forEach((k) => {
  const ok = vs.includes(k);
  console.log(ok ? '  OK' : '  KO', `vs.js ${k}`);
  if (!ok) ko += 1;
});

assert = (cond, msg) => {
  console.log(cond ? '  OK' : '  KO', msg);
  if (!cond) ko += 1;
};
assert(profiles.includes("tabName !== 'vs'"), 'profiles switchSettingsTab gère VS');
assert(profiles.includes('VSModule.renderSettings'), 'ouverture onglet VS remplit le formulaire');
assert(vs.includes('ROSProfiles.isActiveR5'), 'contrôle R5 réutilisé');

[
  'vsModeBar',
  'vsToggleMode',
  'toggleMode',
  'Revenir en VS ÉCO',
  'Passer en VS À FOND',
  'vsDonationsVerified',
  'Vérification des dons',
].forEach((k) => {
  const gone = !html.includes(k) && !vs.includes(k);
  console.log(gone ? '  OK' : '  KO', `retiré: ${k}`);
  if (!gone) ko += 1;
});

['getPlayerPresenceHistory', 'tempeteOpenSelection', 'presenceFilter', 'openPresenceDetail'].forEach((k) => {
  const ok = tempete.includes(k);
  console.log(ok ? '  OK' : '  KO', `tempete.js ${k}`);
  if (!ok) ko += 1;
});

console.log(`checks done, ${ko} KO`);
process.exit(ko ? 1 : 0);
