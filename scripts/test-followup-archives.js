/**
 * Archives de suivi — étape 1 (episodeId, snapshot, merge, historique hybride).
 * node scripts/test-followup-archives.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
const identityCode = fs.readFileSync(path.join(root, 'js/player-identity.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
const suiviCode = fs.readFileSync(path.join(root, 'js/suivi.js'), 'utf8');

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

const sandbox = {
  window: {},
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Boolean,
  Array,
  Object,
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
    addEventListener() {},
  },
  navigator: { onLine: true },
  ROSSupabase: {
    getClient: () => ({
      auth: { onAuthStateChange() {}, getSession: async () => ({ data: {} }) },
    }),
  },
  AppUI: { toast() {}, confirm: async () => false, switchTab() {} },
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(modelsCode, sandbox);
vm.runInContext(identityCode, sandbox);
vm.runInContext(syncCode, sandbox);
const M = sandbox.ROSModels;
const Id = sandbox.ROSPlayerIdentity;
const T = sandbox.ROSSync.__test;

let storedState = null;
const suiviSandbox = {
  window: {},
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Boolean,
  Array,
  Object,
  document: {
    getElementById(id) {
      if (id === 'historiqueSuiviBody') return suiviSandbox.__body;
      return null;
    },
    querySelector: () => null,
  },
  __body: { innerHTML: '' },
};
suiviSandbox.window = suiviSandbox;
suiviSandbox.ROSModels = M;
suiviSandbox.ROSStorage = {
  getState: () => storedState,
  update: (fn) => {
    storedState = fn(storedState) || storedState;
    return storedState;
  },
};
suiviSandbox.ROSProfiles = {
  isActiveR5: () => true,
  isActiveR4OrR5: () => true,
  listProfiles: () => [],
  getCurrentProfile: () => ({ role: 'R5', playerId: 'r5' }),
  stampActor: () => ({ actorUserId: 'u1', actorLabel: 'Willow', actorPlayerId: 'r5' }),
};
suiviSandbox.AppUI = { toast() {}, confirm: async () => true, switchTab() {} };
vm.runInNewContext(suiviCode, suiviSandbox);
const Suivi = suiviSandbox.SuiviModule;

function player(id, pseudo, extra = {}) {
  const p = M.createPlayer({ pseudo, status: 'Actif', ...extra });
  p.id = id;
  return p;
}

function blank() {
  const state = M.createBlankState();
  state.players = [];
  state.powerTiers = M.createDefaultPowerTiers();
  state.followUpSettings = M.normalizeFollowUpSettings({ heroMaxM: 30 });
  return state;
}

function lowHeroTierId() {
  const tier = M.createDefaultPowerTiers().find((t) => Number(t.max) <= 30);
  return tier ? tier.id : null;
}

function highHeroTierId() {
  const tier = M.createDefaultPowerTiers().find((t) => Number(t.max) > 30);
  return tier ? tier.id : null;
}

console.log('\n=== Episode ===');
{
  const state = blank();
  const p = player('p1', 'Madien');
  state.players = [p];
  const a = M.createPlayerFollowUpCase(state, 'p1', {
    reasons: { discret: true },
    status: 'to_contact',
  });
  assert(Boolean(a.episodeId && String(a.episodeId).startsWith('ep_')), 'nouvelle fiche → episodeId');
  const first = a.episodeId;
  M.appendPlayerFollowUpNote(state, 'p1', { text: 'note A', authorLabel: 'Willow' });
  M.appendPlayerFollowUpNote(state, 'p1', {
    eventType: 'help_opened',
    helpType: 'vs',
    authorLabel: 'Willow',
  });
  M.appendPlayerFollowUpNote(state, 'p1', {
    eventType: 'help_resolved',
    helpType: 'vs',
    authorLabel: 'Willow',
  });
  const notes = M.getPlayerFollowUpNotes(state, 'p1');
  assert(notes.every((n) => n.episodeId === first), 'commentaire et aides portent l’episodeId');
  assert(notes.some((n) => n.eventType === 'comment' && n.episodeId === first), 'commentaire → bon episodeId');
  assert(notes.some((n) => n.eventType === 'help_opened' && n.episodeId === first), 'help_opened → bon episodeId');
  assert(
    notes.some((n) => n.eventType === 'help_resolved' && n.episodeId === first),
    'help_resolved → bon episodeId'
  );

  state.playerFollowUps.p1.status = 'done';
  state.playerFollowUps.p1.closedAt = '2026-09-30T10:00:00.000Z';
  state.playerFollowUps.p1.closeReason = 'coaching_done';
  M.archivePlayerFollowUp(state, 'p1', { actorLabel: 'Willow', actorUserId: 'u1' });
  const b = M.createPlayerFollowUpCase(state, 'p1', { reasons: { manual: true }, manual: true });
  assert(b.episodeId && b.episodeId !== first, 'deux suivis successifs → deux episodeId');

  const legacy = M.normalizeFollowUpNote({
    id: 'old_note',
    at: '2026-01-01T00:00:00.000Z',
    text: 'avant les épisodes',
    authorLabel: 'Old',
  });
  assert(!legacy.episodeId, 'ancienne note sans episodeId reste sans episodeId');
  const legacyCase = M.normalizeFollowUpCase({
    status: 'done',
    reasons: { hero: true },
    createdAt: '2026-08-01T00:00:00.000Z',
    closedAt: '2026-08-02T00:00:00.000Z',
    closeReason: 'coaching_done',
  });
  assert(!legacyCase.episodeId, 'fiche legacy normalisée sans episodeId inventé');
  const normalized = M.normalizeState({
    players: [player('legacy_p', 'Legacy')],
    playerFollowUps: {
      legacy_p: {
        status: 'done',
        reasons: { discret: true },
        createdAt: '2026-08-01T00:00:00.000Z',
        closedAt: '2026-08-02T00:00:00.000Z',
        closeReason: 'no_reply',
      },
    },
    playerFollowUpNotes: {
      legacy_p: { notes: [legacy] },
    },
  });
  assert(!normalized.playerFollowUps.legacy_p.episodeId, 'normalizeState ne pose pas d’episodeId legacy');
  assert(
    normalized.playerFollowUps.legacy_p.status === 'done',
    'fiche legacy done non modifiée (statut)'
  );
  assert(
    Object.keys(normalized.playerFollowUpArchives).length === 0,
    'aucune archive créée pour une fiche legacy'
  );
  assert(
    normalized.playerFollowUpNotes.legacy_p.notes[0].text === 'avant les épisodes',
    'note legacy intacte'
  );
}

console.log('\n=== Isolation ===');
{
  const state = blank();
  state.players = [player('p1', 'Madien', { discret: true })];
  M.createPlayerFollowUpCase(state, 'p1', { reasons: { discret: true } });
  const epA = state.playerFollowUps.p1.episodeId;
  M.appendPlayerFollowUpNote(state, 'p1', { text: 'commentaire A', authorLabel: 'Willow' });
  M.appendPlayerFollowUpNote(state, 'p1', {
    eventType: 'help_opened',
    helpType: 'vs',
    authorLabel: 'Willow',
  });
  state.playerFollowUps.p1.status = 'done';
  state.playerFollowUps.p1.closedAt = '2026-09-01T00:00:00.000Z';
  state.playerFollowUps.p1.closeReason = 'coaching_done';
  state.playerFollowUps.p1.assigneePlayerId = 'r4a';
  state.playerFollowUps.p1.assigneeLabel = 'Mamat';
  const archive = M.archivePlayerFollowUp(state, 'p1', {
    actorLabel: 'Willow',
    actorUserId: 'u1',
  });
  M.createPlayerFollowUpCase(state, 'p1', { reasons: { manual: true }, manual: true });
  const epB = state.playerFollowUps.p1.episodeId;
  M.appendPlayerFollowUpNote(state, 'p1', { text: 'commentaire B', authorLabel: 'Natacha' });
  const scoped = M.getScopedPlayerFollowUpNotes(state, 'p1').map((n) => n.text);
  assert(scoped.includes('commentaire B') && !scoped.includes('commentaire A'), 'suivi B n’affiche pas les commentaires de A');
  assert(M.getPlayerFollowUpHelpNeeds(state, 'p1').vs === false, 'aide ouverte dans A n’est pas active dans B');
  assert(
    archive.notes.some((n) => n.text === 'commentaire A') &&
      !archive.notes.some((n) => n.text === 'commentaire B'),
    'commentaires de B n’apparaissent pas dans archive A'
  );
  assert(epA !== epB, 'B est un autre épisode');
}

console.log('\n=== Archive ===');
{
  const state = blank();
  const p = player('p1', 'Madien City');
  state.players = [p];
  M.createPlayerFollowUpCase(state, 'p1', {
    reasons: { discret: true },
    assigneePlayerId: 'r4a',
    assigneeLabel: 'Mamat',
    status: 'in_progress',
  });
  state.playerFollowUps.p1.createdAt = '2026-09-01T08:00:00.000Z';
  state.playerFollowUps.p1.contactedAt = '2026-09-02T08:00:00.000Z';
  state.playerFollowUps.p1.status = 'done';
  state.playerFollowUps.p1.closedAt = '2026-09-10T08:00:00.000Z';
  state.playerFollowUps.p1.closeReason = 'coaching_done';
  M.appendPlayerFollowUpNote(state, 'p1', {
    id: 'n1',
    text: 'texte figé',
    authorLabel: 'Willow',
    at: '2026-09-03T08:00:00.000Z',
  });
  const ep = state.playerFollowUps.p1.episodeId;
  const archive = M.archivePlayerFollowUp(state, 'p1', {
    actorLabel: 'Willow',
    actorUserId: 'u1',
  });
  assert(archive.id === `arch_${ep}`, 'arch_<episodeId>');
  assert(archive.playerId === 'p1', 'playerId');
  assert(archive.pseudo === 'Madien City', 'pseudo figé');
  assert(archive.reasons.discret === true, 'motifs');
  assert(archive.assigneePlayerId === 'r4a' && archive.assigneeLabel === 'Mamat', 'R4 figé');
  assert(archive.status === 'done', 'statut');
  assert(archive.createdAt && archive.contactedAt && archive.closedAt, 'dates');
  assert(archive.closeReason === 'coaching_done', 'raison de fin');
  assert(archive.helpNeeds && archive.helpNeeds.vs === false, 'état des aides à la clôture');
  assert(archive.notes.length === 1 && archive.notes[0].text === 'texte figé', 'notes copiées');
  assert(archive.archivedAt && archive.archivedByLabel === 'Willow', 'archivedAt + auteur');
  assert(!state.playerFollowUps.p1, 'slot libéré');
  assert(M.getPlayerFollowUpNotes(state, 'p1').length === 1, 'ledger non supprimé');

  p.pseudo = 'Autre Pseudo';
  M.updatePlayerFollowUpNote(state, 'p1', 'n1', {
    text: 'texte modifié après archive',
    actor: { actorLabel: 'Willow', actorUserId: 'u1' },
  });
  const still = state.playerFollowUpArchives[archive.id];
  assert(still.pseudo === 'Madien City', 'pseudo d’archive inchangé après renommage');
  assert(still.notes[0].text === 'texte figé', 'note d’archive inchangée après édition du journal');
  assert(still.assigneeLabel === 'Mamat', 'R4 d’archive inchangé');

  storedState = state;
  const rows = Suivi.getHistoriqueRows(storedState, {});
  const row = rows.find((r) => r.kind === 'archive');
  const html = Suivi.renderHistoriqueDetailHtml(row, storedState);
  assert(!html.includes('Réactiver'), 'pas de Réactiver dans le détail d’archive');
  assert(!html.includes('data-suivi-note-edit'), 'pas d’édition depuis le détail d’archive');
  assert(!html.includes('data-suivi-note-delete'), 'pas de suppression depuis le détail d’archive');
  assert(html.includes('texte figé'), 'détail affiche la copie');
  assert(html.includes('Madien City'), 'détail affiche le pseudo figé');
}

console.log('\n=== Nouveau suivi ===');
{
  const state = blank();
  state.players = [player('p1', 'Madien', { discret: true })];
  M.createPlayerFollowUpCase(state, 'p1', { reasons: { discret: true } });
  M.appendPlayerFollowUpNote(state, 'p1', {
    eventType: 'help_opened',
    helpType: 'troops',
    authorLabel: 'Willow',
  });
  M.appendPlayerFollowUpNote(state, 'p1', {
    eventType: 'help_resolved',
    helpType: 'troops',
    authorLabel: 'Willow',
  });
  M.appendPlayerFollowUpNote(state, 'p1', { text: 'seulement A', authorLabel: 'Willow' });
  state.playerFollowUps.p1.status = 'done';
  state.playerFollowUps.p1.closeReason = 'coaching_done';
  state.playerFollowUps.p1.closedAt = '2026-09-20T00:00:00.000Z';
  M.archivePlayerFollowUp(state, 'p1', { actorLabel: 'Willow' });
  assert(!state.playerFollowUps.p1, 'archive A → slot libéré');
  const next = M.createPlayerFollowUpCase(state, 'p1', {
    manual: true,
    reasons: { manual: true },
  });
  assert(next.episodeId && next.createdAt, 'création B → nouvel épisode et nouvelles dates');
  assert(M.getScopedPlayerFollowUpNotes(state, 'p1').length === 0, 'B démarre sans commentaire de A');
  assert(
    !M.getPlayerFollowUpHelpNeeds(state, 'p1').troops,
    'B démarre sans aide active de A'
  );
}

console.log('\n=== Anti-réouverture ===');
{
  const state = blank();
  const p = player('p1', 'Discret', { discret: true, heroPowerTierId: highHeroTierId() });
  state.players = [p];
  Suivi.syncAutoReasons(state);
  assert(state.playerFollowUps.p1 && state.playerFollowUps.p1.reasons.discret, 'fiche auto Discret');
  state.playerFollowUps.p1.status = 'done';
  state.playerFollowUps.p1.closeReason = 'coaching_done';
  state.playerFollowUps.p1.closedAt = '2026-09-21T00:00:00.000Z';
  M.archivePlayerFollowUp(state, 'p1', { actorLabel: 'Willow' });
  const changed = Suivi.syncAutoReasons(state);
  assert(!state.playerFollowUps.p1, 'joueur encore Discret après archive → pas de clone');
  assert(changed === false || !state.playerFollowUps.p1, 'sync ne recrée pas la fiche');

  M.createPlayerFollowUpCase(state, 'p1', {
    manual: true,
    reasons: { manual: true },
    status: 'to_contact',
    assigneePlayerId: 'r4a',
    assigneeLabel: 'Mamat',
  });
  assert(state.playerFollowUps.p1.episodeId, 'ajout manuel explicite crée un nouveau suivi');
  assert(state.playerFollowUps.p1.reasons.manual === true, 'le suivi manuel est bien manuel');

  delete state.playerFollowUps.p1;
  p.discret = false;
  Suivi.syncAutoReasons(state);
  assert(!state.playerFollowUpAutoSuppress.p1?.discret, 'verrou Discret levé quand le flag tombe');
  p.discret = true;
  Suivi.syncAutoReasons(state);
  assert(state.playerFollowUps.p1?.reasons?.discret === true, 'nouveau déclenchement Discret crée une fiche');
}

console.log('\n=== Anti-réouverture héros ===');
{
  const state = blank();
  const p = player('p_h', 'Hero', { heroPowerTierId: lowHeroTierId() });
  state.players = [p];
  Suivi.syncAutoReasons(state);
  assert(state.playerFollowUps.p_h?.reasons?.hero === true, 'fiche auto héros');
  state.playerFollowUps.p_h.status = 'done';
  state.playerFollowUps.p_h.closeReason = 'coaching_done';
  state.playerFollowUps.p_h.closedAt = '2026-09-22T00:00:00.000Z';
  M.archivePlayerFollowUp(state, 'p_h', { actorLabel: 'Willow' });
  Suivi.syncAutoReasons(state);
  assert(!state.playerFollowUps.p_h, 'héros encore sous le seuil → pas de clone');
  p.heroPowerTierId = highHeroTierId();
  Suivi.syncAutoReasons(state);
  assert(!state.playerFollowUpAutoSuppress.p_h?.hero, 'verrou héros levé hors tranche');
  assert(!state.playerFollowUps.p_h, 'hors tranche : pas de fiche');
  p.heroPowerTierId = lowHeroTierId();
  Suivi.syncAutoReasons(state);
  assert(state.playerFollowUps.p_h?.reasons?.hero === true, 'retour sous le seuil → nouveau suivi héros');
}

console.log('\n=== Multi-appareils ===');
{
  const noteA = {
    id: 'n_a',
    at: '2026-09-01T00:00:00.000Z',
    text: 'depuis A',
    authorLabel: 'A',
    eventType: 'comment',
    episodeId: 'ep_123',
  };
  const noteB = {
    id: 'n_b',
    at: '2026-09-02T00:00:00.000Z',
    text: 'depuis B',
    authorLabel: 'B',
    eventType: 'comment',
    episodeId: 'ep_123',
  };
  const archiveBase = {
    id: 'arch_ep_123',
    episodeId: 'ep_123',
    playerId: 'p1',
    pseudo: 'Madien',
    reasons: { discret: true },
    assigneePlayerId: 'r4',
    assigneeLabel: 'Mamat',
    status: 'done',
    createdAt: '2026-09-01T00:00:00.000Z',
    contactedAt: null,
    closedAt: '2026-09-03T00:00:00.000Z',
    closeReason: 'coaching_done',
    helpNeeds: { vs: false, troops: false, other: false },
    archivedByUserId: 'u1',
    archivedByLabel: 'Willow',
  };
  const remote = {
    players: [{ id: 'p1', pseudo: 'Madien', role: 'Membre', status: 'Actif' }],
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: {
      arch_ep_123: {
        ...archiveBase,
        archivedAt: '2026-09-03T12:00:00.000Z',
        notes: [noteA],
      },
    },
  };
  const localWithoutKey = {
    players: [{ id: 'p1', pseudo: 'Madien', role: 'Membre', status: 'Actif' }],
    playerFollowUps: {
      p1: {
        ...M.createEmptyFollowUpCase({
          episodeId: 'ep_123',
          status: 'done',
          reasons: { discret: true },
          closeReason: 'coaching_done',
        }),
        episodeId: 'ep_123',
      },
    },
    playerFollowUpNotes: {},
  };
  const kept = T.mergeCommandCenterStore(remote, localWithoutKey);
  assert(kept.playerFollowUpArchives.arch_ep_123, 'vieux cache sans clé archives ne supprime rien');
  assert(!kept.playerFollowUps.p1, 'fiche zombie ep_123 ne revient pas');

  const localEmptyArchives = {
    ...localWithoutKey,
    playerFollowUpArchives: {},
    playerFollowUps: {
      p1: {
        episodeId: 'ep_999',
        status: 'in_progress',
        reasons: { manual: true },
        manual: true,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        helpNeeds: {},
        notes: [],
      },
    },
  };
  const remoteNew = {
    ...remote,
    playerFollowUps: {
      p1: {
        episodeId: 'ep_123',
        status: 'done',
        reasons: { discret: true },
        closeReason: 'coaching_done',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
        helpNeeds: {},
        notes: [],
      },
    },
  };
  const noWipe = T.mergeCommandCenterStore(remoteNew, localEmptyArchives);
  assert(noWipe.playerFollowUpArchives.arch_ep_123, 'map archives locale vide ne supprime pas le distant');
  assert(noWipe.playerFollowUps.p1.episodeId === 'ep_999', 'fiche vivante locale non zombie conservée');

  const zombieLocal = {
    players: remote.players,
    playerFollowUps: {
      p1: {
        episodeId: 'ep_123',
        status: 'in_progress',
        reasons: { discret: true },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-04T00:00:00.000Z',
        helpNeeds: {},
        notes: [],
      },
    },
    playerFollowUpNotes: {},
    playerFollowUpArchives: {},
  };
  const remoteAfter = {
    players: remote.players,
    playerFollowUps: {
      p1: {
        episodeId: 'ep_777',
        status: 'to_contact',
        reasons: { manual: true },
        manual: true,
        createdAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        helpNeeds: {},
        notes: [],
      },
    },
    playerFollowUpNotes: {},
    playerFollowUpArchives: remote.playerFollowUpArchives,
  };
  const zombieMerge = T.mergeCommandCenterStore(remoteAfter, zombieLocal);
  assert(!zombieMerge.playerFollowUps.p1 || zombieMerge.playerFollowUps.p1.episodeId !== 'ep_123', 'zombie écarté');
  assert(
    zombieMerge.playerFollowUps.p1 && zombieMerge.playerFollowUps.p1.episodeId === 'ep_777',
    'épisode vivant distant conservé à la place du zombie'
  );

  const deviceB = {
    players: remote.players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: {
      arch_ep_123: {
        ...archiveBase,
        archivedAt: '2026-09-03T12:05:00.000Z',
        notes: [noteA, noteB],
      },
    },
  };
  const once = T.mergeCommandCenterStore(remote, deviceB);
  const ids = Object.keys(once.playerFollowUpArchives);
  assert(ids.length === 1 && ids[0] === 'arch_ep_123', 'deux appareils, un seul arch_<episodeId>');
  assert(
    JSON.stringify(once.playerFollowUpArchives.arch_ep_123) ===
      JSON.stringify(remote.playerFollowUpArchives.arch_ep_123),
    'archive distante inchangée : la note locale supplémentaire est refusée'
  );
  const again = T.mergeCommandCenterStore(once, deviceB);
  assert(
    JSON.stringify(again.playerFollowUpArchives.arch_ep_123) ===
      JSON.stringify(remote.playerFollowUpArchives.arch_ep_123),
    'second rapprochement strictement identique'
  );
}

console.log('\n=== Immutabilité stricte des archives distantes ===');
{
  function same(actual, expected, msg) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), msg);
  }
  const remoteArchive = {
    id: 'arch_ep_A',
    episodeId: 'ep_A',
    playerId: 'p1',
    pseudo: 'Madien City',
    reasons: { vs: false, hero: false, praise: false, discret: true, manual: false },
    manual: false,
    assigneePlayerId: 'r4_mamat',
    assigneeLabel: 'Mamat',
    status: 'done',
    createdAt: '2026-09-01T08:00:00.000Z',
    contactedAt: '2026-09-02T08:00:00.000Z',
    closedAt: '2026-09-10T08:00:00.000Z',
    closeReason: 'coaching_done',
    helpNeeds: { vs: false, troops: true, other: false },
    notes: [
      {
        id: 'n1',
        at: '2026-09-03T08:00:00.000Z',
        text: 'texte distant',
        authorLabel: 'Willow',
        authorUserId: 'u1',
        eventType: 'comment',
        episodeId: 'ep_A',
      },
      {
        id: 'n2',
        at: '2026-09-04T08:00:00.000Z',
        text: 'aide troupes distante',
        authorLabel: 'Willow',
        eventType: 'help_opened',
        helpType: 'troops',
        episodeId: 'ep_A',
      },
    ],
    archivedAt: '2026-09-10T12:00:00.000Z',
    archivedByUserId: 'u1',
    archivedByLabel: 'Willow',
  };
  const players = [{ id: 'p1', pseudo: 'Madien City', role: 'Membre', status: 'Actif' }];
  const remote = {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: remoteArchive },
  };

  const unknown = T.mergeCommandCenterStore(remote, {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
  });
  same(
    unknown.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '1. distant possède A, local ne la connaît pas → A conservée'
  );

  const incomplete = {
    ...remoteArchive,
    notes: [remoteArchive.notes[0]],
    helpNeeds: { vs: false, troops: false, other: false },
  };
  const mergedIncomplete = T.mergeCommandCenterStore(remote, {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: incomplete },
  });
  same(
    mergedIncomplete.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '2. local A incomplète → distant strictement inchangée'
  );

  const extraNote = {
    ...remoteArchive,
    notes: [
      ...remoteArchive.notes,
      {
        id: 'n_extra',
        at: '2026-09-05T08:00:00.000Z',
        text: 'note locale en trop',
        authorLabel: 'Cache',
        eventType: 'comment',
        episodeId: 'ep_A',
      },
    ],
  };
  const mergedExtra = T.mergeCommandCenterStore(remote, {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: extraNote },
  });
  same(
    mergedExtra.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '3. note supplémentaire locale refusée'
  );
  assert(
    Object.keys(mergedExtra.playerFollowUpArchives).length === 1 &&
      Object.keys(mergedExtra.playerFollowUpArchives)[0] === 'arch_ep_A',
    '8. même episodeId → un seul arch_<episodeId>'
  );
  same(mergedExtra.playerFollowUpArchives.arch_ep_A, remoteArchive, '8b. cette archive unique reste la version distante');

  const older = { ...remoteArchive, archivedAt: '2026-01-01T00:00:00.000Z', archivedByLabel: 'Ancien' };
  const mergedOlder = T.mergeCommandCenterStore(remote, {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: older },
  });
  same(
    mergedOlder.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '4. archivedAt local plus ancien → distant inchangée'
  );

  const differentFields = {
    ...remoteArchive,
    pseudo: 'Autre',
    reasons: { vs: true, hero: true, praise: false, discret: false, manual: true },
    assigneePlayerId: 'r4_autre',
    assigneeLabel: 'AutreR4',
    createdAt: '2020-01-01T00:00:00.000Z',
    contactedAt: '2020-01-02T00:00:00.000Z',
    closedAt: '2020-01-03T00:00:00.000Z',
    closeReason: 'no_reply',
    helpNeeds: { vs: true, troops: false, other: true },
    archivedByUserId: 'u9',
    archivedByLabel: 'Intrus',
  };
  const mergedFields = T.mergeCommandCenterStore(remote, {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: differentFields },
  });
  same(
    mergedFields.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '5. pseudo, motifs, R4, dates, raison, helpNeeds, auteur → distant inchangée'
  );

  const otherText = {
    ...remoteArchive,
    notes: remoteArchive.notes.map((n) =>
      n.id === 'n1' ? { ...n, text: 'texte local différent' } : n
    ),
  };
  const mergedText = T.mergeCommandCenterStore(remote, {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: otherText },
  });
  same(
    mergedText.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '6. texte local d’une note commune refusé'
  );

  const archiveB = {
    id: 'arch_ep_B',
    episodeId: 'ep_B',
    playerId: 'p1',
    pseudo: 'Madien City',
    reasons: { manual: true, hero: false, discret: false, vs: false, praise: false },
    assigneePlayerId: 'r4_mamat',
    assigneeLabel: 'Mamat',
    status: 'done',
    createdAt: '2026-10-01T00:00:00.000Z',
    contactedAt: null,
    closedAt: '2026-10-02T00:00:00.000Z',
    closeReason: 'coaching_done',
    helpNeeds: { vs: false, troops: false, other: false },
    notes: [
      {
        id: 'nb',
        at: '2026-10-01T12:00:00.000Z',
        text: 'archive nouvelle',
        authorLabel: 'Willow',
        eventType: 'comment',
        episodeId: 'ep_B',
      },
    ],
    archivedAt: '2026-10-02T12:00:00.000Z',
    archivedByUserId: 'u1',
    archivedByLabel: 'Willow',
  };
  const mergedNew = T.mergeCommandCenterStore(remote, {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_B: archiveB },
  });
  same(mergedNew.playerFollowUpArchives.arch_ep_A, remoteArchive, '7. A distante reste identique');
  same(mergedNew.playerFollowUpArchives.arch_ep_B, archiveB, '7. archive B absente du distant est ajoutée');
  assert(
    Object.keys(mergedNew.playerFollowUpArchives).sort().join(',') === 'arch_ep_A,arch_ep_B',
    '7c. A et B coexistent, chacune sous son archiveId'
  );

  const stale = {
    players,
    playerFollowUps: {},
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: extraNote, arch_ep_B: archiveB },
  };
  const first = T.mergeCommandCenterStore(remote, stale);
  const second = T.mergeCommandCenterStore(first, stale);
  same(
    second.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '9. second merge avec le vieux cache : A strictement identique'
  );
  same(
    second.playerFollowUpArchives.arch_ep_B,
    archiveB,
    '9. second merge : B déjà adoptée reste identique'
  );

  const remoteWithB = {
    players,
    playerFollowUps: {
      p1: {
        episodeId: 'ep_live',
        status: 'in_progress',
        reasons: { manual: true },
        manual: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        helpNeeds: { vs: false, troops: false, other: false },
        notes: [],
        assigneePlayerId: 'r4_mamat',
        assigneeLabel: 'Mamat',
      },
    },
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: remoteArchive },
  };
  const oldCacheWithA = {
    players,
    playerFollowUps: {
      p1: {
        episodeId: 'ep_A',
        status: 'done',
        reasons: { discret: true },
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-10T08:00:00.000Z',
        closedAt: '2026-09-10T08:00:00.000Z',
        closeReason: 'coaching_done',
        helpNeeds: {},
        notes: [],
      },
    },
    playerFollowUpNotes: {},
    playerFollowUpArchives: { arch_ep_A: incomplete },
  };
  const zombieAndLive = T.mergeCommandCenterStore(remoteWithB, oldCacheWithA);
  same(
    zombieAndLive.playerFollowUpArchives.arch_ep_A,
    remoteArchive,
    '10. archive A inchangée face au vieux cache'
  );
  assert(
    zombieAndLive.playerFollowUps.p1 && zombieAndLive.playerFollowUps.p1.episodeId === 'ep_live',
    '10. archive A + suivi vivant + vieux cache fiche A → le suivi vivant reste actif'
  );
}

console.log('\n=== Historique hybride ===');
{
  const state = blank();
  const legacyP = player('p_legacy', 'Ancien');
  const arcP = player('p_arc', 'Madien City', { discret: true });
  arcP.discretContacts = M.normalizeDiscretContacts([
    { id: 'dc1', at: '2026-08-01T00:00:00.000Z', text: 'Contact pris', authorLabel: 'Willow' },
  ]);
  state.players = [legacyP, arcP];
  state.playerFollowUps.p_legacy = M.createEmptyFollowUpCase({
    status: 'done',
    reasons: { hero: true },
    closeReason: 'coaching_done',
    createdAt: '2026-07-01T00:00:00.000Z',
    closedAt: '2026-07-02T00:00:00.000Z',
  });
  M.createPlayerFollowUpCase(state, 'p_arc', {
    reasons: { discret: true },
    assigneeLabel: 'Mamat',
    assigneePlayerId: 'r4',
  });
  M.appendPlayerFollowUpNote(state, 'p_arc', {
    text: 'archive seulement',
    authorLabel: 'Willow',
    eventType: 'comment',
  });
  M.appendPlayerFollowUpNote(state, 'p_arc', {
    eventType: 'help_opened',
    helpType: 'vs',
    authorLabel: 'Willow',
  });
  state.playerFollowUps.p_arc.status = 'done';
  state.playerFollowUps.p_arc.closeReason = 'not_interested';
  state.playerFollowUps.p_arc.closedAt = '2026-09-15T00:00:00.000Z';
  const archive = M.archivePlayerFollowUp(state, 'p_arc', { actorLabel: 'Willow', actorUserId: 'u1' });
  storedState = state;
  const all = Suivi.getHistoriqueRows(storedState, {});
  assert(all.some((r) => r.kind === 'archive' && r.archive.id === archive.id), 'archive affichée');
  assert(all.some((r) => r.kind === 'follow' && r.player.id === 'p_legacy'), 'ancienne fiche done toujours présente');
  assert(
    all.some((r) => r.kind === 'discret_contact' && r.player.id === 'p_arc'),
    'discretContacts toujours présents'
  );
  assert(
    Suivi.getHistoriqueRows(storedState, { q: 'madien' }).some((r) => r.kind === 'archive'),
    'filtre pseudo sur archive'
  );
  assert(
    Suivi.getHistoriqueRows(storedState, { reasonFilter: 'discret' }).some((r) => r.kind === 'archive'),
    'filtre motif sur archive'
  );
  assert(
    Suivi.getHistoriqueRows(storedState, { helpFilter: 'vs' }).some((r) => r.kind === 'archive') &&
      !Suivi.getHistoriqueRows(storedState, { helpFilter: 'troops' }).some((r) => r.kind === 'archive'),
    'filtre demande d’aide sur archive'
  );
  const key = Suivi.historyRowKey(all.find((r) => r.kind === 'archive'));
  Suivi.openHistoriqueDetail(key);
  const opened = Suivi.findHistoriqueRowByKey(storedState, key);
  const html = Suivi.renderHistoriqueDetailHtml(opened, storedState);
  assert(html.includes('archive seulement'), 'clic ouvre le snapshot (commentaire)');
  assert(html.includes('Ouverture aide') || html.includes('Ouverte'), 'clic ouvre les événements d’aide');
  assert(html.includes("N'est pas intéressé") || html.includes('pas intéressé'), 'raison de fin du snapshot');
  assert(!html.includes('data-historique-reactivate'), 'pas de bouton Réactiver sur archive');
  Suivi.renderHistory();
  assert(
    !suiviSandbox.__body.innerHTML.includes('data-historique-reactivate="p_arc"'),
    'la ligne d’archive n’a pas Réactiver'
  );
  assert(
    suiviSandbox.__body.innerHTML.includes('data-historique-reactivate="p_legacy"'),
    'la fiche done legacy garde Réactiver'
  );
}

console.log('\n=== Effacer l’historique ne touche pas aux archives ===');
{
  const state = blank();
  state.players = [player('p_legacy', 'Ancien', { discret: true })];
  state.players[0].discretContacts = M.normalizeDiscretContacts([
    { id: 'dc', at: '2026-08-01T00:00:00.000Z', text: 'Contact', authorLabel: 'W' },
  ]);
  state.playerFollowUps.p_legacy = M.createEmptyFollowUpCase({
    status: 'done',
    reasons: { hero: true },
    closeReason: 'coaching_done',
  });
  state.playerFollowUpArchives = {
    arch_ep_keep: M.normalizeFollowUpArchive({
      episodeId: 'ep_keep',
      playerId: 'p_legacy',
      pseudo: 'Ancien Figé',
      reasons: { manual: true },
      status: 'done',
      closeReason: 'coaching_done',
      notes: [
        {
          id: 'kept',
          at: '2026-09-01T00:00:00.000Z',
          text: 'dans l’archive',
          authorLabel: 'Willow',
          eventType: 'comment',
          episodeId: 'ep_keep',
        },
      ],
      archivedAt: '2026-09-02T00:00:00.000Z',
      archivedByLabel: 'Willow',
    }),
  };
  Suivi.clearDoneFollowUpHistoryState(state);
  assert(state.playerFollowUpArchives.arch_ep_keep, 'archive toujours là');
  assert(state.playerFollowUpArchives.arch_ep_keep.notes[0].text === 'dans l’archive', 'contenu d’archive intact');
  assert(state.playerFollowUpArchives.arch_ep_keep.pseudo === 'Ancien Figé', 'pseudo figé intact');
  assert(!state.playerFollowUps.p_legacy, 'fiche done legacy toujours effaçable');
  assert(state.players[0].discretContacts.length === 0, 'discretContacts : comportement d’effacement inchangé');
}

console.log('\n=== Identité ===');
{
  const state = blank();
  const p = player('p_real', 'Madien City');
  state.players = [p];
  state.playerFollowUpArchives = {
    arch_ep_id: {
      id: 'arch_ep_id',
      episodeId: 'ep_id',
      playerId: 'Madien City',
      pseudo: 'Pseudo Au Moment',
      assigneePlayerId: 'Mamat',
      assigneeLabel: 'Mamat Label',
      reasons: { discret: true },
      status: 'done',
      closeReason: 'coaching_done',
      notes: [],
      helpNeeds: { vs: false, troops: false, other: false },
      archivedAt: '2026-09-01T00:00:00.000Z',
    },
  };
  state.players.push(player('r4_real', 'Mamat'));
  Id.migrateMainState(state);
  const archive = state.playerFollowUpArchives.arch_ep_id;
  assert(archive.playerId === 'p_real', 'playerId d’archive rattaché à l’id interne');
  assert(archive.assigneePlayerId === 'r4_real', 'assigneePlayerId rattaché sans changer le libellé');
  assert(archive.pseudo === 'Pseudo Au Moment', 'pseudo figé non réécrit');
  assert(archive.assigneeLabel === 'Mamat Label', 'label R4 figé non réécrit');
  p.pseudo = 'Nouveau Nom';
  Id.migrateMainState(state, { explicitPseudo: 'Madien City', explicitPlayerId: 'p_real' });
  assert(state.playerFollowUpArchives.arch_ep_id.pseudo === 'Pseudo Au Moment', 'renommage live ne réécrit pas le pseudo d’archive');
  assert(state.playerFollowUpArchives.arch_ep_id.playerId === 'p_real', 'archive toujours consultable après renommage');
}

console.log('\n=== Pas d’archivage d’une fiche ouverte ou legacy ===');
{
  const state = blank();
  state.players = [player('p1', 'X')];
  M.createPlayerFollowUpCase(state, 'p1', { manual: true, reasons: { manual: true } });
  assert(M.archivePlayerFollowUp(state, 'p1', { actorLabel: 'W' }) === null, 'fiche non terminée non archivée');
  assert(state.playerFollowUps.p1, 'slot conservé');
  const legacyState = blank();
  legacyState.players = [player('pL', 'L')];
  legacyState.playerFollowUps.pL = M.createEmptyFollowUpCase({
    status: 'done',
    closeReason: 'coaching_done',
    reasons: { hero: true },
  });
  assert(M.archivePlayerFollowUp(legacyState, 'pL', {}) === null, 'fiche legacy done non archivée et sans episodeId inventé');
  assert(legacyState.playerFollowUps.pL.status === 'done', 'statut legacy inchangé');
  assert(Object.keys(legacyState.playerFollowUpArchives).length === 0, 'pas d’archive legacy');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
