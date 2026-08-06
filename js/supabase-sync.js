/**
 * Authentification Supabase + synchronisation de l’état partagé (ros6_state / main).
 * localStorage reste un cache de secours — ne remplace jamais une version distante plus récente.
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
      if (!raw) return { version: 0 };
      const parsed = JSON.parse(raw);
      return { version: Number(parsed.version) || 0 };
    } catch (error) {
      return { version: 0 };
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

  function collectStores() {
    const stores = {};
    STORE_KEYS.forEach((key) => {
      if (key === 'ros6_command_center_v1' && global.ROSStorage) {
        try {
          stores[key] = ROSStorage.getState();
          return;
        } catch (error) {
          /* fallback localStorage */
        }
      }
      const raw = localStorage.getItem(key);
      if (raw != null) stores[key] = parseStoreValue(raw);
    });
    return {
      appName: 'WAROPS',
      stores,
      collectedAt: new Date().toISOString(),
    };
  }

  function localHasUsefulData() {
    return STORE_KEYS.some((key) => {
      const raw = localStorage.getItem(key);
      if (!raw || raw === '{}' || raw === 'null') return false;
      try {
        const parsed = JSON.parse(raw);
        if (key === 'ros6_command_center_v1') {
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

  async function pushToSupabase({ force = false } = {}) {
    if (!session || !client || suppressPush) return { ok: false, reason: 'noop' };
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return { ok: false, reason: 'offline' };
    }

    // Sérialise via une file de promises (flushPush attend la fin du push en cours).
    const run = () => runPushAttempt({ force });
    const resultPromise = pushChain.then(run, run);
    pushChain = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }

  async function runPushAttempt({ force = false } = {}) {
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

        if (!force && isExternalRemoteConflict(remoteVersion)) {
          // Autre appareil / autre utilisateur : adopter Supabase, mettre à jour le cache, pas de reload.
          writeMeta(remoteVersion);
          applyStoresToLocal(remote.data || {}, { reload: false });
          hydrateAppFromLocalCache();
          setSyncStatus('synced', 'mis à jour depuis Supabase');
          if (global.AppUI) {
            await AppUI.confirm({
              title: 'Données plus récentes détectées',
              message:
                'Un autre appareil ou un autre utilisateur a modifié les données partagées. Le cache local a été mis à jour avec la version Supabase.',
              confirmLabel: 'OK',
            });
          }
          lastResult = { ok: false, reason: 'conflict' };
          pushQueued = false;
          break;
        }

        if (!force && remoteVersion > localVersion && ownPushedVersions.has(remoteVersion)) {
          writeMeta(remoteVersion);
        }

        const payload = collectStores();
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

        // Succès Supabase → puis mise à jour du cache local (méta + stores), sans reload.
        ownPushedVersions.add(nextVersion);
        writeMeta(nextVersion);
        applyStoresToLocal(payload, { reload: false });
        setSyncStatus('synced');
        lastResult = { ok: true, version: nextVersion };
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

  function schedulePush() {
    if (!bootstrapped || !session || suppressPush) return;
    setSyncStatus('saving');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushToSupabase();
    }, 500);
  }

  /** Annule le debounce et pousse immédiatement (attend la confirmation Supabase). */
  async function flushPush() {
    if (!bootstrapped || !session || suppressPush) return { ok: false, reason: 'noop' };
    clearTimeout(pushTimer);
    pushTimer = null;
    return pushToSupabase();
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
    AppUI.toast('Données locales importées dans Supabase.');
    return true;
  }

  async function confirmOverwriteRemoteIfNeeded(remote) {
    if (remoteIsEmpty(remote?.data)) return true;
    // Ne jamais écraser une base déjà remplie sans confirmation explicite
    // (utilisé uniquement si une action volontaire le demande — bootstrap ne l’appelle pas)
    return AppUI.confirm({
      title: 'Écraser la base partagée ?',
      message:
        'La base Supabase contient déjà des données. Confirmez-vous vouloir les remplacer par les données locales ?',
      confirmLabel: 'Écraser Supabase',
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
        // Toujours préférer Supabase au chargement ; le cache local ne gagne jamais s’il est plus ancien
        if (remoteVersion >= localVersion || localVersion === 0) {
          applyStoresToLocal(remote.data, { reload: false });
          writeMeta(remoteVersion);
        } else if (remoteVersion < localVersion) {
          // Cache local prétend être plus récent : ne pas écraser Supabase sans confirmation
          const overwrite = await confirmOverwriteRemoteIfNeeded(remote);
          if (overwrite) {
            await pushToSupabase({ force: true });
          } else {
            applyStoresToLocal(remote.data, { reload: false });
            writeMeta(remoteVersion);
            AppUI.toast('Version Supabase conservée (cache local ignoré).');
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

  global.ROSSync = {
    init,
    schedulePush,
    flushPush,
    pushNow: () => flushPush(),
    getSession: () => session,
    refreshUserLabel: updateUserLabel,
    STORE_KEYS,
  };
})(window);
