/**
 * VS : signaux À coacher / À féliciter + archive sous seuil à la clôture.
 * node scripts/test-vs-coaching-signals.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const vsCode = fs.readFileSync(path.join(root, 'js/vs.js'), 'utf8');
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

function makeScore(underDays, highDays = 0) {
  const brackets = ['ok', 'ok', 'ok', 'ok', 'ok'];
  for (let i = 0; i < underDays; i += 1) brackets[i] = 'low';
  for (let i = 0; i < highDays; i += 1) brackets[4 - i] = 'high';
  const days = {};
  const dayBrackets = {};
  M.DAYS.forEach((d, i) => {
    dayBrackets[d.key] = brackets[i];
    days[d.key] = brackets[i] === 'ok' || brackets[i] === 'high' ? 0 : 10;
  });
  return { days, dayBrackets, absent: false };
}

const state = {
  players: [{ id: 'p1', pseudo: 'A', status: 'Actif', absent: false }],
  followUpSettings: M.normalizeFollowUpSettings({
    vsMinUnderDays: 2,
    vsPraiseMinDaysMet: 5,
    vsPraiseMinHighDays: 1,
  }),
  vsSettings: M.createDefaultVsSettings(),
  weeks: [],
  vsUnderWeekHistory: [],
  playerVsUnderStats: {},
};

assert(M.getVsWeekSignal(makeScore(0), state) === null, '0 j sous → pas de signal');
assert(M.getVsWeekSignal(makeScore(1), state) === null, '1 j sous → pas encore coaching');
assert(M.getVsWeekSignal(makeScore(2), state) === 'coach', '≥ 2 j sous → À coacher');
assert(M.getVsWeekSignal(makeScore(0, 1), state) === 'praise', '5 j faits + gros score → À féliciter');
assert(M.getVsWeekSignal(makeScore(2), state) === 'coach', '2 j sous sans félicitations → coaching');
assert(
  M.getVsWeekSignal(makeScore(2, 1), state) === 'coach',
  '2 j sous + 1 gros (pas 5 faits) → coaching, pas félicitations'
);

const week = M.createWeek(new Date('2026-09-08'), { number: 1 });
week.scores.p1 = makeScore(3);
week.vsContacts = {
  p1: { kind: 'coach', at: '2026-09-12T10:00:00.000Z', authorLabel: 'Mamat' },
};
assert(week.vsContacts && week.vsContacts.p1.kind === 'coach', 'vsContacts sur createWeek');

M.pushVsUnderWeekArchive(state, week);
assert(state.vsUnderWeekHistory.length === 1, 'archive créée à la clôture');
assert(state.vsUnderWeekHistory[0].players.length === 1, 'joueur sous seuil archivé');
assert(state.vsUnderWeekHistory[0].players[0].underDays === 3, 'jours sous conservés');
assert(state.vsUnderWeekHistory[0].players[0].contacted === true, 'contact coaching archivé');
assert(state.vsUnderWeekHistory[0].underMinDays === 2, 'seuil paramètre conservé');

const praiseOnly = M.createWeek(new Date('2026-09-15'), { number: 2 });
praiseOnly.scores.p1 = makeScore(0, 1);
M.pushVsUnderWeekArchive(state, praiseOnly);
assert(
  state.vsUnderWeekHistory[0].weekId === praiseOnly.id,
  'nouvelle semaine en tête'
);
assert(
  state.vsUnderWeekHistory[0].players.length === 0,
  'félicitations seules → pas dans archive sous seuil'
);

assert(html.includes('id="vsContactFilter"'), 'filtre coaching / félicitations');
assert(html.includes('id="vsPastUnderWrap"'), 'bloc Semaines passées');
assert(html.includes('<th>Signal</th>'), 'colonne Signal');
assert(html.includes('<th>Contact</th>'), 'colonne Contact');
assert(!html.includes('<th>Rôle</th>'), 'plus de colonne Rôle VS');
assert(!html.includes('Jours sous objectif'), 'plus de colonne jours sous objectif');
assert(vsCode.includes('getVsWeekSignal'), 'signal VS utilisé');
assert(vsCode.includes('markVsContact'), 'contact VS');
assert(vsCode.includes('pushVsUnderWeekArchive'), 'archive à la clôture');
assert(vsCode.includes('À coacher'), 'libellé À coacher');
assert(vsCode.includes('À féliciter'), 'libellé À féliciter');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
