/**
 * Traçabilité VS : createdBy* / closedBy* / vsWeekAudit / vsUnderWeekHistory.
 * node scripts/test-vs-week-audit.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const vsCode = fs.readFileSync(path.join(root, 'js/vs.js'), 'utf8');

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

const sandbox = {
  window: {},
  console,
  localStorage: {
    _d: {},
    getItem(k) {
      return this._d[k] ?? null;
    },
    setItem(k, v) {
      this._d[k] = String(v);
    },
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  },
  navigator: { onLine: true },
  ROSSupabase: {
    getClient: () => ({
      auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) },
    }),
  },
  AppUI: { toast() {}, confirm: async () => false },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
vm.runInContext(syncCode, sandbox);

const Models = sandbox.window.ROSModels;
const T = sandbox.window.ROSSync.__test;

const willow = {
  actorUserId: 'user_willow',
  actorPlayerId: 'player_willow',
  actorLabel: 'Willow',
};
const raiden = {
  actorUserId: 'user_raiden',
  actorPlayerId: 'player_raiden',
  actorLabel: 'Raiden 05',
};

function makeWeek(actor, extras = {}) {
  const week = Models.createWeek(new Date('2026-09-21T10:00:00.000Z'), {
    number: 12,
    actor,
  });
  if (extras.createdAt) week.createdAt = extras.createdAt;
  if (extras.id) week.id = extras.id;
  return week;
}

function storeWithWeek(week, audit = [], lifecycle = {}) {
  return {
    version: 1,
    players: [],
    weeks: week ? [week] : [],
    currentWeekId: week ? week.id : null,
    vsWeekAudit: audit,
    vsWeekLifecycle: lifecycle,
    playerFollowUpNotes: {},
  };
}

console.log('\n=== Présence API / UI wires ===');
assert(Models.VS_WEEK_AUDIT_LIMIT === 100, 'plafond = 100');
assert(typeof Models.mergeVsWeekAudits === 'function', 'mergeVsWeekAudits exposé');
assert(typeof Models.pushVsWeekAudit === 'function', 'pushVsWeekAudit exposé');
assert(vsCode.includes("buildVsWeekAuditEntry('create'"), 'vs.js audit create');
assert(vsCode.includes("buildVsWeekAuditEntry('close'"), 'vs.js audit close');
assert(vsCode.includes('actor: creator'), 'vs.js passe stampActor à createWeek');
assert(syncCode.includes('mergeVsWeekAuditField'), 'sync merge audit dédié');
assert(syncCode.includes('createdByUserId'), 'sync protège createdBy*');

console.log('\n=== Création par Willow → semaine + audit ===');
{
  const week = makeWeek(willow, { createdAt: '2026-09-21T10:00:00.000Z', id: 'week_willow' });
  assert(week.createdBy === 'Willow', 'createdBy = Willow');
  assert(week.createdByUserId === 'user_willow', 'createdByUserId');
  assert(week.createdByPlayerId === 'player_willow', 'createdByPlayerId');
  assert(Boolean(week.createdAt), 'createdAt présent');

  const state = Models.normalizeState({
    weeks: [week],
    currentWeekId: week.id,
    vsWeekAudit: [],
  });
  Models.pushVsWeekAudit(
    state,
    Models.buildVsWeekAuditEntry('create', week, willow, week.createdAt)
  );
  assert(state.vsWeekAudit.length === 1, '1 entrée audit create');
  assert(state.vsWeekAudit[0].action === 'create', 'action create');
  assert(state.vsWeekAudit[0].weekId === week.id, 'audit.weekId');
  assert(state.vsWeekAudit[0].actorLabel === 'Willow', 'audit.actorLabel Willow');
  assert(state.vsWeekAudit[0].at === week.createdAt, 'audit.at = createdAt');
}

console.log('\n=== Clôture par autre R4/R5 → création conservée + clôture enregistrée ===');
{
  const week = makeWeek(willow, { createdAt: '2026-09-21T10:00:00.000Z', id: 'week_w2' });
  week.closedAt = '2026-09-28T18:00:00.000Z';
  week.closedBy = raiden.actorLabel;
  week.closedByUserId = raiden.actorUserId;
  week.closedByPlayerId = raiden.actorPlayerId;

  const state = Models.normalizeState({
    weeks: [],
    currentWeekId: null,
    players: [
      {
        id: 'player_willow',
        pseudo: 'Willow',
        role: 'R5',
        status: 'Actif',
        absent: false,
      },
    ],
    vsWeekAudit: [
      Models.buildVsWeekAuditEntry('create', week, willow, week.createdAt),
    ],
  });
  // scores vides → archive sous-seuil peut être vide de joueurs, champs auteurs quand même
  week.scores = {
    player_willow: Models.createEmptyScore(),
  };
  Models.pushVsUnderWeekArchive(state, week);
  Models.pushVsWeekAudit(
    state,
    Models.buildVsWeekAuditEntry('close', week, raiden, week.closedAt)
  );

  const hist = state.vsUnderWeekHistory[0];
  assert(hist.createdBy === 'Willow', 'historique : createdBy conservé');
  assert(hist.closedBy === 'Raiden 05', 'historique : closedBy Raiden');
  assert(hist.createdByUserId === 'user_willow', 'historique createdByUserId');
  assert(hist.closedByUserId === 'user_raiden', 'historique closedByUserId');

  const createEvt = state.vsWeekAudit.find((e) => e.action === 'create');
  const closeEvt = state.vsWeekAudit.find((e) => e.action === 'close');
  assert(createEvt && createEvt.actorLabel === 'Willow', 'audit create Willow');
  assert(closeEvt && closeEvt.actorLabel === 'Raiden 05', 'audit close Raiden');
  assert(createEvt.weekId === closeEvt.weekId, 'même weekId create/close');
}

console.log('\n=== Protection auteurs mergeSameWeekContent ===');
{
  const remote = makeWeek(willow, { id: 'week_same', createdAt: '2026-09-21T10:00:00.000Z' });
  const local = {
    ...makeWeek(null, { id: 'week_same', createdAt: '2026-09-21T10:00:00.000Z' }),
    createdBy: '',
    createdByUserId: '',
    createdByPlayerId: null,
    scores: {
      p1: { days: { lundi: 12, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0 }, dayBrackets: {} },
    },
  };
  const merged = T.mergeVsWeekState(storeWithWeek(remote), storeWithWeek(local));
  assert(merged.weeks[0].createdBy === 'Willow', 'local sans auteur → remote conservé');
  assert(merged.weeks[0].scores.p1.days.lundi === 12, 'score local conservé');

  const remoteBare = {
    ...makeWeek(null, { id: 'week_same2', createdAt: '2026-09-21T10:00:00.000Z' }),
    createdBy: '',
    createdByUserId: '',
  };
  const localAuthor = makeWeek(willow, {
    id: 'week_same2',
    createdAt: '2026-09-21T10:00:00.000Z',
  });
  const merged2 = T.mergeVsWeekState(storeWithWeek(remoteBare), storeWithWeek(localAuthor));
  assert(merged2.weeks[0].createdBy === 'Willow', 'remote sans auteur → local conservé');
}

console.log('\n=== Fusion audits différents / pas de doublon / plafond 100 ===');
{
  const a = {
    id: 'vsaudit_a',
    action: 'create',
    weekId: 'w1',
    startDate: '2026-09-21',
    label: 'S1',
    at: '2026-09-21T10:00:00.000Z',
    actorUserId: 'u1',
    actorPlayerId: 'p1',
    actorLabel: 'Willow',
  };
  const b = {
    id: 'vsaudit_b',
    action: 'close',
    weekId: 'w1',
    startDate: '2026-09-21',
    label: 'S1',
    at: '2026-09-28T18:00:00.000Z',
    actorUserId: 'u2',
    actorPlayerId: 'p2',
    actorLabel: 'Raiden 05',
  };
  const merged = Models.mergeVsWeekAudits([a], [b]);
  assert(merged.length === 2, 'deux audits distincts conservés');
  assert(merged.some((e) => e.id === 'vsaudit_a') && merged.some((e) => e.id === 'vsaudit_b'), 'ids a+b');

  const dup = Models.mergeVsWeekAudits([a], [{ ...a, actorLabel: 'Willow' }]);
  assert(dup.length === 1, 'même id → pas de doublon');

  const many = [];
  for (let i = 0; i < 101; i += 1) {
    many.push({
      id: `vsaudit_${i}`,
      action: i % 2 === 0 ? 'create' : 'close',
      weekId: `week_${i}`,
      startDate: '2026-01-01',
      label: `S${i}`,
      at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
      actorUserId: '',
      actorPlayerId: null,
      actorLabel: 'X',
    });
  }
  // Guarantee chronological uniqueness for sort: use ISO with index
  many.forEach((e, i) => {
    e.at = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
  });
  const capped = Models.mergeVsWeekAudits(many.slice(0, 60), many.slice(40));
  assert(capped.length === 100, '101 uniques → 100 plus récentes');
  const newest = many[many.length - 1].id;
  const oldest = many[0].id;
  assert(capped.some((e) => e.id === newest), 'conserve la plus récente');
  assert(!capped.some((e) => e.id === oldest), 'évince la plus ancienne');
}

console.log('\n=== Anciennes semaines sans auteur → pas d’invention ===');
{
  const legacy = Models.normalizeState({
    weeks: [
      {
        id: 'week_legacy',
        startDate: '2026-09-14',
        endDate: '2026-09-18',
        createdAt: '2026-09-14T08:00:00.000Z',
        scores: {},
      },
    ],
    currentWeekId: 'week_legacy',
    vsUnderWeekHistory: [
      {
        weekId: 'week_old_hist',
        weekLabel: 'Semaine 10',
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        closedAt: '2026-09-13T12:00:00.000Z',
        players: [],
      },
    ],
  });
  assert(legacy.weeks[0].createdBy === '', 'semaine legacy : createdBy vide');
  assert(legacy.weeks[0].createdByUserId === '', 'semaine legacy : createdByUserId vide');
  assert(legacy.vsUnderWeekHistory[0].createdBy === '', 'hist legacy : createdBy vide');
  assert(legacy.vsUnderWeekHistory[0].closedBy === '', 'hist legacy : closedBy vide');
  assert(legacy.vsWeekAudit.length === 0, 'pas d’audit inventé');
}

console.log('\n=== Création → sync → clôture → sync (même weekId) ===');
{
  const week = makeWeek(willow, { createdAt: '2026-09-21T10:00:00.000Z', id: 'week_flow' });
  const createEntry = Models.buildVsWeekAuditEntry('create', week, willow, week.createdAt);

  // Device A crée et pousse
  let remote = T.mergeCommandCenterStore(storeWithWeek(null), storeWithWeek(week, [createEntry]));
  assert(remote.weeks[0].createdBy === 'Willow', 'après sync create : auteur');
  assert(remote.vsWeekAudit.some((e) => e.action === 'create'), 'après sync create : audit');

  // Device B (autre acteur) clôture
  const closing = {
    ...remote.weeks[0],
    closedAt: '2026-09-28T19:00:00.000Z',
    closedBy: raiden.actorLabel,
    closedByUserId: raiden.actorUserId,
    closedByPlayerId: raiden.actorPlayerId,
  };
  const closeEntry = Models.buildVsWeekAuditEntry('close', closing, raiden, closing.closedAt);
  const localClose = storeWithWeek(null, [...remote.vsWeekAudit, closeEntry], {
    closeIntent: { weekId: week.id, closedAt: closing.closedAt },
  });
  // Simuler archive + close côté local avant merge
  localClose.vsUnderWeekHistory = [];
  Models.pushVsUnderWeekArchive(localClose, closing);

  remote = T.mergeCommandCenterStore(remote, localClose);
  assert(remote.weeks.length === 0, 'après close sync : plus de semaine active');
  const createEvt = remote.vsWeekAudit.find((e) => e.action === 'create' && e.weekId === week.id);
  const closeEvt = remote.vsWeekAudit.find((e) => e.action === 'close' && e.weekId === week.id);
  assert(Boolean(createEvt), 'create reste après sync close');
  assert(Boolean(closeEvt), 'close présent après sync');
  assert(createEvt.actorLabel === 'Willow', 'create toujours Willow');
  assert(closeEvt.actorLabel === 'Raiden 05', 'close Raiden');
  assert(
    remote.vsUnderWeekHistory[0]?.createdBy === 'Willow' &&
      remote.vsUnderWeekHistory[0]?.closedBy === 'Raiden 05',
    'vsUnderWeekHistory enrichi create+close'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
