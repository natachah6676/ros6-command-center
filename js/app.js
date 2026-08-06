/**
 * Application principale — ROS6 Command Center
 */
(function () {
  const ui = {
    roleSelector: null,
    btnExport: null,
    btnImport: null,
    importFile: null,
    btnReset: null,
    tabs: null,
    confirmModal: null,
    confirmTitle: null,
    confirmMessage: null,
    confirmOk: null,
    confirmCancel: null,
    toastEl: null,
    toastTimer: null,
    confirmResolver: null,
    eventsBound: false,
    btnAddPowerTier: null,
    powerTiersBody: null,
    powerTierModal: null,
    powerTierForm: null,
    powerTierModalTitle: null,
    powerTierId: null,
    powerTierLabel: null,
    powerTierMin: null,
    powerTierMax: null,
    powerTierOrder: null,
  };

  function cacheDom() {
    ui.roleSelector = document.getElementById('roleSelector');
    ui.btnExport = document.getElementById('btnExport');
    ui.btnImport = document.getElementById('btnImport');
    ui.importFile = document.getElementById('importFile');
    ui.btnReset = document.getElementById('btnReset');
    ui.tabs = Array.from(document.querySelectorAll('.tab'));
    ui.confirmModal = document.getElementById('confirmModal');
    ui.confirmTitle = document.getElementById('confirmTitle');
    ui.confirmMessage = document.getElementById('confirmMessage');
    ui.confirmOk = document.getElementById('confirmOk');
    ui.confirmCancel = document.getElementById('confirmCancel');
    ui.toastEl = document.getElementById('toast');
    ui.btnAddPowerTier = document.getElementById('btnAddPowerTier');
    ui.powerTiersBody = document.getElementById('powerTiersBody');
    ui.powerTierModal = document.getElementById('powerTierModal');
    ui.powerTierForm = document.getElementById('powerTierForm');
    ui.powerTierModalTitle = document.getElementById('powerTierModalTitle');
    ui.powerTierId = document.getElementById('powerTierId');
    ui.powerTierLabel = document.getElementById('powerTierLabel');
    ui.powerTierMin = document.getElementById('powerTierMin');
    ui.powerTierMax = document.getElementById('powerTierMax');
    ui.powerTierOrder = document.getElementById('powerTierOrder');
  }

  function toast(message) {
    ui.toastEl.textContent = message;
    ui.toastEl.classList.add('is-visible');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => {
      ui.toastEl.classList.remove('is-visible');
    }, 2800);
  }

  function confirm({ title, message, confirmLabel = 'Confirmer' }) {
    return new Promise((resolve) => {
      ui.confirmResolver = resolve;
      ui.confirmTitle.textContent = title || 'Confirmation';
      ui.confirmMessage.textContent = message || '';
      ui.confirmOk.textContent = confirmLabel;
      ui.confirmModal.showModal();
    });
  }

  function resolveConfirm(value) {
    if (ui.confirmModal.open) ui.confirmModal.close();
    if (ui.confirmResolver) {
      const resolver = ui.confirmResolver;
      ui.confirmResolver = null;
      resolver(value);
    }
  }

  function canAccessSettings() {
    return getEffectiveAppRole() === 'R5';
  }

  function switchTab(tabName) {
    // Paramètres réservés au R5 — bloque aussi un accès forcé (hash / appel JS)
    if (tabName === 'settings' && !canAccessSettings()) {
      toast('Paramètres réservés au rôle R5.');
      tabName = 'command';
    }

    ui.tabs.forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    document.querySelectorAll('.panel').forEach((panel) => {
      const active = panel.id === `panel-${tabName}`;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });

    // Sécurité : panneau Paramètres jamais visible pour un non-R5
    const settingsPanel = document.getElementById('panel-settings');
    if (settingsPanel && !canAccessSettings()) {
      settingsPanel.hidden = true;
      settingsPanel.classList.remove('is-active');
    }

    if (tabName === 'command') CommandModule.render();
    if (tabName === 'players') PlayersModule.render();
    if (tabName === 'vs') VSModule.render();
    if (tabName === 'train' && globalThis.TrainModule) TrainModule.render();
    if (tabName === 'recrutement' && globalThis.RecrutementModule) RecrutementModule.render();
    if (tabName === 'ruche' && globalThis.RucheModule) RucheModule.render();
    if (tabName === 'tempete' && globalThis.TempeteModule) TempeteModule.render();
    if (tabName === 'archives') ArchivesModule.render();
    if (tabName === 'settings' && canAccessSettings()) {
      applyRolePermissions();
      renderPowerTiersSettings();
      if (globalThis.RucheModule) RucheModule.renderSettings();
      if (globalThis.BackupsModule) BackupsModule.render();
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPowerTiersSettings() {
    if (!ui.powerTiersBody) return;
    const state = ROSStorage.getState();
    const tiers = ROSModels.getPowerTiers(state);
    ui.powerTiersBody.innerHTML = tiers
      .map((tier) => {
        const used = ROSModels.countPlayersUsingPowerTier(state, tier.id);
        return `
          <tr data-tier-id="${escapeHtml(tier.id)}">
            <td>${tier.order}</td>
            <td><strong>${escapeHtml(tier.label)}</strong></td>
            <td>${tier.min}</td>
            <td>${tier.max}</td>
            <td>${used} joueur(s)</td>
            <td class="table-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-tier-edit="${escapeHtml(tier.id)}">Modifier</button>
              <button type="button" class="btn btn-danger btn-sm" data-tier-delete="${escapeHtml(tier.id)}">Supprimer</button>
            </td>
          </tr>
        `;
      })
      .join('');
    renderCoachingThresholdSettings(state);
    renderAllianceSettings(state);
  }

  function renderCoachingThresholdSettings(state = ROSStorage.getState()) {
    const th = ROSModels.getCoachingThreshold(state);
    const minEl = document.getElementById('coachingThresholdMin');
    const maxEl = document.getElementById('coachingThresholdMax');
    const preview = document.getElementById('coachingThresholdPreview');
    if (minEl) minEl.value = String(th.min);
    if (maxEl) maxEl.value = String(th.max);
    if (preview) {
      preview.textContent = `Seuil actuel : ${ROSModels.formatCoachingThresholdLabel(th)}`;
    }
  }

  function saveCoachingThreshold() {
    const min = Number(document.getElementById('coachingThresholdMin')?.value);
    const max = Number(document.getElementById('coachingThresholdMax')?.value);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      toast('Le seuil coaching doit être numérique.');
      return;
    }
    ROSStorage.update((state) => {
      state.coachingThreshold = ROSModels.normalizeCoachingThreshold({ min, max });
      return state;
    });
    renderCoachingThresholdSettings();
    if (global.PlayersModule) PlayersModule.render();
    void confirmParameterSaved('Seuil coaching enregistré.');
  }

  function renderAllianceSettings(state = ROSStorage.getState()) {
    const alliance = ROSModels.getAllianceSettings(state);
    const nameEl = document.getElementById('allianceName');
    const tagEl = document.getElementById('allianceTag');
    const serverEl = document.getElementById('allianceServer');
    const langEl = document.getElementById('allianceLanguage');
    if (nameEl) nameEl.value = alliance.name;
    if (tagEl) tagEl.value = alliance.tag;
    if (serverEl) serverEl.value = alliance.server;
    if (langEl) langEl.value = alliance.language;
  }

  function applyBrandIdentity(state = ROSStorage.getState()) {
    const alliance = ROSModels.getAllianceSettings(state);
    const allianceLine = `Alliance : ${alliance.name}`;
    const serverLine = `Serveur : ${alliance.server}`;
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText('brandAllianceLine', allianceLine);
    setText('brandServerLine', serverLine);
    setText(
      'rucheSubtitle',
      `Plan de ruche ${alliance.tag} — 101 cases (10 × 10 + bas) · Maréchal au centre`
    );
    setText(
      'trainCategoriesHint',
      `Désignent les conducteurs — liste livrée avec ${alliance.name}, entièrement modifiable`
    );
    document.title = `WAROPS — ${alliance.tag}`;
    document.documentElement.lang = alliance.language === 'en' ? 'en' : 'fr';
  }

  function saveAllianceSettings() {
    const name = String(document.getElementById('allianceName')?.value || '').trim();
    const tag = String(document.getElementById('allianceTag')?.value || '').trim();
    const server = String(document.getElementById('allianceServer')?.value || '').trim();
    const language = String(document.getElementById('allianceLanguage')?.value || 'fr').trim();
    if (!name) {
      toast('Le nom de l’alliance est obligatoire.');
      return;
    }
    if (!tag) {
      toast('Le tag est obligatoire.');
      return;
    }
    if (!server) {
      toast('Le serveur est obligatoire.');
      return;
    }
    ROSStorage.update((state) => {
      state.alliance = ROSModels.normalizeAllianceSettings({ name, tag, server, language });
      return state;
    });
    renderAllianceSettings();
    applyBrandIdentity();
    void confirmParameterSaved('Alliance enregistrée.');
  }

  async function confirmParameterSaved(successMessage) {
    if (!globalThis.ROSSync || typeof ROSSync.flushPush !== 'function') {
      toast(successMessage);
      return;
    }
    const result = await ROSSync.flushPush();
    if (result?.ok) {
      toast(successMessage);
      return;
    }
    if (result?.reason === 'conflict') return;
    if (result?.reason === 'offline') {
      toast('Hors connexion — modification conservée localement.');
      return;
    }
    if (result?.reason && result.reason !== 'noop') {
      // L’erreur de sync a déjà un toast dédié dans ROSSync.
      return;
    }
    toast(successMessage);
  }

  function openPowerTierModal(tier = null) {
    if (!ui.powerTierModal) return;
    const state = ROSStorage.getState();
    const tiers = ROSModels.getPowerTiers(state);
    if (tier) {
      ui.powerTierModalTitle.textContent = 'Modifier une tranche';
      ui.powerTierId.value = tier.id;
      ui.powerTierLabel.value = tier.label;
      ui.powerTierMin.value = String(tier.min);
      ui.powerTierMax.value = String(tier.max);
      ui.powerTierOrder.value = String(tier.order);
    } else {
      ui.powerTierModalTitle.textContent = 'Ajouter une tranche';
      ui.powerTierId.value = '';
      ui.powerTierLabel.value = '';
      ui.powerTierMin.value = '';
      ui.powerTierMax.value = '';
      const maxOrder = tiers.reduce((acc, t) => Math.max(acc, Number(t.order) || 0), 0);
      ui.powerTierOrder.value = String(maxOrder + 1);
    }
    ui.powerTierModal.showModal();
    ui.powerTierLabel.focus();
  }

  function closePowerTierModal() {
    if (ui.powerTierModal?.open) ui.powerTierModal.close();
  }

  function savePowerTier(event) {
    event.preventDefault();
    const id = (ui.powerTierId.value || '').trim();
    const label = (ui.powerTierLabel.value || '').trim();
    const min = Number(ui.powerTierMin.value);
    const max = Number(ui.powerTierMax.value);
    const order = Number(ui.powerTierOrder.value);

    if (!label) {
      toast('Le libellé est obligatoire.');
      return;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      toast('Minimum et maximum doivent être numériques.');
      return;
    }
    if (min > max) {
      toast('Le minimum ne peut pas dépasser le maximum.');
      return;
    }
    if (!(order > 0)) {
      toast('L’ordre d’affichage doit être un nombre positif.');
      return;
    }

    ROSStorage.update((state) => {
      if (!Array.isArray(state.powerTiers)) state.powerTiers = ROSModels.createDefaultPowerTiers();
      if (id) {
        const tier = state.powerTiers.find((t) => t.id === id);
        if (!tier) return state;
        tier.label = label;
        tier.min = Math.min(min, max);
        tier.max = Math.max(min, max);
        tier.order = order;
      } else {
        state.powerTiers.push(
          ROSModels.normalizePowerTier({
            id: ROSModels.uid('tier'),
            label,
            min,
            max,
            order,
          })
        );
      }
      state.powerTiers = ROSModels.normalizePowerTiers(state.powerTiers);
      return state;
    });

    closePowerTierModal();
    renderPowerTiersSettings();
    void confirmParameterSaved(id ? 'Tranche mise à jour.' : 'Tranche ajoutée.');
  }

  async function deletePowerTier(tierId) {
    const state = ROSStorage.getState();
    const tier = ROSModels.getPowerTierById(state, tierId);
    if (!tier) return;

    const used = ROSModels.countPlayersUsingPowerTier(state, tierId);
    if (used > 0) {
      toast(
        `Suppression impossible : la tranche « ${tier.label} » est utilisée par ${used} joueur(s). Modifiez d’abord leurs fiches.`
      );
      return;
    }

    const ok = await confirm({
      title: 'Supprimer la tranche',
      message: `Confirmer la suppression de la tranche « ${tier.label} » ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;

    ROSStorage.update((current) => {
      current.powerTiers = ROSModels.normalizePowerTiers(
        (current.powerTiers || []).filter((t) => t.id !== tierId)
      );
      if (!current.powerTiers.length) {
        current.powerTiers = ROSModels.createDefaultPowerTiers();
      }
      return current;
    });

    renderPowerTiersSettings();
    void confirmParameterSaved('Tranche supprimée.');
  }

  function getEffectiveAppRole() {
    if (globalThis.ROSProfiles && typeof ROSProfiles.getAppRole === 'function') {
      return ROSProfiles.getAppRole();
    }
    return ROSStorage.getState().appRole || 'R4';
  }

  function applyRolePermissions() {
    const role = getEffectiveAppRole();
    const isR5 = role === 'R5';

    if (ui.roleSelector) {
      ui.roleSelector.value = role;
      // Le rôle vient du profil Supabase — plus de simulation partagée
      ui.roleSelector.disabled = true;
    }
    const canReset = ROSModels.canReset(role);
    ui.btnReset.disabled = !canReset;
    ui.btnReset.title = canReset
      ? 'Réinitialiser toutes les données (R5)'
      : 'Réservé au rôle R5 — suppression d’historique interdite pour R4';

    // Menu Paramètres : visible uniquement pour app_role = R5
    const settingsTab = document.querySelector('.tab[data-tab="settings"]');
    if (settingsTab) {
      settingsTab.classList.toggle('hidden', !isR5);
      settingsTab.hidden = !isR5;
      settingsTab.setAttribute('aria-hidden', isR5 ? 'false' : 'true');
      if (!isR5) {
        settingsTab.setAttribute('tabindex', '-1');
      } else {
        settingsTab.removeAttribute('tabindex');
      }
    }

    const settingsPanel = document.getElementById('panel-settings');
    if (!isR5 && settingsPanel && !settingsPanel.hidden) {
      switchTab('command');
    }

    if (globalThis.ROSProfiles) {
      ROSProfiles.renderOwnAccessSummary?.();
      ROSProfiles.renderAccessPanel?.();
    }
  }

  globalThis.applyAppRolePermissions = applyRolePermissions;

  function renderAll() {
    applyRolePermissions();
    CommandModule.render();
    PlayersModule.render();
    VSModule.render();
    if (globalThis.TrainModule) TrainModule.render();
    if (globalThis.RecrutementModule) RecrutementModule.render();
    if (globalThis.RucheModule) RucheModule.render();
    if (globalThis.TempeteModule) TempeteModule.render();
    ArchivesModule.render();
    NotificationsModule.render();
    renderAllianceSettings();
    applyBrandIdentity();
    if (globalThis.RucheModule?.renderSettings) RucheModule.renderSettings();
    if (globalThis.BackupsModule) BackupsModule.render();
  }

  function onRemoteDataApplied() {
    renderAll();
  }

  function exportData() {
    const json = ROSStorage.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `warops-${ROSModels.getAllianceTag(ROSStorage.getState())}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Export JSON téléchargé.');
  }

  async function importData(file) {
    if (!file) return;

    const role = getEffectiveAppRole();
    if (!ROSModels.canImportOverwrite(role)) {
      toast('Import réservé au R5 : un R4 ne peut pas écraser l’historique.');
      ui.importFile.value = '';
      return;
    }

    const ok = await confirm({
      title: 'Importer une sauvegarde',
      message:
        'Cette action remplacera toutes les données locales actuelles par le contenu du fichier JSON. Continuer ?',
      confirmLabel: 'Importer',
    });
    if (!ok) {
      ui.importFile.value = '';
      return;
    }

    try {
      const text = await file.text();
      ROSStorage.importJSON(text);
      toast('Sauvegarde importée avec succès.');
      renderAll();
    } catch (error) {
      console.error(error);
      toast('Import impossible : fichier JSON invalide.');
    } finally {
      ui.importFile.value = '';
    }
  }

  async function resetData() {
    const role = getEffectiveAppRole();
    if (!ROSModels.canReset(role)) {
      toast('Réinitialisation réservée au R5.');
      return;
    }

    const first = await confirm({
      title: 'Réinitialiser les données',
      message:
        'Première confirmation : toutes les données locales (joueurs, semaines, archives) seront effacées. Cette action est irréversible.',
      confirmLabel: 'Continuer',
    });
    if (!first) return;

    const second = await confirm({
      title: 'Confirmation définitive',
      message:
        'Deuxième confirmation : confirmez-vous la réinitialisation complète de WAROPS ?',
      confirmLabel: 'Réinitialiser définitivement',
    });
    if (!second) return;

    ROSStorage.resetAll();
    toast('Application réinitialisée.');
    renderAll();
  }

  function bindEvents() {
    // Idempotent : peut être appelé avant le bootstrap Supabase (confirm migration)
    // et à nouveau dans startCommandCenter sans doubler les écouteurs.
    if (ui.eventsBound) return;
    ui.eventsBound = true;

    ui.tabs.forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // roleSelector : lecture seule (rôle issu du profil Supabase)

    ui.btnExport.addEventListener('click', exportData);
    ui.btnImport.addEventListener('click', () => ui.importFile.click());
    ui.importFile.addEventListener('change', () => importData(ui.importFile.files[0]));
    ui.btnReset.addEventListener('click', resetData);

    if (ui.btnAddPowerTier) {
      ui.btnAddPowerTier.addEventListener('click', () => openPowerTierModal(null));
    }
    const btnSaveCoaching = document.getElementById('btnSaveCoachingThreshold');
    if (btnSaveCoaching) {
      btnSaveCoaching.addEventListener('click', saveCoachingThreshold);
    }
    const btnSaveAlliance = document.getElementById('btnSaveAlliance');
    if (btnSaveAlliance) {
      btnSaveAlliance.addEventListener('click', saveAllianceSettings);
    }
    if (ui.powerTierForm) {
      ui.powerTierForm.addEventListener('submit', savePowerTier);
    }
    if (ui.powerTierModal) {
      ui.powerTierModal.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', closePowerTierModal);
      });
      ui.powerTierModal.addEventListener('cancel', (event) => {
        event.preventDefault();
        closePowerTierModal();
      });
    }
    if (ui.powerTiersBody) {
      ui.powerTiersBody.addEventListener('click', (event) => {
        const editBtn = event.target.closest('[data-tier-edit]');
        if (editBtn) {
          const tier = ROSModels.getPowerTierById(ROSStorage.getState(), editBtn.dataset.tierEdit);
          if (tier) openPowerTierModal(tier);
          return;
        }
        const deleteBtn = event.target.closest('[data-tier-delete]');
        if (deleteBtn) {
          deletePowerTier(deleteBtn.dataset.tierDelete);
        }
      });
    }

    ui.confirmOk.addEventListener('click', () => resolveConfirm(true));
    ui.confirmCancel.addEventListener('click', () => resolveConfirm(false));
    ui.confirmModal.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => resolveConfirm(false));
    });
    ui.confirmModal.addEventListener('cancel', (event) => {
      event.preventDefault();
      resolveConfirm(false);
    });
  }

  function startCommandCenter() {
    ROSStorage.load();
    PlayersModule.init();
    CommandModule.init();
    NotificationsModule.init();
    VSModule.init();
    ArchivesModule.init();
    if (globalThis.TrainModule) TrainModule.init();
    if (globalThis.RecrutementModule) RecrutementModule.init();
    if (globalThis.RucheModule) RucheModule.init();
    if (globalThis.TempeteModule) TempeteModule.init();
    if (globalThis.BackupsModule) BackupsModule.init();
    bindEvents();

    ROSStorage.subscribe(() => {
      applyRolePermissions();
      applyBrandIdentity();
      CommandModule.render();
      PlayersModule.render();
      VSModule.render();
      if (globalThis.TrainModule) TrainModule.render();
      if (globalThis.RecrutementModule) RecrutementModule.render();
      if (globalThis.RucheModule) RucheModule.render();
      if (globalThis.TempeteModule) TempeteModule.render();
      ArchivesModule.render();
      NotificationsModule.render();
      const settingsPanel = document.getElementById('panel-settings');
      if (settingsPanel && !settingsPanel.hidden) {
        renderPowerTiersSettings();
        if (globalThis.ROSProfiles) {
          ROSProfiles.renderOwnAccessSummary?.();
          ROSProfiles.renderAccessPanel?.();
          ROSSync?.refreshUserLabel?.();
        }
      }
    });

    applyRolePermissions();
    applyBrandIdentity();
    switchTab('command');
    NotificationsModule.render();

    // Rafraîchir les profils à l’ouverture des Paramètres
    ui.tabs.forEach((tab) => {
      if (tab.dataset.tab !== 'settings') return;
      tab.addEventListener('click', async () => {
        if (!globalThis.ROSProfiles) return;
        try {
          await ROSProfiles.refresh();
          ROSProfiles.renderOwnAccessSummary();
          ROSProfiles.renderAccessPanel();
          ROSSync?.refreshUserLabel?.();
          applyRolePermissions();
        } catch (error) {
          console.error(error);
        }
      });
    });

    // Sous-onglet Gestion des accès : rafraîchir la liste à l’ouverture
    document.querySelectorAll('[data-settings-tab="access"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!globalThis.ROSProfiles?.isActiveR5?.()) return;
        try {
          await ROSProfiles.refresh();
          ROSProfiles.renderAccessPanel();
        } catch (error) {
          console.error(error);
        }
      });
    });

    if (globalThis.ROSPlayerIdentity && typeof ROSPlayerIdentity.runRenameIntegrityTest === 'function') {
      const result = ROSPlayerIdentity.runRenameIntegrityTest();
      if (!result.ok) {
        console.error('Test renommage joueur échoué:', result.errors);
        toast('Alerte: le test automatique de renommage a échoué (voir console).');
      } else {
        console.info('Test renommage joueur: OK');
      }
    }
  }

  function init() {
    cacheDom();
    window.AppUI = { toast, confirm, switchTab, onRemoteDataApplied };
    // Avant ROSSync : la migration « Importer vers Supabase » utilise AppUI.confirm
    // et doit pouvoir cliquer #confirmOk immédiatement.
    bindEvents();

    // Identité alliance sur l’écran de connexion (état local si déjà présent)
    try {
      const raw = localStorage.getItem('ros6_command_center_v1');
      if (raw) {
        applyBrandIdentity(ROSModels.normalizeState(JSON.parse(raw)));
      } else {
        applyBrandIdentity({ alliance: ROSModels.createDefaultAllianceSettings() });
      }
    } catch {
      applyBrandIdentity({ alliance: ROSModels.createDefaultAllianceSettings() });
    }

    if (!globalThis.ROSSync || !globalThis.ROSSupabase) {
      toast('Client Supabase indisponible — démarrage local uniquement.');
      document.querySelector('.app')?.classList.remove('hidden');
      document.getElementById('authGate')?.classList.add('hidden');
      startCommandCenter();
      return;
    }

    ROSSync.init({
      onReady: () => startCommandCenter(),
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
