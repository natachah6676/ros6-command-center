/**
 * Révisions par store : client + RPC SQL exécutée dans PGlite (pas le Supabase réel).
 * node scripts/test-store-revisions.js
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

function ruche(control, extra) {
  return {
    version: 6,
    grid: controlOf(0).grid,
    bottomId: null,
    archives: [],
    control,
    ...(extra || {}),
  };
}

const R5 = '11111111-1111-4111-8111-111111111111';
const DISABLED = '22222222-2222-4222-8222-222222222222';
const PLAYER = 'player_ros6_keep';

function member(overrides) {
  return {
    id: PLAYER,
    pseudo: 'Nim',
    role: 'Membre',
    status: 'Actif',
    leftAt: null,
    ...overrides,
  };
}

async function main() {
  console.log('\n=== Client : pas de contournement, révision par store ===');
  const syncCode = fs.readFileSync(path.join(root, 'js/supabase-sync.js'), 'utf8');
  const rucheCode = fs.readFileSync(path.join(root, 'js/ruche.js'), 'utf8');
  assert(!syncCode.includes(".from('ros6_state').update"), 'le client ne fait plus d’UPDATE direct');
  assert(!syncCode.includes(".from('ros6_state').upsert"), 'le client ne fait plus d’UPSERT direct');
  assert(!syncCode.includes(".from('ros6_state').insert"), 'le client ne crée plus la ligne par INSERT');
  assert(syncCode.includes("rpc('ros6_push_stores'"), 'le client appelle ros6_push_stores');
  assert(!rucheCode.slice(rucheCode.indexOf('function loadState'), rucheCode.indexOf('function persist')).includes('persist('), 'ouvrir la Ruche ne persiste pas');

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
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    navigator: { onLine: true },
    location: { hostname: 'localhost' },
    AppUI: { toast() {}, confirm: async () => false },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(syncCode, sandbox);
  const T = sandbox.window.ROSSync.__test;
  const remote = {
    version: 3784,
    store_revisions: {
      ros6_command_center_v1: 3,
      ros6_train_v1: 2,
      ros6_ruche_v1: 7,
      ros6_tempete_v1: 1,
    },
    data: {
      stores: {
        ros6_train_v1: { marker: 'remote-train' },
        ros6_ruche_v1: ruche(controlOf(84)),
      },
    },
  };
  const request = T.buildStorePushRequest(
    remote,
    new Set(['ros6_train_v1']),
    { ros6_train_v1: { marker: 'local-train' }, ros6_ruche_v1: ruche(controlOf(0)) }
  );
  assert(Object.keys(request.p_stores).join() === 'ros6_train_v1', 'une écriture Train n’embarque pas la Ruche');
  assert(request.p_base_revisions.ros6_train_v1 === 2, 'la base envoyée est la révision Train lue');
  assert(request.p_base_revisions.ros6_ruche_v1 == null, 'la révision Ruche n’est pas présentée');
  const emptyPush = T.buildStorePushRequest(remote, new Set(), {});
  assert(Object.keys(emptyPush.p_stores).length === 0, 'sans modification, aucune écriture n’est préparée');

  console.log('\n=== SQL PGlite (base locale, pas Supabase) ===');
  const { PGlite } = require(path.join(
    process.env.TEMP || process.env.TMP,
    'ros6-pglite',
    'node_modules',
    '@electric-sql',
    'pglite'
  ));
  const db = new PGlite();
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20261005_ros6_store_revisions.sql'),
    'utf8'
  );
  const rollback = fs.readFileSync(
    path.join(root, 'supabase/rollback/20261005_ros6_store_revisions.sql'),
    'utf8'
  );

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

  const fullRuche = ruche(controlOf(84));
  const seed = {
    stores: {
      ros6_command_center_v1: {
        players: [
          member({
            status: 'Parti',
            leftAt: '2026-10-05T14:00:00.000Z',
            statusChangedAt: '2026-10-05T14:00:00.000Z',
          }),
        ],
        weeks: [{ id: 'week-kept', label: 'historique' }],
      },
      ros6_ruche_v1: fullRuche,
      ros6_train_v1: { marker: 'train-initial' },
      ros6_tempete_v1: { marker: 'tempete-initial' },
    },
  };
  await db.query(
    `insert into public.ros6_state (id, data, version, updated_at)
     values ('main', $1::jsonb, 3784, '2026-10-05T14:11:15.273Z')`,
    [JSON.stringify(seed)]
  );
  await db.query(`insert into auth.users (id) values ($1::uuid), ($2::uuid)`, [R5, DISABLED]);
  await db.query(
    `insert into public.ros6_user_profiles (user_id, app_role, status) values
      ($1::uuid, 'R5', 'Actif'),
      ($2::uuid, 'R4', 'Désactivé')`,
    [R5, DISABLED]
  );
  await db.exec(`
    drop policy if exists ros6_state_select_authenticated on public.ros6_state;
    create policy ros6_state_select_authenticated on public.ros6_state for select to authenticated using (true);
    drop policy if exists ros6_state_insert_authenticated on public.ros6_state;
    create policy ros6_state_insert_authenticated on public.ros6_state for insert to authenticated with check (true);
    drop policy if exists ros6_state_update_authenticated on public.ros6_state;
    create policy ros6_state_update_authenticated on public.ros6_state for update to authenticated using (true) with check (true);
  `);

  const before = (
    await db.query(
      `select version, updated_at::text as updated_at, md5(data::text) as data_md5,
              jsonb_array_length(data #> '{stores,ros6_command_center_v1,players}') as players
       from public.ros6_state where id = 'main'`
    )
  ).rows[0];

  await db.exec(migration);

  const after = (
    await db.query(
      `select version, updated_at::text as updated_at, md5(data::text) as data_md5,
              jsonb_array_length(data #> '{stores,ros6_command_center_v1,players}') as players,
              store_revisions
       from public.ros6_state where id = 'main'`
    )
  ).rows[0];
  assert(after.data_md5 === before.data_md5, 'la migration ne change pas le document data');
  assert(Number(after.version) === Number(before.version), 'la migration ne change pas version');
  assert(after.updated_at === before.updated_at, 'la migration ne change pas updated_at');
  assert(Number(after.players) === 1, 'la migration ne change pas les joueurs');
  assert(Number(after.store_revisions.ros6_ruche_v1) === 0, 'révision Ruche initialisée à 0');
  assert(Number(after.store_revisions.ros6_train_v1) === 0, 'révision Train initialisée à 0');
  assert(Number(after.store_revisions.ros6_command_center_v1) === 0, 'révision centre initialisée à 0');
  const logAtStart = (await db.query('select count(*)::int as n from public.ros6_change_log')).rows[0].n;
  assert(logAtStart === 0, 'le journal est vide juste après la migration');
  const policies = (
    await db.query(
      `select policyname, cmd from pg_policies where tablename = 'ros6_state' order by policyname`
    )
  ).rows;
  assert(
    policies.length === 1 && policies[0].cmd === 'SELECT',
    'il ne reste que la lecture de ros6_state'
  );

  async function asUser(uid, fn) {
    await db.query(`select set_config('ros6.test_uid', $1, false)`, [uid || '']);
    await db.exec('set role authenticated');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }

  async function push(uid, stores, base, clientId) {
    return asUser(uid, async () => {
      const res = await db.query(
        `select public.ros6_push_stores($1::jsonb, $2::jsonb, $3::text) as result`,
        [JSON.stringify(stores), JSON.stringify(base), clientId || null]
      );
      return res.rows[0].result;
    });
  }

  async function row() {
    const res = await db.query(
      `select version, store_revisions, data from public.ros6_state where id = 'main'`
    );
    return res.rows[0];
  }

  const trainA = await push(R5, { ros6_train_v1: { marker: 'appareil-A' } }, { ros6_train_v1: 0 }, 'device-a');
  const rucheB = await push(
    R5,
    { ros6_ruche_v1: ruche(controlOf(84), { note: 'appareil-B' }) },
    { ros6_ruche_v1: 0 },
    'device-b'
  );
  assert(trainA.ok === true && rucheB.ok === true, 'deux stores différents écrits depuis la révision 0');
  let current = await row();
  assert(current.data.stores.ros6_train_v1.marker === 'appareil-A', 'la modification Train est conservée');
  assert(current.data.stores.ros6_ruche_v1.note === 'appareil-B', 'la modification Ruche est conservée');
  assert(Number(current.store_revisions.ros6_train_v1) === 1, 'révision Train = 1');
  assert(Number(current.store_revisions.ros6_ruche_v1) === 1, 'révision Ruche = 1');
  assert(Number(current.store_revisions.ros6_tempete_v1) === 0, 'Tempête n’a pas bougé');
  assert(Number(current.version) === 3784, 'la version globale reste figée');
  assert(
    current.data.stores.ros6_command_center_v1.weeks[0].id === 'week-kept',
    'l’historique des semaines n’est pas touché'
  );

  const conflict = await push(
    R5,
    { ros6_ruche_v1: ruche(controlOf(84), { note: 'trop-tard' }) },
    { ros6_ruche_v1: 0 },
    'device-b'
  );
  assert(conflict.ok === false && conflict.code === 'revision_conflict', 'même store, même révision lue : conflit');
  assert(Number(conflict.actual) === 1, 'le conflit annonce la révision actuelle');
  current = await row();
  assert(current.data.stores.ros6_ruche_v1.note === 'appareil-B', 'le second écriture n’a pas écrasé');
  const retried = await push(
    R5,
    { ros6_ruche_v1: ruche(controlOf(84), { note: 'apres-relecture' }) },
    { ros6_ruche_v1: conflict.actual },
    'device-b'
  );
  assert(retried.ok === true, 'relecture + retry avec la nouvelle révision');
  current = await row();
  assert(current.data.stores.ros6_ruche_v1.note === 'apres-relecture', 'le retry applique la fusion relue');
  assert(Number(current.store_revisions.ros6_train_v1) === 1, 'le retry Ruche ne change pas la révision Train');

  const staleActif = await push(
    R5,
    {
      ros6_command_center_v1: {
        players: [member({ status: 'Actif', leftAt: null, statusChangedAt: '2026-10-01T08:00:00.000Z' })],
        weeks: [{ id: 'week-kept', label: 'historique' }],
      },
    },
    { ros6_command_center_v1: 0 },
    'device-b'
  );
  assert(staleActif.ok === false && staleActif.code === 'status_conflict', 'vieux Actif refusé contre Parti récent');
  current = await row();
  assert(current.data.stores.ros6_command_center_v1.players[0].status === 'Parti', 'le joueur reste Parti');
  assert(
    current.data.stores.ros6_command_center_v1.players[0].statusChangedAt === '2026-10-05T14:00:00.000Z',
    'aucune date serveur n’est inventée'
  );

  const serverPlayer = current.data.stores.ros6_command_center_v1.players[0];
  const localStale = member({
    status: 'Actif',
    leftAt: null,
    pseudo: 'Nim-local',
    statusChangedAt: '2026-10-01T08:00:00.000Z',
  });
  const merged = T.mergePlayerRecord(serverPlayer, localStale);
  const retryStatus = await push(
    R5,
    {
      ros6_command_center_v1: {
        players: [merged],
        weeks: current.data.stores.ros6_command_center_v1.weeks,
      },
    },
    { ros6_command_center_v1: Number(current.store_revisions.ros6_command_center_v1) },
    'device-b'
  );
  assert(retryStatus.ok === true, 'après merge métier le retry est accepté');
  current = await row();
  assert(current.data.stores.ros6_command_center_v1.players[0].status === 'Parti', 'le merge laisse le Parti le plus récent');
  assert(current.data.stores.ros6_command_center_v1.players[0].pseudo === 'Nim-local', 'le champ non conflictuel local est gardé');
  assert(current.data.stores.ros6_command_center_v1.players[0].id === PLAYER, 'l’ID joueur est inchangé');

  const reactivate = await push(
    R5,
    {
      ros6_command_center_v1: {
        players: [
          member({
            status: 'Actif',
            leftAt: null,
            pseudo: 'Nim-local',
            statusChangedAt: '2026-10-05T16:40:00.000Z',
          }),
        ],
        weeks: [{ id: 'week-kept', label: 'historique' }],
      },
    },
    { ros6_command_center_v1: Number(current.store_revisions.ros6_command_center_v1) },
    'device-a'
  );
  assert(reactivate.ok === true, 'réactivation plus récente acceptée');
  current = await row();
  assert(current.data.stores.ros6_command_center_v1.players[0].status === 'Actif', 'le joueur redevient Actif');
  assert(current.data.stores.ros6_command_center_v1.players[0].leftAt == null, 'leftAt est vidé par la réactivation');

  const oldParti = await push(
    R5,
    {
      ros6_command_center_v1: {
        players: [
          member({
            status: 'Parti',
            leftAt: '2026-10-05T14:00:00.000Z',
            statusChangedAt: '2026-10-05T14:00:00.000Z',
          }),
        ],
        weeks: [{ id: 'week-kept', label: 'historique' }],
      },
    },
    { ros6_command_center_v1: Number(current.store_revisions.ros6_command_center_v1) },
    'device-b'
  );
  assert(oldParti.ok === false && oldParti.code === 'status_conflict', 'vieux Parti refusé contre réactivation récente');
  current = await row();
  assert(current.data.stores.ros6_command_center_v1.players[0].status === 'Actif', 'l’Actif récent reste en place');

  await db.query(
    `update public.ros6_state
     set data = jsonb_set(data, '{stores,ros6_command_center_v1,players,0}', $1::jsonb)
     where id = 'main'`,
    [JSON.stringify(member({ status: 'Parti', leftAt: '2026-09-01T00:00:00.000Z' }))]
  );
  current = await row();
  const undatedParti = current.data.stores.ros6_command_center_v1.players[0];
  const undatedBeat = await push(
    R5,
    {
      ros6_command_center_v1: {
        players: [member({ status: 'Actif', leftAt: null })],
        weeks: [{ id: 'week-kept', label: 'historique' }],
      },
    },
    { ros6_command_center_v1: Number(current.store_revisions.ros6_command_center_v1) },
    'device-b'
  );
  assert(undatedBeat.ok === false, 'Actif sans date refusé contre Parti sans date');
  const datedBeat = await push(
    R5,
    {
      ros6_command_center_v1: {
        players: [
          member({
            status: 'Actif',
            leftAt: null,
            statusChangedAt: '2026-10-05T18:00:00.000Z',
          }),
        ],
        weeks: [{ id: 'week-kept', label: 'historique' }],
      },
    },
    { ros6_command_center_v1: Number((await row()).store_revisions.ros6_command_center_v1) },
    'device-a'
  );
  assert(datedBeat.ok === true, 'Actif daté accepté contre Parti sans date');
  current = await row();
  assert(
    current.data.stores.ros6_command_center_v1.players[0].statusChangedAt === '2026-10-05T18:00:00.000Z',
    'la date conservée est celle du client, pas une horloge serveur'
  );
  assert(undatedParti.status === 'Parti', 'la fiche sans date a bien été lue avant le test');

  const wipe = await push(
    R5,
    { ros6_ruche_v1: ruche(controlOf(0)) },
    { ros6_ruche_v1: Number(current.store_revisions.ros6_ruche_v1) },
    'device-b'
  );
  assert(wipe.ok === false && wipe.code === 'control_reset_required', '84 → 0 sans reset : refus');
  current = await row();
  assert(
    T.countControlPlacements(current.data.stores.ros6_ruche_v1.control) === 84,
    'les 84 placements sont encore là'
  );
  const resetAt = '2026-10-05T19:00:00.000Z';
  const reset = await push(
    R5,
    {
      ros6_ruche_v1: ruche(controlOf(0), {
        controlIntent: { action: 'reset', at: resetAt },
        controlUpdatedAt: resetAt,
      }),
    },
    { ros6_ruche_v1: Number(current.store_revisions.ros6_ruche_v1) },
    'device-a'
  );
  assert(reset.ok === true, '84 → 0 avec reset explicite : accepté');
  current = await row();
  assert(T.countControlPlacements(current.data.stores.ros6_ruche_v1.control) === 0, 'le contrôle volontaire est vide');
  const resetLog = (
    await db.query(
      `select action, old_revision, new_revision, client_id, detail
       from public.ros6_change_log where action = 'reset' order by id desc limit 1`
    )
  ).rows[0];
  assert(resetLog && Number(resetLog.detail.placementCountBefore) === 84, 'le journal du reset identifie les 84 placements');
  assert(resetLog.client_id === 'device-a', 'le journal porte l’identifiant client, sans en faire un droit');

  const trainOnly = await push(
    R5,
    { ros6_train_v1: { marker: 'train-seul' } },
    { ros6_train_v1: Number(current.store_revisions.ros6_train_v1) },
    'device-a'
  );
  assert(trainOnly.ok === true, 'écriture Train acceptée');
  const rucheRevBeforeTrain = Number(current.store_revisions.ros6_ruche_v1);
  current = await row();
  assert(Number(current.store_revisions.ros6_ruche_v1) === rucheRevBeforeTrain, 'Train ne change pas la révision Ruche');
  assert(current.data.stores.ros6_train_v1.marker === 'train-seul', 'le Train a bien été écrit');

  const acceptedLog = (
    await db.query(
      `select count(*)::int as n from public.ros6_change_log where action = 'write' and new_revision is not null`
    )
  ).rows[0].n;
  assert(acceptedLog > 0, 'une écriture acceptée a une ligne de journal');

  let forbidden = false;
  try {
    await push(DISABLED, { ros6_train_v1: { marker: 'non' } }, { ros6_train_v1: 0 }, 'device-x');
  } catch (error) {
    forbidden = /acces ROS6 refuse|42501/.test(error.message || '');
  }
  assert(forbidden, 'utilisateur désactivé : refus');
  assert((await row()).data.stores.ros6_train_v1.marker === 'train-seul', 'le refus n’écrit pas');

  let direct = false;
  try {
    await asUser(R5, async () => {
      await db.exec(`update public.ros6_state set version = version + 1 where id = 'main'`);
    });
  } catch (error) {
    direct = /permission denied|42501/i.test(error.message || '');
  }
  assert(direct, 'UPDATE direct de ros6_state refusé');
  assert(Number((await row()).version) === 3784, 'la version n’a pas été contournée');

  let anonDenied = false;
  try {
    await db.query(`select set_config('ros6.test_uid', $1, false)`, [R5]);
    await db.exec('set role anon');
    await db.query(`select public.ros6_push_stores('{}'::jsonb, '{}'::jsonb, null)`);
  } catch (error) {
    anonDenied = /permission denied|42501/i.test(error.message || '');
  } finally {
    await db.exec('reset role');
  }
  assert(anonDenied, 'rôle anon : RPC refusée');

  let logUpdate = false;
  try {
    await db.exec(`update public.ros6_change_log set action = 'tamper' where id = (select min(id) from public.ros6_change_log)`);
  } catch (error) {
    logUpdate = /append-only/.test(error.message || '');
  }
  assert(logUpdate, 'le journal refuse UPDATE, même pour le propriétaire');

  const md5BeforeRerun = (await db.query(`select md5(data::text) as m from public.ros6_state where id = 'main'`)).rows[0].m;
  const revBeforeRerun = (await row()).store_revisions.ros6_train_v1;
  await db.exec(migration);
  current = await row();
  assert(
    (await db.query(`select md5(data::text) as m from public.ros6_state where id = 'main'`)).rows[0].m === md5BeforeRerun,
    'relancer la migration ne réécrit pas data'
  );
  assert(Number(current.store_revisions.ros6_train_v1) === Number(revBeforeRerun), 'relancer la migration ne remet pas les révisions à 0');

  await db.exec(rollback);
  const fn = (await db.query(`select to_regprocedure('public.ros6_push_stores(jsonb,jsonb,text)') as fn`)).rows[0].fn;
  assert(fn == null, 'le rollback retire la RPC');
  const restored = (
    await db.query(`select count(*)::int as n from pg_policies where tablename = 'ros6_state' and cmd = 'UPDATE'`)
  ).rows[0].n;
  assert(restored === 1, 'le rollback rouvre la policy UPDATE');
  const still = await db.query(
    `select md5(data::text) as m, version,
            data #>> '{stores,ros6_command_center_v1,weeks,0,id}' as week
     from public.ros6_state where id = 'main'`
  );
  assert(still.rows[0].m === md5BeforeRerun, 'le rollback ne change pas data');
  assert(Number(still.rows[0].version) === 3784, 'le rollback ne change pas version');
  assert(still.rows[0].week === 'week-kept', 'le rollback ne change pas l’historique');

  await db.close();
  console.log(`\n${passed} réussis, ${failed} échoués`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
