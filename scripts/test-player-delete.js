/**
 * Suppression définitive d'une fiche créée par erreur.
 * PGlite local uniquement : n'écrit pas dans Supabase.
 * node scripts/test-player-delete.js
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

function controlOf(count) {
  const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
  grid[4][4] = 'MARSHAL';
  let placed = 0;
  for (let row = 0; row < 10 && placed < count; row += 1) {
    for (let col = 0; col < 10 && placed < count; col += 1) {
      if (row === 4 && col === 4) continue;
      grid[row][col] = `p${placed}`;
      placed += 1;
    }
  }
  return { grid, bottomId: null, statusByPlayerId: {} };
}

const R5 = '11111111-1111-4111-8111-111111111111';
const R4 = '33333333-3333-4333-8333-333333333333';
const AT = '2026-10-07T10:00:00.000Z';

function player(id, pseudo, status, at) {
  return {
    id,
    pseudo,
    role: 'Membre',
    status,
    leftAt: status === 'Parti' ? at || AT : null,
    ...(at ? { statusChangedAt: at } : {}),
  };
}

function idsOf(center) {
  return (center.players || []).map((item) => item.id);
}

function runVm(filename, sandbox) {
  const code = fs.readFileSync(path.join(root, filename), 'utf8');
  vm.runInContext(code, sandbox);
  return code;
}

function clientTests() {
  console.log('\n=== Client : intention explicite, sans suppression implicite ===');
  const syncSandbox = {
    window: {},
    console,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    navigator: { onLine: true },
    location: { hostname: 'localhost' },
    AppUI: { toast() {}, confirm: async () => false },
  };
  syncSandbox.window = syncSandbox;
  syncSandbox.global = syncSandbox;
  vm.createContext(syncSandbox);
  runVm('js/supabase-sync.js', syncSandbox);
  const merge = syncSandbox.ROSSync.__test.mergeCommandCenterStore;

  const remote = {
    players: [player('mistake', 'Fiche Erreur', 'Actif'), player('keep', 'Gardé', 'Actif', AT)],
    weeks: [{ id: 'w1', scores: { mistake: { days: { lundi: 5 } }, keep: { days: { lundi: 10 } } } }],
    playerFollowUps: { mistake: { note: 'suivi' }, keep: { open: true } },
  };
  const localDelete = {
    players: [player('keep', 'Gardé', 'Actif', AT)],
    weeks: remote.weeks,
    playerFollowUps: remote.playerFollowUps,
    deletedPlayers: { mistake: { at: AT, pseudo: 'Fiche Erreur' } },
    playerDeleteIntent: { action: 'delete', playerId: 'mistake', pseudo: 'Fiche Erreur', at: AT },
  };
  const mergedDelete = merge(remote, localDelete);
  assert(!idsOf(mergedDelete).includes('mistake'), 'la fusion n’envoie pas la fiche visée par l’intention');
  assert(idsOf(mergedDelete).includes('keep'), 'la fusion conserve les autres joueurs');
  assert(mergedDelete.playerDeleteIntent.playerId === 'mistake', 'l’intention explicite reste dans l’envoi');
  assert(mergedDelete.weeks[0].scores.mistake.days.lundi === 5, 'la fusion conserve le score VS de la fiche');
  assert(mergedDelete.playerFollowUps.mistake.note === 'suivi', 'la fusion conserve le suivi de la fiche');

  const silent = merge(remote, {
    players: [player('keep', 'Gardé', 'Actif', AT)],
    weeks: remote.weeks,
  });
  assert(idsOf(silent).includes('mistake'), 'sans intention, un cache incomplet ne retire pas le joueur distant');

  const tombstone = merge(
    {
      ...remote,
      players: [player('keep', 'Gardé', 'Actif', AT)],
      deletedPlayers: { mistake: { at: AT, pseudo: 'Fiche Erreur', byUserId: R5 } },
    },
    { players: remote.players, weeks: remote.weeks }
  );
  assert(!idsOf(tombstone).includes('mistake'), 'un ancien cache ne réintroduit pas un joueur déjà supprimé');
  assert(tombstone.deletedPlayers.mistake.pseudo === 'Fiche Erreur', 'le tombeau serveur est conservé');
  assert(!tombstone.playerDeleteIntent, 'le tombeau ne recrée pas une intention');

  console.log('\n=== Normalisation : historique conservé ===');
  const modelSandbox = { window: {}, console, document: { getElementById: () => null } };
  modelSandbox.window = modelSandbox;
  modelSandbox.global = modelSandbox;
  vm.createContext(modelSandbox);
  runVm('js/models.js', modelSandbox);
  const normalized = modelSandbox.ROSModels.normalizeState({
    players: [player('mistake', 'Fiche Erreur', 'Actif'), player('keep', 'Gardé', 'Actif', AT)],
    weeks: remote.weeks,
    playerFollowUps: remote.playerFollowUps,
    deletedPlayers: { mistake: { at: AT, pseudo: 'Fiche Erreur' } },
    playerDeleteIntent: { action: 'delete', playerId: 'mistake', pseudo: 'Fiche Erreur', at: AT },
  });
  assert(!idsOf(normalized).includes('mistake'), 'normalizeState retire la fiche supprimée de la liste');
  assert(idsOf(normalized).includes('keep'), 'normalizeState conserve les autres fiches');
  assert(normalized.deletedPlayers.mistake.pseudo === 'Fiche Erreur', 'normalizeState conserve le tombeau');
  assert(normalized.playerDeleteIntent.action === 'delete', 'normalizeState conserve l’intention');
  assert(Boolean(normalized.weeks[0] && normalized.weeks[0].scores.mistake), 'normalizeState ne purge pas le score VS');
  assert(Boolean(normalized.playerFollowUps.mistake), 'normalizeState ne purge pas le suivi');

  console.log('\n=== Fiche joueur : R5, confirmation, R4 ===');
  const elements = {};
  function stub() {
    return {
      hidden: false,
      value: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute() {},
      addEventListener() {},
      querySelectorAll() { return []; },
    };
  }
  let role = 'R5';
  let confirmResult = false;
  let confirms = [];
  let updates = 0;
  const state = {
    players: [player('mistake', 'Fiche Erreur', 'Actif'), player('keep', 'Gardé', 'Actif', AT)],
    weeks: remote.weeks,
    playerFollowUps: JSON.parse(JSON.stringify(remote.playerFollowUps)),
  };
  const uiSandbox = {
    window: {},
    console,
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = stub();
        return elements[id];
      },
      addEventListener() {},
    },
    AppUI: {
      toast() {},
      confirm: async (opts) => {
        confirms.push(opts);
        return confirmResult;
      },
    },
    ROSProfiles: { isActiveR5: () => role === 'R5' },
    ROSStorage: {
      getPlayerById: (id) => state.players.find((item) => item.id === id),
      getState: () => state,
      update(fn) {
        updates += 1;
        fn(state);
      },
    },
    ROSModels: {
      getPowerTiers: () => [],
      getCurrentWeekFromState: () => null,
      getWeekScoreSummary: () => ({ hasRecord: false, colorLabel: '' }),
      getPlayerPowerLabel: () => '',
    },
    ROSUI: { escapeHtml: (value) => String(value ?? '') },
  };
  uiSandbox.window = uiSandbox;
  uiSandbox.global = uiSandbox;
  vm.createContext(uiSandbox);
  const playersSource = runVm('js/players.js', uiSandbox);
  uiSandbox.PlayersModule.init();
  uiSandbox.PlayersModule.openDetail('mistake');
  assert(
    elements.playerDetailBody.innerHTML.includes('btn-erase') &&
      elements.playerDetailBody.innerHTML.includes('Supprimer définitivement'),
    'le R5 voit Supprimer définitivement'
  );
  assert(!elements.playerDetailBody.innerHTML.includes('btn-danger'), 'le bouton n’utilise pas le style Passer en Parti');
  role = 'R4';
  uiSandbox.PlayersModule.openDetail('mistake');
  assert(!elements.playerDetailBody.innerHTML.includes('Supprimer définitivement'), 'le R4 ne voit pas le bouton');
  role = 'R5';

  updates = 0;
  confirms = [];
  confirmResult = false;
  return uiSandbox.PlayersModule.deletePlayerPermanently('mistake').then(() => {
    assert(confirms.length === 1, 'l’annulation passe par la confirmation');
    assert(
      confirms[0].message ===
        'Supprimer définitivement Fiche Erreur ? Cette action est réservée aux fiches créées par erreur et ne peut pas être annulée.',
      'le texte de confirmation est explicite'
    );
    assert(confirms[0].confirmLabel === 'Confirmer' && confirms[0].cancelLabel === 'Annuler', 'les libellés sont Confirmer et Annuler');
    assert(updates === 0, 'annuler ne modifie rien');
    assert(idsOf(state).includes('mistake'), 'la fiche est encore là après annulation');

    confirmResult = true;
    return uiSandbox.PlayersModule.deletePlayerPermanently('mistake').then(() => {
      assert(!idsOf(state).includes('mistake'), 'confirmer retire la fiche du store joueurs');
      assert(idsOf(state).includes('keep'), 'confirmer ne retire pas les autres joueurs');
      assert(state.playerDeleteIntent.action === 'delete', 'confirmer pose une intention explicite');
      assert(state.playerDeleteIntent.playerId === 'mistake', 'l’intention vise cette fiche');
      assert(state.deletedPlayers.mistake.pseudo === 'Fiche Erreur', 'un tombeau local identifie la fiche');
      assert(state.weeks[0].scores.mistake.days.lundi === 5, 'confirmer ne purge pas le VS');
      assert(state.playerFollowUps.mistake.note === 'suivi', 'confirmer ne purge pas le suivi');

      const before = updates;
      role = 'R4';
      confirmResult = true;
      confirms = [];
      return uiSandbox.PlayersModule.deletePlayerPermanently('keep').then(() => {
        assert(confirms.length === 0, 'un R4 n’atteint pas la confirmation');
        assert(updates === before, 'un appel direct depuis un R4 ne modifie rien');
        assert(idsOf(state).includes('keep'), 'la fiche du R4 est intacte');
        assert(playersSource.includes('playerDeleteIntent'), 'le client envoie l’intention au store');
        assert(!playersSource.includes('tnex'), 'players.js ne contient pas de code TNEx');
      });
    });
  });
}

async function sqlTests() {
  console.log('\n=== SQL PGlite : R5 seulement, player_missing inchangé ===');
  const { PGlite } = require(path.join(
    process.env.TEMP || process.env.TMP,
    'ros6-pglite',
    'node_modules',
    '@electric-sql',
    'pglite'
  ));
  const db = new PGlite();
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20261007_ros6_player_delete.sql'),
    'utf8'
  );
  const previous = fs.readFileSync(
    path.join(root, 'supabase/migrations/20261005_ros6_store_revisions.sql'),
    'utf8'
  );
  assert(/^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(migration), 'la migration commence par BEGIN');
  assert(/commit\s*;\s*$/i.test(migration.trim()), 'la migration se termine par COMMIT');

  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('ros6.test_uid', true), '')::uuid
    $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    create table if not exists public.ros6_user_profiles (
      user_id uuid primary key,
      email text not null default '',
      app_role text not null default 'R4',
      status text not null default 'Actif'
    );
    create or replace function public.ros6_is_active_r4_or_r5()
    returns boolean language plpgsql stable security definer set search_path = public as $fn$
    declare ok boolean;
    begin
      select exists (
        select 1 from public.ros6_user_profiles
        where user_id = auth.uid() and app_role in ('R4', 'R5') and status = 'Actif'
      ) into ok;
      return coalesce(ok, false);
    end;
    $fn$;
    create or replace function public.ros6_is_active_r5()
    returns boolean language plpgsql stable security definer set search_path = public as $fn$
    declare ok boolean;
    begin
      select exists (
        select 1 from public.ros6_user_profiles
        where user_id = auth.uid() and app_role = 'R5' and status = 'Actif'
      ) into ok;
      return coalesce(ok, false);
    end;
    $fn$;
    create table if not exists public.ros6_state (
      id text primary key,
      data jsonb not null default '{}'::jsonb,
      version integer not null default 0,
      updated_at timestamptz not null default now(),
      updated_by uuid null references auth.users (id)
    );
    alter table public.ros6_state enable row level security;
    grant usage on schema public to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);

  const weeks = [{ id: 'w1', scores: { mistake: { days: { lundi: 5 } }, keep: { days: { lundi: 10 } } } }];
  const followUps = { mistake: { note: 'suivi' }, keep: { open: true } };
  const seedPlayers = [
    player('mistake', 'Fiche Erreur', 'Actif'),
    player('keep', 'Gardé', 'Actif', '2026-10-01T10:00:00.000Z'),
    player('parti', 'Ancien', 'Parti', '2026-10-02T10:00:00.000Z'),
  ];
  const fullRuche = {
    version: 6,
    grid: controlOf(0).grid,
    bottomId: null,
    archives: [],
    control: controlOf(4),
  };
  const seed = {
    stores: {
      ros6_command_center_v1: { players: seedPlayers, weeks, playerFollowUps: followUps },
      ros6_ruche_v1: fullRuche,
      ros6_train_v1: { marker: 'train-initial', history: [{ id: 'h1', playerId: 'mistake' }] },
      ros6_tempete_v1: { marker: 'tempete-initial' },
    },
  };
  await db.query(
    `insert into public.ros6_state (id, data, version, updated_at)
     values ('main', $1::jsonb, 3784, '2026-10-05T14:11:15.273Z')`,
    [JSON.stringify(seed)]
  );
  await db.query(`insert into auth.users (id) values ($1::uuid), ($2::uuid)`, [R5, R4]);
  await db.query(
    `insert into public.ros6_user_profiles (user_id, app_role, status) values
      ($1::uuid, 'R5', 'Actif'),
      ($2::uuid, 'R4', 'Actif')`,
    [R5, R4]
  );
  await db.exec(previous);
  const before = (
    await db.query(`select md5(data::text) as data_md5, version from public.ros6_state where id = 'main'`)
  ).rows[0];
  await db.exec(migration);
  const after = (
    await db.query(`select md5(data::text) as data_md5, version from public.ros6_state where id = 'main'`)
  ).rows[0];
  assert(after.data_md5 === before.data_md5, 'la migration ne modifie pas les données');
  assert(Number(after.version) === Number(before.version), 'la migration ne modifie pas version');

  async function asUser(uid, fn) {
    await db.query(`select set_config('ros6.test_uid', $1, false)`, [uid || '']);
    await db.exec('set role authenticated');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }

  async function push(uid, stores, base) {
    return asUser(uid, async () => {
      const res = await db.query(
        `select public.ros6_push_stores($1::jsonb, $2::jsonb, $3::text) as result`,
        [JSON.stringify(stores), JSON.stringify(base), 'test-delete']
      );
      return res.rows[0].result;
    });
  }

  async function center() {
    const row = (
      await db.query(`select data #> '{stores,ros6_command_center_v1}' as center from public.ros6_state where id = 'main'`)
    ).rows[0];
    return row.center;
  }

  async function revisions() {
    const row = (await db.query(`select store_revisions from public.ros6_state where id = 'main'`)).rows[0];
    return row.store_revisions;
  }

  function payload(list, extra) {
    return {
      ros6_command_center_v1: {
        players: list,
        weeks,
        playerFollowUps: followUps,
        ...(extra || {}),
      },
    };
  }

  const others = [seedPlayers[1], seedPlayers[2]];
  const rev0 = { ros6_command_center_v1: 0 };

  const missing = await push(R5, payload(others), rev0);
  assert(missing.ok === false && missing.code === 'player_missing', 'sans intention, player_missing est refusé');
  assert(idsOf(await center()).join() === 'mistake,keep,parti', 'le refus ne retire personne');

  const forgedTomb = await push(
    R5,
    payload(others, { deletedPlayers: { mistake: { at: AT, pseudo: 'Fiche Erreur' } } }),
    rev0
  );
  assert(forgedTomb.code === 'player_missing', 'un tombeau envoyé par le client n’autorise pas la disparition');

  const wrongIntent = await push(
    R5,
    payload([seedPlayers[0], seedPlayers[2]], {
      playerDeleteIntent: { action: 'delete', playerId: 'mistake', pseudo: 'Fiche Erreur', at: AT },
    }),
    rev0
  );
  assert(wrongIntent.code === 'player_missing', 'une intention pour une autre fiche ne couvre pas la disparition');
  assert(idsOf(await center()).includes('keep'), 'le joueur non visé est toujours là');

  const twoMissing = await push(
    R5,
    payload([seedPlayers[2]], {
      playerDeleteIntent: { action: 'delete', playerId: 'mistake', pseudo: 'Fiche Erreur', at: AT },
    }),
    rev0
  );
  assert(twoMissing.code === 'player_missing', 'une intention unique ne supprime pas un second joueur');
  assert(idsOf(await center()).join() === 'mistake,keep,parti', 'aucune fiche n’est retirée si l’envoi en retire deux');

  const r4 = await push(
    R4,
    payload(others, {
      playerDeleteIntent: { action: 'delete', playerId: 'mistake', pseudo: 'Fiche Erreur', at: AT },
    }),
    rev0
  );
  assert(r4.ok === false && r4.code === 'delete_forbidden', 'un R4 est refusé même avec l’intention');
  assert(idsOf(await center()).join() === 'mistake,keep,parti', 'le refus R4 ne retire personne');

  const accepted = await push(
    R5,
    payload(others, {
      playerDeleteIntent: { action: 'delete', playerId: 'mistake', pseudo: 'Mauvais pseudo', at: AT },
    }),
    rev0
  );
  assert(accepted.ok === true, 'R5 + intention explicite : suppression acceptée');
  const stored = await center();
  assert(!idsOf(stored).includes('mistake'), 'la fiche créée par erreur n’est plus dans les joueurs');
  assert(idsOf(stored).join() === 'keep,parti', 'les autres joueurs restent');
  assert(stored.deletedPlayers.mistake.pseudo === 'Fiche Erreur', 'le tombeau garde le pseudo serveur');
  assert(stored.deletedPlayers.mistake.byUserId === R5, 'le tombeau identifie l’auteur');
  assert(!stored.playerDeleteIntent, 'l’intention ne reste pas dans le store');
  assert(stored.weeks[0].scores.mistake.days.lundi === 5, 'le score VS historique reste');
  assert(stored.playerFollowUps.mistake.note === 'suivi', 'le suivi historique reste');
  const side = (
    await db.query(
      `select data #>> '{stores,ros6_train_v1,marker}' as train,
              data #>> '{stores,ros6_train_v1,history,0,playerId}' as train_player,
              data #> '{stores,ros6_ruche_v1,control}' as control,
              data #>> '{stores,ros6_tempete_v1,marker}' as tempete
       from public.ros6_state where id = 'main'`
    )
  ).rows[0];
  assert(side.train === 'train-initial' && side.train_player === 'mistake', 'Train et son historique restent');
  assert(side.control.grid[0][0] === 'p0', 'la Ruche reste intacte');
  assert(side.tempete === 'tempete-initial', 'Tempête reste intacte');

  const logs = (
    await db.query(
      `select user_id::text as user_id, action, detail
       from public.ros6_change_log
       where action = 'player_delete'`
    )
  ).rows;
  assert(logs.length === 1, 'une ligne player_delete est journalisée');
  assert(logs[0].user_id === R5, 'le journal identifie l’auteur');
  assert(logs[0].detail.playerId === 'mistake', 'le journal identifie l’identifiant');
  assert(logs[0].detail.pseudo === 'Fiche Erreur', 'le journal identifie le pseudo');

  const cc = (await revisions()).ros6_command_center_v1;
  const resurrect = await push(
    R5,
    payload(seedPlayers),
    { ros6_command_center_v1: cc }
  );
  assert(resurrect.ok === true, 'un ancien cache est accepté sans réécrire les autres règles');
  assert(!idsOf(await center()).includes('mistake'), 'l’ancien cache ne fait pas réapparaître la fiche');
  const deleteLogsAfter = (
    await db.query(`select count(*)::int as n from public.ros6_change_log where action = 'player_delete'`)
  ).rows[0].n;
  assert(deleteLogsAfter === 1, 'le rejeu ne journalise pas une seconde suppression');

  const cc2 = (await revisions()).ros6_command_center_v1;
  const current = await center();
  const keepParti = current.players.map((item) =>
    item.id === 'keep'
      ? { ...item, status: 'Parti', statusChangedAt: '2026-10-08T10:00:00.000Z', leftAt: '2026-10-08T10:00:00.000Z' }
      : item
  );
  const toParti = await push(R5, payload(keepParti), { ros6_command_center_v1: cc2 });
  assert(toParti.ok === true, 'Actif vers Parti avec une date plus récente passe');
  assert((await center()).players.find((item) => item.id === 'keep').status === 'Parti', 'Gardé est Parti');

  const cc3 = (await revisions()).ros6_command_center_v1;
  const stale = (await center()).players.map((item) =>
    item.id === 'keep' ? { ...item, status: 'Actif', statusChangedAt: '2026-10-07T10:00:00.000Z', leftAt: null } : item
  );
  const stalePush = await push(R5, payload(stale), { ros6_command_center_v1: cc3 });
  assert(stalePush.code === 'status_conflict', 'une date plus ancienne ne change pas le statut');
  assert((await center()).players.find((item) => item.id === 'keep').status === 'Parti', 'le statut daté serveur reste');

  const wiped = (await center()).players.map((item) =>
    item.id === 'parti' ? { ...item, leftAt: null } : item
  );
  const wipe = await push(R5, payload(wiped), { ros6_command_center_v1: cc3 });
  assert(wipe.code === 'status_conflict', 'effacer leftAt sans date plus récente est refusé');

  const cc4 = (await revisions()).ros6_command_center_v1;
  const back = (await center()).players.map((item) =>
    item.id === 'keep'
      ? { ...item, status: 'Actif', statusChangedAt: '2026-10-09T10:00:00.000Z', leftAt: null }
      : item
  );
  const reactivated = await push(R5, payload(back), { ros6_command_center_v1: cc4 });
  assert(reactivated.ok === true, 'Parti vers Actif avec une date plus récente passe');
  assert((await center()).players.find((item) => item.id === 'keep').status === 'Actif', 'Gardé est de nouveau Actif');

  const rucheRev = (await revisions()).ros6_ruche_v1;
  const cleared = {
    ros6_ruche_v1: { ...fullRuche, control: controlOf(0) },
  };
  const ruche = await push(R5, cleared, { ros6_ruche_v1: rucheRev });
  assert(ruche.code === 'control_reset_required', 'la protection Ruche refuse un vidage sans intention');
  const controlAfter = (
    await db.query(`select data #> '{stores,ros6_ruche_v1,control,grid}' as grid from public.ros6_state where id = 'main'`)
  ).rows[0].grid;
  assert(controlAfter[0][0] === 'p0', 'le vidage Ruche n’est pas écrit');

  const conflict = await push(R5, payload((await center()).players), { ros6_command_center_v1: 0 });
  assert(conflict.code === 'revision_conflict', 'une mauvaise révision est refusée');
  assert(idsOf(await center()).join() === 'keep,parti', 'le conflit de révision ne retire personne');

  const dataBeforeRollback = (
    await db.query(`select md5(data::text) as data_md5 from public.ros6_state where id = 'main'`)
  ).rows[0].data_md5;
  await db.exec(fs.readFileSync(path.join(root, 'supabase/rollback/20261007_ros6_player_delete.sql'), 'utf8'));
  const dataAfterRollback = (
    await db.query(`select md5(data::text) as data_md5 from public.ros6_state where id = 'main'`)
  ).rows[0].data_md5;
  assert(dataAfterRollback === dataBeforeRollback, 'le rollback ne réécrit pas data');
  const helper = (
    await db.query(`select to_regprocedure('public.ros6_command_center_write(jsonb,jsonb)') as fn`)
  ).rows[0].fn;
  assert(helper == null, 'le rollback retire la fonction de suppression');

  await db.close();
}

clientTests()
  .then(() => sqlTests())
  .then(() => {
    console.log(`\n${passed} réussis, ${failed} échoués`);
    if (failed) process.exit(1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
