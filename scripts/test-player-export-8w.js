/**
 * Export brut 8 semaines calendaires + journal futur des underDays.
 * node scripts/test-player-export-8w.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
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

function runVm(filename, sandbox) {
  vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox);
}

const NOW = new Date(2026, 9, 7, 15, 0, 0);
const HEADERS = [
  'Pseudo',
  'Statut',
  'Puissance héros',
  'VS jours sous seuil connus',
  'VS données complètes',
  'Tempêtes inscrit',
  'Tempêtes remplaçant',
  'Difficultés Ruche',
  'Oublis bouclier',
];

function score(brackets) {
  return {
    days: { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0 },
    dayBrackets: {
      lundi: 'ok',
      mardi: 'ok',
      mercredi: 'ok',
      jeudi: 'ok',
      vendredi: 'ok',
      ...brackets,
    },
    allianceDonMissed: false,
    absent: false,
  };
}

function player(id, pseudo, status, extra) {
  return { id, pseudo, role: 'Membre', status, absent: false, ...extra };
}

function flag(at, clearedAt) {
  return clearedAt ? { at, clearedAt } : { at };
}

function ledgerWeek(weekId, startDate, rows) {
  return {
    weekId,
    startDate,
    endDate: startDate,
    closedAt: `${startDate}T18:00:00.000Z`,
    players: rows,
  };
}

function parseCsv(csv) {
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  return text.replace(/\r\n$/, '').split('\r\n');
}

function rowOf(lines, pseudo) {
  return lines.find((line) => line.startsWith(`${pseudo};`) || line.startsWith(`"${pseudo}`));
}

const modelSandbox = { window: {}, console, document: { getElementById: () => null } };
modelSandbox.window = modelSandbox;
modelSandbox.global = modelSandbox;
vm.createContext(modelSandbox);
runVm('js/models.js', modelSandbox);
const M = modelSandbox.ROSModels;

console.log('\n=== Période : 8 lundis calendaires ===');
const weekKeys = M.lastEightCalendarWeekKeys(NOW);
assert(weekKeys.length === 8, 'exactement 8 semaines');
assert(weekKeys[0] === '2026-08-17' && weekKeys[7] === '2026-10-05', 'du lundi 17 août au lundi 5 octobre 2026');
assert(
  weekKeys.join(',') ===
    '2026-08-17,2026-08-24,2026-08-31,2026-09-07,2026-09-14,2026-09-21,2026-09-28,2026-10-05',
  'les lundis sont consécutifs'
);

console.log('\n=== Journal futur : 0 et 1 inclus, historiques existants intacts ===');
{
  const oldHistory = [
    {
      weekId: 'week_old',
      startDate: '2026-01-05',
      endDate: '2026-01-09',
      closedAt: '2026-01-09T18:00:00.000Z',
      underMinDays: 2,
      players: [{ playerId: 'three', pseudo: 'Trois', underDays: 3 }],
    },
  ];
  const oldStats = {
    three: {
      entries: [
        {
          weekId: 'week_old',
          startDate: '2026-01-05',
          underDays: 3,
          under: true,
          praise: false,
          at: '2026-01-09T18:00:00.000Z',
        },
      ],
    },
  };
  const week = {
    id: 'week_new',
    startDate: '2026-09-28',
    endDate: '2026-10-02',
    closedAt: '2026-10-02T18:00:00.000Z',
    scores: {
      zero: score({}),
      one: score({ lundi: 'mid' }),
      three: score({ lundi: 'low', mardi: 'low', mercredi: 'mid' }),
      absent: score({ lundi: 'low' }),
      partial: score({ lundi: '' }),
    },
  };
  const state = {
    players: [
      player('zero', 'Zéro', 'Actif'),
      player('one', 'Un', 'Actif'),
      player('three', 'Trois', 'Actif'),
      player('absent', 'Absent', 'Actif', { absent: true }),
      player('partial', 'Partiel', 'Actif'),
    ],
    followUpSettings: { vsMinUnderDays: 2 },
    playerVsUnderStats: JSON.parse(JSON.stringify(oldStats)),
    vsUnderWeekHistory: JSON.parse(JSON.stringify(oldHistory)),
    vsUnderDaysLedger: [ledgerWeek('week_keep', '2026-08-17', [{ playerId: 'zero', underDays: 0 }])],
  };
  const statsBefore = JSON.stringify(state.playerVsUnderStats);
  const historyBefore = JSON.stringify(state.vsUnderWeekHistory);
  M.recordVsUnderDaysLedger(state, week);
  M.recordVsUnderSnapshotsForWeek(state, week);
  M.pushVsUnderWeekArchive(state, week);
  const ledger = state.vsUnderDaysLedger.find((entry) => entry.weekId === 'week_new');
  const ledgerDays = Object.fromEntries(ledger.players.map((item) => [item.playerId, item.underDays]));
  assert(ledgerDays.zero === 0 && ledgerDays.one === 1 && ledgerDays.three === 3, 'le journal conserve 0, 1 et 3');
  assert(!ledgerDays.absent && ledgerDays.partial == null, 'absent et semaine incomplète ne sont pas inventés');
  assert(
    state.vsUnderDaysLedger.some((entry) => entry.weekId === 'week_keep'),
    'une semaine déjà journalisée n’est pas reconstruite'
  );
  assert(
    state.vsUnderWeekHistory.find((entry) => entry.weekId === 'week_old').players.length === 1 &&
      state.vsUnderWeekHistory.find((entry) => entry.weekId === 'week_old').players[0].underDays === 3,
    'vsUnderWeekHistory ancien reste inchangé'
  );
  const archived = state.vsUnderWeekHistory.find((entry) => entry.weekId === 'week_new');
  assert(
    archived.players.length === 1 && archived.players[0].playerId === 'three',
    'l’archive sous seuil ne reçoit toujours que le joueur au-dessus du seuil'
  );
  assert(
    !state.playerVsUnderStats.zero && !state.playerVsUnderStats.one && !state.playerVsUnderStats.absent,
    'les compteurs VS n’absorbent pas les 0 et les 1'
  );
  assert(
    state.playerVsUnderStats.three.entries.some((entry) => entry.weekId === 'week_new'),
    'le compteur utile du joueur sous seuil est toujours alimenté'
  );
  assert(
    JSON.stringify(state.playerVsUnderStats.three.entries[1] || state.playerVsUnderStats.three.entries.find((e) => e.weekId === 'week_old')) ===
      JSON.stringify(oldStats.three.entries[0]) ||
      state.playerVsUnderStats.three.entries.some(
        (entry) => entry.weekId === 'week_old' && entry.underDays === 3
      ),
    'l’entrée de compteur ancienne reste à 3 jours'
  );
  assert(historyBefore !== JSON.stringify(state.vsUnderWeekHistory), 'la clôture ajoute l’archive de la nouvelle semaine');
  assert(statsBefore !== JSON.stringify(state.playerVsUnderStats), 'la clôture ajoute le compteur utile');
  const normalized = M.normalizeState(state);
  assert(
    normalized.vsUnderDaysLedger.some((entry) => entry.weekId === 'week_new' && entry.players.some((p) => p.underDays === 0)),
    'normalizeState conserve le journal'
  );
  assert(!M.normalizeState({ players: state.players }).vsUnderDaysLedger, 'une charge sans journal n’en crée pas');
}

console.log('\n=== Export : semaines calendaires, VS incomplet, tempête, ruche, bouclier ===');
{
  const outside = [];
  for (let i = 0; i < 8; i += 1) {
    const start = new Date(2026, 0, 5 + i * 7);
    const iso = M.toISODate(start);
    outside.push({
      weekId: `old_${i}`,
      startDate: iso,
      players: [{ playerId: 'alpha', pseudo: 'Alpha', underDays: 5 }],
    });
  }
  const state = {
    players: [
      player('alpha', 'Alpha', 'Actif', { heroPowerTierId: 'tier_35_40' }),
      player('beta', 'Beta', 'Parti'),
      player('gamma', '=Gamma;test', 'Actif'),
    ],
    currentWeekId: 'week_open',
    weeks: [
      {
        id: 'week_open',
        startDate: '2026-10-05',
        archived: false,
        scores: {
          alpha: score({ lundi: 'low', mardi: 'mid' }),
          beta: score({ lundi: '' }),
        },
      },
    ],
    followUpSettings: { vsMinUnderDays: 9 },
    vsUnderWeekHistory: [
      ...outside,
      {
        weekId: 'hist_sep',
        startDate: '2026-09-21',
        underMinDays: 2,
        players: [{ playerId: 'alpha', pseudo: 'Alpha', underDays: 4 }],
      },
    ],
    playerVsUnderStats: {
      alpha: {
        entries: [
          {
            weekId: 'hist_sep',
            startDate: '2026-09-21',
            underDays: 4,
            under: true,
            praise: false,
          },
          {
            weekId: 'praise',
            startDate: '2026-09-14',
            underDays: 0,
            under: false,
            praise: true,
          },
        ],
      },
    },
    vsUnderDaysLedger: [
      ledgerWeek('led_aug', '2026-08-17', [
        { playerId: 'alpha', underDays: 0 },
        { playerId: 'beta', underDays: 1 },
      ]),
      ledgerWeek('led_conflict', '2026-09-21', [{ playerId: 'alpha', underDays: 1 }]),
    ],
    playerWeeklyFlags: {
      alpha: {
        hive: {
          '2026-08-17': flag('2026-08-17T08:00:00.000Z'),
          '2026-07-13': flag('2026-07-13T08:00:00.000Z'),
          '2026-08-24': flag('2026-08-24T08:00:00.000Z', '2026-08-24T09:00:00.000Z'),
        },
        shield: {
          '2026-10-05': flag('2026-10-05T08:00:00.000Z'),
        },
      },
    },
  };
  const archives = [
    {
      id: 'in',
      closedAt: '2026-08-20T18:00:00.000Z',
      participants: [{ id: 'alpha', pseudo: 'Alpha' }],
      remplacants: [{ id: 'beta', pseudo: 'Beta' }],
      attendance: { alpha: 'absent', beta: 'present' },
    },
    {
      id: 'out',
      closedAt: '2026-08-10T18:00:00.000Z',
      participants: [{ id: 'alpha', pseudo: 'Alpha' }],
      remplacants: [],
    },
    {
      id: 'nodate',
      participants: [{ id: 'alpha', pseudo: 'Alpha' }],
      remplacants: [],
    },
    {
      id: 'both',
      closedAt: '2026-09-28T12:00:00.000Z',
      participants: [{ id: 'alpha', pseudo: 'Alpha' }],
      remplacants: [{ id: 'alpha', pseudo: 'Alpha' }],
    },
  ];
  const built = M.buildPlayerEightWeekExport(state, archives, NOW);
  assert(built.weekKeys.join(',') === weekKeys.join(','), 'l’export utilise les 8 lundis, pas les 8 dernières archives');
  const lines = parseCsv(built.csv);
  assert(built.csv.charCodeAt(0) === 0xfeff, 'BOM UTF-8');
  assert(built.csv.includes('\r\n'), 'fins de ligne CRLF');
  assert(lines[0] === HEADERS.join(';'), 'en-tête Excel exact');
  assert(!/score|classement|recommand/i.test(lines[0]), 'aucune colonne de score, classement ou recommandation');
  const alpha = rowOf(lines, 'Alpha').split(';');
  const beta = rowOf(lines, 'Beta').split(';');
  assert(alpha[1] === 'Actif' && alpha[2] === '35 à 40 M', 'statut et palier de puissance actuels');
  assert(alpha[3] === '3' && alpha[4] === 'Non', 'Alpha : 0 journalisé + 1 du journal prioritaire + 0 félicitation, semaine ouverte 2, total 3, incomplet');
  assert(beta[1] === 'Parti' && beta[2] === 'Non renseignée', 'Beta : statut actuel et puissance absente');
  assert(beta[3] === '1' && beta[4] === 'Non', 'Beta : seul le 1 journalisé est connu, pas un 0 inventé');
  assert(alpha[5] === '2' && alpha[6] === '1', 'Alpha : deux inscriptions et un remplacement, présence ignorée');
  assert(beta[5] === '0' && beta[6] === '1', 'Beta : seulement remplaçant');
  assert(alpha[7] === '1' && alpha[8] === '1', 'ruche et bouclier limités aux 8 lundis cochés');
  assert(lines.some((line) => line.includes(`"'=Gamma;test"`)), 'pseudo Excel et point-virgule sont neutralisés');

  const completeKeys = M.lastEightCalendarWeekKeys(NOW);
  const full = {
    players: [player('alpha', 'Alpha', 'Actif')],
    vsUnderDaysLedger: completeKeys.map((key, index) =>
      ledgerWeek(`full_${index}`, key, [{ playerId: 'alpha', underDays: index === 0 ? 0 : 1 }])
    ),
  };
  const fullBuilt = M.buildPlayerEightWeekExport(full, [], NOW);
  const fullRow = rowOf(parseCsv(fullBuilt.csv), 'Alpha').split(';');
  assert(fullRow[3] === '7' && fullRow[4] === 'Oui', 'huit semaines journalisées, y compris un 0, rendent le VS complet');
  full.vsUnderDaysLedger[3].players = [];
  const hole = M.buildPlayerEightWeekExport(full, [], NOW);
  const holeRow = rowOf(parseCsv(hole.csv), 'Alpha').split(';');
  assert(holeRow[4] === 'Non' && holeRow[3] === '6', 'une semaine sans donnée n’est pas remplacée par 0');
}

console.log('\n=== Fusion : le journal s’additionne sans toucher l’archive sous seuil ===');
{
  const syncSandbox = {
    window: {},
    console,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    navigator: { onLine: true },
    location: { hostname: 'localhost' },
    AppUI: { toast() {}, confirm: async () => false },
    ROSModels: M,
  };
  syncSandbox.window = syncSandbox;
  syncSandbox.global = syncSandbox;
  vm.createContext(syncSandbox);
  runVm('js/supabase-sync.js', syncSandbox);
  const history = [{ weekId: 'hist', startDate: '2026-09-21', players: [{ playerId: 'alpha', underDays: 4 }] }];
  const merged = syncSandbox.ROSSync.__test.mergeCommandCenterStore(
    {
      players: [],
      vsUnderWeekHistory: history,
      vsUnderDaysLedger: [ledgerWeek('remote', '2026-08-17', [{ playerId: 'alpha', underDays: 0 }])],
    },
    {
      players: [],
      vsUnderWeekHistory: history,
      vsUnderDaysLedger: [ledgerWeek('local', '2026-08-24', [{ playerId: 'beta', underDays: 1 }])],
    }
  );
  const ids = merged.vsUnderDaysLedger.map((entry) => entry.weekId).sort();
  assert(ids.join(',') === 'local,remote', 'les semaines distante et locale du journal sont conservées');
  assert(
    JSON.stringify(merged.vsUnderWeekHistory) === JSON.stringify(history),
    'la fusion du journal ne modifie pas vsUnderWeekHistory'
  );
}

async function closeAndButtonTests() {
console.log('\n=== Clôture VS : le journal est écrit, les suivis existants aussi ===');
{
  const store = { data: null };
  const weekSelector = { value: '', addEventListener() {} };
  const sandbox = {
    window: {},
    console,
    localStorage: {
      getItem: () => store.data,
      setItem: (_key, value) => {
        store.data = value;
      },
    },
    document: {
      getElementById: (id) => (id === 'weekSelector' ? weekSelector : {
        addEventListener() {},
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {},
        querySelectorAll: () => [],
        textContent: '',
        innerHTML: '',
        dataset: {},
        value: '',
      }),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    AppUI: { toast() {}, confirm: async () => true, switchTab() {} },
    ROSSync: { schedulePush() {}, flushPush: async () => ({ ok: false }) },
    ROSProfiles: { isActiveR5: () => true, stampActor: () => ({ actorLabel: 'Test' }) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  runVm('js/models.js', sandbox);
  runVm('js/storage.js', sandbox);
  runVm('js/vs.js', sandbox);
  const Models = sandbox.ROSModels;
  const zero = Models.createPlayer({ pseudo: 'Zéro', status: 'Actif' });
  zero.id = 'zero';
  const one = Models.createPlayer({ pseudo: 'Un', status: 'Actif' });
  one.id = 'one';
  const three = Models.createPlayer({ pseudo: 'Trois', status: 'Actif' });
  three.id = 'three';
  const away = Models.createPlayer({ pseudo: 'Absent', status: 'Actif', absent: true });
  away.id = 'away';
  const week = Models.createWeek(new Date(2026, 8, 28), { number: 12 });
  week.id = 'week_close';
  week.scores = {
    zero: Models.createEmptyScore(),
    one: score({ lundi: 'low' }),
    three: score({ lundi: 'low', mardi: 'mid', mercredi: 'low' }),
    away: score({ lundi: 'low' }),
  };
  const prior = {
    weekId: 'week_old',
    startDate: '2026-01-05',
    players: [{ playerId: 'three', pseudo: 'Trois', underDays: 3 }],
  };
  const initial = Models.createBlankState();
  initial.players = [zero, one, three, away];
  initial.weeks = [week];
  initial.currentWeekId = week.id;
  initial.vsUnderWeekHistory = [prior];
  store.data = JSON.stringify(initial);
  sandbox.ROSStorage.hydrateFromStorage();
  weekSelector.value = week.id;
  sandbox.VSModule.init();
  await sandbox.VSModule.closeActiveWeek();
  const closed = sandbox.ROSStorage.getState();
  const entry = closed.vsUnderDaysLedger.find((item) => item.weekId === 'week_close');
  const days = Object.fromEntries(entry.players.map((item) => [item.playerId, item.underDays]));
  assert(days.zero === 0 && days.one === 1 && days.three === 3 && !days.away, 'la clôture journalise tous les scores connus');
  assert(
    closed.vsUnderWeekHistory.some((item) => item.weekId === 'week_old' && item.players[0].underDays === 3),
    'la clôture ne réécrit pas l’historique VS ancien'
  );
  assert(
    closed.vsUnderWeekHistory.find((item) => item.weekId === 'week_close').players.every((item) => item.underDays >= 2),
    'Semaines passées continue d’exclure 0 et 1'
  );
  assert(!closed.playerVsUnderStats.zero && !closed.playerVsUnderStats.one, 'les suivis VS ignorent toujours 0 et 1');
}

console.log('\n=== Bouton réservé au R5 ===');
{
  let role = 'R5';
  const toasts = [];
  const clicks = [];
  const elements = {};
  function stub() {
    return {
      hidden: false,
      value: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      setAttribute() {},
      addEventListener() {},
      querySelectorAll() { return []; },
    };
  }
  const exportBtn = {
    hidden: true,
    addEventListener(type, fn) {
      this.handler = fn;
    },
  };
  const uiSandbox = {
    window: {},
    console,
    localStorage: {
      getItem(key) {
        if (key === 'ros6_tempete_v1') return JSON.stringify({ archives: [] });
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    document: {
      getElementById(id) {
        if (id === 'btnExportPlayers8w') return exportBtn;
        if (!elements[id]) elements[id] = stub();
        return elements[id];
      },
      createElement() {
        return { click() { clicks.push('click'); }, remove() {} };
      },
      body: { appendChild() {}, removeChild() {} },
      addEventListener() {},
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Blob,
    AppUI: { toast(message) { toasts.push(message); }, confirm: async () => false },
    ROSProfiles: { isActiveR5: () => role === 'R5' },
    ROSStorage: { getState: () => ({ players: [] }) },
    ROSModels: M,
    ROSUI: { escapeHtml: (value) => String(value ?? '') },
  };
  uiSandbox.window = uiSandbox;
  uiSandbox.global = uiSandbox;
  vm.createContext(uiSandbox);
  runVm('js/players.js', uiSandbox);
  uiSandbox.PlayersModule.init();
  assert(exportBtn.hidden === false, 'le R5 voit Export joueurs – 8 semaines');
  role = 'R4';
  uiSandbox.PlayersModule.syncEightWeekExportButton();
  assert(exportBtn.hidden === true, 'le R4 ne voit pas le bouton');
  exportBtn.handler();
  assert(toasts.includes('Export réservé au R5.') && clicks.length === 0, 'un appel R4 ne produit pas de fichier');
  role = 'R5';
  exportBtn.handler();
  assert(clicks.length === 1, 'le R5 déclenche le téléchargement');
}
}

closeAndButtonTests().then(() => {
  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed) process.exit(1);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
