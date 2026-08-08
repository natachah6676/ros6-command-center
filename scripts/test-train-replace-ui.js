/**
 * Vérifie l’UI de remplacement manuel Train.
 * node scripts/test-train-replace-ui.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const train = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');

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

console.log('\n=== Train remplacement manuel ===');
assert(html.includes('id="trainReplaceModal"'), 'modal remplacement');
assert(train.includes('replace-week-role'), 'action Modifier');
assert(train.includes('openReplaceModal'), 'openReplaceModal');
assert(train.includes('submitReplaceModal'), 'submitReplaceModal');
assert(train.includes('renderWeekRoleLine'), 'affichage Nom + Modifier');
assert(train.includes("field === 'conductorId'"), 'remplacement conducteur');
assert(train.includes("field === 'vipId'"), 'remplacement VIP');
assert(train.includes('isEligibleForWeekConductor'), 'éligibilité conducteur');
assert(train.includes('isEligibleForWeekVip'), 'éligibilité VIP');
assert(train.includes('setWeekDayField'), 'mise à jour slot unique');
assert(train.includes('buildNotificationText'), 'notif mise à jour');
assert(train.includes('correctArchivedHistoryRole'), 'correction archive');
assert(train.includes('replace-history-role'), 'bouton Modifier historique');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
