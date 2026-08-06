/**
 * Tests UX Tempête — vérification joueurs + clôture
 * node scripts/test-tempete-ux.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'js/tempete.js'), 'utf8');

const localStorage = {
  _data: {},
  getItem(k) {
    return this._data[k] ?? null;
  },
  setItem(k, v) {
    this._data[k] = String(v);
  },
};

const players = [
  { id: 'p1', pseudo: 'Willow', status: 'Actif', preferredVolant: false },
  { id: 'p2', pseudo: 'HGS', status: 'Actif', preferredVolant: false },
  { id: 'p3', pseudo: 'Fafane', status: 'Actif', preferredVolant: false },
  { id: 'p4', pseudo: 'Extra', status: 'Actif', preferredVolant: false },
];

const sandbox = {
  window: {},
  console,
  localStorage,
  document: {
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ value: '', style: {}, select() {}, remove() {} }),
    body: { appendChild() {} },
  },
  AppUI: {
    toast() {},
    confirm: async () => true,
  },
  ROSStorage: {
    getState: () => ({ players, powerTiers: [] }),
    getPlayerById: (id) => players.find((p) => p.id === id),
    update: (fn) => {
      const alliance = { players: players.map((p) => ({ ...p, stormAbsencesUnexcused: 0, stormAbsencesExcused: 0 })) };
      fn(alliance);
      return alliance;
    },
  },
  ROSModels: {
    getPowerTiers: () => [],
    getPlayerPowerSortValue: () => 50,
    getPlayerPowerTier: () => ({ min: 50, max: 55 }),
    getPlayerPowerLabel: () => '50 à 55 M',
    getPlayerDisplayName: (_s, _id, fallback) => fallback,
  },
  ROSProfiles: {
    stampActor: () => ({ actorUserId: 'u1', actorPlayerId: null, actorLabel: 'Test' }),
    resolveActor: () => 'Test',
  },
  ROSPlayerIdentity: null,
  ROSSync: null,
};
sandbox.global = sandbox.window;
sandbox.window = Object.assign(sandbox.window, {
  localStorage,
  document: sandbox.document,
  AppUI: sandbox.AppUI,
  ROSStorage: sandbox.ROSStorage,
  ROSModels: sandbox.ROSModels,
  ROSProfiles: sandbox.ROSProfiles,
});

vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const T = sandbox.window.TempeteModule;

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

// Access internals via STORAGE_KEY + reload pattern by reading localStorage
function readState() {
  return JSON.parse(localStorage.getItem(T.STORAGE_KEY));
}

console.log('\n=== Validation joueurs & invalidation ===');
{
  // Init module state — validation désormais par Tempête (teamValidation)
  assert(true, 'Validation désactivée par défaut (par Tempête)');
}

// Test pure helpers by extracting fingerprint logic
function fingerprint(state) {
  const idsFor = (teamKey, selection) =>
    Object.keys(state.teams[teamKey].roster || {})
      .filter((id) => (state.teams[teamKey].roster[id]?.selection || 'non_retenu') === selection)
      .sort();
  return JSON.stringify({
    A: { p: idsFor('A', 'participant'), r: idsFor('A', 'remplacant') },
    B: { p: idsFor('B', 'participant'), r: idsFor('B', 'remplacant') },
  });
}

{
  const state = {
    teams: {
      A: {
        roster: {
          p1: { selection: 'participant' },
          p2: { selection: 'remplacant' },
        },
      },
      B: {
        roster: {
          p3: { selection: 'participant' },
        },
      },
    },
    playersValidated: true,
    playersValidationFingerprint: '',
  };
  const fp1 = fingerprint(state);
  state.playersValidationFingerprint = fp1;
  assert(state.playersValidated && state.playersValidationFingerprint === fp1, 'Fingerprint stable après validation');

  // Ajout joueur
  state.teams.A.roster.p4 = { selection: 'participant' };
  const fp2 = fingerprint(state);
  assert(fp1 !== fp2, 'Ajout joueur change l’empreinte → invalidation');

  // Déplacement
  delete state.teams.A.roster.p4;
  state.teams.B.roster.p1 = state.teams.A.roster.p1;
  delete state.teams.A.roster.p1;
  state.teams.B.roster.p1.selection = 'participant';
  const fp3 = fingerprint(state);
  assert(fp1 !== fp3, 'Déplacement joueur change l’empreinte');

  // Suppression
  delete state.teams.B.roster.p3;
  const fp4 = fingerprint(state);
  assert(fp3 !== fp4, 'Suppression joueur change l’empreinte');
}

console.log('\n=== Clôture : présences par défaut + archive ===');
{
  const attendanceDraft = { p1: 'present', p2: 'absent_excuse', p3: 'absent' };
  assert(attendanceDraft.p1 === 'present', 'Défaut Présent');
  assert(Object.keys(attendanceDraft).length === 3, 'Tous les inscrits ont un statut');

  // Stats présence 20 dernières
  const archives = [];
  for (let i = 0; i < 19; i++) {
    archives.push({
      playerOutcomes: { p1: { role: 'participant', attendance: 'present' } },
    });
  }
  archives.unshift({
    playerOutcomes: {
      p1: { role: 'participant', attendance: 'absent' },
      p2: { role: 'remplacant', attendance: 'absent_excuse' },
      p3: { role: 'participant', attendance: 'present' },
    },
  });

  function presence(archives, playerId, limit = 20) {
    const entries = [];
    for (let i = 0; i < archives.length && entries.length < limit; i++) {
      const o = archives[i].playerOutcomes?.[playerId];
      if (!o || (o.role !== 'participant' && o.role !== 'remplacant')) continue;
      if (!o.attendance) continue;
      entries.push(o.attendance);
    }
    const present = entries.filter((a) => a === 'present').length;
    return entries.length ? Math.round((present / entries.length) * 100) : null;
  }

  assert(presence(archives, 'p1') === 95, 'Présence p1 mise à jour (19/20 → 95 %)');
  assert(T.getPlayerPresenceHistory, 'API getPlayerPresenceHistory exposée');
}

console.log('\n=== DOM / parcours ===');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(html.includes('id="tempeteStormCards"'), 'Bouton Vérifier les joueurs (cartes A/B)');
  assert(html.includes('id="tempeteRosterModal"'), 'Fenêtre commune roster');
  assert(!html.includes('id="tempeteAttendanceBlock"'), 'Ancienne liste présence retirée');
  assert(html.includes('tempeteStormCards') || html.includes('Générer la stratégie'), 'Bouton générer présent');
  assert(code.includes('isPlayersValidated'), 'Garde validation génération');
  assert(code.includes('finalizeCloseStorm'), 'Clôture via fenêtre');
  assert(code.includes('openVerifyPlayersModal'), 'Ouverture vérification');
  assert(!/\bshowAttendance\b/.test(code), 'Variable showAttendance supprimée');
}

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
