/**
 * Authentification Supabase + synchronisation de l’état partagé (ros6_state / main).
 *
 * Principe :
 * - chaque module marque UNIQUEMENT son store comme « dirty » ;
 * - un push fusionne ces stores sur la base distante (les autres stores distants restent intacts) ;
 * - Gestion des membres (ros6_command_center_v1.players) est protégée contre l’écrasement
 *   accidentel de champs non vides par null/undefined venant d’un cache incomplet ;
 * - un ancien cache local ne peut pas écraser silencieusement une version distante plus récente.
 */
(function (global) {
  const ROW_ID = 'main';
  const META_KEY = 'ros6_sync_meta_v1';
  const STORE_KEYS = [
    'ros6_command_center_v1',
    'ros6_train_v1',
    'ros6_ruche_v1',
    'ros6_tempete_v1',
    'ros6_backups_v1',
  ];

  const COMMAND_CENTER_KEY = 'ros6_command_center_v1';

  /** Champs membres : une valeur distante non vide ne cède pas à un vide local sans clear explicite. */
  const PROTECTED_NONEMPTY_PLAYER_FIELDS = [
    'pseudo',
    'role',
    'status',
    'heroPowerTierId',
    'globalPowerTierId',
    'coachingException',
    'createdAt',
    'leftAt',
  ];

  const STATUS = {
    synced: { label: 'Synchronisé', css: 'is-synced' },
    saving: { label: 'Enregistrement', css: 'is-saving' },
    offline: { label: 'Hors connexion', css: 'is-offline' },
    error: { label: 'Erreur de synchronisation', css: 'is-error' },
    idle: { label: '—', css: '' },
  };

  const els = {};
  let client = null;
  let session = null;
  let localVersion = 0;
  let suppressPush = false;
  let pushTimer = null;
  let pushing = false;
  let pushQueued = false;
  /** Chaîne de promises pour sérialiser flushPush / schedulePush. */
  let pushChain = Promise.resolve();
  let bootstrapped = false;
  let bootstrapping = false;
  let onReadyCallback = null;
  let appStarted = false;
  /** Versions écrites avec succès par cet onglet (évite un faux conflit sur nos propres pushes). */
  const ownPushedVersions = new Set();
  /** Stores modifiés localement en attente de push ciblé. */
  const pendingDirty = new Set();

  function $(id) {
    return document.getElementById(id);
  }

  function cacheDom() {
    els.gate = $('authGate');
    els.app = document.querySelector('.app');
    els.form = $('authLoginForm');
    els.email = $('authEmail');
    els.password = $('authPassword');
    els.error = $('authError');
    els.btnLogin = $('authLoginBtn');
    els.btnLogout = $('btnLogout');
    els.syncStatus = $('syncStatus');
    els.userLabel = $('authUserLabel');
  }

  function setAuthError(message) {
    if (!els.error) return;
    if (!message) {
      els.error.textContent = '';
      els.error.classList.add('hidden');
      return;
    }
    els.error.textContent = message;
    els.error.classList.remove('hidden');
  }

  function setSyncStatus(key, detail) {
    const info = STATUS[key] || STATUS.idle;
    if (!els.syncStatus) return;
    els.syncStatus.textContent = detail ? `${info.label} — ${detail}` : info.label;
    els.syncStatus.className = `sync-status ${info.css}`;
    els.syncStatus.dataset.status = key;
  }

  function showGate(show) {
    if (els.gate) els.gate.classList.toggle('hidden', !show);
    if (els.app) els.app.classList.toggle('hidden', show);
  }

  function readMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return { version: 0, savedAt: '' };
      const parsed = JSON.parse(raw);
      return {
        version: Number(parsed.version) || 0,
        savedAt: String(parsed.savedAt || ''),
      };
    } catch (error) {
      return { version: 0, savedAt: '' };
    }
  }

  function writeMeta(version) {
    localVersion = Number(version) || 0;
    localStorage.setItem(
      META_KEY,
      JSON.stringify({ version: localVersion, savedAt: new Date().toISOString() })
    );
  }

  function parseStoreValue(raw) {
    if (raw == null || raw === '') return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return raw;
    }
  }

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isEmptyFieldValue(value) {
    return value == null || value === '';
  }

  function markDirty(storeKey) {
    if (!storeKey || !STORE_KEYS.includes(storeKey)) {
      console.warn('ROSSync.schedulePush: store inconnu ignoré', storeKey);
      return false;
    }
    pendingDirty.add(storeKey);
    return true;
  }

  function getLocalStore(key) {
    if (key === COMMAND_CENTER_KEY && global.ROSStorage) {
      try {
        return cloneJson(ROSStorage.getState());
      } catch (error) {
        /* fallback localStorage */
      }
    }
    const raw = localStorage.getItem(key);
    return raw != null ? parseStoreValue(raw) : null;
  }

  function collectLocalStoresMap() {
    const stores = {};
    STORE_KEYS.forEach((key) => {
      const value = getLocalStore(key);
      if (value != null) stores[key] = value;
    });
    return stores;
  }

  /** @deprecated Prefer collectLocalStoresMap + buildPushPayload. Kept for migration export. */
  function collectStores() {
    return {
      appName: 'WAROPS',
      stores: collectLocalStoresMap(),
      collectedAt: new Date().toISOString(),
    };
  }

  function countFilledGlobalPower(dataOrStores) {
    const stores = dataOrStores?.stores || dataOrStores || {};
    const players = stores[COMMAND_CENTER_KEY]?.players;
    if (!Array.isArray(players)) return 0;
    return players.filter(
      (p) => p && !isEmptyFieldValue(p.globalPowerTierId)
    ).length;
  }

  function countFilledGlobalPowerInPlayers(players) {
    if (!Array.isArray(players)) return 0;
    return players.filter((p) => p && !isEmptyFieldValue(p.globalPowerTierId)).length;
  }

  /**
   * Restaure les Puissances globales non vides d’une liste source
   * lorsque la cible a null/undefined sans clear volontaire.
   */
  function protectPlayersGlobalPowers(sourcePlayers, targetPlayers) {
    if (!Array.isArray(sourcePlayers) || !Array.isArray(targetPlayers)) return targetPlayers;
    const sourceById = new Map(sourcePlayers.filter((p) => p?.id).map((p) => [p.id, p]));
    targetPlayers.forEach((target) => {
      if (!target?.id) return;
      const source = sourceById.get(target.id);
      if (!source) return;
      const sourceVal = source.globalPowerTierId;
      const targetVal = target.globalPowerTierId;
      const clears = target.syncClears && typeof target.syncClears === 'object' ? target.syncClears : {};
      if (
        !isEmptyFieldValue(sourceVal) &&
        isEmptyFieldValue(targetVal) &&
        !clears.globalPowerTierId
      ) {
        target.globalPowerTierId = sourceVal;
      }
    });
    return targetPlayers;
  }

  function stripPlayerSyncMeta(player) {
    if (!player || typeof player !== 'object') return player;
    const next = { ...player };
    delete next.syncClears;
    return next;
  }

  function mergeGlobalPowerAudit(remoteList, localList) {
    const map = new Map();
    [...(Array.isArray(remoteList) ? remoteList : []), ...(Array.isArray(localList) ? localList : [])].forEach(
      (entry) => {
        if (!entry || !entry.id) return;
        map.set(entry.id, cloneJson(entry));
      }
    );
    return [...map.values()]
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, 200);
  }

  /**
   * Fusion d’une fiche joueur : le local (édition membres) prime,
   * sauf vide accidentel qui écraserait une valeur distante non vide.
   * Clear volontaire = player.syncClears[field] truthy.
   */
  function mergePlayerRecord(remotePlayer, localPlayer) {
    if (!localPlayer) return stripPlayerSyncMeta(cloneJson(remotePlayer));
    if (!remotePlayer) return stripPlayerSyncMeta(cloneJson(localPlayer));

    const merged = { ...cloneJson(remotePlayer), ...cloneJson(localPlayer) };
    const clears =
      localPlayer.syncClears && typeof localPlayer.syncClears === 'object'
        ? localPlayer.syncClears
        : {};

    PROTECTED_NONEMPTY_PLAYER_FIELDS.forEach((field) => {
      const localVal = localPlayer[field];
      const remoteVal = remotePlayer[field];
      if (isEmptyFieldValue(localVal) && !isEmptyFieldValue(remoteVal)) {
        if (clears[field]) {
          merged[field] = null;
        } else if (field === 'leftAt' && localPlayer.status === 'Actif') {
          // Retour Actif : leftAt null est volontaire.
          merged[field] = null;
        } else {
          merged[field] = remoteVal;
        }
      }
    });

    return stripPlayerSyncMeta(merged);
  }

  function mergeCommandCenterStore(remoteStore, localStore) {
    if (!localStore) return cloneJson(remoteStore);
    if (!remoteStore) return cloneJson(localStore);

    const remotePlayers = Array.isArray(remoteStore.players) ? remoteStore.players : [];
    const localPlayers = Array.isArray(localStore.players) ? localStore.players : [];
    const remoteById = new Map(remotePlayers.filter((p) => p?.id).map((p) => [p.id, p]));
    const seen = new Set();
    const mergedPlayers = [];

    // 1) Joueurs présents localement (édition membres / VS) avec protection champs
    localPlayers.forEach((localP) => {
      if (!localP?.id) {
        mergedPlayers.push(stripPlayerSyncMeta(localP));
        return;
      }
      seen.add(localP.id);
      mergedPlayers.push(mergePlayerRecord(remoteById.get(localP.id), localP));
    });

    // 2) Joueurs uniquement côté serveur : ne jamais les perdre (cache incomplet)
    remotePlayers.forEach((remoteP) => {
      if (!remoteP?.id || seen.has(remoteP.id)) return;
      seen.add(remoteP.id);
      mergedPlayers.push(stripPlayerSyncMeta(cloneJson(remoteP)));
    });

    const merged = {
      ...cloneJson(remoteStore),
      ...cloneJson(localStore),
      players: mergedPlayers,
      globalPowerAudit: mergeGlobalPowerAudit(
        remoteStore.globalPowerAudit,
        localStore.globalPowerAudit
      ),
    };

    // Filet final : aucune PG distante non vide ne doit disparaître sans clear
    protectPlayersGlobalPowers(remotePlayers, merged.players);
    return merged;
  }

  /**
   * Empêche un force-push destructeur quand le cache local a moins de PG renseignées.
   */
  function shouldBlockDestructiveGlobalPowerOverwrite(remoteData, localStoresMap) {
    const remoteGp = countFilledGlobalPower(remoteData);
    const localGp = countFilledGlobalPower({ stores: localStoresMap || collectLocalStoresMap() });
    return remoteGp > localGp;
  }

  /**
   * Construit le document à écrire : base = distant, overlay = stores dirty locaux.
   * Les stores non dirty restent exactement ceux de Supabase.
   * @param {object} [localStoresOverride] Pour tests / injection ; sinon lecture locale.
   */
  function buildPushPayload(remoteData, dirtyKeys, localStoresOverride) {
    const remoteStores =
      remoteData && typeof remoteData === 'object' && remoteData.stores
        ? remoteData.stores
        : {};
    const localStores =
      localStoresOverride && typeof localStoresOverride === 'object'
        ? localStoresOverride
        : collectLocalStoresMap();
    const dirty = dirtyKeys instanceof Set ? dirtyKeys : new Set(dirtyKeys || []);

    const stores = {};
    Object.keys(remoteStores).forEach((key) => {
      stores[key] = cloneJson(remoteStores[key]);
    });
    STORE_KEYS.forEach((key) => {
      if (!(key in stores) && remoteStores[key] != null) {
        stores[key] = cloneJson(remoteStores[key]);
      }
    });

    dirty.forEach((key) => {
      if (!STORE_KEYS.includes(key)) return;
      const local = localStores[key];
      if (local == null) return;
      if (key === COMMAND_CENTER_KEY) {
        stores[key] = mergeCommandCenterStore(remoteStores[key], local);
      } else {
        stores[key] = cloneJson(local);
      }
    });

    return {
      appName: 'WAROPS',
      stores,
      collectedAt: new Date().toISOString(),
      syncMode: 'scoped',
    };
  }

  /**
   * Après conflit distant : adopter le remote pour les stores non dirty,
   * conserver / fusionner les stores dirty locaux.
   */
  function rebaseLocalAfterRemote(remoteData, dirtyKeys) {
    const remoteStores =
      remoteData && typeof remoteData === 'object' && remoteData.stores
        ? remoteData.stores
        : {};
    const dirty = dirtyKeys instanceof Set ? dirtyKeys : new Set(dirtyKeys || []);
    const stores = {};

    STORE_KEYS.forEach((key) => {
      if (dirty.has(key)) {
        const local = getLocalStore(key);
        if (key === COMMAND_CENTER_KEY) {
          stores[key] = mergeCommandCenterStore(remoteStores[key], local);
        } else {
          stores[key] = local != null ? cloneJson(local) : cloneJson(remoteStores[key]);
        }
      } else if (remoteStores[key] != null) {
        stores[key] = cloneJson(remoteStores[key]);
      }
    });

    Object.keys(remoteStores).forEach((key) => {
      if (!(key in stores)) stores[key] = cloneJson(remoteStores[key]);
    });

    return { appName: 'WAROPS', stores, collectedAt: new Date().toISOString() };
  }

  function localHasUsefulData() {
    return STORE_KEYS.some((key) => {
      const raw = localStorage.getItem(key);
      if (!raw || raw === '{}' || raw === 'null') return false;
      try {
        const parsed = JSON.parse(raw);
        if (key === COMMAND_CENTER_KEY) {
          return Array.isArray(parsed.players) && parsed.players.length > 0;
        }
        if (key === 'ros6_backups_v1') {
          return Array.isArray(parsed.backups) && parsed.backups.length > 0;
        }
        return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
      } catch (error) {
        return raw.length > 2;
      }
    });
  }

  function remoteIsEmpty(data) {
    if (data == null) return true;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (error) {
        return !data.trim();
      }
    }
    if (typeof data !== 'object') return true;
    if (!data.stores || typeof data.stores !== 'object') {
      return Object.keys(data).length === 0;
    }
    const keys = Object.keys(data.stores);
    if (!keys.length) return true;
    return keys.every((k) => {
      const v = data.stores[k];
      if (v == null) return true;
      if (typeof v === 'object') return Object.keys(v).length === 0;
      return false;
    });
  }

  function downloadSafetyExport(payload) {
    const json = JSON.stringify(
      {
        ...payload,
        safetyExport: true,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `warops-securite-avant-migration-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function applyStoresToLocal(data, { reload = false } = {}) {
    suppressPush = true;
    try {
      const stores = data && data.stores ? data.stores : {};
      STORE_KEYS.forEach((key) => {
        if (!(key in stores) || stores[key] == null) return;
        const value = stores[key];
        localStorage.setItem(
          key,
          typeof value === 'string' ? value : JSON.stringify(value)
        );
      });
    } finally {
      suppressPush = false;
    }
    if (reload) {
      global.location.reload();
    }
  }

  /**
   * Applique le cache localStorage aux états mémoire + rafraîchit l’UI,
   * sans recharger toute la page (pas de déconnexion visuelle).
   */
  function hydrateAppFromLocalCache() {
    suppressPush = true;
    try {
      if (global.ROSStorage && typeof ROSStorage.hydrateFromStorage === 'function') {
        ROSStorage.hydrateFromStorage();
      }
      if (global.TrainModule && typeof TrainModule.hydrateFromStorage === 'function') {
        TrainModule.hydrateFromStorage();
      }
      if (global.RucheModule && typeof RucheModule.hydrateFromStorage === 'function') {
        RucheModule.hydrateFromStorage();
      }
      if (global.TempeteModule && typeof TempeteModule.hydrateFromStorage === 'function') {
        TempeteModule.hydrateFromStorage();
      }
    } finally {
      suppressPush = false;
    }
    if (typeof global.AppUI?.onRemoteDataApplied === 'function') {
      global.AppUI.onRemoteDataApplied();
    }
  }

  /**
   * Un conflit « réel » = version distante plus récente qui n’a pas été
   * produite par un push réussi de cet onglet.
   */
  function isExternalRemoteConflict(remoteVersion) {
    const version = Number(remoteVersion) || 0;
    if (version <= localVersion) return false;
    if (ownPushedVersions.has(version)) return false;
    return true;
  }

  async function fetchRemoteRow() {
    const { data, error } = await client
      .from('ros6_state')
      .select('id, data, version, updated_at, updated_by')
      .eq('id', ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function ensureRemoteRow() {
    const existing = await fetchRemoteRow();
    if (existing) return existing;
    const { data, error } = await client
      .from('ros6_state')
      .insert({ id: ROW_ID, data: {}, version: 0, updated_by: session.user.id })
      .select('id, data, version, updated_at, updated_by')
      .single();
    if (error) throw error;
    return data;
  }

  async function pushToSupabase({ force = false, allStores = false, allowFewerGlobalPowers = false } = {}) {
    if (!session || !client || suppressPush) return { ok: false, reason: 'noop' };
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return { ok: false, reason: 'offline' };
    }

    const run = () => runPushAttempt({ force, allStores, allowFewerGlobalPowers });
    const resultPromise = pushChain.then(run, run);
    pushChain = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }

  async function runPushAttempt({ force = false, allStores = false, allowFewerGlobalPowers = false } = {}) {
    pushing = true;
    setSyncStatus('saving');
    let lastResult = { ok: false, reason: 'noop' };
    let attempts = 0;
    const maxAttempts = 8;

    try {
      do {
        pushQueued = false;
        attempts += 1;
        if (attempts > maxAttempts) {
          setSyncStatus('error', 'trop de tentatives');
          if (global.AppUI) {
            AppUI.toast('Synchronisation interrompue — réessayez dans un instant.');
          }
          lastResult = { ok: false, reason: 'retries' };
          break;
        }

        const dirtyForPush = allStores
          ? new Set(STORE_KEYS)
          : new Set(pendingDirty);

        if (!dirtyForPush.size && !force) {
          setSyncStatus('synced');
          lastResult = { ok: true, reason: 'nothing-dirty' };
          break;
        }

        let remote;
        try {
          remote = await ensureRemoteRow();
        } catch (error) {
          setSyncStatus('error', error.message || 'lecture impossible');
          if (global.AppUI) AppUI.toast(`Supabase : ${error.message || error}`);
          lastResult = { ok: false, reason: 'fetch', error };
          break;
        }

        const remoteVersion = Number(remote.version) || 0;
        const localStoresMap = collectLocalStoresMap();

        if (
          force &&
          allStores &&
          !allowFewerGlobalPowers &&
          shouldBlockDestructiveGlobalPowerOverwrite(remote.data || {}, localStoresMap)
        ) {
          setSyncStatus('error', 'protection puissances');
          if (global.AppUI) {
            AppUI.toast(
              'Écriture complète bloquée : le cache local a moins de Puissances globales renseignées que Supabase.'
            );
          }
          lastResult = { ok: false, reason: 'blocked-global-power' };
          break;
        }

        if (!force && isExternalRemoteConflict(remoteVersion)) {
          // Rebase : remote gagne pour les stores non dirty ; dirty conservés/fusionnés.
          writeMeta(remoteVersion);
          const rebased = rebaseLocalAfterRemote(remote.data || {}, dirtyForPush);
          applyStoresToLocal(rebased, { reload: false });
          hydrateAppFromLocalCache();
          setSyncStatus('saving', 'fusion après conflit');
          if (global.AppUI && attempts === 1) {
            AppUI.toast(
              'Version distante plus récente — fusion des modules modifiés, sans écraser le reste.'
            );
          }
          pushQueued = true;
          continue;
        }

        if (!force && remoteVersion > localVersion && ownPushedVersions.has(remoteVersion)) {
          writeMeta(remoteVersion);
        }

        // force : toujours fusionner sur la base distante (jamais un replace aveugle)
        const keysToWrite =
          force && allStores ? new Set(STORE_KEYS) : dirtyForPush;
        const payload = buildPushPayload(remote.data || {}, keysToWrite, localStoresMap);
        const nextVersion = remoteVersion + 1;

        if (force) {
          const { error } = await client.from('ros6_state').upsert(
            {
              id: ROW_ID,
              data: payload,
              version: nextVersion,
              updated_at: new Date().toISOString(),
              updated_by: session.user.id,
            },
            { onConflict: 'id' }
          );
          if (error) throw error;
        } else {
          const { data: updated, error } = await client
            .from('ros6_state')
            .update({
              data: payload,
              version: nextVersion,
              updated_at: new Date().toISOString(),
              updated_by: session.user.id,
            })
            .eq('id', ROW_ID)
            .eq('version', remoteVersion)
            .select('id, version')
            .maybeSingle();

          if (error) throw error;

          if (!updated) {
            pushQueued = true;
            continue;
          }
        }

        keysToWrite.forEach((key) => pendingDirty.delete(key));
        ownPushedVersions.add(nextVersion);
        writeMeta(nextVersion);
        applyStoresToLocal(payload, { reload: false });
        setSyncStatus('synced');
        lastResult = { ok: true, version: nextVersion, stores: [...keysToWrite] };
      } while (pushQueued);

      return lastResult;
    } catch (error) {
      console.error('ROSSync push', error);
      const msg = error?.message || String(error);
      if (!navigator.onLine) setSyncStatus('offline');
      else setSyncStatus('error', msg);
      if (global.AppUI) AppUI.toast(`Erreur de synchronisation : ${msg}`);
      return { ok: false, reason: 'push', error };
    } finally {
      pushing = false;
    }
  }

  /**
   * @param {string} [storeKey] Store modifié (ex. ros6_ruche_v1).
   * Sans clé : ne marque rien ; relance seulement s’il reste des dirty en attente.
   */
  function schedulePush(storeKey) {
    if (!bootstrapped || !session || suppressPush) return;
    if (storeKey) markDirty(storeKey);
    if (!pendingDirty.size) return;
    setSyncStatus('saving');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushToSupabase({ force: false, allStores: false });
    }, 500);
  }

  /** Annule le debounce et pousse immédiatement les stores dirty. */
  async function flushPush() {
    if (!bootstrapped || !session || suppressPush) return { ok: false, reason: 'noop' };
    clearTimeout(pushTimer);
    pushTimer = null;
    if (!pendingDirty.size) return { ok: true, reason: 'nothing-dirty' };
    return pushToSupabase({ force: false, allStores: false });
  }

  async function migrateLocalIfNeeded(remote) {
    if (!remoteIsEmpty(remote?.data) || !localHasUsefulData()) return false;

    const ok = await AppUI.confirm({
      title: 'Migration vers Supabase',
      message:
        'Importer les données locales actuelles vers la base partagée ?\n\nUn export JSON de sécurité sera téléchargé avant l’envoi. La base distante est vide.',
      confirmLabel: 'Importer vers Supabase',
    });
    if (!ok) return false;

    const payload = collectStores();
    downloadSafetyExport(payload);

    const { error } = await client
      .from('ros6_state')
      .upsert(
        {
          id: ROW_ID,
          data: payload,
          version: 1,
          updated_at: new Date().toISOString(),
          updated_by: session.user.id,
        },
        { onConflict: 'id' }
      );
    if (error) throw error;
    writeMeta(1);
    pendingDirty.clear();
    AppUI.toast('Données locales importées dans Supabase.');
    return true;
  }

  async function confirmOverwriteRemoteIfNeeded(remote) {
    if (remoteIsEmpty(remote?.data)) return true;

    const localStoresMap = collectLocalStoresMap();
    const remoteGp = countFilledGlobalPower(remote.data);
    const localGp = countFilledGlobalPower({ stores: localStoresMap });
    const remoteUpdated = remote.updated_at
      ? new Date(remote.updated_at).toLocaleString('fr-FR')
      : '—';

    // Priorité absolue : un cache local plus pauvre en PG ne peut pas écraser Supabase.
    if (remoteGp > localGp) {
      if (global.AppUI) {
        AppUI.toast(
          `Cache local incomplet (${localGp} PG vs ${remoteGp} sur Supabase) — version distante conservée.`
        );
      }
      return false;
    }

    const riskLines = [];
    if (remoteGp === localGp && remoteGp > 0) {
      riskLines.push(`Puissances globales renseignées : ${remoteGp} (local = distant).`);
    }
    if ((Number(remote.version) || 0) < localVersion) {
      riskLines.push(
        `Version locale (${localVersion}) > version Supabase (${Number(remote.version) || 0}).`
      );
    }
    riskLines.push(
      'Même en confirmant, les champs membres déjà remplis côté Supabase ne seront pas effacés par des valeurs vides locales (fusion protectrice).'
    );

    return AppUI.confirm({
      title: 'Écraser la base partagée ?',
      message:
        `La base Supabase contient déjà des données (màj : ${remoteUpdated}).\n\n` +
        `Confirmez-vous vouloir y fusionner le cache local ?\n\n` +
        riskLines.join('\n'),
      confirmLabel: 'Fusionner vers Supabase',
    });
  }

  async function bootstrapAfterAuth() {
    setSyncStatus('saving', 'chargement');
    const meta = readMeta();
    localVersion = meta.version;

    if (!navigator.onLine) {
      setSyncStatus('offline', 'cache local');
      bootstrapped = true;
      if (global.AppUI) {
        AppUI.toast('Hors connexion — utilisation du cache local.');
      }
      return;
    }

    try {
      let remote = await ensureRemoteRow();

      if (remoteIsEmpty(remote.data) && localHasUsefulData()) {
        await migrateLocalIfNeeded(remote);
        remote = await fetchRemoteRow();
      }

      if (!remoteIsEmpty(remote?.data)) {
        const remoteVersion = Number(remote.version) || 0;
        // Toujours préférer Supabase au chargement s’il est au moins aussi récent
        if (remoteVersion >= localVersion || localVersion === 0) {
          applyStoresToLocal(remote.data, { reload: false });
          writeMeta(remoteVersion);
          pendingDirty.clear();
        } else if (remoteVersion < localVersion) {
          const remoteGp = countFilledGlobalPower(remote.data);
          const localGp = countFilledGlobalPower({ stores: collectLocalStoresMap() });
          if (remoteGp > localGp) {
            // Cache local plus ancien/incomplet : ne jamais forcer l’écrasement des PG.
            applyStoresToLocal(remote.data, { reload: false });
            writeMeta(remoteVersion);
            pendingDirty.clear();
            if (global.AppUI) {
              AppUI.toast(
                `Cache local incomplet (${localGp} PG vs ${remoteGp} Supabase) — données distantes conservées.`
              );
            }
          } else {
            const overwrite = await confirmOverwriteRemoteIfNeeded(remote);
            if (overwrite) {
              STORE_KEYS.forEach((key) => pendingDirty.add(key));
              await pushToSupabase({ force: true, allStores: true });
            } else {
              applyStoresToLocal(remote.data, { reload: false });
              writeMeta(remoteVersion);
              pendingDirty.clear();
              AppUI.toast('Version Supabase conservée (cache local ignoré).');
            }
          }
        }
      }

      setSyncStatus('synced');
    } catch (error) {
      console.error('ROSSync bootstrap', error);
      setSyncStatus('error', error.message || 'cache local');
      if (global.AppUI) {
        AppUI.toast(
          `Supabase indisponible (${error.message || error}) — cache local utilisé.`
        );
      }
    }

    bootstrapped = true;
  }

  function updateUserLabel() {
    if (!els.userLabel) return;
    if (!session?.user) {
      els.userLabel.textContent = '';
      els.userLabel.classList.add('hidden');
      return;
    }
    const display =
      global.ROSProfiles && typeof ROSProfiles.getDisplayName === 'function'
        ? ROSProfiles.getDisplayName({ allowEmail: true })
        : '';
    els.userLabel.textContent = display || session.user.email || session.user.id;
    els.userLabel.classList.remove('hidden');
  }

  async function loadUserProfileOrReject() {
    if (!global.ROSProfiles || typeof ROSProfiles.ensureOwnProfile !== 'function') {
      return true;
    }
    try {
      await ROSProfiles.ensureOwnProfile();
    } catch (error) {
      console.error('ROSProfiles', error);
      setAuthError(
        `Profil utilisateur inaccessible (${error.message || error}). Exécutez supabase/schema.sql si la table manque.`
      );
      setSyncStatus('error', error.message || 'profil');
      try {
        await client.auth.signOut();
      } catch (signOutError) {
        console.error(signOutError);
      }
      session = null;
      showGate(true);
      return false;
    }

    if (!ROSProfiles.isAccessAllowed()) {
      setAuthError('Votre accès a été désactivé par un R5. Contactez l’administration de l’alliance.');
      try {
        await client.auth.signOut();
      } catch (signOutError) {
        console.error(signOutError);
      }
      session = null;
      showGate(true);
      updateUserLabel();
      return false;
    }

    updateUserLabel();
    if (typeof ROSProfiles.renderOwnAccessSummary === 'function') {
      ROSProfiles.renderOwnAccessSummary();
    }
    return true;
  }

  async function startAppOnce() {
    if (appStarted) return;
    appStarted = true;
    showGate(false);
    updateUserLabel();
    if (typeof onReadyCallback === 'function') {
      await onReadyCallback();
    }
    if (global.ROSProfiles) {
      ROSProfiles.bindAccessUi?.();
      ROSProfiles.renderOwnAccessSummary?.();
      ROSProfiles.renderAccessPanel?.();
    }
  }

  async function handleSession(nextSession) {
    if (!nextSession) {
      session = null;
      bootstrapped = false;
      bootstrapping = false;
      appStarted = false;
      pendingDirty.clear();
      showGate(true);
      setSyncStatus('idle');
      updateUserLabel();
      return;
    }

    session = nextSession;
    if (appStarted) {
      const ok = await loadUserProfileOrReject();
      if (ok) updateUserLabel();
      return;
    }
    if (bootstrapping) return;

    bootstrapping = true;
    try {
      await bootstrapAfterAuth();
      const allowed = await loadUserProfileOrReject();
      if (!allowed) return;
      await startAppOnce();
    } finally {
      bootstrapping = false;
    }
  }

  async function onLoginSubmit(event) {
    event.preventDefault();
    setAuthError('');
    const email = (els.email?.value || '').trim();
    const password = els.password?.value || '';
    if (!email || !password) {
      setAuthError('Indiquez e-mail et mot de passe.');
      return;
    }
    if (els.btnLogin) els.btnLogin.disabled = true;
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await handleSession(data.session);
    } catch (error) {
      console.error(error);
      setAuthError(error.message || 'Connexion impossible.');
      setSyncStatus('error', error.message || '');
    } finally {
      if (els.btnLogin) els.btnLogin.disabled = false;
    }
  }

  async function onLogout() {
    try {
      await client.auth.signOut();
    } catch (error) {
      console.error(error);
      if (global.AppUI) AppUI.toast(`Déconnexion : ${error.message || error}`);
    }
    await handleSession(null);
  }

  function bindOnline() {
    window.addEventListener('online', () => {
      if (!session) return;
      setSyncStatus('saving', 'reconnexion');
      schedulePush();
    });
    window.addEventListener('offline', () => {
      if (session) setSyncStatus('offline');
    });
  }

  function init(options = {}) {
    cacheDom();
    onReadyCallback = options.onReady || null;
    client = ROSSupabase.getClient();
    showGate(true);
    setSyncStatus('idle');

    els.form?.addEventListener('submit', onLoginSubmit);
    els.btnLogout?.addEventListener('click', onLogout);
    bindOnline();

    client.auth.onAuthStateChange(async (event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        await handleSession(null);
        return;
      }
      if (nextSession && !appStarted) {
        await handleSession(nextSession);
      } else if (nextSession) {
        session = nextSession;
        updateUserLabel();
      }
    });

    client.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        setAuthError(error.message);
        return;
      }
      if (data.session) await handleSession(data.session);
      else await handleSession(null);
    });
  }

  /**
   * Marque un clear volontaire d’un champ membre (ex. Puissance globale → Non renseignée).
   * À appeler depuis Gestion des membres uniquement.
   */
  function markPlayerFieldCleared(player, field) {
    if (!player || !field) return player;
    if (!player.syncClears || typeof player.syncClears !== 'object') {
      player.syncClears = {};
    }
    player.syncClears[field] = Date.now();
    return player;
  }

  function clearPlayerFieldCleared(player, field) {
    if (!player?.syncClears || !field) return player;
    delete player.syncClears[field];
    if (!Object.keys(player.syncClears).length) delete player.syncClears;
    return player;
  }

  global.ROSSync = {
    init,
    schedulePush,
    flushPush,
    pushNow: () => flushPush(),
    getSession: () => session,
    refreshUserLabel: updateUserLabel,
    markPlayerFieldCleared,
    clearPlayerFieldCleared,
    protectPlayersGlobalPowers,
    countFilledGlobalPower,
    shouldBlockDestructiveGlobalPowerOverwrite,
    STORE_KEYS,
    COMMAND_CENTER_KEY,
    /** Helpers exposés pour tests unitaires (non utilisés par l’UI). */
    __test: {
      mergePlayerRecord,
      mergeCommandCenterStore,
      buildPushPayload,
      rebaseLocalAfterRemote,
      countFilledGlobalPower,
      countFilledGlobalPowerInPlayers,
      protectPlayersGlobalPowers,
      shouldBlockDestructiveGlobalPowerOverwrite,
      mergeGlobalPowerAudit,
      isEmptyFieldValue,
      PROTECTED_NONEMPTY_PLAYER_FIELDS,
      pendingDirty,
    },
  };
})(window);
