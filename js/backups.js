/**
 * Sauvegardes automatiques locales — max 1/jour, 10 plus récentes.
 * Couvre toutes les stores applicatives (pas seulement l’UI).
 */
(function (global) {
  const BACKUPS_KEY = 'ros6_backups_v1';
  const MAX_BACKUPS = 10;

  const DATA_KEYS = [
    'ros6_command_center_v1',
    'ros6_train_v1',
    'ros6_ruche_v1',
    'ros6_tempete_v1',
  ];

  const els = {};

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function loadIndex() {
    try {
      const raw = localStorage.getItem(BACKUPS_KEY);
      if (!raw) return { version: 1, backups: [] };
      const parsed = JSON.parse(raw);
      const backups = Array.isArray(parsed.backups) ? parsed.backups : [];
      return { version: 1, backups };
    } catch (error) {
      console.error('Sauvegardes: index illisible', error);
      return { version: 1, backups: [] };
    }
  }

  function saveIndex(index) {
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(index));
    if (global.ROSSync && typeof ROSSync.schedulePush === 'function') {
      ROSSync.schedulePush();
    }
  }

  function captureSnapshot() {
    const data = {};
    DATA_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value != null) data[key] = value;
    });
    if (global.ROSStorage && typeof ROSStorage.getState === 'function') {
      try {
        data.ros6_command_center_v1 = JSON.stringify(ROSStorage.getState());
      } catch (error) {
        console.error('Sauvegardes: capture centre', error);
      }
    }
    return data;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  function pruneToMax(backups) {
    return backups
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, MAX_BACKUPS);
  }

  function createBackup(kind = 'manual') {
    const createdAt = new Date().toISOString();
    const day = createdAt.slice(0, 10);
    const index = loadIndex();

    if (kind === 'auto') {
      const hasTodayAuto = index.backups.some(
        (b) => b.kind === 'auto' && String(b.createdAt || '').slice(0, 10) === day
      );
      if (hasTodayAuto) return { created: false, reason: 'already_today' };
    }

    const data = captureSnapshot();
    const payload = JSON.stringify({
      appName: 'ROS6 Command Center',
      backupVersion: 1,
      kind,
      createdAt,
      data,
    });

    const entry = {
      id: uid('backup'),
      kind,
      createdAt,
      size: payload.length,
      payload,
    };

    index.backups = pruneToMax([entry, ...index.backups]);
    saveIndex(index);
    return { created: true, entry };
  }

  function ensureDailyAutoBackup() {
    return createBackup('auto');
  }

  function listBackups() {
    return loadIndex()
      .backups.slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  function getBackup(id) {
    return listBackups().find((b) => b.id === id) || null;
  }

  function parseBackupPayload(entry) {
    if (!entry || !entry.payload) throw new Error('Sauvegarde vide');
    const parsed = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
    if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
      throw new Error('Structure de sauvegarde invalide');
    }
    return parsed;
  }

  function restoreBackup(id) {
    const entry = getBackup(id);
    if (!entry) throw new Error('Sauvegarde introuvable');

    let parsed;
    try {
      parsed = parseBackupPayload(entry);
    } catch (error) {
      throw new Error('Sauvegarde corrompue — données actuelles non modifiées');
    }

    // Vérifier que chaque store critique est du JSON valide avant d’écrire
    try {
      Object.entries(parsed.data).forEach(([key, value]) => {
        if (!DATA_KEYS.includes(key)) return;
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        JSON.parse(text);
      });
    } catch (error) {
      throw new Error('Sauvegarde corrompue — données actuelles non modifiées');
    }

    createBackup('safety');

    Object.entries(parsed.data).forEach(([key, value]) => {
      if (!DATA_KEYS.includes(key)) return;
      if (typeof value === 'string') localStorage.setItem(key, value);
      else if (value != null) localStorage.setItem(key, JSON.stringify(value));
    });

    return true;
  }

  function kindLabel(kind) {
    if (kind === 'auto') return 'Auto';
    if (kind === 'safety') return 'Sécurité';
    return 'Manuel';
  }

  function cacheDom() {
    els.list = document.getElementById('backupsList');
    els.empty = document.getElementById('backupsEmpty');
    els.btnCreate = document.getElementById('btnCreateBackupNow');
  }

  function render() {
    if (!els.list) return;
    const backups = listBackups();
    if (!backups.length) {
      els.list.innerHTML = '';
      els.empty?.classList.remove('hidden');
      return;
    }
    els.empty?.classList.add('hidden');
    els.list.innerHTML = backups
      .map((b) => {
        const d = new Date(b.createdAt);
        const date = Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
        const time = Number.isNaN(d.getTime())
          ? '—'
          : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        return `
          <article class="stack-item backup-item" data-backup-id="${b.id}">
            <div class="stack-item-main">
              <h4 class="stack-item-title">${date} · ${time}</h4>
              <p class="panel-subtitle">${kindLabel(b.kind)} · ${formatSize(b.size)}</p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" data-backup-restore="${b.id}">
              Restaurer
            </button>
          </article>
        `;
      })
      .join('');
  }

  async function onRestore(id) {
    const entry = getBackup(id);
    if (!entry) {
      AppUI.toast('Sauvegarde introuvable.');
      return;
    }
    const d = new Date(entry.createdAt);
    const label = Number.isNaN(d.getTime()) ? entry.id : d.toLocaleString('fr-FR');

    const ok = await AppUI.confirm({
      title: 'Restaurer une sauvegarde',
      message: `Restaurer la sauvegarde du ${label} ? Une sauvegarde de sécurité de l’état actuel sera créée avant la restauration. L’application sera ensuite rechargée.`,
      confirmLabel: 'Restaurer',
    });
    if (!ok) return;

    try {
      restoreBackup(id);
      AppUI.toast('Sauvegarde restaurée — rechargement…');
      setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      console.error(error);
      AppUI.toast(error.message || 'Restauration impossible.');
    }
  }

  function onCreateNow() {
    const result = createBackup('manual');
    if (result.created) {
      AppUI.toast('Sauvegarde créée.');
      render();
    } else {
      AppUI.toast('Sauvegarde non créée.');
    }
  }

  function init() {
    cacheDom();
    ensureDailyAutoBackup();
    els.btnCreate?.addEventListener('click', onCreateNow);
    els.list?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-backup-restore]');
      if (btn) onRestore(btn.dataset.backupRestore);
    });
  }

  global.BackupsModule = {
    init,
    render,
    createBackup,
    ensureDailyAutoBackup,
    listBackups,
    restoreBackup,
    BACKUPS_KEY,
    MAX_BACKUPS,
  };
})(window);
