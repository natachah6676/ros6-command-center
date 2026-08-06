/**
 * Tests Tempête A/B indépendantes
 * node scripts/test-tempete-independent.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'js/tempete.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

console.log('\n=== UI indépendante ===');
assert(html.includes('id="tempeteStormCards"'), 'Conteneur deux cartes');
assert(!html.includes('tempeteResetStorm'), 'Bouton Réinitialiser supprimé');
assert(!html.includes('id="tempeteGenerate"'), 'Ancien bouton Générer global retiré');
assert(!html.includes('id="tempeteClose"'), 'Ancien bouton Clôturer global retiré');
assert(!html.includes('id="tempeteVerifyPlayers"'), 'Ancien bouton Vérifier global retiré');
assert(html.includes('Deux Tempêtes indépendantes'), 'Sous-titre indépendance');

console.log('\n=== Logique par Tempête ===');
assert(code.includes('teamValidation'), 'Validation par équipe');
assert(code.includes('getTeamRosterFingerprint'), 'Fingerprint par équipe');
assert(code.includes('onGenerateForTeam'), 'Génération ciblée');
assert(code.includes('onCloseStormForTeam'), 'Clôture ciblée');
assert(code.includes('renderStormCards'), 'Rendu des cartes');
assert(!/\bclearPlayersValidation\b/.test(code), 'Ancienne validation globale retirée');
assert(!code.includes('els.btnResetStorm'), 'Handler Réinitialiser retiré');
assert(code.includes('L’autre Tempête'), 'Message clôture indépendante');

console.log('\n=== Fingerprint indépendant ===');
function fp(team) {
  const idsFor = (selection) =>
    Object.keys(team.roster || {})
      .filter((id) => (team.roster[id]?.selection || 'non_retenu') === selection)
      .sort();
  return JSON.stringify({ p: idsFor('participant'), r: idsFor('remplacant') });
}

const teamA = { roster: { p1: { selection: 'participant' }, p2: { selection: 'remplacant' } } };
const teamB = { roster: { p3: { selection: 'participant' } } };
const fpA1 = fp(teamA);
const fpB1 = fp(teamB);
assert(fpA1 !== fpB1, 'Empreintes A et B distinctes');
teamA.roster.p4 = { selection: 'participant' };
assert(fp(teamA) !== fpA1, 'Changement A invalide A');
assert(fp(teamB) === fpB1, 'Changement A ne touche pas B');

console.log('\n=== generateStrategy intact ===');
const genIdx = code.indexOf('function generateStrategy()');
const genEnd = code.indexOf('function powerOfIds', genIdx);
const genBody = code.slice(genIdx, genEnd);
assert(genIdx > 0, 'generateStrategy présent');
assert(genBody.includes('pickVolants') && genBody.includes('phase1'), 'Corps génération inchangé (repères)');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
