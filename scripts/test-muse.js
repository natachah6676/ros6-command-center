/**
 * La Muse — règles, génération, accès, fusion des brouillons.
 * node scripts/test-muse.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('  KO', msg);
  } else {
    console.log('  OK', msg);
  }
}

const elements = {};
function makeEl(id) {
  return {
    id,
    hidden: id === 'panel-muse',
    innerHTML: '',
    textContent: '',
    value: '',
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    contains() { return false; },
    querySelector(sel) {
      return this.innerHTML.includes(String(sel).replace(/[\[\]"=]/g, '').slice(0, 12)) ||
        this.innerHTML.includes('data-muse-ready')
        ? { ok: true }
        : null;
    },
  };
}
['panel-muse', 'museRoot', 'museToggleSettings'].forEach((id) => {
  elements[id] = makeEl(id);
});

const localStorage = {
  _data: {},
  getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
  setItem(key, value) { this._data[key] = String(value); },
};

const sandbox = {
  console,
  localStorage,
  document: {
    activeElement: null,
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/muse.js'), 'utf8'), sandbox, { filename: 'muse.js' });
const api = sandbox.MuseModule.__test;
const Muse = sandbox.MuseModule;

function state() {
  return api.createBlank();
}

console.log('\n=== Calendrier ===');
assert(api.weekday('2026-10-29') === 4, '29 octobre 2026 est un jeudi');
assert(api.addDays('2026-10-29', 8) === '2026-11-06', 'jeudi + 8 jours = vendredi 6 novembre');
assert(api.formatTitle('2026-10-29') === 'Programme du 29 octobre', 'titre sans année');
assert(api.formatHeure('21:00') === '21h' && api.formatHeure('21:30') === '21h30', 'heures affichées');
assert(/^\d{4}-\d{2}-\d{2}$/.test(api.parisToday()), 'date de Paris');

console.log('\n=== Maréchal, Zombies, Tempête, bouclier ===');
{
  const base = state();
  const thu = api.eventsForDate('2026-10-29', base);
  assert(thu.marshal.on && thu.marshal.time === '21:00', 'Maréchal le 29 octobre à 21h');
  assert(thu.zombie.on && thu.zombie.time === '21:30', 'Zombies à 21h30 avec Maréchal');
  assert(!thu.shield && !thu.storm, 'jeudi : ni bouclier ni Tempête');
  const wed = api.eventsForDate('2026-10-28', base);
  assert(!wed.marshal.on && !wed.zombie.on && wed.storm && !wed.shield, 'mercredi : Tempête seulement');
  const mon = api.eventsForDate('2026-10-26', base);
  assert(!mon.marshal.on && mon.zombie.on && mon.zombie.time === '21:00' && mon.storm, 'lundi sans Maréchal : Zombies 21h et Tempête');
  const fri = api.eventsForDate('2026-11-06', base);
  assert(fri.marshal.on && fri.marshal.time === '20:00' && fri.shield && !fri.zombie.on && !fri.storm, 'vendredi du cycle : 20h et bouclier');
  const sat = api.eventsForDate('2026-11-07', base);
  assert(!sat.marshal.on && sat.shield && !sat.zombie.on && !sat.storm, 'samedi : bouclier, pas de rappel Tempête');
  const sun = api.eventsForDate('2026-11-01', base);
  assert(!sun.storm && !sun.shield, 'dimanche : pas de Tempête');
}

console.log('\n=== Réglages et exceptions ===');
{
  const custom = state();
  custom.settings.marshalAnchorDate = '2026-10-30';
  custom.settings.marshalFridayTime = '19:00';
  custom.settings.zombieWeekdays = [1];
  custom.settings.zombieTime = '20:30';
  assert(!api.eventsForDate('2026-10-29', custom).marshal.on, 'nouvelle référence : le 29 octobre n’est plus un Maréchal');
  const movedAnchor = api.eventsForDate('2026-10-30', custom);
  assert(movedAnchor.marshal.on && movedAnchor.marshal.time === '19:00', 'le jour de référence vendredi suit l’horaire du vendredi');
  assert(!api.eventsForDate('2026-10-29', custom).zombie.on, 'jeudi retiré des Zombies');
  assert(api.eventsForDate('2026-10-26', custom).zombie.time === '20:30', 'horaire Zombies modifié');

  const cycle = state();
  cycle.settings.marshalFridayTime = '19:00';
  assert(api.eventsForDate('2026-10-29', cycle).marshal.time === '21:00', 'le jeudi garde l’horaire habituel');
  assert(api.eventsForDate('2026-11-06', cycle).marshal.time === '19:00', 'seul le vendredi change');

  const cancelled = state();
  cancelled.exceptions = [{ id: 'c1', kind: 'marshal', action: 'cancel', date: '2026-10-29' }];
  assert(!api.eventsForDate('2026-10-29', cancelled).marshal.on, 'Maréchal annulé ce jour-là');
  assert(api.eventsForDate('2026-10-31', cancelled).marshal.on, 'le cycle suivant reste en place');

  const moved = state();
  moved.exceptions = [{ id: 'm1', kind: 'marshal', action: 'move', date: '2026-10-29', toDate: '2026-10-30', time: '22:00' }];
  assert(!api.eventsForDate('2026-10-29', moved).marshal.on, 'départ du Maréchal déplacé');
  assert(api.eventsForDate('2026-10-30', moved).marshal.time === '22:00', 'arrivée à l’heure choisie');
  assert(api.eventsForDate('2026-10-31', moved).marshal.on, 'déplacer un jour ne décale pas le cycle');

  const noZ = state();
  noZ.exceptions = [{ id: 'z1', kind: 'zombie', action: 'cancel', date: '2026-10-29' }];
  assert(api.eventsForDate('2026-10-29', noZ).marshal.on && !api.eventsForDate('2026-10-29', noZ).zombie.on, 'Zombies annulés sans toucher au Maréchal');
  assert(api.eventsForDate('2026-11-05', noZ).zombie.on, 'les Zombies du jeudi suivant restent');
}

console.log('\n=== Bons plans ===');
{
  assert(api.sundayOnOrAfter('2026-11-02') === '2026-11-08', 'lundi 2 novembre expire le dimanche 8');
  assert(api.sundayOnOrAfter('2026-11-08') === '2026-11-08', 'le dimanche expire le jour même');
  const plan = { addedOn: '2026-11-02', expiresOn: '2026-11-08' };
  assert(api.planActiveOn(plan, '2026-11-08'), 'encore actif le dimanche inclus');
  assert(!api.planActiveOn(plan, '2026-11-09'), 'inactif le lundi suivant');
  const box = state();
  box.prep.bonsPlans = [{ id: 'bp', kind: 'chasseur', label: 'Chasseur de primes', addedOn: '2026-11-02', expiresOn: '2026-11-08' }];
  const kept = api.purgeExpiredPlans(box, '2026-11-08');
  assert(!kept.removed && kept.state.prep.bonsPlans.length === 1, 'le dimanche inclus, le bon plan reste');
  const gone = api.purgeExpiredPlans(box, '2026-11-09');
  assert(gone.removed && gone.state.prep.bonsPlans.length === 0, 'le lundi, le bon plan est retiré');
}

console.log('\n=== Génération ===');
{
  const thu = state();
  thu.prep.vsByDate['2026-10-29'] = 'economie';
  thu.prep.marshalLevelByDate['2026-10-29'] = '8';
  const textThu = api.generateNotification(thu, '2026-10-29');
  assert(
    textThu.text ===
      'Programme du 29 octobre\nCoucou les ROS6 :)\nJournée économique au VS, gardez vos ressources pour la suite !\nRendez-vous à 21h pour le Maréchal niveau 8 !\nOn se retrouve à 21h30 pour les Zombies !\nSoyez heureux mes préférés !',
    'jeudi : message rédigé, VS, Maréchal, Zombies, phrase finale'
  );
  assert(!textThu.text.includes("N'oubliez"), 'pas de bouclier le jeudi');

  const bare = state();
  const noLevel = api.generateNotification(bare, '2026-10-29');
  assert(noLevel.text.includes('Rendez-vous à 21h pour le Maréchal !') && !noLevel.text.includes('niveau'), 'sans niveau, aucun niveau inventé');
  assert(noLevel.warnings.some((item) => item.includes('Niveau du Maréchal')), 'le niveau manquant est signalé');

  const fri = state();
  fri.prep.vsByDate['2026-11-06'] = 'fond';
  fri.prep.marshalLevelByDate['2026-11-06'] = '3';
  const textFri = api.generateNotification(fri, '2026-11-06');
  assert(
    textFri.text.startsWith("Programme du 6 novembre\nN'oubliez pas votre bouclier !\nCoucou les ROS6 :)\n"),
    'vendredi : bouclier juste après le titre, puis le coucou'
  );
  assert(textFri.text.includes("Aujourd'hui, on donne tout pour le VS !"), 'VS à fond rédigé');
  assert(textFri.text.includes('Rendez-vous à 20h pour le Maréchal niveau 3 !'), 'vendredi à 20h');
  assert(textFri.text.endsWith(api.ENDING), 'phrase finale conservée');

  const sat = api.generateNotification(state(), '2026-11-07');
  assert(
    sat.text === "Programme du 7 novembre\nN'oubliez pas votre bouclier !\nCoucou les ROS6 :)\nSoyez heureux mes préférés !",
    'samedi : titre, bouclier, phrase finale'
  );
  assert(sat.omitted.some((item) => item.label === 'VS (non choisi)'), 'VS absent signalé, non inventé');
  assert(!sat.text.includes('à fond') && !sat.text.includes('7,2'), 'aucun VS inventé');

  const wed = api.generateNotification(state(), '2026-10-28');
  assert(wed.text.includes(api.PHRASES.storm) && !wed.text.includes('Maréchal') && !wed.text.includes('Zombies'), 'mercredi : rappel Tempête seulement');

  const both = state();
  both.prep.vsByDate['2026-10-29'] = '72m';
  both.prep.svsActive = true;
  both.prep.svsServer = '88';
  both.prep.zombiesDores = true;
  both.prep.general = true;
  const mixed = api.generateNotification(both, '2026-10-29');
  assert(mixed.text.includes(api.PHRASES.vs72), 'phrase 7,2 M exacte');
  assert(mixed.text.includes("C'est le moment du SVS : pillez le serveur 88 !"), 'SVS avec le serveur enregistré');
  const mixedLines = mixed.text.split('\n');
  assert(
    mixedLines.some((line) => line === api.PHRASES.vs72) &&
      mixedLines.some((line) => line === "C'est le moment du SVS : pillez le serveur 88 !") &&
      !mixedLines.some((line) => line.startsWith('VS') && line.includes('serveur')),
    'SVS et VS restent deux phrases distinctes'
  );
  assert(mixed.text.includes(api.PHRASES.gold) && mixed.text.includes(api.PHRASES.general), 'consignes Zombies dorés et Général');

  const missingServer = state();
  missingServer.prep.svsActive = true;
  const svsGap = api.generateNotification(missingServer, '2026-10-28');
  assert(svsGap.omitted.some((item) => item.label.includes('SVS')) && !svsGap.text.includes('pillez'), 'SVS sans numéro signalé');

  const crowded = state();
  crowded.prep.vsByDate['2026-10-29'] = 'economie';
  crowded.prep.marshalLevelByDate['2026-10-29'] = '8';
  crowded.prep.dailyNotes['2026-10-29'] = `NOTE_TROP_LONGUE ${'x'.repeat(480)}`;
  const limited = api.generateNotification(crowded, '2026-10-29');
  assert(limited.text.length <= api.MAX_CHARS, 'texte généré dans les 500 caractères');
  assert(limited.text.startsWith('Programme du 29 octobre') && limited.text.endsWith(api.ENDING), 'cadre conservé si ça déborde');
  assert(limited.omitted.some((item) => item.label === 'Consigne exceptionnelle'), 'élément trop long signalé');
  assert(
    limited.text.includes('économique') && limited.text.includes('niveau 8') && limited.text.includes('21h30'),
    'les infos importantes restent quand la consigne est trop longue'
  );
  assert(!limited.text.includes('NOTE_TROP_LONGUE'), 'élément trop long absent du texte');
  assert(!api.hasEmoji(limited.text), 'aucun emoji généré');

  const fancy = state();
  fancy.prep.bonsPlans = [{ id: 'c', kind: 'custom', label: 'Fête 😀 du clan', addedOn: '2026-10-29', expiresOn: '2026-11-01' }];
  const cleaned = api.generateNotification(fancy, '2026-10-29');
  assert(
    cleaned.text.includes('Profitez de Fête du clan dans les Bons plans !') && !api.hasEmoji(cleaned.text),
    'bon plan rédigé, emoji retiré'
  );

  const voiced = state();
  voiced.prep.date = '2026-10-28';
  voiced.prep.polls = [
    { id: '1', label: 'SVS' },
    { id: '2', label: 'Tempête du désert' },
  ];
  voiced.prep.bonsPlans = [
    { id: 'm', kind: 'marche', label: 'Marché scintillant', addedOn: '2026-10-26', expiresOn: '2026-11-01' },
    { id: 'h', kind: 'chasseur', label: 'Chasseur de primes', addedOn: '2026-10-26', expiresOn: '2026-11-01' },
  ];
  const voice = api.generateNotification(voiced, '2026-10-28');
  assert(
    voice.text.includes("N'oubliez pas de répondre aux sondages SVS et Tempête du désert !"),
    'les sondages forment une seule phrase'
  );
  assert(
    voice.text.includes('Profitez du Marché scintillant et du Chasseur de primes dans les Bons plans !'),
    'les bons plans forment une seule phrase'
  );
  assert((voice.text.match(/N'oubliez pas de répondre/g) || []).length === 1, 'pas de répétition du rappel sondage');
  assert((voice.text.match(/dans les Bons plans/g) || []).length === 1, 'pas de répétition des bons plans');

  const polls = state();
  polls.prep.polls = [
    { id: '1', label: 'Horaire' },
    { id: '2', label: 'Tenue' },
    { id: '3', label: 'Trop' },
  ];
  const two = api.normalize(polls);
  assert(two.prep.polls.length === 2, 'deux sondages maximum');
}

console.log('\n=== Texte individuel ===');
{
  const title = api.formatTitle('2026-10-29');
  const edited = api.enforceDraft(`sans titre 😀\net sans fin`, title, api.ENDING);
  assert(edited.startsWith(title) && edited.endsWith(api.ENDING), 'titre et phrase finale rétablis');
  assert(!api.hasEmoji(edited), 'emoji retiré après modification');
  const valid = `${title}\nVS : à fond.\n${api.ENDING}`;
  assert(api.canCopy(valid, title, api.ENDING), 'copie acceptée dans la limite');
  assert(!api.canCopy(`${valid}\n${'x'.repeat(500)}`, title, api.ENDING), 'copie refusée au-delà de 500');
  assert(!api.canCopy(`${title}\n😀\n${api.ENDING}`, title, api.ENDING), 'copie refusée avec emoji');

  const remote = state();
  remote.sharedUpdatedAt = '2026-10-28T12:00:00.000Z';
  remote.sharedUpdatedBy = 'user-a';
  remote.prep.vsByDate['2026-10-29'] = 'fond';
  remote.drafts['user-a'] = { text: 'texte A', updatedAt: '2026-10-28T11:00:00.000Z', forDate: '2026-10-29', omitted: [], warnings: [] };
  remote.drafts['user-b'] = { text: 'ancien B', updatedAt: '2026-10-28T10:00:00.000Z', forDate: '2026-10-29', omitted: [], warnings: [] };
  const local = state();
  local.sharedUpdatedAt = '2026-10-28T11:00:00.000Z';
  local.sharedUpdatedBy = 'user-b';
  local.prep.vsByDate['2026-10-29'] = 'economie';
  local.drafts['user-b'] = { text: 'nouveau B', updatedAt: '2026-10-28T13:00:00.000Z', forDate: '2026-10-29', omitted: [], warnings: [] };
  const merged = api.mergeStores(remote, local);
  assert(merged.prep.vsByDate['2026-10-29'] === 'fond', 'la préparation la plus récente est gardée');
  assert(merged.drafts['user-a'].text === 'texte A' && merged.drafts['user-b'].text === 'nouveau B', 'le brouillon d’un R4 n’écrase pas l’autre');
}

console.log('\n=== Accès et câblage ===');
{
  sandbox.ROSProfiles = { isActiveR4OrR5: () => false };
  assert(Muse.canAccess() === false, 'compte inactif ou hors R4/R5 refusé');
  sandbox.ROSProfiles = { isActiveR4OrR5: () => true };
  assert(Muse.canAccess() === true, 'R4 ou R5 actif accepté');

  elements['panel-muse'].hidden = false;
  Muse.init();
  Muse.render();
  assert(elements.museRoot.innerHTML.includes('Date de la notification'), 'étape 1 affichée');
  assert(elements.museRoot.innerHTML.includes('6. Notification'), 'bouton de génération prévu');
  assert(elements.museRoot.innerHTML.includes('Générer la notification') === false, 'la génération est à l’étape 6');

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const sync = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261028_ros6_muse_store.sql'), 'utf8');
  assert(html.includes('data-tab="muse"') && html.includes('id="panel-muse"') && html.includes('js/muse.js'), 'onglet La Muse dans la page');
  assert(app.includes('canAccessMuse') && app.includes("tabName === 'muse'"), 'ouverture réservée dans la navigation');
  assert(sync.includes("'ros6_muse_v1'") && sync.includes('mergeMuseStore') && sync.includes('store not allowed'), 'sync du module sans bloquer les autres stores');
  assert(migration.includes("'ros6_muse_v1'") && migration.includes('ros6_is_active_r4_or_r5()'), 'migration : store autorisé, contrôle R4/R5 conservé');
  assert(!/create policy/i.test(migration), 'aucune policy RLS nouvelle');
}

if (failed) {
  console.error(`\n${failed} échec(s)`);
  process.exit(1);
}
console.log('\nLa Muse : tous les contrôles sont passés.');
