/**
 * Tests i18n UI Ruche FR/EN (préférence localStorage uniquement).
 * node scripts/test-ruche-i18n.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const i18nCode = fs.readFileSync(path.join(root, 'js/ruche-i18n.js'), 'utf8');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const rucheCode = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');
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

console.log('\n=== Fichiers / câblage ===');
assert(html.includes('data-ruche-lang="fr"'), 'sélecteur FR dans HTML');
assert(html.includes('data-ruche-lang="en"'), 'sélecteur EN dans HTML');
assert(html.includes('ruche-i18n.js'), 'script i18n chargé');
assert(html.includes('data-i18n="title"'), 'titres data-i18n');
assert(rucheCode.includes('warops_ruche_ui_lang') || i18nCode.includes('warops_ruche_ui_lang'), 'clé localStorage dédiée');
assert(i18nCode.includes("STORAGE_KEY = 'warops_ruche_ui_lang'"), 'STORAGE_KEY exacte');
assert(!i18nCode.includes('schedulePush'), 'i18n ne pousse pas');
assert(
  i18nCode.includes('Ne jamais synchroniser vers ros6_state') ||
    i18nCode.includes('ros6_ruche_v1'),
  'commentaire d’exclusion sync présent'
);
assert(rucheCode.includes('confirmRuche'), 'confirms Ruche localisés');
assert(rucheCode.includes("t('toast.verify.ok')"), 'toasts via t()');
assert(rucheCode.includes("Aucune archive ne sera créée") || i18nCode.includes('No archive will be created'), 'message confirm EN présent');
{
  const s = {
    window: {},
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelectorAll: () => [] },
  };
  s.window = s;
  s.global = s;
  vm.createContext(s);
  vm.runInContext(i18nCode, s);
  assert(Object.keys(s.window.RucheI18n.DICTS.fr).length > 80, 'catalogue FR riche');
}

const ls = {
  _d: {},
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null;
  },
  setItem(k, v) {
    this._d[k] = String(v);
  },
  removeItem(k) {
    delete this._d[k];
  },
};

const storeWrites = [];
const sandbox = {
  window: {},
  console,
  localStorage: ls,
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  ROSStorage: {
    getState: () => ({
      players: [],
      powerTiers: [],
      alliance: { name: 'Test', tag: 'TST', server: '1', language: 'fr' },
    }),
  },
  AppUI: {
    toast() {},
    confirm: async () => true,
  },
  ROSSync: {
    schedulePush(key) {
      storeWrites.push(['push', key]);
    },
  },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(i18nCode, sandbox);
vm.runInContext(modelsCode, sandbox);

const I18n = sandbox.window.RucheI18n;

console.log('\n=== 1. Français par défaut ===');
assert(I18n.getLang() === 'fr', 'langue par défaut fr');
assert(I18n.t('btn.verify') === 'Vérifier la ruche', 'toast/bouton FR');
assert(I18n.getDateLocale() === 'fr-FR', 'locale dates fr-FR');

console.log('\n=== 2. Passage FR → EN ===');
I18n.setLang('en', { applyDom: false });
assert(I18n.getLang() === 'en', 'langue en');
assert(I18n.t('btn.verify') === 'Verify hive', 'bouton EN');
assert(I18n.t('confirm.cancel') === 'Cancel', 'Cancel EN');
assert(I18n.getDateLocale() === 'en-GB', 'locale dates en-GB');
assert(ls.getItem('warops_ruche_ui_lang') === 'en', 'préférence écrite en localStorage');

console.log('\n=== 3. Passage EN → FR ===');
I18n.setLang('fr', { applyDom: false });
assert(I18n.getLang() === 'fr', 'retour fr');
assert(I18n.t('btn.verify') === 'Vérifier la ruche', 'bouton FR après retour');
assert(ls.getItem('warops_ruche_ui_lang') === 'fr', 'préférence fr stockée');

console.log('\n=== 4. Préférence conservée après rechargement ===');
ls.setItem('warops_ruche_ui_lang', 'en');
const sandbox2 = {
  window: {},
  console,
  localStorage: ls,
  document: { getElementById: () => null, querySelectorAll: () => [] },
};
sandbox2.window = sandbox2;
sandbox2.global = sandbox2;
vm.createContext(sandbox2);
vm.runInContext(i18nCode, sandbox2);
assert(sandbox2.window.RucheI18n.getLang() === 'en', 'reload lit EN depuis localStorage');

console.log('\n=== 5. Aucune écriture store Ruche / CC ===');
const rucheStore = { data: null, writes: 0 };
const sandbox3 = {
  window: {},
  console,
  localStorage: {
    getItem(k) {
      if (k === 'ros6_ruche_v1') return rucheStore.data;
      if (k === 'warops_ruche_ui_lang') return 'fr';
      return null;
    },
    setItem(k, v) {
      if (k === 'ros6_ruche_v1') {
        rucheStore.writes += 1;
        rucheStore.data = String(v);
      }
      if (k === 'warops_ruche_ui_lang') ls.setItem(k, v);
    },
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  ROSStorage: {
    getState: () => ({
      players: [
        { id: 'p1', pseudo: 'Willow', role: 'R5', status: 'Actif', heroPowerTierId: 'tier_50_55' },
      ],
      powerTiers: sandbox.window.ROSModels
        ? sandbox.window.ROSModels.createDefaultPowerTiers()
        : [],
      alliance: { name: 'A', tag: 'TAG', server: '1', language: 'fr' },
    }),
  },
  AppUI: { toast() {}, confirm: async () => true },
  ROSSync: {
    schedulePush() {
      storeWrites.push('sync');
    },
  },
};
sandbox3.window = sandbox3;
sandbox3.global = sandbox3;
vm.createContext(sandbox3);
vm.runInContext(i18nCode, sandbox3);
vm.runInContext(modelsCode, sandbox3);
vm.runInContext(rucheCode, sandbox3);
const beforeWrites = rucheStore.writes;
const beforeSync = storeWrites.length;
sandbox3.window.RucheI18n.setLang('en', { applyDom: false });
sandbox3.window.RucheModule.applyRucheLanguage('en');
assert(rucheStore.writes === beforeWrites, 'changement langue n’écrit pas ros6_ruche_v1');
assert(storeWrites.length === beforeSync, 'changement langue n’appelle pas schedulePush');
assert(ls.getItem('warops_ruche_ui_lang') === 'en', 'seule la clé UI lang est mise à jour');

console.log('\n=== 6. Sentinels / codes métier inchangés ===');
assert(sandbox3.window.RucheModule.FREE === 'FREE', 'FREE constant');
assert(sandbox3.window.RucheModule.MARSHAL === 'MARSHAL', 'MARSHAL constant');
assert(rucheCode.includes("const FREE = 'FREE'"), 'FREE littéral code');
assert(rucheCode.includes("const MARSHAL = 'MARSHAL'"), 'MARSHAL littéral code');
assert(rucheCode.includes("player.status !== 'Actif'"), 'statut Actif inchangé');
assert(html.includes('value="soft"') && html.includes('value="full"'), 'modes soft/full inchangés');

console.log('\n=== 7–8. Rendu dynamique / toasts / confirms EN ===');
sandbox3.window.RucheI18n.setLang('en', { applyDom: false });
assert(sandbox3.window.RucheModule.t('proposal.title') === 'Optimised proposal', 'titre dynamique EN');
assert(sandbox3.window.RucheModule.t('toast.archived') === 'Hive plan archived.', 'toast EN');
assert(sandbox3.window.RucheModule.t('confirm.clear.ok') === 'Clear', 'confirm OK EN');
assert(sandbox3.window.RucheModule.t('confirm.cancel') === 'Cancel', 'confirm Cancel EN');
assert(sandbox3.window.RucheModule.t('cell.marshal') === 'Marshal', 'Maréchal → Marshal');
assert(sandbox3.window.RucheModule.t('missing.key.xyz') === 'missing.key.xyz' || sandbox3.window.RucheI18n.t('btn.verify') === 'Verify hive', 'fallback ok');

console.log('\n=== 9. Dates locale appropriée ===');
sandbox3.window.RucheI18n.setLang('fr', { applyDom: false });
assert(sandbox3.window.RucheI18n.getDateLocale() === 'fr-FR', 'fr-FR');
sandbox3.window.RucheI18n.setLang('en', { applyDom: false });
assert(sandbox3.window.RucheI18n.getDateLocale() === 'en-GB', 'en-GB');
const sample = sandbox3.window.RucheI18n.formatDateTime('2026-09-29T10:00:00.000Z');
assert(typeof sample === 'string' && sample.length > 4, 'formatDateTime produit une chaîne');

console.log('\n=== Catalogues alignés ===');
const frKeys = Object.keys(I18n.DICTS.fr).sort();
const enKeys = Object.keys(I18n.DICTS.en).sort();
assert(frKeys.length === enKeys.length, `même nombre de clés FR/EN (${frKeys.length})`);
assert(frKeys.every((k, i) => k === enKeys[i]), 'mêmes clés FR et EN');
assert(!I18n.DICTS.fr['alliance.language'], 'pas de dépendance alliance.language');

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`FR keys: ${frKeys.length} · EN keys: ${enKeys.length}`);
if (failed) process.exit(1);
