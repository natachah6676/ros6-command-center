/**
 * Recrutement retiré de l’UI — garde-fou.
 * node scripts/test-recrutement-train-ux.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

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

assert(!html.includes('data-tab="recrutement"'), 'Onglet Recrutement retiré');
assert(!html.includes('id="panel-recrutement"'), 'Panneau Recrutement retiré');
assert(!html.includes('js/recrutement.js'), 'Script recrutement retiré');
assert(!fs.existsSync(path.join(root, 'js/recrutement.js')), 'Fichier js/recrutement.js absent');
assert(!appCode.includes('RecrutementModule'), 'App sans RecrutementModule');
assert(html.includes('data-tab="suivi"'), 'Onglet Gestion des membres conservé');

console.log(`\n${passed} OK, ${failed} KO`);
process.exit(failed ? 1 : 0);
