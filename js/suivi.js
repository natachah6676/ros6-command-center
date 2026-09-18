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
    els.filterAssignee = document.getElementById('suiviFilterAssignee');
    els.counter = document.getElementById('suiviCounter');
    els.btnAdd = document.getElementById('btnSuiviAdd');
    els.addSelect = document.getElementById('suiviAddPlayer');
    els.addAssignee = document.getElementById('suiviAddAssignee');
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

  function getAssignableOfficers(state) {
    const byId = new Map();
    (state.players || []).forEach((p) => {
      if (!p || p.status !== 'Actif') return;
      if (p.role === 'R4' || p.role === 'R5') byId.set(p.id, p);
    });
    // Comptes Accès (Paramètres) : un R4 lié à un joueur « Membre » doit aussi apparaître.
    if (global.ROSProfiles && typeof ROSProfiles.listProfiles === 'function') {
      ROSProfiles.listProfiles().forEach((prof) => {
        if (!prof || prof.status !== 'Actif') return;
        if (prof.role !== 'R4' && prof.role !== 'R5') return;
        if (!prof.playerId) return;
        const player = (state.players || []).find((p) => p && p.id === prof.playerId);
        if (!player || player.status !== 'Actif') return;
        const prev = byId.get(player.id);
        const role =
          prev?.role === 'R5' || player.role === 'R5' || prof.role === 'R5' ? 'R5' : 'R4';
        byId.set(player.id, { ...player, role });
      });
    }
    return Array.from(byId.values()).sort((a, b) => {
      if (a.role !== b.role) return a.role === 'R5' ? -1 : 1;
      return a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' });
    });
  }

  function fillAssigneeFilter(state) {
    if (!els.filterAssignee) return;
    const previous = els.filterAssignee.value || '';
    const officers = getAssignableOfficers(state);
    els.filterAssignee.innerHTML =
      `<option value="">Tous les R4</option>` +
      `<option value="unassigned">Non assigné</option>` +
      officers
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.pseudo)} (${escapeHtml(
              p.role
            )})</option>`
        )
        .join('');
    if (
      previous === 'unassigned' ||
      previous === '' ||
      officers.some((p) => p.id === previous)
    ) {
      els.filterAssignee.value = previous;
    }
  }

  function assigneeLabelFor(follow) {
    if (!follow?.assigneePlayerId && !follow?.assigneeLabel) return '';
    return follow.assigneeLabel || 'R4';
  }

  /** Dossier à clôturer : héros / manuel (VS & félicitations hors module pour l’instant). */
  function hasDossierReasons(reasons) {
    return Boolean(reasons?.hero || reasons?.manual);
  }

  /** @deprecated conservé pour tests — plus de motif « léger » dans Gestion des membres. */
  function isLightOnlyReasons(_reasons) {
    return false;
  }

  function canEditFollowUp() {
    return Boolean(
      global.ROSProfiles &&
        typeof ROSProfiles.isActiveR4OrR5 === 'function' &&
        ROSProfiles.isActiveR4OrR5()
    );
  }

  function viewerIsR5() {
    return Boolean(
      global.ROSProfiles && typeof ROSProfiles.isActiveR5 === 'function' && ROSProfiles.isActiveR5()
    );
  }

  /** Joueur alliance lié au compte connecté (pour spécialités / assignation). */
  function viewerPlayerId() {
    const profile =
      global.ROSProfiles && typeof ROSProfiles.getCurrentProfile === 'function'
        ? ROSProfiles.getCurrentProfile()
        : null;
    return profile?.playerId || null;
  }

  function applySpecialistIfNeeded(row, reasons, state) {
    if (!row || row.assigneePlayerId) return false;
    const pick = ROSModels.pickFollowUpSpecialist(reasons, state);
    if (!pick) return false;
    row.assigneePlayerId = pick.assigneePlayerId;
    row.assigneeLabel = pick.assigneeLabel;
    row.assignedAt = new Date().toISOString();
    row.assignedByLabel = 'Référent motif';
    return true;
  }

  function updateScopeHint(state) {
    const hint = document.getElementById('suiviScopeHint');
    if (!hint) return;
    if (viewerIsR5()) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }
    const keys = ROSModels.getFollowUpSpecialistKeysForPlayer(
      ROSModels.getFollowUpSettings(state),
      viewerPlayerId()
    );
    if (!keys.length) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }
    const labels = ROSModels.FOLLOW_UP_SPECIALIST_KEYS.filter((k) => keys.includes(k.id)).map(
      (k) => k.label
    );
    hint.textContent = `Votre périmètre : ${labels.join(' · ')} (+ fiches qui vous sont assignées)`;
    hint.classList.remove('hidden');
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
      vs: false,
      hero: Boolean(detected.hero || follow?.reasons?.hero),
      praise: false,
      discret: false,
      manual: Boolean(follow?.manual || follow?.reasons?.manual || detected.manual),
    };
  }

  /** Applique les détections auto (héros uniquement). Ne rouvre jamais une fiche terminée. */
  function syncAutoReasons(state) {
    let changed = false;
    (state.players || []).forEach((player) => {
      if (!player || player.status !== 'Actif') return;
      if (player.absent) {
        const existing = state.playerFollowUps?.[player.id];
        if (
          existing &&
          existing.status !== 'done' &&
          !existing.manual &&
          !existing.reasons?.manual
        ) {
          let rowChanged = false;
          ['vs', 'praise', 'discret', 'hero'].forEach((key) => {
            if (existing.reasons?.[key]) {
              existing.reasons[key] = false;
              rowChanged = true;
            }
          });
          if (!existing.reasons?.manual && !existing.manual) {
            existing.status = 'done';
            existing.closedAt = existing.closedAt || new Date().toISOString();
            rowChanged = true;
          }
          if (rowChanged) {
            existing.updatedAt = new Date().toISOString();
            changed = true;
          }
        }
        return;
      }

      const detected = ROSModels.detectFollowUpReasons(player, state);
      const existing = state.playerFollowUps?.[player.id];
      const hasOpen = existing && existing.status !== 'done';
      const autoHit = Boolean(detected.hero);
      if (!autoHit && !hasOpen && !detected.manual) return;

      // Fiche terminée : reste en historique jusqu’à réactivation manuelle.
      if (existing?.status === 'done') return;

      if (!existing) {
        if (!autoHit && !detected.manual) return;
        const seedReasons = {
          vs: false,
          hero: detected.hero,
          praise: false,
          discret: false,
          manual: Boolean(detected.manual),
        };
        const row = ensureCase(state, player.id, {
          reasons: seedReasons,
          manual: Boolean(detected.manual),
        });
        applySpecialistIfNeeded(row, seedReasons, state);
        changed = true;
        return;
      }

      const row = ensureCase(state, player.id);
      if (row.status === 'done') return;
      let rowChanged = false;
      if (detected.hero && !row.reasons.hero) {
        row.reasons.hero = true;
        rowChanged = true;
      }
      if (!detected.hero && row.reasons.hero) {
        row.reasons.hero = false;
        rowChanged = true;
      }
      // Retire les anciens motifs VS / félicitations / Discret de Gestion des membres.
      ['vs', 'praise', 'discret'].forEach((key) => {
        if (row.reasons[key]) {
          row.reasons[key] = false;
          rowChanged = true;
        }
      });
      if (row.reasons?.absent) {
        row.reasons.absent = false;
        rowChanged = true;
      }
      if (row.manual && !row.reasons.manual) {
        row.reasons.manual = true;
        rowChanged = true;
      }
      const stillRelevant = row.reasons.hero || row.manual || row.reasons.manual;
      if (!stillRelevant && row.status !== 'done') {
        row.status = 'done';
        row.closedAt = new Date().toISOString();
        if (!row.closeReason) row.closeReason = 'coaching_done';
        rowChanged = true;
      }
      if (stillRelevant && applySpecialistIfNeeded(row, { ...row.reasons, ...detected }, state)) {
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
    const assigneeFilter = els.filterAssignee?.value || '';

    return (state.players || [])
      .filter((p) => p && p.status === 'Actif')
      .map((player) => {
        const follow = state.playerFollowUps?.[player.id];
        if (!follow) return null;
        const displayReasons = buildDisplayReasons(player, follow, state);
        const isDone = follow.status === 'done';
        if (isDone && !showDone && statusFilter !== 'done') return null;
        if (
          !isDone &&
          !displayReasons.hero &&
          !displayReasons.manual
        ) {
          return null;
        }
        if (statusFilter && follow.status !== statusFilter) return null;
        if (reasonFilter === 'hero' && !displayReasons.hero) return null;
        if (reasonFilter === 'manual' && !displayReasons.manual) return null;
        if (assigneeFilter === 'unassigned' && follow.assigneePlayerId) return null;
        if (
          assigneeFilter &&
          assigneeFilter !== 'unassigned' &&
          follow.assigneePlayerId !== assigneeFilter
        ) {
          return null;
        }
        if (q && !String(player.pseudo || '').toLowerCase().includes(q)) return null;
        return { player, follow, reasons: displayReasons };
      })
      .filter(Boolean)
      .filter((row) =>
        ROSModels.isFollowUpVisibleToViewer(row, state, viewerPlayerId(), viewerIsR5())
      )
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

  /** Liste des R4/R5 pour l’assignation à l’ajout manuel. */
  function fillAddAssigneeSelect(state) {
    if (!els.addAssignee) return;
    const previous = els.addAssignee.value || '';
    const officers = getAssignableOfficers(state);
    const me = viewerPlayerId();
    els.addAssignee.innerHTML =
      `<option value="">Suivi par…</option>` +
      officers
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.pseudo)} (${escapeHtml(
              p.role
            )})</option>`
        )
        .join('');
    if (previous && officers.some((p) => p.id === previous)) {
      els.addAssignee.value = previous;
    } else if (me && officers.some((p) => p.id === me)) {
      els.addAssignee.value = me;
    }
  }

  function renderList() {
    const probe = ROSStorage.getState();
    const draftFollowUps = JSON.parse(JSON.stringify(probe.playerFollowUps || {}));
    const muted = Boolean(ROSModels.getFollowUpSettings(probe).vsFollowUpMutedWeekId);
    const hasStaleVsStats =
      muted && probe.playerVsUnderStats && Object.keys(probe.playerVsUnderStats).length > 0;
    if (syncAutoReasons({ ...probe, playerFollowUps: draftFollowUps }) || hasStaleVsStats) {
      ROSStorage.update(
        (s) => {
          syncAutoReasons(s);
          // Tant que le mute reset est actif, aucun historique VS ne doit réapparaître.
          if (ROSModels.getFollowUpSettings(s).vsFollowUpMutedWeekId) {
            s.playerVsUnderStats = {};
          }
          return s;
        },
        { silent: true }
      );
    }
    const fresh = ROSStorage.getState();
    fillAssigneeFilter(fresh);
    updateScopeHint(fresh);
    const rows = getActiveFollowUpRows(fresh);
    fillAddSelect(fresh, rows);
    fillAddAssigneeSelect(fresh);

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
          const assignee = assigneeLabelFor(follow);
          return `
            <button type="button" class="suivi-row${selected}" data-suivi-open="${escapeHtml(player.id)}">
              <span class="suivi-row-main">
                <strong>${escapeHtml(player.pseudo)}</strong>
                <span class="suivi-row-reasons">${escapeHtml(
                  ROSModels.formatFollowUpReasonsLabel(reasons)
                )}</span>
                ${
                  assignee
                    ? `<span class="suivi-row-assignee">Suivi par ${escapeHtml(assignee)}</span>`
                    : '<span class="suivi-row-assignee is-empty">Non assigné</span>'
                }
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
    const settings = ROSModels.getFollowUpSettings(state);
    const heroLabel = ROSModels.getPlayerPowerLabel(player, state);

    const officers = getAssignableOfficers(state);
    const assigneeOptions =
      `<option value="">— Non assigné —</option>` +
      officers
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}" ${
              follow.assigneePlayerId === p.id ? 'selected' : ''
            }>${escapeHtml(p.pseudo)} (${escapeHtml(p.role)})</option>`
        )
        .join('');

    const statusBtn = (id) => (follow.status === id ? 'btn btn-primary' : 'btn btn-ghost');
    const showStatusButtons = hasDossierReasons(displayReasons) && follow.status !== 'done';

    const canMutateNotes = ROSModels.canMutatePlayerFollowUpNotes(state, playerId, {
      isR5: viewerIsR5(),
      isR4OrR5: canEditFollowUp(),
      viewerPlayerId: viewerPlayerId(),
    });
    const notesList = ROSModels.getPlayerFollowUpNotes(state, playerId);
    const notesHtml = notesList
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((n) => {
        const edited =
          n.updatedAt &&
          `<span class="suivi-note-edited">modifié le ${escapeHtml(
            ROSModels.formatCoachingDateTime(n.updatedAt) || n.updatedAt
          )}</span>`;
        const actions = canMutateNotes
          ? `<span class="suivi-note-actions">
              <button type="button" class="btn btn-ghost btn-sm suivi-note-btn" data-suivi-note-edit="${escapeHtml(
                n.id
              )}" data-player="${escapeHtml(playerId)}" title="Modifier">Modifier</button>
              <button type="button" class="btn btn-ghost btn-sm suivi-note-btn" data-suivi-note-delete="${escapeHtml(
                n.id
              )}" data-player="${escapeHtml(playerId)}" title="Supprimer">supprimer</button>
            </span>`
          : '';
        return `
        <article class="suivi-note" data-note-id="${escapeHtml(n.id)}">
          <header>
            <time datetime="${escapeHtml(n.at)}">${escapeHtml(
              ROSModels.formatCoachingDateTime(n.at) || n.at
            )}</time>
            ${n.authorLabel ? `<span>${escapeHtml(n.authorLabel)}</span>` : ''}
            ${actions}
          </header>
          <p>${escapeHtml(n.text)}</p>
          ${edited || ''}
        </article>
      `;
      })
      .join('');

    const statusButtonsHtml = showStatusButtons
      ? `<div class="settings-actions" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">
        <button type="button" class="${statusBtn('contacted')}" data-suivi-contact="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          Contacté
        </button>
        <button type="button" class="${statusBtn('in_progress')}" data-suivi-progress="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          En suivi
        </button>
        <button type="button" class="${statusBtn('done')}" data-suivi-done="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          Suivi terminé
        </button>
      </div>`
      : '';

    const commentsFormHtml = editable
      ? `<form id="suiviNoteForm" class="suivi-note-form" data-player="${escapeHtml(player.id)}">
            <label class="field">
              <span>Nouveau commentaire</span>
              <textarea id="suiviNoteText" class="input" rows="3" maxlength="800" placeholder="Ex. : intéressé, questions puissance…" required></textarea>
            </label>
            <button type="submit" class="btn btn-primary">Ajouter le commentaire</button>
          </form>`
      : '<p class="panel-subtitle">Lecture seule — seuls R4/R5 peuvent modifier le suivi.</p>';

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
        <p><strong>Puissance héros :</strong> ${escapeHtml(heroLabel)} · seuil ≤ ${
          settings.heroMaxM
        } M</p>
        <p><strong>Contact :</strong> ${
          follow.contactedAt
            ? escapeHtml(ROSModels.formatCoachingDateTime(follow.contactedAt) || follow.contactedAt)
            : 'pas encore'
        }</p>
        <p><strong>Qui suit :</strong> ${
          assigneeLabelFor(follow) ? escapeHtml(assigneeLabelFor(follow)) : 'personne'
        }</p>
      </div>
      <label class="field" style="margin-top:0.65rem">
        <span>Qui suit (R4 / R5)</span>
        <select id="suiviAssigneeSelect" class="input" data-suivi-assignee="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          ${assigneeOptions}
        </select>
      </label>
      ${statusButtonsHtml}
      <div class="suivi-notes-block">
        <h4>Historique des commentaires</h4>
        <div class="suivi-notes-list">${
          notesHtml || '<p class="empty-state">Aucun commentaire pour le moment.</p>'
        }</div>
        ${commentsFormHtml}
      </div>
    `;
  }

  function addManualPlayer() {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut ajouter un suivi.');
      return;
    }
    const playerId = els.addSelect?.value;
    if (!playerId) {
      AppUI.toast('Choisissez un joueur à ajouter au suivi.');
      return;
    }
    const assigneeId = String(els.addAssignee?.value || '').trim();
    if (!assigneeId) {
      AppUI.toast('Choisissez qui s’occupe du suivi.');
      return;
    }
    const actor = stampActor();
    ROSStorage.update((s) => {
      const officer =
        getAssignableOfficers(s).find((p) => p.id === assigneeId) ||
        (s.players || []).find((p) => p && p.id === assigneeId);
      const row = ensureCase(s, playerId, {
        manual: true,
        reasons: ROSModels.emptyFollowUpReasons({ manual: true }),
        status: 'to_contact',
        assigneePlayerId: assigneeId,
        assigneeLabel: officer?.pseudo || assigneeId,
        assignedAt: new Date().toISOString(),
        assignedByLabel: actor.actorLabel || '',
      });
      row.manual = true;
      row.reasons.manual = true;
      // Assignation explicite à l’ajout (prioritaire sur le référent motif auto).
      row.assigneePlayerId = assigneeId;
      row.assigneeLabel = officer?.pseudo || assigneeId;
      row.assignedAt = new Date().toISOString();
      row.assignedByLabel = actor.actorLabel || '';
      if (row.status === 'done') {
        row.status = 'to_contact';
        row.closedAt = null;
      }
      row.closeReason = null;
      row.updatedAt = new Date().toISOString();
      return s;
    });
    selectedPlayerId = playerId;
    showDone = false;
    if (els.showDone) els.showDone.checked = false;
    AppUI.toast('Joueur ajouté au suivi.');
    render();
  }

  function setAssignee(playerId, assigneePlayerId) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut assigner un suivi.');
      return;
    }
    const actor = stampActor();
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId);
      const nextId = String(assigneePlayerId || '').trim() || null;
      if (!nextId) {
        row.assigneePlayerId = null;
        row.assigneeLabel = '';
        row.assignedAt = null;
        row.assignedByLabel = '';
      } else {
        const officer = (s.players || []).find((p) => p.id === nextId);
        row.assigneePlayerId = nextId;
        row.assigneeLabel = officer?.pseudo || nextId;
        row.assignedAt = new Date().toISOString();
        row.assignedByLabel = actor.actorLabel || '';
      }
      row.updatedAt = new Date().toISOString();
      return s;
    });
    AppUI.toast(assigneePlayerId ? 'R4 assigné.' : 'Assignation retirée.');
    render();
  }

  function setStatus(playerId, status, options = {}) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut modifier le suivi.');
      return;
    }
    const closeReason = ROSModels.normalizeFollowUpCloseReason(options.closeReason);
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId);
      const player = (s.players || []).find((p) => p.id === playerId);
      const displayReasons = buildDisplayReasons(player, row, s);
      if (!hasDossierReasons(displayReasons) && status !== 'done') return s;
      row.status = ROSModels.normalizeFollowUpStatus(status);
      row.updatedAt = new Date().toISOString();
      if (row.status === 'done') {
        row.closedAt = new Date().toISOString();
        row.closeReason = closeReason || row.closeReason || 'coaching_done';
      } else {
        row.closedAt = null;
        row.closeReason = null;
      }
      if (row.status === 'contacted' || row.status === 'in_progress') {
        if (!row.contactedAt) {
          const detected = ROSModels.detectFollowUpReasons(player, s);
          row.contactedAt = new Date().toISOString();
          row.contactReasons = ROSModels.emptyFollowUpReasons({
            hero: Boolean(detected.hero || row.reasons.hero),
            manual: Boolean(row.manual || row.reasons.manual),
          });
        }
      }
      return s;
    });
    if (status === 'done') {
      AppUI.toast('Suivi terminé — visible dans l’historique.');
      if (global.SuiviModule) {
        // refresh history if user is there later
      }
      renderHistory();
    }
    render();
  }

  function chooseCloseReason() {
    const modal = document.getElementById('suiviCloseModal');
    if (!modal || typeof modal.showModal !== 'function') {
      return Promise.resolve('coaching_done');
    }
    return new Promise((resolve) => {
      const onClick = (event) => {
        const btn = event.target.closest('[data-close-reason]');
        if (!btn) return;
        cleanup();
        modal.close();
        resolve(btn.dataset.closeReason || null);
      };
      const onCancel = (event) => {
        event.preventDefault();
        cleanup();
        modal.close();
        resolve(null);
      };
      const onCloseBtn = () => {
        cleanup();
        modal.close();
        resolve(null);
      };
      function cleanup() {
        modal.removeEventListener('click', onClick);
        modal.removeEventListener('cancel', onCancel);
        modal.querySelectorAll('[data-close-modal]').forEach((el) => {
          el.removeEventListener('click', onCloseBtn);
        });
      }
      modal.addEventListener('click', onClick);
      modal.addEventListener('cancel', onCancel);
      modal.querySelectorAll('[data-close-modal]').forEach((el) => {
        el.addEventListener('click', onCloseBtn);
      });
      modal.showModal();
    });
  }

  async function requestCloseFollowUp(playerId) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut modifier le suivi.');
      return;
    }
    const reason = await chooseCloseReason();
    if (!reason) return;
    setStatus(playerId, 'done', { closeReason: reason });
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
      row.contactReasons = ROSModels.emptyFollowUpReasons({
        hero: Boolean(detected.hero || row.reasons.hero),
        manual: Boolean(row.manual || row.reasons.manual),
      });
      if (row.status === 'to_contact') row.status = 'contacted';
      row.updatedAt = new Date().toISOString();
      return s;
    });
    AppUI.toast('Contacté.');
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
      const note = ROSModels.appendPlayerFollowUpNote(s, playerId, {
        text: clean,
        authorLabel: actor.actorLabel || '',
        authorUserId: actor.actorUserId || '',
      });
      // Compat temporaire : miroir vers la fiche (sans être la source de vérité).
      if (note) {
        row.notes = ROSModels.mergeFollowUpNotesArrays(row.notes || [], [note]);
      }
      row.updatedAt = new Date().toISOString();
      if (row.status === 'to_contact' || row.status === 'contacted') {
        row.status = 'in_progress';
      }
      return s;
    });
    AppUI.toast('Commentaire ajouté.');
    render();
  }

  function noteMutatorContext() {
    return {
      isR5: viewerIsR5(),
      isR4OrR5: canEditFollowUp(),
      viewerPlayerId: viewerPlayerId(),
    };
  }

  async function editNote(playerId, noteId) {
    const state = ROSStorage.getState();
    if (!ROSModels.canMutatePlayerFollowUpNotes(state, playerId, noteMutatorContext())) {
      AppUI.toast('Vous ne pouvez pas modifier ce commentaire.');
      return;
    }
    const note = ROSModels.getPlayerFollowUpNotes(state, playerId).find((n) => n.id === noteId);
    if (!note) return;
    const next = window.prompt('Modifier le commentaire', note.text);
    if (next == null) return;
    const clean = String(next).trim();
    if (!clean) {
      AppUI.toast('Le commentaire ne peut pas être vide.');
      return;
    }
    if (clean === note.text) return;
    const actor = stampActor();
    let ok = false;
    ROSStorage.update((s) => {
      if (!ROSModels.canMutatePlayerFollowUpNotes(s, playerId, noteMutatorContext())) return s;
      ok = Boolean(
        ROSModels.updatePlayerFollowUpNote(s, playerId, noteId, { text: clean, actor })
      );
      return s;
    });
    AppUI.toast(ok ? 'Commentaire modifié.' : 'Modification impossible.');
    render();
  }

  async function deleteNote(playerId, noteId) {
    const state = ROSStorage.getState();
    if (!ROSModels.canMutatePlayerFollowUpNotes(state, playerId, noteMutatorContext())) {
      AppUI.toast('Vous ne pouvez pas supprimer ce commentaire.');
      return;
    }
    const okConfirm = await AppUI.confirm({
      title: 'Supprimer le commentaire',
      message: 'Supprimer définitivement ce commentaire ?',
      confirmLabel: 'Supprimer',
    });
    if (!okConfirm) return;
    const actor = stampActor();
    let ok = false;
    ROSStorage.update((s) => {
      if (!ROSModels.canMutatePlayerFollowUpNotes(s, playerId, noteMutatorContext())) return s;
      ok = Boolean(ROSModels.softDeletePlayerFollowUpNote(s, playerId, noteId, { actor }));
      return s;
    });
    AppUI.toast(ok ? 'Commentaire supprimé.' : 'Suppression impossible.');
    render();
  }

  function onRootClick(event) {
    const editBtn = event.target.closest('[data-suivi-note-edit]');
    if (editBtn) {
      void editNote(editBtn.dataset.player, editBtn.dataset.suiviNoteEdit);
      return;
    }
    const deleteBtn = event.target.closest('[data-suivi-note-delete]');
    if (deleteBtn) {
      void deleteNote(deleteBtn.dataset.player, deleteBtn.dataset.suiviNoteDelete);
      return;
    }
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
    const progressBtn = event.target.closest('[data-suivi-progress]');
    if (progressBtn) {
      setStatus(progressBtn.dataset.suiviProgress, 'in_progress');
      AppUI.toast('Statut : en suivi.');
      return;
    }
    const doneBtn = event.target.closest('[data-suivi-done]');
    if (doneBtn) {
      void requestCloseFollowUp(doneBtn.dataset.suiviDone);
    }
  }

  function onRootChange(event) {
    const assigneeSelect = event.target.closest('[data-suivi-assignee]');
    if (assigneeSelect) {
      setAssignee(assigneeSelect.dataset.suiviAssignee, assigneeSelect.value);
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

  function specialistSelectId(key) {
    const map = {
      vs: 'followUpSpecialistVs',
      praise: 'followUpSpecialistPraise',
      hero: 'followUpSpecialistHero',
      discret: 'followUpSpecialistDiscret',
      manual: 'followUpSpecialistManual',
    };
    return map[key] || '';
  }

  function fillSpecialistSelects(state) {
    const officers = getAssignableOfficers(state);
    const settings = ROSModels.getFollowUpSettings(state);
    const optionsHtml =
      `<option value="">— Non assigné —</option>` +
      officers
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.pseudo)} (${escapeHtml(
              p.role
            )})</option>`
        )
        .join('');
    ROSModels.FOLLOW_UP_SPECIALIST_KEYS.forEach(({ id }) => {
      const el = document.getElementById(specialistSelectId(id));
      if (!el) return;
      el.innerHTML = optionsHtml;
      el.value = settings.specialists?.[id] || '';
    });
  }

  function renderSettings() {
    const state = ROSStorage.getState();
    const settings = ROSModels.getFollowUpSettings(state);
    const vsEl = document.getElementById('followUpVsMinDays');
    const praiseMetEl = document.getElementById('followUpVsPraiseMinDaysMet');
    const praiseHighEl = document.getElementById('followUpVsPraiseMinHighDays');
    const heroEl = document.getElementById('followUpHeroMax');
    const preview = document.getElementById('followUpSettingsPreview');
    if (vsEl) vsEl.value = settings.vsMinUnderDays;
    if (praiseMetEl) praiseMetEl.value = settings.vsPraiseMinDaysMet;
    if (praiseHighEl) praiseHighEl.value = settings.vsPraiseMinHighDays;
    if (heroEl) heroEl.value = settings.heroMaxM;
    fillSpecialistSelects(state);
    if (preview) {
      const praiseGoal = ROSModels.formatVsMillionsShort(
        ROSModels.getVsSettings(state).afond.praiseGoal
      );
      const specialistBits = ROSModels.FOLLOW_UP_SPECIALIST_KEYS.map(({ id, label }) => {
        const pid = settings.specialists?.[id];
        if (!pid) return null;
        const officer = (state.players || []).find((p) => p.id === pid);
        return `${label}: ${officer?.pseudo || pid}`;
      }).filter(Boolean);
      preview.textContent = `VS suivi : ≥ ${settings.vsMinUnderDays} j sous objectif · À féliciter : ≥ ${settings.vsPraiseMinDaysMet} j score fait + ≥ ${settings.vsPraiseMinHighDays} j ≥ ${praiseGoal} · Héros : ≤ ${settings.heroMaxM} M${
        specialistBits.length ? ` · Référents : ${specialistBits.join(' · ')}` : ''
      }`;
    }
  }

  function saveSettings() {
    if (!(global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5())) {
      AppUI.toast('Seul le R5 peut modifier les seuils de suivi.');
      return;
    }
    const vsMin = Number(document.getElementById('followUpVsMinDays')?.value);
    const praiseMet = Number(document.getElementById('followUpVsPraiseMinDaysMet')?.value);
    const praiseHigh = Number(document.getElementById('followUpVsPraiseMinHighDays')?.value);
    const heroMax = Number(document.getElementById('followUpHeroMax')?.value);
    const specialists = {};
    ROSModels.FOLLOW_UP_SPECIALIST_KEYS.forEach(({ id }) => {
      const el = document.getElementById(specialistSelectId(id));
      specialists[id] = el?.value || null;
    });
    ROSStorage.update((s) => {
      const prev = ROSModels.getFollowUpSettings(s);
      s.followUpSettings = ROSModels.normalizeFollowUpSettings({
        vsMinUnderDays: vsMin,
        vsPraiseMinDaysMet: praiseMet,
        vsPraiseMinHighDays: praiseHigh,
        heroMaxM: heroMax,
        specialists,
        // Ne pas perdre le mute VS posé par le reset compteurs.
        vsFollowUpMutedWeekId: prev.vsFollowUpMutedWeekId,
      });
      return s;
    });
    renderSettings();
    render();
    AppUI.toast('Seuils et référents enregistrés.');
  }

  async function resetVsUnderCounters() {
    if (!(global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5())) {
      AppUI.toast('Seul le R5 peut remettre les compteurs VS à zéro.');
      return;
    }
    const ok = await AppUI.confirm({
      title: 'Remettre les compteurs VS à zéro',
      message:
        'Effacer les compteurs « VS sous seuil / À féliciter » et retirer ces motifs des suivis ouverts pour la semaine en cours (ils ne réapparaissent pas tant que tu n’ouvres pas une nouvelle semaine VS). Tempête, Train, héros et manuels ne sont pas touchés.',
      confirmLabel: 'Remettre à zéro',
    });
    if (!ok) return;
    ROSStorage.update((s) => {
      s.playerVsUnderStats = {};
      const refWeek = ROSModels.getFollowUpReferenceWeek(s);
      const prev = ROSModels.getFollowUpSettings(s);
      s.followUpSettings = ROSModels.normalizeFollowUpSettings({
        ...prev,
        vsFollowUpMutedWeekId: refWeek?.id || null,
      });
      // Retire VS / félicitations des fiches ouvertes (la semaine muette empêche la redétection).
      Object.keys(s.playerFollowUps || {}).forEach((playerId) => {
        const row = s.playerFollowUps[playerId];
        if (!row || row.status === 'done') return;
        row.reasons = ROSModels.emptyFollowUpReasons({
          vs: false,
          praise: false,
          hero: Boolean(row.reasons?.hero),
          discret: false,
          manual: Boolean(row.manual || row.reasons?.manual),
        });
        row.manual = Boolean(row.manual || row.reasons.manual);
        const stillRelevant =
          row.reasons.hero || row.manual;
        if (!stillRelevant) {
          row.status = 'done';
          row.closedAt = new Date().toISOString();
        }
        row.updatedAt = new Date().toISOString();
      });
      return s;
    });
    render();
    AppUI.toast('Compteurs et suivis VS nettoyés pour la semaine en cours.');
  }

  function contactOfficerLabel(follow, playerId) {
    if (follow?.assigneeLabel) return follow.assigneeLabel;
    if (follow?.assigneePlayerId) {
      const state = ROSStorage.getState();
      const officer = (state.players || []).find((p) => p.id === follow.assigneePlayerId);
      if (officer?.pseudo) return officer.pseudo;
    }
    const state = ROSStorage.getState();
    const notes = playerId
      ? ROSModels.getPlayerFollowUpNotes(state, playerId)
      : Array.isArray(follow?.notes)
        ? follow.notes
        : [];
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      if (notes[i]?.authorLabel) return notes[i].authorLabel;
    }
    return '—';
  }

  function formatNotesPreview(follow, playerId, maxLen = 160) {
    const state = ROSStorage.getState();
    const notes = (
      playerId
        ? ROSModels.getPlayerFollowUpNotes(state, playerId)
        : Array.isArray(follow?.notes)
          ? follow.notes.slice()
          : []
    ).slice();
    if (!notes.length) return '—';
    notes.sort((a, b) => (a.at < b.at ? 1 : -1));
    const text = notes
      .map((n) => String(n.text || '').trim())
      .filter(Boolean)
      .join(' · ');
    if (!text) return '—';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }

  function getDoneFollowUpRows(state) {
    const q = (document.getElementById('historiqueSuiviSearch')?.value || '')
      .trim()
      .toLowerCase();
    return (state.players || [])
      .filter((p) => p && p.status === 'Actif')
      .map((player) => {
        const follow = state.playerFollowUps?.[player.id];
        if (!follow || follow.status !== 'done') return null;
        // Motifs au moment du suivi (pas la redétection live actuelle).
        const reasons = ROSModels.emptyFollowUpReasons({
          hero: Boolean(follow.reasons?.hero || follow.contactReasons?.hero),
          manual: Boolean(
            follow.manual || follow.reasons?.manual || follow.contactReasons?.manual
          ),
        });
        // Conserve les motifs historiques VS/félicitations pour l’affichage des anciennes fiches.
        if (follow.reasons?.vs || follow.contactReasons?.vs) reasons.vs = true;
        if (follow.reasons?.praise || follow.contactReasons?.praise) reasons.praise = true;
        if (follow.reasons?.discret || follow.contactReasons?.discret) reasons.discret = true;
        return { kind: 'follow', player, follow, reasons, sortAt: follow.closedAt || follow.updatedAt || '' };
      })
      .filter(Boolean)
      .filter((row) =>
        ROSModels.isFollowUpVisibleToViewer(row, state, viewerPlayerId(), viewerIsR5())
      )
      .filter((row) => {
        if (!q) return true;
        return String(row.player.pseudo || '')
          .toLowerCase()
          .includes(q);
      });
  }

  function getDiscretContactHistoryRows(state) {
    const q = (document.getElementById('historiqueSuiviSearch')?.value || '')
      .trim()
      .toLowerCase();
    const rows = [];
    (state.players || []).forEach((player) => {
      if (!player) return;
      const contacts = ROSModels.normalizeDiscretContacts(player.discretContacts);
      contacts.forEach((contact) => {
        if (q && !String(player.pseudo || '').toLowerCase().includes(q)) return;
        rows.push({
          kind: 'discret_contact',
          player,
          contact,
          sortAt: contact.at || '',
        });
      });
    });
    return rows;
  }

  function getHistoriqueRows(state) {
    return [...getDoneFollowUpRows(state), ...getDiscretContactHistoryRows(state)].sort(
      (a, b) => {
        const ca = a.sortAt || '';
        const cb = b.sortAt || '';
        if (ca !== cb) return ca < cb ? 1 : -1;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      }
    );
  }

  function reactivateFollowUp(playerId) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut réactiver un suivi.');
      return;
    }
    ROSStorage.update((s) => {
      const row = s.playerFollowUps?.[playerId];
      if (!row || row.status !== 'done') return s;
      row.status = 'to_contact';
      row.closedAt = null;
      row.closeReason = null;
      row.updatedAt = new Date().toISOString();
      if (row.reasons?.discret || row.reasons?.vs || row.reasons?.praise) {
        row.reasons = ROSModels.emptyFollowUpReasons({
          hero: Boolean(row.reasons?.hero),
          manual: Boolean(row.manual || row.reasons?.manual),
        });
      }
      const still =
        row.reasons?.hero ||
        row.manual ||
        row.reasons?.manual;
      if (!still) {
        row.manual = true;
        row.reasons = ROSModels.emptyFollowUpReasons({
          manual: true,
        });
      }
      applySpecialistIfNeeded(row, row.reasons, s);
      return s;
    });
    selectedPlayerId = playerId;
    showDone = false;
    if (els.showDone) els.showDone.checked = false;
    AppUI.toast('Suivi réactivé.');
    renderHistory();
    if (global.AppUI && typeof AppUI.switchTab === 'function') {
      AppUI.switchTab('suivi');
    } else {
      render();
    }
  }

  async function clearDoneFollowUpHistory() {
    if (!(global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5())) {
      AppUI.toast('Seul le R5 peut effacer l’historique des suivis.');
      return;
    }
    const state = ROSStorage.getState();
    const doneCount = Object.values(state.playerFollowUps || {}).filter(
      (row) => row && row.status === 'done'
    ).length;
    const discretCount = (state.players || []).reduce(
      (sum, p) => sum + ROSModels.normalizeDiscretContacts(p?.discretContacts).length,
      0
    );
    if (!doneCount && !discretCount) {
      AppUI.toast('Aucun suivi terminé à effacer.');
      return;
    }
    const ok = await AppUI.confirm({
      title: 'Effacer tout l’historique suivi',
      message: `Supprimer définitivement ${doneCount} fiche(s) terminée(s) et ${discretCount} contact(s) Discret ? Les commentaires d’échange avec les joueurs sont conservés. Les suivis encore ouverts dans Gestion des membres ne sont pas touchés.`,
      confirmLabel: 'Effacer l’historique',
    });
    if (!ok) return;
    ROSStorage.update((s) => {
      // Assure la copie ledger avant nettoyage des fiches (sans toucher au ledger).
      ROSModels.migrateFollowUpNotesFromCases(s);
      const next = {};
      Object.keys(s.playerFollowUps || {}).forEach((playerId) => {
        const row = s.playerFollowUps[playerId];
        if (!row || row.status === 'done') return;
        next[playerId] = row;
      });
      s.playerFollowUps = next;
      (s.players || []).forEach((player) => {
        if (player) player.discretContacts = [];
      });
      return s;
    });
    renderHistory();
    render();
    AppUI.toast('Fiches terminées et contacts Discret effacés — commentaires joueurs conservés.');
  }

  function renderHistory() {
    const body = document.getElementById('historiqueSuiviBody');
    const empty = document.getElementById('historiqueSuiviEmpty');
    const counter = document.getElementById('historiqueSuiviCounter');
    const clearBtn = document.getElementById('btnClearSuiviHistory');
    if (!body) return;
    const state = ROSStorage.getState();
    const rows = getHistoriqueRows(state);
    if (counter) counter.textContent = `${rows.length} entrée(s)`;
    if (empty) empty.classList.toggle('hidden', rows.length > 0);
    if (clearBtn) {
      const isR5 = Boolean(
        global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5()
      );
      clearBtn.classList.toggle('hidden', !isR5);
      clearBtn.disabled = rows.length === 0;
    }
    const editable = canEditFollowUp();
    body.innerHTML = rows
      .map((row) => {
        if (row.kind === 'discret_contact') {
          const { player, contact } = row;
          const when =
            ROSModels.formatCoachingDateTime(contact.at) || contact.at || '—';
          const who = contact.authorLabel || '—';
          const note = contact.text || 'Contact pris';
          return `
          <tr>
            <td><strong>${escapeHtml(player.pseudo)}</strong></td>
            <td>Discret · Contact</td>
            <td>—</td>
            <td>${escapeHtml(who)}</td>
            <td>${escapeHtml(when)}</td>
            <td class="historique-suivi-notes">${escapeHtml(note)}</td>
            <td class="table-actions">—</td>
          </tr>
        `;
        }
        const { player, follow, reasons } = row;
        const closed =
          ROSModels.formatCoachingDateTime(follow.closedAt) ||
          ROSModels.formatCoachingDateTime(follow.updatedAt) ||
          '—';
        const r4 = contactOfficerLabel(follow, player.id);
        const notes = formatNotesPreview(follow, player.id);
        const motifs = ROSModels.formatFollowUpReasonsLabel(reasons);
        const fin =
          ROSModels.getFollowUpCloseReasonLabel(follow.closeReason) || '—';
        return `
          <tr>
            <td><strong>${escapeHtml(player.pseudo)}</strong></td>
            <td>${escapeHtml(motifs)}</td>
            <td>${escapeHtml(fin)}</td>
            <td>${escapeHtml(r4)}</td>
            <td>${escapeHtml(closed)}</td>
            <td class="historique-suivi-notes">${escapeHtml(notes)}</td>
            <td class="table-actions">
              ${
                editable
                  ? `<button type="button" class="btn btn-primary btn-sm" data-historique-reactivate="${escapeHtml(
                      player.id
                    )}">Réactiver</button>`
                  : '—'
              }
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function onHistoryClick(event) {
    const btn = event.target.closest('[data-historique-reactivate]');
    if (!btn) return;
    reactivateFollowUp(btn.dataset.historiqueReactivate);
  }

  function init() {
    cacheDom();
    els.search?.addEventListener('input', () => render());
    els.filterStatus?.addEventListener('change', () => render());
    els.filterReason?.addEventListener('change', () => render());
    els.filterAssignee?.addEventListener('change', () => render());
    els.showDone?.addEventListener('change', () => render());
    els.btnAdd?.addEventListener('click', addManualPlayer);
    els.root?.addEventListener('click', onRootClick);
    els.root?.addEventListener('change', onRootChange);
    els.root?.addEventListener('submit', onRootSubmit);
    document.getElementById('btnSaveFollowUpSettings')?.addEventListener('click', saveSettings);
    document.getElementById('btnResetVsUnderCounters')?.addEventListener('click', () => {
      void resetVsUnderCounters();
    });
    document.getElementById('historiqueSuiviSearch')?.addEventListener('input', () => renderHistory());
    document.getElementById('historiqueSuiviBody')?.addEventListener('click', onHistoryClick);
    document.getElementById('btnClearSuiviHistory')?.addEventListener('click', () => {
      void clearDoneFollowUpHistory();
    });
  }

  global.SuiviModule = {
    init,
    render,
    renderHistory,
    renderSettings,
    canEditFollowUp,
    /** Exposé pour les tests (réouverture auto des fiches terminées). */
    syncAutoReasons,
    /** Exposé pour les tests (boutons masqués félicitations seules). */
    isLightOnlyReasons,
    hasDossierReasons,
  };
})(window);
