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

  function switchTab(tabName) {
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

    if (tabName === 'command') CommandModule.render();
    if (tabName === 'players') PlayersModule.render();
    if (tabName === 'vs') VSModule.render();
    if (tabName === 'train' && globalThis.TrainModule) TrainModule.render();
    if (tabName === 'ruche' && globalThis.RucheModule) RucheModule.render();
    if (tabName === 'tempete' && globalThis.TempeteModule) TempeteModule.render();
    if (tabName === 'archives') ArchivesModule.render();
    if (tabName === 'settings') {
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
    toast(id ? 'Tranche mise à jour.' : 'Tranche ajoutée.');
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
    toast('Tranche supprimée.');
  }

  function applyRolePermissions() {
    const role = ROSStorage.getState().appRole;
    ui.roleSelector.value = role;
    const canReset = ROSModels.canReset(role);
    ui.btnReset.disabled = !canReset;
    ui.btnReset.title = canReset
      ? 'Réinitialiser toutes les données (R5)'
      : 'Réservé au rôle R5 — suppression d’historique interdite pour R4';
  }

  function renderAll() {
    applyRolePermissions();
    CommandModule.render();
    PlayersModule.render();
    VSModule.render();
    if (globalThis.TrainModule) TrainModule.render();
    if (globalThis.RucheModule) RucheModule.render();
    if (globalThis.TempeteModule) TempeteModule.render();
    ArchivesModule.render();
    NotificationsModule.render();
  }

  function exportData() {
    const json = ROSStorage.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `ros6-command-center-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Export JSON téléchargé.');
  }

  async function importData(file) {
    if (!file) return;

    const role = ROSStorage.getState().appRole;
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
    const role = ROSStorage.getState().appRole;
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
        'Deuxième confirmation : confirmez-vous la réinitialisation complète de ROS6 Command Center ?',
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

    ui.roleSelector.addEventListener('change', () => {
      ROSStorage.update((state) => {
        state.appRole = ui.roleSelector.value;
        return state;
      });
      applyRolePermissions();
      toast(`Connexion simulée : ${ui.roleSelector.value}`);
    });

    ui.btnExport.addEventListener('click', exportData);
    ui.btnImport.addEventListener('click', () => ui.importFile.click());
    ui.importFile.addEventListener('change', () => importData(ui.importFile.files[0]));
    ui.btnReset.addEventListener('click', resetData);

    if (ui.btnAddPowerTier) {
      ui.btnAddPowerTier.addEventListener('click', () => openPowerTierModal(null));
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
    if (globalThis.RucheModule) RucheModule.init();
    if (globalThis.TempeteModule) TempeteModule.init();
    if (globalThis.BackupsModule) BackupsModule.init();
    bindEvents();

    ROSStorage.subscribe(() => {
      applyRolePermissions();
      CommandModule.render();
      PlayersModule.render();
      VSModule.render();
      if (globalThis.TrainModule) TrainModule.render();
      if (globalThis.RucheModule) RucheModule.render();
      if (globalThis.TempeteModule) TempeteModule.render();
      ArchivesModule.render();
      NotificationsModule.render();
      const settingsPanel = document.getElementById('panel-settings');
      if (settingsPanel && !settingsPanel.hidden) renderPowerTiersSettings();
    });

    applyRolePermissions();
    switchTab('command');
    NotificationsModule.render();

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
    window.AppUI = { toast, confirm, switchTab };
    // Avant ROSSync : la migration « Importer vers Supabase » utilise AppUI.confirm
    // et doit pouvoir cliquer #confirmOk immédiatement.
    bindEvents();

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
