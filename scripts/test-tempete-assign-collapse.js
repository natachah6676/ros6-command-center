/**
 * Tests UI Affectations Phase 1 repliées
 * node scripts/test-tempete-assign-collapse.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'js/tempete.js'), 'utf8');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  ✓', msg);
  } else {
    failed += 1;
    console.error('  ✗', msg);
  }
}

console.log('\n=== Affichage compact ===');
assert(code.includes('Voir / modifier les affectations'), 'Bouton ouverture');
assert(code.includes('Affectations générées automatiquement'), 'Sous-titre compact');
assert(code.includes('Nombre de joueurs affectés'), 'Compteur joueurs');
assert(code.includes('Nombre de bâtiments utilisés'), 'Compteur bâtiments');
assert(code.includes('Alertes éventuelles'), 'Compteur alertes');
assert(code.includes('Vérification nécessaire'), 'Label erreur');
assert(code.includes('Affectations automatiques'), 'Statut auto');
assert(code.includes('Affectations modifiées manuellement'), 'Statut manuel');

console.log('\n=== Ouverture / fermeture ===');
assert(code.includes('openAssignmentsEditor'), 'openAssignmentsEditor');
assert(code.includes('saveAssignmentsEditor'), 'saveAssignmentsEditor');
assert(code.includes('cancelAssignmentsEditor'), 'cancelAssignmentsEditor');
assert(code.includes('collapseAssignmentsEditor'), 'collapseAssignmentsEditor');
assert(code.includes('Enregistrer les modifications'), 'Bouton Enregistrer');
assert(code.includes('Annuler'), 'Bouton Annuler');
assert(code.includes('Replier'), 'Bouton Replier');
assert(code.includes('cloneAssignmentState'), 'Snapshot avant édition');
assert(code.includes('restoreAssignmentState'), 'Restauration Annuler');
assert(code.includes("ui.open = false"), 'Replié par défaut / après actions');

console.log('\n=== Logique génération intacte ===');
const genIdx = code.indexOf('function generateStrategy()');
const genEnd = code.indexOf('function powerOfIds', genIdx);
const genBody = code.slice(genIdx, genEnd);
assert(genIdx > 0, 'generateStrategy présent');
assert(genBody.includes('pickVolants') && genBody.includes('phase1'), 'Corps génération inchangé');
assert(genBody.includes('assignmentsManual: false'), 'Flag manuel remis à false à la génération');
assert(code.includes('data-tempete-add-row'), 'Ajout joueur conservé');
assert(code.includes('data-tempete-replace-row'), 'Remplacement conservé');
assert(code.includes('data-tempete-remove-row'), 'Retrait conservé');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
