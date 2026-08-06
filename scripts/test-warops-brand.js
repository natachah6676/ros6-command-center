/**
 * Tests rebrand WAROPS + paramètres Alliance
 * node scripts/test-warops-brand.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
const ruche = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');

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

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
const ROSModels = sandbox.window.ROSModels;

console.log('\n=== Marque WAROPS ===');
assert(html.includes('<title>WAROPS</title>'), 'Titre WAROPS');
assert(html.includes('>WAROPS</h1>'), 'Titre produit WAROPS');
assert(html.includes('The Alliance Command Platform'), 'Sous-titre plateforme');
assert(html.includes('id="brandAllianceLine"'), 'Ligne Alliance header');
assert(html.includes('id="brandServerLine"'), 'Ligne Serveur header');
assert(!html.includes('ROS6 Command Center'), 'Ancien nom produit retiré du HTML');
assert(!html.includes('>Command Center</h1>'), 'Ancien h1 Command Center retiré');

console.log('\n=== Paramètres Alliance ===');
assert(html.includes('>Alliance</h3>'), 'Section Alliance paramètres');
assert(html.includes('id="allianceName"'), 'Champ nom');
assert(html.includes('id="allianceTag"'), 'Champ tag');
assert(html.includes('id="allianceServer"'), 'Champ serveur');
assert(html.includes('id="allianceLanguage"'), 'Champ langue');
assert(html.includes('id="btnSaveAlliance"'), 'Bouton enregistrer');
assert(appCode.includes('saveAllianceSettings'), 'Handler saveAllianceSettings');
assert(appCode.includes('applyBrandIdentity'), 'applyBrandIdentity');

console.log('\n=== Modèle / migration ===');
const defaults = ROSModels.createDefaultAllianceSettings();
assert(defaults.name === 'ROS6' && defaults.tag === 'ROS6' && defaults.server === '602', 'Défauts ROS6 / 602');
assert(defaults.language === 'fr', 'Langue défaut fr');

const blank = ROSModels.createBlankState();
assert(blank.alliance && blank.alliance.name === 'ROS6', 'Blank state avec alliance');

const migrated = ROSModels.normalizeState({
  version: 1,
  appRole: 'R5',
  players: [],
  weeks: [ROSModels.createWeek(1)],
  currentWeekId: null,
});
assert(migrated.alliance.name === 'ROS6', 'Migration sans alliance → défauts');
assert(migrated.alliance.server === '602', 'Serveur défaut migré');

const custom = ROSModels.normalizeAllianceSettings({
  name: 'TVH',
  tag: 'TVH',
  server: '700',
  language: 'en',
});
assert(custom.name === 'TVH' && custom.language === 'en', 'Alliance custom normalisée');
assert(ROSModels.getAllianceName({ alliance: custom }) === 'TVH', 'getAllianceName');
assert(ROSModels.getAllianceTag({ alliance: custom }) === 'TVH', 'getAllianceTag');

console.log('\n=== Affichages dynamiques ===');
assert(appCode.includes('Alliance : ${alliance.name}'), 'Libellé Alliance dynamique');
assert(appCode.includes('Serveur : ${alliance.server}'), 'Libellé Serveur dynamique');
assert(ruche.includes('getAllianceTag'), 'Export ruche utilise le tag');
assert(css.includes('--accent-line'), 'CSS identité WAROPS');
assert(css.includes('.brand-tagline'), 'Style tagline');

console.log('\n=== Clés / tables inchangées ===');
assert(
  fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8').includes("STORAGE_KEY = 'ros6_command_center_v1'"),
  'Clé localStorage principale inchangée'
);
assert(
  fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8').includes(".from('ros6_state')"),
  'Table ros6_state inchangée'
);

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
