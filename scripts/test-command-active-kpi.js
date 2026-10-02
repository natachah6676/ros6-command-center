/**
 * KPI Poste de commandement : Joueurs actifs = membres status Actif.
 * Les couleurs restent celles des participants de la semaine VS.
 * node scripts/test-command-active-kpi.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const commandCode = fs.readFileSync(path.join(root, 'js/command.js'), 'utf8');
const insightsCode = fs.readFileSync(path.join(root, 'js/insights.js'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const identityCode = fs.readFileSync(path.join(root, 'js/player-identity.js'), 'utf8');

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
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
vm.runInContext(insightsCode, sandbox);
vm.runInContext(identityCode, sandbox);
vm.runInContext(commandCode, sandbox);

const M = sandbox.ROSModels;
const Insights = sandbox.ROSInsights;
const Identity = sandbox.ROSPlayerIdentity;
const Command = sandbox.CommandModule;

const DAY_KEYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];

function scoreUnderDays(n) {
  const score = M.createEmptyScore();
  DAY_KEYS.forEach((day, index) => {
    if (index < n) {
      score.dayBrackets[day] = 'low';
      score.days[day] = M.pointsForBracket('low');
    }
  });
  return score;
}

function commandKpis(state) {
  const rows = Insights.getActiveRows(state);
  const counts = Insights.getKpiCounts(rows);
  counts.total = Command.countActiveMembers(state);
  return { rows, counts };
}

console.log('\nCâblage');
assert(typeof Command.countActiveMembers === 'function', 'countActiveMembers exposé');
assert(
  commandCode.includes('counts.total = countActiveMembers(state)'),
  'Joueurs actifs écrase le total VS'
);
assert(commandCode.includes('${counts.green}'), 'Vert reste counts.green');
assert(commandCode.includes('${counts.orange}'), 'Orange reste counts.orange');
assert(commandCode.includes('${counts.red}'), 'Rouge reste counts.red');
assert(insightsCode.includes('if (!week) return [];'), 'getActiveRows inchangé : pas de semaine = pas de lignes VS');

console.log('\nEffectif');
const players = [];
for (let i = 0; i < 95; i += 1) {
  players.push(M.createPlayer({ pseudo: `Actif${i}`, status: 'Actif' }));
}
const absent = M.createPlayer({ pseudo: 'ActifAbsent', status: 'Actif', absent: true });
const inactive = M.createPlayer({ pseudo: 'ActifInactif', status: 'Actif', inactive: true });
players.push(absent, inactive);
for (let i = 0; i < 19; i += 1) {
  players.push(M.createPlayer({ pseudo: `Parti${i}`, status: 'Parti' }));
}

const roster = {
  players,
  weeks: [],
  currentWeekId: null,
};
const before = JSON.stringify(roster);
const noWeek = commandKpis(roster);

assert(players.filter((p) => p.status === 'Actif').length === 97, 'fixture : 97 Actif');
assert(Command.countActiveMembers(roster) === 97, '97 Actif → Joueurs actifs = 97');
assert(noWeek.counts.total === 97, 'KPI composé = 97');
assert(absent.status === 'Actif' && absent.absent === true, 'fixture : un Actif absent');
assert(
  Command.countActiveMembers({ players: [absent] }) === 1,
  'un Actif absent est compté'
);
assert(
  Command.countActiveMembers({
    players: [M.createPlayer({ pseudo: 'Ancien', status: 'Parti' })],
  }) === 0,
  'un joueur Parti n’est pas compté'
);
assert(noWeek.rows.length === 0, 'aucune semaine VS → aucune ligne couleur');
assert(noWeek.counts.green === 0, 'aucune semaine VS → Vert = 0');
assert(noWeek.counts.orange === 0, 'aucune semaine VS → Orange = 0');
assert(noWeek.counts.red === 0, 'aucune semaine VS → Rouge = 0');
assert(Insights.getKpiCounts([]).total === 0, 'le total VS brut reste 0 sans semaine');
assert(JSON.stringify(roster) === before, 'le calcul ne modifie pas les données');

console.log('\nSemaine VS active');
const green = M.createPlayer({ pseudo: 'Vert', status: 'Actif' });
const orange = M.createPlayer({ pseudo: 'Orange', status: 'Actif' });
const red = M.createPlayer({ pseudo: 'Rouge', status: 'Actif' });
const stillAbsent = M.createPlayer({ pseudo: 'AbsentCompte', status: 'Actif', absent: true });
const gone = M.createPlayer({ pseudo: 'PartiCouleur', status: 'Parti' });
const week = M.createWeek(new Date('2026-09-21'), { number: 1 });
week.scores[green.id] = scoreUnderDays(0);
week.scores[orange.id] = scoreUnderDays(2);
week.scores[red.id] = scoreUnderDays(4);
week.scores[stillAbsent.id] = scoreUnderDays(4);
week.scores[gone.id] = scoreUnderDays(4);

const withWeek = {
  players: [green, orange, red, stillAbsent, gone],
  weeks: [week],
  currentWeekId: week.id,
};
const weekBefore = JSON.stringify(withWeek);
const live = commandKpis(withWeek);
assert(live.counts.total === 4, 'semaine active : 4 Actif dont l’absent, sans le Parti');
assert(live.counts.green === 1, 'semaine active : Vert inchangé');
assert(live.counts.orange === 1, 'semaine active : Orange inchangé');
assert(live.counts.red === 1, 'semaine active : Rouge inchangé');
assert(
  live.rows.every((row) => row.player.status === 'Actif' && !row.player.absent),
  'les couleurs ignorent toujours absents et Partis'
);
assert(JSON.stringify(withWeek) === weekBefore, 'le calcul couleur ne modifie pas les données');

console.log('\nRenommage');
const renamed = M.createPlayer({ pseudo: 'AncienPseudo', status: 'Actif' });
const renameState = {
  players: [renamed, M.createPlayer({ pseudo: 'Autre', status: 'Parti' })],
  weeks: [],
  currentWeekId: null,
  playerWeekNotes: {},
  playerVsUnderStats: {},
  playerFollowUps: {},
  playerFollowUpNotes: {},
  playerFollowUpAutoSuppress: {},
  playerFollowUpArchives: {},
};
const idBefore = renamed.id;
const countBeforeRename = Command.countActiveMembers(renameState);
renamed.pseudo = 'NouveauPseudo';
Identity.migrateMainState(renameState, {
  explicitPseudo: 'AncienPseudo',
  explicitPlayerId: idBefore,
});
assert(renameState.players.length === 2, 'renommage : pas de joueur en plus');
assert(renamed.id === idBefore, 'renommage : même ID');
assert(
  Command.countActiveMembers(renameState) === countBeforeRename,
  'renommage : le nombre de Joueurs actifs ne change pas'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
