/**
 * Gestion des membres — suivi des joueurs (VS / puissance héros / aide manuelle).
 * R4+R5 peuvent modifier le suivi. Seuils configurables en Paramètres (R5).
 */
(function (global) {
  const els = {};
  let selectedPlayerId = null;
  let showDone = false;

  function cacheDom() {
    els.root = document.getElementById('panel-suivi');
    els.list = document.getElementById('suiviList');
    els.empty = document.getElementById('suiviEmpty');
    els.search = document.getElementById('suiviSearch');
    els.filterStatus = document.getElementById('suiviFilterStatus');
    els.filterReason = document.getElementById('suiviFilterReason');
    els.showDone = document.getElementById('suiviShowDone');
    els.counter = document.getElementById('suiviCounter');
    els.btnAdd = document.getElementById('btnSuiviAdd');
    els.addSelect = document.getElementById('suiviAddPlayer');
    els.addWrap = document.getElementById('suiviAddWrap');
    els.detail = document.getElementById('suiviDetail');
    els.detailEmpty = document.getElementById('suiviDetailEmpty');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function canEditFollowUp() {
    return Boolean(
      global.ROSProfiles &&
        typeof ROSProfiles.isActiveR4OrR5 === 'function' &&
        ROSProfiles.isActiveR4OrR5()
    );
  }

  function stampActor() {
    if (global.ROSProfiles && typeof ROSProfiles.stampActor === 'function') {
      return ROSProfiles.stampActor();
    }
    return { actorUserId: '', actorPlayerId: null, actorLabel: '' };
  }

  function ensureCase(state, playerId, seed = {}) {
    if (!state.playerFollowUps || typeof state.playerFollowUps !== 'object') {
      state.playerFollowUps = {};
    }
    if (!state.playerFollowUps[playerId]) {
      state.playerFollowUps[playerId] = ROSModels.createEmptyFollowUpCase(seed);
    } else {
      state.playerFollowUps[playerId] = ROSModels.normalizeFollowUpCase(
        state.playerFollowUps[playerId]
      );
    }
    return state.playerFollowUps[playerId];
  }

  function buildDisplayReasons(player, follow, state) {
    const detected = ROSModels.detectFollowUpReasons(player, state);
    return {
      vs: Boolean(detected.vs || follow?.reasons?.vs),
      hero: Boolean(detected.hero || follow?.reasons?.hero),
      manual: Boolean(follow?.manual || follow?.reasons?.manual || detected.manual),
    };
  }

  /** Applique les détections auto. Retourne true si l’état a changé. */
  function syncAutoReasons(state) {
    let changed = false;
    (state.players || []).forEach((player) => {
      if (!player || player.status !== 'Actif') return;
      const detected = ROSModels.detectFollowUpReasons(player, state);
      const existing = state.playerFollowUps?.[player.id];
      const hasOpen = existing && existing.status !== 'done';
      const autoHit = detected.vs || detected.hero;
      if (!autoHit && !hasOpen && !detected.manual) return;
      if (existing?.status === 'done') return;

      if (!existing) {
        ensureCase(state, player.id, {
          reasons: {
            vs: detected.vs,
            hero: detected.hero,
            manual: Boolean(detected.manual),
          },
          manual: Boolean(detected.manual),
        });
        changed = true;
        return;
      }

      const row = ensureCase(state, player.id);
      if (row.status === 'done') return;
      let rowChanged = false;
      if (detected.vs && !row.reasons.vs) {
        row.reasons.vs = true;
        rowChanged = true;
      }
      if (detected.hero && !row.reasons.hero) {
        row.reasons.hero = true;
        rowChanged = true;
      }
      if (row.manual && !row.reasons.manual) {
        row.reasons.manual = true;
        rowChanged = true;
      }
      if (rowChanged) {
        row.updatedAt = new Date().toISOString();
        changed = true;
      }
    });
    return changed;
  }

  function getActiveFollowUpRows(state) {
    const q = (els.search?.value || '').trim().toLowerCase();
    const statusFilter = els.filterStatus?.value || '';
    const reasonFilter = els.filterReason?.value || '';

    return (state.players || [])
      .filter((p) => p && p.status === 'Actif')
      .map((player) => {
        const follow = state.playerFollowUps?.[player.id];
        if (!follow) return null;
        const displayReasons = buildDisplayReasons(player, follow, state);
        const isDone = follow.status === 'done';
        if (isDone && !showDone && statusFilter !== 'done') return null;
        if (!isDone && !displayReasons.vs && !displayReasons.hero && !displayReasons.manual) {
          return null;
        }
        if (statusFilter && follow.status !== statusFilter) return null;
        if (reasonFilter === 'vs' && !displayReasons.vs) return null;
        if (reasonFilter === 'hero' && !displayReasons.hero) return null;
        if (reasonFilter === 'manual' && !displayReasons.manual) return null;
        if (q && !String(player.pseudo || '').toLowerCase().includes(q)) return null;
        return { player, follow, reasons: displayReasons };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const order = { to_contact: 0, contacted: 1, in_progress: 2, done: 3 };
        const oa = order[a.follow.status] ?? 9;
        const ob = order[b.follow.status] ?? 9;
        if (oa !== ob) return oa - ob;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      });
  }

  function fillAddSelect(state, rows) {
    if (!els.addSelect) return;
    const activeIds = new Set(rows.filter((r) => r.follow.status !== 'done').map((r) => r.player.id));
    const options = (state.players || [])
      .filter((p) => p.status === 'Actif' && !p.absent && !activeIds.has(p.id))
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
    els.addSelect.innerHTML =
      `<option value="">Ajouter un joueur à suivre…</option>` +
      options
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.pseudo)}</option>`)
        .join('');
  }

  function renderList() {
    const probe = ROSStorage.getState();
    const draftFollowUps = JSON.parse(JSON.stringify(probe.playerFollowUps || {}));
    if (syncAutoReasons({ ...probe, playerFollowUps: draftFollowUps })) {
      ROSStorage.update(
        (s) => {
          syncAutoReasons(s);
          return s;
        },
        { silent: true }
      );
    }
    const fresh = ROSStorage.getState();
    const rows = getActiveFollowUpRows(fresh);
    fillAddSelect(fresh, rows);

    if (els.counter) {
      const toContact = rows.filter((r) => r.follow.status === 'to_contact').length;
      els.counter.textContent = `${rows.length} joueur(s) · ${toContact} à contacter`;
    }

    if (!rows.length) {
      if (els.list) els.list.innerHTML = '';
      if (els.empty) {
        els.empty.classList.remove('hidden');
        els.empty.textContent = showDone
          ? 'Aucun suivi terminé pour le moment.'
          : 'Aucun joueur à suivre pour le moment.';
      }
      renderDetail(null);
      return;
    }
    if (els.empty) els.empty.classList.add('hidden');

    if (els.list) {
      els.list.innerHTML = rows
        .map(({ player, follow, reasons }) => {
          const selected = player.id === selectedPlayerId ? ' is-selected' : '';
          return `
            <button type="button" class="suivi-row${selected}" data-suivi-open="${escapeHtml(player.id)}">
              <span class="suivi-row-main">
                <strong>${escapeHtml(player.pseudo)}</strong>
                <span class="suivi-row-reasons">${escapeHtml(
                  ROSModels.formatFollowUpReasonsLabel(reasons)
                )}</span>
              </span>
              <span class="suivi-status suivi-status--${escapeHtml(follow.status)}">
                ${escapeHtml(ROSModels.getFollowUpStatusLabel(follow.status))}
              </span>
            </button>
          `;
        })
        .join('');
    }

    if (!selectedPlayerId || !rows.some((r) => r.player.id === selectedPlayerId)) {
      selectedPlayerId = rows[0].player.id;
    }
    renderDetail(selectedPlayerId);
  }

  function renderDetail(playerId) {
    if (!els.detail) return;
    const editable = canEditFollowUp();
    if (!playerId) {
      els.detail.classList.add('hidden');
      if (els.detailEmpty) els.detailEmpty.classList.remove('hidden');
      return;
    }
    const state = ROSStorage.getState();
    const player = state.players.find((p) => p.id === playerId);
    const follow = state.playerFollowUps?.[playerId];
    if (!player || !follow) {
      els.detail.classList.add('hidden');
      if (els.detailEmpty) els.detailEmpty.classList.remove('hidden');
      return;
    }
    if (els.detailEmpty) els.detailEmpty.classList.add('hidden');
    els.detail.classList.remove('hidden');

    const reasons = buildDisplayReasons(player, follow, state);
    const displayReasons = reasons;
    const week = ROSModels.getFollowUpReferenceWeek(state);
    const underDays = week ? ROSModels.countPlayerVsUnderDays(week, player.id) : 0;
    const settings = ROSModels.getFollowUpSettings(state);
    const heroLabel = ROSModels.getPlayerPowerLabel(player, state);

    const statusOptions = ROSModels.FOLLOW_UP_STATUSES.map(
      (s) =>
        `<option value="${s.id}" ${follow.status === s.id ? 'selected' : ''}>${escapeHtml(
          s.label
        )}</option>`
    ).join('');

    const notesHtml = (follow.notes || [])
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map(
        (n) => `
        <article class="suivi-note">
          <header>
            <time datetime="${escapeHtml(n.at)}">${escapeHtml(
              ROSModels.formatCoachingDateTime(n.at) || n.at
            )}</time>
            ${n.authorLabel ? `<span>${escapeHtml(n.authorLabel)}</span>` : ''}
          </header>
          <p>${escapeHtml(n.text)}</p>
        </article>
      `
      )
      .join('');

    els.detail.innerHTML = `
      <div class="suivi-detail-header">
        <div>
          <h3>${escapeHtml(player.pseudo)}</h3>
          <p class="panel-subtitle">${escapeHtml(
            ROSModels.formatFollowUpReasonsLabel(displayReasons)
          )}</p>
        </div>
      </div>
      <div class="suivi-detail-meta">
        <p><strong>VS :</strong> ${
          displayReasons.vs
            ? `${underDays} jour(s) sous objectif${week ? ` (${escapeHtml(week.label || '')})` : ''}`
            : 'non concerné'
        } · seuil ${settings.vsMinUnderDays} j</p>
        <p><strong>Puissance héros :</strong> ${escapeHtml(heroLabel)} · seuil ≤ ${
          settings.heroMaxM
        } M</p>
        <p><strong>Contact :</strong> ${
          follow.contactedAt
            ? escapeHtml(ROSModels.formatCoachingDateTime(follow.contactedAt) || follow.contactedAt)
            : 'pas encore'
        }${
          follow.contactedAt
            ? ` · ${escapeHtml(ROSModels.formatFollowUpReasonsLabel(follow.contactReasons))}`
            : ''
        }</p>
      </div>
      <label class="field">
        <span>Statut du suivi</span>
        <select id="suiviStatusSelect" class="input" data-suivi-status="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          ${statusOptions}
        </select>
      </label>
      <div class="settings-actions" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost" data-suivi-contact="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          Marquer contacté (date + raisons)
        </button>
        <button type="button" class="btn btn-ghost" data-suivi-done="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          Terminer le suivi
        </button>
      </div>
      <div class="suivi-notes-block">
        <h4>Historique des commentaires</h4>
        <div class="suivi-notes-list">${
          notesHtml || '<p class="empty-state">Aucun commentaire pour le moment.</p>'
        }</div>
        ${
          editable
            ? `<form id="suiviNoteForm" class="suivi-note-form" data-player="${escapeHtml(
                player.id
              )}">
            <label class="field">
              <span>Nouveau commentaire</span>
              <textarea id="suiviNoteText" class="input" rows="3" maxlength="800" placeholder="Ex. : informé du seuil VS, va travailler ses héros…" required></textarea>
            </label>
            <button type="submit" class="btn btn-primary">Ajouter le commentaire</button>
          </form>`
            : '<p class="panel-subtitle">Lecture seule — seuls R4/R5 peuvent modifier le suivi.</p>'
        }
      </div>
    `;
  }

  function addManualPlayer() {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut ajouter un suivi.');
      return;
    }
    const playerId = els.addSelect?.value;
    if (!playerId) return;
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId, {
        manual: true,
        reasons: { vs: false, hero: false, manual: true },
        status: 'to_contact',
      });
      row.manual = true;
      row.reasons.manual = true;
      if (row.status === 'done') {
        row.status = 'to_contact';
        row.closedAt = null;
      }
      row.updatedAt = new Date().toISOString();
      return s;
    });
    selectedPlayerId = playerId;
    showDone = false;
    if (els.showDone) els.showDone.checked = false;
    AppUI.toast('Joueur ajouté au suivi.');
    render();
  }

  function setStatus(playerId, status) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut modifier le suivi.');
      return;
    }
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId);
      row.status = ROSModels.normalizeFollowUpStatus(status);
      row.updatedAt = new Date().toISOString();
      if (row.status === 'done') {
        row.closedAt = new Date().toISOString();
      } else {
        row.closedAt = null;
      }
      if (row.status === 'contacted' || row.status === 'in_progress') {
        if (!row.contactedAt) {
          const player = s.players.find((p) => p.id === playerId);
          const detected = ROSModels.detectFollowUpReasons(player, s);
          row.contactedAt = new Date().toISOString();
          row.contactReasons = {
            vs: Boolean(detected.vs || row.reasons.vs),
            hero: Boolean(detected.hero || row.reasons.hero),
            manual: Boolean(row.manual || row.reasons.manual),
          };
        }
      }
      return s;
    });
    render();
  }

  function markContacted(playerId) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut modifier le suivi.');
      return;
    }
    ROSStorage.update((s) => {
      const player = s.players.find((p) => p.id === playerId);
      const detected = ROSModels.detectFollowUpReasons(player, s);
      const row = ensureCase(s, playerId);
      row.contactedAt = new Date().toISOString();
      row.contactReasons = {
        vs: Boolean(detected.vs || row.reasons.vs),
        hero: Boolean(detected.hero || row.reasons.hero),
        manual: Boolean(row.manual || row.reasons.manual),
      };
      if (row.status === 'to_contact') row.status = 'contacted';
      row.updatedAt = new Date().toISOString();
      return s;
    });
    AppUI.toast('Contact enregistré.');
    render();
  }

  function addNote(playerId, text) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut ajouter un commentaire.');
      return;
    }
    const clean = String(text || '').trim();
    if (!clean) return;
    const actor = stampActor();
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId);
      row.notes = row.notes || [];
      row.notes.push({
        id: ROSModels.uid('funote'),
        at: new Date().toISOString(),
        text: clean,
        authorLabel: actor.actorLabel || '',
        authorUserId: actor.actorUserId || '',
      });
      row.updatedAt = new Date().toISOString();
      if (row.status === 'to_contact' || row.status === 'contacted') {
        row.status = 'in_progress';
      }
      return s;
    });
    AppUI.toast('Commentaire ajouté.');
    render();
  }

  function onRootClick(event) {
    const openBtn = event.target.closest('[data-suivi-open]');
    if (openBtn) {
      selectedPlayerId = openBtn.dataset.suiviOpen;
      render();
      return;
    }
    const contactBtn = event.target.closest('[data-suivi-contact]');
    if (contactBtn) {
      markContacted(contactBtn.dataset.suiviContact);
      return;
    }
    const doneBtn = event.target.closest('[data-suivi-done]');
    if (doneBtn) {
      setStatus(doneBtn.dataset.suiviDone, 'done');
      AppUI.toast('Suivi terminé — retiré de la liste active.');
    }
  }

  function onRootChange(event) {
    const statusSelect = event.target.closest('[data-suivi-status]');
    if (statusSelect) {
      setStatus(statusSelect.dataset.suiviStatus, statusSelect.value);
    }
  }

  function onRootSubmit(event) {
    const form = event.target.closest('#suiviNoteForm');
    if (!form) return;
    event.preventDefault();
    const playerId = form.dataset.player;
    const text = document.getElementById('suiviNoteText')?.value || '';
    addNote(playerId, text);
  }

  function render() {
    if (!els.root) cacheDom();
    showDone = Boolean(els.showDone?.checked);
    if (els.addWrap) els.addWrap.classList.toggle('hidden', !canEditFollowUp());
    renderList();
  }

  function renderSettings() {
    const state = ROSStorage.getState();
    const settings = ROSModels.getFollowUpSettings(state);
    const vsEl = document.getElementById('followUpVsMinDays');
    const heroEl = document.getElementById('followUpHeroMax');
    const preview = document.getElementById('followUpSettingsPreview');
    if (vsEl) vsEl.value = settings.vsMinUnderDays;
    if (heroEl) heroEl.value = settings.heroMaxM;
    if (preview) {
      preview.textContent = `VS : ≥ ${settings.vsMinUnderDays} jour(s) sous objectif · Héros : ≤ ${settings.heroMaxM} M`;
    }
  }

  function saveSettings() {
    if (!(global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5())) {
      AppUI.toast('Seul le R5 peut modifier les seuils de suivi.');
      return;
    }
    const vsMin = Number(document.getElementById('followUpVsMinDays')?.value);
    const heroMax = Number(document.getElementById('followUpHeroMax')?.value);
    ROSStorage.update((s) => {
      s.followUpSettings = ROSModels.normalizeFollowUpSettings({
        vsMinUnderDays: vsMin,
        heroMaxM: heroMax,
      });
      return s;
    });
    renderSettings();
    render();
    AppUI.toast('Seuils de suivi enregistrés.');
  }

  function init() {
    cacheDom();
    els.search?.addEventListener('input', () => render());
    els.filterStatus?.addEventListener('change', () => render());
    els.filterReason?.addEventListener('change', () => render());
    els.showDone?.addEventListener('change', () => render());
    els.btnAdd?.addEventListener('click', addManualPlayer);
    els.root?.addEventListener('click', onRootClick);
    els.root?.addEventListener('change', onRootChange);
    els.root?.addEventListener('submit', onRootSubmit);
    document.getElementById('btnSaveFollowUpSettings')?.addEventListener('click', saveSettings);
  }

  global.SuiviModule = {
    init,
    render,
    renderSettings,
    canEditFollowUp,
  };
})(window);
