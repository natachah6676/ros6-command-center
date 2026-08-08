/**
 * Profils utilisateurs Supabase — administration des accès réservée au R5.
 * Le pseudo affiché = joueur associé (attribué uniquement par le R5).
 */
(function (global) {
  const TABLE = 'ros6_user_profiles';
  const APP_ROLES = ['R4', 'R5'];
  const STATUSES = ['Actif', 'Désactivé'];

  let profilesByUserId = {};
  let currentProfile = null;
  let loaded = false;
  let uiBound = false;

  function client() {
    return global.ROSSupabase ? ROSSupabase.getClient() : null;
  }

  function escapeHtml(value) {
    if (global.ROSUI && typeof ROSUI.escapeHtml === 'function') {
      return ROSUI.escapeHtml(value);
    }
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sessionUser() {
    const session =
      global.ROSSync && typeof ROSSync.getSession === 'function' ? ROSSync.getSession() : null;
    return session?.user || null;
  }

  function normalizeProfile(row) {
    if (!row || !row.user_id) return null;
    const role = APP_ROLES.includes(row.app_role) ? row.app_role : 'R4';
    const status = STATUSES.includes(row.status) ? row.status : 'Actif';
    return {
      userId: String(row.user_id),
      email: String(row.email || '').trim(),
      playerId: row.player_id ? String(row.player_id) : null,
      role,
      status,
      lastSignInAt: row.last_sign_in_at || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    };
  }

  function setCache(rows) {
    profilesByUserId = {};
    (rows || []).forEach((row) => {
      const profile = normalizeProfile(row);
      if (profile) profilesByUserId[profile.userId] = profile;
    });
    const user = sessionUser();
    currentProfile = user ? profilesByUserId[user.id] || null : null;
    loaded = true;
  }

  function getPlayerById(playerId) {
    if (!playerId || !global.ROSStorage) return null;
    try {
      return ROSStorage.getPlayerById(playerId);
    } catch (error) {
      return null;
    }
  }

  function displayNameForPlayerId(playerId) {
    const player = getPlayerById(playerId);
    const pseudo = player?.pseudo ? String(player.pseudo).trim() : '';
    return pseudo || null;
  }

  /** Pseudo du joueur associé uniquement (jamais l’e-mail). */
  function displayNameForProfile(profile) {
    if (!profile) return '';
    return displayNameForPlayerId(profile.playerId) || '';
  }

  /**
   * Identité logicielle : pseudo du joueur associé.
   * Sans joueur : « Sans joueur » (pas d’e-mail dans les actions).
   * allowEmail: true uniquement pour l’en-tête de connexion temporaire.
   */
  function getDisplayName(options = {}) {
    if (currentProfile) {
      const pseudo = displayNameForProfile(currentProfile);
      if (pseudo) return pseudo;
      if (options.allowEmail) return currentProfile.email || '';
      return 'Sans joueur';
    }
    const user = sessionUser();
    if (options.allowEmail) return user?.email || user?.id || '';
    return user?.email || 'Sans joueur';
  }

  function getAppRole() {
    if (currentProfile && APP_ROLES.includes(currentProfile.role)) {
      return currentProfile.role;
    }
    try {
      const shared = global.ROSStorage ? ROSStorage.getState()?.appRole : null;
      if (APP_ROLES.includes(shared)) return shared;
    } catch (error) {
      /* ignore */
    }
    return 'R4';
  }

  function isAccessAllowed() {
    if (!currentProfile) return true;
    return currentProfile.status === 'Actif';
  }

  function isActiveR5() {
    return isAccessAllowed() && getAppRole() === 'R5';
  }

  /** R4 ou R5 actif — droits d’édition opérationnels (ex. puissance globale). */
  function isActiveR4OrR5() {
    if (!isAccessAllowed()) return false;
    const role = getAppRole();
    return role === 'R5' || role === 'R4';
  }

  function getCurrentProfile() {
    return currentProfile;
  }

  function listProfiles() {
    return Object.values(profilesByUserId).sort((a, b) =>
      String(a.email || '').localeCompare(String(b.email || ''), 'fr', { sensitivity: 'base' })
    );
  }

  function findProfileByPlayerId(playerId, exceptUserId) {
    if (!playerId) return null;
    return listProfiles().find(
      (p) => p.playerId === playerId && (!exceptUserId || p.userId !== exceptUserId)
    );
  }

  function stampActor() {
    const user = sessionUser();
    const userId = user?.id || '';
    const playerId = currentProfile?.playerId || null;
    const label = getDisplayName({ allowEmail: false });
    return {
      actorUserId: userId,
      actorPlayerId: playerId,
      actorLabel: label,
    };
  }

  function resolveActor(record) {
    if (!record || typeof record !== 'object') return '—';

    const userId = record.actorUserId || record.closedByUserId || record.checkedByUserId || '';
    if (userId && profilesByUserId[userId]) {
      const name = displayNameForProfile(profilesByUserId[userId]);
      if (name) return name;
    }

    const playerId =
      record.actorPlayerId || record.closedByPlayerId || record.checkedByPlayerId || '';
    const livePseudo = displayNameForPlayerId(playerId);
    if (livePseudo) return livePseudo;

    const legacy =
      record.actorLabel ||
      record.checkedBy ||
      record.contactedBy ||
      record.closedBy ||
      record.archivedBy ||
      '';
    const legacyStr = String(legacy || '').trim();
    if (legacyStr.includes('@')) {
      const byEmail = listProfiles().find(
        (p) => p.email.toLowerCase() === legacyStr.toLowerCase()
      );
      if (byEmail) {
        const name = displayNameForProfile(byEmail);
        if (name) return name;
      }
      return 'Sans joueur';
    }
    if (legacyStr) return legacyStr;
    return '—';
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function fetchAll() {
    const c = client();
    if (!c) return [];
    const { data, error } = await c.from(TABLE).select('*').order('email', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function refresh() {
    const rows = await fetchAll();
    setCache(rows);
    return listProfiles();
  }

  async function touchLastSignIn(userId) {
    if (!userId) return;
    const now = new Date().toISOString();
    const { error } = await client()
      .from(TABLE)
      .update({ last_sign_in_at: now, updated_at: now })
      .eq('user_id', userId);
    if (!error && profilesByUserId[userId]) {
      profilesByUserId[userId].lastSignInAt = now;
      if (currentProfile?.userId === userId) currentProfile.lastSignInAt = now;
    }
  }

  async function ensureOwnProfile() {
    const user = sessionUser();
    if (!user) {
      currentProfile = null;
      return null;
    }

    const rows = await fetchAll();
    setCache(rows);

    if (profilesByUserId[user.id]) {
      const email = String(user.email || '').trim();
      if (email && profilesByUserId[user.id].email !== email) {
        await client()
          .from(TABLE)
          .update({ email, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
        profilesByUserId[user.id].email = email;
        currentProfile = profilesByUserId[user.id];
      }
      await touchLastSignIn(user.id);
      return currentProfile;
    }

    // Migration : première connexion → profil auto (aucune donnée perdue)
    const hasR5 = rows.some((r) => r.app_role === 'R5' && r.status === 'Actif');
    const insertRow = {
      user_id: user.id,
      email: String(user.email || '').trim(),
      player_id: null,
      app_role: hasR5 ? 'R4' : 'R5',
      status: 'Actif',
      last_sign_in_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client().from(TABLE).insert(insertRow).select('*').single();
    if (error) {
      if (error.code === '23505') {
        await refresh();
        await touchLastSignIn(user.id);
        return currentProfile;
      }
      throw error;
    }

    const profile = normalizeProfile(data);
    profilesByUserId[profile.userId] = profile;
    currentProfile = profile;
    loaded = true;
    return profile;
  }

  async function updateProfile(userId, patch) {
    if (!userId) throw new Error('user_id manquant');
    if (!isActiveR5()) throw new Error('Seul le R5 peut modifier les accès.');

    const existing = profilesByUserId[userId];
    if (!existing) throw new Error('Profil introuvable.');

    const updates = { updated_at: new Date().toISOString() };

    if (Object.prototype.hasOwnProperty.call(patch, 'playerId')) {
      const nextPlayerId = patch.playerId || null;
      if (nextPlayerId) {
        const taken = findProfileByPlayerId(nextPlayerId, userId);
        if (taken) {
          throw new Error(
            `Ce joueur est déjà associé au compte ${taken.email || taken.userId}.`
          );
        }
      }
      updates.player_id = nextPlayerId;
    }

    if (patch.role && APP_ROLES.includes(patch.role)) {
      if (
        existing.role === 'R5' &&
        patch.role === 'R4' &&
        listProfiles().filter((p) => p.role === 'R5' && p.status === 'Actif' && p.userId !== userId)
          .length === 0
      ) {
        throw new Error('Impossible : il doit rester au moins un R5 actif.');
      }
      updates.app_role = patch.role;
    }

    if (patch.status && STATUSES.includes(patch.status)) {
      if (
        patch.status === 'Désactivé' &&
        existing.role === 'R5' &&
        listProfiles().filter((p) => p.role === 'R5' && p.status === 'Actif' && p.userId !== userId)
          .length === 0
      ) {
        throw new Error('Impossible de désactiver le dernier R5 actif.');
      }
      updates.status = patch.status;
    }

    const { data, error } = await client()
      .from(TABLE)
      .update(updates)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new Error('Ce joueur est déjà associé à un autre compte.');
      }
      throw error;
    }

    await refresh();
    return normalizeProfile(data);
  }

  /**
   * Création / association via Edge Function admin-create-user uniquement.
   * Aucun UUID local, aucune création Auth depuis le navigateur.
   */
  async function createUser({ email, password, playerId, role }) {
    if (!isActiveR5()) {
      throw new Error('Seul un R5 actif peut créer un utilisateur.');
    }

    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    const cleanPlayerId = String(playerId || '').trim();
    const cleanRole = APP_ROLES.includes(role) ? role : 'R4';

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Adresse e-mail invalide.');
    }
    if (cleanPassword.length < 6) {
      throw new Error('Mot de passe temporaire : 6 caractères minimum.');
    }
    if (!cleanPlayerId) {
      throw new Error('Associez un joueur actif (obligatoire).');
    }
    if (!getPlayerById(cleanPlayerId) || getPlayerById(cleanPlayerId).status !== 'Actif') {
      throw new Error('Le joueur associé doit être un joueur actif.');
    }

    const taken = findProfileByPlayerId(cleanPlayerId);
    if (taken) {
      throw new Error('Ce joueur possède déjà un accès.');
    }

    const c = client();
    if (!c) throw new Error('Client Supabase indisponible.');

    const { data, error } = await c.functions.invoke('admin-create-user', {
      body: {
        email: cleanEmail,
        password: cleanPassword,
        player_id: cleanPlayerId,
        app_role: cleanRole,
        status: 'Actif',
      },
    });

    let payload = data && typeof data === 'object' ? data : null;

    // Corps d’erreur HTTP de l’Edge Function (4xx/5xx)
    if (error && (!payload || payload.ok !== true)) {
      try {
        if (error.context && typeof error.context.json === 'function') {
          const parsed = await error.context.json();
          if (parsed && typeof parsed === 'object') payload = parsed;
        }
      } catch (parseErr) {
        /* ignore */
      }
    }

    if (payload?.ok === true) {
      await refresh();
      return normalizeProfile(payload.profile);
    }

    const raw =
      payload?.error ||
      error?.message ||
      'Création impossible.';
    if (/Failed to send|FunctionsFetchError|not found|404/i.test(String(raw))) {
      throw new Error(
        'Fonction admin-create-user introuvable. Déployez-la (voir SUPABASE-USER-SETUP.md).'
      );
    }
    throw new Error(translateCreateError(raw));
  }

  function translateCreateError(raw) {
    const msg = String(raw || '').trim();
    if (!msg) return 'Création impossible.';
    if (/Seul un R5/i.test(msg)) return 'Seul un R5 actif peut créer un utilisateur.';
    if (/joueur possède déjà|déjà un accès|player/i.test(msg) && /accès|associé/i.test(msg)) {
      return 'Ce joueur possède déjà un accès.';
    }
    if (/adresse est déjà associée|déjà associée à un joueur/i.test(msg)) {
      return 'Cette adresse est déjà associée à un joueur.';
    }
    if (/profil n.a pas pu|foreign key|user_id_fkey/i.test(msg)) {
      return 'Le compte existe mais son profil n’a pas pu être créé.';
    }
    return msg;
  }

  async function resetPassword(email, newPassword) {
    if (!isActiveR5()) throw new Error('Seul le R5 peut réinitialiser un mot de passe.');
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(newPassword || '');
    if (!cleanEmail) throw new Error('E-mail manquant.');
    if (cleanPassword.length < 6) {
      throw new Error('Nouveau mot de passe : 6 caractères minimum.');
    }

    // Tentative Edge Function (si déployée) — sinon e-mail de récupération Supabase
    try {
      const { data, error } = await client().functions.invoke('ros6-manage-user', {
        body: {
          action: 'set_password',
          email: cleanEmail,
          password: cleanPassword,
        },
      });
      if (!error && data?.ok) {
        return { mode: 'set', message: 'Mot de passe temporaire défini.' };
      }
    } catch (fnError) {
      /* fonction absente → fallback */
    }

    const { error } = await client().auth.resetPasswordForEmail(cleanEmail);
    if (error) throw error;
    return {
      mode: 'email',
      message:
        'E-mail de réinitialisation envoyé. (Pour définir un mot de passe temporaire directement, déployez la Edge Function ros6-manage-user.)',
    };
  }

  function activePlayersOptions(selectedId, { required = false, excludeTakenBy = null } = {}) {
    const players = (global.ROSStorage ? ROSStorage.getActivePlayers() : [])
      .slice()
      .sort((a, b) =>
        String(a.pseudo || '').localeCompare(String(b.pseudo || ''), 'fr', { sensitivity: 'base' })
      );

    const opts = required
      ? [`<option value="">— Choisir un joueur —</option>`]
      : [`<option value="">— Aucun joueur —</option>`];

    players.forEach((p) => {
      const taken = findProfileByPlayerId(p.id, excludeTakenBy);
      if (taken && p.id !== selectedId) return;
      const sel = p.id === selectedId ? ' selected' : '';
      opts.push(`<option value="${escapeHtml(p.id)}"${sel}>${escapeHtml(p.pseudo)}</option>`);
    });

    if (selectedId && !players.some((p) => p.id === selectedId)) {
      const orphan = getPlayerById(selectedId);
      const label = orphan?.pseudo || selectedId;
      opts.push(
        `<option value="${escapeHtml(selectedId)}" selected>${escapeHtml(label)} (inactif)</option>`
      );
    }
    return opts.join('');
  }

  function switchSettingsTab(tabName) {
    const generalPane = document.getElementById('settingsPaneGeneral');
    const trainPane = document.getElementById('settingsPaneTrain');
    const accessPane = document.getElementById('settingsPaneAccess');
    document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      const active = btn.dataset.settingsTab === tabName;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (generalPane) generalPane.classList.toggle('hidden', tabName !== 'general');
    if (trainPane) trainPane.classList.toggle('hidden', tabName !== 'train');
    if (accessPane) accessPane.classList.toggle('hidden', tabName !== 'access');
    if (tabName === 'train' && global.TrainModule) {
      if (typeof TrainModule.renderSettingsHistoryAdmin === 'function') {
        TrainModule.renderSettingsHistoryAdmin();
      } else if (typeof TrainModule.render === 'function') {
        TrainModule.render();
      }
    }
  }

  function renderAccessPanel() {
    const block = document.getElementById('accessManagementBlock');
    const tabBtn = document.getElementById('settingsTabAccess');
    const root = document.getElementById('accessProfilesList');
    const empty = document.getElementById('accessProfilesEmpty');
    const show = isActiveR5();

    if (tabBtn) tabBtn.classList.toggle('hidden', !show);
    if (block) block.classList.toggle('hidden', !show);

    if (!show) {
      const accessPane = document.getElementById('settingsPaneAccess');
      if (accessPane && !accessPane.classList.contains('hidden')) {
        switchSettingsTab('general');
      }
      return;
    }

    if (!root) return;
    const profiles = listProfiles();
    if (empty) empty.classList.toggle('hidden', profiles.length > 0);

    root.innerHTML = `
      <div class="table-wrap">
        <table class="data-table access-table">
          <thead>
            <tr>
              <th>E-mail</th>
              <th>Joueur associé</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Dernière connexion</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              profiles.length
                ? profiles
                    .map((profile) => {
                      const pseudo = displayNameForProfile(profile) || '—';
                      return `
              <tr data-access-user="${escapeHtml(profile.userId)}">
                <td>
                  <strong>${escapeHtml(profile.email || profile.userId)}</strong>
                  <div class="panel-subtitle">Affichage : ${escapeHtml(pseudo)}</div>
                </td>
                <td>
                  <select class="input" data-access-player="${escapeHtml(profile.userId)}">
                    ${activePlayersOptions(profile.playerId, {
                      required: false,
                      excludeTakenBy: profile.userId,
                    })}
                  </select>
                </td>
                <td>
                  <select class="input" data-access-role="${escapeHtml(profile.userId)}">
                    <option value="R4"${profile.role === 'R4' ? ' selected' : ''}>R4</option>
                    <option value="R5"${profile.role === 'R5' ? ' selected' : ''}>R5</option>
                  </select>
                </td>
                <td>
                  <span class="badge ${profile.status === 'Actif' ? 'badge-role' : 'badge-absent'}">
                    ${escapeHtml(profile.status)}
                  </span>
                </td>
                <td>${escapeHtml(formatDateTime(profile.lastSignInAt))}</td>
                <td class="access-actions">
                  <button type="button" class="btn btn-primary btn-sm" data-access-save="${escapeHtml(profile.userId)}">Enregistrer</button>
                  ${
                    profile.status === 'Actif'
                      ? `<button type="button" class="btn btn-ghost btn-sm" data-access-disable="${escapeHtml(profile.userId)}">Désactiver</button>`
                      : `<button type="button" class="btn btn-ghost btn-sm" data-access-enable="${escapeHtml(profile.userId)}">Réactiver</button>`
                  }
                  <button type="button" class="btn btn-ghost btn-sm" data-access-reset="${escapeHtml(profile.userId)}">Réinit. MDP</button>
                </td>
              </tr>`;
                    })
                    .join('')
                : ''
            }
          </tbody>
        </table>
      </div>
    `;
  }

  function fillCreatePlayerSelect() {
    const select = document.getElementById('accessCreatePlayer');
    if (!select) return;
    select.innerHTML = activePlayersOptions('', { required: true });
  }

  function openCreateModal() {
    if (!isActiveR5()) return;
    const modal = document.getElementById('accessCreateModal');
    if (!modal) return;
    const form = document.getElementById('accessCreateForm');
    form?.reset();
    fillCreatePlayerSelect();
    const role = document.getElementById('accessCreateRole');
    if (role) role.value = 'R4';
    const err = document.getElementById('accessCreateError');
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    modal.showModal();
  }

  function closeCreateModal() {
    document.getElementById('accessCreateModal')?.close();
  }

  function openResetModal(userId) {
    const profile = profilesByUserId[userId];
    if (!profile || !isActiveR5()) return;
    const modal = document.getElementById('accessResetModal');
    const emailEl = document.getElementById('accessResetEmail');
    const userEl = document.getElementById('accessResetUserId');
    const passEl = document.getElementById('accessResetPassword');
    const err = document.getElementById('accessResetError');
    if (!modal) return;
    if (emailEl) emailEl.value = profile.email;
    if (userEl) userEl.value = profile.userId;
    if (passEl) passEl.value = '';
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    modal.showModal();
  }

  function closeResetModal() {
    document.getElementById('accessResetModal')?.close();
  }

  async function onAccessClick(event) {
    const saveBtn = event.target.closest('[data-access-save]');
    const disableBtn = event.target.closest('[data-access-disable]');
    const enableBtn = event.target.closest('[data-access-enable]');
    const resetBtn = event.target.closest('[data-access-reset]');
    const addBtn = event.target.closest('#btnAccessAddUser');

    if (addBtn) {
      openCreateModal();
      return;
    }

    if (resetBtn) {
      openResetModal(resetBtn.dataset.accessReset);
      return;
    }

    const userId =
      saveBtn?.dataset.accessSave ||
      disableBtn?.dataset.accessDisable ||
      enableBtn?.dataset.accessEnable;
    if (!userId) return;

    const row = document.querySelector(`tr[data-access-user="${userId}"]`);
    const btn = saveBtn || disableBtn || enableBtn;
    if (btn) btn.disabled = true;

    try {
      if (disableBtn) {
        const ok = global.AppUI
          ? await AppUI.confirm({
              title: 'Désactiver l’accès',
              message: 'Cet utilisateur ne pourra plus se connecter. Continuer ?',
              confirmLabel: 'Désactiver',
            })
          : true;
        if (!ok) return;
        await updateProfile(userId, { status: 'Désactivé' });
        if (global.AppUI) AppUI.toast('Utilisateur désactivé.');
      } else if (enableBtn) {
        await updateProfile(userId, { status: 'Actif' });
        if (global.AppUI) AppUI.toast('Utilisateur réactivé.');
      } else if (saveBtn && row) {
        const playerId = row.querySelector(`[data-access-player="${userId}"]`)?.value || '';
        const role = row.querySelector(`[data-access-role="${userId}"]`)?.value || 'R4';
        await updateProfile(userId, { playerId: playerId || null, role });
        if (global.AppUI) AppUI.toast('Accès mis à jour.');
      }
      renderAccessPanel();
      renderOwnAccessSummary();
      if (global.ROSSync?.refreshUserLabel) ROSSync.refreshUserLabel();
      if (typeof global.applyAppRolePermissions === 'function') {
        global.applyAppRolePermissions();
      }
    } catch (error) {
      console.error(error);
      if (global.AppUI) AppUI.toast(`Erreur accès : ${error.message || error}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function onCreateSubmit(event) {
    event.preventDefault();
    const err = document.getElementById('accessCreateError');
    const btn = document.getElementById('accessCreateSubmit');
    const email = document.getElementById('accessCreateEmail')?.value || '';
    const password = document.getElementById('accessCreatePassword')?.value || '';
    const playerId = document.getElementById('accessCreatePlayer')?.value || '';
    const role = document.getElementById('accessCreateRole')?.value || 'R4';

    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    if (btn) btn.disabled = true;
    try {
      await createUser({ email, password, playerId, role });
      closeCreateModal();
      renderAccessPanel();
      if (global.AppUI) {
        AppUI.toast('Utilisateur créé et associé avec succès');
      }
    } catch (error) {
      console.error(error);
      if (err) {
        err.textContent = error.message || String(error);
        err.classList.remove('hidden');
      } else if (global.AppUI) {
        AppUI.toast(`Création impossible : ${error.message || error}`);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function onResetSubmit(event) {
    event.preventDefault();
    const err = document.getElementById('accessResetError');
    const btn = document.getElementById('accessResetSubmit');
    const email = document.getElementById('accessResetEmail')?.value || '';
    const password = document.getElementById('accessResetPassword')?.value || '';
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    if (btn) btn.disabled = true;
    try {
      const result = await resetPassword(email, password);
      closeResetModal();
      if (global.AppUI) AppUI.toast(result.message);
    } catch (error) {
      console.error(error);
      if (err) {
        err.textContent = error.message || String(error);
        err.classList.remove('hidden');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindAccessUi() {
    if (uiBound) return;
    uiBound = true;

    const panel = document.getElementById('panel-settings');
    panel?.addEventListener('click', onAccessClick);

    document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchSettingsTab(btn.dataset.settingsTab));
    });

    document.getElementById('accessCreateForm')?.addEventListener('submit', onCreateSubmit);
    document.getElementById('accessResetForm')?.addEventListener('submit', onResetSubmit);
    document.querySelectorAll('[data-close-access-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeCreateModal();
        closeResetModal();
      });
    });
  }

  function renderOwnAccessSummary() {
    const label = document.getElementById('ownAccessSummary');
    if (!label) return;
    const role = getAppRole();
    const name = getDisplayName({ allowEmail: true }) || '—';
    label.textContent = `${name} · ${role}${
      currentProfile?.status === 'Désactivé' ? ' · Désactivé' : ''
    }`;
  }

  global.ROSProfiles = {
    ensureOwnProfile,
    refresh,
    getCurrentProfile,
    getDisplayName,
    getAppRole,
    isAccessAllowed,
    isActiveR5,
    isActiveR4OrR5,
    listProfiles,
    updateProfile,
    createUser,
    resetPassword,
    stampActor,
    resolveActor,
    renderAccessPanel,
    renderOwnAccessSummary,
    bindAccessUi,
    switchSettingsTab,
    isLoaded: () => loaded,
  };
})(window);
