const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const vs = fs.readFileSync('js/vs.js', 'utf8');
const tempete = fs.readFileSync('js/tempete.js', 'utf8');

const ids = [
  'vsModeBar',
  'vsModeLabel',
  'vsToggleMode',
  'btnVsSettings',
  'btnVsBackFromSettings',
  'vsMainView',
  'vsSettingsView',
  'vsLegend',
  'vsDonationsVerified',
  'vsDonationsVerifiedWrap',
  'vsSettingsForm',
  'vsAfondDailyGoal',
  'vsEcoDailyGoal',
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

['getDayOptions', 'recalculateWeekWithBareme', 'donationsVerified', 'vsSettings'].forEach((k) => {
  const ok = vs.includes(k);
  console.log(ok ? '  OK' : '  KO', `vs.js ${k}`);
  if (!ok) ko += 1;
});

['getPlayerPresenceHistory', 'tempeteOpenSelection', 'presenceFilter', 'openPresenceDetail'].forEach((k) => {
  const ok = tempete.includes(k);
  console.log(ok ? '  OK' : '  KO', `tempete.js ${k}`);
  if (!ok) ko += 1;
});

console.log(`${ids.length + 8} checks, ${ko} KO`);
process.exit(ko ? 1 : 0);
